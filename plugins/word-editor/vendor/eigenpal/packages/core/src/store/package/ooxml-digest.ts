// Save/reopen semantic digest — the SECOND serialization oracle (task 4.8, design D9).
//
// The canonical tree fingerprint answers "is this the same tree?". It cannot answer "did a
// round trip lose meaning?", because a serializer bug that drops content produces a tree
// that is internally consistent and fingerprints happily against itself. So D9 requires two
// oracles and forbids one compensating for the other: serialize, REOPEN the produced bytes,
// and compare a digest of what the reopened package actually means.
//
// The digest covers what a document MEANS — its blocks and their containment, the
// properties every one of them declares, and paragraph text — and deliberately ignores
// lexical detail, because byte equality is the alternative D9 rejects: it fails on harmless
// normalization while still not saying what was lost.
//
// It is the only net there is, so its holes are the fidelity risk of the whole engine.
// Three of them were measured, and all three are closed here:
//
//   - `propertyTokens` read ONE level, so every property whose meaning lives in its
//     CHILDREN digested as a bare name. `w:numPr` has no attributes of its own: numbering
//     `3/0` and `99/5` were the same token, and so were a six-edge `w:pBdr` and `<w:pBdr/>`,
//     a full tab-stop list and `<w:tabs/>`, a bold 24pt paragraph mark and `<w:rPr/>`.
//   - The walk HARVESTED paragraphs out of the block tree, so nothing else in it was
//     digested at all: `w:tblPr`, `w:tblGrid`, `w:tcPr` (`gridSpan`, `vMerge`), every
//     `w:sectPr` — page size, margins, header references, `titlePg` — could all be dropped
//     for zero differences, and a table flattened into loose paragraphs read as identical
//     because containment itself was not observable.
//   - A part with no `w:body`/`w:hdr`/`w:ftr` digested as `null`, so `numbering.xml`,
//     `styles.xml` and `settings.xml` were not covered by ANY oracle: an `abstractNum`
//     could lose eight of its nine levels in silence.

import { fieldAtomText } from './field-nodes.ts';
import { hardBreakText } from './hard-break.ts';
import { contentControlContentOf, isContentControl } from './content-control-walk.ts';
import { MAX_XML_DEPTH } from './xml-reader.ts';
import { paraIdOf } from './para-id.ts';
import { isDrawingKnownKind } from './ooxml-drawing-rules.ts';
import { TreeReadError } from './ooxml-shared.ts';
import {
  canonicalOoxmlFingerprint,
  canonicalOoxmlFingerprintWithBindings,
  DEFAULT_FINGERPRINT_BINDINGS,
  RELATIONSHIPS_NAMESPACE_URI,
  WML_NAMESPACE_URI,
} from './ooxml-tree.ts';
import type {
  OoxmlElement,
  OoxmlNode,
  OoxmlParagraphNode,
  OoxmlParagraphPropertiesNode,
  OoxmlPart,
  OoxmlRunPropertiesNode,
} from './ooxml-tree.ts';

/** One paragraph's meaning, independent of how it was spelled in XML. */
export interface ParagraphDigest {
  /** Ordinal identity within its story. Node ids are NOT used: a reopened package
   *  legitimately re-derives them, and requiring them to match would test the id scheme
   *  rather than the content. */
  readonly ordinal: number;
  /**
   * Where the paragraph SITS: the element path from the story root, so a paragraph that
   * moves out of the table cell it was written in is a difference rather than a paragraph
   * with the same ordinal and the same text.
   */
  readonly path: string;
  /**
   * `w14:paraId`, uppercase-normalized (matching is case-insensitive), or null. This is
   * MANAGED identity — the agent contract anchors on it and comment threading references
   * it — so a serializer silently dropping it must be a digest difference. Other paragraph
   * attributes (`w:rsidR` …) stay deliberately undigested: they are revision noise.
   */
  readonly paraId: string | null;
  /** Text content, including tabs and hard breaks as their characters. */
  readonly text: string;
  /** Accepted paragraph properties, as sorted tokens including nested children. */
  readonly paragraphProperties: readonly string[];
  /** Per-run accepted properties, in run order. */
  readonly runProperties: readonly (readonly string[])[];
  /** Fingerprints of every generic (unknown) subtree, in document order. */
  readonly genericStructure: readonly string[];
}

/** One story reduced to its semantic content, ignoring everything a normalized re-emit changes. */
export interface StoryDigest {
  readonly partName: string;
  readonly paragraphs: readonly ParagraphDigest[];
  /**
   * Every block-level element of the part OUTSIDE a paragraph, in document order, as
   * `path name(attributes)` — the tables, rows, cells, sections, content controls and
   * their property children, each at the position that says what contains it.
   *
   * A paragraph's own internals are not here (they are its `ParagraphDigest`), which keeps
   * this list proportional to a document's STRUCTURE rather than its text.
   */
  readonly structure: readonly string[];
}

/**
 * The whole document's semantic content — one of the D9 losslessness oracles.
 *
 * What a save/reopen round-trip is compared on. Byte identity applies only to non-XML parts;
 * modelled parts re-emit normalized, so equality is asserted HERE rather than on bytes.
 */
export interface SemanticDigest {
  readonly stories: readonly StoryDigest[];
}

/** Where two digests diverge — the diagnostic when a round-trip loses something. */
export type DigestDifference = {
  readonly path: string;
  readonly before: string;
  readonly after: string;
};

/** A namespace-qualified name; the URI, never the authored prefix, which normalizes. */
function qualifiedName(node: OoxmlElement): string {
  return node.namespaceUri === WML_NAMESPACE_URI
    ? node.localName
    : `{${node.namespaceUri}}${node.localName}`;
}

function attributeTokens(node: OoxmlElement): string[] {
  const values: string[] = [];
  for (const attribute of node.attributes) {
    values.push(
      attribute.namespaceUri === '' || attribute.namespaceUri === WML_NAMESPACE_URI
        ? `${attribute.localName}=${attribute.value}`
        : `{${attribute.namespaceUri}}${attribute.localName}=${attribute.value}`
    );
  }
  // Attribute ORDER is not authored meaning — a serializer may emit them in any order.
  values.sort();
  return values;
}

/**
 * One property as a token, INCLUDING everything nested inside it.
 *
 * A property's meaning is not always in its attributes: `w:numPr` carries the list and the
 * level in `w:ilvl`/`w:numId` and has no attributes at all, `w:tabs` holds one `w:tab` per
 * stop, `w:pBdr` an element per edge. Reading only the first level digested every one of
 * them as a bare name, so replacing the whole set with an empty element was a zero-
 * difference round trip.
 *
 * Bounded by the parse ceiling (`MAX_XML_DEPTH`), which already bounds the tree this walks:
 * `preflightDepth` refuses deeper bytes before the parser allocates.
 */
function propertyToken(node: OoxmlElement, depth: number): string {
  const values = attributeTokens(node);
  const head =
    values.length > 0 ? `${qualifiedName(node)}(${values.join(',')})` : qualifiedName(node);
  if (depth >= MAX_XML_DEPTH) return head;
  const nested: string[] = [];
  for (const child of node.children) {
    if (child.kind === 'textValue') {
      if (child.value !== '') nested.push(`#${child.value}`);
      continue;
    }
    nested.push(propertyToken(child, depth + 1));
  }
  // Sorted for the same reason the token list is: order inside a property container is
  // schema-fixed and carries no authored meaning.
  nested.sort();
  return nested.length > 0 ? `${head}[${nested.join(',')}]` : head;
}

function propertyTokens(
  container: OoxmlRunPropertiesNode | OoxmlParagraphPropertiesNode | undefined
): string[] {
  if (!container) return [];
  const tokens: string[] = [];
  for (const child of container.children) {
    if (child.namespaceUri !== WML_NAMESPACE_URI) continue;
    tokens.push(propertyToken(child, 1));
  }
  // Sorted: OOXML property order inside `w:rPr` / `w:pPr` is schema-fixed and carries no
  // authored meaning, so a serializer that emits them in a different valid order has lost
  // nothing. Significant CONTENT order is checked separately, by the fingerprint oracle.
  tokens.sort();
  return tokens;
}

function textOf(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  if (node.kind === 'tab') return '\t';
  if (node.kind === 'hardBreak') return hardBreakText(node);
  if (node.kind === 'drawing') return fieldAtomText();
  if (node.kind === 'runProperties' || node.kind === 'paragraphProperties') return '';
  if (node.kind === 'generic') return '';
  if (node.kind === 'hyperlink' || isContentControl(node)) {
    let text = '';
    const children =
      node.kind === 'hyperlink' ? node.children : (contentControlContentOf(node) ?? []);
    for (const child of children) text += textOf(child);
    return text;
  }
  let text = '';
  for (const child of node.children) text += textOf(child);
  return text;
}

function bindingsForElement(
  inherited: ReadonlyMap<string, string>,
  node: OoxmlElement
): ReadonlyMap<string, string> {
  const bindings = new Map(inherited);
  for (const binding of node.namespaceBindings) bindings.set(binding.prefix, binding.namespaceUri);
  return bindings;
}

function genericStructureFingerprint(
  node: OoxmlElement,
  inheritedBindings: ReadonlyMap<string, string>
): string {
  try {
    return canonicalOoxmlFingerprintWithBindings(node, inheritedBindings);
  } catch (error) {
    if (error instanceof TreeReadError && error.reason === 'undeclared-prefix') {
      return `generic-refusal:undeclared-prefix:{${node.namespaceUri}}${node.localName}`;
    }
    throw error;
  }
}

function collectGeneric(
  node: OoxmlNode,
  out: string[],
  inheritedBindings: ReadonlyMap<string, string> = DEFAULT_FINGERPRINT_BINDINGS
): void {
  if (node.kind === 'textValue') return;
  // A property container's children are covered by `propertyTokens`, which sorts them
  // because OOXML property order is schema-fixed and carries no authored meaning. Walking
  // into it here as well would both double-count every property AND smuggle their document
  // order back in as significant, so `<w:b/><w:u/>` and `<w:u/><w:b/>` would read as
  // semantic loss. Foreign-namespace children are the exception: `propertyTokens` skips
  // those, so this is their only owner.
  if (node.kind === 'runProperties' || node.kind === 'paragraphProperties') {
    const childBindings = bindingsForElement(inheritedBindings, node);
    const foreign: string[] = [];
    for (const child of node.children) {
      if (child.namespaceUri === WML_NAMESPACE_URI) continue;
      foreign.push(genericStructureFingerprint(child, childBindings));
    }
    foreign.sort(); // order among properties is not authored meaning
    out.push(...foreign);
    return;
  }
  if (node.kind === 'generic') {
    out.push(genericStructureFingerprint(node, inheritedBindings));
    return; // fingerprint covers the whole subtree; do not double-count descendants
  }
  if (isContentControl(node)) {
    // Unmodelled `w:sdtPr` chrome and type-specific payloads stay in genericStructure per D9.
    out.push(canonicalOoxmlFingerprint(node));
    return;
  }
  // Bookmark markers are TYPED but they are still preserved evidence, not structure the
  // digest reconstructs from anything else: they carry no text and no properties, so a
  // walk that merely recursed past them (they have no children) reported nothing when one
  // was dropped. Fingerprinting them keeps a lost anchor a reported loss, which is what it
  // was while they were generic.
  if (node.kind === 'bookmarkStart' || node.kind === 'bookmarkEnd') {
    out.push(canonicalOoxmlFingerprintWithBindings(node, inheritedBindings));
    return;
  }
  if (node.kind === 'drawing') {
    out.push(drawingStructureToken(node));
    return;
  }
  if (isDrawingKnownKind(node.kind)) return;
  const childBindings = bindingsForElement(inheritedBindings, node);
  for (const child of node.children) collectGeneric(child, out, childBindings);
}

/**
 * A hyperlink's own identity, as a structure token: its authored attributes, sorted.
 *
 * The link element itself carries no text, so without this a save that dropped the target
 * off a link — or changed `w:anchor` — would digest identically to one that kept it.
 */
function linkIdentityToken(link: OoxmlElement): string {
  const attributes = link.attributes
    .map((attribute) => `${attribute.namespaceUri}|${attribute.localName}=${attribute.value}`)
    .sort();
  return `hyperlink(${attributes.join(',')})`;
}

function blipRelationshipToken(picture: OoxmlElement): string | undefined {
  for (const child of picture.children) {
    if (child.kind !== 'pictureBlipFill') continue;
    for (const blip of child.children) {
      if (blip.kind !== 'pictureBlip') continue;
      const embed = blip.attributes.find(
        (attribute) =>
          attribute.localName === 'embed' && attribute.namespaceUri === RELATIONSHIPS_NAMESPACE_URI
      )?.value;
      const link = blip.attributes.find(
        (attribute) =>
          attribute.localName === 'link' && attribute.namespaceUri === RELATIONSHIPS_NAMESPACE_URI
      )?.value;
      if (embed !== undefined) return `embed=${embed}`;
      if (link !== undefined) return `link=${link}`;
    }
  }
  return undefined;
}

function pictureSemanticChildToken(
  node: OoxmlNode,
  depth: number,
  inheritedBindings: ReadonlyMap<string, string>
): string {
  if (node.kind === 'textValue') return `#${node.value}`;
  if (depth >= MAX_XML_DEPTH) return qualifiedName(node);
  const bindings = bindingsForElement(inheritedBindings, node);
  if (node.kind === 'generic') return genericStructureFingerprint(node, bindings);
  const attrs = attributeTokens(node);
  const head =
    attrs.length > 0 ? `${qualifiedName(node)}(${attrs.join(',')})` : qualifiedName(node);
  const nested: string[] = [];
  for (const child of node.children) {
    if (child.kind === 'textValue') continue;
    nested.push(pictureSemanticChildToken(child, depth + 1, bindings));
  }
  nested.sort();
  return nested.length > 0 ? `${head}[${nested.join(',')}]` : head;
}

function pictureSemanticTokens(
  picture: OoxmlElement,
  depth: number,
  inheritedBindings: ReadonlyMap<string, string>
): string[] {
  const bindings = bindingsForElement(inheritedBindings, picture);
  const tokens: string[] = [];
  for (const child of picture.children) {
    if (child.kind === 'textValue') continue;
    if (child.kind === 'pictureBlipFill') {
      const blipFillChildren = child.children;
      const blip = blipFillChildren.find((c) => c.kind === 'pictureBlip');
      const effects = blipFillChildren
        .filter((c) => c.kind !== 'pictureBlip')
        .map((effect) => pictureSemanticChildToken(effect, depth + 1, bindings));
      effects.sort();
      if (blip && blip.kind === 'pictureBlip') {
        const blipAttrs = attributeTokens(blip);
        const blipHead =
          blipAttrs.length > 0 ? `pictureBlip(${blipAttrs.join(',')})` : 'pictureBlip';
        tokens.push(effects.length > 0 ? `${blipHead}[${effects.join(',')}]` : blipHead);
      } else {
        for (const blipChild of blipFillChildren) {
          tokens.push(pictureSemanticChildToken(blipChild, depth + 1, bindings));
        }
      }
      continue;
    }
    tokens.push(pictureSemanticChildToken(child, depth + 1, bindings));
  }
  tokens.sort();
  return tokens;
}

function drawingChildFingerprint(
  node: OoxmlNode,
  depth: number,
  inheritedBindings: ReadonlyMap<string, string>
): string {
  if (node.kind === 'textValue') return `#${node.value}`;
  if (depth >= MAX_XML_DEPTH) return qualifiedName(node);
  const bindings = bindingsForElement(inheritedBindings, node);
  if (node.kind === 'drawingDocPr') {
    const attrs = attributeTokens(node);
    return attrs.length > 0 ? `docPr(${attrs.join(',')})` : 'docPr';
  }
  if (node.kind === 'picture') {
    const relationship = blipRelationshipToken(node);
    const semantic = pictureSemanticTokens(node, depth + 1, bindings);
    const head = relationship === undefined ? 'picture' : `picture(${relationship})`;
    return semantic.length > 0 ? `${head}[${semantic.join(',')}]` : head;
  }
  const attributes = attributeTokens(node);
  const head =
    attributes.length > 0 ? `${qualifiedName(node)}(${attributes.join(',')})` : qualifiedName(node);
  const nested: string[] = [];
  for (const child of node.children) {
    if (child.kind === 'picture') {
      nested.push(drawingChildFingerprint(child, depth + 1, bindings));
      continue;
    }
    if (child.kind === 'generic') {
      nested.push(genericStructureFingerprint(child, bindings));
      continue;
    }
    if (child.kind !== 'textValue')
      nested.push(drawingChildFingerprint(child, depth + 1, bindings));
  }
  return nested.length > 0 ? `${head}[${nested.join(',')}]` : head;
}

function drawingStructureToken(drawing: OoxmlElement): string {
  const drawingBindings = bindingsForElement(DEFAULT_FINGERPRINT_BINDINGS, drawing);
  const anchor = drawing.children.find(
    (child) => child.kind === 'inlineDrawing' || child.kind === 'anchoredDrawing'
  );
  if (!anchor || anchor.kind === 'textValue') {
    return `drawing(${attributeTokens(drawing).join(',')})`;
  }
  const anchorBindings = bindingsForElement(drawingBindings, anchor);
  const anchorAttributes = attributeTokens(anchor);
  const anchorHead =
    anchorAttributes.length > 0 ? `${anchor.kind}(${anchorAttributes.join(',')})` : anchor.kind;
  const payload: string[] = [];
  for (const child of anchor.children) {
    if (child.kind === 'generic') {
      payload.push(genericStructureFingerprint(child, anchorBindings));
      continue;
    }
    if (child.kind !== 'textValue') payload.push(drawingChildFingerprint(child, 1, anchorBindings));
  }
  return payload.length > 0
    ? `drawing[${anchorHead};${payload.join(';')}]`
    : `drawing[${anchorHead}]`;
}

function digestParagraph(
  paragraph: OoxmlParagraphNode,
  ordinal: number,
  path: string
): ParagraphDigest {
  const pPr = paragraph.children.find(
    (child): child is OoxmlParagraphPropertiesNode => child.kind === 'paragraphProperties'
  );
  const runProperties: string[][] = [];
  let text = '';
  const genericStructure: string[] = [];
  // A `w:hyperlink` contributes its own identity (target, tooltip, history) AND its runs'
  // text and properties. Digesting the link as an opaque blob would have been the easy
  // reading, but then editing a word inside a link would show up as "the whole link changed"
  // and a lost run inside one would not show up at all.
  const paragraphBindings = bindingsForElement(DEFAULT_FINGERPRINT_BINDINGS, paragraph);
  const visit = (child: OoxmlNode, inheritedBindings: ReadonlyMap<string, string>): void => {
    if (child.kind === 'run') {
      const runBindings = bindingsForElement(inheritedBindings, child);
      const rPr = child.children.find(
        (grand): grand is OoxmlRunPropertiesNode => grand.kind === 'runProperties'
      );
      runProperties.push(propertyTokens(rPr));
      text += textOf(child);
      // Includes the run's own `w:rPr`, so a FOREIGN-namespace property child is digested
      // exactly once (there) rather than falling between the two collectors.
      for (const grand of child.children) collectGeneric(grand, genericStructure, runBindings);
      return;
    }
    if (child.kind === 'drawing') {
      genericStructure.push(drawingStructureToken(child));
      return;
    }
    if (child.kind === 'hyperlink') {
      genericStructure.push(linkIdentityToken(child));
      const linkBindings = bindingsForElement(inheritedBindings, child);
      for (const inner of child.children) visit(inner, linkBindings);
      return;
    }
    // An inline content control, read the same way as a hyperlink and for the same reason.
    // WHILE IT WAS GENERIC its fingerprint covered the whole subtree, text included; typing it
    // would otherwise hand its runs to a walk that digests properties and drops text, so a save
    // that emptied a form field would digest identically to one that kept its value. The
    // control's own `w:sdtPr`/`w:sdtEndPr` are fingerprinted — a lost tag, lock or type is a
    // reported loss — and its content is visited, so the runs inside contribute as runs.
    // A still-generic `w:sdt` is not this case: it falls through to `collectGeneric`, whose
    // whole-subtree fingerprint already covers its content exactly once.
    if (child.kind === 'contentControl') {
      genericStructure.push(
        canonicalOoxmlFingerprint({
          ...child,
          children: child.children.filter((inner) => inner.kind !== 'contentControlContent'),
        })
      );
      const controlBindings = bindingsForElement(inheritedBindings, child);
      for (const inner of child.children) {
        if (inner.kind !== 'contentControlContent') continue;
        const contentBindings = bindingsForElement(controlBindings, inner);
        for (const held of inner.children) visit(held, contentBindings);
      }
      return;
    }
    collectGeneric(child, genericStructure, inheritedBindings);
  };
  for (const child of paragraph.children) visit(child, paragraphBindings);
  const paraId = paraIdOf(paragraph);
  return {
    ordinal,
    path,
    paraId: paraId === null ? null : paraId.toUpperCase(),
    text,
    paragraphProperties: propertyTokens(pPr),
    runProperties,
    genericStructure,
  };
}

/**
 * Where a part's blocks live: its `w:body`, `w:hdr` or `w:ftr`.
 *
 * `null` is NOT the answer for a part that has none. `numbering.xml`, `styles.xml` and
 * `settings.xml` carry no story and were therefore digested by nothing at all — an
 * `abstractNum` losing eight of its nine levels, a style losing its `w:tblStylePr`, a
 * `w:defaultTabStop` vanishing: every one a zero-difference round trip. Those parts have
 * no paragraphs to digest, but they are almost entirely STRUCTURE, and the structure walk
 * reads them exactly as it reads a table.
 */
function storyRootOf(root: OoxmlElement): OoxmlElement {
  if (root.localName === 'hdr' || root.localName === 'ftr') return root;
  if (root.kind === 'body') return root;
  for (const child of root.children) {
    if (child.kind === 'textValue') continue;
    if (child.kind === 'body' || child.localName === 'hdr' || child.localName === 'ftr') {
      return child;
    }
  }
  return root;
}

/**
 * Every block of a story, in document order, with what CONTAINS it.
 *
 * Two jobs in one walk, because they answer the same question. Paragraphs are collected
 * wherever they sit — inside a table cell, inside a block content control, nested in both
 * — and everything that is not a paragraph is digested as structure: its name, its own
 * attributes, and its position. Harvesting only the paragraphs left every table property,
 * every cell span and every section unchecked, and made a table flattened into loose
 * paragraphs indistinguishable from the table.
 *
 * A paragraph is not descended into: its content is its own `ParagraphDigest`, and a
 * textbox story inside one of its runs is a different story, digested through the generic
 * structure of the run that holds it.
 *
 * Linear in element count — one token per element outside a paragraph — and bounded by
 * `MAX_XML_DEPTH`, which the reader has already enforced on the bytes.
 */
function collectBlocks(
  container: OoxmlElement,
  path: string,
  paragraphs: OoxmlParagraphNode[],
  paths: string[],
  structure: string[],
  depth: number
): void {
  if (depth > MAX_XML_DEPTH) return;
  let index = 0;
  for (const child of container.children) {
    // Whitespace between block elements is not content and does not survive the read;
    // anything else at this level is an anomaly worth reporting rather than skipping.
    if (child.kind === 'textValue') {
      if (child.value.trim() !== '') structure.push(`${path}/#text ${child.value}`);
      continue;
    }
    const childPath = path === '' ? String(index) : `${path}/${index}`;
    index += 1;
    if (child.kind === 'paragraph') {
      paragraphs.push(child);
      paths.push(childPath);
      structure.push(`${childPath} p`);
      continue;
    }
    const attributes = attributeTokens(child);
    structure.push(
      attributes.length > 0
        ? `${childPath} ${qualifiedName(child)}(${attributes.join(',')})`
        : `${childPath} ${qualifiedName(child)}`
    );
    collectBlocks(child, childPath, paragraphs, paths, structure, depth + 1);
  }
}

/** Digest one part: its paragraphs, and the structure that holds them. */
export function digestPart(part: OoxmlPart): StoryDigest | null {
  const root = storyRootOf(part.root);
  const found: OoxmlParagraphNode[] = [];
  const paths: string[] = [];
  const structure: string[] = [];
  collectBlocks(root, '', found, paths, structure, 0);
  const paragraphs = found.map((paragraph, ordinal) =>
    digestParagraph(paragraph, ordinal, paths[ordinal]!)
  );
  return { partName: part.name, paragraphs, structure };
}

/** Digest every part, in the given order. */
export function semanticDigest(parts: Iterable<OoxmlPart>): SemanticDigest {
  const stories: StoryDigest[] = [];
  for (const part of parts) {
    const story = digestPart(part);
    if (story) stories.push(story);
  }
  return { stories };
}

/**
 * Every way two digests differ, as readable paths.
 *
 * Returns the differences rather than a boolean because "the round trip lost something" is
 * useless without saying what — the failure this oracle exists to catch is a silent drop,
 * and a bare `false` reproduces the silence.
 */
export function diffSemanticDigests(
  before: SemanticDigest,
  after: SemanticDigest
): DigestDifference[] {
  const differences: DigestDifference[] = [];
  const report = (path: string, a: unknown, b: unknown): void => {
    differences.push({
      path,
      before: JSON.stringify(a) ?? 'undefined',
      after: JSON.stringify(b) ?? 'undefined',
    });
  };

  if (before.stories.length !== after.stories.length) {
    report('stories.length', before.stories.length, after.stories.length);
  }
  const count = Math.min(before.stories.length, after.stories.length);
  for (let s = 0; s < count; s += 1) {
    const a = before.stories[s]!;
    const b = after.stories[s]!;
    const at = (suffix: string) => `${a.partName}${suffix}`;
    if (a.paragraphs.length !== b.paragraphs.length) {
      report(at('.paragraphs.length'), a.paragraphs.length, b.paragraphs.length);
    }
    const paragraphCount = Math.min(a.paragraphs.length, b.paragraphs.length);
    for (let p = 0; p < paragraphCount; p += 1) {
      const pa = a.paragraphs[p]!;
      const pb = b.paragraphs[p]!;
      if (pa.text !== pb.text) report(at(`.p[${p}].text`), pa.text, pb.text);
      if (pa.path !== pb.path) report(at(`.p[${p}].path`), pa.path, pb.path);
      if (pa.paraId !== pb.paraId) report(at(`.p[${p}].paraId`), pa.paraId, pb.paraId);
      if (JSON.stringify(pa.paragraphProperties) !== JSON.stringify(pb.paragraphProperties)) {
        report(at(`.p[${p}].paragraphProperties`), pa.paragraphProperties, pb.paragraphProperties);
      }
      if (JSON.stringify(pa.runProperties) !== JSON.stringify(pb.runProperties)) {
        report(at(`.p[${p}].runProperties`), pa.runProperties, pb.runProperties);
      }
      if (JSON.stringify(pa.genericStructure) !== JSON.stringify(pb.genericStructure)) {
        report(at(`.p[${p}].genericStructure`), pa.genericStructure, pb.genericStructure);
      }
    }
    if (a.structure.length !== b.structure.length) {
      report(at('.structure.length'), a.structure.length, b.structure.length);
    }
    const structureCount = Math.min(a.structure.length, b.structure.length);
    for (let i = 0; i < structureCount; i += 1) {
      if (a.structure[i] !== b.structure[i]) {
        report(at(`.structure[${i}]`), a.structure[i], b.structure[i]);
      }
    }
  }
  return differences;
}
