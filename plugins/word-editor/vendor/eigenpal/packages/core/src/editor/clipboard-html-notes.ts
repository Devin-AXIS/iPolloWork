import { parseInlineStyle } from './clipboard-html-styles.ts';

export type ClipboardNoteKind = 'footnote' | 'endnote';

export interface ClipboardNoteDefinition {
  readonly kind: ClipboardNoteKind;
  readonly id: number;
  readonly element: Element;
}

const NOTE_ID = /^(ftn|edn)([1-9]\d{0,9})$/i;
const NOTE_PREFIX: Readonly<Record<ClipboardNoteKind, string>> = {
  footnote: 'ftn',
  endnote: 'edn',
};

/** An id token counts only when its prefix matches the note kind: `ftn` ids never
 *  alias endnotes and vice versa. The cap matches the store's NOTE_ID_MAX (int32),
 *  which striped collab ids can reach. */
function noteIdOf(raw: string | null, kind: ClipboardNoteKind): number | null {
  const match = raw === null ? null : NOTE_ID.exec(raw);
  if (!match || match[1]!.toLowerCase() !== NOTE_PREFIX[kind]) return null;
  const id = Number.parseInt(match[2]!, 10);
  return id <= 0x7fffffff ? id : null;
}

export function clipboardNoteReference(
  style: ReadonlyMap<string, string>
): { readonly kind: ClipboardNoteKind; readonly id: number } | null {
  for (const kind of ['footnote', 'endnote'] as const) {
    const raw = style.get(`mso-${kind}-id`);
    const id = noteIdOf(raw ?? null, kind);
    if (id !== null) return { kind, id };
  }
  return null;
}

/** The note definition an element declares via `mso-element` plus a `ftnN`/`ednN` id. */
export function clipboardNoteDefinitionRef(
  element: Element,
  style: ReadonlyMap<string, string>
): { readonly kind: ClipboardNoteKind; readonly id: number } | null {
  const msoElement = style.get('mso-element')?.trim().toLowerCase();
  if (msoElement !== 'footnote' && msoElement !== 'endnote') return null;
  const id = noteIdOf(element.getAttribute('id'), msoElement);
  return id === null ? null : { kind: msoElement, id };
}

export function clipboardNoteDefinitions(doc: Document): readonly ClipboardNoteDefinition[] {
  const definitions: ClipboardNoteDefinition[] = [];
  const divs = doc.getElementsByTagName('div');
  // The cap only bounds the claim SCAN; the shared walk budget bounds projection
  // cost. It must comfortably exceed what the write lane ships, or a large
  // self round-trip degrades real notes into body text.
  for (let index = 0; index < divs.length && definitions.length < 2048; index += 1) {
    const element = divs[index]!;
    const ref = clipboardNoteDefinitionRef(element, parseInlineStyle(element));
    if (ref !== null) definitions.push({ ...ref, element });
  }
  return definitions;
}

/**
 * Ids referenced via `mso-<kind>-id` anchors, into `out`. A definition body's own
 * SELF back-link (target = the enclosing definition) must not count — an orphan
 * definition would be consumed into the notes part — but a CROSS-note reference
 * from inside another note's body does count, matching the write lane's closure.
 */
export function collectReferencedNoteIds(
  doc: Document,
  definitions: readonly ClipboardNoteDefinition[],
  out: Record<ClipboardNoteKind, Set<number>>
): void {
  const definitionByElement = new Map(definitions.map((note) => [note.element, note]));
  const enclosingDefinition = (element: Element): ClipboardNoteDefinition | null => {
    let current: Element | null = element.parentElement;
    for (let hops = 0; current !== null && hops < 128; hops += 1) {
      const definition = definitionByElement.get(current);
      if (definition !== undefined) return definition;
      current = current.parentElement;
    }
    return null;
  };
  const anchors = doc.getElementsByTagName('a');
  for (let index = 0; index < anchors.length && index < 20_000; index += 1) {
    const anchor = anchors[index]!;
    const reference = clipboardNoteReference(parseInlineStyle(anchor));
    if (reference === null) continue;
    const enclosing = enclosingDefinition(anchor);
    if (enclosing !== null && enclosing.kind === reference.kind && enclosing.id === reference.id) {
      continue;
    }
    out[reference.kind].add(reference.id);
  }
}

export function isClipboardNoteList(style: ReadonlyMap<string, string>): boolean {
  const value = style.get('mso-element')?.trim().toLowerCase();
  return value === 'footnote-list' || value === 'endnote-list';
}

const NOTE_MARK_RUN =
  /<w:r>(?:<w:rPr>(?:(?!<\/w:r>)[\s\S])*?<\/w:rPr>)?<w:(footnote|endnote)Reference w:id="(\d{1,10})"\/><\/w:r>/g;

/** Strip every projected note-reference run whose `kind:id` is in `keys`, in ONE
 *  linear scan — an alternation of thousands of marks scans near-quadratically.
 *  The pattern only matches XML the projection itself emitted (escapeXml escapes
 *  quotes, so run TEXT can never form the attribute shape). A stripped mark
 *  degrades to its `fallbacks` run (the anchor's visible '[1]') when one exists,
 *  so a dropped note loses its body, never its visible citation text. */
export function stripNoteMarks(
  block: string,
  keys: ReadonlySet<string>,
  fallbacks?: ReadonlyMap<string, string>
): string {
  return block.replace(NOTE_MARK_RUN, (whole, kind: string, id: string) => {
    const key = `${kind}:${id}`;
    if (!keys.has(key)) return whole;
    return fallbacks?.get(key) ?? '';
  });
}

export function clipboardNotesPartXml(
  kind: ClipboardNoteKind,
  notes: ReadonlyMap<number, readonly string[]>
): string {
  let inner = '';
  for (const [id, blocks] of notes) {
    inner += `<w:${kind} w:id="${id}">${blocks.join('')}</w:${kind}>`;
  }
  // Note bodies can carry projected `w:drawing` runs and equations, so the part
  // declares the same namespaces as the document part.
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:${kind}s xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
    'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">' +
    `${inner}</w:${kind}s>`
  );
}
