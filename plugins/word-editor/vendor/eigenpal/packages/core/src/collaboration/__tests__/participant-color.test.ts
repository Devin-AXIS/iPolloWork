import { describe, expect, test } from 'bun:test';
import { safeParticipantColor } from '../participant-color.ts';

describe('safeParticipantColor', () => {
  test('keeps the two shapes the engine produces', () => {
    expect(safeParticipantColor('#abc')).toBe('#abc');
    expect(safeParticipantColor('#AABBCC')).toBe('#AABBCC');
    expect(safeParticipantColor('#aabbccdd')).toBe('#aabbccdd');
    expect(safeParticipantColor('var(--doc-review-author-0)')).toBe('var(--doc-review-author-0)');
    expect(safeParticipantColor('var(--doc-review-author-7)')).toBe('var(--doc-review-author-7)');
  });

  test('drops a color that would fetch from a host the peer names', () => {
    // The stylesheet consumes this property in a `background` shorthand, where `url(...)` is a
    // valid background image. A peer that gets this painted earns a GET from every replica.
    expect(safeParticipantColor('url(//attacker.example/t)')).toBeUndefined();
    expect(safeParticipantColor('red url(//attacker.example/t)')).toBeUndefined();
    expect(safeParticipantColor('image-set("//attacker.example/t")')).toBeUndefined();
  });

  test('drops a var() carrying an attacker-controlled fallback', () => {
    // The fallback substitutes verbatim too, so an allowlisted prefix is not enough.
    expect(safeParticipantColor('var(--doc-review-author-0, url(//a.example/t))')).toBeUndefined();
    expect(safeParticipantColor('var(--anything)')).toBeUndefined();
  });

  test('drops anything else, including plausible CSS colors it does not own', () => {
    expect(safeParticipantColor('rgb(1,2,3)')).toBeUndefined();
    expect(safeParticipantColor('hsl(1 2% 3%)')).toBeUndefined();
    expect(safeParticipantColor('red')).toBeUndefined();
    expect(safeParticipantColor('#12')).toBeUndefined();
    expect(safeParticipantColor('#1234567')).toBeUndefined();
    expect(safeParticipantColor('')).toBeUndefined();
    expect(safeParticipantColor(undefined)).toBeUndefined();
    expect(safeParticipantColor(`#${'a'.repeat(80)}`)).toBeUndefined();
  });
});
