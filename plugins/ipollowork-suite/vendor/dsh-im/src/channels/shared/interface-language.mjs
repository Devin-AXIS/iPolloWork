// Resolution policy for the DSH interface language that dsh-im's bot messages
// follow.
//
// The host message language (./i18n.mjs) selects Chinese, English, or Russian,
// with English as the fallback for other tags. The DSH interface language is a
// BCP 47-style tag that a language pack may extend beyond the shipped zh/en
// pair, so a tag is carried verbatim through resolution and persistence and is
// collapsed to a dictionary language only where it reaches setImHostLanguage().

/** Tag shape accepted by DSH's own locale preference (@deepseek-ai/dsh-client-locale). */
const LANGUAGE_TAG = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u;

/**
 * Resolution layers, highest precedence first.
 *
 * - `config`: the plugin's own `language` option (or `DSH_IM_LANGUAGE`). An
 *   operator who pinned a language in the Host composition keeps it, whatever
 *   any individual browser reads the interface in.
 * - `explicit`: the language a reader picked for the plugin's own chat messages
 *   in the settings page ("settings.language.set"). It outranks what DSH is set
 *   to, because a reader may want English DSH with Russian bot messages.
 * - `settings`: the explicit selection in DSH's Language row, read from the
 *   Host user-settings document. This is the setting users mean by "DSH is set
 *   to English".
 * - `mirror`: the last effective interface locale reported by the settings UI.
 *   DSH stores nothing when the interface language came from the browser's
 *   language list, so without this layer a reader who never opened the
 *   Language row would still be answered in Chinese.
 */
export const HOST_LANGUAGE_SOURCES = Object.freeze(['config', 'explicit', 'settings', 'mirror']);

/** Languages the plugin ships chat-message dictionaries for. */
export const MESSAGE_LANGUAGE_TAGS = Object.freeze(['zh', 'en', 'ru']);

/**
 * Normalize one choice of the plugin's own message language: `'auto'` (follow
 * DSH) or one of MESSAGE_LANGUAGE_TAGS. Anything else returns null, which the
 * RPC layer rejects and the settings page keeps from being saved.
 */
export function normalizeMessageLanguageChoice(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === 'auto') return 'auto';
  return MESSAGE_LANGUAGE_TAGS.includes(trimmed) ? trimmed : null;
}

/**
 * Normalize one interface-language tag. Surrounding whitespace is trimmed;
 * anything that is not a BCP 47-style tag returns null so a malformed layer is
 * skipped rather than silently overriding the layers below it.
 */
export function normalizeInterfaceLanguageTag(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return LANGUAGE_TAG.test(trimmed) ? trimmed : null;
}

/**
 * Pick the winning interface-language tag across the layers, in
 * HOST_LANGUAGE_SOURCES order. Returns `{ tag: null, source: 'default' }` when
 * no layer names a usable tag, which selects English as the shipped default.
 */
export function resolveHostLanguageTag(layers = {}) {
  for (const source of HOST_LANGUAGE_SOURCES) {
    const tag = normalizeInterfaceLanguageTag(layers[source]);
    if (tag !== null) return { tag, source };
  }
  return { tag: null, source: 'default' };
}
