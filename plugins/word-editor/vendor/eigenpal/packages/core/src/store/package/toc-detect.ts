// Bounded, inert detection of cross-paragraph TOC complex fields.

import { isContentControl, isContentControlContent } from './content-control-walk.ts';
import { fldCharType, instrTextValue, isInstrTextNode } from './field-nodes.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from './ooxml-tree.ts';
import { MAX_INLINE_CONTAINER_DEPTH, nextInlineContainerDepth } from './ooxml-shared.ts';
import {
  TOC_MAX_FIELD_NESTING,
  TOC_MAX_INSTRUCTION_CHARS,
  parseTocInstruction,
  type TocInstruction,
} from './toc-instruction.ts';
import { weakRefOf, type WeakRefOf } from './weak-ref.ts';

/** A table of contents found in a document, whether wrapped in an SDT or a bare field. */
export interface DetectedToc {
  /** Enclosing control id when it identifies one TOC, otherwise the begin fldChar id. */
  readonly id: string;
  readonly beginNodeId: string;
  readonly beginParagraphId: string;
  readonly endParagraphId: string;
  readonly resultParagraphIds: readonly string[];
  /** Direct parent whose paragraph children delimit the cached result. */
  readonly containerId: string;
  readonly contentControlId?: string;
  readonly instruction: TocInstruction;
}

interface OpenField {
  readonly beginNodeId: string;
  readonly beginParagraphId: string;
  readonly containerId: string;
  readonly contentControlId?: string;
  readonly instructionChunks: string[];
  readonly resultParagraphIds: string[];
  instructionLength: number;
  separated: boolean;
  separateNodeId?: string;
  separateParagraphId?: string;
  invalid: boolean;
}

function bodyOf(part: OoxmlPart): OoxmlElement | null {
  if (part.root.kind === 'body') return part.root;
  for (const child of part.root.children) {
    if (child.kind === 'body') return child;
  }
  return null;
}

const fieldTokensByParagraph = new WeakMap<OoxmlElement, readonly OoxmlNode[]>();
const fieldBoundaries = new WeakMap<OoxmlElement, boolean>();

/**
 * Whether a paragraph holds a field character or instruction, not only text and tabs.
 *
 * @internal
 */
export function holdsFieldBoundary(paragraph: OoxmlElement): boolean {
  let holds = fieldBoundaries.get(paragraph);
  if (holds === undefined) {
    holds = fieldTokens(paragraph).some((token) => token.kind !== 'text' && token.kind !== 'tab');
    fieldBoundaries.set(paragraph, holds);
  }
  return holds;
}

function fieldTokens(paragraph: OoxmlElement): readonly OoxmlNode[] {
  const cached = fieldTokensByParagraph.get(paragraph);
  if (cached) return cached;
  const tokens: OoxmlNode[] = [];
  const walk = (node: OoxmlNode, depth: number): void => {
    if (node.kind === 'textValue') return;
    if (depth >= MAX_INLINE_CONTAINER_DEPTH) return;
    if (
      fldCharType(node) !== null ||
      isInstrTextNode(node) ||
      node.kind === 'text' ||
      node.kind === 'tab'
    ) {
      tokens.push(node);
      return;
    }
    const nextDepth = nextInlineContainerDepth(node, depth);
    for (const child of node.children) walk(child, nextDepth);
  };
  for (const child of paragraph.children) walk(child, 0);
  fieldTokensByParagraph.set(paragraph, tokens);
  return tokens;
}

interface TocFieldRange {
  readonly separateNodeId: string;
  readonly separateParagraphId: string;
  readonly endNodeId: string;
}
const fieldRanges = new WeakMap<DetectedToc, TocFieldRange>();
/** Internal inline boundaries, kept outside the public detection shape. */
export function tocFieldRange(toc: DetectedToc): TocFieldRange | undefined {
  return fieldRanges.get(toc);
}
type DetectedTocCandidate = Omit<DetectedToc, 'id'> & { readonly range: TocFieldRange };
type ContainerTocResult = DetectedToc | DetectedTocCandidate;

const EMPTY_TOCS: readonly DetectedToc[] = Object.freeze([]);
const detectedTocsByContainer = new WeakMap<OoxmlElement, readonly DetectedToc[]>();

/**
 * Detect fields whose paragraphs share one direct container.
 *
 * A commit rebuilds the edited ancestor chain. Unchanged content-control containers retain
 * their identity, so their complete TOC answers remain reusable across part revisions.
 */
function detectTocsInContainer(
  container: OoxmlElement,
  contentControlId: string | undefined,
  depth: number
): readonly DetectedToc[] {
  const cached = detectedTocsByContainer.get(container);
  if (cached) return cached;
  const carried = carriedTocs(container);
  if (carried) {
    detectedTocsByContainer.set(container, carried);
    return carried;
  }
  const stack: OpenField[] = [];
  let overflowDepth = 0;
  const completed: ContainerTocResult[] = [];

  const processParagraph = (paragraph: OoxmlElement): void => {
    for (const token of fieldTokens(paragraph)) {
      // Cached text can share either boundary paragraph. Record it before the
      // end marker pops the field, without treating text after the field as a row.
      if (token.kind === 'text' || token.kind === 'tab') {
        for (const open of stack) {
          if (open?.separated && open.resultParagraphIds.at(-1) !== paragraph.id) {
            open.resultParagraphIds.push(paragraph.id);
          }
        }
        continue;
      }
      const type = fldCharType(token);
      if (type === 'begin') {
        if (overflowDepth > 0 || stack.length >= TOC_MAX_FIELD_NESTING) {
          overflowDepth += 1;
        } else {
          stack.push({
            beginNodeId: token.id,
            beginParagraphId: paragraph.id,
            containerId: container.id,
            contentControlId,
            instructionChunks: [],
            resultParagraphIds: [],
            instructionLength: 0,
            separated: false,
            invalid: false,
          });
        }
        continue;
      }

      // Retain only the supported nesting levels. A null placeholder per extra
      // begin makes every following text token scan an arbitrarily large stack.
      if (overflowDepth > 0) {
        if (type === 'end') overflowDepth -= 1;
        continue;
      }

      const field = stack[stack.length - 1];
      if (isInstrTextNode(token)) {
        if (field && !field.separated) {
          const chunk = instrTextValue(token);
          field.instructionLength += chunk.length;
          if (field.instructionLength > TOC_MAX_INSTRUCTION_CHARS) field.invalid = true;
          else field.instructionChunks.push(chunk);
        }
        continue;
      }
      if (type === 'separate') {
        if (field && !field.separated) {
          field.separated = true;
          field.separateNodeId = token.id;
          field.separateParagraphId = paragraph.id;
        }
        continue;
      }
      if (type !== 'end' || stack.length === 0) continue;

      const ended = stack.pop();
      if (
        ended &&
        ended.separated &&
        !ended.invalid &&
        ended.containerId === container.id &&
        ended.separateNodeId &&
        ended.separateParagraphId
      ) {
        const instruction = parseTocInstruction(ended.instructionChunks.join(''));
        if (instruction) {
          completed.push({
            range: {
              separateNodeId: ended.separateNodeId,
              separateParagraphId: ended.separateParagraphId,
              endNodeId: token.id,
            },
            beginNodeId: ended.beginNodeId,
            beginParagraphId: ended.beginParagraphId,
            endParagraphId: paragraph.id,
            resultParagraphIds: ended.resultParagraphIds,
            containerId: ended.containerId,
            ...(ended.contentControlId ? { contentControlId: ended.contentControlId } : {}),
            instruction,
          });
        }
      }
    }

    for (const field of stack) {
      if (
        field &&
        field.separated &&
        field.beginParagraphId !== paragraph.id &&
        field.containerId === container.id &&
        field.resultParagraphIds.at(-1) !== paragraph.id
      ) {
        field.resultParagraphIds.push(paragraph.id);
      }
    }
  };

  for (const child of container.children) {
    if (child.kind === 'paragraph') {
      // Outside a field, a paragraph of plain text changes nothing: its text only joins an
      // open field's result. Skipping it keeps a long body's walk cheap after each edit.
      if (stack.length > 0 || holdsFieldBoundary(child)) processParagraph(child);
      continue;
    }
    if (!isContentControl(child) || depth >= TOC_MAX_FIELD_NESTING) continue;
    for (const content of child.children) {
      if (!isContentControlContent(content)) continue;
      completed.push(...detectTocsInContainer(content, child.id, depth + 1));
    }
  }

  const controlCounts = new Map<string, number>();
  for (const toc of completed) {
    if (!('id' in toc) && toc.contentControlId) {
      controlCounts.set(toc.contentControlId, (controlCounts.get(toc.contentControlId) ?? 0) + 1);
    }
  }
  const result = completed.map((toc): DetectedToc => {
    if ('id' in toc) return toc;
    const { range, ...candidate } = toc;
    const detected: DetectedToc = {
      ...candidate,
      id:
        toc.contentControlId && controlCounts.get(toc.contentControlId) === 1
          ? toc.contentControlId
          : toc.beginNodeId,
    };
    fieldRanges.set(detected, range);
    return detected;
  });
  const immutable = result.length > 0 ? Object.freeze(result) : EMPTY_TOCS;
  detectedTocsByContainer.set(container, immutable);
  rememberDetection(container, immutable);
  return immutable;
}

/** A container's last detection per id: an edit makes a new container that keeps its id. */
const lastDetections = new Map<
  string,
  { children: WeakRefOf<readonly OoxmlNode[]>; tocs: readonly DetectedToc[] }
>();
const MAX_LAST_DETECTIONS = 32;

function rememberDetection(container: OoxmlElement, tocs: readonly DetectedToc[]): void {
  lastDetections.delete(container.id);
  lastDetections.set(container.id, { children: weakRefOf(container.children), tocs });
  if (lastDetections.size > MAX_LAST_DETECTIONS)
    lastDetections.delete(lastDetections.keys().next().value!);
}

/**
 * The previous answer for a container whose edit cannot have changed it: every child that
 * changed is a paragraph without a field character or instruction, before and after. Plain
 * text only joins an open field's result by paragraph id, and the id stays.
 */
function carriedTocs(container: OoxmlElement): readonly DetectedToc[] | undefined {
  const last = lastDetections.get(container.id);
  const previous = last?.children.deref();
  if (!last || !previous || previous.length !== container.children.length) return undefined;
  for (let index = 0; index < container.children.length; index += 1) {
    const child = container.children[index]!;
    const before = previous[index]!;
    if (child === before) continue;
    if (child.kind !== 'paragraph' || before.kind !== 'paragraph' || child.id !== before.id)
      return undefined;
    if (holdsFieldBoundary(child) || holdsFieldBoundary(before)) return undefined;
  }
  rememberDetection(container, last.tocs);
  return last.tocs;
}

/** Memoized per immutable part identity for repeated reads within one revision. */
const detectBodyTocsCache = new WeakMap<OoxmlPart, readonly DetectedToc[]>();

/** Discover refreshable body TOCs without evaluating any field instruction. */
export function detectBodyTocs(part: OoxmlPart): readonly DetectedToc[] {
  const cached = detectBodyTocsCache.get(part);
  if (cached) return cached;
  const body = bodyOf(part);
  const result = body ? detectTocsInContainer(body, undefined, 0) : EMPTY_TOCS;
  detectBodyTocsCache.set(part, result);
  return result;
}

/**
 * Whether a paragraph opens, closes or holds the result of a body TOC.
 *
 * @internal
 */
export function inBodyToc(part: OoxmlPart, paragraphId: string): boolean {
  return detectBodyTocs(part).some(
    (toc) =>
      toc.beginParagraphId === paragraphId ||
      toc.endParagraphId === paragraphId ||
      toc.resultParagraphIds.includes(paragraphId)
  );
}

/** Locate the table of contents containing a position, or null. */
export function findDetectedToc(tocs: readonly DetectedToc[], tocId: string): DetectedToc | null {
  return tocs.find((toc) => toc.id === tocId) ?? null;
}
