import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFontFamilyTreeCache, fontScanChildren } from '../font-family-tree-cache.ts';

function root(body: string) {
  const parsed = readOoxmlPart(
    `<w:body xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${body}</w:body>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!parsed.ok) throw new Error('Invalid fixture');
  return parsed.part.root;
}

test('editing one paragraph does not inspect thousands of unchanged font subtrees', () => {
  let inspected = 0;
  const scan = createFontFamilyTreeCache((node, context: { key: string }) => {
    inspected++;
    return {
      families: node.kind === 'paragraph' ? ['Calibri'] : [],
      children: fontScanChildren(node, context),
    };
  });
  const original = root('<w:p><w:r><w:t>text</w:t></w:r></w:p>'.repeat(3000));
  const before = scan([original], { key: 'theme' });
  expect(before).toEqual(['Calibri']);
  expect(inspected).toBeGreaterThan(3000);
  const replacement = root('<w:p><w:r><w:t>changed</w:t></w:r></w:p>').children[0]!;
  const edited = { ...original, children: [replacement, ...original.children.slice(1)] };
  inspected = 0;
  expect(scan([edited], { key: 'theme' })).toEqual(['Calibri']);
  expect(inspected).toBeLessThanOrEqual(4);
  inspected = 0;
  scan([edited], { key: 'theme' });
  expect(inspected).toBe(0);
});

test('changed font context invalidates discovery on otherwise unchanged nodes', () => {
  const scan = createFontFamilyTreeCache((node, context: { key: string }) => ({
    families: node.kind === 'paragraph' ? [context.key] : [],
    children: fontScanChildren(node, context),
  }));
  const document = root('<w:p/>');
  expect(scan([document], { key: 'Chinese Body' })).toEqual(['Chinese Body']);
  expect(scan([document], { key: 'Japanese Body' })).toEqual(['Japanese Body']);
  expect(scan([document], { key: 'Chinese Body' })).toEqual(['Chinese Body']);
});

test('small subtrees keep no entry but still answer after an edit elsewhere', () => {
  let inspected = 0;
  const scan = createFontFamilyTreeCache((node, context: { key: string }) => {
    inspected++;
    const font = node.localName === 'rFonts' ? node.attributes[0]?.value : undefined;
    return { families: font ? [font] : [], children: fontScanChildren(node, context) };
  });
  // Run properties hold only leaves, so the scan keeps no entry for them; the paragraph
  // above them keeps one.
  const styled = '<w:p><w:r><w:rPr><w:rFonts w:ascii="Gill Sans"/></w:rPr><w:t>a</w:t></w:r></w:p>';
  const original = root(styled + '<w:p><w:r><w:t>b</w:t></w:r></w:p>'.repeat(200));
  expect(scan([original], { key: 'theme' })).toEqual(['Gill Sans']);
  const replacement = root('<w:p><w:r><w:t>c</w:t></w:r></w:p>').children[0]!;
  const edited = { ...original, children: [...original.children.slice(0, -1), replacement] };
  inspected = 0;
  expect(scan([edited], { key: 'theme' })).toEqual(['Gill Sans']);
  // The edited paragraph and its root, not the 200 unchanged paragraphs.
  expect(inspected).toBeLessThanOrEqual(6);
});
