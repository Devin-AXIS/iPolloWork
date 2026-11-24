// Reading one long XML part in steps, so a large document does not parse in one task.
//
// The steps produce exactly the tree `readOoxmlPart` produces. The whole part still passes
// the same bounded checks and the same well-formedness validation, each as a step of its own.
// Only then is it parsed: the root and the body start and end tags as one small document,
// and the body's content in runs that each end right after a top-level element, so every run
// is a balanced content sequence. Conversion then descends into wide elements (the body, a
// long table) child by child. Anything unexpected, and every rejection, falls back to the
// one-shot read, which gives the canonical answer.

import { fastReadXmlSteps } from './xml-fast-read.ts';
import {
  checkXmlSize,
  preflightXmlSteps,
  readCheckedXml,
  readXmlFragment,
  validateWholeXml,
  type XmlElementBudget,
  type XmlLimits,
  type XmlNode,
} from './xml-reader.ts';
import {
  closeElement,
  convertChildOf,
  deepFreezeNode,
  openChildOf,
  openElement,
  readOoxmlPart,
  rootBindings,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPartMetadata,
  type OoxmlReadResult,
  type OpenedElement,
} from './ooxml-tree.ts';
import { TreeReadError } from './ooxml-shared.ts';
import { OoxmlReadMetadata } from './ooxml-read-metadata.ts';

type XmlElement = Extract<XmlNode, { type: 'element' }>;

/** Parts shorter than this read in one step; the steps only pay off on long parts. */
let steppedPartMinChars = 2_000_000;
/** Body content parsed per step, in characters. */
let fragmentChars = 256 * 1024;
/** Elements with at least this many children are converted child by child. */
const WIDE_ELEMENT_CHILDREN = 64;
/** Tokens the body scan reads between yields. */
const SCAN_TOKENS_PER_STEP = 20_000;

/**
 * @internal Test hook: read parts of at least `chars` characters in steps, cutting the body
 * every `fragment` characters. Returns the restore.
 */
export function setSteppedPartReadForTest(chars: number, fragment = fragmentChars): () => void {
  const previous = [steppedPartMinChars, fragmentChars] as const;
  steppedPartMinChars = chars;
  fragmentChars = fragment;
  return () => {
    [steppedPartMinChars, fragmentChars] = previous;
  };
}

/**
 * Read `xml` like {@link readOoxmlPart}, yielding between units of work. Drain the generator
 * to read in one go; a caller that stops between yields gives the page a turn.
 */
export function* readOoxmlPartSteps(
  xml: string,
  metadata: OoxmlPartMetadata,
  limits?: XmlLimits
): Generator<void, OoxmlReadResult> {
  if (xml.length < steppedPartMinChars) return readOoxmlPart(xml, metadata, limits);
  // The plain subset reads in one pass, a slice per step (`xml-fast-read.ts`). A part outside
  // it, and every refusal, takes the bounded steps below.
  const sized = checkXmlSize(xml, limits);
  if (!sized.ok) return sized;
  const fast = yield* fastReadXmlSteps(xml, sized.maxElements, fragmentChars);
  if (fast !== null) return yield* convertRootSteps(fast[0] as XmlElement, metadata);
  const checked = yield* preflightXmlSteps(xml, limits);
  if (!checked.ok) return checked;
  yield;
  const split = yield* splitBody(xml);
  if (!split) return readOoxmlPart(xml, metadata, limits);
  const budget: XmlElementBudget = { count: 0, maxElements: checked.maxElements };
  // Well-formedness piece by piece: the root with an empty body here, and each run of body
  // content as it is read. Pieces cut at element boundaries are well-formed together exactly
  // when each is, so this decides what one validation of the whole part decides.
  const wrapperXml = xml.slice(0, split.contentStart) + xml.slice(split.contentEnd);
  if (!validateWholeXml(wrapperXml)) return readOoxmlPart(xml, metadata, limits);
  const wrapper = readCheckedXml(wrapperXml, budget);
  if (!wrapper.ok) return readOoxmlPart(xml, metadata, limits);
  const roots = wrapper.nodes.filter((node): node is XmlElement => node.type === 'element');
  if (roots.length !== 1) return readOoxmlPart(xml, metadata, limits);
  const bodies = roots[0]!.children.filter(
    (node): node is XmlElement =>
      node.type === 'element' && node.name === split.bodyName && node.children.length === 0
  );
  if (bodies.length !== 1) return readOoxmlPart(xml, metadata, limits);
  const content: XmlNode[] = [];
  for (const item of split.items) {
    yield;
    if (item.kind === 'run') {
      if (item.start === item.end) continue;
      const run = readXmlFragment(xml.slice(item.start, item.end), 2, budget);
      if (!run.ok) return readOoxmlPart(xml, metadata, limits);
      for (const node of run.nodes) content.push(node);
      continue;
    }
    // A wide child of the body: its tags as an empty element, then its content in runs.
    const shell = readXmlFragment(
      xml.slice(item.start, item.open) + xml.slice(item.close, item.end),
      2,
      budget
    );
    if (!shell.ok || shell.nodes.length !== 1 || shell.nodes[0]!.type !== 'element')
      return readOoxmlPart(xml, metadata, limits);
    const children: XmlNode[] = [];
    for (let index = 0; index < item.cuts.length - 1; index += 1) {
      yield;
      const run = readXmlFragment(xml.slice(item.cuts[index]!, item.cuts[index + 1]!), 3, budget);
      if (!run.ok) return readOoxmlPart(xml, metadata, limits);
      for (const node of run.nodes) children.push(node);
    }
    content.push({ ...shell.nodes[0]!, children });
  }
  const body: XmlElement = { ...bodies[0]!, children: content };
  const root: XmlElement = {
    ...roots[0]!,
    children: roots[0]!.children.map((node) => (node === bodies[0] ? body : node)),
  };
  return yield* convertRootSteps(root, metadata);
}

/** The part tree of `root`, converting a wide element child by child between yields. */
function* convertRootSteps(
  root: XmlElement,
  metadata: OoxmlPartMetadata
): Generator<void, OoxmlReadResult> {
  try {
    const opened = openElement(
      root,
      new OoxmlReadMetadata(),
      rootBindings(),
      metadata.name,
      '0',
      false
    );
    const converted = yield* closeSteps(opened);
    return {
      ok: true,
      part: Object.freeze({
        id: `part:${metadata.name}`,
        name: metadata.name,
        contentType: metadata.contentType,
        root: deepFreezeNode(converted) as OoxmlElement,
      }),
    };
  } catch (error) {
    return { ok: false, reason: error instanceof TreeReadError ? error.reason : 'parse-error' };
  }
}

/** Convert `opened`'s children, a wide child by its own children, and close it. */
function* closeSteps(opened: OpenedElement): Generator<void, OoxmlElement> {
  const children: OoxmlNode[] = [];
  for (let index = 0; index < opened.retainedChildren.length; index += 1) {
    const child = opened.retainedChildren[index]!;
    if (child.type === 'element' && child.children.length >= WIDE_ELEMENT_CHILDREN) {
      children.push(yield* closeSteps(openChildOf(opened, child, index)));
    } else {
      // Frozen now, so the final freeze skips it instead of walking the whole tree again.
      children.push(deepFreezeNode(convertChildOf(opened, child, index)));
      yield;
    }
  }
  const element = closeElement(opened, children);
  return deepFreezeNode(element) as OoxmlElement;
}

/** A run of body content, or one wide child of the body cut inside. */
type BodyItem =
  | { readonly kind: 'run'; readonly start: number; readonly end: number }
  | {
      readonly kind: 'wide';
      /** Its start tag `[start, open)`, its end tag `[close, end)`. */
      readonly start: number;
      readonly open: number;
      readonly close: number;
      readonly end: number;
      /** Offsets cutting its content into balanced runs: `open`, cuts, `close`. */
      readonly cuts: readonly number[];
    };

interface BodySplit {
  /** The qualified name of the body element, as authored. */
  readonly bodyName: string;
  /** Just after the body start tag, and at its end tag. */
  readonly contentStart: number;
  readonly contentEnd: number;
  /** The body content in order, each item a balanced run or a wide child. */
  readonly items: readonly BodyItem[];
}

/** A body child this long is cut inside, between its own children. */
const wideChildChars = () => fragmentChars * 4;

/**
 * Find the body of the root and cut its content after top-level elements, about
 * `fragmentChars` at a time, and a very long child (a long table) between its own children.
 * Null for any shape this does not handle; the whole part already validated, so a null only
 * means the one-shot read is used.
 */
function* splitBody(xml: string): Generator<void, BodySplit | null> {
  let index = 0;
  let depth = 0;
  let tokens = 0;
  let bodyName: string | null = null;
  let contentStart = -1;
  const items: BodyItem[] = [];
  let runStart = -1;
  // The body child being read: where it starts, where its start tag ends, and the offsets
  // after each of its own children.
  let childStart = -1;
  let childOpen = -1;
  let childCuts: number[] = [];
  for (;;) {
    if (++tokens % SCAN_TOKENS_PER_STEP === 0) yield;
    const lt = xml.indexOf('<', index);
    if (lt < 0) return null;
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      if (end < 0) return null;
      index = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      if (end < 0) return null;
      index = end + 3;
      continue;
    }
    if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt + 2);
      if (end < 0) return null;
      index = end + 2;
      continue;
    }
    if (xml.startsWith('<!', lt)) return null;
    const gt = tagEnd(xml, lt);
    if (gt < 0) return null;
    index = gt + 1;
    if (xml.charCodeAt(lt + 1) === 47 /* / */) {
      depth -= 1;
      if (bodyName === null) {
        if (depth < 1) return null;
        continue;
      }
      if (depth === 1) {
        // The body's own end tag.
        if (tagName(xml, lt + 2) !== bodyName) return null;
        items.push({ kind: 'run', start: runStart, end: lt });
        return { bodyName, contentStart, contentEnd: lt, items };
      }
      if (depth === 3) childCuts.push(index);
      else if (depth === 2) closeChild(lt);
      continue;
    }
    const selfClosing = xml.charCodeAt(gt - 1) === 47;
    if (bodyName === null && depth === 1 && !selfClosing) {
      const name = tagName(xml, lt + 1);
      if (name === 'body' || name.endsWith(':body')) {
        bodyName = name;
        contentStart = index;
        runStart = index;
        depth += 1;
        continue;
      }
    }
    if (selfClosing) {
      if (bodyName === null) continue;
      if (depth === 3) childCuts.push(index);
      else if (depth === 2) cutRun(index);
      continue;
    }
    if (bodyName !== null && depth === 2) {
      childStart = lt;
      childOpen = index;
      childCuts = [];
    }
    depth += 1;
  }

  function cutRun(at: number): void {
    if (at - runStart >= fragmentChars) {
      items.push({ kind: 'run', start: runStart, end: at });
      runStart = at;
    }
  }

  function closeChild(close: number): void {
    if (index - childStart < wideChildChars() || childCuts.length === 0) {
      cutRun(index);
      return;
    }
    items.push({ kind: 'run', start: runStart, end: childStart });
    const cuts = [childOpen];
    for (const at of childCuts) if (at - cuts[cuts.length - 1]! >= fragmentChars) cuts.push(at);
    cuts.push(close);
    items.push({ kind: 'wide', start: childStart, open: childOpen, close, end: index, cuts });
    runStart = index;
  }
}

/** The `>` closing the tag that opens at `lt`, skipping quoted attribute values. */
function tagEnd(xml: string, lt: number): number {
  for (let index = lt + 1; index < xml.length; index += 1) {
    const code = xml.charCodeAt(index);
    if (code === 62 /* > */) return index;
    if (code === 34 /* " */ || code === 39 /* ' */) {
      const close = xml.indexOf(code === 34 ? '"' : "'", index + 1);
      if (close < 0) return -1;
      index = close;
    }
  }
  return -1;
}

/** The qualified name starting at `start`, up to whitespace, `/` or `>`. */
function tagName(xml: string, start: number): string {
  let end = start;
  while (end < xml.length) {
    const code = xml.charCodeAt(end);
    if (code === 62 || code === 47 || code === 32 || code === 9 || code === 10 || code === 13)
      break;
    end += 1;
  }
  return xml.slice(start, end);
}
