// Whether a run's complex-script language is written in Arabic script.
//
// Some right-to-left number rules depend on the language, not only the direction: European
// digits in an Arabic run draw in the Latin face, and a slash between digits separates the
// numbers. A Hebrew run keeps its digits in the complex-script face and reads "852/20" as one
// left-to-right number, as the bidi algorithm does.

import type { OoxmlProperty } from '@docx-editor.dev/core/store';

/** Languages written in Arabic script, by primary subtag. */
const ARABIC_SCRIPT_LANGUAGES = new Set(['ar', 'fa', 'ur', 'ps', 'sd', 'ug', 'ckb', 'ks']);

/** Whether the run's effective `w:lang/@w:bidi` (cascaded into `props`) is Arabic-script. */
export function arabicScriptLanguage(props: readonly OoxmlProperty[]): boolean {
  let bidi: string | undefined;
  for (const prop of props) {
    if (prop.localName === 'lang' && prop.attributes?.bidi) bidi = prop.attributes.bidi;
  }
  return bidi !== undefined && ARABIC_SCRIPT_LANGUAGES.has(bidi.toLowerCase().split('-')[0]!);
}
