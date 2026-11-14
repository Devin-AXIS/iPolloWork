import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  getImHostLanguage,
  normalizeImHostLanguage,
  onImHostLanguageChange,
  setImHostLanguage,
} from '../../src/channels/shared/i18n.mjs';
import {
  normalizeInterfaceLanguageTag,
  resolveHostLanguageTag,
} from '../../src/channels/shared/interface-language.mjs';
import { InterfaceLanguageStore } from '../../src/channels/shared/interface-language-store.mjs';

/** Settings namespace and field owned by @deepseek-ai/dsh-client-locale. */
export const DSH_LOCALE_NAMESPACE = 'locale';
export const DSH_LOCALE_PREFERENCE_FIELD = 'preference';

/**
 * Resolve the durable interface-language mirror. The dshHome resolution
 * mirrors pluginPaths: config.dshHome, then DSH_HOME, then the user's home
 * directory. Channel-specific dataDir values never apply.
 */
export function interfaceLanguageSettingsPath(config = {}) {
  const dshHome = resolve(config.dshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'));
  return resolve(dshHome, 'integrations', 'dsh-im', 'interface-language.json');
}

/**
 * Own the host message language across its resolution layers. `apply()` is
 * idempotent: it re-resolves the layers and hands the winner to
 * setImHostLanguage, which notifies observers only on a real change.
 */
export function createHostLanguageController({
  store = null,
  config: configLanguage,
  readSettingsPreference = () => undefined,
  logger = null,
} = {}) {
  const pinned = normalizeInterfaceLanguageTag(configLanguage);
  let readPreference = typeof readSettingsPreference === 'function'
    ? readSettingsPreference
    : () => undefined;

  const settingsTag = () => {
    // A pinned language wins outright, so never consult the settings service
    // for it: a detached provider must not produce a spurious diagnostic.
    if (pinned !== null) return undefined;
    try {
      return readPreference();
    } catch (error) {
      logger?.warn?.(
        '[dsh-im] could not read the DSH interface language preference; using the mirrored language',
        error,
      );
      return undefined;
    }
  };

  const mirrorTag = () => (typeof store?.getLanguageTag === 'function' ? store.getLanguageTag() : null);

  const explicitTag = () => (typeof store?.getExplicitTag === 'function' ? store.getExplicitTag() : null);

  const resolution = () => resolveHostLanguageTag({
    config: configLanguage,
    explicit: explicitTag(),
    settings: settingsTag(),
    mirror: mirrorTag(),
  });

  const describe = (resolved) => Object.freeze({
    language: normalizeImHostLanguage(resolved.tag),
    tag: resolved.tag,
    source: resolved.source,
    pinned: pinned !== null,
  });

  const apply = () => {
    const resolved = resolution();
    setImHostLanguage(resolved.tag ?? undefined);
    return describe(resolved);
  };

  return Object.freeze({
    apply,

    /** The resolution as it stands, without switching the active language. */
    snapshot: () => describe(resolution()),

    /**
     * Pin the plugin's own message language, or pass null (the settings page's
     * "same as the DSH interface") to clear that selection. It outranks DSH's
     * locale, so a reader who wants English DSH with Russian bot messages can
     * say so; an operator's `language` option still outranks both.
     */
    async select(value) {
      const choice = value === null || value === undefined ? null : value;
      if (typeof store?.setExplicitTag !== 'function') return apply();
      if (choice === null) {
        await store.setExplicitTag(null);
      } else {
        const tag = normalizeInterfaceLanguageTag(choice);
        if (tag === null) {
          const error = new Error('Invalid message language selection.');
          error.code = 'interface-language-invalid';
          throw error;
        }
        await store.setExplicitTag(tag);
      }
      return apply();
    },

    /** The current explicit selection, or null when the plugin follows DSH. */
    explicit: explicitTag,

    /** Record the interface locale reported by the settings UI, then re-resolve. */
    async mirror(value) {
      if (typeof store?.setLanguageTag !== 'function') return apply();
      await store.setLanguageTag(value ?? null);
      return apply();
    },

    /** Replace the settings-preference reader once the service is injectable. */
    observeSettings(read) {
      readPreference = typeof read === 'function' ? read : () => undefined;
      return apply();
    },

    /** Observe committed host language changes (see onImHostLanguageChange). */
    observe: onImHostLanguageChange,

    /** The active host message language, for callers that only need the switch. */
    language: () => getImHostLanguage(),
  });
}

/**
 * Bind the host message language to DSH's interface language.
 *
 * The plugin's own `language` option stays authoritative for operators who set
 * it. Otherwise the language follows DSH: the explicit Language-row selection
 * from the Host user-settings document, and — because DSH stores nothing for a
 * browser-derived locale — the language mirrored by the settings UI.
 */
export function installHostLanguage(ctx, config = {}, internals = {}) {
  const logger = typeof ctx?.logger === 'function'
    ? ctx.logger('dsh-im:language')
    : (ctx?.logger ?? null);
  const store = internals.store
    ?? new InterfaceLanguageStore(interfaceLanguageSettingsPath(config));
  const controller = createHostLanguageController({
    store,
    config: config.language ?? process.env.DSH_IM_LANGUAGE,
    logger,
  });
  // Only the injected context may access settings. Waiting for its current
  // lifecycle work does not wait for an absent provider to arrive.
  let settingsBinding;
  const readPreference = (settings) => typeof settings?.describe === 'function'
    ? settings.describe().find((row) => row.ns === DSH_LOCALE_NAMESPACE)
      ?.value?.[DSH_LOCALE_PREFERENCE_FIELD]
    : settings?.get?.(DSH_LOCALE_NAMESPACE)?.[DSH_LOCALE_PREFERENCE_FIELD];
  if (typeof ctx?.inject === 'function') {
    settingsBinding = ctx.inject(['settings'], (settingsCtx) => {
      controller.observeSettings(() => readPreference(settingsCtx.settings));
      for (const event of ['settings/updated', 'settings/document-updated']) {
        settingsCtx.on(event, (namespace) => {
          if (namespace === DSH_LOCALE_NAMESPACE) controller.apply();
        });
      }
      // Do not retain a reader bound to a withdrawn service/context.
      return () => { controller.observeSettings(); };
    });
  }
  const ready = Promise.resolve(settingsBinding)
    .then(() => store.load?.())
    .then(() => controller.apply(), (error) => {
      logger?.error?.(
        '[dsh-im] could not initialize the DSH interface language; falling back to the available language',
        error,
      );
      return controller.snapshot();
    });
  return Object.freeze({ ...controller, ready });
}
