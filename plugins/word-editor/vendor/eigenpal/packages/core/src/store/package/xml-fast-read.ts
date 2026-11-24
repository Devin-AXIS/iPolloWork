// One-pass reader for the plain XML subset that OOXML parts are written in.
//
// The bounded reader in `xml-reader.ts` scans a part several times before it parses it: for
// forbidden constructs, for the element count, for the depth, for well-formedness, and once
// more to build the tree. On a long part those passes cost more than the tree itself. This
// reader makes ONE pass and builds the same `XmlNode` tree, but only for a narrow subset:
//
//   - an optional `<?xml ...?>` declaration at the very start, then one root element, with
//     only whitespace outside it;
//   - start, end and empty-element tags with ASCII names, and attributes written
//     `name="value"` or `name='value'` after whitespace, each name once per element;
//   - character data whose `&` starts one of the five predefined entities or a numeric
//     character reference.
//
// Everything else — a comment, CDATA, a processing instruction, any `<!` declaration, a
// non-ASCII name, a stray `&`, a `<` in an attribute value, a mismatched end tag, deep
// nesting, too many elements, a value that is not XML 1.0 text — makes it return null, and
// the caller reads the part with the bounded reader, which gives the canonical answer or the
// canonical refusal. So this reader never accepts a part the bounded reader refuses, and on
// every part it accepts it builds exactly the tree the bounded reader builds. It never
// decides a refusal itself.

import type { XmlNode } from './xml-reader.ts';
import { decodeXmlEntities, ownString } from './xml-text.ts';

type XmlElement = Extract<XmlNode, { type: 'element' }>;

/**
 * Elements nested deeper than this go to the bounded reader. Its parser refuses nesting a
 * little past 100 levels; staying well below that keeps this reader inside what it accepts.
 */
const MAX_FAST_DEPTH = 90;

/** Distinct attribute texts remembered at once; the memory is cleared when it fills. */
const MAX_SHARED_RECORDS = 4096;

/** Names the bounded parser renames or refuses as object keys; they go to it. */
const RESERVED_NAMES: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
  'hasOwnProperty',
  'toString',
  'valueOf',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
]);

/** A declaration this reader passes over: pseudo-attributes with plain quoted values. */
const DECLARATION_RE =
  /<\?xml(?:[ \t\r\n]+[A-Za-z]+[ \t\r\n]*=[ \t\r\n]*(?:"[^"<>?&]*"|'[^'<>?&]*'))*[ \t\r\n]*\?>/y;

/** The only references this reader decodes: the five entities and character references. */
const REFERENCE_RE = /&(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);/y;

/** Raised to abandon the fast read; never escapes this module. */
class Unsupported extends Error {}

function isNameStart(code: number): boolean {
  return (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || code === 95 || code === 58;
}

function isNameChar(code: number): boolean {
  return isNameStart(code) || (code >= 48 && code <= 57) || code === 45 || code === 46;
}

function isSpace(code: number): boolean {
  return code === 32 || code === 10 || code === 9 || code === 13;
}

/** Whether every `&` in `raw` starts a reference this reader decodes. */
function referencesSupported(raw: string, first: number): boolean {
  for (let at = first; at >= 0; at = raw.indexOf('&', at + 1)) {
    REFERENCE_RE.lastIndex = at;
    if (!REFERENCE_RE.test(raw)) return false;
  }
  return true;
}

/** Character data as the bounded reader stores it: line ends normalized, references decoded. */
function characterData(xml: string, start: number, end: number, attribute = false): string {
  let raw = xml.slice(start, end);
  if (attribute && raw.indexOf('<') >= 0) throw new Unsupported();
  const ampersand = raw.indexOf('&');
  if (ampersand >= 0 && !referencesSupported(raw, ampersand)) throw new Unsupported();
  if (raw.indexOf('\r') >= 0) raw = raw.replace(/\r\n?/g, '\n');
  return decodeXmlEntities(raw);
}

/**
 * Whether `xml` has at most `max` tags of any kind. A part with more may have more elements
 * than its budget allows, and it goes to the bounded reader, which counts them before it
 * allocates anything. So this reader never builds more nodes than an admitted part has.
 */
function tagsWithin(xml: string, max: number): boolean {
  let tags = 0;
  for (let at = xml.indexOf('<'); at >= 0; at = xml.indexOf('<', at + 1)) {
    tags += 1;
    if (tags > max) return false;
  }
  return true;
}

/** The `>` that ends the tag whose attributes start at `from`, skipping quoted values. */
function tagEnd(xml: string, from: number): number {
  for (let index = from; index < xml.length; index += 1) {
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

interface TagAttributes {
  readonly attributes: Record<string, string>;
  /** Just after the tag's `>`. */
  readonly end: number;
  readonly selfClosing: boolean;
}

interface OpenFrame {
  readonly name: string;
  readonly attributes: Record<string, string>;
  readonly children: XmlNode[];
}

/**
 * A resumable one-pass read of one part. {@link FastXmlRead.advance} reads up to a character
 * offset, so a caller can give the page a turn between calls.
 */
export class FastXmlRead {
  private index = 0;
  private count = 0;
  private readonly stack: OpenFrame[] = [];
  private root: XmlElement | null = null;
  private failed = false;
  /** Attribute reads by their exact tag text, while this part reads. */
  private readonly records = new Map<string, TagAttributes>();
  /** Names repeat on every element; one copy each, detached from the part's text. */
  private readonly names = new Map<string, string>();

  constructor(
    private readonly xml: string,
    private readonly maxElements: number
  ) {
    if (xml.charCodeAt(0) === 0xfeff || !tagsWithin(xml, maxElements)) {
      this.failed = true;
      return;
    }
    if (xml.startsWith('<?xml', 0)) {
      DECLARATION_RE.lastIndex = 0;
      if (!DECLARATION_RE.test(xml)) {
        this.failed = true;
        return;
      }
      this.index = DECLARATION_RE.lastIndex;
    }
  }

  /** True once the read finished or gave up. */
  get done(): boolean {
    return this.failed || this.root !== null;
  }

  /** The nodes the bounded reader would return, or null when this reader gave up. */
  result(): readonly XmlNode[] | null {
    return !this.failed && this.root !== null ? [this.root] : null;
  }

  /** Read until offset `until` or the end of the root, whichever is first. */
  advance(until: number): void {
    if (this.done) return;
    try {
      this.read(until);
    } catch {
      // `Unsupported`, or a value `decodeXmlEntities` refused: the bounded reader decides.
      this.failed = true;
    }
  }

  private name(start: number): number {
    const { xml } = this;
    let end = start;
    while (end < xml.length && isNameChar(xml.charCodeAt(end))) end += 1;
    return end;
  }

  private intern(start: number, end: number): string {
    const raw = this.xml.slice(start, end);
    let name = this.names.get(raw);
    if (name === undefined) {
      if (RESERVED_NAMES.has(raw)) throw new Unsupported();
      name = ownString(raw);
      this.names.set(name, name);
    }
    return name;
  }

  private read(until: number): void {
    const { xml, stack } = this;
    const length = xml.length;
    let i = this.index;
    if (stack.length === 0) {
      while (i < length && isSpace(xml.charCodeAt(i))) i += 1;
    }
    while (i < until) {
      if (i >= length) throw new Unsupported();
      if (xml.charCodeAt(i) !== 60 /* < */) {
        // Character data: only inside the root.
        if (stack.length === 0) throw new Unsupported();
        const lt = xml.indexOf('<', i);
        if (lt < 0) throw new Unsupported();
        stack[stack.length - 1]!.children.push({ type: 'text', value: characterData(xml, i, lt) });
        i = lt;
        continue;
      }
      const next = xml.charCodeAt(i + 1);
      if (next === 47 /* / */) {
        const nameEnd = this.name(i + 2);
        let gt = nameEnd;
        while (gt < length && isSpace(xml.charCodeAt(gt))) gt += 1;
        const frame = stack.pop();
        if (
          frame === undefined ||
          xml.charCodeAt(gt) !== 62 ||
          nameEnd - (i + 2) !== frame.name.length ||
          !xml.startsWith(frame.name, i + 2)
        )
          throw new Unsupported();
        i = gt + 1;
        if (this.close(frame)) {
          this.finish(i);
          return;
        }
        continue;
      }
      if (!isNameStart(next)) throw new Unsupported();
      if (stack.length === 0 && this.count > 0) throw new Unsupported();
      this.count += 1;
      if (this.count > this.maxElements || stack.length >= MAX_FAST_DEPTH) throw new Unsupported();
      const nameEnd = this.name(i + 1);
      const name = this.intern(i + 1, nameEnd);
      const { attributes, end, selfClosing } = this.attributes(nameEnd);
      i = end;
      const frame: OpenFrame = { name, attributes, children: [] };
      if (!selfClosing) {
        stack.push(frame);
        continue;
      }
      if (this.close(frame)) {
        this.finish(i);
        return;
      }
    }
    this.index = i;
  }

  /**
   * The attributes of the start tag whose name ends at `nameEnd`, where the tag ends, and
   * whether it is an empty-element tag. Equal attribute text reads to ONE frozen record, so a
   * part's thousands of identical property elements share it and their reads below skip it.
   */
  private attributes(nameEnd: number): TagAttributes {
    const { xml } = this;
    const gt = tagEnd(xml, nameEnd);
    if (gt < 0) throw new Unsupported();
    // Most tags with no attributes end right at their name.
    if (gt === nameEnd || (gt === nameEnd + 1 && xml.charCodeAt(nameEnd) === 47))
      return this.parseAttributes(nameEnd);
    const key = xml.slice(nameEnd, gt + 1);
    const shared = this.records.get(key);
    if (shared !== undefined) return { ...shared, end: gt + 1 };
    const read = this.parseAttributes(nameEnd);
    if (read.end !== gt + 1) throw new Unsupported();
    Object.freeze(read.attributes);
    if (this.records.size >= MAX_SHARED_RECORDS) this.records.clear();
    this.records.set(key, read);
    return read;
  }

  private parseAttributes(nameEnd: number): TagAttributes {
    const { xml } = this;
    const length = xml.length;
    const attributes = Object.create(null) as Record<string, string>;
    let at = nameEnd;
    for (;;) {
      const spaceStart = at;
      while (at < length && isSpace(xml.charCodeAt(at))) at += 1;
      const code = xml.charCodeAt(at);
      if (code === 62 /* > */) return { attributes, end: at + 1, selfClosing: false };
      if (code === 47 /* / */) {
        if (xml.charCodeAt(at + 1) !== 62) throw new Unsupported();
        return { attributes, end: at + 2, selfClosing: true };
      }
      if (at === spaceStart || !isNameStart(code)) throw new Unsupported();
      const attributeEnd = this.name(at);
      const attributeName = this.intern(at, attributeEnd);
      at = attributeEnd;
      while (at < length && isSpace(xml.charCodeAt(at))) at += 1;
      if (xml.charCodeAt(at) !== 61 /* = */) throw new Unsupported();
      at += 1;
      while (at < length && isSpace(xml.charCodeAt(at))) at += 1;
      const quote = xml.charCodeAt(at);
      if (quote !== 34 && quote !== 39) throw new Unsupported();
      const valueEnd = xml.indexOf(quote === 34 ? '"' : "'", at + 1);
      if (valueEnd < 0) throw new Unsupported();
      if (attributeName in attributes) throw new Unsupported();
      attributes[attributeName] = characterData(xml, at + 1, valueEnd, true);
      at = valueEnd + 1;
    }
  }

  /** Attach `frame` to its parent; true when it was the root. */
  private close(frame: OpenFrame): boolean {
    const element: XmlElement = {
      type: 'element',
      name: frame.name,
      attributes: frame.attributes,
      children: frame.children,
    };
    const parent = this.stack[this.stack.length - 1];
    if (parent === undefined) {
      this.root = element;
      return true;
    }
    parent.children.push(element);
    return false;
  }

  /** Only whitespace may follow the root. */
  private finish(from: number): void {
    const { xml } = this;
    for (let i = from; i < xml.length; i += 1) {
      if (!isSpace(xml.charCodeAt(i))) {
        this.root = null;
        this.failed = true;
        return;
      }
    }
  }
}

/** Read `xml` in one go with {@link FastXmlRead}; null means "use the bounded reader". */
export function fastReadXml(xml: string, maxElements: number): readonly XmlNode[] | null {
  const read = new FastXmlRead(xml, maxElements);
  read.advance(xml.length);
  return read.result();
}

/** {@link fastReadXml}, yielding after every `stepChars` characters. */
export function* fastReadXmlSteps(
  xml: string,
  maxElements: number,
  stepChars: number
): Generator<void, readonly XmlNode[] | null> {
  const read = new FastXmlRead(xml, maxElements);
  for (let until = stepChars; !read.done; until += stepChars) {
    read.advance(Math.min(until, xml.length + 1));
    if (!read.done) yield;
  }
  return read.result();
}
