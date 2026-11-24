// How a distributed paragraph (`w:jc w:val="distribute"`) spreads the slack of its lines.
//
// The document decides it once: the styles part's `w:rPrDefault` and the compatibility mode.
// The style cascade carries the answer as `StyleCascadeTable.distributedSpacing`, and
// `paragraph-alignment.ts` reads it for each distributed paragraph.
import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { omittedDocDefaults } from '../store/package/application-doc-defaults.ts';
import { WML_NAMESPACE_URI } from '../store/package/ooxml-tree.ts';
import type { CompatibilityProfile } from './compatibility/compatibility-profile.ts';

/**
 * How a distributed line spreads its slack:
 *
 * - `'spaces'`: over its spaces, or by East Asian character rules. A line with nothing to
 *   stretch is centered.
 * - `'characters'`: each space first takes up to 45 percent of its own advance, and the rest
 *   goes in equal steps after every character. A run with pair kerning on keeps its letters
 *   together and stretches only at its spaces and East Asian characters.
 * - `'legacyCharacters'`: as `'characters'`, but a space first takes up to its face's average
 *   character width less its own advance, and kerned runs spread too.
 */
export type DistributedSpacing = 'spaces' | 'characters' | 'legacyCharacters';

/**
 * The {@link DistributedSpacing} a document selects, or undefined for `'spaces'`. A legacy
 * compatibility mode (`distributedLinesSpreadCharacters`) spreads characters whatever the
 * defaults. A modern mode spreads characters when the styles part authors a `w:rPrDefault`,
 * even an empty one.
 */
export function readDistributedSpacing(
  stylesRoot: OoxmlElement | null,
  compatibility: CompatibilityProfile
): 'characters' | 'legacyCharacters' | undefined {
  if (compatibility.has('distributedLinesSpreadCharacters')) return 'legacyCharacters';
  // A root outside the WordprocessingML namespace is not a styles part and authors nothing.
  if (!stylesRoot || stylesRoot.namespaceUri !== WML_NAMESPACE_URI) return undefined;
  return omittedDocDefaults(stylesRoot).run ? undefined : 'characters';
}
