// A table is a table in every story.
//
// The whole table lane resolved through `tableIndex`, which walked `page.fragments` — the
// BODY's. So with the caret in a table inside a header or a note, `resolveAnchor` found
// nothing and roughly fourteen commands refused with "the selection is not inside a table":
// a message that states a fact about the caret rather than the limit it actually hit, over a
// table plainly on the screen. `snapshot().table` was null for the same reason, so the whole
// table section of the toolbar greyed out first.
//
// The planner's input part was the body's too, so even a resolved plan was committed under the
// caret's scope and rejected — a plan that validates and then cannot be applied.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import type { StoryScope } from '@docx-editor.dev/core/store';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { cellSelectionRects, spansInCells } from '../../layout/semantic-cell-selection.ts';
import { tableInteractionIndex } from '../../layout/semantic-table-interaction.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const cell = (text: string) => `<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;

/** The same two-by-two table in every story. */
const TABLE =
  `<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>` +
  `<w:tr>${cell('A1')}${cell('B1')}</w:tr>` +
  `<w:tr>${cell('A2')}${cell('B2')}</w:tr></w:tbl>` +
  `<w:p><w:r><w:t>after</w:t></w:r></w:p>`;

function docx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-' +
        'officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-' +
        'officedocument.wordprocessingml.header+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId10" Type="${R}/header" Target="header1.xml"/></Relationships>`
    ),
    'word/header1.xml': strToU8(`<w:hdr xmlns:w="${W}">${TABLE}</w:hdr>`),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${TABLE}` +
        `<w:sectPr><w:headerReference w:type="default" r:id="rId10"/></w:sectPr></w:body></w:document>`
    ),
  });
}

type Story = 'body' | 'header';

const SCOPE: Readonly<Record<Story, StoryScope>> = {
  body: { kind: 'body' },
  header: { kind: 'headerFooter', rId: 'rId10' },
};

const PART: Readonly<Record<Story, string>> = {
  body: 'word/document.xml',
  header: 'word/header1.xml',
};

interface Open {
  readonly editor: DocxEditorInstance;
  readonly destroy: () => void;
}

/** Mount, enter `story`, and put the caret in that story's first table cell. */
function openInCell(story: Story): Open {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createDocxEditor({ document: docx() });
  const destroy = (): void => {
    editor.destroy();
    host.remove();
  };
  try {
    editor.attach(host);
    const surface = editor.surface!;
    if (story === 'header') {
      expect(surface.enterHeaderFooter({ rId: 'rId10' })).toBe(true);
    }
    // Cell paragraphs come first in both stories; the trailing "after" paragraph is last.
    const paragraphId = surface.session.paragraphIdsIn(SCOPE[story])[0]!;
    surface.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 0 },
    });
    return { editor, destroy };
  } catch (error) {
    destroy();
    throw error;
  }
}

async function partsOf(open: Open): Promise<ReadonlyMap<string, string>> {
  const zip = unzipSync(await open.editor.surface!.session.save());
  return new Map(Object.entries(zip).map(([name, bytes]) => [name, strFromU8(bytes)]));
}

describe('a table is a table in every story', () => {
  for (const story of ['body', 'header'] as const) {
    test(`the caret reports a table context in the ${story}`, () => {
      const open = openInCell(story);
      try {
        const table = open.editor.snapshot().table;
        expect(table, `no table context in the ${story}`).not.toBeNull();
        expect(table?.rows).toBe(2);
        expect(table?.columns).toBe(2);
      } finally {
        open.destroy();
      }
    });

    test(`insertRow is offered and applies in the ${story}`, async () => {
      const open = openInCell(story);
      try {
        const command = { type: 'insertRow', where: 'below' } as const;
        expect(open.editor.can(command).ok, `insertRow refused in the ${story}`).toBe(true);

        const before = await partsOf(open);
        expect(open.editor.exec(command).ok).toBe(true);
        const after = await partsOf(open);

        // A third row in this story's part, and no other story touched.
        const rowsBefore = (before.get(PART[story])!.match(/<w:tr[ >]/g) ?? []).length;
        const rowsAfter = (after.get(PART[story])!.match(/<w:tr[ >]/g) ?? []).length;
        expect(rowsAfter).toBe(rowsBefore + 1);
        for (const [other, part] of Object.entries(PART)) {
          if (other === story) continue;
          expect(after.get(part)).toBe(before.get(part));
        }
      } finally {
        open.destroy();
      }
    });
  }
});

// The two readers of `tableIndex` that its widening left behind.
//
// `cellSelectionRects` promises page-content coordinates and the overlay painter places what
// it returns against `page.contentBox`. A header's cells are laid out from the header's own
// box, so returning them raw painted a header selection band 36pt down into the body text —
// and a footer's up at the top of it.
//
// `spansInCells` read `page.fragments` alone, so a cell selection in a header reported NO
// style spans: a fully bold selection with the Bold button showing inactive.
describe('a cell selection in a header reports its own geometry and formatting', () => {
  test('rects are shifted into the page content box, and spans are found', () => {
    const open = openInCell('header');
    try {
      const layout = open.editor.surface!.layout();
      const page = layout.pages[0]!;
      const header = page.header!;
      expect(header, 'the fixture painted no header').toBeDefined();
      // The two origins must differ, or neither assertion below proves anything.
      expect(header.box.y).not.toBe(page.contentBox.y);

      const table = tableInteractionIndex(layout).occurrences.find(
        (each) => each.pageContentBox === header.box
      )?.table;
      expect(table, 'the header table is not in the index').toBeDefined();
      const cells = table!.rows[0]!.cells;
      expect(cells.length).toBe(2);

      const rects = cellSelectionRects(
        layout,
        cells.map((each) => each.id)
      );
      expect(rects.length, 'no rectangle for a selected header cell').toBe(2);
      for (const rect of rects) {
        // In the page content box's space, which is what the painter adds to. The raw cell box
        // is what used to come back, and for this fixture that is a whole header height off.
        expect(rect.y).toBeCloseTo(cells[0]!.box.y + (header.box.y - page.contentBox.y), 1);
        expect(rect.y).not.toBeCloseTo(cells[0]!.box.y, 1);
      }

      const spans = spansInCells(
        layout,
        cells.map((each) => each.id)
      );
      expect(spans.length, 'a header cell selection reported no style spans').toBeGreaterThan(0);
    } finally {
      open.destroy();
    }
  });

  test('a body cell selection is unchanged', () => {
    const open = openInCell('body');
    try {
      const layout = open.editor.surface!.layout();
      const table = tableInteractionIndex(layout).occurrences.find(
        (each) => each.pageContentBox === layout.pages[0]!.contentBox
      )?.table;
      expect(table, 'the body table is not in the index').toBeDefined();
      const cells = table!.rows[0]!.cells;

      const rects = cellSelectionRects(
        layout,
        cells.map((each) => each.id)
      );
      expect(rects.length).toBe(2);
      // Zero offset: the body IS the content box, so the raw box was already right and must
      // stay exactly right.
      for (const rect of rects) expect(rect.y).toBeCloseTo(cells[0]!.box.y, 5);
    } finally {
      open.destroy();
    }
  });
});
