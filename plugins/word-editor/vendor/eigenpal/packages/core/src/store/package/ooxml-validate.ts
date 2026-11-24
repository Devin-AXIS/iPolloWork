// OOXML part invariant validation.
//
// This module owns the full invariant walk over a canonical part and its delta-pruned
// variant for structurally shared edits. The rules it applies mirror what the ooxml-tree
// read path establishes at construction; importers keep reaching `validateOoxmlPart` and
// `validateOoxmlPartDelta` through that module's re-exports.

import { isXmlNCName } from './qname.ts';
import { isValidXmlText } from './sinks.ts';
import {
  W14_NAMESPACE_URI,
  WML_NAMESPACE_URI,
  XML_NAMESPACE_URI,
  XMLNS_NAMESPACE_URI,
  DRAWINGML_MAIN_NAMESPACE_URI,
  WP_NAMESPACE_URI,
  PIC_NAMESPACE_URI,
  expandedKey,
  knownKindAllowsWmlVal,
  validKnownKind,
  validateQNameAttributeValues,
  type KnownKind,
} from './ooxml-shared.ts';
import {
  isDrawingKnownKind,
  validateDrawingNode,
  type DrawingParentContext,
} from './ooxml-drawing-rules.ts';
import type {
  OoxmlAttribute,
  OoxmlElement,
  OoxmlInvariantIssue,
  OoxmlInvariantIssueCode,
  OoxmlInvariantResult,
  OoxmlNode,
  OoxmlPart,
} from './ooxml-tree.ts';

const KNOWN_ELEMENT_NAMES: Readonly<
  Record<KnownKind, readonly [namespaceUri: string, localName: string]>
> = {
  document: [WML_NAMESPACE_URI, 'document'],
  body: [WML_NAMESPACE_URI, 'body'],
  paragraph: [WML_NAMESPACE_URI, 'p'],
  run: [WML_NAMESPACE_URI, 'r'],
  runProperties: [WML_NAMESPACE_URI, 'rPr'],
  text: [WML_NAMESPACE_URI, 't'],
  paragraphProperties: [WML_NAMESPACE_URI, 'pPr'],
  tab: [WML_NAMESPACE_URI, 'tab'],
  hardBreak: [WML_NAMESPACE_URI, 'br'],
  fldChar: [WML_NAMESPACE_URI, 'fldChar'],
  instrText: [WML_NAMESPACE_URI, 'instrText'],
  fldSimple: [WML_NAMESPACE_URI, 'fldSimple'],
  footnotes: [WML_NAMESPACE_URI, 'footnotes'],
  endnotes: [WML_NAMESPACE_URI, 'endnotes'],
  // Note localName is `footnote` | `endnote`; validate accepts either.
  note: [WML_NAMESPACE_URI, 'footnote'],
  noteReference: [WML_NAMESPACE_URI, 'footnoteReference'],
  noteRef: [WML_NAMESPACE_URI, 'footnoteRef'],
  separator: [WML_NAMESPACE_URI, 'separator'],
  continuationSeparator: [WML_NAMESPACE_URI, 'continuationSeparator'],
  table: [WML_NAMESPACE_URI, 'tbl'],
  tableRow: [WML_NAMESPACE_URI, 'tr'],
  tableCell: [WML_NAMESPACE_URI, 'tc'],
  tableGrid: [WML_NAMESPACE_URI, 'tblGrid'],
  tableProperties: [WML_NAMESPACE_URI, 'tblPr'],
  hyperlink: [WML_NAMESPACE_URI, 'hyperlink'],
  bookmarkStart: [WML_NAMESPACE_URI, 'bookmarkStart'],
  bookmarkEnd: [WML_NAMESPACE_URI, 'bookmarkEnd'],
  deletedText: [WML_NAMESPACE_URI, 'delText'],
  revisionInsert: [WML_NAMESPACE_URI, 'ins'],
  revisionDelete: [WML_NAMESPACE_URI, 'del'],
  revisionMoveFrom: [WML_NAMESPACE_URI, 'moveFrom'],
  revisionMoveTo: [WML_NAMESPACE_URI, 'moveTo'],
  moveFromRangeStart: [WML_NAMESPACE_URI, 'moveFromRangeStart'],
  moveFromRangeEnd: [WML_NAMESPACE_URI, 'moveFromRangeEnd'],
  moveToRangeStart: [WML_NAMESPACE_URI, 'moveToRangeStart'],
  moveToRangeEnd: [WML_NAMESPACE_URI, 'moveToRangeEnd'],
  commentRangeStart: [WML_NAMESPACE_URI, 'commentRangeStart'],
  commentRangeEnd: [WML_NAMESPACE_URI, 'commentRangeEnd'],
  commentReference: [WML_NAMESPACE_URI, 'commentReference'],
  comments: [WML_NAMESPACE_URI, 'comments'],
  comment: [WML_NAMESPACE_URI, 'comment'],
  contentControl: [WML_NAMESPACE_URI, 'sdt'],
  contentControlProperties: [WML_NAMESPACE_URI, 'sdtPr'],
  contentControlEndProperties: [WML_NAMESPACE_URI, 'sdtEndPr'],
  contentControlContent: [WML_NAMESPACE_URI, 'sdtContent'],
  contentControlDropDownList: [WML_NAMESPACE_URI, 'dropDownList'],
  contentControlComboBox: [WML_NAMESPACE_URI, 'comboBox'],
  contentControlListItem: [WML_NAMESPACE_URI, 'listItem'],
  contentControlDate: [WML_NAMESPACE_URI, 'date'],
  contentControlDateFormat: [WML_NAMESPACE_URI, 'dateFormat'],
  contentControlLid: [WML_NAMESPACE_URI, 'lid'],
  contentControlStoreMappedDataAs: [WML_NAMESPACE_URI, 'storeMappedDataAs'],
  contentControlCalendar: [WML_NAMESPACE_URI, 'calendar'],
  contentControlText: [WML_NAMESPACE_URI, 'text'],
  contentControlDataBinding: [WML_NAMESPACE_URI, 'dataBinding'],
  contentControlCheckbox: [W14_NAMESPACE_URI, 'checkbox'],
  contentControlChecked: [W14_NAMESPACE_URI, 'checked'],
  contentControlCheckedState: [W14_NAMESPACE_URI, 'checkedState'],
  contentControlUncheckedState: [W14_NAMESPACE_URI, 'uncheckedState'],
  drawing: [WML_NAMESPACE_URI, 'drawing'],
  inlineDrawing: [WP_NAMESPACE_URI, 'inline'],
  anchoredDrawing: [WP_NAMESPACE_URI, 'anchor'],
  drawingExtent: [WP_NAMESPACE_URI, 'extent'],
  drawingEffectExtent: [WP_NAMESPACE_URI, 'effectExtent'],
  drawingDocPr: [WP_NAMESPACE_URI, 'docPr'],
  drawingGraphicFramePr: [WP_NAMESPACE_URI, 'cNvGraphicFramePr'],
  drawingGraphic: [DRAWINGML_MAIN_NAMESPACE_URI, 'graphic'],
  drawingGraphicData: [DRAWINGML_MAIN_NAMESPACE_URI, 'graphicData'],
  drawingSimplePos: [WP_NAMESPACE_URI, 'simplePos'],
  drawingPositionH: [WP_NAMESPACE_URI, 'positionH'],
  drawingPositionV: [WP_NAMESPACE_URI, 'positionV'],
  drawingPositionAlign: [WP_NAMESPACE_URI, 'align'],
  drawingPositionOffset: [WP_NAMESPACE_URI, 'posOffset'],
  drawingWrapNone: [WP_NAMESPACE_URI, 'wrapNone'],
  drawingWrapSquare: [WP_NAMESPACE_URI, 'wrapSquare'],
  drawingWrapTight: [WP_NAMESPACE_URI, 'wrapTight'],
  drawingWrapThrough: [WP_NAMESPACE_URI, 'wrapThrough'],
  drawingWrapTopBottom: [WP_NAMESPACE_URI, 'wrapTopAndBottom'],
  drawingWrapPolygon: [WP_NAMESPACE_URI, 'wrapPolygon'],
  drawingWrapPolygonStart: [WP_NAMESPACE_URI, 'start'],
  drawingWrapPolygonLineTo: [WP_NAMESPACE_URI, 'lineTo'],
  picture: [PIC_NAMESPACE_URI, 'pic'],
  pictureNvPicPr: [PIC_NAMESPACE_URI, 'nvPicPr'],
  pictureBlipFill: [PIC_NAMESPACE_URI, 'blipFill'],
  pictureBlip: [DRAWINGML_MAIN_NAMESPACE_URI, 'blip'],
  pictureSrcRect: [DRAWINGML_MAIN_NAMESPACE_URI, 'srcRect'],
  pictureStretch: [DRAWINGML_MAIN_NAMESPACE_URI, 'stretch'],
  pictureTile: [DRAWINGML_MAIN_NAMESPACE_URI, 'tile'],
  pictureShapeProperties: [PIC_NAMESPACE_URI, 'spPr'],
  pictureTransform: [DRAWINGML_MAIN_NAMESPACE_URI, 'xfrm'],
  pictureTransformOffset: [DRAWINGML_MAIN_NAMESPACE_URI, 'off'],
  pictureTransformExtent: [DRAWINGML_MAIN_NAMESPACE_URI, 'ext'],
  picturePresetGeometry: [DRAWINGML_MAIN_NAMESPACE_URI, 'prstGeom'],
};

function knownAttributesAreValid(kind: KnownKind, attributes: readonly OoxmlAttribute[]): boolean {
  return attributes.every((attribute) => {
    if (attribute.kind === 'wmlVal') return knownKindAllowsWmlVal(kind);
    if (attribute.kind === 'xmlSpace')
      return (
        attribute.namespaceUri === XML_NAMESPACE_URI &&
        attribute.localName === 'space' &&
        attribute.prefix === 'xml' &&
        (attribute.value === 'default' || attribute.value === 'preserve')
      );
    return !(
      (attribute.namespaceUri === XML_NAMESPACE_URI && attribute.localName === 'space') ||
      (attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === 'val')
    );
  });
}

/**
 * Validate a parser-created or copy-modified immutable part before publication.
 * Future tree-edit primitives can retain shared nodes and their IDs, while any
 * replacement chooses explicitly whether to retain or allocate identity.
 */
export function validateOoxmlPart(part: OoxmlPart): OoxmlInvariantResult {
  return runValidation(part, null);
}

/**
 * Validate only what an edit could have changed, against a previously validated tree.
 *
 * Structural sharing makes an edited tree mostly object-identical to its predecessor. A
 * subtree that is the SAME OBJECT, reached under the SAME inherited namespace context, was
 * already proven valid when `previous` was — re-walking it proves nothing, and re-walking
 * the whole document per commit made validation the single largest cost of a keystroke on
 * a long document. Context equality is tracked by binding-array identity down the rebuilt
 * spine, so a node that alters its namespace declarations forfeits pruning for its whole
 * subtree.
 *
 * Two deliberate narrowings against the full walk, both bounded elsewhere:
 * DUPLICATE IDS across a changed and an unchanged subtree are not observed here — id
 * uniqueness for edits rests on the allocator, which mints against the whole part, and
 * `previous` itself was validated in full. NOTHING else is narrowed: every visited node
 * runs the identical rules.
 */
export function validateOoxmlPartDelta(previous: OoxmlPart, part: OoxmlPart): OoxmlInvariantResult {
  return runValidation(part, previous);
}

function runValidation(part: OoxmlPart, previous: OoxmlPart | null): OoxmlInvariantResult {
  const issues: OoxmlInvariantIssue[] = [];
  const ids = new Set<string>();
  // The child-index trail of the node currently being visited. Issue paths are derived from
  // it ON REPORT — building a `root.children[i]…` string for every node visited made path
  // assembly a measurable cost of validating a long, overwhelmingly valid part.
  const indexTrail: number[] = [];
  const pathHere = (): string => {
    let path = 'root';
    for (const index of indexTrail) path += `.children[${index}]`;
    return path;
  };
  const report = (code: OoxmlInvariantIssueCode, nodeId?: string): void => {
    issues.push({ code, path: pathHere(), ...(nodeId === undefined ? {} : { nodeId }) });
  };
  const walk = (
    node: OoxmlNode,
    inheritedBindings: ReadonlyMap<string, string>,
    priorNode: OoxmlNode | undefined,
    priorContext: boolean,
    parent?: DrawingParentContext
  ): void => {
    // The prune: this very object was validated as part of `previous`, under an inherited
    // context proven identical — nothing in the subtree can have changed.
    if (priorContext && priorNode === node) return;

    if (typeof node.id !== 'string' || node.id.length === 0) report('invalid-id', node.id);
    else if (ids.has(node.id)) report('duplicate-id', node.id);
    else ids.add(node.id);

    if (node.kind === 'textValue') {
      if (!isValidXmlText(node.value)) report('invalid-xml-value', node.id);
      return;
    }

    // Copy-on-write: most nodes declare no namespaces, and copying the inherited map per
    // node made this walk the dominant cost of validating a long part.
    let bindings: ReadonlyMap<string, string> = inheritedBindings;
    if (node.namespaceBindings.length > 0) {
      const own = new Map(inheritedBindings);
      const localPrefixes = new Set<string>();
      for (const binding of node.namespaceBindings) {
        const valid =
          !localPrefixes.has(binding.prefix) &&
          (binding.prefix === '' || isXmlNCName(binding.prefix)) &&
          binding.prefix !== 'xmlns' &&
          isValidXmlText(binding.namespaceUri) &&
          binding.namespaceUri !== XMLNS_NAMESPACE_URI &&
          !(binding.prefix === 'xml' && binding.namespaceUri !== XML_NAMESPACE_URI) &&
          !(binding.prefix !== 'xml' && binding.namespaceUri === XML_NAMESPACE_URI) &&
          !(binding.prefix !== '' && binding.namespaceUri === '');
        if (!valid) report('invalid-namespace', node.id);
        localPrefixes.add(binding.prefix);
        own.set(binding.prefix, binding.namespaceUri);
      }
      bindings = own;
    }

    if (!isXmlNCName(node.localName)) report('invalid-name', node.id);
    if (!isValidXmlText(node.namespaceUri) || node.namespaceUri === XMLNS_NAMESPACE_URI)
      report('invalid-namespace', node.id);
    const elementPrefixValid =
      node.prefix === undefined
        ? (bindings.get('') ?? '') === node.namespaceUri
        : isXmlNCName(node.prefix) && bindings.get(node.prefix) === node.namespaceUri;
    if (!elementPrefixValid) report('invalid-qname', node.id);

    // A single attribute cannot collide with itself, so the duplicate-tracking set is only
    // allocated once a second attribute exists.
    const expandedAttributes = node.attributes.length > 1 ? new Set<string>() : null;
    for (const attribute of node.attributes) {
      if (!isXmlNCName(attribute.localName)) report('invalid-name', node.id);
      if (!isValidXmlText(attribute.namespaceUri) || attribute.namespaceUri === XMLNS_NAMESPACE_URI)
        report('invalid-namespace', node.id);
      if (!isValidXmlText(attribute.value)) report('invalid-xml-value', node.id);
      const attributePrefixValid =
        attribute.prefix === undefined
          ? attribute.namespaceUri === ''
          : isXmlNCName(attribute.prefix) &&
            bindings.get(attribute.prefix) === attribute.namespaceUri;
      if (!attributePrefixValid) report('invalid-qname', node.id);
      if (expandedAttributes) {
        const key = expandedKey(attribute.namespaceUri, attribute.localName);
        if (expandedAttributes.has(key)) report('duplicate-expanded-attribute', node.id);
        expandedAttributes.add(key);
      }
    }

    try {
      validateQNameAttributeValues(node.attributes, bindings, node.namespaceUri, node.localName);
    } catch {
      report('invalid-qname', node.id);
    }

    if (node.kind !== 'generic') {
      const [namespaceUri, localName] = KNOWN_ELEMENT_NAMES[node.kind];
      const localNameOk =
        node.kind === 'hardBreak'
          ? node.localName === 'br' || node.localName === 'cr'
          : node.kind === 'note'
            ? node.localName === 'footnote' || node.localName === 'endnote'
            : node.kind === 'noteReference'
              ? node.localName === 'footnoteReference' || node.localName === 'endnoteReference'
              : node.kind === 'noteRef'
                ? node.localName === 'footnoteRef' || node.localName === 'endnoteRef'
                : node.localName === localName;
      if (
        node.namespaceUri !== namespaceUri ||
        !localNameOk ||
        (isDrawingKnownKind(node.kind)
          ? !validateDrawingNode(node.kind, node.localName, node.attributes, node.children, parent)
          : !knownAttributesAreValid(node.kind, node.attributes) ||
            !validKnownKind(node.kind, node.children))
      )
        report('known-node-invariant', node.id);
    }

    // Children may prune only when THIS node's paired predecessor declares the very same
    // binding array (reference identity — the spine rebuild spreads it through), so the
    // inherited context every child sees is provably what its predecessor saw.
    const childContext =
      priorContext &&
      priorNode !== undefined &&
      priorNode.kind !== 'textValue' &&
      priorNode.namespaceBindings === node.namespaceBindings;
    let priorChildren: ReadonlyMap<string, OoxmlNode> | null = null;
    if (childContext) {
      const paired = new Map<string, OoxmlNode>();
      for (const child of (priorNode as OoxmlElement).children) {
        if (!paired.has(child.id)) paired.set(child.id, child);
      }
      priorChildren = paired;
    }
    const isWml = node.namespaceUri === WML_NAMESPACE_URI;
    const childParent: DrawingParentContext = {
      wmlLocalName: isWml ? node.localName : undefined,
      kind: node.kind,
      namespaceUri: node.namespaceUri,
      localName: node.localName,
      attributes: node.attributes,
    };
    for (let index = 0; index < node.children.length; index += 1) {
      const child = node.children[index]!;
      indexTrail.push(index);
      walk(child, bindings, priorChildren?.get(child.id), childContext, childParent);
      indexTrail.pop();
    }
  };

  walk(
    part.root,
    new Map([
      ['xml', XML_NAMESPACE_URI],
      ['xmlns', XMLNS_NAMESPACE_URI],
    ]),
    previous?.root,
    previous !== null,
    undefined
  );
  return issues.length === 0 ? { ok: true } : { ok: false, issues: Object.freeze(issues) };
}
