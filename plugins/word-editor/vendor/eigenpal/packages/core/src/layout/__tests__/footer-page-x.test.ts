import { expect, test } from 'bun:test';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  WML_NAMESPACE_URI as W,
} from '../../store/package/ooxml-tree.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';

const fixed = createFixedMeasurer(6, 14);
const frame =
  '<w:framePr w:w="3000" w:h="155" w:hRule="exact" w:wrap="around" w:vAnchor="text" w:hAnchor="page" w:x="6000" w:y="-40"/>';
const field =
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';
function part(xml: string, kind = 'ftr') {
  const p = readOoxmlPart(`<w:${kind} xmlns:w="${W}">${xml}</w:${kind}>`, {
    name: kind === 'styles' ? '/word/styles.xml' : '/word/footer1.xml',
    contentType: 'application/xml',
  });
  if (!p.ok) throw Error(p.reason);
  return p.part;
}
const body = (f = frame, text = field, anchor = '') =>
  `<w:p><w:pPr><w:pStyle w:val="Framed"/>${f}</w:pPr>${text}</w:p><w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr>${anchor}</w:p>`;
function styles(extra = '', align = 'left') {
  return buildStyleCascadeTable(
    part(
      `<w:docDefaults><w:pPrDefault/></w:docDefaults><w:style w:type="paragraph" w:styleId="Footer"><w:pPr><w:jc w:val="${align}"/><w:tabs><w:tab w:val="center" w:pos="4000"/></w:tabs></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Framed"><w:basedOn w:val="Footer"/><w:pPr>${extra}</w:pPr></w:style>`,
      'styles'
    ).root
  );
}
const geometry = {
  pageNumber: 5,
  pageWidth: 700,
  pageHeight: 842,
  marginLeft: 72,
  marginRight: 72,
  marginTop: 72,
  marginBottom: 72,
};
function layout(content = body(), cascade = styles(), g = geometry, kind = 'ftr') {
  return layoutHeaderFooterStory(
    part(content, kind),
    g.pageWidth - g.marginLeft - g.marginRight,
    fixed,
    'page-x-source',
    undefined,
    cascade,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    g
  );
}
function first(story: ReturnType<typeof layout>) {
  const f = story.fragments[0];
  if (f?.kind !== 'paragraph') throw Error('paragraph required');
  return f;
}
const ink = (story: ReturnType<typeof layout>) =>
  first(story).lines[0]!.spans.find((s) => s.text.trim())!;

test('honors authored page-X without a leading tab or global centering', () => {
  const s = layout();
  expect(ink(s).box.x + geometry.marginLeft).toBe(300);
  expect(first(s).box.width).toBe(150);
  expect(ink(s).box.x + geometry.marginLeft).not.toBe(geometry.pageWidth / 2);
  expect(first(s).alignment).toBe('left');
});
test('preserves vertical metrics and natural flow for nonexact frames', () => {
  const nonexact = frame.replace('w:hRule="exact"', 'w:hRule="auto"');
  const value = layout(body(nonexact)),
    ordinary = layout(body(nonexact.replace('w:hAnchor="page"', 'w:hAnchor="text"')));
  expect(value.flowHeight).toBe(ordinary.flowHeight);
  expect(first(value).box.y).toBe(first(ordinary).box.y);
  expect(first(value).box.height).toBe(first(ordinary).box.height);
  expect(first(value).lines[0]!.baseline).toBe(first(ordinary).lines[0]!.baseline);
  expect(value.fragments[1]).toEqual(ordinary.fragments[1]);
});
test('inherits frame attributes and honors a direct page-X override', () => {
  const inherited = layout(body(''), styles(frame));
  expect(ink(inherited).box.x + 72).toBe(300);
  const direct = layout(body('<w:framePr w:x="7600"/>'), styles(frame));
  expect(ink(direct).box.x + 72).toBe(380);
  expect(first(direct).box.width).toBe(150);
});
test('uses the resolved paragraph alignment only inside the authored frame', () => {
  for (const align of ['left', 'center', 'right']) {
    const s = layout(body(), styles('', align));
    const width = ink(s).box.width;
    const inset = align === 'left' ? 0 : align === 'center' ? (150 - width) / 2 : 150 - width;
    expect(ink(s).box.x + 72).toBeCloseTo(300 + inset, 8);
  }
  const content = body().replace(
    '<w:pStyle w:val="Framed"/>',
    '<w:pStyle w:val="Framed"/><w:jc w:val="right"/>'
  );
  const s = layout(content, styles('', 'center'));
  expect(ink(s).box.x + 72 + ink(s).box.width).toBeCloseTo(450, 10);
});
test('reprojects live PAGE values and changing page margins without a stale X origin', () => {
  const s = layout();
  for (const pageNumber of [1, 12, 123]) {
    const p = s.withPageContext({ ...geometry, pageNumber });
    expect(
      first(p)
        .lines[0]!.spans.map((x) => x.text)
        .join('')
    ).toBe(String(pageNumber));
    expect(ink(p as ReturnType<typeof layout>).box.x + 72).toBe(300);
  }
  const wider = layout(body(), styles(), { ...geometry, marginLeft: 100 });
  expect(ink(wider).box.x + 100).toBe(300);
});
test('keeps default and even footer story geometry independent', () => {
  const odd = layout(body()),
    even = layout(body(frame.replace('w:x="6000"', 'w:x="9200"')));
  for (const pageNumber of [2, 5, 12]) {
    const a = odd.withPageContext({ ...geometry, pageNumber }),
      b = even.withPageContext({ ...geometry, pageNumber });
    expect(ink(a as ReturnType<typeof layout>).box.x + 72).toBe(300);
    expect(ink(b as ReturnType<typeof layout>).box.x + 72).toBe(460);
  }
});
test('preserves the existing real-tab fixed-frame lane', () => {
  const old =
    '<w:framePr w:w="5000" w:wrap="around" w:vAnchor="text" w:hAnchor="page" w:x="4000" w:yAlign="center"/>';
  const s = layout(body(old, '<w:r><w:tab/></w:r>' + field));
  expect(first(s).clipToBox).toBe(true);
  expect(first(s).box.x).toBe(128);
  expect(first(s).lines[0]!.spans[0]!.text).toBe('\t');
});
test('does not treat style tab stops as authored tab characters', () => {
  const s = layout();
  expect(first(s).lines[0]!.spans.some((x) => x.text.includes('\t'))).toBe(false);
  expect(ink(s).box.x + 72).toBe(300);
  const withTab = layout(body(frame, '<w:r><w:tab/></w:r>' + field));
  expect(first(withTab).box.x).toBe(0);
});
test('defers invalid or off-page frame coordinates without clamping', () => {
  for (const [from, to] of [
    ['w:x="6000"', 'w:x="-1"'],
    ['w:w="3000"', 'w:w="0"'],
    ['w:x="6000"', 'w:x="13000"'],
    ['w:y="-40"', 'w:y="oops"'],
    ['w:hRule="exact"', 'w:hRule="unknown"'],
    ['w:h="155"', 'w:h="-1"'],
  ]) {
    const s = layout(body(frame.replace(from!, to!)));
    expect(first(s).box.x).toBe(0);
  }
});
test('does not hijack non-PAGE fields, meaningful anchors, headers or multi-line values', () => {
  for (const content of [
    body(frame, field.replace(' PAGE ', ' NUMPAGES ')),
    body(frame, field, '<w:r><w:t>note</w:t></w:r>'),
    body(frame, field.replace('<w:t>1</w:t>', '<w:t>Page 1</w:t>')),
    body(frame.replace('w:w="3000"', 'w:w="50"')),
  ])
    expect(first(layout(content)).box.x).toBe(0);
  expect(first(layout(body(), styles(), geometry, 'hdr')).box.x).toBe(0);
});
test('defers explicit paragraph spacing and frame-alignment overrides', () => {
  const spacing = body().replace('</w:pPr>', '<w:spacing w:after="200"/></w:pPr>');
  expect(first(layout(spacing)).box.x).toBe(0);
  const xAlign = body(frame.replace('w:x="6000"', 'w:x="6000" w:xAlign="center"'));
  expect(first(layout(xAlign)).box.x).toBe(0);
});
test('never rewrites the PAGE source or removes the empty paragraph during save and reopen', () => {
  const source = part(body()),
    before = serializeOoxmlPart(source);
  const s = layoutHeaderFooterStory(
    source,
    556,
    fixed,
    'save',
    undefined,
    styles(),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    geometry
  );
  expect(s.fragments).toHaveLength(2);
  expect(first(s).paragraphId).not.toBe(
    s.fragments[1]!.kind === 'paragraph' ? s.fragments[1]!.paragraphId : ''
  );
  expect(serializeOoxmlPart(source)).toBe(before);
  const reopened = readOoxmlPart(before, { name: source.name, contentType: source.contentType });
  expect(reopened.ok).toBe(true);
  if (reopened.ok) expect(serializeOoxmlPart(reopened.part)).toBe(before);
});

function anchor(s: ReturnType<typeof layout>) {
  const a = s.fragments[1];
  if (a?.kind !== 'paragraph') throw Error('anchor required');
  return a;
}
test('exact footer frame reserves only the real empty anchor', () => {
  const s = layout();
  const ordinary = layout(body(frame.replace('w:hAnchor="page"', 'w:hAnchor="text"')));
  expect(s.flowHeight).toBe(anchor(s).box.height);
  expect(s.flowHeight).toBeCloseTo(ordinary.flowHeight / 2, 10);
  expect(anchor(s).box.y).toBe(0);
  expect(first(s).outOfFlow).toBe(true);
  expect(first(s).box.height).toBe(7.75);
  expect(first(s).clipToBox).toBe(true);
});
test('signed text-anchor y translates all geometry with no baseline compensation', () => {
  for (const y of [-400, -40, 0, 40, 400]) {
    const s = layout(body(frame.replace('w:y="-40"', `w:y="${y}"`)));
    const a = anchor(s),
      f = first(s);
    expect(f.box.y).toBe(y / 20);
    expect(f.lines[0]!.box.y).toBeCloseTo(a.lines[0]!.box.y + y / 20, 10);
    expect(ink(s).box.y).toBeCloseTo(a.lines[0]!.box.y + y / 20, 10);
    expect(f.lines[0]!.baseline).toBe(a.lines[0]!.baseline);
    expect(s.flowHeight).toBe(a.box.height);
  }
});
test('exact clipping bounds preserve the natural line metrics and authored source ranges', () => {
  const s = layout(),
    o = layout(body(frame.replace('w:hRule="exact"', 'w:hRule="auto"')));
  expect(first(s).box.height).toBe(7.75);
  expect(first(s).lines[0]!.box.height).toBe(first(o).lines[0]!.box.height);
  expect(first(s).lines[0]!.baseline).toBe(first(o).lines[0]!.baseline);
  expect(ink(s).range).toEqual(ink(o).range);
  expect(first(s).paragraphId).toBe(first(o).paragraphId);
  expect(anchor(s).paragraphId).toBe(anchor(o).paragraphId);
});
test('authored page x and local alignment survive the vertical flow correction', () => {
  for (const align of ['left', 'center', 'right']) {
    const s = layout(body(), styles('', align));
    const width = ink(s).box.width;
    const inset = align === 'left' ? 0 : align === 'center' ? (150 - width) / 2 : 150 - width;
    expect(ink(s).box.x + 72).toBeCloseTo(300 + inset, 10);
    expect(first(s).box.x).toBe(228);
    expect(s.flowHeight).toBe(anchor(s).box.height);
  }
});
test('inherited exact frame attributes and explicit y overrides remain authored', () => {
  const s = layout(body('<w:framePr w:y="60"/>'), styles(frame));
  expect(first(s).box.y).toBe(3);
  expect(first(s).clipToBox).toBe(true);
  expect(ink(s).box.x + 72).toBe(300);
});
test('regular footer and nonempty next paragraph retain ordinary flow', () => {
  for (const xml of [
    body('', field, '<w:r><w:t>text</w:t></w:r>'),
    body(frame, field, '<w:r><w:t>text</w:t></w:r>'),
  ]) {
    const s = layout(xml);
    expect(first(s).outOfFlow).not.toBe(true);
    expect(s.flowHeight).toBeGreaterThan(anchor(s).box.height);
  }
});
test('two framed paragraphs cannot masquerade as a floating frame and empty anchor', () => {
  const xml = body().replace('<w:pStyle w:val="Footer"/>', `<w:pStyle w:val="Footer"/>${frame}`);
  const s = layout(xml);
  expect(first(s).outOfFlow).not.toBe(true);
  expect(s.flowHeight).toBeGreaterThan(anchor(s).box.height);
});
test('unsupported anchors and extra wrapping attributes preserve ordinary flow', () => {
  for (const f of [
    frame.replace('w:vAnchor="text"', 'w:vAnchor="page"'),
    frame.replace('/>', ' w:hSpace="20"/>'),
  ]) {
    const s = layout(body(f));
    expect(first(s).outOfFlow).not.toBe(true);
    expect(s.flowHeight).toBeGreaterThan(anchor(s).box.height);
  }
});
test('a frame that wraps nothing takes the story frame lane at the same page x', () => {
  const s = layout(body(frame.replace('w:wrap="around"', 'w:wrap="none"')));
  expect(first(s).outOfFlow).toBe(true);
  expect(ink(s).box.x + geometry.marginLeft).toBe(300);
  expect(s.flowHeight).toBe(anchor(s).box.height);
});
test('out of bounds dimensions and signed offsets do not enter the floating lane', () => {
  for (const f of [
    frame.replace('w:h="155"', 'w:h="99999"'),
    frame.replace('w:y="-40"', 'w:y="-99999"'),
    frame.replace('w:x="6000"', 'w:x="13900"'),
  ]) {
    const s = layout(body(f));
    expect(first(s).outOfFlow).not.toBe(true);
  }
});
test('zero exact height is Word auto and is not treated as an empty clipped frame', () => {
  const s = layout(body(frame.replace('w:h="155"', 'w:h="0"')));
  expect(first(s).outOfFlow).not.toBe(true);
  expect(first(s).clipToBox).not.toBe(true);
  expect(s.flowHeight).toBeGreaterThan(anchor(s).box.height);
});
test('nonexact height rules retain the independent horizontal-only contract', () => {
  const noY = layout(body(frame.replace(' w:y="-40"', '')));
  expect(first(noY).outOfFlow).not.toBe(true);
  expect(noY.flowHeight).toBeGreaterThan(anchor(noY).box.height);
  for (const rule of ['auto', 'atLeast']) {
    const s = layout(body(frame.replace('w:hRule="exact"', `w:hRule="${rule}"`)));
    expect(first(s).outOfFlow).not.toBe(true);
    expect(first(s).clipToBox).not.toBe(true);
    expect(ink(s).box.x + 72).toBe(300);
    expect(s.flowHeight).toBeGreaterThan(anchor(s).box.height);
  }
});
test('PAGE refresh and repeated layout preserve frame source and anchor ownership', () => {
  const p = part(body());
  const before = serializeOoxmlPart(p);
  const s = layout();
  const updated = s.withPageContext({ ...geometry, pageNumber: 123 });
  expect(
    first(updated)
      .lines[0]!.spans.map((x) => x.text)
      .join('')
  ).toBe('123');
  expect(first(updated).outOfFlow).toBe(true);
  expect(first(updated).box.y).toBe(-2);
  expect(updated.flowHeight).toBe(anchor(updated).box.height);
  expect(serializeOoxmlPart(p)).toBe(before);
});
