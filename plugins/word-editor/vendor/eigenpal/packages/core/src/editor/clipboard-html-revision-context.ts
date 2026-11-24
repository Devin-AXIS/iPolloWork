// The external-HTML walk's revision state: which `<ins>` / `<del>` and formatting revisions
// are open around the content, and the paragraph mark and property revisions each
// paragraph collects. The parsing lives in `clipboard-html-revisions.ts`.

import type { ClipboardNoteKind } from './clipboard-html-notes.ts';
import type { FlowContext, Projection } from './clipboard-html-projection.ts';
import {
  numberHtmlRevisionIds,
  originalStyleOf,
  paragraphPropertyChangeXml,
  propertyChangeOf,
  runPropertyChangeXml,
  withoutPropertyChange,
  type HtmlRevision,
} from './clipboard-html-revisions.ts';
import { pPrXml, rPrXml } from './clipboard-html-run-xml.ts';
import { applyParaCss, applyRunCss, type HtmlParaProps } from './clipboard-html-styles.ts';

const NO_STYLE: ReadonlyMap<string, string> = new Map();

/**
 * The context an inline element hands its children: `revision` opened, and the element's
 * formatting revision (or the one around it) written onto the run properties.
 */
export function revisionContextOf(
  ctx: FlowContext,
  element: Element,
  style: ReadonlyMap<string, string>,
  revision: HtmlRevision | null
): FlowContext {
  const runChange = propertyChangeOf(style) ?? ctx.runChange;
  const originalRunStyle = originalStyleOf(element, ctx.originalRunStyle);
  if (revision === null && runChange === undefined && originalRunStyle === undefined) return ctx;
  let run = ctx.run;
  if (runChange !== undefined) {
    // The previous properties are the current ones with each `!msorm` value put back.
    const current = withoutPropertyChange(run);
    const original = applyRunCss(current, originalRunStyle ?? NO_STYLE);
    run = { ...current, changeXml: runPropertyChangeXml(runChange, rPrXml(original)) };
  }
  return {
    ...ctx,
    run,
    ...(revision === null ? {} : { revisions: [...(ctx.revisions ?? []), revision] }),
    ...(runChange === undefined ? {} : { runChange }),
    ...(originalRunStyle === undefined ? {} : { originalRunStyle }),
  };
}

/** Record a paragraph's tracked property change (`mso-prop-change` on the block itself). */
export function applyParagraphPropertyChange(
  para: HtmlParaProps,
  element: Element,
  style: ReadonlyMap<string, string>
): void {
  const change = propertyChangeOf(style);
  if (change === null) return;
  const original: HtmlParaProps = { ...para };
  applyParaCss(original, originalStyleOf(element, undefined) ?? NO_STYLE);
  para.changeXml = paragraphPropertyChangeXml(change, pPrXml(original));
}

/** The paragraph's properties with the mark revision its `<o:p>` recorded, taken once. */
export function withMarkRevision(para: HtmlParaProps, p: Projection): HtmlParaProps {
  const mark = p.markRevision;
  p.markRevisionTaken = mark !== null;
  if (mark === null) return para;
  p.markRevision = null;
  return { ...para, markRevisionXml: mark };
}

/** Number every revision in the projected body and note blocks. */
export function numberProjectedRevisionIds(
  blocks: string[],
  notes: Record<ClipboardNoteKind, Map<number, readonly string[]>>
): void {
  const lists: string[][] = [blocks];
  const noteLists: { kind: ClipboardNoteKind; id: number; blocks: string[] }[] = [];
  for (const kind of ['footnote', 'endnote'] as const) {
    for (const [id, noteBlocks] of notes[kind]) {
      const copy = [...noteBlocks];
      noteLists.push({ kind, id, blocks: copy });
      lists.push(copy);
    }
  }
  numberHtmlRevisionIds(lists);
  for (const note of noteLists) notes[note.kind].set(note.id, note.blocks);
}
