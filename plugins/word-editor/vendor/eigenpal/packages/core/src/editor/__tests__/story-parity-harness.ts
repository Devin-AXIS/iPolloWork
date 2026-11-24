// Mounting, caret placement and package diffing for the story-parity contract.
//
// Nothing here touches the DOM at module scope: each suite registers happy-dom itself, and
// these helpers only reach for `document` once a test calls them.

import type { StoryScope } from '@docx-editor.dev/core/store';
import { paragraphTextFromLayout } from '@docx-editor.dev/core/layout';
import { unzipSync, strFromU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import type { PaginatedSurface } from '../paginated-surface.ts';
import type { StoryKind } from './story-parity-contract.ts';
import {
  CONTROL_TEXT,
  ENDNOTE_SCOPE_ID,
  FOOTER_R_ID,
  FOOTNOTE_SCOPE_ID,
  HEADER_R_ID,
  PROBE_TEXT,
  storyParityDocx,
} from './story-parity-fixture.ts';

/** The scope each story kind binds once it is open. */
export function scopeOf(story: StoryKind): StoryScope {
  switch (story) {
    case 'body':
      return { kind: 'body' };
    case 'header':
      return { kind: 'headerFooter', rId: HEADER_R_ID };
    case 'footer':
      return { kind: 'headerFooter', rId: FOOTER_R_ID };
    case 'footnote':
      return { kind: 'notesPart', noteKind: 'footnote' };
    case 'endnote':
      return { kind: 'notesPart', noteKind: 'endnote' };
  }
}

/**
 * The ZIP ENTRY each story is written to. What a write in that story may touch.
 *
 * Entry names, not canonical OPC part names: these index the `unzipSync` result, so they carry
 * no leading slash. {@link partOfNodeId} answers in the same spelling so the two can be
 * compared, and that is the only reason they look alike.
 */
export const PART_OF_STORY: Readonly<Record<StoryKind, string>> = {
  body: 'word/document.xml',
  header: 'word/header1.xml',
  footer: 'word/footer1.xml',
  footnote: 'word/footnotes.xml',
  endnote: 'word/endnotes.xml',
};

/**
 * The part a node id belongs to, as a zip entry name.
 *
 * Ids are `${canonicalPartName}#${path}`, and a canonical part name carries a LEADING SLASH
 * (`/word/document.xml`). Dropping it is what makes the answer comparable with
 * {@link PART_OF_STORY}, not an off-by-one.
 */
export function partOfNodeId(id: string): string {
  const hash = id.indexOf('#');
  if (hash === -1) return '';
  return id.startsWith('/') ? id.slice(1, hash) : id.slice(0, hash);
}

export interface OpenStory {
  readonly story: StoryKind;
  readonly editor: DocxEditorInstance;
  readonly surface: PaginatedSurface;
  /** The probe paragraph ids, in reading order, one per entry of `PROBE_TEXT`. */
  readonly paragraphIds: readonly string[];
  /** The paragraph inside this story's block content control. */
  readonly controlParagraphId: string;
  readonly destroy: () => void;
}

/** Text of every paragraph the scope holds, keyed by id, read from the published layout. */
function textByParagraph(surface: PaginatedSurface, scope: StoryScope): Map<string, string> {
  const layout = surface.publishedLayout();
  const byId = new Map<string, string>();
  for (const id of surface.session.paragraphIdsIn(scope)) {
    byId.set(id, paragraphTextFromLayout(layout, id));
  }
  return byId;
}

/**
 * Mount the fixture, enter `story`, and locate that story's probe paragraphs BY TEXT.
 *
 * By text rather than by index: a note part opens with two separator paragraphs the body does
 * not have, and the body ends with a note-reference paragraph the others do not, so no single
 * slice into `paragraphIdsIn` is right for all five stories. Matching on text also means the
 * fixture can grow without silently re-pointing every caret.
 */
export function openStory(story: StoryKind, bytes?: Uint8Array): OpenStory {
  const host = document.createElement('div');
  document.body.append(host);
  // An author is named because suggesting refuses a write without one, and a test that wants
  // a tracked change should get one rather than a silent refusal.
  //
  // `bytes` takes a VARIANT of the same fixture — the parity document plus something a suite
  // needs, protection for one. It must keep the probe paragraphs and the control, because the
  // lookups below are what make an `OpenStory` an `OpenStory`.
  const editor = createDocxEditor({ document: bytes ?? storyParityDocx(), author: 'Parity' });
  // Everything after the mount can throw, and a host left on `document.body` outlives the test
  // that made it. The suite is sharded one process per file, which HIDES that from the parallel
  // run and surfaces it only in the serial one.
  const destroy = (): void => {
    editor.destroy();
    host.remove();
    // The surface leaves a Range anchored at nodes this just detached. Only the serial run can
    // see state left on `document`, so it is cleared here rather than discovered later.
    document.getSelection()?.removeAllRanges();
  };
  try {
    editor.attach(host);
    const surface = editor.surface;
    if (!surface) throw new Error(`no surface for ${story}`);

    if (story === 'header' || story === 'footer') {
      const rId = story === 'header' ? HEADER_R_ID : FOOTER_R_ID;
      if (!surface.enterHeaderFooter({ rId })) throw new Error(`enterHeaderFooter(${rId}) refused`);
    } else if (story === 'footnote' || story === 'endnote') {
      const scopeId = story === 'footnote' ? FOOTNOTE_SCOPE_ID : ENDNOTE_SCOPE_ID;
      if (!surface.enterNote(scopeId)) throw new Error(`enterNote(${scopeId}) refused`);
    }

    const byId = textByParagraph(surface, scopeOf(story));
    const findByText = (text: string): string => {
      const found = [...byId].filter(([, value]) => value === text).map(([id]) => id);
      if (found.length !== 1) {
        throw new Error(
          `${story}: expected one paragraph reading "${text}", found ${found.length}`
        );
      }
      return found[0]!;
    };

    return {
      story,
      editor,
      surface,
      paragraphIds: PROBE_TEXT.map(findByText),
      controlParagraphId: findByText(CONTROL_TEXT),
      destroy,
    };
  } catch (error) {
    destroy();
    throw error;
  }
}

/** Put the caret in the probe paragraph at `index`, one character in. */
export function caretIn(open: OpenStory, index: number): void {
  const paragraphId = open.paragraphIds[index]!;
  open.surface.setSelection({
    anchor: { paragraphId, offset: 1 },
    head: { paragraphId, offset: 1 },
  });
}

/** Put the caret in this story's content-control paragraph. */
export function caretInControl(open: OpenStory): void {
  const paragraphId = open.controlParagraphId;
  open.surface.setSelection({
    anchor: { paragraphId, offset: 0 },
    head: { paragraphId, offset: 0 },
  });
}

/**
 * The serialized `w:p` that holds `text`, with the identity attributes stripped.
 *
 * Comparing which PART a write reached says nothing about what it wrote there, and the two
 * questions fail differently: Increase Indent demotes a list item in the body (`w:ilvl` 0 to 1)
 * and merely shifts the paragraph everywhere else (a bare `w:ind`). Both land in the right
 * part, so a part-identity assertion calls that parity. This is what catches it.
 *
 * `w14:paraId` / `w14:textId` are dropped because they are per-paragraph identity and
 * legitimately differ between stories.
 */
export function probeParagraphMarkup(partXml: string, text: string): string {
  // `<w:pPr>` cannot match: after `<w:p` it has `P`, where this requires `>` or whitespace.
  const paragraphs = partXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) ?? [];
  const holding = paragraphs.filter((markup) => markup.includes(`>${text}</w:t>`));
  if (holding.length !== 1) {
    throw new Error(`expected one paragraph reading "${text}", found ${holding.length}`);
  }
  return holding[0]!.replace(/ w14:(?:para|text)Id="[^"]*"/g, '');
}

/** Select from the start of probe paragraph `from` to `offset` in probe paragraph `to`. */
export function selectAcross(open: OpenStory, from: number, to: number, offset: number): void {
  open.surface.setSelection({
    anchor: { paragraphId: open.paragraphIds[from]!, offset: 0 },
    head: { paragraphId: open.paragraphIds[to]!, offset },
  });
}

/**
 * Every text part of the saved package, by zip entry name.
 *
 * XML and rels only. A write that touched an image or another binary would be invisible here,
 * which is fine for a contract about which STORY an edit reached.
 */
export async function savedParts(open: OpenStory): Promise<ReadonlyMap<string, string>> {
  const zip = unzipSync(await open.surface.session.save());
  const parts = new Map<string, string>();
  for (const [name, bytes] of Object.entries(zip)) {
    if (name.endsWith('.xml') || name.endsWith('.rels')) parts.set(name, strFromU8(bytes));
  }
  return parts;
}

/** The part names whose content differs between two saves. */
export function changedParts(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>
): string[] {
  const names = new Set([...before.keys(), ...after.keys()]);
  return [...names].filter((name) => before.get(name) !== after.get(name)).sort();
}
