import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import semver from 'semver';

import manifest from '../../package.json' with { type: 'json' };
import { withSessionBindingLock } from '../../src/channels/shared/session-binding-lock.mjs';
import { NPM_REGISTRY, PACKAGE_NAME } from './update-runtime.mjs';

const ACTIVE_STATES = new Set(['installing', 'verifying']);
const JOB_STATES = new Set([...ACTIVE_STATES, 'restart-required', 'completed', 'failed', 'interrupted']);
const MAX_METADATA_BYTES = 256 * 1024;
const SNAPSHOT_FILES = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'];
const NO_LOCK = Symbol('no update lock');
// Shared across Host instances; keep network and installer work outside these transactions.
const stateIoQueue = {};

export function updateError(code) {
  return Object.assign(new Error(code), { code });
}

/** Read only the fixed npm package; neither RPC callers nor registry metadata choose a command. */
export async function fetchNpmRelease(fetchImpl = globalThis.fetch, timeoutMs = 10_000) {
  let response;
  try {
    response = await fetchImpl(`${NPM_REGISTRY}${encodeURIComponent(PACKAGE_NAME)}/latest`, {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw updateError('check-failed');
    if (Number(response.headers.get('content-length')) > MAX_METADATA_BYTES) {
      throw updateError('invalid-release');
    }
    const chunks = [];
    let length = 0;
    for await (const chunk of response.body) {
      length += chunk.byteLength;
      if (length > MAX_METADATA_BYTES) throw updateError('invalid-release');
      chunks.push(Buffer.from(chunk));
    }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const version = value.version;
    if (value.name !== PACKAGE_NAME || typeof version !== 'string'
      || semver.valid(version) !== version || semver.prerelease(version)) {
      throw updateError('invalid-release');
    }
    const nodeRange = value.engines?.node;
    if (nodeRange !== undefined && (typeof nodeRange !== 'string' || !semver.validRange(nodeRange))) {
      throw updateError('invalid-release');
    }
    const tarball = new URL(value.dist?.tarball);
    const integrity = value.dist?.integrity;
    if (tarball.origin !== new URL(NPM_REGISTRY).origin || tarball.username || tarball.password
      || tarball.search || tarball.hash
      || tarball.pathname !== `/@xmanrui/dsh-im/-/dsh-im-${version}.tgz`
      || typeof integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity)) {
      throw updateError('invalid-release');
    }
    return { version, nodeRange: nodeRange ?? '*', integrity, tarball: tarball.href };
  } catch (error) {
    if (error?.code === 'invalid-release' || error instanceof SyntaxError || error instanceof TypeError && response?.ok) {
      throw updateError('invalid-release');
    }
    throw updateError('check-failed');
  }
}

function pathsFor(environment) {
  if (!isAbsolute(environment.homeDir ?? '') || !isAbsolute(environment.profileDir ?? '')) return null;
  const key = createHash('sha256').update(environment.profileDir).digest('hex').slice(0, 24);
  const directory = join(environment.homeDir, 'updates', 'dsh-im', key);
  return {
    directory,
    state: join(directory, 'state.json'),
    lock: join(directory, 'install.lock'),
    backup: join(directory, 'before.json'),
  };
}

function withStateIo(path, operation) {
  const absolute = resolve(path);
  const key = process.platform === 'win32' ? absolute.toLowerCase() : absolute;
  return withSessionBindingLock(stateIoQueue, key, operation);
}

function readJson(path, missing = null) {
  return withStateIo(path, () => readJsonUnlocked(path, missing));
}

async function readJsonUnlocked(path, missing = null) {
  try {
    if ((await stat(path)).size > 10 * 1024 * 1024) throw updateError('state-unavailable');
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return missing;
    throw updateError('state-unavailable');
  }
}

function writeJson(path, value) {
  return withStateIo(path, () => writeJsonUnlocked(path, value));
}

async function writeJsonUnlocked(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    for (let retry = 0; ; retry++) {
      try {
        await rename(temporary, path);
        break;
      } catch (error) {
        // Windows readers can temporarily deny replacement. Keep the old journal
        // and retry the same atomic rename; never remove the destination first.
        if (process.platform !== 'win32' || error.code !== 'EPERM' || retry >= 5) throw error;
        await delay(10 * 2 ** retry);
      }
    }
  } catch {
    throw updateError('state-unavailable');
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== 'ENOENT') throw updateError('state-unavailable');
    });
  }
}

function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

function publicJob(job) {
  if (!job) return null;
  const { id, state, targetVersion, message } = job;
  return { id, state, targetVersion, message, recoverable: job.recoverable === true };
}

/** One update job per profile. Persist intent before starting pnpm, and never apply a restart here. */
export function createUpdateService({
  runtime,
  runningVersion = manifest.version,
  nodeVersion = process.versions.node,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  checkTimeoutMs = 10_000,
  confirmationTtlMs = 10 * 60_000,
  installTimeoutMs = 15 * 60_000,
} = {}) {
  const queue = {};
  let checked = null;
  let checking = null;
  let lastCheckAt = -Infinity;
  let activeJob = null;
  let activeTask = null;
  let abortController = null;
  let unsavedJob = null;
  let disposed = false;

  function assertActive() {
    if (disposed) throw updateError('disposed');
  }

  async function readJob(environment) {
    const paths = pathsFor(environment);
    if (!paths) return null;
    // A failed final write must not make this Host display the old "installing"
    // record forever. Keep the lock and expose the outcome we actually observed.
    if (unsavedJob?.statePath === paths.state) return unsavedJob.job;
    let job = await readJson(paths.state);
    const lock = await readJson(paths.lock, NO_LOCK);
    if (!job) {
      if (lock !== NO_LOCK) {
        return { id: 'locked', state: 'interrupted', message: 'recovery-required', targetVersion: null };
      }
      return null;
    }
    if (!JOB_STATES.has(job.state) || typeof job.id !== 'string' || !semver.valid(job.targetVersion)) {
      throw updateError('state-unavailable');
    }
    // Recovery is derived from the current installation, never a persisted flag.
    job = { ...job, recoverable: false };
    const historical = job.id !== activeJob?.id;
    if (ACTIVE_STATES.has(job.state) && historical) {
      if (lock === NO_LOCK || lock?.id !== job.id || !processAlive(lock?.pid)) {
        job = { ...job, state: 'interrupted', message: 'recovery-required' };
      }
    }
    if (historical && !ACTIVE_STATES.has(job.state) && lock !== NO_LOCK) {
      return { ...job, state: 'interrupted', message: 'recovery-required' };
    }
    if (job.state === 'restart-required' || job.state === 'completed') {
      if (environment.installedVersion !== job.targetVersion || environment.packageValid !== true) {
        job = { ...job, state: 'interrupted', message: 'installation-changed' };
      } else {
        job = { ...job, state: runningVersion === job.targetVersion ? 'completed' : 'restart-required' };
      }
    }
    // Reconcile after deriving the job state so an external upgrade or rollback
    // can also recover. Keep history read-only and do not claim its target ran.
    if (historical && lock === NO_LOCK && ['failed', 'interrupted'].includes(job.state)
      && environment.packageValid === true && environment.eligible === true
      && environment.installedVersion === runningVersion && !environment.blockedReason) {
      return job.targetVersion === runningVersion
        ? { ...job, state: 'completed', message: 'recovered' }
        : { ...job, recoverable: true };
    }
    return job;
  }

  function snapshot(environment, job) {
    let blockedReason = environment.blockedReason ?? checked?.blockedReason ?? null;
    if (job?.state === 'interrupted' && !job.recoverable
      || job?.state === 'failed' && environment.installedVersion !== runningVersion) {
      blockedReason = 'recovery-required';
    } else if (job?.state === 'restart-required' || environment.installedVersion && environment.installedVersion !== runningVersion) {
      blockedReason = 'pending-restart';
    }
    const busy = ACTIVE_STATES.has(job?.state);
    const canInstall = Boolean(environment.eligible && !blockedReason && !busy && checked?.checkId
      && now() < checked.expiresAt && checked.installationKey === environment.installationKey
      && semver.valid(runningVersion) && semver.gt(checked.release.version, runningVersion));
    return {
      runningVersion,
      installedVersion: environment.installedVersion ?? null,
      latestVersion: checked?.release.version ?? null,
      profileName: environment.profileName ?? null,
      environmentKind: environment.environmentKind ?? 'cli',
      // Preserve source protection even when restart/recovery takes status priority.
      sourceInstall: environment.sourceInstall === true || environment.blockedReason === 'source-install',
      canInstall,
      blockedReason,
      checkedAt: checked?.checkedAt ?? null,
      checkId: canInstall ? checked.checkId : null,
      job: publicJob(job),
    };
  }

  async function status() {
    assertActive();
    const environment = await runtime.inspect();
    return snapshot(environment, await readJob(environment));
  }

  async function check() {
    assertActive();
    if (checking) return checking;
    // Collapse double clicks without turning a failed request into a cached success.
    if (checked?.checkId && now() - lastCheckAt < 2_000) return status();
    lastCheckAt = now();
    checking = (async () => {
      try {
        const environment = await runtime.inspect({ preflight: true });
        const release = await fetchNpmRelease(fetchImpl, checkTimeoutMs);
        assertActive();
        checked = {
          release,
          checkId: randomUUID(),
          checkedAt: now(),
          expiresAt: now() + confirmationTtlMs,
          installationKey: environment.installationKey,
          profileDir: environment.profileDir,
          blockedReason: environment.blockedReason
            ?? (!semver.satisfies(nodeVersion, release.nodeRange) ? 'incompatible-node' : null),
        };
        return snapshot(environment, await readJob(environment));
      } catch (error) {
        if (checked) checked = { ...checked, checkId: null, expiresAt: 0 };
        throw error;
      } finally {
        checking = null;
      }
    })();
    return checking;
  }

  async function releaseLock(paths, id) {
    await withStateIo(paths.lock, async () => {
      const lock = await readJsonUnlocked(paths.lock);
      if (lock?.id === id) await unlink(paths.lock);
    });
  }

  async function backupProfile(environment, paths, job) {
    const files = {};
    for (const filename of SNAPSHOT_FILES) {
      try {
        const path = join(environment.profileDir, filename);
        if ((await stat(path)).size > 3 * 1024 * 1024) throw updateError('state-unavailable');
        files[filename] = await readFile(path, 'utf8');
      } catch (error) {
        if (error.code !== 'ENOENT') throw updateError('state-unavailable');
      }
    }
    // Keep only the previous attempt's small manifests, never credentials or the entire home.
    await writeJson(paths.backup, { jobId: job.id, previousVersion: job.previousVersion, files });
  }

  function rememberUnsavedJob(paths) {
    activeJob = { ...activeJob, state: 'interrupted', message: 'state-unavailable' };
    unsavedJob = { statePath: paths.state, job: activeJob };
  }

  async function execute(paths, job, originalEnvironment) {
    const deadline = AbortSignal.timeout(installTimeoutMs);
    try {
      await runtime.install(job.targetVersion, {
        signal: AbortSignal.any([abortController.signal, deadline]),
        expectedInstallationKey: originalEnvironment.installationKey,
      });
      if (disposed) throw updateError('interrupted');
      activeJob = { ...activeJob, state: 'verifying', updatedAt: now() };
      await writeJson(paths.state, activeJob);
      const environment = await runtime.inspect();
      if (environment.homeDir !== originalEnvironment.homeDir || environment.profileDir !== originalEnvironment.profileDir
        || environment.profileName !== originalEnvironment.profileName || environment.blockedReason === 'installation-changed') {
        throw updateError('installation-changed');
      }
      if (environment.installedVersion !== job.targetVersion || environment.packageValid !== true) {
        throw updateError('verify-failed');
      }
      if (environment.blockedReason && environment.blockedReason !== 'pending-restart') throw updateError('verify-failed');
      activeJob = { ...activeJob, state: 'restart-required', message: null, updatedAt: now() };
      await writeJson(paths.state, activeJob);
    } catch (error) {
      const timedOut = deadline.aborted || error.code === 'install-timeout';
      const interrupted = disposed || abortController.signal.aborted
        || !timedOut && ['interrupted', 'install-interrupted'].includes(error.code);
      activeJob = {
        ...activeJob,
        state: interrupted ? 'interrupted' : 'failed',
        message: interrupted ? 'interrupted' : timedOut ? 'install-timeout'
          : ['verify-failed', 'state-unavailable', 'installation-changed', 'registry-conflict'].includes(error.code)
            ? error.code : 'install-failed',
        updatedAt: now(),
      };
      try {
        await writeJson(paths.state, activeJob);
      } catch {
        // Retain the lock when the final record cannot be saved; the next Host must inspect it.
        rememberUnsavedJob(paths);
        return;
      }
    }
    await releaseLock(paths, job.id);
  }

  function install({ checkId, requestId }) {
    return withSessionBindingLock(queue, 'install', async () => {
      assertActive();
      let environment = await runtime.inspect({ preflight: true });
      const previous = await readJob(environment);
      if (previous?.requestId === requestId) return snapshot(environment, previous);
      if (ACTIVE_STATES.has(previous?.state) || previous?.state === 'restart-required') throw updateError('update-busy');
      const confirmation = checked;
      if (!confirmation || !checkId || confirmation.checkId !== checkId || now() >= confirmation.expiresAt) {
        throw updateError('check-expired');
      }
      if (environment.profileDir !== confirmation.profileDir || environment.installationKey !== confirmation.installationKey) {
        throw updateError('installation-changed');
      }
      if (!snapshot(environment, previous).canInstall) throw updateError(environment.blockedReason ?? 'update-busy');
      const paths = pathsFor(environment);
      if (!paths) throw updateError('state-unavailable');
      const job = {
        id: randomUUID(), requestId, state: 'installing', message: null,
        targetVersion: confirmation.release.version, previousVersion: environment.installedVersion,
        startedAt: now(), updatedAt: now(),
      };
      let locked = false;
      try {
        await mkdir(paths.directory, { recursive: true, mode: 0o700 });
        await withStateIo(paths.lock, async () => {
          const lock = await open(paths.lock, 'wx', 0o600);
          locked = true;
          try {
            await lock.writeFile(JSON.stringify({ id: job.id, pid: process.pid, startedAt: now() }));
          } finally {
            await lock.close();
          }
        });
        const currentRelease = await fetchNpmRelease(fetchImpl, checkTimeoutMs);
        if (JSON.stringify(currentRelease) !== JSON.stringify(confirmation.release)) throw updateError('check-expired');
        environment = await runtime.inspect({ preflight: true });
        if (environment.profileDir !== confirmation.profileDir || environment.installationKey !== confirmation.installationKey) {
          throw updateError('installation-changed');
        }
        if (!environment.eligible || environment.blockedReason) throw updateError(environment.blockedReason ?? 'update-busy');
        assertActive();
        await backupProfile(environment, paths, job);
        await writeJson(paths.state, job);
        assertActive();
      } catch (error) {
        if (locked) await releaseLock(paths, job.id);
        if (error.code === 'EEXIST') throw updateError('update-busy');
        if (error.code?.startsWith('E')) throw updateError('state-unavailable');
        throw error;
      }
      activeJob = job;
      abortController = new AbortController();
      activeTask = execute(paths, job, environment).catch(() => {
        // Keep unknown cleanup failures local and keep the on-disk lock for manual recovery.
        rememberUnsavedJob(paths);
      });
      return snapshot(environment, job);
    });
  }

  async function close() {
    disposed = true;
    abortController?.abort();
    if (activeTask) await activeTask;
  }

  return Object.freeze({ status, check, install, close });
}
