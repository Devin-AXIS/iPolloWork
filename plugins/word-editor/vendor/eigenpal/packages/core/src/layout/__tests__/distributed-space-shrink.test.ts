// A distributed line in a modern compatibility mode shrinks its inter-word spaces to keep one
// more word only when each space loses at most a third of what the line without that word
// would add to it. The test counts half the advance of a final mark that may hang; the mark
// then stays inside when the spaces make room for it, and hangs beside spaces at their floor.
import { describe, expect, test } from 'bun:test';
import { loadFixture, measurer } from './punctuation-kerning-fixture.ts';
import { caretAt } from '../semantic-interaction.ts';

// Every character, a space too, is 24 pt. Six words and their spaces take 432 pt; each space
// can shrink by 6 pt (to 75 percent). The line without the seventh word stretches its five
// inner spaces (the sixth hangs).
const load = (text: string, available: number, jc: 'distribute' | 'both' = 'distribute') =>
  loadFixture({
    text,
    available,
    language: 'zh-CN',
    compatibility: 15,
    paragraphProperties: `<w:jc w:val="${jc}"/>`,
  });
const texts = (result: ReturnType<typeof loadFixture>) =>
  result.lines.map((line) => line.spans.map((span) => span.text).join(''));
const caretX = (result: ReturnType<typeof loadFixture>, offset: number) => {
  const line = result.lines[0]!;
  return (
    caretAt(result.layout, { paragraphId: line.range.paragraphId, offset }, measurer)!.x -
    line.box.x
  );
};
const WORDS = 'aa aa aa aa aa aa aa aa';

describe('a distributed line weighs a shrunk space as three stretched ones', () => {
  test('a word that a justified line keeps moves to the next distributed line', () => {
    // 456 pt: the seventh word needs 24 pt, a sixth of every space. The line without it would
    // stretch each inner space by 40 percent: more than twice the shrink, less than three times.
    expect(texts(load(WORDS, 456, 'both'))[0]).toBe('aa aa aa aa aa aa aa ');
    expect(texts(load(WORDS, 456))[0]).toBe('aa aa aa aa aa aa ');
  });

  test('the word joins once each space loses at most a third of the stretch', () => {
    expect(texts(load(WORDS, 460))[0]).toBe('aa aa aa aa aa aa aa ');
  });
});

describe('a distributed line counts half of a final mark that may hang', () => {
  // Three words and their spaces take 216 pt; the three spaces lend 18 pt at their floor.
  const SHORT = 'aa aa aa aa, aa';

  test('the mark hangs beside spaces at their floor', () => {
    // 252 pt: `aa,` fits only past the floor, but `aa` fits within it. With half the comma,
    // each space loses less than a third of what the line without the word adds to it; with
    // the whole comma, it would lose more.
    const result = load(SHORT, 252);
    expect(texts(result)).toEqual(['aa aa aa aa, ', 'aa']);
    expect(caretX(result, 11)).toBeCloseTo(252, 6);
    expect(caretX(result, 12)).toBeCloseTo(276, 6);
  });

  test('the word wraps when even half the mark costs too much', () => {
    // 247 pt: without the comma the word would pass; with half of it, it does not.
    expect(texts(load(SHORT, 247))[0]).toBe('aa aa aa ');
  });

  test('the mark stays inside when the spaces make room for it', () => {
    const result = load('aa aa aa aa aa aa aa, aa', 470);
    expect(texts(result)).toEqual(['aa aa aa aa aa aa aa, ', 'aa']);
    expect(caretX(result, 21)).toBeCloseTo(470, 6);
  });
});
