// A composed edit carried onto a paragraph a collaborator changed while it was composed.
//
// `base` is what the page showed when the composition began, `painted` what it shows at the
// end, and `current` the model's text by then. The result must hold both edits, and the
// composed text must never delete what the collaborator wrote.

import { describe, expect, test } from 'bun:test';
import { rebaseComposedText, rebaseOffset } from '../surface-composition-rebase.ts';

describe('rebaseComposedText', () => {
  test('nothing changed meanwhile: the page is the answer', () => {
    expect(rebaseComposedText('우리나라 ', '우리나라 아', '우리나라 ', 5)).toBe('우리나라 아');
  });

  test('nothing was composed: the model is the answer', () => {
    expect(rebaseComposedText('우리나라 ', '우리나라 ', 'A우리나라 ', 5)).toBe('A우리나라 ');
  });

  test('a remote insert before the composition moves it along', () => {
    expect(rebaseComposedText('우리나라 ', '우리나라 아', 'A우리나라 ', 5)).toBe('A우리나라 아');
  });

  test('a remote insert after the composition leaves it in place', () => {
    expect(rebaseComposedText('ab', 'a中b', 'abZ', 1)).toBe('a中bZ');
  });

  test('both at the same offset: the composed text keeps its place before the remote text', () => {
    expect(rebaseComposedText('ab', 'a中b', 'aXb', 1)).toBe('a中Xb');
  });

  test('the caret decides an ambiguous insert', () => {
    // `에` composed before `에서`: a plain diff calls it an insert after the first `에`.
    expect(rebaseComposedText('에서', '에에서', '!에서', 0)).toBe('에!에서');
    expect(rebaseComposedText('에서', '에에서', '!에서', null)).toBe('!에에서');
  });

  test('a remote delete around the caret keeps the composed text', () => {
    expect(rebaseComposedText('abcd', 'ab中cd', 'ad', 2)).toBe('a中d');
  });

  test('a candidate that replaces selected text never deletes remote text', () => {
    // The composition replaced "bc"; meanwhile a collaborator replaced "c" with "X".
    expect(rebaseComposedText('abcd', 'a日本d', 'abXd', null)).toBe('a日本Xd');
  });

  test('a range replaced while a collaborator edits inside it and elsewhere', () => {
    expect(rebaseComposedText('abcd', 'a日本d', 'ZabXd', null)).toBe('Za日本Xd');
    expect(rebaseComposedText('abc かな def', 'abc 仮名 def', 'Zabc かX defZ', null)).toBe(
      'Zabc 仮名X defZ'
    );
  });

  test('remote edits on both sides of the caret leave the composed text at the caret', () => {
    expect(rebaseComposedText('Hello world', 'HelloX world', 'AHello worldB', 5)).toBe(
      'AHelloX worldB'
    );
  });

  test('a reconversion replaces its own text while remote edits land around it', () => {
    expect(rebaseComposedText('abc かな def', 'abc 仮名 def', 'Zabc かな defZ', null)).toBe(
      'Zabc 仮名 defZ'
    );
  });

  test('a remote delete of the whole paragraph keeps the composed text', () => {
    expect(rebaseComposedText('abc', 'abc中', '', 3)).toBe('中');
  });
});

describe('rebaseOffset', () => {
  test('before and after the remote change', () => {
    expect(rebaseOffset('abcd', 'aXYd', 1)).toBe(1);
    expect(rebaseOffset('abcd', 'aXYZd', 4)).toBe(5);
    expect(rebaseOffset('abcd', 'abcd', 2)).toBe(2);
  });
});
