import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readOoxmlPackage, readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { buildNumberingIndex } from '../numbering-index.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';
import { openTreeSession } from '@docx-editor.dev/core/binding';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const FIXTURE = resolve(
  import.meta.dir,
  '../../../../../e2e/fixtures/comprehensive-word-element-test.docx'
);

const measurer = createFixedMeasurer(6, 14);

function loadDoc(
  body: string,
  numbering: string
): {
  part: OoxmlPart;
  numberingIndex: ReturnType<typeof buildNumberingIndex>;
} {
  const doc = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!doc.ok) throw new Error(doc.reason);
  const num = readOoxmlPart(`<w:numbering xmlns:w="${W}">${numbering}</w:numbering>`, {
    name: '/word/numbering.xml',
    contentType: 'app/xml',
  });
  if (!num.ok) throw new Error(num.reason);
  return { part: doc.part, numberingIndex: buildNumberingIndex(num.part.root) };
}

const NUM = `
  <w:abstractNum w:abstractNumId="1">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/>
      <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="○"/>
      <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="2">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>
      <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="1"/>
    <w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="2"/>
    <w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>
`;

const p = (text: string, numId: string, ilvl = '0') =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>` +
  `<w:r><w:t>${text}</w:t></w:r></w:p>`;

describe('list layout markers and indents', () => {
  test('publishes bullet marker and hanging indent geometry', () => {
    const { part, numberingIndex } = loadDoc(p('First', '1') + p('Second', '1'), NUM);
    const layout = layoutSemanticDocument(part, 1, { measurer, numberingIndex });
    const fragments = paragraphFragmentsOf(layout.pages[0]!);
    expect(fragments).toHaveLength(2);
    expect(fragments[0]!.marker?.text).toBe('•');
    expect(fragments[0]!.box.x).toBe(36); // 720 twips
    // Marker sits in the hanging slot: textLeft - hanging = 18pt.
    expect(fragments[0]!.marker!.box.x).toBe(18);
    expect(fragments[1]!.marker?.text).toBe('•');
  });

  test('multilevel bullets change glyph and indent', () => {
    const { part, numberingIndex } = loadDoc(p('L0', '1', '0') + p('L1', '1', '1'), NUM);
    const layout = layoutSemanticDocument(part, 1, { measurer, numberingIndex });
    const [a, b] = paragraphFragmentsOf(layout.pages[0]!);
    expect(a!.marker?.text).toBe('•');
    expect(a!.box.x).toBe(36);
    expect(b!.marker?.text).toBe('○');
    expect(b!.box.x).toBe(72);
  });

  test('decimal markers increment and stay outside model ranges', () => {
    const { part, numberingIndex } = loadDoc(p('One', '2') + p('Two', '2'), NUM);
    const layout = layoutSemanticDocument(part, 1, { measurer, numberingIndex });
    const [a, b] = paragraphFragmentsOf(layout.pages[0]!);
    expect(a!.marker?.text).toBe('1.');
    expect(b!.marker?.text).toBe('2.');
    expect(a!.range).toEqual({ paragraphId: a!.paragraphId, start: 0, end: 3 });
    expect(a!.lines[0]!.spans[0]!.text).toBe('One');
  });

  test('continuation fragments do not repeat the marker', () => {
    const long = 'word '.repeat(40).trim(); // wraps on a small page
    const { part, numberingIndex } = loadDoc(p(long, '1'), NUM);
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      numberingIndex,
      geometry: {
        width: 200,
        height: 80,
        margin: { top: 10, right: 10, bottom: 10, left: 10 },
      },
    });
    const fragments = layout.pages.flatMap((page) => paragraphFragmentsOf(page));
    expect(fragments.length).toBeGreaterThan(1);
    expect(fragments[0]!.marker?.text).toBe('•');
    for (const fragment of fragments.slice(1)) {
      expect(fragment.marker).toBeUndefined();
    }
  });

  test('two numIds sharing one abstractNum without overrides count as one list', () => {
    const numbering = `
      <w:abstractNum w:abstractNumId="9">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>
          <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
      </w:abstractNum>
      <w:num w:numId="10"><w:abstractNumId w:val="9"/></w:num>
      <w:num w:numId="11"><w:abstractNumId w:val="9"/></w:num>
    `;
    const body = p('A', '10') + p('B', '10') + p('C', '11') + p('D', '11') + p('E', '10');
    const { part, numberingIndex } = loadDoc(body, numbering);
    const layout = layoutSemanticDocument(part, 1, { measurer, numberingIndex });
    const markers = paragraphFragmentsOf(layout.pages[0]!).map((f) => f.marker?.text);
    expect(markers).toEqual(['1.', '2.', '3.', '4.', '5.']);
  });
});

describe('comprehensive fixture sections 4.1–4.3', () => {
  test('marker texts and indent geometry match Word Online expectations', () => {
    const bytes = new Uint8Array(readFileSync(FIXTURE));
    const loaded = readOoxmlPackage(bytes);
    if (!loaded.ok) throw new Error(loaded.reason);
    const numbering = loaded.package.parts.get('/word/numbering.xml');
    const styles = loaded.package.parts.get('/word/styles.xml');
    const main = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const numberingIndex = buildNumberingIndex(numbering?.root ?? null);
    const styleCascade = buildStyleCascadeTable(styles?.root ?? null);
    const layout = layoutSemanticDocument(main, 1, {
      measurer,
      numberingIndex,
      styleCascade,
    });

    const byText = new Map<string, ReturnType<typeof paragraphFragmentsOf>[number]>();
    for (const page of layout.pages) {
      for (const fragment of paragraphFragmentsOf(page)) {
        const text = fragment.lines.map((l) => l.spans.map((s) => s.text).join('')).join('');
        if (text && !byText.has(text)) byText.set(text, fragment);
      }
    }

    // 4.1 simple bullets
    expect(byText.get('First bullet item')?.marker?.text).toBe('•');
    expect(byText.get('First bullet item')?.box.x).toBe(36);
    expect(byText.get('Second bullet item with longer text to test wrapping')?.marker?.text).toBe(
      '•'
    );

    // 4.2 multilevel
    expect(byText.get('Level 0: Main category')?.marker?.text).toBe('•');
    expect(byText.get('Level 0: Main category')?.box.x).toBe(36);
    expect(byText.get('Level 1: Sub-category')?.marker?.text).toBe('○');
    expect(byText.get('Level 1: Sub-category')?.box.x).toBe(72);
    expect(byText.get('Level 2: Detail')?.marker?.text).toBe('▪');
    expect(byText.get('Level 2: Detail')?.box.x).toBe(108);
    expect(byText.get('Level 3: Deepest')?.marker?.text).toBe('–');
    expect(byText.get('Level 3: Deepest')?.box.x).toBe(144);

    // 4.3 numbered
    expect(byText.get('First numbered item')?.marker?.text).toBe('1.');
    expect(byText.get('Second numbered item')?.marker?.text).toBe('2.');
    expect(byText.get('Sub-item (lower-alpha)')?.marker?.text).toBe('a)');
    expect(byText.get('Another sub-item')?.marker?.text).toBe('b)');
    expect(byText.get('Sub-sub-item (lower-roman)')?.marker?.text).toBe('i.');
    expect(byText.get('Third numbered item')?.marker?.text).toBe('3.');

    expect(byText.get('Introduction')?.marker?.text).toBe('I.');
    expect(byText.get('Analysis')?.marker?.text).toBe('II.');
    expect(byText.get('Discussion')?.marker?.text).toBe('III.');
    expect(byText.get('Conclusions')?.marker?.text).toBe('IV.');

    expect(byText.get('Option Alpha')?.marker?.text).toBe('A.');
    expect(byText.get('Option Bravo')?.marker?.text).toBe('B.');
    expect(byText.get('Option Charlie')?.marker?.text).toBe('C.');

    expect(byText.get('Restarts at 1')?.marker?.text).toBe('1.');
    expect(byText.get('Continues to 2')?.marker?.text).toBe('2.');
    expect(byText.get('And 3')?.marker?.text).toBe('3.');
  });

  test('table cell list items continue the body numId=2 stream when walked', () => {
    const bytes = new Uint8Array(readFileSync(FIXTURE));
    const loaded = readOoxmlPackage(bytes);
    if (!loaded.ok) throw new Error(loaded.reason);
    const numbering = loaded.package.parts.get('/word/numbering.xml');
    const styles = loaded.package.parts.get('/word/styles.xml');
    const main = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const layout = layoutSemanticDocument(main, 1, {
      measurer,
      numberingIndex: buildNumberingIndex(numbering?.root ?? null),
      styleCascade: buildStyleCascadeTable(styles?.root ?? null),
    });
    const byText = new Map<string, string | undefined>();
    for (const page of layout.pages) {
      for (const fragment of paragraphFragmentsOf(page, true)) {
        const text = fragment.lines.map((l) => l.spans.map((s) => s.text).join('')).join('');
        if (text) byText.set(text, fragment.marker?.text);
      }
    }
    // Same bullet num instance — markers remain bullets (not renumbered as 1.).
    expect(byText.get('Item Alpha')).toBe('•');
    expect(byText.get('Item Beta')).toBe('•');
    expect(byText.get('Item Gamma')).toBe('•');
  });

  test('save output preserves numbering.xml and paragraph text without marker injection', () => {
    const bytes = new Uint8Array(readFileSync(FIXTURE));
    const opened = openTreeSession(bytes);
    if (!opened.ok) throw new Error(opened.reason);
    const before = opened.session.bodyText();
    const saved = opened.session.save();
    const reopened = openTreeSession(saved);
    if (!reopened.ok) throw new Error(reopened.reason);
    expect(reopened.session.bodyText()).toBe(before);
    expect(reopened.session.numberingRoot()).not.toBeNull();
    // Markers must not appear in canonical body text.
    expect(before.includes('First bullet item')).toBe(true);
    expect(before.startsWith('•')).toBe(false);
  });
});
