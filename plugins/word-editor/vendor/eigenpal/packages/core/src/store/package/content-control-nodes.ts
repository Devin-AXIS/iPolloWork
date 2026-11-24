// Typed content-control vocabulary: what a `w:sdt` IS, read off the canonical tree.
//
// The tree types the wrapper, its two property containers and its content
// (`ooxml-tree.ts`); this module is the projection every other lane reads instead of
// walking `localName` strings — the type, the lock, the placeholder state, the items a
// dropdown offers, the glyphs a checkbox chooses between.
//
// THREE RULES HOLD EVERYWHERE HERE.
//
// IDENTITY IS THE NODE, NOT `w:id`. `CT_SdtPr/w:id` is optional and not unique — five
// controls in the comprehensive fixture omit it and files exist where two share one — so
// addressing by it would leave those unaddressable and those ambiguous. `w:id` is
// preserved where present, exposed as metadata, and never fabricated.
//
// `CT_SdtPr` IS A SEQUENCE. Writing one property must not reorder the rest, so a rebuild
// goes through {@link orderedContentControlProperties}, which places modelled children in
// schema order and keeps unmodelled ones (a `w15:repeatingSection`, anything this
// vocabulary does not name) at their original position relative to their neighbours.
//
// NOTHING HERE RESOLVES ANYTHING. `w:dataBinding` names a custom XML part and
// `w:placeholder/w:docPart` names a glossary entry; both are read as metadata and neither
// is fetched, resolved, or evaluated. A projection that reached for a part would be a
// zero-click load of a target an untrusted file chose.

import { inlineCharacterTextOf } from './hyphen-text.ts';
import { hardBreakKind } from './hard-break.ts';
import { nextStripedDecimalId, resolveAllocationActor } from './actor-scoped-ids.ts';
import { isInlineRunContainer, W14_NAMESPACE_URI, WML_NAMESPACE_URI } from './ooxml-shared.ts';
import type {
  OoxmlContentControlContentNode,
  OoxmlContentControlEndPropertiesNode,
  OoxmlContentControlNode,
  OoxmlContentControlPropertiesNode,
  OoxmlElement,
  OoxmlNode,
} from './ooxml-tree.ts';

/** How deep controls may nest before a walk stops descending. Shared by every lane. */
export const MAX_CONTENT_CONTROL_NESTING = 32;

/** Cap on controls one walk reports, so a hostile file cannot make a read unbounded. */
export const MAX_CONTENT_CONTROLS_PER_PART = 10_000;

/** `CT_SdtPr/w:id` is `ST_DecimalNumber`; Word treats it as a signed 32-bit integer. */
export const CONTENT_CONTROL_ID_MAX = 0x7fffffff;

/** `ST_Lock` (§17.5.2.24). An absent `w:lock` is `unlocked`. */
/**
 * `w:lock` — what a control refuses.
 *
 * `sdtLocked` protects the wrapper, `contentLocked` the text inside it, and `sdtContentLocked`
 * both. A control inside a locked one is locked in effect regardless of its own value.
 */
export type ContentControlLock = 'unlocked' | 'sdtLocked' | 'contentLocked' | 'sdtContentLocked';

const LOCK_VALUES: ReadonlySet<string> = new Set([
  'unlocked',
  'sdtLocked',
  'contentLocked',
  'sdtContentLocked',
]);

/**
 * What kind of control this is.
 *
 * `checkbox` is the Microsoft `w14:checkbox` extension rather than an ECMA-376 type
 * element, and the two are not mutually exclusive with "declares no type": four controls
 * in the comprehensive fixture declare the extension and no `w:`-prefixed type, so a scan
 * that read only the ECMA-376 choice reported them untyped. `untyped` means the control
 * declares neither — a rich-text container, which is what Word treats it as.
 */
/** Which kind of control a `w:sdt` is, and therefore what a written value must look like. */
export type ContentControlKind =
  | 'richText'
  | 'plainText'
  | 'checkbox'
  | 'dropDownList'
  | 'comboBox'
  | 'date'
  | 'picture'
  | 'docPartObj'
  | 'docPartList'
  | 'group'
  | 'citation'
  | 'bibliography'
  | 'equation'
  | 'untyped';

/** The ECMA-376 `CT_SdtPr` type choice, mapped to this vocabulary. */
const TYPE_ELEMENTS: Readonly<Record<string, ContentControlKind>> = {
  richText: 'richText',
  text: 'plainText',
  dropDownList: 'dropDownList',
  comboBox: 'comboBox',
  date: 'date',
  picture: 'picture',
  docPartObj: 'docPartObj',
  docPartList: 'docPartList',
  group: 'group',
  citation: 'citation',
  bibliography: 'bibliography',
  equation: 'equation',
};

/** One declared option of a dropdown or combo box: its display text and its stored value. */
export interface ContentControlListItem {
  readonly displayText: string;
  readonly value: string;
}

/** A date picker's authored format and locale, for rendering and for parsing what it stores. */
export interface ContentControlDateFormat {
  readonly fullDate?: string;
  readonly dateFormat?: string;
  readonly lid?: string;
  readonly storeMappedDataAs?: string;
  readonly calendar?: string;
}

/** One of a checkbox's two glyphs: the font and code point it is drawn with. */
export interface ContentControlCheckboxState {
  /** The `w14:val` hex code point of the glyph, exactly as the control declares it. */
  readonly value: string;
  readonly font?: string;
}

/**
 * A checkbox's state and the two glyphs it chooses between.
 *
 * Both glyphs matter on a write: setting the value has to update `w14:checked` AND the run's
 * character, or the document's glyph and its recorded state disagree.
 */
export interface ContentControlCheckbox {
  readonly checked: boolean;
  readonly checkedState?: ContentControlCheckboxState;
  readonly uncheckedState?: ContentControlCheckboxState;
}

/** `CT_DataBinding` — preserved metadata. Never resolved, never fetched. */
/** `w:dataBinding` — the custom-XML part and XPath a control's value is bound to. */
export interface ContentControlDataBinding {
  readonly xpath?: string;
  readonly storeItemID?: string;
  readonly prefixMappings?: string;
}

/**
 * A control's whole `w:sdtPr`, projected into one typed shape.
 *
 * What every other lane reads instead of walking `localName` strings — which also means a Word
 * re-save that demotes the properties node to generic does not break the projection.
 */
export interface ContentControlProperties {
  readonly type: ContentControlKind;
  readonly alias?: string;
  readonly tag?: string;
  /** `@w:val` of `w:id` when the file declares a parseable one. Never fabricated. */
  readonly id?: number;
  readonly lock: ContentControlLock;
  /** The glossary entry named by `w:placeholder/w:docPart`. Preserved, never loaded. */
  readonly placeholderDocPart?: string;
  readonly temporary: boolean;
  readonly showingPlaceholder: boolean;
  readonly dataBinding?: ContentControlDataBinding;
  readonly label?: string;
  readonly tabIndex?: number;
  /** Items a dropdown or combo box offers. Empty for every other type. */
  readonly listItems: readonly ContentControlListItem[];
  readonly lastValue?: string;
  readonly date?: ContentControlDateFormat;
  readonly multiLine?: boolean;
  readonly checkbox?: ContentControlCheckbox;
}

/** Whether a node is a `w:sdt` wrapper. */
export function isContentControlNode(node: OoxmlNode): node is OoxmlContentControlNode {
  return node.kind === 'contentControl';
}

/** Whether a node is a `w:sdtContent` — the container holding a control's actual content. */
export function isContentControlContentNode(
  node: OoxmlNode
): node is OoxmlContentControlContentNode {
  return node.kind === 'contentControlContent';
}

/**
 * A `w:sdt` wrapper, TYPED or DEMOTED.
 *
 * Flattening predates typing and must not stop at a control the reader refused to type: a
 * demoted wrapper still renders its content in place in Word, so a walk that only saw the
 * typed kind would drop every paragraph inside a malformed control out of the story.
 */
export function isContentControlWrapper(node: OoxmlNode): boolean {
  if (node.kind === 'contentControl') return true;
  return (
    node.kind === 'generic' && node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'sdt'
  );
}

/**
 * The children of a wrapper's `w:sdtContent`, typed or demoted, in order.
 *
 * The one place that knows a control's content is reached through an intermediate element,
 * so the four flattening walks (story blocks, layout, header/footer references, list
 * resolution) ask the same question rather than each re-deriving it.
 */
export function contentControlContentChildren(wrapper: OoxmlNode): readonly OoxmlNode[] {
  if (wrapper.kind === 'textValue') return [];
  const children: OoxmlNode[] = [];
  for (const child of wrapper.children) {
    if (child.kind === 'textValue') continue;
    if (child.kind === 'contentControlContent' || child.localName === 'sdtContent') {
      children.push(...child.children);
    }
  }
  return children;
}

/**
 * A container's children with every content-control wrapper flattened away, bounded in depth.
 *
 * ONE unwrap rule, for the places where a control sits between a container and the children that
 * container is defined in terms of. `CT_SdtRow` puts it between `w:tbl` and `w:tr`, `CT_SdtCell`
 * between `w:tr` and `w:tc`, and a walk that filtered on the child's kind dropped the row or cell
 * entirely: not measured, not painted, not addressable. Flattening at the point of the filter
 * means a controlled row is the same row to the grid pass, the pagination pass and the story walk.
 *
 * Returns the SAME array identity when there is nothing to unwrap, so the tables that carry no
 * controls — nearly all of them — allocate nothing and the incremental layout cache still sees
 * its own inputs.
 */
export function flattenContentControls(
  children: readonly OoxmlNode[],
  maxDepth = MAX_CONTENT_CONTROL_NESTING
): readonly OoxmlNode[] {
  let wrapped = false;
  for (const child of children) {
    if (isContentControlWrapper(child)) {
      wrapped = true;
      break;
    }
  }
  if (!wrapped) return children;
  const flat: OoxmlNode[] = [];
  const collect = (nodes: readonly OoxmlNode[], depth: number): void => {
    for (const node of nodes) {
      if (!isContentControlWrapper(node)) {
        flat.push(node);
        continue;
      }
      // Past the bound the wrapper is kept as itself rather than dropped: the caller's own
      // kind filter then skips it, which is the same answer every other bounded walk gives.
      if (depth >= maxDepth) {
        flat.push(node);
        continue;
      }
      collect(contentControlContentChildren(node), depth + 1);
    }
  };
  collect(children, 0);
  return flat;
}

/** A control's `w:sdtPr`, or null. Matches structurally, so a Word-demoted node still resolves. */
export function contentControlPropertiesNodeOf(
  control: OoxmlNode
): OoxmlContentControlPropertiesNode | undefined {
  if (control.kind !== 'contentControl') return undefined;
  return control.children.find(
    (child): child is OoxmlContentControlPropertiesNode => child.kind === 'contentControlProperties'
  );
}

/**
 * The control's `w:sdtPr`, typed OR demoted.
 *
 * `CT_SdtPr` is a sequence, so properties written out of schema order demote the container
 * to `generic` (`validContentControlPropertiesChildren`) and the misplaced order round-trips
 * as authored. Demotion says the ORDER is not modelled; it does not say the properties are
 * absent. A read that saw only the typed kind would answer `unlocked` and unbound for a
 * control whose file declares `w:lock`/`w:dataBinding` a position too late — an authored
 * protection dropped over placement, which is the fail-OPEN direction. The op lane already
 * accepts either shape (`isContentControlPropertiesNode`); this keeps the projection saying
 * the same thing about the same document.
 */
export function contentControlPropertiesContainerOf(control: OoxmlNode): OoxmlElement | undefined {
  if (control.kind !== 'contentControl') return undefined;
  const children: readonly OoxmlNode[] = control.children;
  return children.find(
    (child): child is OoxmlElement =>
      child.kind === 'contentControlProperties' ||
      (child.kind === 'generic' &&
        child.localName === 'sdtPr' &&
        child.namespaceUri === WML_NAMESPACE_URI)
  );
}

/** A control's `w:sdtEndPr` — the run properties applied to its closing marker. */
export function contentControlEndPropertiesNodeOf(
  control: OoxmlNode
): OoxmlContentControlEndPropertiesNode | undefined {
  if (control.kind !== 'contentControl') return undefined;
  return control.children.find(
    (child): child is OoxmlContentControlEndPropertiesNode =>
      child.kind === 'contentControlEndProperties'
  );
}

/** A control's `w:sdtContent`, or null when the wrapper has none. */
export function contentControlContentNodeOf(
  control: OoxmlNode
): OoxmlContentControlContentNode | undefined {
  if (control.kind !== 'contentControl') return undefined;
  return control.children.find(
    (child): child is OoxmlContentControlContentNode => child.kind === 'contentControlContent'
  );
}

function attributeValue(
  node: OoxmlNode,
  localName: string,
  namespaceUri: string
): string | undefined {
  if (node.kind === 'textValue') return undefined;
  for (const attribute of node.attributes) {
    if (attribute.localName !== localName) continue;
    if (attribute.namespaceUri === namespaceUri || attribute.namespaceUri === '') {
      return attribute.value;
    }
  }
  return undefined;
}

function wmlAttribute(node: OoxmlNode, localName: string): string | undefined {
  return attributeValue(node, localName, WML_NAMESPACE_URI);
}

function w14Attribute(node: OoxmlNode, localName: string): string | undefined {
  return attributeValue(node, localName, W14_NAMESPACE_URI);
}

function namedChildren(
  parent: OoxmlNode | undefined,
  namespaceUri: string,
  localName: string
): readonly OoxmlElement[] {
  if (!parent || parent.kind === 'textValue') return [];
  const found: OoxmlElement[] = [];
  for (const child of parent.children as readonly OoxmlNode[]) {
    if (child.kind === 'textValue') continue;
    if (child.namespaceUri === namespaceUri && child.localName === localName) found.push(child);
  }
  return found;
}

function namedChild(
  parent: OoxmlNode | undefined,
  namespaceUri: string,
  localName: string
): OoxmlElement | undefined {
  return namedChildren(parent, namespaceUri, localName)[0];
}

/** OOXML on/off toggle read off an element's `@w:val` — present is on unless disabled. */
function onOff(element: OoxmlElement | undefined): boolean {
  if (!element) return false;
  const value = wmlAttribute(element, 'val');
  return value === undefined || !(value === '0' || value === 'false' || value === 'off');
}

function w14OnOff(element: OoxmlElement | undefined): boolean {
  if (!element) return false;
  const value = w14Attribute(element, 'val');
  return value === undefined || !(value === '0' || value === 'false' || value === 'off');
}

/** A signed 32-bit `ST_DecimalNumber`, or undefined when the file wrote something else. */
export function parseContentControlId(raw: string | undefined): number | undefined {
  if (raw === undefined || !/^-?\d{1,10}$/.test(raw)) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < -0x80000000 || value > CONTENT_CONTROL_ID_MAX) {
    return undefined;
  }
  return value;
}

function checkboxStateOf(
  parent: OoxmlElement,
  localName: string
): ContentControlCheckboxState | undefined {
  const element = namedChild(parent, W14_NAMESPACE_URI, localName);
  if (!element) return undefined;
  const value = w14Attribute(element, 'val');
  if (value === undefined) return undefined;
  const font = w14Attribute(element, 'font');
  return font === undefined ? { value } : { value, font };
}

function listItemsOf(typeElement: OoxmlElement): readonly ContentControlListItem[] {
  const items: ContentControlListItem[] = [];
  for (const child of namedChildren(typeElement, WML_NAMESPACE_URI, 'listItem')) {
    const value = wmlAttribute(child, 'value') ?? '';
    const displayText = wmlAttribute(child, 'displayText') ?? value;
    items.push({ displayText, value });
  }
  return items;
}

function dateOf(typeElement: OoxmlElement): ContentControlDateFormat {
  const read = (localName: string): string | undefined => {
    const element = namedChild(typeElement, WML_NAMESPACE_URI, localName);
    return element ? wmlAttribute(element, 'val') : undefined;
  };
  const fullDate = wmlAttribute(typeElement, 'fullDate');
  const dateFormat = read('dateFormat');
  const lid = read('lid');
  const storeMappedDataAs = read('storeMappedDataAs');
  const calendar = read('calendar');
  return {
    ...(fullDate === undefined ? {} : { fullDate }),
    ...(dateFormat === undefined ? {} : { dateFormat }),
    ...(lid === undefined ? {} : { lid }),
    ...(storeMappedDataAs === undefined ? {} : { storeMappedDataAs }),
    ...(calendar === undefined ? {} : { calendar }),
  };
}

/**
 * Read a control's properties.
 *
 * Total: a control with no `w:sdtPr` at all answers the same shape with the defaults an
 * absent property means, so no caller has to branch on the container's existence.
 */
export function contentControlPropertiesOf(control: OoxmlNode): ContentControlProperties {
  const sdtPr = contentControlPropertiesContainerOf(control);
  const alias = wmlAttribute(namedChild(sdtPr, WML_NAMESPACE_URI, 'alias') ?? EMPTY, 'val');
  const tag = wmlAttribute(namedChild(sdtPr, WML_NAMESPACE_URI, 'tag') ?? EMPTY, 'val');
  const id = parseContentControlId(
    wmlAttribute(namedChild(sdtPr, WML_NAMESPACE_URI, 'id') ?? EMPTY, 'val')
  );
  const lockValue = wmlAttribute(namedChild(sdtPr, WML_NAMESPACE_URI, 'lock') ?? EMPTY, 'val');
  const lock: ContentControlLock =
    lockValue !== undefined && LOCK_VALUES.has(lockValue)
      ? (lockValue as ContentControlLock)
      : 'unlocked';
  const placeholder = namedChild(sdtPr, WML_NAMESPACE_URI, 'placeholder');
  const placeholderDocPart = placeholder
    ? wmlAttribute(namedChild(placeholder, WML_NAMESPACE_URI, 'docPart') ?? EMPTY, 'val')
    : undefined;
  const bindingElement = namedChild(sdtPr, WML_NAMESPACE_URI, 'dataBinding');
  const xpath = bindingElement ? wmlAttribute(bindingElement, 'xpath') : undefined;
  const storeItemID = bindingElement ? wmlAttribute(bindingElement, 'storeItemID') : undefined;
  const prefixMappings = bindingElement
    ? wmlAttribute(bindingElement, 'prefixMappings')
    : undefined;
  const label = wmlAttribute(namedChild(sdtPr, WML_NAMESPACE_URI, 'label') ?? EMPTY, 'val');
  const tabIndexRaw = wmlAttribute(
    namedChild(sdtPr, WML_NAMESPACE_URI, 'tabIndex') ?? EMPTY,
    'val'
  );
  const tabIndex =
    tabIndexRaw !== undefined && /^\d{1,10}$/.test(tabIndexRaw) ? Number(tabIndexRaw) : undefined;

  let type: ContentControlKind = 'untyped';
  let typeElement: OoxmlElement | undefined;
  if (sdtPr) {
    for (const child of sdtPr.children as readonly OoxmlNode[]) {
      if (child.kind === 'textValue' || child.namespaceUri !== WML_NAMESPACE_URI) continue;
      const candidate = TYPE_ELEMENTS[child.localName];
      if (candidate === undefined) continue;
      type = candidate;
      typeElement = child;
      break;
    }
  }
  // The Microsoft extension is read BEFORE a control is called untyped: it lives outside
  // `CT_SdtPr`'s type choice, so "declares no ECMA-376 type" and "is a checkbox" are not
  // mutually exclusive — four controls in the comprehensive fixture are exactly that.
  const checkboxElement = namedChild(sdtPr, W14_NAMESPACE_URI, 'checkbox');
  let checkbox: ContentControlCheckbox | undefined;
  if (checkboxElement) {
    const checkedState = checkboxStateOf(checkboxElement, 'checkedState');
    const uncheckedState = checkboxStateOf(checkboxElement, 'uncheckedState');
    checkbox = {
      checked: w14OnOff(namedChild(checkboxElement, W14_NAMESPACE_URI, 'checked')),
      ...(checkedState === undefined ? {} : { checkedState }),
      ...(uncheckedState === undefined ? {} : { uncheckedState }),
    };
    if (type === 'untyped') type = 'checkbox';
  }

  const listItems =
    typeElement && (type === 'dropDownList' || type === 'comboBox') ? listItemsOf(typeElement) : [];
  const lastValue =
    typeElement && (type === 'dropDownList' || type === 'comboBox')
      ? wmlAttribute(typeElement, 'lastValue')
      : undefined;
  const date = typeElement && type === 'date' ? dateOf(typeElement) : undefined;
  const multiLine =
    typeElement && type === 'plainText' ? onOffAttribute(typeElement, 'multiLine') : undefined;

  return {
    type,
    ...(alias === undefined ? {} : { alias }),
    ...(tag === undefined ? {} : { tag }),
    ...(id === undefined ? {} : { id }),
    lock,
    ...(placeholderDocPart === undefined ? {} : { placeholderDocPart }),
    temporary: onOff(namedChild(sdtPr, WML_NAMESPACE_URI, 'temporary')),
    showingPlaceholder: onOff(namedChild(sdtPr, WML_NAMESPACE_URI, 'showingPlcHdr')),
    ...(bindingElement === undefined
      ? {}
      : {
          dataBinding: {
            ...(xpath === undefined ? {} : { xpath }),
            ...(storeItemID === undefined ? {} : { storeItemID }),
            ...(prefixMappings === undefined ? {} : { prefixMappings }),
          },
        }),
    ...(label === undefined ? {} : { label }),
    ...(tabIndex === undefined ? {} : { tabIndex }),
    listItems,
    ...(lastValue === undefined ? {} : { lastValue }),
    ...(date === undefined ? {} : { date }),
    ...(multiLine === undefined ? {} : { multiLine }),
    ...(checkbox === undefined ? {} : { checkbox }),
  };
}

/** A stand-in for "no such element", so every read above stays one expression. */
const EMPTY: OoxmlElement = Object.freeze({
  id: '',
  kind: 'generic',
  namespaceUri: '',
  localName: '',
  namespaceBindings: Object.freeze([]),
  attributes: Object.freeze([]),
  children: Object.freeze([]),
}) as OoxmlElement;

function onOffAttribute(element: OoxmlElement, localName: string): boolean | undefined {
  const raw = wmlAttribute(element, localName);
  if (raw === undefined) return undefined;
  return !(raw === '0' || raw === 'false' || raw === 'off');
}

/** Where a control sits, read off what its content holds. */
export type ContentControlLevel = 'block' | 'inline' | 'row' | 'cell' | 'empty';

/**
 * How deeply a control is nested inside other controls.
 *
 * Bounded by {@link MAX_CONTENT_CONTROL_NESTING}: nesting depth comes from a file and is a
 * recursion bound.
 */
export function contentControlLevelOf(control: OoxmlNode): ContentControlLevel {
  const content = contentControlContentNodeOf(control);
  if (!content) return 'empty';
  let sawInline = false;
  for (const child of content.children) {
    if (child.kind === 'textValue') continue;
    if (child.kind === 'tableRow') return 'row';
    if (child.kind === 'tableCell') return 'cell';
    if (child.kind === 'paragraph' || child.kind === 'table') return 'block';
    if (child.kind === 'contentControl') {
      const nested = contentControlLevelOf(child);
      if (nested !== 'empty') return nested;
      continue;
    }
    if (child.kind === 'run' || child.kind === 'fldSimple' || isInlineRunContainer(child)) {
      sawInline = true;
      continue;
    }
    // A generic child (a drawing, an `mc:AlternateContent`) says nothing about the level
    // by itself; the level comes from the typed content beside it, if any.
  }
  if (sawInline) return 'inline';
  // A `w:sdt` whose content holds only generic children is a control the reader could not
  // classify; treating it as block keeps it flattening the way it did while generic.
  return content.children.length === 0 ? 'empty' : 'block';
}

/** One control, plus how deeply it is nested and the controls that enclose it. */
export interface ContentControlEntry {
  readonly node: OoxmlContentControlNode;
  /** 0 for a top-level control; the nesting depth otherwise. */
  readonly depth: number;
  /** Enclosing controls, outermost first. Empty at depth 0. */
  readonly ancestors: readonly OoxmlContentControlNode[];
}

const defaultContentControlsInCache = new WeakMap<OoxmlNode, readonly ContentControlEntry[]>();

function collectContentControlsIn(
  root: OoxmlNode,
  maxDepth: number,
  limit: number,
  composeFromSubtrees = false
): ContentControlEntry[] {
  const entries: ContentControlEntry[] = [];
  const walk = (node: OoxmlNode, depth: number, ancestors: OoxmlContentControlNode[]): void => {
    if (node.kind === 'textValue' || entries.length >= limit) return;
    for (const child of node.children) {
      if (entries.length >= limit) return;
      if (child.kind === 'contentControl') {
        if (depth >= maxDepth) continue;
        entries.push({ node: child, depth, ancestors: [...ancestors] });
        walk(child, depth + 1, [...ancestors, child]);
        continue;
      }
      // OUTSIDE any control, a paragraph's or table's entries are a pure function of that
      // subtree — same depths, same ancestor lists — so an unchanged block hands back its
      // memoized answer through the per-root cache below instead of being re-descended.
      // Every transaction gate otherwise re-walked the whole document per keystroke.
      // Only for the default bounds, which is what the memoized entry point uses; inside a
      // control the depths and ancestors differ, so composition stops applying there.
      if (
        composeFromSubtrees &&
        depth === 0 &&
        (child.kind === 'paragraph' ||
          child.kind === 'table' ||
          child.kind === 'tableRow' ||
          child.kind === 'tableCell')
      ) {
        for (const entry of contentControlsIn(child)) {
          if (entries.length >= limit) return;
          entries.push(entry);
        }
        continue;
      }
      walk(child, depth, ancestors);
    }
  };
  walk(root, 0, []);
  return entries;
}

function freezeContentControlEntries(
  entries: readonly ContentControlEntry[]
): readonly ContentControlEntry[] {
  for (const entry of entries) {
    Object.freeze(entry.ancestors);
    Object.freeze(entry);
  }
  return Object.freeze(entries);
}

/**
 * Hand `previous`'s answer to `next`, a rebuild of it that changed only run properties, when
 * `previous` holds no control.
 *
 * A `w:rPr` cannot hold a control, so a node with none still has none. A node WITH controls is
 * not carried: the rebuild replaces every control on the path to an edited run, and the entries
 * would name the old nodes.
 * @internal
 */
export function carryEmptyContentControlsAcrossRunPropertyEdit(
  previous: OoxmlNode,
  next: OoxmlNode
): void {
  const cached = defaultContentControlsInCache.get(previous);
  if (cached?.length === 0 && !defaultContentControlsInCache.has(next)) {
    defaultContentControlsInCache.set(next, cached);
  }
}

let controlScans: { count: number } | null = null;

/** @internal Counts whole-subtree control scans while `run` executes, for scaling tests. */
export function countContentControlScansForTest(run: () => void): number {
  const observer = { count: 0 };
  controlScans = observer;
  try {
    run();
  } finally {
    controlScans = null;
  }
  return observer.count;
}

/**
 * Every control under a node, in document order, bounded in depth and in count.
 *
 * ONE walk, shared. The nesting bound is the same one layout flattens with, so a control
 * a lane can address is a control every lane can address — and a file that nests past it
 * keeps its content in the tree (the serializer never stops) while no walk recurses
 * further.
 */
export function contentControlsIn(
  root: OoxmlNode,
  options?: { readonly maxDepth?: number; readonly limit?: number }
): readonly ContentControlEntry[] {
  if (options === undefined) {
    const cached = defaultContentControlsInCache.get(root);
    if (cached !== undefined) return cached;
    if (controlScans) controlScans.count += 1;
    const entries = freezeContentControlEntries(
      collectContentControlsIn(
        root,
        MAX_CONTENT_CONTROL_NESTING,
        MAX_CONTENT_CONTROLS_PER_PART,
        true
      )
    );
    defaultContentControlsInCache.set(root, entries);
    return entries;
  }
  return collectContentControlsIn(
    root,
    options.maxDepth ?? MAX_CONTENT_CONTROL_NESTING,
    options.limit ?? MAX_CONTENT_CONTROLS_PER_PART
  );
}

/** Find one control by canonical node id, with the same bounded walk. */
export function findContentControl(root: OoxmlNode, nodeId: string): ContentControlEntry | null {
  for (const entry of contentControlsIn(root)) {
    if (entry.node.id === nodeId) return entry;
  }
  return null;
}

/**
 * The plain text a control's content holds, in reading order.
 *
 * `w:delText` is excluded: struck text is not the control's value, and a dropdown whose
 * old item is still present as a tracked deletion would otherwise report both.
 *
 * A manual line break is left out unless `lineBreak` names the text to report it as.
 * With that option, column breaks report U+000E so callers cannot silently discard them.
 */
export function contentControlTextOf(control: OoxmlNode, lineBreak?: string): string {
  const content = contentControlContentNodeOf(control);
  if (!content) return '';
  let text = '';
  let visited = 0;
  const walk = (node: OoxmlNode, depth: number): void => {
    if (visited > MAX_TEXT_NODES || depth > MAX_CONTENT_CONTROL_NESTING * 4) return;
    visited += 1;
    if (node.kind === 'textValue') {
      text += node.value;
      return;
    }
    if (node.kind === 'deletedText' || node.kind === 'instrText') return;
    if (node.kind === 'tab') {
      text += '\t';
      return;
    }
    if (lineBreak !== undefined) {
      // Struck content is not the value; `w:delText` above already says so for text.
      if (node.kind === 'revisionDelete' || node.kind === 'revisionMoveFrom') return;
      if (node.kind === 'hardBreak') {
        const kind = hardBreakKind(node);
        if (kind === 'line') text += lineBreak;
        else if (kind === 'column') text += '\u000e';
        return;
      }
    }
    const hyphen = inlineCharacterTextOf(node);
    if (hyphen !== null) {
      text += hyphen;
      return;
    }
    for (const child of node.children) walk(child, depth + 1);
  };
  for (const child of content.children) walk(child, 0);
  return text;
}

const MAX_TEXT_NODES = 100_000;

/**
 * Resolve the lock a position inherits from the controls enclosing it.
 *
 * CONSERVATIVE, because a template that says a field cannot be edited and sits inside a
 * section that says it cannot be removed means both. Each half of `ST_Lock` is taken
 * independently and the strongest wins, so an unlocked control inside a `contentLocked`
 * one is still content-locked — a nested control cannot grant a permission its parent
 * withheld, which is the only reading under which a lock is a lock.
 */
export function resolveContentControlLock(
  chain: readonly ContentControlLock[]
): ContentControlLock {
  let noRemove = false;
  let noEdit = false;
  for (const lock of chain) {
    if (lock === 'sdtLocked' || lock === 'sdtContentLocked') noRemove = true;
    if (lock === 'contentLocked' || lock === 'sdtContentLocked') noEdit = true;
  }
  if (noRemove && noEdit) return 'sdtContentLocked';
  if (noRemove) return 'sdtLocked';
  if (noEdit) return 'contentLocked';
  return 'unlocked';
}

/** Whether a resolved lock forbids editing the content it covers. */
export function lockForbidsEdit(lock: ContentControlLock): boolean {
  return lock === 'contentLocked' || lock === 'sdtContentLocked';
}

/** Whether a resolved lock forbids removing the control itself. */
export function lockForbidsRemoval(lock: ContentControlLock): boolean {
  return lock === 'sdtLocked' || lock === 'sdtContentLocked';
}

/**
 * `CT_SdtPr`'s declared child order (§17.5.2.38), followed by the type choice.
 *
 * Serialization re-emits children in tree order, so the ONLY way a write keeps the
 * sequence valid is to place the child it authors at its schema position — which is what
 * {@link orderedContentControlProperties} does.
 */
export const CONTENT_CONTROL_PROPERTY_ORDER: readonly string[] = [
  'rPr',
  'alias',
  'tag',
  'id',
  'lock',
  'placeholder',
  'temporary',
  'showingPlcHdr',
  'dataBinding',
  'label',
  'tabIndex',
];

const TYPE_ELEMENT_NAMES: ReadonlySet<string> = new Set(Object.keys(TYPE_ELEMENTS));

/**
 * Rebuild a `w:sdtPr`'s children in schema order.
 *
 * Modelled children sort to their declared position and the type element follows them,
 * as the sequence requires. Everything else — a `w15:repeatingSection`, a vendor
 * extension, the `w14:checkbox` that is not part of the ECMA-376 choice — keeps the order
 * it was authored in and follows the modelled block, so a write that touches one property
 * neither drops nor reorders anything it does not name.
 */
export function orderedContentControlProperties(
  children: readonly OoxmlNode[]
): readonly OoxmlNode[] {
  const rank = (node: OoxmlNode): number => {
    if (node.kind === 'textValue') return CONTENT_CONTROL_PROPERTY_ORDER.length + 2;
    if (node.namespaceUri !== WML_NAMESPACE_URI) return CONTENT_CONTROL_PROPERTY_ORDER.length + 2;
    const index = CONTENT_CONTROL_PROPERTY_ORDER.indexOf(node.localName);
    if (index >= 0) return index;
    if (TYPE_ELEMENT_NAMES.has(node.localName)) return CONTENT_CONTROL_PROPERTY_ORDER.length;
    return CONTENT_CONTROL_PROPERTY_ORDER.length + 2;
  };
  // A STABLE sort by rank: equal-ranked children (two vendor extensions, the checkbox and
  // a `w15:*` sibling) keep their authored order relative to one another.
  return [...children]
    .map((node, index) => ({ node, index, rank: rank(node) }))
    .sort((left, right) =>
      left.rank !== right.rank ? left.rank - right.rank : left.index - right.index
    )
    .map((entry) => entry.node);
}

/**
 * Occupied non-negative `w:id` values a striped mint must skip.
 *
 * Hostile or out-of-range values never reach here — {@link parseContentControlId} dropped
 * them. Negatives are valid signed 32-bit ids but are ignored for seeding, the same way
 * the solo walk starts `max` at zero and only counts `id > max`.
 */
function usedContentControlIds(root: OoxmlNode): Set<string> {
  const used = new Set<string>();
  for (const entry of contentControlsIn(root)) {
    const id = contentControlPropertiesOf(entry.node).id;
    if (id === undefined || id < 0) continue;
    used.add(String(id));
  }
  return used;
}

/**
 * The next `w:id` to write.
 *
 * Solo: one past the document's own maximum. Never a clock, a timestamp, a random source
 * or a hash: those collide with ids already in the file and produce values Word rejects.
 * Null when the document already reaches the signed 32-bit bound, so the caller refuses
 * rather than wrapping into a negative id. Hostile or out-of-range existing values are
 * ignored for seeding rather than counted past.
 *
 * When a collaboration actor is bound (explicit argument or the open store transaction),
 * the next id is the next unused value in that actor's stripe. Two peers inserting a
 * generic content control — including a custom node authored as `w:sdt` — from the same
 * snapshot then cannot share a `w:id`.
 */
export function allocateContentControlId(root: OoxmlNode, actorId?: string): number | null {
  const actor = resolveAllocationActor(actorId);
  if (actor) {
    try {
      return Number(
        nextStripedDecimalId(usedContentControlIds(root), actor, CONTENT_CONTROL_ID_MAX)
      );
    } catch {
      return null;
    }
  }
  let max = 0;
  for (const entry of contentControlsIn(root)) {
    const id = contentControlPropertiesOf(entry.node).id;
    if (id !== undefined && id > max) max = id;
  }
  if (max >= CONTENT_CONTROL_ID_MAX) return null;
  return max + 1;
}
