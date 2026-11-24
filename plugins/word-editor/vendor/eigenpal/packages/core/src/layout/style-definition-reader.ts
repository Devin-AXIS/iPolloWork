// Bounded styles.xml definition parsing, kept separate from cascade resolution.

import { readOoxmlPart, type OoxmlElement, type OoxmlNode } from '@docx-editor.dev/core/store';
import type { OoxmlProperty } from '../store/store/tree-op-types.ts';
import { isDangerousKey } from '../store/package/safe-record.ts';
import { styleOutlineLevel } from '../store/package/style-outline.ts';
import { propertiesOf } from './paragraph-flow.ts';

const STYLE_ID_MAX = 128;
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/;
const MAX_CONDITIONAL_TABLE_FORMATS = 32;

export interface StyleDefinition {
  readonly styleId: string;
  readonly name?: string;
  readonly type: string;
  readonly basedOn: string | null;
  /** `w:next` — the authoring style for a following paragraph. */
  readonly next: string | null;
  readonly outlineLevel: number | null;
  readonly paragraphProperties: readonly OoxmlProperty[];
  readonly runProperties: readonly OoxmlProperty[];
  readonly paragraphPropertiesNode: OoxmlElement | undefined;
  readonly tablePropertiesNode: OoxmlElement | undefined;
  readonly tableRowPropertiesNode: OoxmlElement | undefined;
  readonly tableCellPropertiesNode?: OoxmlElement;
  readonly conditionalTableFormats: ReadonlyMap<string, OoxmlElement>;
}

export function isElement(node: OoxmlNode): node is OoxmlElement {
  return node.kind !== 'textValue';
}

export function attributeValue(node: OoxmlElement, localName: string): string | undefined {
  return node.attributes.find((attribute) => attribute.localName === localName)?.value;
}

export function childNamed(parent: OoxmlElement, localName: string): OoxmlElement | undefined {
  for (const child of parent.children) {
    if (isElement(child) && child.localName === localName) return child;
  }
  return undefined;
}

export function isValidStyleId(raw: string | undefined): raw is string {
  if (raw === undefined || raw.length === 0 || raw.length > STYLE_ID_MAX) return false;
  return !CONTROL_CHARS.test(raw) && !isDangerousKey(raw);
}

/** `w:default`: only the three on-spellings count. */
export function isDefaultFlag(raw: string | undefined): boolean {
  return raw === '1' || raw === 'true' || raw === 'on';
}

export function findRunProperties(container: OoxmlElement | undefined): OoxmlElement | undefined {
  if (!container) return undefined;
  for (const child of container.children) {
    if (isElement(child) && (child.kind === 'runProperties' || child.localName === 'rPr')) {
      return child;
    }
  }
  return undefined;
}

export function findParagraphProperties(
  container: OoxmlElement | undefined
): OoxmlElement | undefined {
  if (!container) return undefined;
  for (const child of container.children) {
    if (isElement(child) && (child.kind === 'paragraphProperties' || child.localName === 'pPr')) {
      return child;
    }
  }
  return undefined;
}

const STYLE_CHANGE_RECORDS: ReadonlySet<string> = new Set([
  'rPrChange',
  'pPrChange',
  'ins',
  'del',
  'moveFrom',
  'moveTo',
]);

export function withoutChangeRecords(props: OoxmlProperty[]): OoxmlProperty[] {
  return props.some((property) => STYLE_CHANGE_RECORDS.has(property.localName))
    ? props.filter((property) => !STYLE_CHANGE_RECORDS.has(property.localName))
    : props;
}

export function readDocDefaults(stylesRoot: OoxmlElement): {
  run: readonly OoxmlProperty[];
  paragraph: readonly OoxmlProperty[];
  paragraphNode: OoxmlElement | undefined;
} {
  const docDefaults = childNamed(stylesRoot, 'docDefaults');
  if (!docDefaults) return { run: [], paragraph: [], paragraphNode: undefined };
  const runNode = findRunProperties(childNamed(docDefaults, 'rPrDefault'));
  const paragraphNode = findParagraphProperties(childNamed(docDefaults, 'pPrDefault'));
  return {
    run: withoutChangeRecords(propertiesOf(runNode)),
    paragraph: withoutChangeRecords(propertiesOf(paragraphNode)),
    paragraphNode,
  };
}

/** What identifies and names one `w:style`: the part of a definition that reads no formatting. */
export interface StyleIdentity {
  readonly styleId: string;
  /** The `w:type`, or an empty string where the part states none. */
  readonly type: string;
  /** The first `w:name`, when it is at most `nameCap` characters. */
  readonly name: string | undefined;
  readonly basedOn: string | null;
  readonly next: string | null;
  readonly isDefault: boolean;
}

/** The validated id a child names, as `w:basedOn` and `w:next` are read. */
function referenceOf(node: OoxmlElement, localName: string): string | null {
  const child = childNamed(node, localName);
  const raw = child ? attributeValue(child, 'val') : undefined;
  return isValidStyleId(raw) ? raw : null;
}

/**
 * Read only what identifies a style, or null where its id is not valid. Layout's own definitions
 * and automation's style listing both read through this, so they agree on which definitions exist.
 * `nameCap` is the longest name the caller keeps: layout never looks a style up by name.
 */
export function readStyleIdentity(node: OoxmlElement, nameCap: number): StyleIdentity | null {
  const styleId = attributeValue(node, 'styleId');
  if (!isValidStyleId(styleId)) return null;
  const nameNode = childNamed(node, 'name');
  const name = nameNode ? attributeValue(nameNode, 'val') : undefined;
  return {
    styleId,
    type: attributeValue(node, 'type') ?? '',
    name: name !== undefined && name.length <= nameCap ? name : undefined,
    basedOn: referenceOf(node, 'basedOn'),
    next: referenceOf(node, 'next'),
    isDefault: isDefaultFlag(attributeValue(node, 'default')),
  };
}

/** Longest style name layout keeps. */
const LAYOUT_NAME_CAP = 128;

/**
 * The built-in table properties of the table style named "Normal Table": no indent, and 108
 * twips of cell margin on the left and right.
 */
const BUILT_IN_NORMAL_TABLE_XML =
  '<w:tblPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/>' +
  '<w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/>' +
  '<w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr>';

let builtInNormalTable: OoxmlElement | undefined;

/**
 * The built-in properties, parsed once under a part name of their own, so their node ids
 * never collide with the nodes of a document's `styles.xml`.
 */
function builtInNormalTableProperties(): OoxmlElement | undefined {
  if (!builtInNormalTable) {
    const read = readOoxmlPart(BUILT_IN_NORMAL_TABLE_XML, {
      name: '/built-in/normal-table.xml',
      contentType: 'application/xml',
    });
    builtInNormalTable = read.ok ? read.part.root : undefined;
  }
  return builtInNormalTable;
}

/**
 * Whether a style is the built-in "Normal Table", matched by name and not id. Its authored
 * definition never applies in any compatibility mode: reference renderings drop its indent,
 * alignment, cell margins, borders, shading, and paragraph and run properties, and keep only
 * the built-in properties.
 */
function isBuiltInNormalTable(type: string, name: string | undefined): boolean {
  return type === 'table' && name?.toLowerCase() === 'normal table';
}

export function readStyleDefinition(
  node: OoxmlElement
): (StyleDefinition & { isDefault: boolean }) | null {
  const identity = readStyleIdentity(node, LAYOUT_NAME_CAP);
  if (!identity) return null;
  const { styleId, type, name, basedOn, next, isDefault } = identity;
  if (isBuiltInNormalTable(type, name)) {
    return {
      styleId,
      name,
      type,
      basedOn: null,
      next,
      outlineLevel: null,
      isDefault,
      paragraphProperties: [],
      runProperties: [],
      paragraphPropertiesNode: undefined,
      tablePropertiesNode: builtInNormalTableProperties(),
      tableRowPropertiesNode: undefined,
      conditionalTableFormats: new Map(),
    };
  }
  const paragraphPropertiesNode = findParagraphProperties(node);
  const runPropertiesNode = findRunProperties(node);
  const conditionalTableFormats = new Map<string, OoxmlElement>();
  let seenConditional = 0;
  for (const child of node.children) {
    if (child.kind === 'textValue' || child.localName !== 'tblStylePr') continue;
    if (seenConditional >= MAX_CONDITIONAL_TABLE_FORMATS) break;
    seenConditional += 1;
    const conditionType = attributeValue(child, 'type');
    if (conditionType && !conditionalTableFormats.has(conditionType)) {
      conditionalTableFormats.set(conditionType, child);
    }
  }
  return {
    styleId,
    name: name || undefined,
    type,
    basedOn,
    next,
    outlineLevel: styleOutlineLevel(node),
    isDefault,
    paragraphProperties: withoutChangeRecords(propertiesOf(paragraphPropertiesNode)),
    runProperties: withoutChangeRecords(propertiesOf(runPropertiesNode)),
    paragraphPropertiesNode,
    tablePropertiesNode: childNamed(node, 'tblPr'),
    tableRowPropertiesNode: childNamed(node, 'trPr'),
    tableCellPropertiesNode: childNamed(node, 'tcPr'),
    conditionalTableFormats,
  };
}
