import { readOoxmlPackage } from '../store/package/ooxml-package.ts';
import {
  containsClipboardChart,
  containsClipboardObject,
  isClipboardChart,
  isClipboardObject,
} from '../store/store/clipboard-object-policy.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import type { OoxmlNode, OoxmlPart } from '../store/package/ooxml-tree.ts';
import { paragraphOffsetIndex } from '../store/store/tree-op-segments.ts';

/**
 * The engine's reason for a refused copy, cut or paste of content that holds a chart with other
 * content; one selected chart copies through `chart-clipboard.ts`. Adapters
 * translate it through `DISABLED_REASON_KEYS` in `@docx-editor.dev/i18n`, so the two sentences
 * must stay the same.
 */
export const CHART_CLIPBOARD_REASON =
  'a chart can be copied, cut or pasted only on its own, not with other content';

/**
 * Check canonical content, including unpainted atoms and stories outside the body, for an
 * embedded object or a chart (`isClipboardObject`). Pass `isClipboardChart` as `matches` to
 * ask about charts alone.
 */
export function selectionContainsClipboardObject(
  part: OoxmlPart,
  ranges: ReadonlyMap<string, { start: number; end: number }>,
  matches: (node: OoxmlNode) => boolean = isClipboardObject
): boolean {
  for (const [id, range] of ranges) {
    const node = findNode(part, id);
    if (!node) continue;
    if (node.kind === 'textValue') continue;
    if (node.kind === 'paragraph' && range && range.end > range.start) {
      const index = paragraphOffsetIndex(node);
      const children: OoxmlNode[] = [...node.children];
      while (children.length) {
        const child = children.pop()!;
        if (child.kind === 'textValue') continue;
        if (matches(child)) {
          const span = index.spanOf(child);
          // Opaque objects have no span; a whole-paragraph transfer must still refuse them.
          if (
            span
              ? span.end > range.start && span.start < range.end
              : range.start === 0 && range.end === Infinity
          )
            return true;
        }
        for (const inner of child.children) children.push(inner);
      }
    }
  }
  return false;
}

/** Whether the selection holds a chart, for the chart's own refusal reason. */
export function selectionContainsClipboardChart(
  part: OoxmlPart,
  ranges: ReadonlyMap<string, { start: number; end: number }>
): boolean {
  return selectionContainsClipboardObject(part, ranges, isClipboardChart);
}

/** Structural refusal also applies when the target supports only plain text. */
export function fragmentContainsClipboardObject(bytes: Uint8Array): boolean {
  return fragmentRefusalOf(bytes) !== null;
}

/** Why a fragment cannot paste: it holds a chart, another embedded object, or neither. */
export function fragmentRefusalOf(bytes: Uint8Array): 'chart' | 'object' | null {
  const read = readOoxmlPackage(bytes);
  if (!read.ok) return null;
  const roots = [...read.package.parts.values()].map((part) => part.root);
  if (containsClipboardChart(roots)) return 'chart';
  return containsClipboardObject(roots) ? 'object' : null;
}
