import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

import { sweepInboundAttachments } from '../../src/channels/shared/inbound-file.mjs';

const DEFAULT_SWEEP_INTERVAL_MS = 30 * 60_000;

// A tracked directory is shielded from sweeps while its turn may still be
// running. Aborted or stalled turns never call cleanup(), so protection has
// an upper bound — far above the default reply timeout — after which the
// directory falls back under TTL control instead of leaking forever.
const TRACKED_PROTECTION_MS = 24 * 60 * 60_000;

/**
 * Host-process coordinator for the global inbound attachment TTL. The staged
 * registry marks directories owned by in-flight turns so a slow turn can
 * outlive any TTL window without the sweeper deleting its files.
 */
export function createInboundTtlService({
  store,
  logger = console,
  intervalMs = DEFAULT_SWEEP_INTERVAL_MS,
} = {}) {
  if (!store || typeof store.getTtlHours !== 'function') {
    throw new TypeError('createInboundTtlService requires a store exposing getTtlHours()');
  }
  const tracked = new Map();
  const providers = new Set();
  let timer = null;

  const runSweep = () => {
    sweepNow().catch((error) => {
      logger.error?.('[dsh-im] inbound attachment sweep failed', error);
    });
  };

  function registerWorkspaceProvider(provider) {
    if (typeof provider !== 'function') {
      throw new TypeError('inbound TTL workspace provider must be a function');
    }
    const wasEmpty = providers.size === 0;
    providers.add(provider);
    // The startup sweep races channel activation and usually runs before any
    // provider exists; re-sweep on the first registration so crash leftovers
    // do not wait a full interval.
    if (wasEmpty && timer) runSweep();
    return () => {
      providers.delete(provider);
    };
  }

  function stagingRetention() {
    // TTL 0 deletes at turn end; every other mode keeps files for the sweeper.
    return store.getTtlHours() === 0 ? 'turn' : 'persistent';
  }

  function canonicalPath(directory) {
    try {
      return realpathSync(directory);
    } catch {
      return null;
    }
  }

  function trackDirectory(directory, { now = () => Date.now() } = {}) {
    if (typeof directory !== 'string' || !directory) return;
    const trackedAt = now();
    tracked.set(directory, trackedAt);
    // The harness-reported cwd and workspaceFor() may normalize symlinks
    // differently; track both spellings so either side finds the entry.
    const canonical = canonicalPath(directory);
    if (canonical && canonical !== directory) tracked.set(canonical, trackedAt);
  }

  function releaseDirectory(directory) {
    tracked.delete(directory);
    const canonical = canonicalPath(directory);
    if (canonical && canonical !== directory) tracked.delete(canonical);
  }

  function isTrackedNow(directory) {
    const trackedAt = tracked.get(directory);
    if (trackedAt === undefined) return false;
    if (Date.now() - trackedAt >= TRACKED_PROTECTION_MS) {
      tracked.delete(directory);
      return false;
    }
    return true;
  }

  function trackStaged(staged) {
    if (!staged || typeof staged !== 'object') return staged;
    const { directory } = staged;
    if (typeof directory !== 'string' || !directory) return staged;
    trackDirectory(directory);
    const cleanup = typeof staged.cleanup === 'function' ? staged.cleanup : null;
    return Object.freeze({
      ...staged,
      async cleanup() {
        try {
          await cleanup?.call(staged);
        } finally {
          releaseDirectory(directory);
        }
      },
    });
  }

  async function sweepNow() {
    const ttlHours = store.getTtlHours();
    // Keep-forever never deletes, so no workspace is even inspected.
    if (ttlHours === -1) return { deletedDirectories: 0, sweptWorkspaces: 0 };
    const workspaces = new Set();
    for (const provider of providers) {
      try {
        const provided = await provider();
        for (const workspace of Array.isArray(provided) ? provided : []) {
          if (typeof workspace === 'string' && workspace) workspaces.add(resolve(workspace));
        }
      } catch (error) {
        logger.warn?.('[dsh-im] inbound TTL workspace provider failed', error);
      }
    }
    const isTracked = (directory) => isTrackedNow(directory)
      || (canonicalPath(directory) !== null && isTrackedNow(canonicalPath(directory)));
    let deletedDirectories = 0;
    let sweptWorkspaces = 0;
    for (const workspace of workspaces) {
      try {
        const result = await sweepInboundAttachments(workspace, ttlHours, { isTracked });
        deletedDirectories += result.deleted;
        sweptWorkspaces += 1;
      } catch (error) {
        logger.warn?.(`[dsh-im] inbound attachment sweep failed under ${workspace}`, error);
      }
    }
    if (deletedDirectories > 0) {
      logger.info?.(
        `[dsh-im] inbound attachment sweep deleted ${deletedDirectories} directories`
        + ` across ${sweptWorkspaces} workspaces (ttl ${ttlHours}h)`,
      );
    }
    return { deletedDirectories, sweptWorkspaces };
  }

  function start() {
    if (timer) return;
    runSweep();
    timer = setInterval(runSweep, intervalMs);
    timer.unref?.();
  }

  // A freshly saved TTL postpones the next scheduled sweep by a full
  // interval so the new value is never enforced by a sweep firing moments
  // after the change, and is not starved of one either.
  function resetSweepSchedule() {
    if (!timer) return;
    clearInterval(timer);
    timer = setInterval(runSweep, intervalMs);
    timer.unref?.();
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  return Object.freeze({
    registerWorkspaceProvider,
    stagingRetention,
    trackDirectory,
    trackStaged,
    sweepNow,
    start,
    resetSweepSchedule,
    stop,
  });
}
