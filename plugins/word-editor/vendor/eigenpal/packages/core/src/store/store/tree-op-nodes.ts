// Node identity and op-result helpers shared by the op appliers.
//
// Split out of tree-op-apply.ts only so the section/list appliers can live in their own
// module without importing it back — the two would otherwise form a cycle, and this is the
// half both of them need.

import { findNode, parentNodeOf, type OoxmlEditResult } from '../package/ooxml-edit.ts';
import {
  isInlineRunContainer,
  MAX_INLINE_CONTAINER_DEPTH,
  readOnOffChild,
  W14_NAMESPACE_URI,
} from '../package/ooxml-shared.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
  type OoxmlParagraphNode,
} from '../package/ooxml-tree.ts';
import { DEPENDENCY_KEY_IDS } from '../registry/frozen-ids.ts';
import { sameChangeAcross } from './same-revision.ts';
import type { TreeOpEffect, TreeOpResult } from './tree-op-types.ts';

export const TEXT_DEPS = [DEPENDENCY_KEY_IDS.story];

/**
 * `EG_ParaRPrTrackChanges` — the four revisions a paragraph MARK can carry (§17.13.5).
 *
 * They sit in `w:pPr/w:rPr` beside ordinary run properties, which is why every lane that
 * rewrites that container has to tell them apart: a rebuild that treats them as formatting
 * either drops somebody's pending decision about the paragraph break or copies it somewhere
 * it does not belong. One spelling, so the lanes cannot disagree about the four names.
 */
export function isParagraphMarkRevision(node: OoxmlNode): boolean {
  return (
    node.kind !== 'textValue' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    (node.localName === 'ins' ||
      node.localName === 'del' ||
      node.localName === 'moveFrom' ||
      node.localName === 'moveTo')
  );
}

/** `w15` wordml-2012 — `w15:repeatingSection` lives here. */
const W15_NAMESPACE_URI = 'http://schemas.microsoft.com/office/word/2012/wordml';

/**
 * Default namespaces for well-known `w:sdtPr` children that are not in WML.
 * Explicit `namespaceUri` arguments still win.
 */
const SDT_PR_CHILD_NAMESPACE: Readonly<Record<string, string>> = {
  checkbox: W14_NAMESPACE_URI,
  repeatingSection: W15_NAMESPACE_URI,
};

/**
 * Nesting budget for control-only and block-control walks.
 * Paragraph-inline walks use `MAX_INLINE_CONTAINER_DEPTH` across every transparent container.
 */
export const MAX_CONTENT_CONTROL_NESTING = 32;

/** Kind string of a node — widened so typed SDT kinds typecheck before/while they land. */
export function nodeKindOf(node: OoxmlNode): string {
  return node.kind;
}

/**
 * `w:sdt` — typed `contentControl` or still-generic during migration.
 *
 * Returns `boolean` (not `node is OoxmlElement`): a false result must not exclude every
 * element from the union the way a broad type predicate would — callers that branch on
 * `!isContentControlNode(x)` still need `x.kind === 'run'` / `.children` to typecheck.
 */
export function isContentControlNode(node: OoxmlNode): boolean {
  if (node.kind === 'textValue') return false;
  const kind = nodeKindOf(node);
  if (kind === 'contentControl') return true;
  return kind === 'generic' && node.localName === 'sdt' && node.namespaceUri === WML_NAMESPACE_URI;
}

/** `w:sdtContent` — typed or generic. */
export function isContentControlContentNode(node: OoxmlNode): boolean {
  if (node.kind === 'textValue') return false;
  const kind = nodeKindOf(node);
  if (kind === 'contentControlContent') return true;
  return (
    kind === 'generic' && node.localName === 'sdtContent' && node.namespaceUri === WML_NAMESPACE_URI
  );
}

/** `w:sdtPr` — typed or generic. */
export function isContentControlPropertiesNode(node: OoxmlNode): boolean {
  if (node.kind === 'textValue') return false;
  const kind = nodeKindOf(node);
  if (kind === 'contentControlProperties') return true;
  return (
    kind === 'generic' && node.localName === 'sdtPr' && node.namespaceUri === WML_NAMESPACE_URI
  );
}

/** `w:sdtEndPr` — typed or generic. */
export function isContentControlEndPropertiesNode(node: OoxmlNode): boolean {
  if (node.kind === 'textValue') return false;
  const kind = nodeKindOf(node);
  if (kind === 'contentControlEndProperties') return true;
  return (
    kind === 'generic' && node.localName === 'sdtEndPr' && node.namespaceUri === WML_NAMESPACE_URI
  );
}

/** The control's `w:sdtPr`, if present. */
export function contentControlPropertiesOf(control: OoxmlNode): OoxmlElement | undefined {
  if (control.kind === 'textValue' || !isContentControlNode(control)) return undefined;
  // Widen past the typed children's union so the element predicate is accepted by `.find`.
  const children: readonly OoxmlNode[] = control.children;
  return children.find(
    (child): child is OoxmlElement =>
      child.kind !== 'textValue' && isContentControlPropertiesNode(child)
  );
}

/** The control's `w:sdtContent`, if present. */
export function contentControlContentOf(control: OoxmlNode): OoxmlElement | undefined {
  if (control.kind === 'textValue' || !isContentControlNode(control)) return undefined;
  const children: readonly OoxmlNode[] = control.children;
  return children.find(
    (child): child is OoxmlElement =>
      child.kind !== 'textValue' && isContentControlContentNode(child)
  );
}

/**
 * Payload to splice into the parent when unwrapping a content control.
 *
 * Walks children in authored order: drops `w:sdtPr` / `w:sdtEndPr`, expands a single
 * `w:sdtContent`, and keeps every other non-property child (extension markup, including
 * foreign-namespace siblings that reuse the `sdtPr`/`sdtEndPr` local names). Returns
 * `null` when the control is ambiguous — more than one `w:sdtContent` — so callers fail
 * closed instead of silently dropping duplicate containers or extension siblings.
 */
export function contentControlUnwrapPayload(control: OoxmlNode): readonly OoxmlNode[] | null {
  if (control.kind === 'textValue' || !isContentControlNode(control)) return null;
  const kept: OoxmlNode[] = [];
  let contentCount = 0;
  for (const child of control.children) {
    if (child.kind === 'textValue') continue;
    if (isContentControlPropertiesNode(child) || isContentControlEndPropertiesNode(child)) {
      continue;
    }
    if (isContentControlContentNode(child)) {
      contentCount += 1;
      if (contentCount > 1) return null;
      kept.push(...child.children);
      continue;
    }
    kept.push(child);
  }
  return kept;
}

/**
 * A child of `w:sdtPr` by expanded name. Defaults to WML, except well-known vendor
 * extensions (`w14:checkbox`, `w15:repeatingSection`). Foreign siblings that reuse a
 * WML local name cannot shadow the real property.
 */
export function sdtPrChild(
  properties: OoxmlNode | undefined,
  localName: string,
  namespaceUri: string = SDT_PR_CHILD_NAMESPACE[localName] ?? WML_NAMESPACE_URI
): OoxmlElement | undefined {
  if (!properties || properties.kind === 'textValue') return undefined;
  const children: readonly OoxmlNode[] = properties.children;
  return children.find(
    (child): child is OoxmlElement =>
      child.kind !== 'textValue' &&
      child.localName === localName &&
      child.namespaceUri === namespaceUri
  );
}

/**
 * Attribute value by expanded name. Defaults to the element's own namespace so `w:val`
 * and `w14:val` resolve correctly and a foreign `x:val` cannot shadow either.
 */
export function attributeValueOf(
  node: OoxmlNode | undefined,
  localName: string,
  namespaceUri?: string
): string | undefined {
  if (!node || node.kind === 'textValue') return undefined;
  const ns = namespaceUri ?? node.namespaceUri;
  return node.attributes.find(
    (attribute) => attribute.localName === localName && attribute.namespaceUri === ns
  )?.value;
}

export type SdtLockValue = 'sdtLocked' | 'contentLocked' | 'sdtContentLocked' | 'unlocked';

export interface ContentControlLockFlags {
  /** `sdtLocked` or `sdtContentLocked` — wrapper removal refused. */
  readonly wrapper: boolean;
  /** `contentLocked` or `sdtContentLocked` — content / value edits refused. */
  readonly content: boolean;
}

export function lockFlagsFromValue(value: string | undefined): ContentControlLockFlags {
  switch (value) {
    case 'sdtLocked':
      return { wrapper: true, content: false };
    case 'contentLocked':
      return { wrapper: false, content: true };
    case 'sdtContentLocked':
      return { wrapper: true, content: true };
    default:
      return { wrapper: false, content: false };
  }
}

export function unionLockFlags(
  a: ContentControlLockFlags,
  b: ContentControlLockFlags
): ContentControlLockFlags {
  return { wrapper: a.wrapper || b.wrapper, content: a.content || b.content };
}

/** Declared `w:lock/@w:val` on one control (absent → unlocked). */
export function declaredLockOf(control: OoxmlNode): ContentControlLockFlags {
  const lock = sdtPrChild(contentControlPropertiesOf(control), 'lock');
  return lockFlagsFromValue(attributeValueOf(lock, 'val'));
}

/** Whether the control declares `w:dataBinding`. */
export function isBoundContentControl(control: OoxmlNode): boolean {
  return sdtPrChild(contentControlPropertiesOf(control), 'dataBinding') !== undefined;
}

/** Whether the control declares a repeating-section extension (`w15:repeatingSection`). */
export function isRepeatingSectionControl(control: OoxmlNode): boolean {
  return sdtPrChild(contentControlPropertiesOf(control), 'repeatingSection') !== undefined;
}

/** `w:showingPlcHdr` is present and on — content is a prompt, not user data. */
export function isShowingPlaceholder(control: OoxmlNode): boolean {
  const properties = contentControlPropertiesOf(control);
  return properties ? readOnOffChild(properties, 'showingPlcHdr') : false;
}

/** `w:temporary` is present and on — first successful content edit unwraps the wrapper. */
export function isTemporaryControl(control: OoxmlNode): boolean {
  const properties = contentControlPropertiesOf(control);
  return properties ? readOnOffChild(properties, 'temporary') : false;
}

/**
 * `w:placeholder/w:docPart` names a glossary entry. This lane preserves the reference and
 * never resolves the glossary, so emptying cannot restore a durable prompt from it.
 */
export function hasGlossaryPlaceholderRef(control: OoxmlNode): boolean {
  const placeholder = sdtPrChild(contentControlPropertiesOf(control), 'placeholder');
  if (!placeholder) return false;
  const children: readonly OoxmlNode[] = placeholder.children;
  return children.some(
    (child) =>
      child.kind !== 'textValue' &&
      child.localName === 'docPart' &&
      child.namespaceUri === WML_NAMESPACE_URI
  );
}

/**
 * The inline CONTAINERS holding a descendant, innermost first, within one paragraph.
 */
export function inlineContainersOf(
  paragraph: { readonly children: readonly OoxmlNode[] },
  descendantId: string
): readonly OoxmlNode[] {
  let held: OoxmlNode[] | null = null;
  const path: OoxmlNode[] = [];
  const visit = (node: OoxmlNode, depth: number): void => {
    if (node.kind === 'textValue' || held !== null) return;
    if (depth >= MAX_INLINE_CONTAINER_DEPTH) return;
    if (node.id === descendantId) {
      held = path.slice().reverse();
      return;
    }
    const counted =
      node.kind === 'fldSimple' ||
      (node.kind === 'generic' && node.localName === 'fldSimple') ||
      isInlineRunContainer(node) ||
      // A content control is a container the same way a link is: typing at its OUTER edge
      // must not join the run inside and grow the control (pro-review-and-custom-nodes 4.6).
      isContentControlNode(node);
    const nextDepth = counted ? depth + 1 : depth;
    if (counted) path.push(node);
    for (const child of node.children) visit(child, nextDepth);
    if (counted) path.pop();
  };
  for (const child of paragraph.children) visit(child, 0);
  return held ?? [];
}

/** The innermost inline container holding a descendant, or null for a direct child. */
export function inlineContainerOf(
  paragraph: { readonly children: readonly OoxmlNode[] },
  descendantId: string
): OoxmlNode | null {
  return inlineContainersOf(paragraph, descendantId)[0] ?? null;
}

/**
 * Whether typing into `before`'s run would carry the text INTO a container the caret is
 * leaving — a hyperlink, a field, or a content control whose last character this is, with
 * ordinary paragraph content (or nothing at all) on the other side of the boundary.
 *
 * Shared between apply (which picks the target run) and validate (which attributes the
 * caret's lock check): the two answering differently is how a caret at a locked chip's
 * outer edge refused a keystroke the apply side would have placed BESIDE the chip.
 */
export function leavesInlineContainer(
  paragraph: { readonly children: readonly OoxmlNode[] },
  before: { readonly runId: string },
  after: { readonly runId: string } | undefined
): boolean {
  const held = inlineContainerOf(paragraph, before.runId);
  if (held === null) return false;
  if (after === undefined) return true;
  const next = inlineContainerOf(paragraph, after.runId);
  if (next === held) return false;
  // Two adjacent wrappers of one change are one container: the caret stays in the change.
  return next === null || !sameChangeAcross(paragraph, held, next);
}

/** Innermost content-control ancestor of a node (the node itself when it is one). */
export function innermostContentControlAround(
  part: OoxmlPart,
  nodeId: string
): OoxmlElement | null {
  const self = findContentControl(part, nodeId);
  if (self) return self;
  const ancestors = contentControlAncestorsOf(part, nodeId);
  return ancestors[ancestors.length - 1] ?? null;
}

/**
 * Control type for value ops — checkbox is read before "untyped" (design S5).
 * `repeatingSection` is detected separately and refused as unsupported.
 */
export type ContentControlValueType =
  | 'text'
  | 'dropdown'
  | 'combo'
  | 'checkbox'
  | 'date'
  | 'picture'
  | 'richText'
  | 'repeatingSection'
  | 'other';

export function contentControlValueTypeOf(control: OoxmlNode): ContentControlValueType {
  const properties = contentControlPropertiesOf(control);
  if (!properties) return 'richText';
  if (sdtPrChild(properties, 'repeatingSection')) return 'repeatingSection';
  if (sdtPrChild(properties, 'checkbox')) return 'checkbox';
  if (sdtPrChild(properties, 'dropDownList')) return 'dropdown';
  if (sdtPrChild(properties, 'comboBox')) return 'combo';
  if (sdtPrChild(properties, 'date')) return 'date';
  if (sdtPrChild(properties, 'picture')) return 'picture';
  if (sdtPrChild(properties, 'text')) return 'text';
  return 'richText';
}

/**
 * Whether typing can never enter this control: its content is locked (`contentLocked`,
 * `sdtContentLocked`), bound to a data store (`w:dataBinding`), or a glyph or picture rather
 * than text (`w14:checkbox`, `w:picture`).
 *
 * An unowned insertion at the outer edge of such a control lands beside it (`insertionSite`),
 * and the keyboard never names one as the owner of a keystroke (`insertOwnerOf`). Entering it
 * would be refused, or would write text into a checkbox glyph.
 */
export function refusesTypedContent(control: OoxmlNode): boolean {
  if (declaredLockOf(control).content || isBoundContentControl(control)) return true;
  const type = contentControlValueTypeOf(control);
  return type === 'checkbox' || type === 'picture';
}

/** Ancestor content controls of a node, outermost first. */
export function contentControlAncestorsOf(part: OoxmlPart, nodeId: string): OoxmlElement[] {
  const chain: OoxmlElement[] = [];
  let current: OoxmlElement | null = parentOf(part, nodeId);
  while (current) {
    if (isContentControlNode(current)) chain.push(current);
    current = parentOf(part, current.id);
  }
  return chain.reverse();
}

/** Nested lock union for a control including its own declaration. */
export function effectiveLockOf(part: OoxmlPart, control: OoxmlNode): ContentControlLockFlags {
  let flags = declaredLockOf(control);
  for (const ancestor of contentControlAncestorsOf(part, control.id)) {
    flags = unionLockFlags(flags, declaredLockOf(ancestor));
  }
  return flags;
}

/** Effective content-edit lock at a node (union of every enclosing control, and itself). */
export function effectiveContentLockAt(part: OoxmlPart, nodeId: string): ContentControlLockFlags {
  let flags: ContentControlLockFlags = { wrapper: false, content: false };
  const self = findContentControl(part, nodeId);
  if (self) flags = unionLockFlags(flags, declaredLockOf(self));
  for (const ancestor of contentControlAncestorsOf(part, nodeId)) {
    flags = unionLockFlags(flags, declaredLockOf(ancestor));
  }
  return flags;
}

export function findContentControl(part: OoxmlPart, controlId: string): OoxmlElement | null {
  const node = findNode(part, controlId);
  if (!node || node.kind === 'textValue' || !isContentControlNode(node)) return null;
  return node;
}

/** Dropdown / combo `w:listItem` entries. */
export function listItemsOf(control: OoxmlNode): readonly { displayText: string; value: string }[] {
  const properties = contentControlPropertiesOf(control);
  const list = sdtPrChild(properties, 'dropDownList') ?? sdtPrChild(properties, 'comboBox');
  if (!list) return [];
  const items: { displayText: string; value: string }[] = [];
  for (const child of list.children) {
    if (
      child.kind === 'textValue' ||
      child.localName !== 'listItem' ||
      child.namespaceUri !== WML_NAMESPACE_URI
    ) {
      continue;
    }
    const value = attributeValueOf(child, 'value') ?? '';
    const displayText = attributeValueOf(child, 'displayText') ?? value;
    items.push({ displayText, value });
  }
  return items;
}

/** `w14:checkbox` payload with the MS-DOCX §2.6.3.29 symbol defaults. */
export function checkboxPayloadOf(control: OoxmlNode): {
  readonly checkbox: OoxmlElement;
  readonly checked: boolean;
  readonly checkedGlyph: string;
  readonly uncheckedGlyph: string;
  readonly checkedFont: string;
  readonly uncheckedFont: string;
} | null {
  const checkbox = sdtPrChild(contentControlPropertiesOf(control), 'checkbox');
  if (!checkbox) return null;
  const checkedNode = checkbox.children.find(
    (child) =>
      child.kind !== 'textValue' &&
      child.localName === 'checked' &&
      child.namespaceUri === W14_NAMESPACE_URI
  );
  const checkedVal = attributeValueOf(checkedNode, 'val');
  const checked =
    checkedVal === undefined ||
    !(checkedVal === '0' || checkedVal === 'false' || checkedVal === 'off');
  const checkedState = checkbox.children.find(
    (child) =>
      child.kind !== 'textValue' &&
      child.localName === 'checkedState' &&
      child.namespaceUri === W14_NAMESPACE_URI
  );
  const uncheckedState = checkbox.children.find(
    (child) =>
      child.kind !== 'textValue' &&
      child.localName === 'uncheckedState' &&
      child.namespaceUri === W14_NAMESPACE_URI
  );
  return {
    checkbox,
    checked,
    checkedGlyph: attributeValueOf(checkedState, 'val') ?? '2612',
    uncheckedGlyph: attributeValueOf(uncheckedState, 'val') ?? '2610',
    checkedFont: attributeValueOf(checkedState, 'font') ?? 'MS Gothic',
    uncheckedFont: attributeValueOf(uncheckedState, 'font') ?? 'MS Gothic',
  };
}

/** Days in `month` (1–12) for a Gregorian `year`, or 0 when the month is out of range. */
function daysInGregorianMonth(year: number, month: number): number {
  if (month < 1 || month > 12) return 0;
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/**
 * Strict calendar date / date-time parse for content-control values destined for
 * `@w:fullDate`. Accepts `YYYY-MM-DD` or an ISO-8601 local/Zulu/offset date-time; rejects
 * impossible calendar dates (e.g. Feb 31), non-leap Feb 29, and malformed time suffixes.
 * Returns a normalized `xsd:dateTime` string (`…T…Z` or with a numeric offset).
 */
export function normalizeSdtFullDate(value: string): string | null {
  const trimmed = value.trim();
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})?)?$/.exec(
      trimmed
    );
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const maxDay = daysInGregorianMonth(year, month);
  if (maxDay === 0 || day < 1 || day > maxDay) return null;

  const date = `${match[1]}-${match[2]}-${match[3]}`;
  if (match[4] === undefined) return `${date}T00:00:00Z`;

  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (hour > 23 || minute > 59 || second > 59) return null;

  const fraction = match[7] !== undefined ? `.${match[7]}` : '';
  const zone = match[8] ?? 'Z';
  if (!isValidXsdDateTimeZone(zone)) return null;
  return `${date}T${match[4]}:${match[5]}:${match[6]}${fraction}${zone}`;
}

/** Whether `zone` is a legal `xsd:dateTime` timezone: `Z` or a numeric offset within ±14:00. */
function isValidXsdDateTimeZone(zone: string): boolean {
  if (zone === 'Z') return true;
  if (zone.length !== 6 || (zone[0] !== '+' && zone[0] !== '-')) return false;
  const sign = zone[0] === '+' ? 1 : -1;
  const zoneHour = Number(zone.slice(1, 3));
  const zoneMinute = Number(zone.slice(4, 6));
  if (!Number.isInteger(zoneHour) || !Number.isInteger(zoneMinute)) return false;
  if (zoneHour < 0 || zoneMinute < 0 || zoneMinute > 59) return false;
  const totalMinutes = sign * (zoneHour * 60 + zoneMinute);
  if (totalMinutes > 14 * 60 || totalMinutes < -14 * 60) return false;
  // The bound is exactly ±14:00; a fourteen-hour offset must carry `:00` minutes.
  if (Math.abs(totalMinutes) === 14 * 60 && zoneMinute !== 0) return false;
  return true;
}

/**
 * Format a calendar date for `w:dateFormat` patterns Word commonly authors.
 * Unrecognised tokens are left intact; invalid ISO input returns null.
 */
export function formatSdtDateDisplay(iso: string, pattern: string | undefined): string | null {
  const normalized = normalizeSdtFullDate(iso);
  if (!normalized) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(normalized);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const fmt = pattern && pattern.length > 0 ? pattern : 'M/d/yyyy';
  const monthsShort = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const monthsLong = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  return fmt.replace(/yyyy|yy|MMMM|MMM|MM|M|dd|d/g, (token) => {
    switch (token) {
      case 'yyyy':
        return String(year);
      case 'yy':
        return String(year).slice(-2);
      case 'MMMM':
        return monthsLong[month - 1]!;
      case 'MMM':
        return monthsShort[month - 1]!;
      case 'MM':
        return String(month).padStart(2, '0');
      case 'M':
        return String(month);
      case 'dd':
        return String(day).padStart(2, '0');
      case 'd':
        return String(day);
      default:
        return token;
    }
  });
}

/** Whether a checkbox string value means checked. */
export function parseCheckboxValue(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'true' ||
    normalized === '1' ||
    normalized === 'checked' ||
    normalized === 'on'
  ) {
    return true;
  }
  if (
    normalized === 'false' ||
    normalized === '0' ||
    normalized === 'unchecked' ||
    normalized === 'off'
  ) {
    return false;
  }
  return null;
}

/** True when this node or any enclosing content control declares `w:dataBinding`. */
export function isBoundAt(part: OoxmlPart, nodeId: string): boolean {
  const self = findContentControl(part, nodeId);
  if (self && isBoundContentControl(self)) return true;
  return contentControlAncestorsOf(part, nodeId).some(isBoundContentControl);
}

export function ok(part: OoxmlPart, effect: TreeOpEffect): TreeOpResult {
  return { ok: true, part, effect };
}

export function fromEdit(result: OoxmlEditResult, effect: TreeOpEffect): TreeOpResult {
  if (!result.ok) {
    return { ok: false, reason: 'tree-invariant', detail: JSON.stringify(result.issues) };
  }
  return ok(result.part, effect);
}

/** A deep copy with freshly minted identities, for content duplicated by a split. */
export function cloneWithNewIds(node: OoxmlNode, nextId: () => string): OoxmlNode {
  if (node.kind === 'textValue') return { id: nextId(), kind: 'textValue', value: node.value };
  return {
    ...node,
    id: nextId(),
    children: node.children.map((child) => cloneWithNewIds(child, nextId)),
  } as OoxmlNode;
}

/**
 * A paragraph's property container: its `w:pPr`, whether or not the canonical read TYPED it.
 *
 * A `w:pPr` demotes to generic whenever the reader's known-node invariant refuses it, and one
 * shape that trips it is ordinary Word output — a paragraph mark (`w:rPr`) followed by
 * `w:sectPr` or `w:pPrChange`, which is exactly the CT_PPr order (17.3.1.26). Matching only
 * `kind === 'paragraphProperties'` made every op that writes paragraph properties miss that
 * container and mint a SECOND `w:pPr`, which Word rejects outright; the split appliers lost
 * the tail's properties the same way. The element the paragraph actually has is the one an
 * op must write, so the lookup names it.
 */
export function paragraphPropertiesNodeOf(paragraph: OoxmlNode): OoxmlElement | undefined {
  if (paragraph.kind === 'textValue') return undefined;
  const children: readonly OoxmlNode[] = paragraph.children;
  return children.find(
    (child): child is OoxmlElement => child.kind !== 'textValue' && isParagraphPropertiesNode(child)
  );
}

export function isParagraphPropertiesNode(node: OoxmlNode): boolean {
  if (node.kind === 'paragraphProperties') return true;
  return (
    node.kind === 'generic' && node.localName === 'pPr' && node.namespaceUri === WML_NAMESPACE_URI
  );
}

/**
 * A run's property container: its `w:rPr`, whether or not the canonical read TYPED it.
 *
 * The same tolerance `paragraphPropertiesNodeOf` gives `w:pPr`, for the same reason. An
 * `w:rPr` demotes to generic whenever the known-node invariant refuses it — a stray `w:val`
 * on the container, a typed child where only generic ones belong — and matching on
 * `kind === 'runProperties'` alone then treated that container as run CONTENT: formatting
 * the run prepended a SECOND `w:rPr` beside the first, and splitting the run left the whole
 * of it on the head so the tail lost its formatting.
 */
export function runPropertiesNodeOf(run: OoxmlNode): OoxmlElement | undefined {
  if (run.kind === 'textValue') return undefined;
  const children: readonly OoxmlNode[] = run.children;
  return children.find(
    (child): child is OoxmlElement => child.kind !== 'textValue' && isRunPropertiesNode(child)
  );
}

export function isRunPropertiesNode(node: OoxmlNode): boolean {
  if (node.kind === 'runProperties') return true;
  return (
    node.kind === 'generic' && node.localName === 'rPr' && node.namespaceUri === WML_NAMESPACE_URI
  );
}

/** A named `w:`-namespace child element of a property container. */
export function namedChild(
  container: OoxmlNode | undefined | null,
  localName: string
): OoxmlElement | undefined {
  if (!container || container.kind === 'textValue') return undefined;
  const children: readonly OoxmlNode[] = container.children;
  return children.find(
    (child): child is OoxmlElement =>
      child.kind !== 'textValue' &&
      child.localName === localName &&
      child.namespaceUri === WML_NAMESPACE_URI
  );
}

export function parentOf(part: OoxmlPart, nodeId: string): OoxmlElement | null {
  // Served from the part's node index rather than a fresh full-tree walk: split and join
  // ask for a parent on every op, and the walk made each one O(document).
  return parentNodeOf(part, nodeId);
}

export function paragraphContainingNode(
  part: OoxmlPart,
  nodeId: string
): OoxmlParagraphNode | null {
  let current: OoxmlNode | null = findNode(part, nodeId);
  while (current) {
    if (current.kind === 'paragraph') return current as OoxmlParagraphNode;
    const parent = parentOf(part, current.id);
    current = parent;
  }
  return null;
}
