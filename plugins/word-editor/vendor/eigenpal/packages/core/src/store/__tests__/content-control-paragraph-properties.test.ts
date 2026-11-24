import { expect, test } from 'bun:test';
import { bodyStoryRoot, readOoxmlPart, storyParagraphs } from '../index.ts';
import { applyTreeOp } from '../store/tree-op-apply.ts';
import { directParagraphProperties } from '../store/direct-properties.ts';
import { formsProtectionRefusal } from '../store/tree-op-content-controls.ts';
import { ADA, apply, part, xml } from './tracked-edit-fixture.ts';

const BOB = { author: 'Bob', date: '2026-01-03T03:04:05Z' };

const run = '<w:r><w:t>LOCKED</w:t></w:r>';
const control = (inner: string) =>
  '<w:sdt><w:sdtPr><w:tag w:val="field"/><w:lock w:val="contentLocked"/></w:sdtPr>' +
  `<w:sdtContent>${inner}</w:sdtContent></w:sdt>`;
const properties = '<w:pPr><w:pStyle w:val="BodyText"/><w:ind w:left="240"/></w:pPr>';

for (const block of [false, true]) {
  for (const tracked of [false, true]) {
    test(`${block ? 'block' : 'inline'} content lock permits ${tracked ? 'tracked' : 'plain'} alignment`, () => {
      const paragraph = `<w:p>${properties}${block ? run : control(run)}</w:p>`;
      const before = part(block ? control(paragraph) : paragraph);
      const id = storyParagraphs(bodyStoryRoot(before)!)[0]!.id;
      const after = apply(before, {
        op: 'setParagraphProperties',
        paragraphId: id,
        properties: [
          ...directParagraphProperties(before, id),
          { localName: 'jc', attributes: { val: 'center' } },
        ],
        ...(tracked ? { revision: ADA } : {}),
      });
      const saved = xml(after);
      expect(saved).toContain('<w:jc w:val="center"/>');
      expect(saved).toContain('<w:ind w:left="240"/>');
      expect(saved).toContain('<w:pStyle w:val="BodyText"/>');
      expect(saved).toContain('<w:lock w:val="contentLocked"/>');
      expect(saved).toContain(run);
      expect(saved.includes('<w:pPrChange ')).toBe(tracked);
      const reopened = part(saved.replace(/^.*?<w:body>/s, '').replace(/<\/w:body>.*$/s, ''));
      expect(xml(reopened)).toBe(saved);
      if (tracked) {
        const accepted = xml(apply(after, { op: 'acceptAllRevisions' }));
        expect(accepted).toContain('<w:jc w:val="center"/>');
        expect(accepted).not.toContain('<w:pPrChange');
        const rejected = xml(apply(after, { op: 'rejectAllRevisions' }));
        expect(rejected).toBe(xml(before));
        const revision = /<w:pPrChange [^>]*w:id="([^"]+)"/.exec(saved)![1]!;
        expect(
          xml(apply(after, { op: 'rejectRevision', revision: { id: revision, ...ADA } }))
        ).toBe(xml(before));
      }
    });
  }
}

test('the same content lock still refuses character formatting', () => {
  const before = part(`<w:p>${control(run)}</w:p>`);
  const id = storyParagraphs(bodyStoryRoot(before)!)[0]!.id;
  expect(
    applyTreeOp(before, {
      op: 'setRunProperties',
      paragraphId: id,
      start: 0,
      end: 6,
      properties: [{ localName: 'b' }],
    })
  ).toMatchObject({ ok: false, reason: 'locked' });
});

test('alignment preserves numbering, paragraph mark, section properties, and foreign XML', () => {
  const prior =
    '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr>' +
    '<w:ind w:left="240"/><x:jc xmlns:x="urn:test:extension" x:val="keep"/>' +
    '<w:rPr><w:b/></w:rPr><w:sectPr><w:cols w:num="2"/></w:sectPr></w:pPr>';
  const before = part(control(`<w:p>${prior}${run}</w:p>`));
  const id = storyParagraphs(bodyStoryRoot(before)!)[0]!.id;
  const after = apply(before, {
    op: 'setParagraphProperties',
    paragraphId: id,
    properties: [
      ...directParagraphProperties(before, id),
      { localName: 'jc', attributes: { val: 'right' } },
    ],
    revision: ADA,
  });
  expect(xml(after)).toContain('<w:jc w:val="right"/>');
  expect(xml(after)).toContain('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr>');
  expect(xml(after)).toContain('<w:rPr><w:b/></w:rPr>');
  expect(xml(after)).toContain('<w:sectPr><w:cols w:num="2"/></w:sectPr>');
  expect(xml(after)).toContain('<x:jc xmlns:x="urn:test:extension" x:val="keep"/>');
  expect(xml(apply(after, { op: 'rejectAllRevisions' }))).toBe(xml(before));
});

test('removing direct alignment keeps the other paragraph properties', () => {
  const before = part(
    control(`<w:p><w:pPr><w:ind w:left="240"/><w:jc w:val="right"/></w:pPr>${run}</w:p>`)
  );
  const id = storyParagraphs(bodyStoryRoot(before)!)[0]!.id;
  const after = apply(before, {
    op: 'setParagraphProperties',
    paragraphId: id,
    properties: directParagraphProperties(before, id).filter(
      (property) => property.localName !== 'jc'
    ),
    revision: ADA,
  });
  expect(xml(apply(after, { op: 'acceptAllRevisions' }))).not.toContain('<w:jc');
  expect(xml(apply(after, { op: 'rejectAllRevisions' }))).toBe(xml(before));
});

for (const lock of ['contentLocked', 'sdtContentLocked']) {
  test(`nested ${lock} permits placement properties and keeps style, list, and direction`, () => {
    const before = part(
      control(control(`<w:p>${properties}${run}</w:p>`)).replaceAll('contentLocked', lock)
    );
    const id = storyParagraphs(bodyStoryRoot(before)!)[0]!.id;
    const kept = directParagraphProperties(before, id);
    for (const allowed of [
      [...kept, { localName: 'jc', attributes: { val: 'center' } }],
      [...kept, { localName: 'spacing', attributes: { before: '120', line: '360' } }],
      [
        ...kept.filter((property) => property.localName !== 'ind'),
        { localName: 'ind', attributes: { left: '480', right: '120', firstLine: '240' } },
      ],
      [
        ...kept,
        { localName: 'keepNext' },
        { localName: 'keepLines' },
        { localName: 'pageBreakBefore' },
        { localName: 'widowControl', attributes: { val: '0' } },
      ],
    ]) {
      expect(
        applyTreeOp(before, { op: 'setParagraphProperties', paragraphId: id, properties: allowed })
          .ok
      ).toBe(true);
    }
    for (const changed of [
      // Dropping the style along with the indent.
      [{ localName: 'jc', attributes: { val: 'center' } }],
      [
        ...kept.filter((property) => property.localName !== 'pStyle'),
        { localName: 'pStyle', attributes: { val: 'Quote' } },
      ],
      [...kept, { localName: 'bidi' }],
      [...kept, { localName: 'contextualSpacing' }],
      [...kept, { localName: 'numPr', attributes: {} }],
    ]) {
      expect(
        applyTreeOp(before, {
          op: 'setParagraphProperties',
          paragraphId: id,
          properties: changed,
        })
      ).toMatchObject({ ok: false, reason: 'locked' });
    }
    expect(
      applyTreeOp(before, {
        op: 'insertText',
        paragraphId: id,
        offset: 1,
        text: 'X',
      })
    ).toMatchObject({ ok: false, reason: 'locked' });
    expect(xml(before)).toContain('<w:t>LOCKED</w:t>');
  });
}

test('alignment does not relax forms protection', () => {
  const op = {
    op: 'setParagraphProperties' as const,
    properties: [{ localName: 'jc', attributes: { val: 'center' } }],
  };
  const settings = readOoxmlPart(
    '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:documentProtection w:edit="forms" w:enforcement="1"/></w:settings>',
    {
      name: '/word/settings.xml',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml',
    }
  );
  if (!settings.ok) throw Error(settings.reason);
  // Paragraph formatting reaches outside an inline field, so forms protection still refuses it.
  const inline = part(`<w:p>${control(run)}</w:p><w:sectPr/>`);
  expect(
    formsProtectionRefusal(inline, settings.part, {
      ...op,
      paragraphId: storyParagraphs(bodyStoryRoot(inline)!)[0]!.id,
    })
  ).toBe('locked');
});

test('rejecting a pending indent and spacing change passes a content lock', () => {
  const before = part(
    control(
      '<w:p><w:pPr><w:spacing w:before="240"/><w:ind w:left="480"/>' +
        '<w:pPrChange w:id="7" w:author="Ada"><w:pPr><w:ind w:left="240"/></w:pPr></w:pPrChange>' +
        `</w:pPr>${run}</w:p>`
    )
  );
  const rejected = xml(apply(before, { op: 'rejectAllRevisions' }));
  expect(rejected).toContain('<w:pPr><w:ind w:left="240"/></w:pPr>');
  expect(rejected).not.toContain('<w:pPrChange');
  expect(rejected).toContain(run);
});

test('rejecting a pending style change still meets a content lock', () => {
  const before = part(
    control(
      '<w:p><w:pPr><w:pStyle w:val="Quote"/><w:ind w:left="480"/>' +
        '<w:pPrChange w:id="7" w:author="Ada"><w:pPr><w:pStyle w:val="BodyText"/>' +
        `<w:ind w:left="240"/></w:pPr></w:pPrChange></w:pPr>${run}</w:p>`
    )
  );
  expect(applyTreeOp(before, { op: 'rejectAllRevisions' })).toMatchObject({
    ok: false,
    reason: 'locked',
  });
  expect(xml(before)).toContain('<w:ind w:left="480"/>');
});

test('tracked placement in a lock records one change that accepts and rejects', () => {
  const before = part(control(`<w:p>${properties}${run}</w:p>`));
  const id = storyParagraphs(bodyStoryRoot(before)!)[0]!.id;
  const indented = apply(before, {
    op: 'setParagraphProperties',
    paragraphId: id,
    properties: [
      ...directParagraphProperties(before, id).filter((property) => property.localName !== 'ind'),
      { localName: 'ind', attributes: { left: '720' } },
    ],
    revision: ADA,
  });
  const after = apply(indented, {
    op: 'setParagraphProperties',
    paragraphId: id,
    properties: [
      ...directParagraphProperties(indented, id),
      { localName: 'spacing', attributes: { before: '240' } },
      { localName: 'keepNext' },
    ],
    revision: ADA,
  });
  const saved = xml(after);
  expect(saved.match(/<w:pPrChange /g)?.length).toBe(1);
  expect(saved).toContain(
    '><w:pPr><w:pStyle w:val="BodyText"/><w:ind w:left="240"/></w:pPr></w:pPrChange>'
  );
  const reopened = part(saved.replace(/^.*?<w:body>/s, '').replace(/<\/w:body>.*$/s, ''));
  expect(xml(reopened)).toBe(saved);
  const accepted = xml(apply(after, { op: 'acceptAllRevisions' }));
  expect(accepted).toContain('<w:keepNext/>');
  expect(accepted).toContain('<w:ind w:left="720"/>');
  expect(accepted).not.toContain('<w:pPrChange');
  expect(xml(apply(after, { op: 'rejectAllRevisions' }))).toBe(xml(before));
});

test('tracked alignment refuses to merge into a pending change that records a style', () => {
  const before = part(
    control(
      '<w:p><w:pPr><w:pStyle w:val="Quote"/>' +
        '<w:pPrChange w:id="7" w:author="Ada"><w:pPr><w:pStyle w:val="BodyText"/></w:pPr>' +
        `</w:pPrChange></w:pPr>${run}</w:p>`
    )
  );
  const id = storyParagraphs(bodyStoryRoot(before)!)[0]!.id;
  const op = {
    op: 'setParagraphProperties' as const,
    paragraphId: id,
    properties: [
      ...directParagraphProperties(before, id),
      { localName: 'jc', attributes: { val: 'center' } },
    ],
  };
  // The merged revision would also record the style, and the lock would refuse to reject it.
  expect(applyTreeOp(before, { ...op, revision: BOB })).toMatchObject({
    ok: false,
    reason: 'locked',
  });
  const plain = xml(apply(before, op));
  expect(plain).toContain('<w:jc w:val="center"/>');
  expect(plain).toContain(
    '<w:pPrChange w:author="Ada" w:id="7"><w:pPr><w:pStyle w:val="BodyText"/></w:pPr></w:pPrChange>'
  );
});

test('tracked alignment merges into a pending change that records only alignment', () => {
  const before = part(
    control(
      '<w:p><w:pPr><w:ind w:left="480"/><w:jc w:val="right"/>' +
        '<w:pPrChange w:id="7" w:author="Ada"><w:pPr><w:ind w:left="480"/></w:pPr></w:pPrChange>' +
        `</w:pPr>${run}</w:p>`
    )
  );
  const id = storyParagraphs(bodyStoryRoot(before)!)[0]!.id;
  const after = apply(before, {
    op: 'setParagraphProperties',
    paragraphId: id,
    properties: [
      ...directParagraphProperties(before, id).filter((property) => property.localName !== 'jc'),
      { localName: 'jc', attributes: { val: 'center' } },
    ],
    revision: BOB,
  });
  expect(xml(after)).toContain('<w:jc w:val="center"/>');
  const rejected = xml(apply(after, { op: 'rejectAllRevisions' }));
  expect(rejected).not.toContain('<w:jc');
  expect(rejected).toContain('<w:ind w:left="480"/>');
});

const bound = (inner: string, lock = '') =>
  '<w:sdt><w:sdtPr><w:tag w:val="field"/>' +
  `${lock}<w:dataBinding w:storeItemID="{1}" w:xpath="/root/value"/><w:text/></w:sdtPr>` +
  `<w:sdtContent>${inner}</w:sdtContent></w:sdt>`;

test('a data binding lets every paragraph property op through and keeps its text', () => {
  const before = part(bound(`<w:p>${properties}${run}</w:p>`));
  const id = storyParagraphs(bodyStoryRoot(before)!)[0]!.id;
  const ops = [
    {
      op: 'setParagraphProperties' as const,
      paragraphId: id,
      properties: [
        { localName: 'pStyle', attributes: { val: 'Heading1' } },
        { localName: 'jc', attributes: { val: 'center' } },
        { localName: 'shd', attributes: { val: 'clear', color: 'auto', fill: 'C0C0C0' } },
        { localName: 'bidi' },
      ],
    },
    {
      op: 'setParagraphTabStops' as const,
      paragraphId: id,
      stops: [{ positionTwips: 1440, alignment: 'left' as const }],
    },
    { op: 'setListNumbering' as const, paragraphId: id, numId: '1', level: 0 },
    { op: 'setListLevel' as const, paragraphId: id, level: 1 },
  ];
  let after = before;
  for (const op of ops) after = apply(after, op);
  const saved = xml(after);
  for (const element of ['<w:pStyle w:val="Heading1"/>', '<w:jc w:val="center"/>', '<w:bidi/>'])
    expect(saved).toContain(element);
  expect(saved).toContain('<w:tab w:pos="1440" w:val="left"/>');
  expect(saved).toContain('<w:ilvl w:val="1"/>');
  expect(saved).toContain('w:fill="C0C0C0"');
  expect(saved).toContain('<w:dataBinding');
  expect(saved).toContain(run);
});

test('a tracked paragraph property change in a data binding can be accepted and rejected', () => {
  const before = part(bound(`<w:p>${properties}${run}</w:p>`));
  const id = storyParagraphs(bodyStoryRoot(before)!)[0]!.id;
  const after = apply(before, {
    op: 'setParagraphProperties',
    paragraphId: id,
    properties: [
      ...directParagraphProperties(before, id),
      { localName: 'spacing', attributes: { before: '240' } },
    ],
    revision: ADA,
  });
  expect(xml(after)).toContain('<w:pPrChange ');
  expect(xml(apply(after, { op: 'rejectAllRevisions' }))).toBe(xml(before));
  const accepted = xml(apply(after, { op: 'acceptAllRevisions' }));
  expect(accepted).toContain('<w:spacing w:before="240"/>');
  expect(accepted).not.toContain('<w:pPrChange');
  expect(accepted).toContain(run);
});

test('a data binding still refuses its text, and a lock on it still keeps its style', () => {
  const free = part(bound(`<w:p>${properties}${run}</w:p>`));
  const freeId = storyParagraphs(bodyStoryRoot(free)!)[0]!.id;
  expect(
    applyTreeOp(free, { op: 'insertText', paragraphId: freeId, offset: 1, text: 'X' })
  ).toMatchObject({ ok: false, reason: 'bound' });
  const locked = part(bound(`<w:p>${properties}${run}</w:p>`, '<w:lock w:val="contentLocked"/>'));
  const lockedId = storyParagraphs(bodyStoryRoot(locked)!)[0]!.id;
  expect(
    applyTreeOp(locked, {
      op: 'setParagraphProperties',
      paragraphId: lockedId,
      properties: [{ localName: 'pStyle', attributes: { val: 'Heading1' } }],
    })
  ).toMatchObject({ ok: false, reason: 'locked' });
  expect(
    applyTreeOp(locked, {
      op: 'setParagraphProperties',
      paragraphId: lockedId,
      properties: [
        ...directParagraphProperties(locked, lockedId),
        { localName: 'jc', attributes: { val: 'center' } },
      ],
    })
  ).toMatchObject({ ok: true });
});
