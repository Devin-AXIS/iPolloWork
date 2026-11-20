import { pinyin } from 'pinyin-pro';

export function avatarInitial(name: string) {
  const letter = name.normalize('NFKC').match(/\p{L}/u)?.[0];
  if (!letter) return '?';
  const romanized = /\p{Script=Han}/u.test(letter)
    ? pinyin(letter, { pattern: 'first', surname: 'head', toneType: 'none' })
    : letter;
  return romanized.normalize('NFKD').toUpperCase().match(/[A-Z]/)?.[0] ?? '?';
}
