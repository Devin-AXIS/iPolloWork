// Unreachable-note reconcile for the external-HTML projection — split from
// clipboard-html-read.ts at the max-lines cap. The rel allocator is injected, so
// the runtime dependency stays one-way.

import { stripNoteMarks, type ClipboardNoteKind } from './clipboard-html-notes.ts';
import type { Projection } from './clipboard-html-projection.ts';

/**
 * Reconcile: a claimed note is kept only when REACHABLE from the body through
 * kept notes' cross-references (a mutual-citation island must not hide from the
 * lossless fallback). Unreachable notes materialize back into `blocks` as body
 * text; their note-scoped rels re-home onto document rels, and every citation of
 * a moved id strips (with the visible-text fallback) so no reference dangles.
 */
export function reconcileUnreachableNotes(
  projection: Projection,
  definedNotes: Record<ClipboardNoteKind, Set<number>>,
  blocks: string[],
  allocateRel: (p: Projection, type: string, target: string, external: boolean) => string
): void {
  const movedNotes = new Set<string>();
  const reachableNotes: Record<ClipboardNoteKind, Set<number>> = {
    footnote: new Set(),
    endnote: new Set(),
  };
  const computeReachable = (): void => {
    reachableNotes.footnote.clear();
    reachableNotes.endnote.clear();
    const queue: Array<{ kind: ClipboardNoteKind; id: number }> = [];
    const reach = (kind: ClipboardNoteKind, id: number): void => {
      if (movedNotes.has(`${kind}:${id}`)) return;
      if (!projection.notes[kind].has(id) || reachableNotes[kind].has(id)) return;
      reachableNotes[kind].add(id);
      queue.push({ kind, id });
    };
    for (const kind of ['footnote', 'endnote'] as const) {
      for (const id of projection.bodyNoteRefs[kind]) reach(kind, id);
    }
    // A moved note's blocks live in the body, so its citations seed too.
    for (const key of movedNotes) {
      for (const edge of projection.noteNoteRefs.get(key) ?? []) reach(edge.kind, edge.id);
    }
    while (queue.length > 0) {
      const current = queue.pop()!;
      for (const edge of projection.noteNoteRefs.get(`${current.kind}:${current.id}`) ?? []) {
        reach(edge.kind, edge.id);
      }
    }
  };
  // Move ONE unreachable note at a time and recompute: moving it turns its own
  // citations into body references that keep their targets as real notes.
  for (;;) {
    computeReachable();
    let movedOne = false;
    for (const kind of ['footnote', 'endnote'] as const) {
      for (const id of projection.notes[kind].keys()) {
        const key = `${kind}:${id}`;
        if (reachableNotes[kind].has(id) || movedNotes.has(key)) continue;
        movedNotes.add(key);
        movedOne = true;
        break;
      }
      if (movedOne) break;
    }
    if (!movedOne) break;
  }
  // A moved note's definition no longer exists, so any citation of a moved id
  // (in kept notes or other moved blocks) strips too, or a reference dangles.
  if (movedNotes.size > 0) {
    for (const keptKind of ['footnote', 'endnote'] as const) {
      for (const [keptId, keptBlocks] of projection.notes[keptKind]) {
        if (movedNotes.has(`${keptKind}:${keptId}`)) continue;
        projection.notes[keptKind].set(
          keptId,
          keptBlocks.map((block) => stripNoteMarks(block, movedNotes, projection.noteMarkFallbacks))
        );
      }
    }
  }
  for (const kind of ['footnote', 'endnote'] as const) {
    for (const [id, noteBlocks] of [...projection.notes[kind]]) {
      if (!movedNotes.has(`${kind}:${id}`)) continue;
      projection.notes[kind].delete(id);
      definedNotes[kind].delete(id);
      const relIdMap = new Map<string, string>();
      for (const block of noteBlocks) {
        // Drop the note's own number mark; it has no meaning in body flow. The
        // patterns only ever match XML this projection just emitted.
        const moved = stripNoteMarks(
          block
            // Tempered so the optional rPr scan can never cross a run boundary.
            .replace(
              /<w:r>(?:<w:rPr>(?:(?!<\/w:r>)[\s\S])*?<\/w:rPr>)?<w:(?:footnote|endnote)Ref\/><\/w:r>/g,
              ''
            ),
          movedNotes,
          projection.noteMarkFallbacks
        ).replace(/ r:(id|embed)="([^"]{1,32})"/g, (whole, attribute: string, oldId: string) => {
          let mapped = relIdMap.get(oldId);
          if (mapped === undefined) {
            const source = projection.noteRels[kind].find((rel) => rel.id === oldId);
            if (source === undefined) return whole;
            mapped = allocateRel(projection, source.type, source.target, source.external);
            relIdMap.set(oldId, mapped);
          }
          return ` r:${attribute}="${mapped}"`;
        });
        blocks.push(moved);
        // The final paragraph changed: the coverage flag must describe IT.
        projection.lastMarkCovered = false;
      }
    }
  }
}
