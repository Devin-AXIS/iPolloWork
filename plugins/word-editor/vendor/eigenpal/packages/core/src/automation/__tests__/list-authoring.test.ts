import { describe, expect, test } from 'bun:test';
import { unzipSync, strFromU8, strToU8, zipSync } from 'fflate';
import {
  readOoxmlPackage,
  writeOoxmlPackage,
  type OoxmlPackage,
} from '../../store/package/ooxml-package.ts';
import {
  createAutomationList,
  formatAutomationListLevel,
  validAutomationListFormat,
  automationListLevelExists,
} from '../list-authoring.ts';
import { docx } from './support/protocol.ts';

function initial(): OoxmlPackage {
  const read = readOoxmlPackage(docx('<w:p><w:r><w:t>Preserve me</w:t></w:r></w:p>'));
  if (!read.ok) throw new Error('fixture');
  return read.package;
}
function xml(pkg: OoxmlPackage): string {
  return strFromU8(unzipSync(writeOoxmlPackage(pkg))['word/numbering.xml']!);
}
function reopened(pkg: OoxmlPackage): OoxmlPackage {
  const read = readOoxmlPackage(writeOoxmlPackage(pkg));
  if (!read.ok) throw new Error('reopen');
  return read.package;
}

describe('list instance authoring', () => {
  test('new list counters stay independent and format edits do not alter their shared template', () => {
    const first = createAutomationList(initial())!;
    const second = createAutomationList(first.pkg)!;
    expect(first.numId).not.toBe(second.numId);
    const before = xml(second.pkg);
    const changed = formatAutomationListLevel(second.pkg, first.numId, 0, {
      numbering: 'Arabic',
      startingNumber: 7,
      textIndent: 36,
      bulletNumberPictureIndent: -18,
    })!;
    expect(changed).not.toBeNull();
    const saved = xml(reopened(changed));
    expect(saved).toContain('<w:start w:val="7"');
    expect(saved).toContain('<w:numFmt w:val="decimal"');
    expect(saved).toContain('<w:ind w:hanging="360" w:left="720"');
    const abstract = (text: string) => text.match(/<w:abstractNum\b[\s\S]*?<\/w:abstractNum>/g);
    expect(abstract(saved)).toEqual(abstract(before));
    const instance = (text: string, id: string) =>
      text.match(new RegExp(`<w:num w:numId="${id}">[\\s\\S]*?</w:num>`))?.[0];
    expect(instance(saved, second.numId)).toEqual(instance(before, second.numId));
  });

  test('custom bullets escape XML and later numbering preserves prior indent and starting number', () => {
    const list = createAutomationList(initial())!;
    const bullet = formatAutomationListLevel(list.pkg, list.numId, 1, {
      bullet: 'Custom',
      charCode: 38,
      fontName: 'A & B',
      textIndent: 72,
      bulletNumberPictureIndent: -12,
      startingNumber: 3,
    })!;
    expect(xml(reopened(bullet))).toContain('w:val="&amp;"');
    expect(xml(bullet)).toContain('w:ascii="A &amp; B"');
    const number = formatAutomationListLevel(bullet, list.numId, 1, {
      numbering: 'LowerLetter',
      formatString: ['(', 0, '.', 1, ')'],
    })!;
    expect(xml(reopened(number))).toContain('w:val="(%1.%2)"');
    expect(xml(number)).toContain('<w:start w:val="3"');
    expect(xml(number)).toContain('w:hanging="240" w:left="1440"');
  });

  test('invalid formats refuse without changing input package', () => {
    const list = createAutomationList(initial())!;
    const before = xml(list.pkg);
    expect(formatAutomationListLevel(list.pkg, list.numId, 9, { numbering: 'Arabic' })).toBeNull();
    expect(
      formatAutomationListLevel(list.pkg, list.numId, 0, { bullet: 'Custom', charCode: 0 })
    ).toBeNull();
    expect(
      formatAutomationListLevel(list.pkg, list.numId, 0, { numbering: 'Arabic', formatString: [1] })
    ).toBeNull();
    expect(validAutomationListFormat(0, { startingNumber: NaN })).toBe(false);
    expect(validAutomationListFormat(0, { textIndent: Infinity })).toBe(false);
    expect(xml(list.pkg)).toBe(before);
  });
});

test('new lists complete incomplete imported templates through private instance levels', () => {
  const initialList = createAutomationList(initial())!;
  const files = unzipSync(writeOoxmlPackage(initialList.pkg));
  files['word/numbering.xml'] = strToU8(
    strFromU8(files['word/numbering.xml']!).replace(/<w:lvl w:ilvl="[1-8]">[\s\S]*?<\/w:lvl>/g, '')
  );
  const imported = readOoxmlPackage(zipSync(files));
  if (!imported.ok) throw new Error('import fixture');
  expect(automationListLevelExists(imported.package, initialList.numId, 1)).toBe(false);
  const created = createAutomationList(imported.package)!;
  const saved = reopened(created.pkg);
  for (let level = 0; level < 9; level++)
    expect(automationListLevelExists(saved, created.numId, level)).toBe(true);
  expect(automationListLevelExists(saved, initialList.numId, 1)).toBe(false);
});
