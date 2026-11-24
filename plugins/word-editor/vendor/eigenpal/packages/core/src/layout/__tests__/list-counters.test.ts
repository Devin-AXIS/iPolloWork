import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { buildNumberingIndex } from '../numbering-index.ts';
import { createListCounterState, loadListCounters, saveListCounters } from '../list-counters.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function loadNumbering(body: string) {
  const result = readOoxmlPart(`<w:numbering xmlns:w="${W}">${body}</w:numbering>`, {
    name: '/word/numbering.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return buildNumberingIndex(result.part.root);
}

const DECIMAL = `
  <w:abstractNum w:abstractNumId="1">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>
      <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2)"/>
      <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="1"/>
    <w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/>
    <w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>
`;

describe('list counters', () => {
  test('increments and formats nested levels', () => {
    const index = loadNumbering(DECIMAL);
    const state = createListCounterState(index);
    expect(state.advance('1', 0)?.markerText).toBe('1.');
    expect(state.advance('1', 0)?.markerText).toBe('2.');
    expect(state.advance('1', 1)?.markerText).toBe('a)');
    expect(state.advance('1', 1)?.markerText).toBe('b)');
    expect(state.advance('1', 0)?.markerText).toBe('3.');
    // Deeper level restarted after returning to level 0.
    expect(state.advance('1', 1)?.markerText).toBe('a)');
  });

  test('startOverride applies only on first encounter of a numId', () => {
    const index = loadNumbering(`
      <w:abstractNum w:abstractNumId="1">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>
          <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
      </w:abstractNum>
      <w:num w:numId="9"><w:abstractNumId w:val="1"/>
        <w:lvlOverride w:ilvl="0"><w:startOverride w:val="5"/></w:lvlOverride></w:num>
    `);
    const state = createListCounterState(index);
    expect(state.advance('9', 0)?.markerText).toBe('5.');
    expect(state.advance('9', 0)?.markerText).toBe('6.');
    // Reusing the same numId keeps counting; override is not reapplied.
    expect(state.advance('9', 0)?.markerText).toBe('7.');
  });

  test('nested startOverride restarts at authored start after parent transition', () => {
    const index = loadNumbering(`
      <w:abstractNum w:abstractNumId="1">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>
          <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
        <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%2."/>
          <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>
      </w:abstractNum>
      <w:num w:numId="9"><w:abstractNumId w:val="1"/>
        <w:lvlOverride w:ilvl="1"><w:startOverride w:val="5"/></w:lvlOverride></w:num>
    `);
    const state = createListCounterState(index);
    expect(state.advance('9', 0)?.markerText).toBe('1.');
    expect(state.advance('9', 1)?.markerText).toBe('5.');
    expect(state.advance('9', 1)?.markerText).toBe('6.');
    expect(state.advance('9', 0)?.markerText).toBe('2.');
    expect(state.advance('9', 1)?.markerText).toBe('5.');
  });

  test('each numId restarts a nested level at its own startOverride baseline', () => {
    const index = loadNumbering(`
      <w:abstractNum w:abstractNumId="1">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>
          <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
        <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%2."/>
          <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>
      </w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="1"/>
        <w:lvlOverride w:ilvl="1"><w:startOverride w:val="5"/></w:lvlOverride></w:num>
      <w:num w:numId="2"><w:abstractNumId w:val="1"/>
        <w:lvlOverride w:ilvl="1"><w:startOverride w:val="9"/></w:lvlOverride></w:num>
    `);
    const state = createListCounterState(index);
    expect(state.advance('1', 0)?.markerText).toBe('1.');
    expect(state.advance('1', 1)?.markerText).toBe('5.');
    // Level 0 is shared and has no override on numId 2, so it continues.
    expect(state.advance('2', 0)?.markerText).toBe('2.');
    expect(state.advance('2', 1)?.markerText).toBe('9.');
    expect(state.advance('1', 0)?.markerText).toBe('3.');
    expect(state.advance('1', 1)?.markerText).toBe('5.');
    expect(state.advance('2', 0)?.markerText).toBe('4.');
    expect(state.advance('2', 1)?.markerText).toBe('9.');
  });

  test('startOverride on deep levels restarts after repeated parent transitions', () => {
    const index = loadNumbering(`
      <w:abstractNum w:abstractNumId="1">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>
          <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
        <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%2."/>
          <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>
        <w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%3."/>
          <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="2160" w:hanging="360"/></w:pPr></w:lvl>
      </w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="1"/>
        <w:lvlOverride w:ilvl="2"><w:startOverride w:val="7"/></w:lvlOverride></w:num>
    `);
    const state = createListCounterState(index);
    expect(state.advance('1', 0)?.markerText).toBe('1.');
    expect(state.advance('1', 2)?.markerText).toBe('7.');
    expect(state.advance('1', 2)?.markerText).toBe('8.');
    expect(state.advance('1', 0)?.markerText).toBe('2.');
    expect(state.advance('1', 2)?.markerText).toBe('7.');
    // The level 2 item above counted the level 1 it skipped, so level 1 goes on at 2.
    expect(state.advance('1', 1)?.markerText).toBe('2.');
    expect(state.advance('1', 2)?.markerText).toBe('7.');
    expect(state.advance('1', 0)?.markerText).toBe('3.');
    expect(state.advance('1', 2)?.markerText).toBe('7.');
  });

  test('default starts restart to one after parent transition', () => {
    const index = loadNumbering(DECIMAL);
    const state = createListCounterState(index);
    expect(state.advance('1', 0)?.markerText).toBe('1.');
    expect(state.advance('1', 1)?.markerText).toBe('a)');
    expect(state.advance('1', 1)?.markerText).toBe('b)');
    expect(state.advance('1', 0)?.markerText).toBe('2.');
    expect(state.advance('1', 1)?.markerText).toBe('a)');
  });

  test('a deeper item counts each parent level it skips once, at its start', () => {
    const index = loadNumbering(`
      <w:abstractNum w:abstractNumId="1">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>
        <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%2)"/></w:lvl>
        <w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%3]"/></w:lvl>
      </w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
    `);
    const markers = (levels: readonly number[]) => {
      const state = createListCounterState(index);
      return levels.map((ilvl) => state.advance('1', ilvl)?.markerText);
    };
    expect(markers([1, 0, 0, 2, 1, 0])).toEqual(['1)', '2.', '3.', '1]', '2)', '4.']);
    expect(markers([2, 1, 0, 0, 2, 2, 0])).toEqual(['1]', '2)', '2.', '3.', '1]', '2]', '4.']);
  });

  test('a startOverride restarts the counter its abstract list shares', () => {
    const index = loadNumbering(DECIMAL);
    const state = createListCounterState(index);
    expect(state.advance('1', 0)?.markerText).toBe('1.');
    expect(state.advance('1', 0)?.markerText).toBe('2.');
    // numId 2 shares abstractNum 1; its startOverride restarts the shared level.
    expect(state.advance('2', 0)?.markerText).toBe('1.');
    expect(state.advance('2', 0)?.markerText).toBe('2.');
    // numId 1 continues from the restarted count. Its own override was spent on first use.
    expect(state.advance('1', 0)?.markerText).toBe('3.');
  });

  test('lvlRestart=0 keeps a deeper level running across shallower reuse', () => {
    const index = loadNumbering(`
      <w:abstractNum w:abstractNumId="1">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>
          <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
        <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2)"/>
          <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>
        <w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="lowerRoman"/><w:lvlText w:val="%3)"/>
          <w:lvlRestart w:val="0"/>
          <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="2160" w:hanging="360"/></w:pPr></w:lvl>
      </w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
    `);
    const state = createListCounterState(index);
    expect(state.advance('1', 0)?.markerText).toBe('1.');
    expect(state.advance('1', 1)?.markerText).toBe('a)');
    expect(state.advance('1', 2)?.markerText).toBe('i)');
    expect(state.advance('1', 0)?.markerText).toBe('2.');
    // level 1 restarts (default), level 2 continues.
    expect(state.advance('1', 1)?.markerText).toBe('a)');
    expect(state.advance('1', 2)?.markerText).toBe('ii)');
  });

  test('lvlRestart one-based trigger restarts when that level is used', () => {
    const index = loadNumbering(`
      <w:abstractNum w:abstractNumId="1">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>
          <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
        <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2)"/>
          <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>
        <w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="lowerRoman"/><w:lvlText w:val="%3)"/>
          <w:lvlRestart w:val="1"/>
          <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="2160" w:hanging="360"/></w:pPr></w:lvl>
      </w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
    `);
    const state = createListCounterState(index);
    expect(state.advance('1', 0)?.markerText).toBe('1.');
    expect(state.advance('1', 2)?.markerText).toBe('i)');
    // Using level 0 restarts level 2 (trigger level 1 or earlier).
    expect(state.advance('1', 0)?.markerText).toBe('2.');
    expect(state.advance('1', 2)?.markerText).toBe('i)');
  });

  test('level override start replaces abstract start on first use', () => {
    const index = loadNumbering(`
      <w:abstractNum w:abstractNumId="1">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>
          <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
      </w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="1"/>
        <w:lvlOverride w:ilvl="0">
          <w:lvl w:ilvl="0"><w:start w:val="10"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>
            <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
        </w:lvlOverride></w:num>
    `);
    const state = createListCounterState(index);
    expect(state.advance('1', 0)?.markerText).toBe('10.');
    expect(state.advance('1', 0)?.markerText).toBe('11.');
  });

  test('missing definitions fail inertly', () => {
    const index = loadNumbering(DECIMAL);
    const state = createListCounterState(index);
    expect(state.advance('999', 0)).toBeNull();
    expect(state.advance('1', 9)).toBeNull();
  });

  test('abstract start=0 emits zero then increments', () => {
    const index = loadNumbering(`
      <w:abstractNum w:abstractNumId="1">
        <w:lvl w:ilvl="0"><w:start w:val="0"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>
          <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
      </w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
    `);
    const state = createListCounterState(index);
    expect(state.advance('1', 0)?.markerText).toBe('0.');
    expect(state.advance('1', 0)?.markerText).toBe('1.');
    expect(state.advance('1', 0)?.markerText).toBe('2.');
  });

  test('startOverride=0 emits zero then increments', () => {
    const index = loadNumbering(`
      <w:abstractNum w:abstractNumId="1">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>
          <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
      </w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="1"/>
        <w:lvlOverride w:ilvl="0"><w:startOverride w:val="0"/></w:lvlOverride></w:num>
    `);
    const state = createListCounterState(index);
    expect(state.advance('1', 0)?.markerText).toBe('0.');
    expect(state.advance('1', 0)?.markerText).toBe('1.');
    expect(state.advance('1', 0)?.markerText).toBe('2.');
  });

  test('nested restart restores zero baseline after parent transition', () => {
    const index = loadNumbering(`
      <w:abstractNum w:abstractNumId="1">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>
          <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
        <w:lvl w:ilvl="1"><w:start w:val="0"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%2."/>
          <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>
      </w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
    `);
    const state = createListCounterState(index);
    expect(state.advance('1', 0)?.markerText).toBe('1.');
    expect(state.advance('1', 1)?.markerText).toBe('0.');
    expect(state.advance('1', 1)?.markerText).toBe('1.');
    expect(state.advance('1', 0)?.markerText).toBe('2.');
    expect(state.advance('1', 1)?.markerText).toBe('0.');
    expect(state.advance('1', 1)?.markerText).toBe('1.');
  });

  test('ordinary start=1 regression', () => {
    const index = loadNumbering(DECIMAL);
    const state = createListCounterState(index);
    expect(state.advance('1', 0)?.markerText).toBe('1.');
    expect(state.advance('1', 0)?.markerText).toBe('2.');
    expect(state.advance('1', 0)?.markerText).toBe('3.');
  });
});

/** One abstract list (decimal `%1.`, letter `%2)`) and the given `w:num` entries. */
function sharedAbstract(nums: string, levelOneExtra = ''): ReturnType<typeof loadNumbering> {
  return loadNumbering(`
    <w:abstractNum w:abstractNumId="1">
      <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>
        <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
      <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/>${levelOneExtra}
        <w:lvlText w:val="%2)"/><w:lvlJc w:val="left"/>
        <w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>
    </w:abstractNum>
    ${nums}
  `);
}

const restartAt = (ilvl: number, value: number, level = ''): string =>
  `<w:lvlOverride w:ilvl="${ilvl}"><w:startOverride w:val="${value}"/>${level}</w:lvlOverride>`;

function markers(
  index: ReturnType<typeof loadNumbering>,
  sequence: ReadonlyArray<readonly [string, number]>
): string[] {
  const state = createListCounterState(index);
  return sequence.map(([numId, ilvl]) => state.advance(numId, ilvl)?.markerText ?? '');
}

describe('list counters shared by an abstract list', () => {
  test('a w:num without overrides continues the list it shares a definition with', () => {
    const index = sharedAbstract(
      '<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>' +
        '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>'
    );
    expect(
      markers(index, [
        ['1', 0],
        ['1', 0],
        ['2', 0],
        ['1', 0],
      ])
    ).toEqual(['1.', '2.', '3.', '4.']);
  });

  test('a later item of the first w:num continues from a restart on another w:num', () => {
    const index = sharedAbstract(
      '<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>' +
        `<w:num w:numId="2"><w:abstractNumId w:val="1"/>${restartAt(0, 1)}</w:num>`
    );
    expect(
      markers(index, [
        ['1', 0],
        ['1', 0],
        ['2', 0],
        ['1', 0],
        ['2', 0],
      ])
    ).toEqual(['1.', '2.', '1.', '2.', '3.']);
  });

  test('a restart value other than one carries the shared count on', () => {
    const index = sharedAbstract(
      '<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>' +
        `<w:num w:numId="2"><w:abstractNumId w:val="1"/>${restartAt(0, 5)}</w:num>`
    );
    expect(
      markers(index, [
        ['2', 0],
        ['2', 0],
        ['1', 0],
      ])
    ).toEqual(['5.', '6.', '7.']);
  });

  test('the restart waits for the first item on an overridden level', () => {
    const index = sharedAbstract(
      '<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>' +
        `<w:num w:numId="2"><w:abstractNumId w:val="1"/>${restartAt(0, 5)}</w:num>`
    );
    expect(
      markers(index, [
        ['1', 0],
        ['1', 0],
        ['2', 1],
        ['1', 0],
        ['2', 0],
      ])
    ).toEqual(['1.', '2.', 'a)', '3.', '5.']);
  });

  test('the restart applies once, to the first overridden level the w:num uses', () => {
    const restartEveryLevel = restartAt(0, 1) + restartAt(1, 1);
    const index = sharedAbstract(
      '<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>' +
        `<w:num w:numId="2"><w:abstractNumId w:val="1"/>${restartEveryLevel}</w:num>`
    );
    expect(
      markers(index, [
        ['1', 0],
        ['1', 1],
        ['1', 0],
        ['2', 1],
        ['2', 0],
        ['2', 1],
        ['1', 0],
      ])
    ).toEqual(['1.', 'a)', '2.', 'a)', '3.', 'a)', '4.']);
  });

  test('a spent restart does not reset a deeper level that never restarts', () => {
    const index = sharedAbstract(
      '<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>' +
        `<w:num w:numId="2"><w:abstractNumId w:val="1"/>${restartAt(0, 1)}${restartAt(1, 1)}</w:num>`,
      '<w:lvlRestart w:val="0"/>'
    );
    expect(
      markers(index, [
        ['1', 0],
        ['1', 1],
        ['1', 1],
        ['2', 0],
        ['2', 1],
      ])
    ).toEqual(['1.', 'a)', 'b)', '1.', 'c)']);
  });

  test('a level that starts again after its parent takes the counting w:num start', () => {
    const index = sharedAbstract(
      '<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>' +
        `<w:num w:numId="2"><w:abstractNumId w:val="1"/>${restartAt(1, 5)}</w:num>`
    );
    expect(
      markers(index, [
        ['1', 0],
        ['1', 1],
        ['2', 1],
        ['1', 0],
        ['1', 1],
        ['2', 0],
        ['2', 1],
      ])
    ).toEqual(['1.', 'a)', 'e)', '2.', 'a)', '3.', 'e)']);
  });

  test('a replacement level under a startOverride restarts at its own w:start', () => {
    const replacement =
      '<w:lvl w:ilvl="0"><w:start w:val="7"/><w:numFmt w:val="upperRoman"/>' +
      '<w:lvlText w:val="%1."/><w:lvlJc w:val="left"/></w:lvl>';
    const index = sharedAbstract(
      '<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>' +
        `<w:num w:numId="2"><w:abstractNumId w:val="1"/>${restartAt(0, 5, replacement)}</w:num>`
    );
    expect(
      markers(index, [
        ['1', 0],
        ['1', 0],
        ['2', 0],
        ['1', 0],
      ])
    ).toEqual(['1.', '2.', 'VII.', '8.']);
  });

  test('a resumed walk keeps a spent restart spent', () => {
    const index = sharedAbstract(
      '<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>' +
        `<w:num w:numId="2"><w:abstractNumId w:val="1"/>${restartAt(0, 1)}</w:num>`
    );
    const first = createListCounterState(index);
    first.advance('1', 0);
    first.advance('2', 0);
    const snapshot = saveListCounters(first);
    const resumed = createListCounterState(index);
    loadListCounters(resumed, snapshot);
    expect(resumed.advance('2', 0)?.markerText).toBe('2.');
    expect(resumed.advance('1', 0)?.markerText).toBe('3.');
  });
});
