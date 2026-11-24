import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { compatibilityProfileFromSettings } from '../compatibility/compatibility-profile.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function read(xml: string, name: string) {
  const result = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}
const settings = (body: string) =>
  read(
    `<w:settings xmlns:w="${W}" xmlns:x="urn:foreign"><w:compat>${body}</w:compat></w:settings>`,
    '/word/settings.xml'
  );
const cascade = (body: string) => buildStyleCascadeTable(null, undefined, settings(body).root);
const on = '<w:noColumnBalance/>';
const off = '<w:noColumnBalance w:val="0"/>';
const measurer = createFixedMeasurer(6, 14);
const section = (columns: number, type = 'continuous') =>
  `<w:sectPr><w:type w:val="${type}"/><w:pgSz w:w="6000" w:h="2400"/><w:pgMar w:top="200" w:bottom="200" w:left="200" w:right="200"/><w:cols w:num="${columns}" w:space="200"/></w:sectPr>`;
const paragraph = (text: string, height = 30, sect = '') =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${height * 20}" w:lineRule="exact"/>${sect}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const document = (count = 4, columns = 2, type = 'continuous') =>
  read(
    `<w:document xmlns:w="${W}"><w:body>${Array.from({ length: count }, (_, i) => paragraph(`B${i}`)).join('')}${paragraph('', 1, section(columns))}${paragraph('FOLLOW', 8)}${section(1, type)}</w:body></w:document>`,
    '/word/document.xml'
  );
function layout(
  part: ReturnType<typeof document>,
  flag: string,
  session?: ReturnType<typeof createLayoutSession>
) {
  return layoutSemanticDocument(part, 1, { measurer, styleCascade: cascade(flag), session });
}
function rows(result: ReturnType<typeof layout>) {
  return result.pages.flatMap((page, pageIndex) =>
    page.fragments.flatMap((fragment) =>
      fragment.kind === 'paragraph'
        ? [
            {
              pageIndex,
              text: fragment.lines.flatMap((line) => line.spans.map((span) => span.text)).join(''),
              fragment,
            },
          ]
        : []
    )
  );
}
const only = (result: ReturnType<typeof layout>, text: string) => {
  const matches = rows(result).filter((row) => row.text === text);
  expect(matches).toHaveLength(1);
  return matches[0]!;
};
function clearsColumns(result: ReturnType<typeof layout>) {
  const follow = only(result, 'FOLLOW');
  for (const row of rows(result)) {
    if (row.pageIndex === follow.pageIndex && /^B\d+$/.test(row.text)) {
      expect(row.fragment.box.y + row.fragment.box.height).toBeLessThanOrEqual(
        follow.fragment.box.y
      );
    }
  }
}

test('reads an authored noColumnBalance option without changing the settings tree', () => {
  for (const value of ['', '1', 'true', 'on']) {
    const part = settings(value ? `<w:noColumnBalance w:val="${value}"/>` : on);
    const before = serializeOoxmlPart(part);
    expect(compatibilityProfileFromSettings(part.root).legacy.noColumnBalance).toBe(true);
    expect(cascade(value ? `<w:noColumnBalance w:val="${value}"/>` : on).noColumnBalance).toBe(
      true
    );
    expect(serializeOoxmlPart(part)).toBe(before);
  }
});

test('absent and explicitly disabled flags keep balancing enabled', () => {
  for (const value of ['0', 'false', 'off']) {
    const flag = `<w:noColumnBalance w:val="${value}"/>`;
    expect(compatibilityProfileFromSettings(settings(flag).root).legacy.noColumnBalance).toBe(
      false
    );
    expect(cascade(flag).noColumnBalance).toBeUndefined();
    expect(cascade(flag).cacheToken).toBe(cascade('').cacheToken);
  }
  expect(cascade('').noColumnBalance).toBeUndefined();
});

test('uses expanded names and the last compatibility option', () => {
  expect(cascade('<x:noColumnBalance/>').noColumnBalance).toBeUndefined();
  expect(cascade('<w:noColumnBalance x:val="0"/>').noColumnBalance).toBe(true);
  expect(cascade(on + off).noColumnBalance).toBeUndefined();
  expect(cascade(off + on).noColumnBalance).toBe(true);
  expect(cascade(on).cacheToken).not.toBe(cascade('').cacheToken);
});

test('an enabled flag fills columns naturally and a continuous successor clears the tallest column', () => {
  const part = document(4);
  const before = serializeOoxmlPart(part);
  const natural = layout(part, on);
  expect(only(natural, 'B2').fragment.box.x).toBe(0);
  expect(only(natural, 'B3').fragment.box.x).toBeGreaterThan(0);
  expect(only(natural, 'FOLLOW').fragment.box.y).toBe(90);
  clearsColumns(natural);
  expect(serializeOoxmlPart(part)).toBe(before);
});

test('compatibility mode 15 ignores the flag and balances the columns', () => {
  const mode = (value: number) =>
    `<w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="${value}"/>`;
  expect(cascade(mode(15) + on).noColumnBalance).toBeUndefined();
  expect(cascade(mode(14) + on).noColumnBalance).toBe(true);
  expect(cascade(mode(12) + on).noColumnBalance).toBe(true);
  const part = document(4);
  const modern = layoutSemanticDocument(part, 1, {
    measurer,
    styleCascade: cascade(mode(15) + on),
  });
  const balanced = layoutSemanticDocument(part, 1, { measurer, styleCascade: cascade(mode(15)) });
  expect(modern.pages).toEqual(balanced.pages);
  expect(only(modern, 'FOLLOW').fragment.box.y).toBeLessThan(90);
});

test('default and disabled flags retain general final-page balancing', () => {
  for (const flag of ['', off]) {
    const result = layout(document(10), flag);
    expect(result.pages).toHaveLength(2);
    expect(only(result, 'B8').fragment.box.x).toBeGreaterThan(0);
    expect(only(result, 'FOLLOW').fragment.box.y).toBe(60);
    clearsColumns(result);
  }
});

test('an unused third column does not hide the first column extent', () => {
  const result = layout(document(4, 3), on);
  expect(only(result, 'B2').fragment.box.x).toBe(0);
  expect(only(result, 'B3').fragment.box.x).toBeGreaterThan(0);
  expect(only(result, 'FOLLOW').fragment.box.y).toBe(90);
  clearsColumns(result);
});

test('an unbalanced multipage section preserves natural source ranges and geometry', () => {
  const part = document(10);
  const result = layout(part, on);
  const separate = layout(document(10, 2, 'nextPage'), on);
  expect(result.pages).toHaveLength(2);
  expect(only(result, 'FOLLOW').fragment.box.y).toBe(90);
  const sourceRows = (value: ReturnType<typeof layout>) =>
    rows(value)
      .filter((row) => /^B\d+$/.test(row.text))
      .map(({ pageIndex, text, fragment }) => ({
        pageIndex,
        text,
        box: fragment.box,
        lines: fragment.lines.map((line) => ({
          box: line.box,
          spans: line.spans.map((span) => ({
            text: span.text,
            range: span.range,
            style: span.style,
          })),
        })),
      }));
  expect(sourceRows(result)).toEqual(sourceRows(separate));
  clearsColumns(result);
});

test('a tall unbalanced final column moves a full-width successor to the next page', () => {
  const result = layout(document(10), on);
  // A 30pt successor cannot share the 10pt remainder below the tallest column.
  const part = document(10);
  const xml = serializeOoxmlPart(part).replace('w:line="160"', 'w:line="600"');
  const changed = read(xml, '/word/document.xml');
  const moved = layout(changed, on);
  expect(only(result, 'FOLLOW').pageIndex).toBe(1);
  expect(only(moved, 'FOLLOW').pageIndex).toBe(2);
  expect(only(moved, 'FOLLOW').fragment.box.y).toBe(0);
  clearsColumns(moved);
});

test('settings changes invalidate warm column layout without changing the source', () => {
  const part = document(10);
  const before = serializeOoxmlPart(part);
  const session = createLayoutSession();
  for (const flag of ['', on, off, on, '']) {
    const warm = layout(part, flag, session);
    expect(warm.pages).toEqual(layout(part, flag).pages);
    clearsColumns(warm);
  }
  expect(serializeOoxmlPart(part)).toBe(before);
});

test('single-column and next-page sections retain their placement', () => {
  for (const part of [document(4, 1), document(4, 2, 'nextPage')]) {
    expect(layout(part, on).pages).toEqual(layout(part, '').pages);
  }
});
