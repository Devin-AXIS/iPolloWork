import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readOoxmlPackage, readOoxmlPart } from '@docx-editor.dev/core/store';
import { buildNumberingIndex, resolveNumberingLevel } from '../numbering-index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const FIXTURE = resolve(
  import.meta.dir,
  '../../../../../e2e/fixtures/comprehensive-word-element-test.docx'
);

describe('numbering index', () => {
  test('parses levels, formats, indents and overrides from a part', () => {
    const result = readOoxmlPart(
      `<w:numbering xmlns:w="${W}">
        <w:abstractNum w:abstractNumId="4">
          <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>
            <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>
            <w:rPr><w:b/></w:rPr></w:lvl>
          <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2)"/>
            <w:lvlJc w:val="center"/><w:suff w:val="space"/>
            <w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>
        </w:abstractNum>
        <w:num w:numId="4"><w:abstractNumId w:val="4"/>
          <w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>
      </w:numbering>`,
      { name: '/word/numbering.xml', contentType: 'app/xml' }
    );
    if (!result.ok) throw new Error(result.reason);
    const index = buildNumberingIndex(result.part.root);
    const level0 = resolveNumberingLevel(index, '4', 0);
    expect(level0?.level.numFmt).toBe('decimal');
    expect(level0?.level.lvlText).toBe('%1.');
    expect(level0?.level.indent.left).toBe(36);
    expect(level0?.level.indent.hanging).toBe(18);
    expect(level0?.startOverride).toBe(1);
    expect(level0?.level.runProperties.some((p) => p.localName === 'b')).toBe(true);

    const level1 = resolveNumberingLevel(index, '4', 1);
    expect(level1?.level.numFmt).toBe('lowerLetter');
    expect(level1?.level.lvlJc).toBe('center');
    expect(level1?.level.suff).toBe('space');
  });

  test('parses lvlRestart on levels', () => {
    const result = readOoxmlPart(
      `<w:numbering xmlns:w="${W}">
        <w:abstractNum w:abstractNumId="1">
          <w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="lowerRoman"/><w:lvlText w:val="%3)"/>
            <w:lvlRestart w:val="0"/><w:lvlJc w:val="left"/></w:lvl>
        </w:abstractNum>
        <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
      </w:numbering>`,
      { name: '/word/numbering.xml', contentType: 'app/xml' }
    );
    if (!result.ok) throw new Error(result.reason);
    const index = buildNumberingIndex(result.part.root);
    expect(resolveNumberingLevel(index, '1', 2)?.level.lvlRestart).toBe(0);
  });

  test('comprehensive fixture exposes bullet and numbered abstracts', () => {
    const loaded = readOoxmlPackage(new Uint8Array(readFileSync(FIXTURE)));
    if (!loaded.ok) throw new Error(loaded.reason);
    const part = loaded.package.parts.get('/word/numbering.xml');
    expect(part).toBeDefined();
    const index = buildNumberingIndex(part!.root);
    expect(index.nums.size).toBeGreaterThanOrEqual(7);
    expect(resolveNumberingLevel(index, '2', 0)?.level.numFmt).toBe('bullet');
    expect(resolveNumberingLevel(index, '3', 3)?.level.lvlText).toBe('–');
    expect(resolveNumberingLevel(index, '4', 2)?.level.numFmt).toBe('lowerRoman');
    expect(resolveNumberingLevel(index, '5', 0)?.level.numFmt).toBe('upperRoman');
    expect(resolveNumberingLevel(index, '6', 0)?.level.numFmt).toBe('upperLetter');
  });

  test('hostile / missing definitions resolve null', () => {
    const index = buildNumberingIndex(null);
    expect(resolveNumberingLevel(index, '1', 0)).toBeNull();
  });

  test('preserves legal zero start on abstract level', () => {
    const result = readOoxmlPart(
      `<w:numbering xmlns:w="${W}">
        <w:abstractNum w:abstractNumId="1">
          <w:lvl w:ilvl="0"><w:start w:val="0"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>
            <w:lvlJc w:val="left"/></w:lvl>
        </w:abstractNum>
        <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
      </w:numbering>`,
      { name: '/word/numbering.xml', contentType: 'app/xml' }
    );
    if (!result.ok) throw new Error(result.reason);
    const index = buildNumberingIndex(result.part.root);
    expect(resolveNumberingLevel(index, '1', 0)?.level.start).toBe(0);
  });

  test('preserves legal zero startOverride', () => {
    const result = readOoxmlPart(
      `<w:numbering xmlns:w="${W}">
        <w:abstractNum w:abstractNumId="1">
          <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>
            <w:lvlJc w:val="left"/></w:lvl>
        </w:abstractNum>
        <w:num w:numId="1"><w:abstractNumId w:val="1"/>
          <w:lvlOverride w:ilvl="0"><w:startOverride w:val="0"/></w:lvlOverride></w:num>
      </w:numbering>`,
      { name: '/word/numbering.xml', contentType: 'app/xml' }
    );
    if (!result.ok) throw new Error(result.reason);
    const index = buildNumberingIndex(result.part.root);
    expect(resolveNumberingLevel(index, '1', 0)?.startOverride).toBe(0);
  });

  test('rejects negative starts and clamps huge values', () => {
    const result = readOoxmlPart(
      `<w:numbering xmlns:w="${W}">
        <w:abstractNum w:abstractNumId="1">
          <w:lvl w:ilvl="0"><w:start w:val="-1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>
            <w:lvlJc w:val="left"/></w:lvl>
          <w:lvl w:ilvl="1"><w:start w:val="99999"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>
            <w:lvlJc w:val="left"/></w:lvl>
        </w:abstractNum>
        <w:num w:numId="1"><w:abstractNumId w:val="1"/>
          <w:lvlOverride w:ilvl="0"><w:startOverride w:val="-5"/></w:lvlOverride>
          <w:lvlOverride w:ilvl="1"><w:startOverride w:val="50000"/></w:lvlOverride></w:num>
      </w:numbering>`,
      { name: '/word/numbering.xml', contentType: 'app/xml' }
    );
    if (!result.ok) throw new Error(result.reason);
    const index = buildNumberingIndex(result.part.root);
    expect(resolveNumberingLevel(index, '1', 0)?.level.start).toBe(1);
    expect(resolveNumberingLevel(index, '1', 1)?.level.start).toBe(9999);
    expect(resolveNumberingLevel(index, '1', 0)?.startOverride).toBeUndefined();
    expect(resolveNumberingLevel(index, '1', 1)?.startOverride).toBe(9999);
  });
});
