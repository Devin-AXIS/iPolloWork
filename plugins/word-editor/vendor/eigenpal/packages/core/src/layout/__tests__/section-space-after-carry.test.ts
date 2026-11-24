import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/index.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const geometry =
  '<w:pgSz w:w="4000" w:h="4000"/><w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200"/>';
const source = (after: number) => {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>
    <w:p><w:pPr><w:spacing w:after="${after * 20}"/><w:sectPr>${geometry}</w:sectPr></w:pPr><w:r><w:t>Previous section</w:t></w:r></w:p>
    <w:p><w:pPr><w:spacing w:before="360"/></w:pPr><w:r><w:t>Heading</w:t></w:r></w:p>
    <w:sectPr>${geometry}</w:sectPr></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
};

test('a new-page section collapses before against the previous after without carrying its cursor', () => {
  const session = createLayoutSession();
  const options = { measurer: createFixedMeasurer(6, 14) };
  for (const [revision, after] of [8, 14, 24, 0].entries()) {
    const part = source(after);
    const before = serializeOoxmlPart(part);
    const warm = layoutSemanticDocument(part, revision, { ...options, session });
    const cold = layoutSemanticDocument(part, revision, options);
    expect(warm.pages).toEqual(cold.pages);
    expect(warm.pages).toHaveLength(2);
    const heading = paragraphFragmentsOf(warm.pages[1]!)[0]!;
    expect(heading.spacing.before).toBe(Math.max(0, 18 - after));
    expect(heading.lines[0]!.box.y).toBe(Math.max(0, 18 - after));
    expect(serializeOoxmlPart(part)).toBe(before);
  }
});
