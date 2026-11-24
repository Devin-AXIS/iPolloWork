// Exporter-neutral cache identity for semantic projection inputs outside story trees.

import type {
  DocumentProperties,
  HeadlessDocumentView,
  OoxmlNode,
} from '@docx-editor.dev/core/store';
import { sha256FontBytes } from '../store/package/sha256.ts';
import type { DocumentPropertyKey } from './field-doc-property.ts';
import { piecesOfParagraph } from './field-projection.ts';
import { framedTokenJoin } from './framed-token.ts';
import {
  aggregateParagraphTokensForTableBlock,
  createTableRowTokenStore,
} from './table-paragraph-tokens.ts';
import type { HyperlinkProjector } from './field-pieces.ts';

const encoder = new TextEncoder();
const MAX_MEMOIZED_STORY_OWNERS = 512;

type DocumentPropertyProjectionRole = 'field-projected' | 'reserved';

// Exhaustive over the public metadata model: adding a property is a compile error until its
// semantic projection role is decided. A field-projected entry must also have a sentinel below.
const DOCUMENT_PROPERTY_PROJECTION_ROLES = Object.freeze({
  title: 'field-projected',
  creator: 'field-projected',
  subject: 'field-projected',
  keywords: 'field-projected',
  lastModifiedBy: 'field-projected',
  description: 'field-projected',
  company: 'reserved',
  manager: 'reserved',
} satisfies Readonly<Record<keyof DocumentProperties, DocumentPropertyProjectionRole>>);

// Exhaustive over what the FIELD engine currently supports as well: extending its allowlist
// without classifying the new key as live projection state is a compile error here.
const FIELD_PROJECTED_PROPERTY_ROLES = Object.freeze({
  title: DOCUMENT_PROPERTY_PROJECTION_ROLES.title,
  creator: DOCUMENT_PROPERTY_PROJECTION_ROLES.creator,
  subject: DOCUMENT_PROPERTY_PROJECTION_ROLES.subject,
  keywords: DOCUMENT_PROPERTY_PROJECTION_ROLES.keywords,
  lastModifiedBy: DOCUMENT_PROPERTY_PROJECTION_ROLES.lastModifiedBy,
  description: DOCUMENT_PROPERTY_PROJECTION_ROLES.description,
} satisfies Readonly<Record<DocumentPropertyKey, 'field-projected'>>);

const PROJECTED_PROPERTY_KEYS = Object.freeze(
  Object.keys(FIELD_PROJECTED_PROPERTY_ROLES) as DocumentPropertyKey[]
);

const PROPERTY_SENTINELS = Object.freeze({
  title: '\u0001doc-property:title\u0002',
  creator: '\u0001doc-property:creator\u0002',
  subject: '\u0001doc-property:subject\u0002',
  keywords: '\u0001doc-property:keywords\u0002',
  lastModifiedBy: '\u0001doc-property:lastModifiedBy\u0002',
  description: '\u0001doc-property:description\u0002',
} satisfies Readonly<Record<DocumentPropertyKey, string>>);

interface ParagraphProjectionDescriptor {
  readonly links: readonly OoxmlNode[];
  readonly documentProperties: readonly DocumentPropertyKey[];
}

const paragraphDescriptors = new WeakMap<OoxmlNode, ParagraphProjectionDescriptor>();

function descriptorOf(paragraph: OoxmlNode): ParagraphProjectionDescriptor {
  const cached = paragraphDescriptors.get(paragraph);
  if (cached) return cached;

  const links: OoxmlNode[] = [];
  const paragraphs: OoxmlNode[] = [paragraph];
  const stack: OoxmlNode[] = [paragraph];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node !== paragraph && node.kind === 'paragraph') paragraphs.push(node);
    if (node.kind === 'hyperlink') links.push(node);
    if (node.kind === 'textValue') continue;
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      stack.push(node.children[index]!);
    }
  }

  // Reuse the field engine's bounded parser instead of maintaining a second complex-field
  // machine here. Sentinel values reveal exactly which live document-property fields can
  // project from out-of-tree metadata; cached-result fields correctly reveal no dependency.
  const propertyKeys = new Set<DocumentPropertyKey>();
  for (const candidate of paragraphs) {
    const sentinelPieces = piecesOfParagraph(
      candidate,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      'all-markup',
      undefined,
      undefined,
      undefined,
      undefined,
      PROPERTY_SENTINELS
    );
    const painted = new Set(sentinelPieces.map((piece) => piece.text));
    for (const key of PROJECTED_PROPERTY_KEYS) {
      if (painted.has(PROPERTY_SENTINELS[key])) propertyKeys.add(key);
    }
  }
  // A hosted text box is laid out while breaking its drawing's HOST paragraph. If that host
  // break hits the cache, the box callback never runs, so the host token must aggregate every
  // nested story paragraph as well as each nested paragraph carrying its own precise token.
  const documentProperties = PROJECTED_PROPERTY_KEYS.filter((key) => propertyKeys.has(key));
  const descriptor = Object.freeze({
    links: Object.freeze(links),
    documentProperties: Object.freeze(documentProperties),
  });
  paragraphDescriptors.set(paragraph, descriptor);
  return descriptor;
}

function digest(parts: readonly string[]): string {
  return sha256FontBytes(encoder.encode(framedTokenJoin(parts)));
}

interface PartEpochMemo {
  readonly revision: number;
  readonly pkg: ReturnType<HeadlessDocumentView['currentPackage']>;
  readonly epochs: Map<string, string>;
}

const partEpochs = new WeakMap<HeadlessDocumentView, PartEpochMemo>();

/** Paired projector/cache identities shared by browser, exporters, and future story hosts. */
export interface StoryProjectionDependencies {
  readonly tokenForParagraphForPart: (partName: string, paragraph: OoxmlNode) => string;
  /** Memoized aggregate for every paragraph in an immutable table subtree. */
  readonly tokenForTableForPart: (partName: string, table: OoxmlNode) => string;
  readonly epochForPart: (partName: string) => string;
}

/**
 * Build paragraph-local semantic projection identities over one live package view.
 *
 * The part epoch is only an outer-memo freshness signal. It must never be folded into the
 * measurement producer or paragraph keys: paragraph tokens below are the precise dependency.
 */
export function createStoryProjectionDependencies(
  view: HeadlessDocumentView,
  projectLinkForPart: (partName: string) => HyperlinkProjector
): StoryProjectionDependencies {
  // Per dependency bundle, then per immutable node and stable part projector. The epoch validates
  // every relationship/property input without retaining package snapshots or part names.
  const paragraphTokens = new WeakMap<
    OoxmlNode,
    WeakMap<HyperlinkProjector, { readonly epoch: string; readonly token: string }>
  >();
  const tableTokens = new WeakMap<
    OoxmlNode,
    WeakMap<HyperlinkProjector, { readonly epoch: string; readonly token: string }>
  >();
  // Row segments under the same projector and epoch, for a table node a cell edit replaced.
  const tableRowTokens = createTableRowTokenStore();
  const epochForPart = (partName: string): string => {
    const revision = view.packageRevision();
    const pkg = view.currentPackage();
    let memo = partEpochs.get(view);
    if (!memo || memo.revision !== revision || memo.pkg !== pkg) {
      memo = { revision, pkg, epochs: new Map() };
      partEpochs.set(view, memo);
    }
    const cached = memo.epochs.get(partName);
    if (cached !== undefined) return cached;
    const tokens = ['story-projection-part:v1', partName];
    tokens.push(
      framedTokenJoin(
        (Object.keys(DOCUMENT_PROPERTY_PROJECTION_ROLES) as (keyof DocumentProperties)[]).map(
          (key) => `${key}:${DOCUMENT_PROPERTY_PROJECTION_ROLES[key]}`
        )
      )
    );
    for (const record of pkg.relationships.get(partName) ?? []) {
      tokens.push(
        framedTokenJoin([
          record.id,
          record.type,
          record.rawTarget,
          record.targetMode,
          String(record.order),
        ])
      );
    }
    for (const record of pkg.externalTargets) {
      if (record.ownerPart !== partName) continue;
      tokens.push(
        framedTokenJoin([record.id, record.type, record.rawTarget, record.sinkSafe ? '1' : '0'])
      );
    }
    const properties: DocumentProperties = view.documentProperties();
    for (const key of PROJECTED_PROPERTY_KEYS) {
      tokens.push(framedTokenJoin([key, properties[key] ?? '']));
    }
    const epoch = `story-projection-part:${digest(tokens)}`;
    // Package parsing already caps part counts, but this API is public and callers may probe
    // arbitrary future owner names. Keep hostile input from turning the revision memo into an
    // unbounded string-keyed cache; correctness does not depend on memo admission.
    if (memo.epochs.size < MAX_MEMOIZED_STORY_OWNERS) memo.epochs.set(partName, epoch);
    return epoch;
  };

  const tokenForParagraphForPart = (partName: string, paragraph: OoxmlNode): string => {
    const descriptor = descriptorOf(paragraph);
    if (descriptor.links.length === 0 && descriptor.documentProperties.length === 0) return '';
    const projectLink = projectLinkForPart(partName);
    const epoch = epochForPart(partName);
    const byProjector = paragraphTokens.get(paragraph);
    const cached = byProjector?.get(projectLink);
    if (cached?.epoch === epoch) return cached.token;
    const properties = view.documentProperties();
    const tokens: string[] = ['story-projection:v1'];
    for (const link of descriptor.links) {
      const projected = projectLink(link);
      tokens.push(
        projected
          ? framedTokenJoin([
              projected.id,
              projected.kind,
              projected.href ?? '',
              projected.anchor ?? '',
              projected.tooltip ?? '',
            ])
          : 'no-link'
      );
    }
    for (const key of descriptor.documentProperties) {
      tokens.push(framedTokenJoin([key, properties[key] ?? '']));
    }
    const token = `story-projection:${digest(tokens)}`;
    const target = byProjector ?? new WeakMap();
    target.set(projectLink, { epoch, token });
    if (!byProjector) paragraphTokens.set(paragraph, target);
    return token;
  };

  const tokenForTableForPart = (partName: string, table: OoxmlNode): string => {
    const projectLink = projectLinkForPart(partName);
    const epoch = epochForPart(partName);
    const byProjector = tableTokens.get(table);
    const cached = byProjector?.get(projectLink);
    if (cached?.epoch === epoch) return cached.token;
    const token = aggregateParagraphTokensForTableBlock(
      table,
      (paragraph) => tokenForParagraphForPart(partName, paragraph),
      { rows: tableRowTokens, scope: projectLink, epoch }
    );
    const target = byProjector ?? new WeakMap();
    target.set(projectLink, { epoch, token });
    if (!byProjector) tableTokens.set(table, target);
    return token;
  };

  return Object.freeze({ tokenForParagraphForPart, tokenForTableForPart, epochForPart });
}
