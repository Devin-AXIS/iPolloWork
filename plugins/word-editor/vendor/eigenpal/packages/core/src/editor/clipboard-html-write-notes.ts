// Footnote/endnote emission for the outbound clipboard HTML — split from
// clipboard-html-write.ts at the max-lines cap. The block renderer is injected, so
// the runtime dependency stays one-way.

import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
} from '../store/package/ooxml-tree.ts';
import { relationshipsOf } from '../store/package/package-edit.ts';
import { attributeValueOf } from '../store/store/tree-op-nodes.ts';
import { isElement } from './clipboard-html-write-tree.ts';
import { runPropertyLayers, runToggleOn } from './clipboard-html-write-cascade.ts';
import { renderedTableCellContexts } from './clipboard-html-write-table.ts';
import type { FieldState, RenderContext } from './clipboard-html-write.ts';

export type WordNoteKind = 'footnote' | 'endnote';

/** One id parser for every site, so the cap cannot drift: a collected id the
 *  renderer would refuse would leave a dead anchor in the copied HTML. The store
 *  legitimately allocates ids up to int32 (striped collab ids), so the cap matches
 *  its NOTE_ID_MAX. Leading zeros are legal ST_DecimalNumber lexical forms;
 *  parseInt normalizes them so references and definitions agree on ONE spelling. */
function wmlNoteIdOf(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d{1,10}$/.test(raw)) return null;
  const id = Number.parseInt(raw, 10);
  return id >= 1 && id <= 0x7fffffff ? id : null;
}

/** Separator bodies are furniture, never citable content — the fragment lane
 *  skips them too, whatever id they carry. */
function isSeparatorNote(child: OoxmlElement): boolean {
  const type = attributeValueOf(child, 'type', WML_NAMESPACE_URI);
  return type === 'separator' || type === 'continuationSeparator';
}

/** The note ids a notes part actually defines. */
export function noteIdsOf(root: OoxmlElement | null, kind: WordNoteKind): ReadonlySet<number> {
  const ids = new Set<number>();
  if (root === null) return ids;
  for (const child of root.children) {
    if (!isElement(child) || child.namespaceUri !== WML_NAMESPACE_URI) continue;
    if (child.localName !== kind || isSeparatorNote(child)) continue;
    const id = wmlNoteIdOf(attributeValueOf(child, 'id', WML_NAMESPACE_URI));
    if (id !== null) ids.add(id);
  }
  return ids;
}

type AdvanceFieldState = (node: OoxmlElement, fields: FieldState) => void;

/** Collect the citations the renderer would actually EMIT: content it suppresses
 *  (tracked deletions, complex-field instruction regions, vanished runs) must not
 *  ship a note body, or an anchor-less definition div pastes back as visible body
 *  text. Vanish resolves through the SAME cascade `renderRun` uses, so a
 *  style-hidden citation is suppressed too. */
function collectNoteReferences(
  ctx: RenderContext,
  node: OoxmlElement,
  out: Array<{ readonly kind: WordNoteKind; readonly id: number }>,
  field: FieldState,
  advance: AdvanceFieldState,
  pPr: OoxmlElement | null,
  tableCells?: ReadonlyMap<OoxmlElement, RenderContext>
): void {
  for (const child of node.children) {
    if (!isElement(child)) continue;
    // The renderer hands drawings to renderDrawing (an <img> only): a citation
    // inside a textbox never emits an anchor, so it must not ship a body either —
    // the same skip advanceFieldState applies.
    if (child.kind === 'drawing') continue;
    // Deleted content never renders, but its fldChars still drive the state.
    if (child.kind === 'revisionDelete' || child.kind === 'revisionMoveFrom') {
      if (!field.inert) advance(child, field);
      continue;
    }
    if (child.kind === 'table') {
      collectNoteReferences(
        ctx,
        child,
        out,
        field,
        advance,
        pPr,
        renderedTableCellContexts(ctx, child)
      );
      continue;
    }
    if (
      child.kind === 'tableCell' ||
      (child.namespaceUri === WML_NAMESPACE_URI && child.localName === 'tc')
    ) {
      const cellCtx = tableCells?.get(child);
      if (cellCtx === undefined) {
        if (!field.inert) advance(child, field);
        continue;
      }
      collectNoteReferences(cellCtx, child, out, field, advance, pPr, tableCells);
      continue;
    }
    if (child.kind === 'paragraph') {
      const pPrNode = child.children.find((inner) => inner.kind === 'paragraphProperties');
      collectNoteReferences(
        ctx,
        child,
        out,
        field,
        advance,
        pPrNode && isElement(pPrNode) ? pPrNode : null,
        tableCells
      );
      continue;
    }
    if (child.kind === 'run') {
      if (child.children.some((inner) => inner.kind === 'fldChar')) {
        if (!field.inert) advance(child, field);
        continue;
      }
      if (child.children.some((inner) => inner.kind === 'instrText')) continue;
      if (!field.inert && field.stack.some((mode) => mode === 'instr')) continue;
      const rPr = child.children.find((inner) => inner.kind === 'runProperties');
      const layers = runPropertyLayers(
        ctx.styles,
        pPr,
        rPr && isElement(rPr) ? rPr : null,
        ctx.tableRPr
      );
      if (runToggleOn(layers, 'vanish')) continue;
    }
    if (
      child.namespaceUri === WML_NAMESPACE_URI &&
      (child.localName === 'footnoteReference' || child.localName === 'endnoteReference')
    ) {
      const id = wmlNoteIdOf(attributeValueOf(child, 'id', WML_NAMESPACE_URI));
      if (id !== null) {
        out.push({
          kind: child.localName === 'footnoteReference' ? 'footnote' : 'endnote',
          id,
        });
      }
      continue;
    }
    collectNoteReferences(ctx, child, out, field, advance, pPr, tableCells);
  }
}

function noteElementOf(
  root: OoxmlElement | null,
  kind: WordNoteKind,
  id: number
): OoxmlElement | null {
  if (root === null) return null;
  for (const child of root.children) {
    if (!isElement(child) || child.namespaceUri !== WML_NAMESPACE_URI) continue;
    if (child.localName !== kind || isSeparatorNote(child)) continue;
    // Numeric compare, like every other id read here: 'w:id="07"' defines note 7.
    if (wmlNoteIdOf(attributeValueOf(child, 'id', WML_NAMESPACE_URI)) === id) return child;
  }
  return null;
}

/**
 * The notes to ship: everything the body referenced (an ordinal exists) plus the
 * CLOSURE over cross-note references, so a note cited only from another note's
 * body still ships its definition instead of leaving a dead anchor.
 */
export function shippedNoteIds(
  ctx: RenderContext,
  roots: Record<WordNoteKind, OoxmlElement | null>,
  advance: AdvanceFieldState
): Record<WordNoteKind, Set<number>> {
  const shipped: Record<WordNoteKind, Set<number>> = {
    footnote: new Set(ctx.noteOrdinals.footnote.keys()),
    endnote: new Set(ctx.noteOrdinals.endnote.keys()),
  };
  const queue: Array<{ kind: WordNoteKind; id: number }> = [];
  for (const kind of ['footnote', 'endnote'] as const) {
    for (const id of shipped[kind]) queue.push({ kind, id });
  }
  while (queue.length > 0) {
    const current = queue.pop()!;
    const element = noteElementOf(roots[current.kind], current.kind, current.id);
    if (element === null) continue;
    // The same balance probe renderNoteList's block render runs: an unbalanced
    // note body disarms the field machinery, so its citations DO render there.
    const probe: FieldState = { stack: [], inert: false };
    advance(element, probe);
    const field: FieldState = { stack: [], inert: probe.stack.length > 0 };
    const references: Array<{ readonly kind: WordNoteKind; readonly id: number }> = [];
    collectNoteReferences(ctx, element, references, field, advance, null);
    for (const reference of references) {
      if (!ctx.availableNotes[reference.kind].has(reference.id)) continue;
      if (shipped[reference.kind].has(reference.id)) continue;
      shipped[reference.kind].add(reference.id);
      queue.push(reference);
    }
  }
  return shipped;
}

export function renderNoteList(
  ctx: RenderContext,
  kind: WordNoteKind,
  root: OoxmlElement | null,
  shipped: ReadonlySet<number>,
  renderBlocks: (ctx: RenderContext, children: readonly OoxmlNode[]) => string
): string {
  if (root === null) return '';
  let ownerPart = `/word/${kind}s.xml`;
  for (const [name, part] of ctx.pkg.parts) {
    if (part.root === root) ownerPart = name;
  }
  const noteRels = relationshipsOf(ctx.pkg, ownerPart);
  let notes = '';
  for (const child of root.children) {
    if (!isElement(child) || child.namespaceUri !== WML_NAMESPACE_URI) continue;
    if (child.localName !== kind || isSeparatorNote(child)) continue;
    const id = attributeValueOf(child, 'id', WML_NAMESPACE_URI);
    const idValue = wmlNoteIdOf(id);
    if (id === undefined || idValue === null) continue;
    // Only notes an emitted reference reaches (directly from the body, or through
    // the cross-note closure) — a note referenced solely inside a tracked deletion
    // must not ship a body the read lane would materialize as visible text.
    if (!shipped.has(idValue)) continue;
    const inner = renderBlocks(
      { ...ctx, noteBody: { kind, id: idValue }, docRels: noteRels },
      child.children
    );
    // A shipped id always gets its definition div — its anchor is already in the
    // body, and a dead anchor would paste back as literal text. An empty body
    // renders as an empty paragraph.
    notes += `<div style="mso-element:${kind}" id="${kind === 'footnote' ? 'ftn' : 'edn'}${idValue}">${
      inner === '' ? '<p></p>' : inner
    }</div>`;
  }
  return notes === '' ? '' : `<div style="mso-element:${kind}-list">${notes}</div>`;
}
