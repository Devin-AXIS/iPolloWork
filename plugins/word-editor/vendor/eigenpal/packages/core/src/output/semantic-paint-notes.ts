// Paint footnote/endnote areas onto a page sheet.
//
// Notes are ordinary editable stories (not `[data-docx-hf]` furniture). Separators are
// non-selectable. DOM is built with createElement / textContent only — no file-derived
// markup strings.

import type {
  NoteAreaRecord,
  PageRecord,
  ParagraphFragmentRecord,
  TableFragmentRecord,
} from '../layout/semantic-records.ts';

/** Minimal paint context (scale) — shared shape with semantic-paint without a cycle. */
export interface NotePaintContext {
  readonly scale: number;
  readonly tabLeaderOriginXPt?: number;
  readonly fontAlias?: (family: string) => string | undefined;
}

export type NotePaintFragmentFn = (
  document: Document,
  fragment: ParagraphFragmentRecord,
  ctx: NotePaintContext
) => HTMLElement;

export type NotePaintTableFn = (
  document: Document,
  fragment: TableFragmentRecord,
  ctx: NotePaintContext
) => HTMLElement;

/**
 * Append footnote/endnote areas for one page into the sheet element.
 *
 * Kept in its own module so `semantic-paint.ts` stays under the max-lines gate.
 */
export function paintPageNoteAreas(
  document: Document,
  sheet: HTMLElement,
  page: PageRecord,
  options: NotePaintContext,
  paintFragment: NotePaintFragmentFn,
  paintTableFragment: NotePaintTableFn
): void {
  for (const area of [page.footnotes, page.endnotes] as const) {
    if (!area) continue;
    sheet.append(paintNoteArea(document, page, area, options, paintFragment, paintTableFragment));
  }
}

function paintNoteArea(
  document: Document,
  page: PageRecord,
  area: NoteAreaRecord,
  options: NotePaintContext,
  paintFragment: NotePaintFragmentFn,
  paintTableFragment: NotePaintTableFn
): HTMLElement {
  const areaEl = document.createElement('div');
  areaEl.className = 'docx-notes';
  areaEl.dataset.docxNotes = area.kind;
  areaEl.dataset.docxNotesPlacement = area.placement;
  areaEl.style.position = 'absolute';
  areaEl.style.left = `${(area.box.x - page.box.x) * options.scale}px`;
  areaEl.style.top = `${(area.box.y - page.box.y) * options.scale}px`;
  areaEl.style.width = `${area.box.width * options.scale}px`;
  areaEl.style.height = `${area.box.height * options.scale}px`;

  for (const separator of [area.separator, area.continuationNotice]) {
    if (!separator) continue;
    const sep = document.createElement('div');
    sep.className = 'docx-note-separator';
    sep.dataset.docxNoteSeparator = separator.kind;
    sep.setAttribute('contenteditable', 'false');
    sep.setAttribute('aria-hidden', 'true');
    sep.style.position = 'absolute';
    sep.style.left = `${(separator.box.x - area.box.x) * options.scale}px`;
    sep.style.top = `${(separator.box.y - area.box.y) * options.scale}px`;
    sep.style.width = `${separator.box.width * options.scale}px`;
    sep.style.height = `${separator.box.height * options.scale}px`;
    const ruleStyle = separator.ruleStyle;
    if (ruleStyle || separator.synthetic) {
      paintSeparatorRule(
        sep,
        document,
        ruleStyle ?? 'single',
        options.scale,
        separator.box.height,
        separator.ruleColor
      );
    } else {
      const separatorOptions = {
        ...options,
        tabLeaderOriginXPt: separator.box.x - page.box.x,
      };
      for (const fragment of separator.fragments) {
        sep.append(
          fragment.kind === 'table'
            ? paintTableFragment(document, fragment, separatorOptions)
            : paintFragment(document, fragment, separatorOptions)
        );
      }
    }
    areaEl.append(sep);
  }

  for (const note of area.notes) {
    const noteOptions = { ...options, tabLeaderOriginXPt: note.box.x - page.box.x };
    const noteEl = document.createElement('div');
    noteEl.className = 'docx-note';
    noteEl.dataset.docxNote = note.noteKind;
    noteEl.dataset.docxNoteId = String(note.noteId);
    noteEl.dataset.docxNoteScope = note.scopeId;
    if (note.mark !== null) noteEl.dataset.docxNoteMark = note.mark;
    if (note.continuation) noteEl.dataset.docxNoteContinuation = '';
    noteEl.setAttribute('role', 'doc-footnote');
    noteEl.style.position = 'absolute';
    noteEl.style.left = `${(note.box.x - area.box.x) * options.scale}px`;
    noteEl.style.top = `${(note.box.y - area.box.y) * options.scale}px`;
    noteEl.style.width = `${note.box.width * options.scale}px`;
    noteEl.style.height = `${note.box.height * options.scale}px`;
    for (const fragment of note.fragments) {
      noteEl.append(
        fragment.kind === 'table'
          ? paintTableFragment(document, fragment, noteOptions)
          : paintFragment(document, fragment, noteOptions)
      );
    }
    areaEl.append(noteEl);
  }
  return areaEl;
}

/**
 * Paint a layout-owned separator rule from {@link NoteAreaRecord.separator.ruleStyle}.
 *
 * Geometry (short width, single vs double) comes from the layout record — not a generic
 * CSS hairline inventing fixture content.
 */
function paintSeparatorRule(
  host: HTMLElement,
  document: Document,
  ruleStyle: 'single' | 'double',
  scale: number,
  heightPt: number,
  ruleColor?: string | null
): void {
  host.dataset.docxNoteRule = ruleStyle;
  const color = ruleColor && /^[a-f\d]{6}$/i.test(ruleColor) ? `#${ruleColor}` : '#000000';
  host.style.color = color;
  const stroke = Math.max(1, scale * 0.75);
  if (ruleStyle === 'single') {
    host.style.backgroundColor = color;
    host.style.height = `${heightPt * scale}px`;
    return;
  }
  // Double: two short rules stacked with a Word-like gap (layout box already sized).
  host.style.opacity = '0.85';
  const gap = Math.max(1, scale * 1.25);
  for (const top of [0, stroke + gap]) {
    const line = document.createElement('div');
    line.setAttribute('aria-hidden', 'true');
    line.style.position = 'absolute';
    line.style.left = '0';
    line.style.right = '0';
    line.style.top = `${top}px`;
    line.style.height = '0';
    line.style.borderTop = `${stroke}px solid currentColor`;
    host.append(line);
  }
}
