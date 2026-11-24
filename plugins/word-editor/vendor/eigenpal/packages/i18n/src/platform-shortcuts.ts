// Shortcut text, written the way the reader's keyboard is labelled.
//
// The catalogue states one spelling per shortcut, and it has to be the Windows/Linux one:
// a translator writes text, not a platform matrix, and a key that carried both spellings
// would have to be split in every locale. So the platform difference is applied HERE, once,
// at the point the resolved string is rendered — not in the catalogue and not per control.
//
// The modifier NAMES change, never the chord: the engine's keymap treats Ctrl and Cmd as one
// accelerator (`event.metaKey || event.ctrlKey`), so a Mac reader pressing ⌘ and a Windows
// reader pressing Ctrl reach the same command. Only the label was lying.

/** Apple platforms label the accelerator ⌘ and the alternate key Option. */
const APPLE_PLATFORM = /mac|iphone|ipad|ipod/i;

/**
 * Whether this browser is running on an Apple platform.
 *
 * `userAgentData.platform` first — it is the un-deprecated answer and is not frozen the way
 * `navigator.platform` is. Both are absent under SSR and in a bare test environment, where
 * the answer is `false` and the Windows spelling renders: a shortcut that reads "Ctrl+C" on
 * a Mac is wrong, and one that reads "⌘C" in a server render that then hydrates on Windows
 * is worse, because it is wrong AND it flickers.
 *
 * @public
 */
export function isApplePlatform(): boolean {
  // The package has no DOM lib, because it also runs on servers. These are the two fields
  // it reads.
  const agent = (
    globalThis as {
      readonly navigator?: {
        readonly platform?: string;
        readonly userAgentData?: { readonly platform?: string };
      };
    }
  ).navigator;
  if (!agent) return false;
  const declared = agent.userAgentData?.platform;
  if (typeof declared === 'string' && declared.length > 0) return APPLE_PLATFORM.test(declared);
  return APPLE_PLATFORM.test(agent.platform ?? '');
}

/**
 * The accelerator, in the spelling this catalogue is written in.
 *
 * Its presence is what licenses the whole rewrite. A locale that translates the accelerator
 * — German writes `Strg+Alt+C` — is left alone entirely rather than half-converted into
 * `Strg+Option+C`, which is wrong in both halves. Nothing here can tell whether an
 * untranslated `Alt` in such a string is a modifier or a word.
 */
const ACCELERATOR = /Ctrl(?=\s*\+)/;

/**
 * The Mac spelling: `Ctrl` is ⌘, `Alt` is Option.
 *
 * Each pattern requires the modifier to be JOINED TO A CHORD by `+`, which is what makes
 * this safe to run over an arbitrary label. A bare word is left alone: English
 * `formattingBar.altText` is "Alt text" and Turkish `formattingBar.subscript` is "Alt
 * simge", and rewriting either would put "Option" in an `aria-label`. Turkish is the case
 * that proves a word boundary is not enough on its own — `\b` treats the dotless `ı` as a
 * non-word character, so `/\bAlt\b/` matches inside "Altı çizili" ("underlined").
 */
// The GLYPH for Command and the WORD for Option, separators kept, is not a slip. ⌘ is on the
// keycap and reads instantly; ⌥ is on the same keycap as the word Option and reads as neither
// unless you already know it. A tidier "⌘⌥C" is a string the reader has to decode, and this
// is an `aria-label` as well as a tooltip.
const APPLE_MODIFIERS: readonly (readonly [RegExp, string])[] = [
  [/Ctrl(?=\s*\+)/g, '⌘'],
  [/Alt(?=\s*\+)/g, 'Option'],
];

/**
 * Rewrite the modifier names in a resolved label for this platform.
 *
 * A no-op everywhere except Apple platforms, and a no-op there too for a string that names
 * no chord — so it is safe to run over every label, including the ones that are not
 * shortcuts at all (a control's plain name passes through untouched).
 *
 * @public
 */
export function platformShortcut(text: string): string {
  if (!ACCELERATOR.test(text) || !isApplePlatform()) return text;
  let next = text;
  for (const [pattern, replacement] of APPLE_MODIFIERS) next = next.replace(pattern, replacement);
  return next;
}
