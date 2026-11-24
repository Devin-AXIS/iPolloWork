import { expect, test } from 'bun:test';
import { applyTreeOp, readOoxmlPart, serializeOoxmlPart, type OoxmlPart } from '../index.ts';

// One change can sit in several runs or adjacent wrappers, split where another edit fell, while
// a peer holds the same change as one run. The two must decide and take typing alike.

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function part(paragraph: string): OoxmlPart {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p>${paragraph}</w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}

function paragraphOf(xml: string): string {
  return xml.slice(xml.indexOf('<w:p>') + 5, xml.indexOf('</w:p>'));
}

const deletion = (inner: string) =>
  `<w:del w:id="7" w:author="A" w:date="2026-01-01T00:00:00Z">${inner}</w:del>`;
const insertion = (inner: string) =>
  `<w:ins w:id="7" w:author="A" w:date="2026-01-01T00:00:00Z">${inner}</w:ins>`;
const REJECT = {
  op: 'rejectRevision',
  revision: { id: '7', author: 'A', date: '2026-01-01T00:00:00Z' },
  localName: 'del',
} as const;
const ACCEPT = {
  op: 'acceptRevision',
  revision: { id: '7', author: 'A', date: '2026-01-01T00:00:00Z' },
  localName: 'ins',
} as const;

function decided(paragraph: string, op: typeof REJECT | typeof ACCEPT): string {
  const result = applyTreeOp(part(paragraph), op);
  if (!result.ok || !result.part) throw new Error(result.reason);
  return paragraphOf(serializeOoxmlPart(result.part));
}

test('rejecting a deletion held as two runs or two wrappers gives one run', () => {
  const one = decided(
    `<w:r><w:t>a</w:t></w:r>${deletion('<w:r><w:delText xml:space="preserve"> d </w:delText></w:r>')}`,
    REJECT
  );
  const runs = decided(
    `<w:r><w:t>a</w:t></w:r>${deletion(
      '<w:r><w:delText xml:space="preserve"> d</w:delText></w:r>' +
        '<w:r><w:delText xml:space="preserve"> </w:delText></w:r>'
    )}`,
    REJECT
  );
  const wrappers = decided(
    `<w:r><w:t>a</w:t></w:r>${deletion('<w:r><w:delText xml:space="preserve"> d</w:delText></w:r>')}${deletion(
      '<w:r><w:delText xml:space="preserve"> </w:delText></w:r>'
    )}`,
    REJECT
  );
  expect(one).toContain('<w:t xml:space="preserve"> d </w:t>');
  expect(runs).toBe(one);
  expect(wrappers).toBe(one);
});

test('accepting an insertion joins a run that holds a break with the next run', () => {
  const one = decided(insertion('<w:r><w:t>do</w:t><w:br/><w:t>lo!</w:t></w:r>'), ACCEPT);
  const split = decided(
    insertion('<w:r><w:t>do</w:t><w:br/><w:t>lo</w:t></w:r>') +
      insertion('<w:r><w:t>!</w:t></w:r>'),
    ACCEPT
  );
  expect(split).toBe(one);
});

test('a decision does not join runs of different formats or outside the change', () => {
  const kept = decided(
    `<w:r><w:t>a</w:t></w:r>${deletion(
      '<w:r><w:delText>b</w:delText></w:r><w:r><w:rPr><w:b/></w:rPr><w:delText>c</w:delText></w:r>'
    )}<w:r><w:t>d</w:t></w:r>`,
    REJECT
  );
  expect(kept).toBe(
    '<w:r><w:t>a</w:t></w:r><w:r><w:t>b</w:t></w:r>' +
      '<w:r><w:rPr><w:b/></w:rPr><w:t>c</w:t></w:r><w:r><w:t>d</w:t></w:r>'
  );
});

test('typing between two wrappers of one insertion lands as typing inside one wrapper does', () => {
  const typed = (paragraph: string): string => {
    const source = part(paragraph);
    const paragraphId = (source.root as { children: { children: { id: string }[] }[] }).children[0]!
      .children[0]!.id;
    const result = applyTreeOp(source, { op: 'insertText', paragraphId, offset: 4, text: 'X' });
    if (!result.ok || !result.part) throw new Error(result.reason);
    // Only the wrapper boundary is not asserted: one change, in one wrapper or two.
    return paragraphOf(serializeOoxmlPart(result.part)).replace(/<\/w:ins><w:ins [^>]*>/g, '');
  };
  const controls = [
    (inner: string) => inner,
    (inner: string) => `<w:sdt><w:sdtPr/><w:sdtContent>${inner}</w:sdtContent></w:sdt>`,
  ];
  for (const [format, inControl] of ['', '<w:rPr><w:b/></w:rPr>'].flatMap((format) =>
    controls.map((control) => [format, control] as const)
  )) {
    const tail = `<w:r>${format}<w:t>ef</w:t></w:r>`;
    const one = typed(
      `<w:r><w:t>ab</w:t></w:r>${inControl(insertion(`<w:r><w:t>cd</w:t></w:r>${tail}`))}`
    );
    const wrappers = typed(
      `<w:r><w:t>ab</w:t></w:r>${inControl(insertion('<w:r><w:t>cd</w:t></w:r>') + insertion(tail))}`
    );
    // The typed text takes the format of the run before it, inside the change.
    expect(one).toContain('<w:r><w:t>cdX</w:t></w:r>');
    expect(wrappers).toBe(one);
  }
});

// An edit that removes what stood between two pieces of one change leaves one wrapper, as a
// peer shows at once. The next edit then reads one change on every replica.

type Node = { id: string; localName?: string; children?: Node[] };

function nodesNamed(source: OoxmlPart, localName: string): Node[] {
  const found: Node[] = [];
  const walk = (node: Node): void => {
    if (node.localName === localName) found.push(node);
    for (const child of node.children ?? []) walk(child);
  };
  walk(source.root as unknown as Node);
  return found;
}

function applied(source: OoxmlPart, op: Parameters<typeof applyTreeOp>[1]): OoxmlPart {
  const result = applyTreeOp(source, op);
  if (!result.ok || !result.part) throw new Error(result.reason);
  return result.part;
}

const textOf = (source: OoxmlPart): string => paragraphOf(serializeOoxmlPart(source));
const other = (tag: 'ins' | 'del', inner: string) =>
  `<w:${tag} w:id="8" w:author="B" w:date="2026-01-02T00:00:00Z">${inner}</w:${tag}>`;

test('a rejected change between two pieces of one insertion leaves one insertion to decide', () => {
  let source = part(
    `<w:r><w:t>a</w:t></w:r>${insertion('<w:r><w:t>lo</w:t></w:r>')}` +
      `${other('ins', '<w:r><w:t>X</w:t></w:r>')}${insertion('<w:r><w:t>r</w:t></w:r>')}`
  );
  source = applied(source, {
    op: 'rejectRevision',
    revision: { id: '8', author: 'B', date: '2026-01-02T00:00:00Z' },
    localName: 'ins',
  });
  expect(nodesNamed(source, 'ins')).toHaveLength(1);
  // A card decision names the site its reader sees, and reaches the whole insertion.
  const site = nodesNamed(source, 'ins')[0]!.id;
  source = applied(source, { op: 'rejectAllRevisions', siteNodeIds: [site] });
  expect(textOf(source)).toBe('<w:r><w:t>a</w:t></w:r>');
});

test('an accepted insertion that held a piece of a deletion joins it to the piece beside it', () => {
  const source = applied(
    part(
      `<w:r><w:t>t</w:t></w:r>${deletion('<w:r><w:delText>o</w:delText></w:r>')}` +
        other('ins', deletion('<w:r><w:delText>r</w:delText></w:r>'))
    ),
    {
      op: 'acceptRevision',
      revision: { id: '8', author: 'B', date: '2026-01-02T00:00:00Z' },
      localName: 'ins',
    }
  );
  expect(nodesNamed(source, 'del')).toHaveLength(1);
  expect(textOf(source)).toContain('<w:r><w:delText>or</w:delText></w:r></w:del>');
});

test('typing in a deletion that a removed link or control had split lands after all of it', () => {
  for (const removal of ['link', 'control'] as const) {
    const wrap = (inner: string) =>
      removal === 'link'
        ? `<w:hyperlink w:anchor="a">${inner}</w:hyperlink>`
        : `<w:sdt><w:sdtPr/><w:sdtContent>${inner}</w:sdtContent></w:sdt>`;
    let source = part(
      `<w:r><w:t>a</w:t></w:r>${deletion('<w:r><w:delText xml:space="preserve">the </w:delText></w:r>')}` +
        wrap(deletion('<w:r><w:delText>r</w:delText></w:r>')) +
        `${deletion('<w:r><w:delText>est</w:delText></w:r>')}<w:r><w:t>b</w:t></w:r>`
    );
    const holder = nodesNamed(source, removal === 'link' ? 'hyperlink' : 'sdt')[0]!.id;
    source = applied(
      source,
      removal === 'link'
        ? { op: 'removeHyperlink', linkId: holder }
        : { op: 'removeContentControl', controlId: holder }
    );
    expect(nodesNamed(source, 'del')).toHaveLength(1);
    source = applied(source, {
      op: 'insertText',
      paragraphId: nodesNamed(source, 'p')[0]!.id,
      offset: 4,
      text: 'X',
      revision: { author: 'C', date: '2026-01-03T00:00:00Z' },
    });
    expect(textOf(source)).toMatch(/>the rest<\/w:delText><\/w:r><\/w:del><w:ins /);
  }
});

test('a removed link between two pieces of a move leaves one move wrapper', () => {
  const move = (inner: string) =>
    `<w:moveFrom w:id="9" w:author="A" w:date="2026-01-01T00:00:00Z">${inner}</w:moveFrom>`;
  let source = part(
    `${move('<w:r><w:t>mo</w:t></w:r>')}<w:hyperlink w:anchor="a">${move('<w:r><w:t>ved</w:t></w:r>')}</w:hyperlink>`
  );
  source = applied(source, {
    op: 'removeHyperlink',
    linkId: nodesNamed(source, 'hyperlink')[0]!.id,
  });
  expect(nodesNamed(source, 'moveFrom')).toHaveLength(1);
  expect(textOf(source)).toContain(
    '<w:r><w:t>mo</w:t></w:r><w:r><w:t>ved</w:t></w:r></w:moveFrom>'
  );
});

test('a tracked deletion over two runs in a content control is one deletion there', () => {
  let source = part(
    '<w:sdt><w:sdtPr/><w:sdtContent><w:r><w:t>ab</w:t></w:r><w:r><w:t>cd</w:t></w:r>' +
      '</w:sdtContent></w:sdt>'
  );
  source = applied(source, {
    op: 'deleteText',
    paragraphId: nodesNamed(source, 'p')[0]!.id,
    start: 1,
    end: 3,
    revision: { author: 'C', date: '2026-01-03T00:00:00Z' },
  });
  expect(nodesNamed(source, 'del')).toHaveLength(1);
  expect(textOf(source)).toContain('<w:delText>bc</w:delText>');
});

test('pieces that disagree on an attribute stay apart, and one-sided attributes are kept', () => {
  const W16DU = 'http://schemas.microsoft.com/office/word/2023/wordml/word16du';
  const piece = (text: string, utc: string) =>
    `<w:del w:id="7" w:author="A" w:date="2026-01-01T00:00:00Z"${utc}><w:r><w:delText>${text}</w:delText></w:r></w:del>`;
  const unlinked = (left: string, right: string): OoxmlPart => {
    const parsed = readOoxmlPart(
      `<w:document xmlns:w="${W}" xmlns:w16du="${W16DU}"><w:body><w:p>` +
        `${piece('ab', left)}<w:hyperlink w:anchor="a">${piece('cd', right)}</w:hyperlink>` +
        '</w:p></w:body></w:document>',
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!parsed.ok) throw new Error(parsed.reason);
    return applied(parsed.part, {
      op: 'removeHyperlink',
      linkId: nodesNamed(parsed.part, 'hyperlink')[0]!.id,
    });
  };
  const utc = (value: string) => ` w16du:dateUtc="${value}"`;
  expect(
    nodesNamed(unlinked(utc('2026-01-01T01:00:00Z'), utc('2026-01-01T02:00:00Z')), 'del')
  ).toHaveLength(2);
  const oneSided = unlinked('', utc('2026-01-01T02:00:00Z'));
  expect(nodesNamed(oneSided, 'del')).toHaveLength(1);
  expect(textOf(oneSided)).toContain('dateUtc="2026-01-01T02:00:00Z"');
});
