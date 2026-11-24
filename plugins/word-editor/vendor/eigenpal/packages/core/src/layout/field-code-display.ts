// View-only field instructions. Canonical ranges and field results remain unchanged.
import type { OoxmlNode, OoxmlProperty } from '@docx-editor.dev/core/store';
import {
  collectFieldRunChildren,
  fldSimpleInstr,
  isFldSimple,
  isFldChar,
  isInstrText,
  MAX_FIELD_INSTRUCTION_CHARS,
  MAX_FIELD_NESTING,
  parsedFieldSpansOf,
} from '../store/package/field-nodes.ts';
import { paragraphOffsetIndex } from '../store/store/tree-op-segments.ts';
import type { FieldAwarePiece } from './field-pieces.ts';
import { runPropertiesOf, type RunPropertyCascader } from './field-run-text.ts';
import { resolveRunStyle, type ThemeFonts } from './run-style.ts';
import {
  isRevisionWrapper,
  revisionAttributionOf,
  withRevision,
  revisionsVisible,
  type RevisionAttribution,
  type RevisionDisplayMode,
  type RevisionAuthorFilter,
} from './revision-projection.ts';

/** The source is inert text, including unknown instructions. Never evaluate it. */
function codeOf(nodes: readonly OoxmlNode[]): string | null {
  let text = '';
  const instruction: boolean[] = [];
  for (const node of nodes) {
    const visible = instruction.every(Boolean);
    if (isFldChar(node, 'begin')) {
      if (instruction.length >= MAX_FIELD_NESTING) return null;
      if (visible) text += '{';
      instruction.push(true);
    } else if (isFldChar(node, 'separate')) {
      if (instruction.length) instruction[instruction.length - 1] = false;
    } else if (isFldChar(node, 'end')) {
      instruction.pop();
      if (instruction.every(Boolean)) text += '}';
    } else if (visible && isFldSimple(node)) {
      text += `{${fldSimpleInstr(node) ?? ''}}`;
    } else if (visible && isInstrText(node) && node.kind !== 'textValue') {
      for (const child of node.children) if (child.kind === 'textValue') text += child.value;
    }
    if (text.length > MAX_FIELD_INSTRUCTION_CHARS) return null;
  }
  return text || null;
}

export function displayFieldCodes(
  paragraph: OoxmlNode,
  pieces: readonly FieldAwarePiece[],
  inherited: readonly OoxmlProperty[],
  cascade: RunPropertyCascader | undefined,
  fonts: ThemeFonts | undefined,
  mode: RevisionDisplayMode,
  filter?: RevisionAuthorFilter,
  ranges: readonly import('./field-code-toc.ts').FieldCodeRange[] = []
): FieldAwarePiece[] {
  if (paragraph.kind !== 'paragraph') return [...pieces];
  const fields = parsedFieldSpansOf(paragraph);
  if (fields.length === 0 && ranges.length === 0) return [...pieces];
  const entries: Parameters<typeof collectFieldRunChildren>[1] = [];
  if (!collectFieldRunChildren(paragraph, entries, { left: 4096 })) return [...pieces];
  const offsets = paragraphOffsetIndex(paragraph);
  const runs = new Map<string, OoxmlNode>();
  const attribution = new Map<string, readonly RevisionAttribution[]>();
  const walk = (
    node: OoxmlNode,
    revisions: readonly RevisionAttribution[],
    depth: number
  ): void => {
    if (node.kind === 'textValue' || depth > 64) return;
    const next = isRevisionWrapper(node)
      ? withRevision(revisions, revisionAttributionOf(node)!)
      : revisions;
    attribution.set(node.id, next);
    if (node.kind === 'run') runs.set(node.id, node);
    for (const child of node.children) walk(child, next, depth + 1);
  };
  walk(paragraph, [], 0);
  let result = [...pieces];
  for (const field of fields) {
    const ids = new Set(field.removeNodeIds);
    const nodes = entries
      .filter(
        (entry) =>
          ids.has(entry.node.id) &&
          revisionsVisible(attribution.get(entry.node.id) ?? [], mode, filter)
      )
      .map((entry) => entry.node);
    const code = codeOf(nodes);
    const begin = offsets.spanOf(field.node);
    if (!code || !begin) continue;
    let end = field.addressing === 'atomic' ? begin.start + 1 : begin.end;
    if (field.addressing !== 'atomic')
      for (const node of nodes) end = Math.max(end, offsets.spanOf(node)?.end ?? end);
    const donor = pieces.find(
      (piece) => piece.start >= begin.start && piece.end <= end && piece.fieldAtom
    );
    const revisions = attribution.get(field.node.id) ?? [];
    if (!revisionsVisible(revisions, mode, filter)) continue;
    const run = runs.get(field.formatRunIds[0] ?? field.runId);
    const props = donor?.props ?? (run ? runPropertiesOf(run, inherited, cascade) : inherited);
    const style = donor?.style ?? resolveRunStyle(props, fonts);
    if (style.hidden) continue;
    const replacement: FieldAwarePiece = {
      text: code,
      props,
      style,
      start: begin.start,
      end,
      projected: true,
      fieldAtom: { formField: false },
      ...(revisions.length ? { revisions } : {}),
    };
    result = result.filter(
      (piece) =>
        !(
          piece.start >= begin.start &&
          piece.end <= end &&
          (piece.end > piece.start || piece.fieldAtom)
        )
    );
    result.push(replacement);
  }
  for (const range of ranges) {
    result = result.filter((piece) => piece.end <= range.start || piece.start >= range.end);
    if (range.code) {
      const revisions = range.sourceNodeId ? (attribution.get(range.sourceNodeId) ?? []) : [];
      if (!revisionsVisible(revisions, mode, filter)) continue;
      const entry = entries.find((entry) => entry.node.id === range.sourceNodeId);
      const run = entry && runs.get(entry.runId);
      const props = run ? runPropertiesOf(run, inherited, cascade) : inherited;
      const style = resolveRunStyle(props, fonts);
      if (style.hidden) continue;
      result.push({
        text: range.code,
        props,
        style,
        ...(revisions.length ? { revisions } : {}),
        start: range.start,
        end: range.end,
        projected: true,
        fieldAtom: { formField: false },
      });
    }
  }
  return result.sort((a, b) => a.start - b.start);
}
