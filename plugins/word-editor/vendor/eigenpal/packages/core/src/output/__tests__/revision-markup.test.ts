import { caretStops } from '../../layout/semantic-interaction.ts';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../../layout/semantic-layout.ts';
import { linesOf } from '../../layout/semantic-records.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';
import { collectPageChangeBars } from '../semantic-paint-change-bars.ts';
import {
  DEFAULT_REVISION_MARKUP,
  resolveRevisionMarkup,
  type RevisionMarkupOptions,
} from '../../contracts/revision-markup.ts';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const run = (text: string) => `<w:r><w:t>${text}</w:t></w:r>`;
const revision = (kind: string, text: string) =>
  `<w:${kind} w:id="1" w:author="Reviewer">${run(text)}</w:${kind}>`;
function render(
  body: string,
  options: RevisionMarkupOptions,
  revisionStyles?: import('../revision-presentation.ts').RevisionStyles,
  displayMode: import('../../layout/revision-projection.ts').RevisionDisplayMode = 'all-markup'
) {
  const parsed = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  const before = serializeOoxmlPart(parsed.part);
  const revisionMarkup = resolveRevisionMarkup(options);
  const layout = layoutSemanticDocument(parsed.part, 1, {
    displayMode,
    measurer: createFixedMeasurer(6, 14),
    revisionAuthorFilter: {
      hiddenAuthors: new Set(),
      resolvedMarkup: 'plain',
      cacheKey: JSON.stringify(revisionMarkup),
      revisionMarkup,
    },
  });
  const root = document.createElement('div');
  paintSemanticLayout(root, layout, { scale: 1, revisionMarkup, revisionStyles });
  expect(serializeOoxmlPart(parsed.part)).toEqual(before);
  return { root, layout, revisionMarkup };
}
test('settings merge deeply, reject unknown values, and stay immutable', () => {
  const value = resolveRevisionMarkup({ insertions: { color: 'red' } });
  expect(value.insertions).toEqual({ mark: 'underline', color: 'red', background: 'none' });
  expect(DEFAULT_REVISION_MARKUP.insertions.color).toBe('byAuthor');
  expect(Object.isFrozen(value.insertions)).toBe(true);
  expect(() => resolveRevisionMarkup({ insertions: { color: 'url(x)' as never } })).toThrow();
  expect(() => resolveRevisionMarkup({ extra: true } as never)).toThrow();
});
test.each([
  'none',
  'colorOnly',
  'bold',
  'italic',
  'underline',
  'doubleUnderline',
  'strikethrough',
  'doubleStrikethrough',
] as const)('renders insertion mark %s', (mark) => {
  const { root, layout } = render(`<w:p>${revision('ins', 'text')}</w:p>`, {
    insertions: { mark, color: 'blue' },
  });
  const span = root.querySelector<HTMLElement>('[data-revision-kind="insert"]')!;
  expect(span.textContent).toBe('text');
  if (mark === 'none') expect(span.style.color).toBe('');
  else expect(span.style.color).toBe('var(--doc-revision-color-blue)');
  if (mark === 'bold' || mark === 'italic')
    expect(linesOf(layout)[0]!.spans[0]!.style[mark]).toBe(true);
  if (mark.startsWith('double')) expect(span.style.textDecorationStyle).toBe('double');
});
test('a configured underline keeps the thin rule below the descenders', () => {
  const { root } = render(`<w:p>${revision('ins', 'quick fox')}</w:p>`, {});
  const span = root.querySelector<HTMLElement>('[data-revision-kind="insert"]')!;
  expect(span.style.textDecorationLine).toBe('underline');
  expect(span.style.textDecorationThickness).toBe(
    'var(--doc-revision-insertion-decoration-thickness)'
  );
  expect(span.style.textUnderlineOffset).toBe('var(--doc-revision-insertion-underline-offset)');
  // Each word is its own run box, so only the line can keep one rule across the spaces.
  const line = span.closest<HTMLElement>('.docx-line')!;
  expect(line.style.getPropertyValue('text-decoration-skip-ink')).toBe('none');
  expect(line.style.getPropertyValue('text-decoration-skip-spaces')).toBe('none');
});
test.each([
  ['hidden', '', 0],
  ['caret', '^', 6],
  ['pound', '#', 6],
] as const)(
  'deletion %s changes measured geometry and keeps model offsets',
  (mark, text, width) => {
    const { layout } = render(`<w:p>${revision('del', 'removed')}${run('keep')}</w:p>`, {
      deletions: { mark },
    });
    const spans = linesOf(layout).flatMap((line) => line.spans);
    expect(spans.map((span) => span.text).join('')).toBe(`${text}keep`);
    const kept = spans.find((span) => span.text === 'keep')!;
    expect(kept.range.start).toBe(7);
    expect(kept.box.x - spans[0]!.box.x).toBeCloseTo(width ? spans[0]!.box.width : 0);
    if (text) expect(spans[0]!.range.end).toBe(7);
  }
);
test('moves use independent marks and the tracking switch selects insertion and deletion styles', () => {
  const source = `<w:p>${revision('moveFrom', 'old')}${revision('moveTo', 'new')}</w:p>`;
  const enabled = render(source, {}).root;
  expect(
    enabled.querySelector<HTMLElement>('[data-revision-kind="moveTo"]')!.style.textDecorationStyle
  ).toBe('double');
  const disabled = render(source, { trackMoves: false, insertions: { mark: 'bold' } }).root;
  expect(
    disabled.querySelector<HTMLElement>('[data-revision-kind="moveTo"]')!.style.fontWeight
  ).toBe('bold');
});
test('paragraph and run formatting revisions use the selected mark', () => {
  const paragraph =
    '<w:pPr><w:pPrChange w:id="2" w:author="Reviewer"><w:pPr/></w:pPrChange></w:pPr>';
  const { root } = render(`<w:p>${paragraph}${run('text')}</w:p>`, {
    formatting: { mark: 'doubleUnderline', color: 'red' },
  });
  const span = root.querySelector<HTMLElement>('[data-revision-kind="format"][data-start]')!;
  expect(span.style.textDecorationStyle).toBe('double');
});
test('change bars honor position, facing pages, color, and none', () => {
  const { layout } = render(`<w:p>${revision('ins', 'text')}</w:p>`, {});
  const page = layout.pages[0]!;
  const left = collectPageChangeBars(
    page,
    1,
    'all-markup',
    false,
    resolveRevisionMarkup({ changedLines: { mark: 'leftBorder' } })
  );
  const right = collectPageChangeBars(
    page,
    1,
    'all-markup',
    false,
    resolveRevisionMarkup({ changedLines: { mark: 'rightBorder', color: 'red' } })
  );
  expect(right.left).toBeGreaterThan(left.left);
  expect(right.color).toBe('var(--doc-revision-color-red)');
  expect(
    collectPageChangeBars(
      { ...page, index: 0 },
      1,
      'all-markup',
      false,
      DEFAULT_REVISION_MARKUP,
      true
    ).left
  ).toBe(right.left);
  expect(
    collectPageChangeBars(
      page,
      1,
      'all-markup',
      false,
      resolveRevisionMarkup({ changedLines: { mark: 'none' } })
    ).runs
  ).toHaveLength(0);
});
test.each([
  ['cellIns', '', 'inserted'],
  ['cellDel', '', 'deleted'],
  ['cellMerge', 'w:vMerge="cont"', 'merged'],
  ['cellMerge', 'w:vMergeOrig="cont" w:vMerge="rest"', 'split'],
])('cell %s %s has %s shading', (name, attributes, kind) => {
  const { root } = render(
    `<w:tbl><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:${name} w:id="1" w:author="Reviewer" ${attributes}/></w:tcPr><w:p>${run('cell')}</w:p></w:tc></w:tr></w:tbl>`,
    {}
  );
  expect(root.querySelector<HTMLElement>('[data-revision-cell]')!.dataset.revisionCell).toBe(kind);
});

test('formatting uses each author slot and explicit color overrides author colors', () => {
  const formatted = (author: string, text: string) =>
    `<w:r><w:rPr><w:rPrChange w:id="${author}" w:author="${author}"><w:rPr/></w:rPrChange></w:rPr><w:t>${text}</w:t></w:r>`;
  const body = `<w:p>${formatted('A', 'first')}${formatted('B', 'second')}</w:p>`;
  const root = render(body, { formatting: { mark: 'underline' } }).root;
  const spans = [
    ...root.querySelectorAll<HTMLElement>('[data-revision-kind="format"][data-start]'),
  ];
  expect(spans[0]!.style.color).toBe('var(--doc-review-author-0)');
  expect(spans[1]!.style.color).toBe('var(--doc-review-author-1)');
  const custom = render(
    body,
    { formatting: { mark: 'underline', color: 'blue' } },
    { others: 'author', authors: { A: 'red' } }
  ).root;
  expect(
    custom.querySelector<HTMLElement>('[data-review-author="A"][data-start]')!.style.color
  ).toBe('var(--doc-revision-color-blue)');
  const plain = render(
    body,
    { formatting: { mark: 'none' } },
    { others: 'author', authors: { A: 'red' } }
  ).root;
  expect(
    plain.querySelector<HTMLElement>('[data-review-author="A"][data-start]')!.style.color
  ).toBe('');
});

test('change bars use each author color', () => {
  const root = render(
    `<w:p><w:ins w:id="1" w:author="A">${run('first')}</w:ins></w:p><w:p><w:ins w:id="2" w:author="B">${run('second')}</w:ins></w:p>`,
    { changedLines: { color: 'byAuthor' } }
  ).root;
  const bars = [...root.querySelectorAll<HTMLElement>('.docx-change-bar')];
  expect(bars.map((bar) => bar.style.backgroundColor)).toEqual([
    'var(--doc-review-author-0)',
    'var(--doc-review-author-1)',
  ]);
});

test.each(['hidden', 'caret', 'pound'] as const)(
  'caret stops skip removed text under %s',
  (mark) => {
    const { layout } = render(`<w:p>${run('AB')}${revision('del', 'CDE')}${run('FG')}</w:p>`, {
      deletions: { mark },
    });
    expect(caretStops(layout).map((stop) => stop.position.offset)).toEqual([0, 1, 2, 5, 6, 7]);
  }
);

test.each(['', run('kept')])('hidden deletions retain changed lines beside %s', (kept) => {
  const { root } = render(`<w:p>${revision('del', 'removed')}${kept}</w:p>`, {
    deletions: { mark: 'hidden' },
    changedLines: { color: 'byAuthor' },
  });
  expect(root.querySelector('[data-revision-kind="delete"]')).toBeNull();
  const bar = root.querySelector<HTMLElement>('.docx-change-bar');
  expect(bar).not.toBeNull();
  expect(bar!.style.backgroundColor).toBe('var(--doc-review-author-0)');
});

test('hidden deletion bars retain distinct author colors', () => {
  const deleted = (author: string) =>
    `<w:p><w:del w:id="${author}" w:author="${author}">${run('removed')}</w:del></w:p>`;
  const { root } = render(deleted('A') + deleted('B'), {
    deletions: { mark: 'hidden' },
    changedLines: { color: 'byAuthor' },
  });
  expect(
    [...root.querySelectorAll<HTMLElement>('.docx-change-bar')].map(
      (bar) => bar.style.backgroundColor
    )
  ).toEqual(['var(--doc-review-author-0)', 'var(--doc-review-author-1)']);
});

test('paragraph formatting marks retain distinct author colors', () => {
  const formatted = (author: string) =>
    `<w:p><w:pPr><w:pPrChange w:id="${author}" w:author="${author}"><w:pPr/></w:pPrChange></w:pPr>${run('text')}</w:p>`;
  const { root } = render(formatted('A') + formatted('B'), {
    formatting: { mark: 'underline' },
  });
  expect(
    [...root.querySelectorAll<HTMLElement>('[data-revision-kind="format"][data-start]')].map(
      (span) => span.style.color
    )
  ).toEqual(['var(--doc-review-author-0)', 'var(--doc-review-author-1)']);
});

test.each(['none', 'doubleUnderline', 'hidden', 'caret', 'pound'] as const)(
  'paragraph deletion marks follow %s settings',
  (mark) => {
    const { root } = render(
      `<w:p><w:pPr><w:rPr><w:del w:id="1" w:author="Reviewer"/></w:rPr></w:pPr>${run('text')}</w:p>`,
      { deletions: { mark, color: 'blue' } }
    );
    const glyph = root.querySelector<HTMLElement>('.docx-revision-pmark')!;
    expect(glyph).not.toBeNull();
    expect(glyph.style.color).toBe(mark === 'none' ? '' : 'var(--doc-revision-color-blue)');
    if (mark === 'doubleUnderline') expect(glyph.style.textDecorationStyle).toBe('double');
    if (mark === 'hidden') expect(glyph.style.visibility).toBe('hidden');
    if (mark === 'caret') expect(glyph.textContent).toBe('^');
    if (mark === 'pound') expect(glyph.textContent).toBe('#');
  }
);

test.each([
  ['ins', 'inserted'],
  ['del', 'deleted'],
] as const)('tracked %s rows apply the configured %s cell shading', (kind, cellKind) => {
  const body = `<w:tbl><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:trPr><w:${kind} w:id="9" w:author="Reviewer"/></w:trPr><w:tc><w:p>${run('cell')}</w:p></w:tc></w:tr></w:tbl>`;
  const { root } = render(body, { cells: { [cellKind]: 'green' } });
  const cell = root.querySelector<HTMLElement>('[data-revision-cell]')!;
  expect(cell.dataset.revisionCell).toBe(cellKind);
  expect(cell.style.backgroundColor).toBe('var(--doc-revision-color-green)');
  const plain = render(body, { cells: { [cellKind]: 'none' } }).root;
  expect(plain.querySelector<HTMLElement>('[data-revision-cell]')!.style.backgroundColor).toBe('');
  expect(plain.querySelector<HTMLElement>('.docx-table-row')!.style.backgroundColor).toBe(
    'transparent'
  );
});

test('cell merge shading takes precedence over its inserted row', () => {
  const { root } = render(
    `<w:tbl><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:trPr><w:ins w:id="9" w:author="Reviewer"/></w:trPr><w:tc><w:tcPr><w:cellMerge w:id="10" w:author="Reviewer" w:vMerge="cont"/></w:tcPr><w:p>${run('cell')}</w:p></w:tc></w:tr></w:tbl>`,
    {
      cells: { inserted: 'green', merged: 'blue' },
    }
  );
  expect(root.querySelector<HTMLElement>('[data-revision-cell]')!.style.backgroundColor).toBe(
    'var(--doc-revision-color-blue)'
  );
});

test.each([
  ['hidden', ''],
  ['caret', '^'],
  ['pound', '#'],
  ['bold', 'removed'],
  ['italic', 'removed'],
] as const)('deletion %s applies inside editable field results', (mark, text) => {
  const body = `<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> FORMTEXT </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${revision('del', 'removed')}<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`;
  const { layout, root } = render(body, { deletions: { mark } });
  const spans = linesOf(layout).flatMap((line) => line.spans);
  expect(spans.map((span) => span.text).join('')).toBe(text);
  if (mark === 'bold' || mark === 'italic') expect(spans[0]!.style[mark]).toBe(true);
  if (text) expect(spans[0]!.range.end).toBe(7);
  expect(root.querySelector('.docx-change-bar')).not.toBeNull();
});

test.each(['caret', 'pound'] as const)(
  'deleted PAGE fields retain the %s replacement after pagination',
  (mark) => {
    const { layout } = render(
      '<w:p><w:del w:id="1" w:author="Reviewer"><w:fldSimple w:instr="PAGE"/></w:del></w:p>',
      { deletions: { mark } }
    );
    expect(
      linesOf(layout)
        .flatMap((line) => line.spans)
        .map((span) => span.text)
        .join('')
    ).toBe(mark === 'caret' ? '^' : '#');
  }
);

test('cell author colors preserve explicit cell attribution over row attribution', () => {
  const cell = (revision: string) =>
    `<w:tc><w:tcPr>${revision}</w:tcPr><w:p>${run('cell')}</w:p></w:tc>`;
  const body = `<w:tbl><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:trPr><w:ins w:id="9" w:author="Row author"/></w:trPr>${cell('')}${cell('<w:cellMerge w:id="10" w:author="Cell author" w:vMerge="cont"/>')}</w:tr></w:tbl>`;
  const settings = { cells: { inserted: 'byAuthor', merged: 'byAuthor' } } as const;
  const { root, layout } = render(body, settings);
  const cells = root.querySelectorAll<HTMLElement>('[data-revision-cell]');
  expect(cells[0]!.style.backgroundColor).toBe('var(--doc-review-author-0)');
  expect(cells[1]!.style.backgroundColor).toBe('var(--doc-review-author-1)');
  const table = layout.pages[0]!.fragments.find((block) => block.kind === 'table')!;
  expect(table.rows[0]!.cells.map((item) => item.revisionShadingAuthor)).toEqual([
    'Row author',
    'Cell author',
  ]);
  const custom = render(body, settings, { authors: { 'Cell author': '#123456' } }).root;
  expect(
    custom.querySelectorAll<HTMLElement>('[data-revision-cell]')[1]!.style.backgroundColor
  ).toBe('#123456');
});

test.each([undefined, 'kind', { others: 'kind', authors: {} }] as const)(
  'cell-only authors get distinct colors with text mode %j',
  (revisionStyles) => {
    const cell = (author: string, id: number) =>
      `<w:tc><w:tcPr><w:cellIns w:id="${id}" w:author="${author}"/></w:tcPr><w:p>${run('cell')}</w:p></w:tc>`;
    const { root } = render(
      `<w:tbl><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid><w:tr>${cell('First', 1)}${cell('Second', 2)}</w:tr></w:tbl>`,
      { cells: { inserted: 'byAuthor' } },
      revisionStyles
    );
    expect(
      Array.from(
        root.querySelectorAll<HTMLElement>('[data-revision-cell]'),
        (cell) => cell.style.backgroundColor
      )
    ).toEqual(['var(--doc-review-author-0)', 'var(--doc-review-author-1)']);
  }
);

test.each(['lightPurple', 'lightGreen', 'gray'] as const)('cell shading supports %s', (color) => {
  const { root } = render(
    `<w:tbl><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:cellIns w:id="1" w:author="Reviewer"/></w:tcPr><w:p>${run('cell')}</w:p></w:tc></w:tr></w:tbl>`,
    { cells: { inserted: color } }
  );
  expect(root.querySelector<HTMLElement>('[data-revision-cell]')!.style.backgroundColor).toBe(
    `var(--doc-revision-color-${color})`
  );
});

test('background preferences merge independently and reject unsupported values', () => {
  const first = resolveRevisionMarkup({ insertions: { background: 'lightGreen' } });
  const next = resolveRevisionMarkup({ insertions: { color: 'blue' } }, first);
  expect(next.insertions).toEqual({ mark: 'underline', color: 'blue', background: 'lightGreen' });
  expect(
    resolveRevisionMarkup({ insertions: { background: 'none' } }, next).insertions.background
  ).toBe('none');
  for (const background of ['auto', '#fff', 'url(x)', null, undefined])
    expect(() => resolveRevisionMarkup({ insertions: { background } } as never)).toThrow();
  expect(() =>
    resolveRevisionMarkup({ changedLines: { background: 'yellow' } } as never)
  ).toThrow();
});

test('revision backgrounds work without a text mark and retain authored highlight when off', () => {
  const body = `<w:p><w:ins w:id="1" w:author="Reviewer"><w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t>text</w:t></w:r></w:ins></w:p>`;
  const background = (options: RevisionMarkupOptions) =>
    render(body, options).root.querySelector<HTMLElement>('[data-revision-kind="insert"]')!.style
      .backgroundColor;
  expect(background({ insertions: { mark: 'none', background: 'lightGreen' } })).toBe(
    'var(--doc-revision-color-lightGreen)'
  );
  expect(background({ insertions: { mark: 'none', background: 'none' } })).toBe('#ffff00');
  const authorSpan = render(body, {
    insertions: { mark: 'none', background: 'byAuthor' },
  }).root.querySelector<HTMLElement>('[data-revision-kind="insert"]')!;
  expect(authorSpan.style.backgroundColor).toBe('var(--doc-revision-background)');
  expect(authorSpan.style.getPropertyValue('--doc-revision-background')).toBe(
    'color-mix(in srgb, var(--doc-review-author-0) 15%, var(--doc-revision-color-white))'
  );
});

test('background overrides retain author preferences only for none and byAuthor', () => {
  const body = `<w:p>${revision('ins', 'text')}</w:p>`;
  const revisionStyles = {
    others: 'author' as const,
    authors: { Reviewer: { color: 'red', background: 'pink' } },
  };
  for (const background of ['none', 'byAuthor', 'lightGreen'] as const) {
    const span = render(
      body,
      { insertions: { background } },
      revisionStyles
    ).root.querySelector<HTMLElement>('[data-revision-kind="insert"]')!;
    expect(span.style.backgroundColor).toBe(
      background === 'lightGreen' ? 'var(--doc-revision-color-lightGreen)' : 'pink'
    );
  }
});

test('moves use insertion and deletion backgrounds when move tracking is off', () => {
  const { root } = render(`<w:p>${revision('moveFrom', 'old')}${revision('moveTo', 'new')}</w:p>`, {
    trackMoves: false,
    insertions: { background: 'lightGreen' },
    deletions: { background: 'pink' },
    movedFrom: { background: 'yellow' },
    movedTo: { background: 'yellow' },
  });
  expect(
    root.querySelector<HTMLElement>('[data-revision-kind="moveFrom"]')!.style.backgroundColor
  ).toBe('var(--doc-revision-color-pink)');
  expect(
    root.querySelector<HTMLElement>('[data-revision-kind="moveTo"]')!.style.backgroundColor
  ).toBe('var(--doc-revision-color-lightGreen)');
});

test('formatting background appears when its text mark is none', () => {
  const { root } = render(
    '<w:p><w:r><w:rPr><w:rPrChange w:id="1" w:author="Reviewer"><w:rPr/></w:rPrChange></w:rPr><w:t>Formatted</w:t></w:r></w:p>',
    {
      formatting: { mark: 'none', background: 'lightBlue' },
    }
  );
  expect(
    root.querySelector<HTMLElement>('[data-revision-kind="format"][data-start]')!.style
      .backgroundColor
  ).toBe('var(--doc-revision-color-lightBlue)');
});

test.each(['proposed', 'original'] as const)(
  '%s suppresses viewer backgrounds and keeps document highlights',
  (displayMode) => {
    const kind = displayMode === 'original' ? 'del' : 'ins';
    const textTag = kind === 'del' ? 'delText' : 't';
    const body = `<w:p><w:${kind} w:id="1" w:author="Reviewer"><w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:${textTag}>text</w:${textTag}></w:r></w:${kind}></w:p>`;
    const { root } = render(
      body,
      {
        insertions: { background: 'lightGreen' },
        deletions: { background: 'pink' },
      },
      undefined,
      displayMode
    );
    const span = root.querySelector<HTMLElement>('[data-start]')!;
    expect(span.textContent).toBe('text');
    expect(span.style.backgroundColor).toBe('#ffff00');
  }
);

test('paragraph mark backgrounds use the custom author color', () => {
  const { root } = render(
    `<w:p><w:pPr><w:rPr><w:del w:id="1" w:author="Reviewer"/></w:rPr></w:pPr>${run('text')}</w:p>`,
    { deletions: { background: 'byAuthor' } },
    { others: 'author', authors: { Reviewer: { color: 'blue' } } }
  );
  const glyph = root.querySelector<HTMLElement>('.docx-revision-pmark')!;
  expect(glyph.style.getPropertyValue('--doc-revision-background')).toBe(
    'color-mix(in srgb, blue 15%, var(--doc-revision-color-white))'
  );
});

test('a change bar stands half an inch outside the text, or mid-margin when the margin is narrower', () => {
  const { layout } = render(`<w:p>${revision('ins', 'text')}</w:p>`, {});
  const page = layout.pages[0]!;
  const at = (margin: number) =>
    collectPageChangeBars(
      { ...page, contentBox: { ...page.contentBox, x: page.box.x + margin } },
      1,
      'all-markup',
      false,
      DEFAULT_REVISION_MARKUP
    ).left;
  expect(at(54)).toBe(27);
  expect(at(72)).toBe(36);
  expect(at(90)).toBe(54);
});
