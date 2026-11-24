// Header style references to paragraph styles resolve per page, like character styles.
import { expect, test } from 'bun:test';
import { applyTreeOp, type OoxmlNode, type OoxmlPart } from '@docx-editor.dev/core/store';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import { layoutSemanticDocument, createLayoutSession } from '../semantic-layout.ts';
import { paragraphFragmentsOfBlocks } from '../semantic-record-queries.ts';
import type { SemanticLayout } from '../semantic-records.ts';
import { completeFurniture, withFurnitureLater } from '../published-story-projections.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const run = (text: string, style = '') =>
  `<w:r>${style ? `<w:rPr><w:rStyle w:val="${style}"/></w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const para = (content: string, style = '', page = false) => {
  const props = `${style ? `<w:pStyle w:val="${style}"/>` : ''}${page ? '<w:pageBreakBefore/>' : ''}`;
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${content}</w:p>`;
};
const field = (name: string, suffix = '') =>
  `<w:fldSimple w:instr=" STYLEREF ${name.replaceAll('"', '&quot;')} ${suffix}">${run('cached')}</w:fldSimple>`;

function part(xml: string, name: string) {
  const parsed = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}

const styles = buildStyleCascadeTable(
  part(
    `<w:styles xmlns:w="${W}">` +
      '<w:docDefaults><w:rPrDefault><w:rPr/></w:rPrDefault><w:pPrDefault/></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Divider"><w:name w:val="Section Divider"/><w:basedOn w:val="Normal"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Unused"><w:name w:val="Unused"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/></w:style>' +
      '<w:style w:type="character" w:styleId="Mark"><w:name w:val="Mark"/></w:style>' +
      // A character style listed first does not outrank the paragraph style of its name.
      '<w:style w:type="character" w:styleId="SharedC"><w:name w:val="Shared"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="SharedP"><w:name w:val="Shared"/></w:style>' +
      '</w:styles>',
    '/word/styles.xml'
  ).root
);
const measurer = createFixedMeasurer(5, 10);

function laidOut(body: string, header: string) {
  const main = part(
    `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`,
    '/word/document.xml'
  );
  const hdr = part(`<w:hdr xmlns:w="${W}"><w:p>${header}</w:p></w:hdr>`, '/word/header1.xml');
  const story = layoutHeaderFooterStory(hdr, 200, measurer, 'test', undefined, styles);
  const options = {
    measurer,
    styleCascade: styles,
    geometry: {
      width: 220,
      height: 200,
      margin: { top: 30, bottom: 15, left: 10, right: 10 },
      headerDistance: 5,
    },
    furniture: {
      titlePage: false,
      evenAndOddHeaders: false,
      headers: new Map([['default' as const, story]]),
      footers: new Map(),
    },
  };
  const session = createLayoutSession();
  const laid = layoutSemanticDocument(main, 1, { ...options, session });
  const warm = layoutSemanticDocument(main, 1, { ...options, session });
  expect(text(warm)).toEqual(text(laid));
  return { laid, main, options, session };
}

function headers(body: string, header: string): string[] {
  return text(laidOut(body, header).laid);
}

function text(layout: SemanticLayout): string[] {
  return layout.pages.map((page) =>
    paragraphFragmentsOfBlocks(page.header?.fragments ?? [])
      .flatMap((f) => f.lines.flatMap((l) => l.spans.map((s) => s.text)))
      .join('')
  );
}

const body =
  para(run('Intro')) +
  para(run('Alpha'), 'Heading1', true) +
  para(run('Under alpha')) +
  para(run('Page three'), '', true) +
  para(run('Gamma'), 'Heading1', true) +
  para(run('Body')) +
  para(run('Delta ') + run('mixed', 'Mark') + run(' end'), 'Heading1') +
  para(run('Divider text'), 'Divider', true) +
  para(run('Last page'));

test('a paragraph style reference takes the page, then earlier, then later text', () => {
  const header =
    field('"heading 1"') +
    run('|') +
    field('"heading 1"', '\\l') +
    run('|') +
    field('"Section Divider"') +
    run('|') +
    field('Normal');
  expect(headers(body, header)).toEqual([
    'Alpha|Alpha|Divider text|Intro',
    'Alpha|Alpha|Divider text|Under alpha',
    'Alpha|Alpha|Divider text|Page three',
    'Gamma|Delta mixed end|Divider text|Body',
    'Delta mixed end|Delta mixed end|Divider text|Last page',
  ]);
});

const pageBreak = '<w:r><w:br w:type="page"/></w:r>';
const bar = run('|');

test('empty paragraphs answer with empty text, and continued paragraphs count on each page', () => {
  const content =
    para(run('P1 text')) +
    para('') +
    para('', 'Heading2') +
    para(run('Two'), 'Heading1', true) +
    para(run('Span start') + pageBreak + run('span end')) +
    para(run('Third')) +
    para('', 'Heading1') +
    para(run('Long'), 'Heading2', true) +
    para(run('Five tail'));
  const header = [
    field('Normal', '\\l'),
    field('Normal'),
    field('"heading 1"', '\\l'),
    field('"heading 1"'),
    field('"heading 2"'),
  ].join(bar);
  expect(headers(content, header)).toEqual([
    '|P1 text|Two|Two|',
    'Span start span end|Span start span end|Two|Two|',
    'Third|Span start span end|||',
    'Five tail|Five tail|||Long',
  ]);
});

test('field results, tabs, and the paragraph style of a shared name supply the text', () => {
  const seq =
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    '<w:r><w:instrText xml:space="preserve"> SEQ chap </w:instrText></w:r>' +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    run('7') +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
  const content =
    para(run('Ch ') + seq + run(' end'), 'Heading1') +
    para(run('Tab') + '<w:r><w:tab/></w:r>' + run('bed'), 'Heading2') +
    para(run('Shared char', 'SharedC')) +
    para(pageBreak) +
    para(run('Shared para'), 'SharedP');
  const header = [
    field('"heading 1"'),
    field('"heading 2"'),
    field('Shared'),
    field('Normal', '\\l'),
  ].join(bar);
  expect(headers(content, header)).toEqual([
    'Ch 7 end|Tab\tbed|Shared para|',
    'Ch 7 end|Tab\tbed|Shared para|',
  ]);
});

test('a paragraph style that no paragraph uses keeps the cached result', () => {
  expect(headers(body, field('Unused'))).toEqual(Array(5).fill('cached'));
  expect(headers(body, field('Shared'))).toEqual(Array(5).fill('cached'));
});

test('a character style reference still matches only its runs', () => {
  expect(headers(body, field('Mark'))).toEqual(Array(5).fill('mixed'));
});

test('an edit to the referenced paragraph updates the header on a warm layout', () => {
  const f = laidOut(para(run('Title'), 'Heading1') + para(run('Body')), field('"heading 1"'));
  expect(text(f.laid)).toEqual(['Title']);
  const bodyNode = f.main.root.children.find((node) => node.kind === 'body')!;
  if (bodyNode.kind === 'textValue') throw Error('body');
  const edit = applyTreeOp(f.main, {
    op: 'insertText',
    paragraphId: bodyNode.children[0]!.id,
    offset: 5,
    text: ' edited',
  });
  expect(edit.ok).toBe(true);
  if (!edit.ok) return;
  const warm = layoutSemanticDocument(edit.part, 2, { ...f.options, session: f.session });
  const cold = layoutSemanticDocument(edit.part, 2, f.options);
  expect(text(warm)).toEqual(['Title edited']);
  expect(warm.pages).toEqual(cold.pages);
});

test('an edit that shortens a tall header settles like a fresh layout', () => {
  // Five header lines are taller than the top margin, so they push the body down.
  const long = 'A heading' + ' that wraps the header'.repeat(8);
  const filler = Array.from({ length: 40 }, (_, i) => para(run(`Body ${i}`))).join('');
  const content = para(run(long), 'Heading1') + filler;
  const f = laidOut(content, field('"heading 1"'));
  expect(f.laid.pages[0]!.header!.fragments.length).toBeGreaterThan(0);
  const bodyNode = f.main.root.children.find((node) => node.kind === 'body')!;
  if (bodyNode.kind === 'textValue') throw Error('body');
  const edit = applyTreeOp(f.main, {
    op: 'deleteText',
    paragraphId: bodyNode.children[0]!.id,
    start: 9,
    end: long.length,
  });
  expect(edit.ok).toBe(true);
  if (!edit.ok) return;
  const warm = layoutSemanticDocument(edit.part, 2, { ...f.options, session: f.session });
  const cold = layoutSemanticDocument(edit.part, 2, f.options);
  expect(text(warm).every((value) => value === 'A heading')).toBe(true);
  expect(warm.pages.length).toBe(cold.pages.length);
  expect(warm.pages).toEqual(cold.pages);
});

// Edits that move headings and wrap header results must settle as a fresh layout does, whatever
// the edit history. These seeds once diverged when a pass resumed from the previous revision.
function seeded(seed: number) {
  return () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}
const vocabulary = ['wrap', 'header', 'alpha', 'beta', 'longword'];
for (const seed of [19, 23, 33, 7]) {
  test(`random edits keep warm and fresh layouts equal: seed ${seed}`, () => {
    const random = seeded(seed);
    const words = (n: number) =>
      Array.from({ length: n }, () => vocabulary[Math.floor(random() * 5)]).join(' ');
    let content = '';
    for (let i = 0; i < 30; i += 1) {
      content +=
        random() < 0.25
          ? para(run(words(1 + Math.floor(random() * 30))), 'Heading1')
          : para(run(words(1 + Math.floor(random() * 12))));
    }
    const header = random() < 0.5 ? field('"heading 1"') : field('"heading 1"', '\\l');
    const f = laidOut(content, header);
    let doc = f.main;
    for (let step = 0; step < 12; step += 1) {
      const bodyNode = doc.root.children.find((node) => node.kind === 'body')!;
      if (bodyNode.kind === 'textValue') throw Error('body');
      const paragraphs = bodyNode.children.filter((node) => node.kind === 'paragraph');
      const target = paragraphs[Math.floor(random() * paragraphs.length)]!;
      const length = /"value":"([^"]*)"/.exec(JSON.stringify(target))?.[1]?.length ?? 0;
      const edit =
        random() < 0.5 || length < 5
          ? applyTreeOp(doc, {
              op: 'insertText',
              paragraphId: target.id,
              offset: 0,
              text: words(1 + Math.floor(random() * 25)) + ' ',
            })
          : applyTreeOp(doc, {
              op: 'deleteText',
              paragraphId: target.id,
              start: 0,
              end: Math.min(length, 1 + Math.floor(random() * length)),
            });
      if (!edit.ok) continue;
      doc = edit.part;
      const warm = layoutSemanticDocument(doc, step + 2, { ...f.options, session: f.session });
      const cold = layoutSemanticDocument(doc, step + 2, f.options);
      expect(text(warm)).toEqual(text(cold));
      expect(warm.pages).toEqual(cold.pages);
    }
  });
}

test('headers deferred during an edit complete with their style values', () => {
  const pageField = (name: string) => `<w:fldSimple w:instr=" ${name} ">${run('1')}</w:fldSimple>`;
  const content =
    para(run('Intro')) +
    para(run('Alpha'), 'Heading1', true) +
    para(run('a')) +
    para(run('Beta'), 'Heading1', true) +
    para(run('b')) +
    para(run('Gamma'), 'Heading1', true) +
    para(run('c'));
  const header =
    run('P') + pageField('PAGE') + run('/') + pageField('NUMPAGES') + bar + field('"heading 1"');
  const f = laidOut(content, header);
  const bodyNode = f.main.root.children.find((node) => node.kind === 'body')!;
  if (bodyNode.kind === 'textValue') throw Error('body');
  const edit = applyTreeOp(f.main, {
    op: 'insertText',
    paragraphId: bodyNode.children[0]!.id,
    offset: 5,
    text: ' more'.repeat(200),
  });
  expect(edit.ok).toBe(true);
  if (!edit.ok) return;
  // An editor keystroke defers the headers off the first page and completes them later.
  const deferred = withFurnitureLater(
    (page) => page > 0,
    () => layoutSemanticDocument(edit.part, 2, { ...f.options, session: f.session })
  );
  const cold = layoutSemanticDocument(edit.part, 2, f.options);
  expect(text(completeFurniture(deferred))).toEqual(text(cold));
  expect(text(cold)).toEqual(['P1/5|Alpha', 'P2/5|Alpha', 'P3/5|Alpha', 'P4/5|Beta', 'P5/5|Gamma']);
});

// A header redrawn by finalize or by deferred furniture keeps the values it shows. When a
// later edit removes every match, the saved result must come back on every page.
function paragraphsOf(doc: OoxmlPart): OoxmlNode[] {
  const bodyNode = doc.root.children.find((node) => node.kind === 'body')!;
  if (bodyNode.kind === 'textValue') throw Error('body');
  return bodyNode.children.filter((node) => node.kind === 'paragraph');
}
const numPages = `<w:fldSimple w:instr=" NUMPAGES ">${run('1')}</w:fldSimple>`;

test('removing every match after a page-count redraw restores saved results', () => {
  const content =
    para(run('Alpha', 'Mark')) +
    para(run('a')) +
    para(run('two'), '', true) +
    para(run('three'), '', true) +
    para(run('four'), '', true);
  const f = laidOut(content, run('of ') + numPages + bar + field('Mark'));
  const grown = applyTreeOp(f.main, {
    op: 'insertText',
    paragraphId: paragraphsOf(f.main).at(-1)!.id,
    offset: 4,
    text: ' x'.repeat(400),
  });
  if (!grown.ok) throw Error('grow');
  layoutSemanticDocument(grown.part, 2, { ...f.options, session: f.session });
  const cleared = applyTreeOp(grown.part, {
    op: 'deleteText',
    paragraphId: paragraphsOf(grown.part)[0]!.id,
    start: 0,
    end: 5,
  });
  if (!cleared.ok) throw Error('clear');
  const warm = layoutSemanticDocument(cleared.part, 3, { ...f.options, session: f.session });
  const cold = layoutSemanticDocument(cleared.part, 3, f.options);
  expect(text(warm)).toEqual(text(cold));
  expect(text(cold).every((value) => value.endsWith('|cached'))).toBe(true);
});

test('removing every match after deferred headers complete restores saved results', () => {
  const page = `<w:fldSimple w:instr=" PAGE ">${run('1')}</w:fldSimple>`;
  const content =
    para(run('Intro')) +
    para(run('Alpha', 'Mark'), '', true) +
    para(run('a')) +
    para(run('b'), '', true) +
    para(run('c'), '', true);
  const f = laidOut(content, run('P') + page + run('/') + numPages + bar + field('Mark'));
  const grown = applyTreeOp(f.main, {
    op: 'insertText',
    paragraphId: paragraphsOf(f.main)[0]!.id,
    offset: 5,
    text: ' more'.repeat(200),
  });
  if (!grown.ok) throw Error('grow');
  completeFurniture(
    withFurnitureLater(
      (index) => index > 0,
      () => layoutSemanticDocument(grown.part, 2, { ...f.options, session: f.session })
    )
  );
  const cleared = applyTreeOp(grown.part, {
    op: 'deleteText',
    paragraphId: paragraphsOf(grown.part)[1]!.id,
    start: 0,
    end: 5,
  });
  if (!cleared.ok) throw Error('clear');
  const warm = layoutSemanticDocument(cleared.part, 3, { ...f.options, session: f.session });
  const cold = layoutSemanticDocument(cleared.part, 3, f.options);
  expect(text(warm)).toEqual(text(cold));
  expect(text(cold).every((value) => value.endsWith('|cached'))).toBe(true);
});
