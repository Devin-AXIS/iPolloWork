import { normalizeInterfaceLanguageTag } from '../../src/channels/shared/interface-language.mjs';
import { createPollScheduler } from './lifecycle.js';

/** Host route serving the interface-language mirror (plugin-src/host/host-language-rpc.mjs). */
export const HOST_LANGUAGE_RPC_CHANNEL = '/dsh-im-language';
export const HOST_LANGUAGE_ENDPOINTS = Object.freeze({
  get: 'settings.language.get',
  mirror: 'settings.language.mirror',
});

/** Widening retry delays for a report the Connection could not carry yet. */
const RETRY_DELAYS_MS = Object.freeze([1_000, 4_000, 15_000]);

/**
 * Report the locale the settings UI is actually rendered in to the Host, so
 * bot chat messages and command menus follow the DSH interface language.
 *
 * DSH stores a locale preference only when the reader picks one in the
 * Language row: a locale derived from the browser's language list leaves the
 * Host user-settings document empty. This mirror closes that gap, and the Host
 * keeps an explicit selection ranked above it (see
 * src/channels/shared/interface-language.mjs).
 *
 * The first report runs at plugin load, when the Connection may not be
 * established yet, so a failed report is retried on a widening delay rather
 * than waiting for a locale change that may never come. A failure is both a
 * rejected promise and a resolved `{ ok: false }` envelope — the Host returns
 * the latter when it could not persist the mirror, and that must retry too.
 *
 * @param ctx - client cordis context providing `locale` and the event bus.
 * @param options.rpcCall - management RPC caller for HOST_LANGUAGE_RPC_CHANNEL.
 * @returns an idempotent disposer that stops reporting and cancels any retry.
 */
export function installInterfaceLanguageMirror(ctx, {
  rpcCall,
  setTimeoutFn = (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeoutFn = (timer) => globalThis.clearTimeout(timer),
  retryDelaysMs = RETRY_DELAYS_MS,
} = {}) {
  if (typeof rpcCall !== 'function' || typeof ctx?.locale?.getLocale !== 'function') {
    return () => {};
  }
  const delays = retryDelaysMs.length > 0 ? retryDelaysMs : RETRY_DELAYS_MS;
  const scheduler = createPollScheduler({ setTimeoutFn, clearTimeoutFn });
  let mirrored = null;
  let attempt = 0;

  const retry = (active) => {
    // Leave the tag unmirrored so the retry re-sends it. A Host that cannot
    // persist the mirror still answers in its stored language; there is
    // nothing for the reader to act on here.
    if (mirrored === active) mirrored = null;
    scheduler.schedule(report, delays[Math.min(attempt, delays.length - 1)]);
    attempt += 1;
  };

  const report = () => {
    if (scheduler.disposed) return;
    const active = normalizeInterfaceLanguageTag(ctx.locale.getLocale()?.active);
    if (active === null || active === mirrored) return;
    mirrored = active;
    Promise.resolve(rpcCall(HOST_LANGUAGE_ENDPOINTS.mirror, { locale: active })).then(
      (result) => {
        // Connection resolves failed business results normally; only a
        // resolved ok envelope proves the Host actually persisted the mirror.
        if (result?.ok === true) {
          attempt = 0;
          return;
        }
        retry(active);
      },
      () => retry(active),
    );
  };

  report();
  // A deliberate switch is worth reporting immediately, so it restarts the
  // delay ladder instead of inheriting a previous failure's backoff.
  const off = typeof ctx.on === 'function'
    ? ctx.on('locale/change', () => {
      attempt = 0;
      report();
    })
    : null;
  return () => {
    scheduler.dispose();
    if (typeof off === 'function') off();
  };
}
