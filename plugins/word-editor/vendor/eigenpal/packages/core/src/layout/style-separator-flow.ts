import { FieldResultsModeMemo } from '../store/package/field-result-mode.ts';
import { hasVisibleSeparatorText } from './style-separator-visible.ts';
import { paragraphIsRtl } from './rtl-paragraph.ts';
import { resolveCjkTypography } from './cjk-typography.ts';
import { paragraphKeeps } from './pagination-keeps.ts';
import type { OoxmlElement, OoxmlNode, OoxmlParagraphNode } from '@docx-editor.dev/core/store';
import { paragraphOffsetIndex } from '../store/store/tree-op-segments.ts';
import { WML_NAMESPACE_URI } from '../store/package/ooxml-tree.ts';
import { propertiesOfRunContainer } from './field-run-text.ts';
import {
  cascadeParagraphFormatting,
  resolveParagraphLayoutInputs,
  type StyleCascadeTable,
} from './style-cascade.ts';
import {
  registerStyleSeparatorGroup,
  styleSeparatorMembersOf,
  type StyleSeparatorMember,
} from './style-separator-group.ts';

import { resolveStoryListItems } from './list-resolve.ts';
import { EMPTY_NUMBERING_INDEX, type NumberingIndex } from './numbering-index.ts';

const MAX_MEMBERS = 64;
const MAX_MEMBER_NODES = 10000;
interface GroupMemo {
  styles: StyleCascadeTable | undefined;
  numberingIndex: NumberingIndex | undefined;
  members: readonly OoxmlElement[];
  merged: OoxmlElement;
}
/** Group offsets are model offsets: each field-result mode keeps its own entries. */
const groupMemos = new FieldResultsModeMemo<OoxmlElement, GroupMemo[]>();
const boundaryMemo = new WeakMap<OoxmlNode, boolean>();
interface MarkMemo {
  readonly hidden: boolean;
  readonly special: boolean;
}
// Note discovery and body layout can read the same paragraph with different cascades.
// Keep their immutable contexts separate so alternating passes do not evict each other.
const markMemos = new WeakMap<StyleCascadeTable, WeakMap<OoxmlElement, MarkMemo>>();
const unstyledMarkMemos = new WeakMap<OoxmlElement, MarkMemo>();
interface Entry {
  readonly block: OoxmlElement;
  readonly parentKey: string;
}
function pPr(paragraph: OoxmlElement): OoxmlNode | undefined {
  return paragraph.children.find((n) => n.kind === 'paragraphProperties');
}
function formatting(paragraph: OoxmlElement, styles?: StyleCascadeTable) {
  const props = pPr(paragraph);
  if (styles) return cascadeParagraphFormatting(styles, props);
  const mark =
    props?.kind !== 'textValue'
      ? props?.children.find((n) => n.kind === 'runProperties')
      : undefined;
  return { runProperties: [], markRunProperties: propertiesOfRunContainer(mark) };
}
export function hiddenStyleSeparatorMark(
  paragraph: OoxmlElement,
  styles?: StyleCascadeTable,
  requireSpecial = true
): boolean {
  let cache = styles ? markMemos.get(styles) : unstyledMarkMemos;
  if (!cache) markMemos.set(styles!, (cache = new WeakMap()));
  const memo = cache.get(paragraph);
  if (memo) return memo.hidden && (!requireSpecial || memo.special);
  let value = false;
  let hidden = false;
  for (const property of formatting(paragraph, styles).markRunProperties) {
    if (property.localName === 'vanish')
      hidden = !['0', 'false', 'off'].includes(property.attributes?.val ?? 'true');
    if (property.localName === 'specVanish')
      value = !['0', 'false', 'off'].includes(property.attributes?.val ?? 'true');
  }
  cache.set(paragraph, { hidden, special: value });
  return hidden && (!requireSpecial || value);
}
function containsBoundary(node: OoxmlNode): boolean {
  const cached = boundaryMemo.get(node);
  if (cached !== undefined) return cached;
  let visited = 0;
  const visit = (current: OoxmlNode, depth: number): boolean => {
    if (++visited > MAX_MEMBER_NODES || depth > 64) return true;
    if (current.kind === 'textValue') return false;
    if (
      current.namespaceUri === WML_NAMESPACE_URI &&
      [
        'sectPr',
        'framePr',
        'pageBreakBefore',
        'ins',
        'del',
        'moveFrom',
        'moveTo',
        'pPrChange',
        'rPrChange',
      ].includes(current.localName)
    )
      return true;
    if (
      current.kind === 'hardBreak' &&
      current.attributes.some((a) => a.localName === 'type' && ['page', 'column'].includes(a.value))
    )
      return true;
    for (const child of current.children) if (visit(child, depth + 1)) return true;
    return false;
  };
  const result = visit(node, 0);
  boundaryMemo.set(node, result);
  return result;
}
function continuationToken(input: ReturnType<typeof resolveParagraphLayoutInputs>): string {
  const keeps = paragraphKeeps(input.props);
  const flags = new Map<string, string>();
  const flowNames = new Set([
    'snapToGrid',
    'textDirection',
    'suppressAutoHyphens',
    'textAlignment',
    'adjustRightInd',
    'mirrorIndents',
    'suppressOverlap',
  ]);
  for (const property of input.props)
    if (flowNames.has(property.localName))
      flags.set(property.localName, property.attributes?.val ?? 'true');
  return JSON.stringify({
    direction: paragraphIsRtl(input.props),
    typography: resolveCjkTypography(input.props, undefined, input.markRunProperties),
    flow: [...flags].sort(([a], [b]) => a.localeCompare(b)),
    keeps,
    left: input.indent.left,
    right: input.indent.right,
    alignment: input.alignment,
    lineSpacing: input.lineSpacing,
    tabs: { ...input.tabStops, stops: input.tabStops.stops.filter((stop) => !stop.numberingOnly) },
    contextualSpacing: input.contextualSpacing,
    borders: input.borders,
    shading: input.shading,
  });
}

/** Display-only body groups. Structural and tracked-mark merges remain separate. */
function groupParagraphs(
  entries: readonly Entry[],
  styles: StyleCascadeTable | undefined,
  numberingIndex: NumberingIndex | undefined,
  excludedParagraphs: ReadonlySet<string> | undefined,
  addressable: (paragraph: OoxmlElement) => boolean,
  alreadyMerged: (paragraph: OoxmlElement) => boolean,
  register: (merged: OoxmlElement, members: readonly OoxmlElement[]) => void,
  joinsMark: (paragraph: OoxmlElement) => boolean
): readonly Entry[] {
  if (!entries.some((entry) => entry.block.kind === 'paragraph' && joinsMark(entry.block)))
    return entries;
  const listItems = resolveStoryListItems(
    entries.map((entry) => entry.block),
    numberingIndex ?? EMPTY_NUMBERING_INDEX,
    styles
  );
  const result: Entry[] = [];
  let pending: Entry[] = [];
  let refusing = false;
  const flush = (join: boolean) => {
    if (join && pending.length > 1 && pending.length <= MAX_MEMBERS) {
      const firstToken = continuationToken(
        resolveParagraphLayoutInputs(
          pending[0]!.block,
          1000,
          styles,
          listItems.get(pending[0]!.block.id)
        )
      );
      join =
        pending.slice(1).every((entry) => !listItems.has(entry.block.id)) &&
        pending.every((entry) => {
          const inputs = resolveParagraphLayoutInputs(
            entry.block,
            1000,
            styles,
            listItems.get(entry.block.id)
          );
          const boundary = inputs.props.some(
            (property) =>
              property.localName === 'framePr' ||
              (property.localName === 'pageBreakBefore' &&
                !['0', 'false', 'off'].includes(property.attributes?.val ?? 'true'))
          );
          return !boundary && !inputs.contextualSpacing && continuationToken(inputs) === firstToken;
        });
    } else join = false;
    if (join) {
      const first = pending[0]!;
      const members = pending.map((entry) => entry.block);
      const cached = groupMemos
        .get(first.block)
        ?.find(
          (memo) =>
            memo.styles === styles &&
            memo.numberingIndex === numberingIndex &&
            memo.members.length === members.length &&
            members.every((member, index) => member === memo.members[index])
        );
      if (cached) {
        register(cached.merged, members);
        result.push({ block: cached.merged, parentKey: first.parentKey });
        pending = [];
        return;
      }
      const projected: StyleSeparatorMember[] = [];
      let base = 0;
      for (const paragraph of members) {
        projected.push({
          paragraph,
          base,
          runProperties: formatting(paragraph, styles).runProperties,
        });
        base += paragraphOffsetIndex(paragraph as OoxmlParagraphNode).length;
      }
      const children = [...first.block.children.filter((n) => n.kind === 'paragraphProperties')];
      for (const member of members)
        for (const child of member.children)
          if (child.kind !== 'paragraphProperties') children.push(child);
      const merged = { ...first.block, children } as OoxmlElement;
      register(merged, members);
      registerStyleSeparatorGroup(merged, projected);
      const memos = groupMemos.get(first.block) ?? [];
      if (memos.length >= 4) memos.shift();
      memos.push({ styles, numberingIndex, members, merged });
      groupMemos.set(first.block, memos);
      result.push({ block: merged, parentKey: first.parentKey });
    } else for (const entry of pending) result.push(entry);
    pending = [];
  };
  for (const entry of entries) {
    if (pending.length && pending[0]!.parentKey !== entry.parentKey) flush(false);
    const paragraph = entry.block;
    if (paragraph.kind !== 'paragraph' || alreadyMerged(paragraph)) {
      flush(false);
      result.push(entry);
      continue;
    }
    const joins = joinsMark(paragraph);
    if (refusing) {
      result.push(entry);
      refusing = joins;
      continue;
    }
    if (pending.length === MAX_MEMBERS) {
      flush(false);
      result.push(entry);
      refusing = joins;
      continue;
    }
    if (
      (joins || pending.length) &&
      (excludedParagraphs?.has(paragraph.id) ||
        containsBoundary(paragraph) ||
        !addressable(paragraph))
    ) {
      flush(false);
      result.push(entry);
      refusing = joins;
      continue;
    }
    if (joins || pending.length) {
      pending.push(entry);
      if (!joins) flush(true);
    } else result.push(entry);
  }
  flush(false);
  return result;
}

/** Preserve accepted special groups when a larger hidden-mark chain is unsupported. */
export function withStyleSeparatorParagraphs(
  entries: readonly Entry[],
  styles: StyleCascadeTable | undefined,
  numberingIndex: NumberingIndex | undefined,
  exclusions: ReadonlySet<string> | (() => ReadonlySet<string>) | undefined,
  addressable: (paragraph: OoxmlElement) => boolean,
  alreadyMerged: (paragraph: OoxmlElement) => boolean,
  register: (merged: OoxmlElement, members: readonly OoxmlElement[]) => void
): readonly Entry[] {
  // Without a hidden mark no separator group can form. Avoid constructing TOC field
  // ranges and a second flow array for this common path, including tracked text edits.
  if (
    !entries.some(
      ({ block }) => block.kind === 'paragraph' && hiddenStyleSeparatorMark(block, styles, false)
    )
  )
    return entries;
  const excludedParagraphs = typeof exclusions === 'function' ? exclusions() : exclusions;
  const special = (paragraph: OoxmlElement) => hiddenStyleSeparatorMark(paragraph, styles);
  const baseline = groupParagraphs(
    entries,
    styles,
    numberingIndex,
    excludedParagraphs,
    addressable,
    alreadyMerged,
    register,
    special
  );
  const additional = new Set<OoxmlElement>();
  for (const { block } of entries) {
    if (
      block.kind === 'paragraph' &&
      !special(block) &&
      hiddenStyleSeparatorMark(block, styles, false) &&
      hasVisibleSeparatorText(block, styles)
    )
      additional.add(block);
  }
  if (!additional.size) return baseline;
  const expanded = groupParagraphs(
    entries,
    styles,
    numberingIndex,
    excludedParagraphs,
    addressable,
    alreadyMerged,
    register,
    (paragraph) => special(paragraph) || additional.has(paragraph)
  );
  const previousGroups = new Map<OoxmlElement, Entry>();
  for (const entry of baseline) {
    const members = styleSeparatorMembersOf(entry.block);
    if (members) previousGroups.set(members[0]!.paragraph, entry);
  }
  const result: Entry[] = [];
  for (let index = 0; index < expanded.length; index++) {
    const entry = expanded[index]!;
    const previous = previousGroups.get(entry.block);
    const members = previous && styleSeparatorMembersOf(previous.block);
    if (
      previous &&
      members &&
      members.every((member, offset) => expanded[index + offset]?.block === member.paragraph)
    ) {
      result.push(previous);
      index += members.length - 1;
    } else result.push(entry);
  }
  return result;
}
