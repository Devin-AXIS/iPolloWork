// Number formats Word paints that we used to render as a plain decimal (ST_NumberFormat,
// §17.18.59) plus `w:isLgl` legal numbering (§17.9.9).

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readOoxmlPackage, readOoxmlPart } from '@docx-editor.dev/core/store';
import {
  expandLvlText,
  formatCardinalText,
  formatChicago,
  formatHex,
  formatNumFmt,
  formatOrdinal,
  formatOrdinalText,
} from '../numbering-format.ts';
import { buildNumberingIndex, resolveNumberingLevel } from '../numbering-index.ts';
import { createListCounterState } from '../list-counters.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const LETTERHEAD = resolve(
  import.meta.dir,
  '../../../../../e2e/fixtures/issue-705-anchored-header-letterhead.docx'
);

function numbering(body: string) {
  const result = readOoxmlPart(`<w:numbering xmlns:w="${W}">${body}</w:numbering>`, {
    name: '/word/numbering.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return buildNumberingIndex(result.part.root);
}

function fixtureIndex() {
  const loaded = readOoxmlPackage(new Uint8Array(readFileSync(LETTERHEAD)));
  if (!loaded.ok) throw new Error(loaded.reason);
  return buildNumberingIndex(loaded.package.parts.get('/word/numbering.xml')!.root);
}

describe('w:numFmt="none"', () => {
  test('prints nothing at all', () => {
    expect(formatNumFmt('none', 7)).toBe('');
  });

  test('leaves the literal part of lvlText standing', () => {
    expect(expandLvlText('Chapter %1 —', [4], ['none'])).toBe('Chapter  —');
  });

  test('a none level marks its paragraph with literal text, not a number', () => {
    const index = numbering(`
      <w:abstractNum w:abstractNumId="1">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="none"/><w:lvlText w:val="%1"/>
          <w:lvlJc w:val="left"/></w:lvl>
      </w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
    `);
    const state = createListCounterState(index);
    expect(state.advance('1', 0)?.markerText).toBe('');
    expect(state.advance('1', 0)?.markerText).toBe('');
  });

  test('the letterhead fixture declares none levels under a numbered heading list', () => {
    const index = fixtureIndex();
    // numId 15 → abstractNum 13: Heading1–4 are numbered, Heading5–9 are `none`.
    expect(resolveNumberingLevel(index, '15', 0)?.level.numFmt).toBe('upperRoman');
    expect(resolveNumberingLevel(index, '15', 4)?.level.numFmt).toBe('none');
    const state = createListCounterState(index);
    state.advance('15', 0);
    expect(state.advance('15', 4)?.markerText).toBe('');
  });
});

describe('text and symbol number formats', () => {
  test('ordinal', () => {
    expect(formatOrdinal(1)).toBe('1st');
    expect(formatOrdinal(2)).toBe('2nd');
    expect(formatOrdinal(3)).toBe('3rd');
    expect(formatOrdinal(4)).toBe('4th');
    expect(formatOrdinal(11)).toBe('11th');
    expect(formatOrdinal(12)).toBe('12th');
    expect(formatOrdinal(13)).toBe('13th');
    expect(formatOrdinal(21)).toBe('21st');
    expect(formatNumFmt('ordinal', 22)).toBe('22nd');
  });

  test('cardinalText', () => {
    expect(formatCardinalText(1)).toBe('One');
    expect(formatCardinalText(13)).toBe('Thirteen');
    expect(formatCardinalText(23)).toBe('Twenty-three');
    expect(formatCardinalText(100)).toBe('One hundred');
    expect(formatCardinalText(101)).toBe('One hundred one');
    expect(formatNumFmt('cardinalText', 2)).toBe('Two');
  });

  test('ordinalText', () => {
    expect(formatOrdinalText(1)).toBe('First');
    expect(formatOrdinalText(2)).toBe('Second');
    expect(formatOrdinalText(3)).toBe('Third');
    expect(formatOrdinalText(5)).toBe('Fifth');
    expect(formatOrdinalText(9)).toBe('Ninth');
    expect(formatOrdinalText(12)).toBe('Twelfth');
    expect(formatOrdinalText(20)).toBe('Twentieth');
    expect(formatOrdinalText(23)).toBe('Twenty-third');
    expect(formatNumFmt('ordinalText', 101)).toBe('One hundred first');
  });

  test('hex is uppercase', () => {
    expect(formatHex(10)).toBe('A');
    expect(formatHex(255)).toBe('FF');
    expect(formatNumFmt('hex', 16)).toBe('10');
  });

  test('chicago cycles four marks and doubles them', () => {
    expect(formatChicago(1)).toBe('*');
    expect(formatChicago(2)).toBe('†');
    expect(formatChicago(3)).toBe('‡');
    expect(formatChicago(4)).toBe('§');
    expect(formatChicago(5)).toBe('**');
    expect(formatChicago(8)).toBe('§§');
    expect(formatNumFmt('chicago', 9)).toBe('***');
    // A hostile counter cannot grow the string without bound.
    expect(formatChicago(9999).length).toBeLessThanOrEqual(8);
  });

  test('numberInDash brackets the number', () => {
    expect(formatNumFmt('numberInDash', 3)).toBe('- 3 -');
  });
});

describe('w:isLgl legal numbering', () => {
  test('renders every referenced level in decimal', () => {
    const index = numbering(`
      <w:abstractNum w:abstractNumId="1">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="upperRoman"/>
          <w:lvlText w:val="%1."/><w:lvlJc w:val="left"/></w:lvl>
        <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:isLgl/>
          <w:lvlText w:val="%1.%2"/><w:lvlJc w:val="left"/></w:lvl>
      </w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
    `);
    expect(resolveNumberingLevel(index, '1', 1)?.level.isLgl).toBe(true);
    const state = createListCounterState(index);
    // The level's OWN format is decimal too, and the parent's upperRoman becomes 1.
    expect(state.advance('1', 0)?.markerText).toBe('I.');
    expect(state.advance('1', 1)?.markerText).toBe('1.1');
  });

  test('a level without w:isLgl keeps its authored formats', () => {
    const index = numbering(`
      <w:abstractNum w:abstractNumId="1">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="upperRoman"/>
          <w:lvlText w:val="%1."/><w:lvlJc w:val="left"/></w:lvl>
        <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/>
          <w:lvlText w:val="%1.%2"/><w:lvlJc w:val="left"/></w:lvl>
      </w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
    `);
    const state = createListCounterState(index);
    state.advance('1', 0);
    expect(state.advance('1', 1)?.markerText).toBe('I.a');
  });

  test('the letterhead fixture ArticleSection list is legal-numbered', () => {
    const index = fixtureIndex();
    // numId 14 → abstractNum 11: `Abschnitt %1.%2` with upperRoman + decimalZero + isLgl.
    expect(resolveNumberingLevel(index, '14', 1)?.level.isLgl).toBe(true);
    const state = createListCounterState(index);
    expect(state.advance('14', 0)?.markerText).toBe('Artikel I.');
    expect(state.advance('14', 1)?.markerText).toBe('Abschnitt 1.1');
  });
});
