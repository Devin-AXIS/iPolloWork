// Add one style definition to the styles part as a package edit, creating the part when the
// document has none. The edit is a no-op when a style with the same id already exists, so a
// commit that races another participant's definition keeps the first one.

import { readOoxmlPart, type OoxmlElement } from './ooxml-tree.ts';
import { withPart, type OoxmlPackage } from './ooxml-package.ts';
import { WML_NAMESPACE_URI } from './ooxml-shared.ts';
import { stylesPartOf } from './ooxml-indexes.ts';
import { createNodeIdAllocator, insertChildren } from './ooxml-edit.ts';
import { withNewPart, withRelationship, withRelationshipsPartFor } from './package-edit.ts';
import { propertyElement } from '../store/tree-op-properties.ts';

const STYLES_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml';
const STYLES_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

/** Builds WordprocessingML elements with ids from the target part. */
export type StyleElementFactory = (
  localName: string,
  attributes?: Record<string, string>,
  children?: readonly OoxmlElement[]
) => OoxmlElement;

type PackageEdit = (pkg: OoxmlPackage) => OoxmlPackage;
const setupEdits = new WeakSet<PackageEdit>();

/**
 * Mark a package edit as document setup: a definition that content may come to depend on,
 * such as a built-in style. A collaboration session commits setup on its own, outside shared
 * undo, so undoing the edit that first needed it cannot take it from content added since.
 */
export function markDocumentSetupEdit<T extends PackageEdit>(edit: T): T {
  setupEdits.add(edit);
  return edit;
}

/** Whether `edit` is document setup (see `markDocumentSetupEdit`). */
export function isDocumentSetupEdit(edit: PackageEdit): boolean {
  return setupEdits.has(edit);
}

/** Attribute value of a `w:` attribute on an element, or undefined. */
export function attributeOf(node: OoxmlElement, localName: string): string | undefined {
  return node.attributes.find((a) => a.localName === localName)?.value;
}

/** The style elements of a styles part root. */
export function styleElementsOf(root: OoxmlElement): OoxmlElement[] {
  const styles: OoxmlElement[] = [];
  for (const node of root.children) {
    if (node.kind !== 'textValue' && node.localName === 'style') styles.push(node);
  }
  return styles;
}

/** The `w:styleId` of the default style of one type in a styles root, or null. */
export function defaultStyleIdOf(root: OoxmlElement, type: string): string | null {
  for (const style of styleElementsOf(root)) {
    if (attributeOf(style, 'type') !== type) continue;
    const isDefault = attributeOf(style, 'default');
    if (isDefault === '1' || isDefault === 'true' || isDefault === 'on') {
      return attributeOf(style, 'styleId') ?? null;
    }
  }
  return null;
}

/**
 * A package edit that appends one `w:style`, built by `build`, unless the styles part already
 * holds a style with `styleId`. `build` receives the styles root (empty when the part is new)
 * and an element factory bound to the part's node ids.
 */
export function ensureStyleDefinition(
  styleId: string,
  build: (factory: StyleElementFactory, stylesRoot: OoxmlElement) => OoxmlElement
): (pkg: OoxmlPackage) => OoxmlPackage {
  return markDocumentSetupEdit((pkg) => {
    const existing = stylesPartOf(pkg);
    const name = existing?.name ?? '/word/styles.xml';
    const parsed = existing
      ? null
      : readOoxmlPart(`<w:styles xmlns:w="${WML_NAMESPACE_URI}"/>`, {
          name,
          contentType: STYLES_CONTENT_TYPE,
        });
    const part = existing ?? (parsed?.ok ? parsed.part : null);
    if (!part) throw new Error(`Cannot create style ${styleId}`);
    if (styleElementsOf(part.root).some((style) => attributeOf(style, 'styleId') === styleId)) {
      return pkg;
    }
    const nextId = createNodeIdAllocator(part);
    const factory: StyleElementFactory = (localName, attributes = {}, children = []) =>
      ({
        ...(propertyElement({ localName, attributes }, nextId()) as OoxmlElement),
        children,
        ...(localName === 'pPr' ? { kind: 'paragraphProperties' } : {}),
        ...(localName === 'rPr' ? { kind: 'runProperties' } : {}),
      }) as OoxmlElement;
    // Keep the inserted subtree valid even when the source uses another XML prefix.
    const style = {
      ...build(factory, part.root),
      namespaceBindings: [{ prefix: 'w', namespaceUri: WML_NAMESPACE_URI }],
    };
    if (existing) {
      const inserted = insertChildren(part, part.root.id, part.root.children.length, [style]);
      if (!inserted.ok) throw new Error(`Cannot insert style ${styleId}`);
      return withPart(pkg, inserted.part);
    }
    let next = withNewPart(
      pkg,
      name,
      { ...part.root, children: [style] } as OoxmlElement,
      STYLES_CONTENT_TYPE
    );
    next = withRelationshipsPartFor(next, pkg.mainDocumentPart);
    const related = withRelationship(next, pkg.mainDocumentPart, STYLES_RELATIONSHIP, name);
    if (!related.ok) throw new Error(`Cannot link style ${styleId}`);
    return related.pkg;
  });
}
