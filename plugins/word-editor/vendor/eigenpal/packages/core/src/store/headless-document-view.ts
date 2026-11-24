// Read-only package view used by DOM-free layout consumers.

import {
  EMPTY_DOCUMENT_PROPERTIES,
  readDocumentProperties,
  type DocumentProperties,
} from './package/document-properties.ts';
import {
  resolveHeaderFooterPartsBySection,
  resolveHeaderFooterResolutionBySection,
  type HeaderFooterParts,
  type HeaderFooterSectionResolution,
} from './package/hf-references.ts';
import {
  readOoxmlPackage,
  type OoxmlPackage,
  type OoxmlPackageRejection,
} from './package/ooxml-package.ts';
import { resolveRelationship } from './package/relationships.ts';
import { type OoxmlElement, type OoxmlPart } from './package/ooxml-tree.ts';
import { normalizeParagraphIdentity } from './package/para-id.ts';
import { refreshBoundContent } from './store/bound-content-refresh.ts';
import { materializeGlossaryPlaceholders } from './store/placeholder-materialize.ts';
import { relationshipTargetIn } from './package/hyperlink-part.ts';
import { collectThemeSchemeFaces } from './package/theme-font-scheme.ts';
import { TreePackageStore } from './store/tree-package-store.ts';

/** Theme typefaces already validated for use by layout. @public */
export interface HeadlessThemeFonts {
  readonly major: string | null;
  readonly minor: string | null;
  /** East Asian heading face; optional for backwards-compatible custom views. */
  readonly majorEastAsia?: string | null;
  /** East Asian body face; optional for backwards-compatible custom views. */
  readonly minorEastAsia?: string | null;
  /** Complex-script heading and body theme faces. */
  readonly majorBidi?: string | null;
  readonly minorBidi?: string | null;
  /** Language-specific theme faces, keyed by ISO 15924 script. */
  readonly majorSupplemental?: Readonly<Record<string, string>>;
  readonly minorSupplemental?: Readonly<Record<string, string>>;
}

/**
 * The read capabilities shared by browser layout, server export, and future renderers.
 *
 * It deliberately exposes resolved package facts rather than a binding or editor session.
 * An exporter can therefore consume the live document without importing ProseMirror or a DOM.
 * @public
 */
export interface HeadlessDocumentView {
  part(): OoxmlPart;
  currentPackage(): OoxmlPackage;
  packageRevision(): number;
  stylesRoot(): OoxmlElement | null;
  numberingRoot(): OoxmlElement | null;
  settingsRoot(): OoxmlElement | null;
  documentThemeFonts(): HeadlessThemeFonts;
  documentProperties(): DocumentProperties;
  headerFooterPartsBySection(): readonly HeaderFooterParts[];
  /**
   * Occurrence-specific relationship metadata for header/footer stories.
   *
   * Optional for backwards-compatible host views; core derives it from `currentPackage()` when
   * absent. Hosts with a working-tree overlay should expose their canonical resolution directly.
   */
  headerFooterResolutionBySection?(): readonly HeaderFooterSectionResolution[];
  relationshipTarget(relationshipId: string): ReturnType<typeof relationshipTargetIn>;
}

/** A bad package is data, not an exceptional control path. @public */
export type HeadlessDocumentRejection = OoxmlPackageRejection | 'no-main-document-tree';

/** Result of opening untrusted DOCX bytes for neutral layout. @public */
export type OpenHeadlessDocumentResult =
  | { readonly ok: true; readonly view: HeadlessDocumentView }
  | { readonly ok: false; readonly reason: HeadlessDocumentRejection; readonly detail?: string };

const REL = Object.freeze({
  styles: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles',
  numbering: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering',
  settings: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings',
  theme: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme',
  fontTable: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable',
  coreProperties:
    'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
  extendedProperties:
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties',
});

function relatedPart(
  pkg: OoxmlPackage,
  ownerPart: string,
  relationshipType: string,
  fallbackName: string
): OoxmlPart | undefined {
  const record = (pkg.relationships.get(ownerPart) ?? []).find(
    (relationship) => relationship.type === relationshipType
  );
  if (record) {
    const resolved = resolveRelationship(record);
    if (resolved.mode === 'Internal' && resolved.target.ok) {
      const part = pkg.parts.get(resolved.target.partName);
      if (part) return part;
    }
  }
  return pkg.parts.get(fallbackName);
}

/**
 * Open DOCX bytes through the bounded store reader and expose only neutral layout reads.
 * @public
 */
export function openHeadlessDocument(bytes: Uint8Array): OpenHeadlessDocumentResult {
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) {
    return {
      ok: false,
      reason: loaded.reason,
      ...(loaded.detail ? { detail: loaded.detail } : {}),
    };
  }
  // Bound controls show their store's current value, not the text cached at save.
  const pkg = refreshBoundContent(loaded.package);
  const main = pkg.parts.get(pkg.mainDocumentPart);
  if (!main) {
    return {
      ok: false,
      reason: 'no-main-document-tree',
      detail: pkg.mainDocumentPart,
    };
  }

  const store = new TreePackageStore(
    pkg,
    materializeGlossaryPlaceholders(pkg, normalizeParagraphIdentity(main))
  );
  return { ok: true, view: headlessViewOfStore(store) };
}

/** Internal live read view over the canonical store, preserving node identities for field pagination. */
export function headlessViewOfStore(store: TreePackageStore): HeadlessDocumentView {
  const currentPackage = (): OoxmlPackage => store.currentPackage();
  const mainPart = (): OoxmlPart => store.bodyStore().part;
  const rootOf = (relationshipType: string, fallbackName: string): OoxmlElement | null =>
    relatedPart(currentPackage(), currentPackage().mainDocumentPart, relationshipType, fallbackName)
      ?.root ?? null;

  let themeFonts: HeadlessThemeFonts = Object.freeze(collectThemeSchemeFaces(null));
  let themeFontsPackage: OoxmlPackage | null = null;
  let properties: DocumentProperties = EMPTY_DOCUMENT_PROPERTIES;
  let propertiesPackage: OoxmlPackage | null = null;

  const view: HeadlessDocumentView = Object.freeze({
    part: mainPart,
    currentPackage,
    packageRevision: () => store.packageRevision,
    stylesRoot: () => rootOf(REL.styles, '/word/styles.xml'),
    numberingRoot: () => rootOf(REL.numbering, '/word/numbering.xml'),
    settingsRoot: () => rootOf(REL.settings, '/word/settings.xml'),
    documentThemeFonts() {
      const pkg = currentPackage();
      if (themeFontsPackage !== pkg) {
        themeFonts = Object.freeze(
          collectThemeSchemeFaces(
            rootOf(REL.theme, '/word/theme/theme1.xml'),
            rootOf(REL.settings, '/word/settings.xml'),
            rootOf(REL.fontTable, '/word/fontTable.xml')
          )
        );
        themeFontsPackage = pkg;
      }
      return themeFonts;
    },
    documentProperties() {
      const pkg = currentPackage();
      if (propertiesPackage !== pkg) {
        const core = relatedPart(pkg, '/', REL.coreProperties, '/docProps/core.xml');
        const app = relatedPart(pkg, '/', REL.extendedProperties, '/docProps/app.xml');
        properties = readDocumentProperties(core?.root ?? null, app?.root ?? null);
        propertiesPackage = pkg;
      }
      return properties;
    },
    headerFooterPartsBySection: () => resolveHeaderFooterPartsBySection(currentPackage()),
    headerFooterResolutionBySection: () => resolveHeaderFooterResolutionBySection(currentPackage()),
    relationshipTarget: (relationshipId: string) =>
      relationshipTargetIn(currentPackage(), mainPart().name, relationshipId),
  });
  return view;
}
