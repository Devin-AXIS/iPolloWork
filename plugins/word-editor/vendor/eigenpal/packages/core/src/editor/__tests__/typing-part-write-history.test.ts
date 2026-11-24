// A typing run whose first keystroke also writes another document part.
//
// Typing over a selection that holds a note reference deletes the note body, and typing over a
// whole comment range deletes the comment. Those keystrokes are package units; the keys typed
// after them are story edits of the same typing run. The run is one undo step and one redo step.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface } from '../paginated-surface.ts';
import type { PaginatedSurface } from '../paginated-surface-contract.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const PARTS = {
  footnotes: {
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml',
    xml:
      `<w:footnotes xmlns:w="${W}">` +
      '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
      '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
      '<w:footnote w:id="1"><w:p><w:r><w:t>Note text</w:t></w:r></w:p></w:footnote></w:footnotes>',
    marker: 'Note text',
  },
  comments: {
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml',
    xml:
      `<w:comments xmlns:w="${W}"><w:comment w:id="0" w:author="A" w:date="2026-01-01T00:00:00Z">` +
      '<w:p><w:r><w:t>Remark</w:t></w:r></w:p></w:comment></w:comments>',
    marker: 'Remark',
  },
} as const;

function docx(body: string, extra: keyof typeof PARTS): Uint8Array {
  const part = PARTS[extra];
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        `<Override PartName="/word/${extra}.xml" ContentType="${part.contentType}"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId9" Type="${R}/${extra}" Target="${extra}.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
    [`word/${extra}.xml`]: strToU8(part.xml),
  });
}

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

/** One key per task, through `beforeinput`, the way a browser delivers typing. */
async function typeKeys(container: HTMLElement, text: string): Promise<void> {
  for (const data of text) {
    container.querySelector('.docx-pages')!.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data,
      })
    );
    await nextTask();
  }
}

/** Whether the extra part still holds its note or comment. */
function partHolds(surface: PaginatedSurface, extra: keyof typeof PARTS): boolean {
  const part = surface.session.currentPackage().parts.get(`/word/${extra}.xml`);
  return JSON.stringify(part?.root ?? null).includes(PARTS[extra].marker);
}

const CASES = [
  {
    name: 'a note reference',
    extra: 'footnotes',
    body: '<w:p><w:r><w:t>ab</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r><w:r><w:t>cd</w:t></w:r></w:p>',
    range: [1, 4],
    typed: 'aXYZd',
  },
  {
    name: 'a whole comment range',
    extra: 'comments',
    body:
      '<w:p><w:r><w:t>ab</w:t></w:r><w:commentRangeStart w:id="0"/><w:r><w:t>cd</w:t></w:r>' +
      '<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r><w:r><w:t>ef</w:t></w:r></w:p>',
    range: [1, 5],
    typed: 'aXYZf',
  },
] as const;

describe('typing over a selection that removes another part’s content', () => {
  for (const { name, extra, body, range, typed } of CASES) {
    test(`typing over ${name} is one undo step and one redo step`, async () => {
      const container = document.createElement('div');
      document.body.append(container);
      const mounted = mountPaginatedSurface(container, docx(body, extra), { scale: 1 });
      if (!mounted.ok) throw new Error(mounted.reason);
      const surface = mounted.surface;
      try {
        const before = surface.session.bodyText();
        const id = surface.session.paragraphIds()[0]!;
        surface.setSelection({
          anchor: { paragraphId: id, offset: range[0] },
          head: { paragraphId: id, offset: range[1] },
        });
        await typeKeys(container, 'XYZ');
        expect(surface.session.bodyText()).toBe(typed);
        expect(partHolds(surface, extra)).toBe(false);

        surface.undo();
        expect(surface.session.bodyText()).toBe(before);
        expect(partHolds(surface, extra)).toBe(true);
        expect(surface.session.canUndo()).toBe(false);

        surface.redo();
        expect(surface.session.bodyText()).toBe(typed);
        expect(partHolds(surface, extra)).toBe(false);
        expect(surface.session.canRedo()).toBe(false);
      } finally {
        surface.destroy();
        container.remove();
      }
    });
  }
});
