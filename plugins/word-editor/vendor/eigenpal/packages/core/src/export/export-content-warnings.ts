import { unsupportedStyleSeparator } from './style-separator-warnings.ts';
import { stylesPartOf } from '../store/package/ooxml-indexes.ts';
// Source diagnostics for content that never reaches a semantic layout record.
import {
  resolveNotesPart,
  type HeadlessDocumentView,
  type OoxmlNode,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import {
  emptyNamespaceScope,
  namespaceScopeForNode,
  isMcAlternateContent,
  resolveRunLevelMcAtom,
  projectRunLevelMcDrawing,
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  DEFAULT_SUPPORTED_MC_REQUIRES,
  selectedRunLevelMcBranch,
  MAX_PART_SCAN_ELEMENTS,
} from '../store/package/drawing-projection.ts';
import { MAX_XML_DEPTH } from '../store/package/ooxml-drawing-rules.ts';
import { isLegacyVmlAtom, projectLegacyVml } from '../store/package/legacy-vml-projection.ts';

/** Source content that cannot be certified by the layout snapshot. @public */
export interface ExportContentWarning {
  /** Content outside a supported layout subset stays preserved in the DOCX. */
  readonly code: 'legacy-textbox' | 'legacy-drawing' | 'scan-limit' | 'unsupported-style-separator';
  /** Package part containing the content, or where the bounded scan stopped. */
  readonly partName: string;
}

const cache = new WeakMap<
  OoxmlNode,
  { stylesPart: OoxmlPart | undefined; codes: readonly ExportContentWarning['code'][] }
>();
const legacyGraphics = new Set([
  'shape',
  'rect',
  'roundrect',
  'oval',
  'line',
  'group',
  'arc',
  'curve',
  'polyline',
  'image',
]);

function inspectPart(
  part: OoxmlPart,
  stylesPart?: OoxmlPart
): readonly ExportContentWarning['code'][] {
  const cached = cache.get(part.root);
  if (cached && cached.stylesPart === stylesPart) return cached.codes;
  const codes = new Set<ExportContentWarning['code']>();
  const stack = [
    {
      node: part.root as OoxmlNode,
      scope: emptyNamespaceScope(),
      depth: 0,
      mcSelected: false,
    },
  ];
  let visited = 0;
  while (stack.length) {
    const { node, scope: inherited, depth, mcSelected } = stack.pop()!;
    if (++visited > MAX_PART_SCAN_ELEMENTS || depth > MAX_XML_DEPTH) {
      codes.add('scan-limit');
      break;
    }
    if (node.kind === 'textValue') continue;
    if (visited + stack.length + node.children.length > MAX_PART_SCAN_ELEMENTS) {
      codes.add('scan-limit');
      break;
    }
    const scope = namespaceScopeForNode(inherited, node);
    // A selected modern drawing supersedes its legacy fallback. Do not warn about dead copies.
    const alternateContent = isMcAlternateContent(node) ? node : undefined;
    if (alternateContent) {
      if (resolveRunLevelMcAtom(alternateContent, scope).drawing) continue;
      const projection = projectRunLevelMcDrawing(alternateContent, {
        ownerPartName: part.name,
        namespaceScope: scope,
        supportedMcRequires: DEFAULT_SUPPORTED_MC_REQUIRES,
        limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
      });
      if (projection) {
        // The selected legacy drawing or recovered placeholder has a layout record.
        // Page-level diagnostics report that occurrence with its location.
        const story = projection.textboxStory?.content;
        if (story) stack.push({ node: story, scope, depth: depth + 1, mcSelected: false });
        continue;
      }
      const selected = selectedRunLevelMcBranch(alternateContent, scope);
      if (selected.refused) codes.add('scan-limit');
      if (selected.branch)
        stack.push({ node: selected.branch, scope, depth: depth + 1, mcSelected: true });
      continue;
    }
    // Supported legacy atoms produce drawing records and are diagnosed by the exporter.
    // Unprojected MC branches retain source diagnostics for their legacy content.
    if (!mcSelected && isLegacyVmlAtom(node)) {
      // A laid-out text box story is scanned like a modern one: content it drops still warns.
      const story = projectLegacyVml(node, part.name)?.textboxStory?.content;
      if (story) stack.push({ node: story, scope, depth: depth + 1, mcSelected });
      continue;
    }
    if (node.namespaceUri === 'urn:schemas-microsoft-com:vml' && node.localName === 'textbox') {
      codes.add('legacy-textbox');
      continue;
    }
    if (
      node.namespaceUri === 'urn:schemas-microsoft-com:vml' &&
      legacyGraphics.has(node.localName) &&
      !node.children.some(
        (child) =>
          child.kind !== 'textValue' &&
          child.namespaceUri === 'urn:schemas-microsoft-com:vml' &&
          child.localName === 'textbox'
      )
    ) {
      codes.add('legacy-drawing');
    }
    for (const child of node.children)
      stack.push({ node: child, scope, depth: depth + 1, mcSelected });
  }
  const result = Object.freeze([...codes]);
  cache.set(part.root, { stylesPart, codes: result });
  return result;
}

/** @internal */
export function collectExportContentWarnings(
  view: HeadlessDocumentView
): readonly ExportContentWarning[] {
  const parts = new Set([view.part()]);
  for (const section of view.headerFooterPartsBySection()) {
    for (const slots of [section.headers, section.footers]) {
      for (const part of slots.values()) parts.add(part);
    }
  }
  for (const kind of ['footnote', 'endnote'] as const) {
    const part = resolveNotesPart(view.currentPackage(), kind);
    if (part) parts.add(part);
  }
  return Object.freeze(
    [...parts].flatMap((part) =>
      [
        ...inspectPart(part, stylesPartOf(view.currentPackage())),
        ...(unsupportedStyleSeparator(view, part) ? ['unsupported-style-separator' as const] : []),
      ].map((code) => Object.freeze({ code, partName: part.name }))
    )
  );
}
