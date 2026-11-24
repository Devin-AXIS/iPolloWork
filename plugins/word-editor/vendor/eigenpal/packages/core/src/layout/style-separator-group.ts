import { framedTokenJoin } from './layout-cache.ts';
import type { OoxmlElement, OoxmlNode, OoxmlProperty } from '@docx-editor.dev/core/store';

export interface StyleSeparatorMember {
  readonly paragraph: OoxmlElement;
  readonly base: number;
  readonly runProperties: readonly OoxmlProperty[];
}
const groups = new WeakMap<OoxmlNode, readonly StyleSeparatorMember[]>();
export function registerStyleSeparatorGroup(
  paragraph: OoxmlElement,
  members: readonly StyleSeparatorMember[]
): void {
  groups.set(paragraph, members);
}
export function styleSeparatorMembersOf(
  paragraph: OoxmlNode
): readonly StyleSeparatorMember[] | undefined {
  return groups.get(paragraph);
}

export function styleSeparatorRanges<T extends { readonly start: number; readonly end: number }>(
  paragraph: OoxmlElement,
  ranges: ReadonlyMap<string, readonly T[]> | undefined
): readonly T[] | undefined {
  const members = groups.get(paragraph);
  if (!members) return ranges?.get(paragraph.id);
  const result: T[] = [];
  for (const member of members)
    for (const range of ranges?.get(member.paragraph.id) ?? [])
      result.push({ ...range, start: range.start + member.base, end: range.end + member.base });
  return result.length ? result : undefined;
}

export function styleSeparatorToken(
  paragraph: OoxmlElement,
  token: ((paragraph: OoxmlElement) => string) | undefined | null
): string {
  if (!token) return '';
  const members = groups.get(paragraph);
  if (!members) return token(paragraph);
  const tokens = members.map((member) => token(member.paragraph));
  return tokens.some(Boolean) ? framedTokenJoin(tokens) : '';
}
const sourceBlockMemos = new WeakMap<readonly OoxmlElement[], readonly OoxmlElement[]>();
export function styleSeparatorSourceBlocks(
  blocks: readonly OoxmlElement[]
): readonly OoxmlElement[] {
  const cached = sourceBlockMemos.get(blocks);
  if (cached) return cached;
  if (!blocks.some((block) => groups.has(block))) return blocks;
  const result: OoxmlElement[] = [];
  for (const block of blocks) {
    const members = groups.get(block);
    if (members) for (const member of members) result.push(member.paragraph);
    else result.push(block);
  }
  sourceBlockMemos.set(blocks, result);
  return result;
}
