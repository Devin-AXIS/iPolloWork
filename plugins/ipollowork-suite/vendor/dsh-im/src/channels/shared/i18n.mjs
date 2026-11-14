// Host-side i18n for dsh-im. Mirrors the conventions of the settings-UI
// translator in plugin-src/client/i18n.js: dictionary keys are the exact
// Chinese source literals, and Chinese (zh) is the identity language, so a key
// that no dictionary covers still renders as the original Chinese text
// unchanged.
//
// The English dictionary lives in ./i18n-en.mjs and the Russian one in
// ./i18n-ru.mjs, both split per area to keep each module small.

import { EN } from './i18n-en.mjs';
import { RU } from './i18n-ru.mjs';

let language = 'zh';

const listeners = new Set();

// The one mapping from a DSH interface-language tag to a dictionary language,
// spelled out rather than inferred:
//
//   zh, zh-*, zh_*, chinese (any case)  -> 'zh'  identity, no translation
//   ru, ru-*, ru_*, russian (any case)  -> 'ru'  Russian, over English
//   everything else                     -> 'en'  English
//
// Why "everything else" lands on English and not on Chinese: Chinese is the
// identity language and English is the only complete translation, so an
// unrecognized tag ('de', '', undefined, a future language id) must never
// surface Chinese to a reader who asked for another language. English is the
// widest fallback we can honestly ship, and a Russian key that is missing
// falls back to English too (see t()), so neither path ends in raw Chinese.
//
// Pure: use it to judge a candidate tag without switching the active language.
export function normalizeImHostLanguage(lang) {
  const normalized = typeof lang === 'string' ? lang.trim().toLowerCase() : '';
  if (normalized === 'chinese' || /^zh(?:[-_].*)?$/u.test(normalized)) return 'zh';
  if (normalized === 'russian' || /^ru(?:[-_].*)?$/u.test(normalized)) return 'ru';
  return 'en';
}

/**
 * Select the language of every host-side message. Subscribers registered
 * through onImHostLanguageChange are notified only when the resolved language
 * actually changes, so re-applying the same selection in a different spelling
 * (or an unrecognized tag that keeps falling back to English) is free.
 */
export function setImHostLanguage(lang) {
  const next = normalizeImHostLanguage(lang);
  if (next === language) return language;
  const previous = language;
  language = next;
  // Snapshot first: a subscriber may unsubscribe (or subscribe) while running.
  for (const listener of [...listeners]) {
    if (!listeners.has(listener)) continue;
    try {
      listener(next, previous);
    } catch {
      // Each subscriber owns its own diagnostics; one that fails must not
      // strand the rest, nor abandon a language switch that already happened.
    }
  }
  return language;
}

export function getImHostLanguage() {
  return language;
}

/**
 * Observe committed changes to the host message language. Platform-side
 * surfaces that were localized once at connect time (the Telegram command
 * menu, for example) re-synchronize from here instead of waiting for a
 * reconnect. Subscribers must not throw; the disposer is idempotent.
 */
export function onImHostLanguageChange(listener) {
  if (typeof listener !== 'function') {
    throw new TypeError('onImHostLanguageChange requires a listener function');
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const DICTIONARIES = Object.freeze({ ru: RU, en: EN });

// Dictionary lookup for one language: ru -> en -> the Chinese key itself (the
// identity language), so a Russian gap is answered from the complete English
// dictionary and only a key neither dictionary knows stays Chinese. Pure, and
// exported so the fallback contract can be tested against a dictionary that is
// missing a key; production callers reach it through t().
export function translateImHostText(text, lang, dictionaries = DICTIONARIES) {
  if (lang === 'zh') return text;
  return (lang === 'ru' ? dictionaries.ru?.[text] : undefined)
    ?? dictionaries.en?.[text]
    ?? text;
}

// Translate a user-facing Chinese literal. In zh mode (the default) this is
// the identity function. The lookup chain is ru -> en -> the Chinese key
// itself: the Russian dictionary is a partial overlay, so a key it does not
// carry is answered from the complete English one, and only a key neither
// dictionary knows comes back as the original Chinese literal (the identity
// language). A Russian reader therefore never sees Chinese where English
// exists. Optional `params` fills `{name}` placeholders in the translation,
// e.g.
//   t('共 {count} 个机器人', { count: 3 })
export function t(text, params) {
  if (typeof text !== 'string') return text;
  const translated = translateImHostText(text, language);
  if (params == null) return translated;
  return translated.replace(/\{(\w+)\}/g, (match, name) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  );
}
