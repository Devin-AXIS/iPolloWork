// Derived semantic indexes over the canonical tree (typed-ooxml-paragraph-editor task 4.7).
//
// These are PROJECTIONS, never authority. Every index is a pure function of one tree
// revision: rebuilding from the same revision yields an identical index, and nothing here
// may be mutated or consulted as a source of truth by save. That is the whole point of the
// "derived indexes are not mutation or serialization authority" requirement — the store
// mutates the tree and re-derives, rather than keeping a second structure in sync.
//
// The revision tag is carried, not computed here: `DocumentStore` owns revisions, and an
// index that invented its own would let a stale projection claim to be current.

import { inlineCharacterTextOf } from './hyphen-text.ts';
import { hardBreakText } from './hard-break.ts';
import {
  contentControlContentOf,
  isContentControl,
  walkAllStoryParagraphs,
  walkParagraphInline,
} from './content-control-walk.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from './ooxml-tree.ts';
import { WML_NAMESPACE_URI } from './ooxml-tree.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import { resolveRelationship, type RelationshipRecord } from './relationships.ts';

/** One paragraph in the index: its node id, its story, and its position. */
export interface ParagraphIndexEntry {
  /** Canonical tree node id — the stable identity operations address. */
  readonly nodeId: string;
  /** Position among the story's paragraphs, in document order. */
  readonly ordinal: number;
  /** Concatenated text content, with tabs and breaks mapped as the model reads them. */
  readonly text: string;
  /** Node ids of the paragraph's runs, in order. */
  readonly runIds: readonly string[];
}

/** One story root — body, a header/footer variant, or a note part. */
export interface StoryIndexEntry {
  /** The part the story lives in. */
  readonly partName: string;
  /** The `w:body` (or story root) node id. */
  readonly rootId: string;
  readonly paragraphs: readonly ParagraphIndexEntry[];
}

/** One style definition, indexed by the id content references it under. */
export interface StyleIndexEntry {
  readonly styleId: string;
  readonly type: string;
  readonly nodeId: string;
  readonly name: string | null;
  readonly basedOn: string | null;
  /** Whether the part marks this the default style for its type (`w:default="1"`). */
  readonly isDefault: boolean;
}

/**
 * The derived lookups over a part: paragraphs, stories and styles by id.
 *
 * Diff-patched on commit rather than rebuilt — rebuilding every index per keystroke is what made
 * typing scale with document length.
 */
export interface OoxmlIndexes {
  /** The tree revision these projections were derived from. */
  readonly revision: number;
  /** Body story first, then any other story parts, keyed by part name. */
  readonly stories: ReadonlyMap<string, StoryIndexEntry>;
  /** Every paragraph across every story, keyed by node id. */
  readonly paragraphs: ReadonlyMap<string, ParagraphIndexEntry>;
  readonly relationships: ReadonlyMap<string, readonly RelationshipRecord[]>;
  readonly styles: ReadonlyMap<string, StyleIndexEntry>;
}

function isWml(node: OoxmlNode, localName: string): node is OoxmlElement {
  return (
    node.kind !== 'textValue' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    node.localName === localName
  );
}

function attr(element: OoxmlElement, localName: string): string | null {
  for (const a of element.attributes) {
    if (a.namespaceUri === WML_NAMESPACE_URI && a.localName === localName) return a.value;
  }
  return null;
}

/**
 * Text content of a run subtree.
 *
 * `w:t` contributes its characters, `w:tab` a tab, `w:br`/`w:cr` a newline — matching how
 * the authored model reads a run, so an index built from the tree and a model built from
 * the same source agree on paragraph text. A hyphen element contributes its one character. Any
 * other GENERIC child contributes nothing: unknown
 * content has no text projection, but it is still present in the tree, which is exactly the
 * difference from the legacy model that dropped the run entirely.
 */
function runText(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  if (node.kind === 'tab') return '\t';
  if (node.kind === 'hardBreak') return hardBreakText(node);
  if (node.kind === 'generic') return inlineCharacterTextOf(node) ?? '';
  if (node.kind === 'runProperties' || node.kind === 'paragraphProperties') return '';
  if (node.kind === 'hyperlink' || isContentControl(node)) {
    let text = '';
    const children =
      node.kind === 'hyperlink' ? node.children : (contentControlContentOf(node) ?? []);
    for (const child of children) text += runText(child);
    return text;
  }
  let text = '';
  for (const child of node.children) text += runText(child);
  return text;
}

function indexParagraph(paragraph: OoxmlElement, ordinal: number): ParagraphIndexEntry {
  const runIds: string[] = [];
  let text = '';
  // A `w:hyperlink` is a run CONTAINER: its runs are part of the paragraph's text, so the
  // index descends into it. Reading only direct `w:r` children left the index disagreeing
  // with `segmentsOf` about how long every paragraph holding a link was.
  const visit = (child: OoxmlNode): void => {
    if (child.kind === 'run') {
      runIds.push(child.id);
      text += runText(child);
    }
  };
  walkParagraphInline(paragraph.children, 0, visit);
  return { nodeId: paragraph.id, ordinal, text, runIds };
}

/** The `w:body` element of a part, if it has one. */
function findBody(root: OoxmlElement): OoxmlElement | null {
  if (root.kind === 'body') return root;
  for (const child of root.children) {
    if (child.kind === 'textValue') continue;
    const found = findBody(child);
    if (found) return found;
  }
  return null;
}

function indexStory(part: OoxmlPart): StoryIndexEntry | null {
  const body = findBody(part.root);
  if (!body) return null;
  const paragraphs: ParagraphIndexEntry[] = [];
  walkAllStoryParagraphs(body.children, 0, (paragraph) => {
    paragraphs.push(indexParagraph(paragraph, paragraphs.length));
  });
  return { partName: part.name, rootId: body.id, paragraphs };
}

/** Style definitions, read out of the generic `w:styles` tree. */
export function indexStyles(part: OoxmlPart | undefined): Map<string, StyleIndexEntry> {
  const styles = new Map<string, StyleIndexEntry>();
  if (!part) return styles;
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (isWml(node, 'style')) {
      const styleId = attr(node, 'styleId');
      if (styleId !== null) {
        let name: string | null = null;
        let basedOn: string | null = null;
        for (const child of node.children) {
          if (isWml(child, 'name')) name = attr(child, 'val');
          if (isWml(child, 'basedOn')) basedOn = attr(child, 'val');
        }
        // First definition wins, matching a reader that would not let a later duplicate
        // silently retarget an id.
        if (!styles.has(styleId)) {
          styles.set(styleId, {
            styleId,
            type: attr(node, 'type') ?? '',
            nodeId: node.id,
            name,
            basedOn,
            // `ST_OnOff`, so all three on-spellings count — the layout lane's
            // `isDefaultFlag` reads the same attribute and must reach the same answer, or
            // the page paints the default style while the automation lane reports none.
            isDefault: ['1', 'true', 'on'].includes(attr(node, 'default') ?? ''),
          });
        }
      }
    }
    for (const child of node.children) walk(child);
  };
  walk(part.root);
  return styles;
}

const STYLES_PART_RE = /\/styles\.xml$/i;

/** The package's style definitions part, if it has one. */
export function stylesPartOf(pkg: OoxmlPackage): OoxmlPart | undefined {
  const relationship = pkg.relationships
    .get(pkg.mainDocumentPart)
    ?.find(
      (record) =>
        record.type === 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles'
    );
  if (relationship) {
    const resolved = resolveRelationship(relationship);
    if (resolved.mode === 'Internal' && resolved.target.ok) {
      const part = pkg.parts.get(resolved.target.partName);
      if (part) return part;
    }
  }
  // Retain support for older packages that omit the styles relationship.
  return [...pkg.parts.values()].find((part) => STYLES_PART_RE.test(part.name));
}

/**
 * The styles root an editing session reads: the main document's styles relationship, then
 * `/word/styles.xml`. Unlike {@link stylesPartOf}, it does not search other part names. The
 * session and its change tracker share this rule, so they agree on when styles change.
 */
export function sessionStylesRootOf(pkg: OoxmlPackage): OoxmlElement | null {
  const record = pkg.relationships
    .get(pkg.mainDocumentPart)
    ?.find(
      (relationship) =>
        relationship.type ===
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles'
    );
  if (record) {
    const resolved = resolveRelationship(record);
    if (resolved.mode === 'Internal' && resolved.target.ok) {
      const part = pkg.parts.get(resolved.target.partName);
      if (part) return part.root;
    }
  }
  return pkg.parts.get('/word/styles.xml')?.root ?? null;
}

const NUMBERING_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';

/**
 * The numbering part's root, chosen as the editor session chooses the one it paints with: the
 * main document's FIRST numbering relationship, else the default path.
 */
export function numberingRootOf(pkg: OoxmlPackage): OoxmlElement | null {
  const record = (pkg.relationships.get(pkg.mainDocumentPart) ?? []).find(
    (relationship) => relationship.type === NUMBERING_REL
  );
  let part: OoxmlPart | undefined;
  if (record) {
    const resolved = resolveRelationship(record);
    if (resolved.mode === 'Internal' && resolved.target.ok) {
      part = pkg.parts.get(resolved.target.partName);
    }
  }
  part ??= pkg.parts.get('/word/numbering.xml');
  return part?.root ?? null;
}

/**
 * Derive every index from one canonical package revision.
 *
 * Pure: the same package and revision always produce the same index, which is what makes
 * "rebuild rather than mutate" a safe invalidation strategy.
 */
export function deriveOoxmlIndexes(pkg: OoxmlPackage, revision: number): OoxmlIndexes {
  const stories = new Map<string, StoryIndexEntry>();
  const paragraphs = new Map<string, ParagraphIndexEntry>();

  const main = pkg.parts.get(pkg.mainDocumentPart);
  const ordered = [
    ...(main ? [main] : []),
    ...[...pkg.parts.values()].filter((part) => part.name !== pkg.mainDocumentPart),
  ];

  for (const part of ordered) {
    const story = indexStory(part);
    if (!story) continue;
    stories.set(part.name, story);
    for (const paragraph of story.paragraphs) paragraphs.set(paragraph.nodeId, paragraph);
  }

  const stylesPart = stylesPartOf(pkg);

  return Object.freeze({
    revision,
    stories,
    paragraphs,
    relationships: pkg.relationships,
    styles: indexStyles(stylesPart),
  });
}
