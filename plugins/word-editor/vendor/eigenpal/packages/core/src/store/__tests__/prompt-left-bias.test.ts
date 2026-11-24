import { expect, test } from 'bun:test';
import {
  applyTreeOp,
  contentControlsIn,
  paragraphTextOf,
  readOoxmlPart,
  serializeOoxmlPart,
  storyParagraphs,
} from '../index.ts';
import type { InsertTextOp } from '../store/text-edit-op-types.ts';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const run = (text: string) => `<w:r><w:t>${text}</w:t></w:r>`;
const prompt = (lock = '') =>
  `<w:sdt><w:sdtPr><w:showingPlcHdr/>${lock ? `<w:lock w:val="${lock}"/>` : ''}</w:sdtPr><w:sdtContent>${run('Prompt')}</w:sdtContent></w:sdt>`;
function setup(body: string) {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p>${body}</w:p></w:body></w:document>`,
    {
      name: '/word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const bodyNode = parsed.part.root.children.find((node) => node.kind === 'body')!;
  const paragraph = storyParagraphs(bodyNode)[0]!;
  return { part: parsed.part, paragraph };
}
for (const prefix of [
  '',
  run('A'),
  '<w:del w:id="1" w:author="Bob"><w:r><w:delText>A</w:delText></w:r></w:del>',
]) {
  test(`explicit left bias keeps a leading prompt with prefix ${prefix}`, () => {
    const { part, paragraph } = setup(prefix + prompt());
    const result = applyTreeOp(part, {
      op: 'insertText',
      paragraphId: paragraph.id,
      offset: prefix ? 1 : 0,
      text: 'XY',
      bias: 'left',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(paragraphTextOf(result.part, paragraph.id)).toBe(`${prefix ? 'A' : ''}XYPrompt`);
    expect(serializeOoxmlPart(result.part)).toContain('showingPlcHdr');
    expect(serializeOoxmlPart(result.part)).not.toContain('<w:delText>XY');
  });
}
for (const bias of [undefined, 'right'] as const) {
  test(`ordinary or right-biased insertion still fills the prompt (${bias})`, () => {
    const { part, paragraph } = setup(run('A') + prompt());
    const result = applyTreeOp(part, {
      op: 'insertText',
      paragraphId: paragraph.id,
      offset: 1,
      text: 'XY',
      ...(bias ? { bias } : {}),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(paragraphTextOf(result.part, paragraph.id)).toBe('AXY');
    expect(serializeOoxmlPart(result.part)).not.toContain('showingPlcHdr');
  });
}
test('a named owner still fills its prompt despite explicit left bias', () => {
  const { part, paragraph } = setup(run('A') + prompt());
  const inside = contentControlsIn(part.root)[0]!.node.id;
  const op: InsertTextOp = {
    op: 'insertText',
    paragraphId: paragraph.id,
    offset: 1,
    text: 'XY',
    bias: 'left',
    inside,
  };
  const result = applyTreeOp(part, op);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(paragraphTextOf(result.part, paragraph.id)).toBe('AXY');
  expect(serializeOoxmlPart(result.part)).not.toContain('showingPlcHdr');
});
test('left bias preserves the next locked prompt without editing its content', () => {
  const { part, paragraph } = setup(run('A') + prompt('contentLocked'));
  const result = applyTreeOp(part, {
    op: 'insertText',
    paragraphId: paragraph.id,
    offset: 1,
    text: 'XY',
    bias: 'left',
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(paragraphTextOf(result.part, paragraph.id)).toBe('AXYPrompt');
});
test('left bias cannot escape an enclosing locked control', () => {
  const { part, paragraph } = setup(
    `<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>${run('A')}${prompt()}</w:sdtContent></w:sdt>`
  );
  const result = applyTreeOp(part, {
    op: 'insertText',
    paragraphId: paragraph.id,
    offset: 1,
    text: 'XY',
    bias: 'left',
  });
  expect(result.ok).toBe(false);
});

test('omitted bias retains the preceding run and its text leaf at an ordinary boundary', () => {
  const { part, paragraph } = setup(
    '<w:r><w:rPr><w:b/></w:rPr><w:t>Alpha</w:t></w:r>' + run('Beta')
  );
  const result = applyTreeOp(part, {
    op: 'insertText',
    paragraphId: paragraph.id,
    offset: 5,
    text: '!',
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(serializeOoxmlPart(result.part)).toContain('<w:t>Alpha!</w:t>');
});

for (const op of ['insertTab', 'insertHardBreak', 'insertPageBreak'] as const) {
  test(`${op} validates bias and respects enclosing locks`, () => {
    const { part, paragraph } = setup(run('A') + prompt('contentLocked'));
    const outside = applyTreeOp(part, { op, paragraphId: paragraph.id, offset: 1, bias: 'left' });
    expect(outside.ok).toBe(true);
    if (outside.ok) expect(serializeOoxmlPart(outside.part)).toContain('showingPlcHdr');
    const inside = applyTreeOp(part, { op, paragraphId: paragraph.id, offset: 2, bias: 'right' });
    expect(inside.ok).toBe(false);
    const invalid = applyTreeOp(part, {
      op,
      paragraphId: paragraph.id,
      offset: 1,
      bias: 'bad' as 'left',
    });
    expect(invalid.ok).toBe(false);
  });
}
