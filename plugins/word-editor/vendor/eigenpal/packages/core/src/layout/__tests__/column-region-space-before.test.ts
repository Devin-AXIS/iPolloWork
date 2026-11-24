import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout';

// All text and dimensions are synthetic. A positive flowStartY is the public
// semantic option used by a continued column region below an occupied prefix.
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);
type Options = NonNullable<Parameters<typeof layoutSemanticDocument>[2]>;
type Layout = ReturnType<typeof layoutSemanticDocument>;

function section(columns = 2, type = 'continuous'): string {
  return `<w:sectPr><w:type w:val="${type}"/><w:pgSz w:w="6000" w:h="4000"/><w:pgMar w:top="200" w:bottom="200" w:left="200" w:right="200" w:header="0" w:footer="0"/><w:cols w:num="${columns}" w:space="200"/></w:sectPr>`;
}

function paragraph(text: string, height: number, before = 0, after = 0, extra = ''): string {
  return `<w:p><w:pPr><w:spacing w:before="${before * 20}" w:after="${after * 20}" w:line="${height * 20}" w:lineRule="exact"/>${extra}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

function load(body: string) {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!result.ok) throw Error(result.reason);
  return result.part;
}

function lay(part: ReturnType<typeof load>, flowStartY = 50, options: Options = {}, revision = 1) {
  return layoutSemanticDocument(part, revision, { measurer, flowStartY, ...options });
}

function positions(layout: Layout, text: string) {
  return layout.pages.flatMap((page, pageIndex) =>
    page.fragments.flatMap((fragment) => {
      if (fragment.kind !== 'paragraph') return [];
      const value = fragment.lines.flatMap((line) => line.spans.map((span) => span.text)).join('');
      return value === text ? [{ pageIndex, fragment, page }] : [];
    })
  );
}

function at(layout: Layout, text: string) {
  const rows = positions(layout, text);
  expect(rows).toHaveLength(1);
  const row = rows[0]!;
  expect(row.fragment.lines.length).toBeGreaterThan(0);
  return { ...row, line: row.fragment.lines[0]! };
}

function inside(layout: Layout): void {
  for (const page of layout.pages) {
    for (const fragment of page.fragments) {
      if (fragment.kind !== 'paragraph' || fragment.outOfFlow) continue;
      for (const line of fragment.lines) {
        if (line.spans.some((span) => span.text.length > 0)) {
          expect(line.box.y).toBeGreaterThanOrEqual(0);
          expect(line.box.y + line.box.height).toBeLessThanOrEqual(page.contentBox.height + 1e-8);
        }
      }
    }
  }
}

const rightOpening = (before = 13) =>
  load(paragraph('LEFT', 110) + paragraph('RIGHT', 20, before) + section());

test('a natural right-column opening retains authored space below the region top', () => {
  const part = rightOpening();
  const current = lay(part);
  const right = at(current, 'RIGHT');
  expect(right.fragment.spacing.before).toBe(13);
  expect(right.line.box.y).toBeCloseTo(63, 8);
  expect(right.line.box.x).toBeGreaterThan(at(current, 'LEFT').line.box.x);
  expect(right.pageIndex).toBe(0);
  expect(current.pages).toHaveLength(1);
  inside(current);
});

test('the initial continuous-section column keeps its authored nine-point opening', () => {
  const part = load(paragraph('OPENING', 20, 9) + paragraph('AFTER', 14) + section());
  const current = lay(part);
  const opening = at(current, 'OPENING');
  expect(opening.fragment.spacing.before).toBe(9);
  expect(opening.line.box.x).toBeCloseTo(0, 8);
  expect(opening.line.box.y).toBeCloseTo(59, 8);
  inside(current);
});

test('a later paragraph in an occupied right column still collapses authored before and after', () => {
  const part = load(
    paragraph('LEFT', 110) +
      paragraph('RIGHT-FIRST', 20, 13, 5) +
      paragraph('RIGHT-SECOND', 20, 13) +
      section()
  );
  const current = lay(part);
  const first = at(current, 'RIGHT-FIRST');
  const second = at(current, 'RIGHT-SECOND');
  expect(first.fragment.spacing.before).toBe(13);
  expect(first.fragment.spacing.after).toBe(5);
  expect(second.fragment.spacing.before).toBe(8);
  expect(second.line.box.y - (first.line.box.y + first.line.box.height)).toBeCloseTo(13, 8);
  expect(second.line.box.x).toBeCloseTo(first.line.box.x, 8);
  expect(second.pageIndex).toBe(first.pageIndex);
  inside(current);
});

test('later columns of a three-column continued region retain their opening space', () => {
  const part = load(
    paragraph('LEFT', 110) + paragraph('MIDDLE', 110, 13) + paragraph('RIGHT', 20, 13) + section(3)
  );
  const current = lay(part);
  const left = at(current, 'LEFT');
  const middle = at(current, 'MIDDLE');
  const right = at(current, 'RIGHT');
  expect(middle.fragment.spacing.before).toBe(13);
  expect(right.fragment.spacing.before).toBe(13);
  expect(middle.line.box.y).toBeCloseTo(63, 8);
  expect(right.line.box.y).toBeCloseTo(63, 8);
  expect(middle.line.box.x).toBeGreaterThan(left.line.box.x);
  expect(right.line.box.x).toBeGreaterThan(middle.line.box.x);
  expect(current.pages).toHaveLength(1);
  inside(current);
});

test('a keep-next group retains authored opening space in a later column', () => {
  const part = load(
    paragraph('LEFT', 20) +
      paragraph('HEAD', 20, 13, 0, '<w:keepNext/>') +
      paragraph('BODY', 14) +
      section()
  );
  // A fresh continued column has 50pt. The group needs 47pt with its spacing.
  const current = lay(part, 130);
  const head = at(current, 'HEAD');
  const body = at(current, 'BODY');
  expect(head.pageIndex).toBe(0);
  expect(body.pageIndex).toBe(0);
  expect(head.fragment.spacing.before).toBe(13);
  expect(head.line.box.y).toBe(143);
  expect(head.line.box.x).toBeGreaterThan(at(current, 'LEFT').line.box.x);
  expect(body.line.box.y).toBeCloseTo(head.line.box.y + head.line.box.height, 8);
  expect(current.pages).toHaveLength(1);
  inside(current);
});

test.each([14, 15])(
  'continued-column spacing remains authored in compatibility mode %i',
  (mode) => {
    const current = lay(rightOpening(), 50, { compatibilityMode: mode });
    expect(at(current, 'RIGHT').fragment.spacing.before).toBe(13);
    expect(at(current, 'RIGHT').line.box.y).toBeCloseTo(63, 8);
  }
);

test('a fresh page still suppresses natural opening space', () => {
  const current = lay(rightOpening(), 0);
  expect(at(current, 'LEFT').line.box.y).toBe(0);
});

test('explicit page-break spacing retains the compatibility rule', () => {
  const part = load(
    paragraph('LEFT', 110) + paragraph('BREAK', 20, 13, 0, '<w:pageBreakBefore/>') + section()
  );
  for (const mode of [14, 15]) {
    const current = lay(part, 50, { compatibilityMode: mode });
    const moved = at(current, 'BREAK');
    expect(moved.pageIndex).toBe(1);
    expect(moved.fragment.spacing.before).toBe(mode === 14 ? 13 : 0);
    inside(current);
  }
});

test('a positioned frame retains authored spacing without occupying the column', () => {
  const part = load(
    paragraph(
      'FRAME',
      20,
      13,
      0,
      '<w:framePr w:x="0" w:y="0" w:w="1000" w:hAnchor="text" w:vAnchor="text"/>'
    ) +
      paragraph('ANCHOR', 20) +
      section(1)
  );
  const current = lay(part);
  expect(at(current, 'FRAME').fragment.outOfFlow).toBe(true);
  expect(at(current, 'FRAME').fragment.spacing.before).toBe(13);
  expect(at(current, 'ANCHOR').line.box.y).toBeCloseTo(50, 8);
});

test('an authored spacing edit agrees between warm and cold layout', () => {
  const session = createLayoutSession();
  lay(rightOpening(13), 50, { session }, 1);
  const edited = rightOpening(17);
  const source = JSON.stringify(edited);
  const warm = lay(edited, 50, { session }, 2);
  const cold = lay(edited, 50, {}, 2);
  expect(warm.pages).toEqual(cold.pages);
  expect(at(warm, 'RIGHT').fragment.spacing.before).toBe(17);
  expect(at(warm, 'RIGHT').line.box.y).toBeCloseTo(67, 8);
  expect(JSON.stringify(edited)).toBe(source);
  inside(warm);
});

test.each([0, 50])('widow retreat preserves the column origin at %i points', (origin) => {
  const part = load(
    paragraph('LEFT', origin === 0 ? 160 : 110) +
      paragraph('FIRST', 20, 0, 0, '<w:widowControl/>').replace(
        '</w:t>',
        '</w:t><w:br/><w:t>SECOND</w:t>'
      ) +
      section()
  );
  const current = lay(part, origin);
  const moved = current.pages[0]!.fragments.find(
    (f) => f.kind === 'paragraph' && f.lines.some((l) => l.spans.some((s) => s.text === 'FIRST'))
  );
  expect(moved).toBeDefined();
  expect(moved!.box.x).toBeGreaterThan(0);
  expect(moved!.box.y).toBe(origin);
  expect(current.pages).toHaveLength(1);
  const session = createLayoutSession();
  lay(part, origin, { session });
  expect(lay(part, origin, { session }, 2).pages).toEqual(current.pages);
  inside(current);
});
