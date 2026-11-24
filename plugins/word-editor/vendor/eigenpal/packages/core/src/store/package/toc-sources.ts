// Bounded TC entry collection. Field instructions are data; nested fields use cached results.
import { fldCharType, instrTextValue, isInstrTextNode } from './field-nodes.ts';
import type { OoxmlNode, OoxmlPart } from './ooxml-tree.ts';
import {
  MAX_INLINE_CONTAINER_DEPTH,
  nextInlineContainerDepth,
  WML_NAMESPACE_URI,
} from './ooxml-shared.ts';
import {
  TOC_MAX_ENTRIES,
  TOC_MAX_FIELD_NESTING,
  TOC_MAX_INSTRUCTION_CHARS,
  type TocInstruction,
} from './toc-instruction.ts';
import type { TocOutlineHeading } from './toc-build.ts';

interface SourceOptions {
  readonly tc: boolean;
  readonly outline: boolean;
  readonly identifier?: string;
  readonly minLevel: number;
  readonly maxLevel: number;
}
export interface TocSourceHeading extends TocOutlineHeading {
  readonly tcEntry?: boolean;
  readonly omitPageNumber?: boolean;
}
function tokens(raw: string): string[] | null {
  if (raw.length > TOC_MAX_INSTRUCTION_CHARS) return null;
  const out: string[] = [];
  const pattern = /\s*(?:"([^"]*)"|([^\s"]+))/gy;
  let at = 0;
  while (at < raw.length) {
    if (!raw.slice(at).trim()) break;
    pattern.lastIndex = at;
    const match = pattern.exec(raw);
    if (!match) return null;
    out.push(match[1] ?? match[2]!);
    at = pattern.lastIndex;
  }
  return out;
}
function levelRange(value: string | undefined): readonly [number, number] | null {
  const match = /^([1-9])\s*-\s*([1-9])$/.exec(value ?? '');
  return match && Number(match[1]) >= 1 && Number(match[1]) <= Number(match[2])
    ? [Number(match[1]), Number(match[2])]
    : null;
}
function sourceOptions(instruction: TocInstruction): SourceOptions | null {
  const parts = tokens(instruction.raw);
  if (!parts || parts[0]?.toUpperCase() !== 'TOC') return null;
  let tc = false,
    outline = false;
  let identifier = 'c';
  let minLevel = 1,
    maxLevel = 9;
  for (let i = 1; i < parts.length; i++) {
    const flag = parts[i]!.toLowerCase();
    switch (flag) {
      case '\\f':
        tc = true;
        if (parts[i + 1] && !parts[i + 1]!.startsWith('\\')) {
          identifier = parts[++i] ?? '';
          if (!/^[a-z]$/i.test(identifier!)) return null;
        }
        break;
      case '\\u':
        outline = true;
        break;
      case '\\o':
        if (!levelRange(parts[++i])) return null;
        outline = true;
        break;
      case '\\l': {
        const range = levelRange(parts[++i]);
        if (!range) return null;
        [minLevel, maxLevel] = range;
        break;
      }
      case '\\h':
      case '\\z':
      case '\\n':
        break;
      case '\\*':
        if (parts[++i]?.toUpperCase() !== 'MERGEFORMAT') return null;
        break;
      default:
        return null;
    }
  }
  return { tc, outline: outline || !tc, identifier, minLevel, maxLevel };
}
interface TcEntry extends TocSourceHeading {
  readonly identifier?: string;
}
function tcEntry(raw: string, blockId: string): TcEntry | null {
  const parts = tokens(raw);
  if (!parts || parts[0]?.toUpperCase() !== 'TC' || !parts[1]) return null;
  const text = parts[1];
  if (text.length > 200) return null;
  let level = 0;
  let identifier = 'c';
  let omitPageNumber = false;
  for (let i = 2; i < parts.length; i++) {
    switch (parts[i]!.toLowerCase()) {
      case '\\l':
        if (!/^[1-9]$/.test(parts[++i] ?? '')) return null;
        level = Number(parts[i]) - 1;
        break;
      case '\\f':
        identifier = parts[++i] ?? '';
        if (!/^[a-z]$/i.test(identifier ?? '')) return null;
        break;
      case '\\n':
        omitPageNumber = true;
        break;
      default:
        return null;
    }
  }
  return { text, level, blockId, tcEntry: true, identifier, omitPageNumber };
}
interface OpenField {
  text: string;
  separated: boolean;
  invalid: boolean;
  paragraphId: string;
}
interface Collected {
  readonly entries: readonly TcEntry[];
  readonly order: ReadonlyMap<string, number>;
  readonly invalid: boolean;
}
const collectedByPart = new WeakMap<OoxmlPart, Collected>();
function collect(part: OoxmlPart): Collected {
  const cached = collectedByPart.get(part);
  if (cached) return cached;
  const entries: TcEntry[] = [];
  const overflowByStack = new WeakMap<OpenField[], number>();
  const order = new Map<string, number>();
  let invalid = false;
  const add = (raw: string, paragraphId: string, bad = false) => {
    if (!/^\s*TC(?:\s|$)/i.test(raw)) return;
    const entry = bad ? null : tcEntry(raw, paragraphId);
    if (!entry || entries.length >= TOC_MAX_ENTRIES) invalid = true;
    else entries.push(entry);
  };
  const walk = (node: OoxmlNode, depth: number, paragraphId: string, stack: OpenField[]) => {
    if (node.kind === 'textValue' || depth >= MAX_INLINE_CONTAINER_DEPTH) return;
    // Deleted source fields must not reappear in the rebuilt TOC.
    if (
      node.namespaceUri === WML_NAMESPACE_URI &&
      (node.localName === 'del' || node.localName === 'moveFrom')
    )
      return;
    if (node.kind === 'paragraph') {
      order.set(node.id, order.size);
      paragraphId = node.id;
      stack = [];
    }
    const type = fldCharType(node);
    const overflow = overflowByStack.get(stack) ?? 0;
    if (overflow > 0) {
      if (type === 'begin') overflowByStack.set(stack, overflow + 1);
      if (type === 'end') overflowByStack.set(stack, overflow - 1);
      for (const child of node.children)
        walk(child, nextInlineContainerDepth(node, depth), paragraphId, stack);
      return;
    }
    if ((type === 'begin' || node.kind === 'fldSimple') && stack.length >= TOC_MAX_FIELD_NESTING) {
      invalid = true;
      if (type === 'begin') overflowByStack.set(stack, 1);
      return;
    }
    if (node.kind === 'fldSimple') {
      const raw = node.attributes.find((attr) => attr.localName === 'instr')?.value ?? '';
      if (/^\s*TC(?:\s|$)/i.test(raw)) {
        add(raw, paragraphId);
        return;
      }
      if (stack.length && !stack[stack.length - 1]!.separated) {
        stack.push({ text: raw, separated: true, invalid: false, paragraphId });
        for (const child of node.children)
          walk(child, nextInlineContainerDepth(node, depth), paragraphId, stack);
        stack.pop();
        return;
      }
    }
    if (type === 'begin') {
      stack.push({
        text: '',
        separated: false,
        invalid: stack.length >= TOC_MAX_FIELD_NESTING,
        paragraphId,
      });
      return;
    }
    if (type === 'separate') {
      if (stack.length) stack[stack.length - 1]!.separated = true;
      return;
    }
    if (type === 'end') {
      const field = stack.pop();
      if (field) add(field.text, field.paragraphId, field.invalid);
      return;
    }
    if (isInstrTextNode(node)) {
      const field = stack[stack.length - 1];
      if (field && !field.separated) {
        const chunk = instrTextValue(node);
        if (field.text.length + chunk.length > TOC_MAX_INSTRUCTION_CHARS) field.invalid = true;
        else field.text += chunk;
      }
      if (!field?.separated) return;
    }
    if (node.kind === 'text' || node.kind === 'tab' || isInstrTextNode(node)) {
      const value =
        node.kind === 'tab'
          ? '\t'
          : isInstrTextNode(node)
            ? instrTextValue(node)
            : node.children
                .filter((c) => c.kind === 'textValue')
                .map((c) => c.value)
                .join('');
      // A nested REF's cached display forms part of the enclosing TC instruction.
      for (let i = stack.length - 2; i >= 0; i--) {
        const field = stack[i]!;
        if (field.separated || stack.slice(i + 1).some((nested) => !nested.separated)) continue;
        if (field.text.length + value.length > TOC_MAX_INSTRUCTION_CHARS) field.invalid = true;
        else field.text += value;
      }
      if (node.kind === 'tab' && stack.length && !stack[stack.length - 1]!.separated) {
        const field = stack[stack.length - 1]!;
        if (field.text.length < TOC_MAX_INSTRUCTION_CHARS) field.text += '\t';
        else field.invalid = true;
      }
      return;
    }
    const next = nextInlineContainerDepth(node, depth);
    for (const child of node.children) walk(child, next, paragraphId, stack);
    if (node.kind === 'paragraph') {
      for (const field of stack) if (/^\s*TC(?:\s|$)/i.test(field.text)) invalid = true;
    }
  };
  walk(part.root, 0, '', []);
  const result = { entries, order, invalid };
  collectedByPart.set(part, result);
  return result;
}

/** Null means refresh cannot represent the requested sources without dropping entries. */
export function resolveTocSources(
  part: OoxmlPart,
  outline: readonly TocOutlineHeading[],
  instruction: TocInstruction
): readonly TocSourceHeading[] | null {
  const options = sourceOptions(instruction);
  if (!options) return null;
  const source = collect(part);
  if (options.tc && source.invalid) return null;
  const selectedTc = options.tc
    ? source.entries.filter(
        (entry) =>
          (options.identifier === undefined ||
            entry.identifier?.toLowerCase() === options.identifier.toLowerCase()) &&
          entry.level + 1 >= options.minLevel &&
          entry.level + 1 <= options.maxLevel
      )
    : [];
  // Word uses the explicit TC entry for a source paragraph instead of also emitting
  // that paragraph's outline title when both source switches are present.
  const tcParagraphs = new Set(selectedTc.map((entry) => entry.blockId));
  const entries: TocSourceHeading[] = options.outline
    ? outline.filter(
        (entry) =>
          !tcParagraphs.has(entry.blockId) &&
          entry.level + 1 >= instruction.outlineStart &&
          entry.level + 1 <= instruction.outlineEnd
      )
    : [];
  entries.push(...selectedTc);
  if (entries.length > TOC_MAX_ENTRIES) return null;
  return entries.sort(
    (a, b) => (source.order.get(a.blockId) ?? 0) - (source.order.get(b.blockId) ?? 0)
  );
}
