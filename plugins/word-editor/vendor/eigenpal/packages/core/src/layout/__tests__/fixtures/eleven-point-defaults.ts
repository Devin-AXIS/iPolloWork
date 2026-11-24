// The `w:sz="22"` docDefaults that layout fixtures measure against.
//
// `createFixedMeasurer(6, 14)` documents its base width and height as describing an 11pt run,
// while `DEFAULT_RUN_STYLE.fontSizePt` is 10 — Word's terminal fallback when no level of the
// style hierarchy authors `w:sz` at all. Both are correct: 11pt is what modern Normal
// templates author, and a document that authors nothing really does land on 10pt.
//
// A fixture that authors no size therefore measures every box at 10/11 of the round numbers
// the assertions were written for. Rather than restate that ratio in each expectation, these
// fixtures carry the docDefaults a real document carries, so an unstyled run is 11pt and one
// line is exactly `lineHeight`. An explicit empty paragraph default keeps this
// geometry fixture independent of application-defined omitted spacing.

import { readOoxmlPart } from '../../../store/package/ooxml-tree.ts';
import { buildStyleCascadeTable } from '../../style-cascade.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** Eleven-point runs with explicit single-line, zero-gap paragraph defaults. */
export function elevenPointDefaults(): ReturnType<typeof buildStyleCascadeTable> {
  const styles = readOoxmlPart(
    `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>` +
      '<w:sz w:val="22"/>' +
      '</w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults></w:styles>',
    { name: '/word/styles.xml', contentType: 'app/xml' }
  );
  if (!styles.ok) throw new Error(styles.reason);
  return buildStyleCascadeTable(styles.part.root);
}
