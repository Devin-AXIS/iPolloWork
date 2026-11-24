import { isValidXmlText } from '../package/sinks.ts';
import { hardBreakAttributes } from '../package/hard-break.ts';
import { NON_BREAKING_HYPHEN_TEXT, OPTIONAL_HYPHEN_TEXT } from '../package/hyphen-text.ts';
import { WML_NAMESPACE_URI, type OoxmlNode } from '../package/ooxml-tree.ts';
import type { ContentControlProperties } from '../package/content-control-nodes.ts';

/**
 * A `w:t`, or a `w:delText` when the text being rebuilt was already struck.
 *
 * SPLITTING a run must not change what the run is. This built a `w:t` unconditionally, so
 * every ordinary gesture that splits a run inside a `w:del` — commenting on struck text,
 * bolding across it — silently re-labelled the deletion as live text (§17.3.3.7 requires
 * `w:delText` there), and the damage only showed when the file reached Word.
 */
export function textElement(
  nextId: () => string,
  text: string,
  kind: 'text' | 'deletedText' = 'text'
): OoxmlNode {
  const valueId = nextId();
  return {
    id: nextId(),
    kind,
    namespaceUri: WML_NAMESPACE_URI,
    localName: kind === 'deletedText' ? 'delText' : 't',
    prefix: 'w',
    namespaceBindings: [],
    // `xml:space="preserve"` is not added here: the serializer owns lexical form, and a
    // leading/trailing space is preserved by the tree regardless of the attribute.
    attributes: [],
    children: [{ id: valueId, kind: 'textValue', value: text }],
  } as unknown as OoxmlNode;
}

export function simpleElement(
  nextId: () => string,
  localName: 'tab' | 'br',
  breakKind: 'line' | 'page' = 'line'
): OoxmlNode {
  return {
    id: nextId(),
    kind: localName === 'tab' ? 'tab' : 'hardBreak',
    namespaceUri: WML_NAMESPACE_URI,
    localName,
    prefix: 'w',
    namespaceBindings: [],
    attributes: localName === 'br' ? [...hardBreakAttributes(breakKind)] : [],
    children: [],
  } as unknown as OoxmlNode;
}

/**
 * The character inserted text uses for a manual line break (`w:br`). Model text reads the break
 * as `\n`; a write spells it `\v` because `\n` in written text is a paragraph mark.
 */
export const LINE_BREAK_TEXT = '\v';

const HYPHEN_CHARACTERS = /[\u001e\u001f\v]/;
const ALL_HYPHEN_CHARACTERS = /[\u001e\u001f\v]/g;

/**
 * Most elements one inserted text may create from U+001E, U+001F, and `\v` together, so a
 * string cannot mint a node flood.
 */
export const MAX_INSERTED_HYPHENS = 4096;

/** Control kinds whose value is one line: a choice, a date, a check mark, or a picture. */
const SINGLE_LINE_CONTROLS: ReadonlySet<ContentControlProperties['type']> = new Set([
  'checkbox',
  'dropDownList',
  'comboBox',
  'date',
  'picture',
] as const);

/**
 * Whether a control may hold a manual line break. A plain-text control holds one only when it
 * declares `w:multiLine`; a choice, date, check mark, or picture never does. Rich text and the
 * container kinds (building blocks, groups, citations, equations) hold whatever their paragraphs
 * hold.
 */
export function propertiesHoldLineBreaks(
  properties: Pick<ContentControlProperties, 'type' | 'multiLine'>
): boolean {
  if (properties.type === 'plainText') return properties.multiLine === true;
  return !SINGLE_LINE_CONTROLS.has(properties.type);
}

/** Whether inserted text holds a character that becomes a hyphen or line-break element. */
export function holdsHyphenCharacter(text: string): boolean {
  return HYPHEN_CHARACTERS.test(text);
}

/**
 * Whether text can be inserted as run content: valid XML text, except that U+001E, U+001F, and
 * `\v` are allowed, up to {@link MAX_INSERTED_HYPHENS}, because they become hyphen and
 * line-break elements.
 */
export function isInsertableText(text: string): boolean {
  if (!holdsHyphenCharacter(text)) return isValidXmlText(text);
  return areInsertableTexts([text]);
}

/** A hyphen between the two halves of a surrogate pair would leave each half alone. */
function splitsSurrogateAt(text: string, index: number): boolean {
  const before = index > 0 ? text.charCodeAt(index - 1) : 0;
  const after = index + 1 < text.length ? text.charCodeAt(index + 1) : 0;
  return (before >= 0xd800 && before <= 0xdbff) || (after >= 0xdc00 && after <= 0xdfff);
}

/**
 * {@link isInsertableText} for texts one operation writes together: the hyphen cap covers them
 * all. Each hyphen becomes its own element, so one between the halves of a surrogate pair is
 * refused.
 */
export function areInsertableTexts(texts: readonly string[]): boolean {
  let hyphens = 0;
  for (const text of texts) {
    if (!holdsHyphenCharacter(text)) {
      if (!isValidXmlText(text)) return false;
      continue;
    }
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      if (code !== 0x1e && code !== 0x1f && code !== 0x0b) continue;
      hyphens += 1;
      if (hyphens > MAX_INSERTED_HYPHENS || splitsSurrogateAt(text, index)) return false;
    }
    if (!isValidXmlText(text.replace(ALL_HYPHEN_CHARACTERS, ''))) return false;
  }
  return true;
}

/** A builder for one inserted run child. */
export type RunChildBuilder = (nextId: () => string) => OoxmlNode;

function hyphenElement(nextId: () => string, char: string): OoxmlNode {
  return {
    id: nextId(),
    kind: 'generic',
    namespaceUri: WML_NAMESPACE_URI,
    localName: char === NON_BREAKING_HYPHEN_TEXT ? 'noBreakHyphen' : 'softHyphen',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children: [],
  } as unknown as OoxmlNode;
}

/**
 * Run content for inserted text: `w:t` for the text, `w:noBreakHyphen` or `w:softHyphen` for
 * each U+001E or U+001F (the characters a text read reports for those elements), and `w:br`
 * for each `\v`.
 */
export function textWithHyphenBuilders(text: string): RunChildBuilder[] {
  if (!holdsHyphenCharacter(text)) return [(nextId) => textElement(nextId, text)];
  const builders: RunChildBuilder[] = [];
  let from = 0;
  for (let index = 0; index <= text.length; index += 1) {
    const char = text[index];
    const end = index === text.length;
    if (
      !end &&
      char !== NON_BREAKING_HYPHEN_TEXT &&
      char !== OPTIONAL_HYPHEN_TEXT &&
      char !== LINE_BREAK_TEXT
    )
      continue;
    if (index > from) {
      const piece = text.slice(from, index);
      builders.push((nextId) => textElement(nextId, piece));
    }
    if (!end)
      builders.push((nextId) =>
        char === LINE_BREAK_TEXT ? simpleElement(nextId, 'br') : hyphenElement(nextId, char!)
      );
    from = index + 1;
  }
  return builders;
}

/** The nodes {@link textWithHyphenBuilders} describes, minted in order. */
export function textWithHyphens(nextId: () => string, text: string): OoxmlNode[] {
  return textWithHyphenBuilders(text).map((build) => build(nextId));
}
