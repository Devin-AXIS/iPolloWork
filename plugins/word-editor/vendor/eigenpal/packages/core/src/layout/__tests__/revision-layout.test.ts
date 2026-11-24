// Tracked content reaching layout.
//
// The failure this covers is not "revisions render plainly". Before the revision family was
// typed, a walk over a paragraph's DIRECT `run` children never reached the runs nested inside
// `w:ins` / `w:del`, so an insertion and a deletion were both dropped: the reviewer saw a third
// text that exists in neither the original nor the proposal, and the markup survived the save,
// so nothing signalled the loss.

import { describe, expect, test } from 'bun:test';
import {
  paragraphTextOf,
  readOoxmlPart,
  type OoxmlNode,
  type OoxmlPart,
  type OoxmlParagraphNode,
} from '@docx-editor.dev/core/store';
import { canonicalOoxmlFingerprint, serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { piecesOfParagraph } from '../field-projection.ts';
import { breakParagraph } from '../paragraph-flow.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { linesOf } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const measurer = createFixedMeasurer(6, 14);

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function firstParagraph(body: string): OoxmlNode {
  const part = load(body);
  const paragraph = part.root.children[0]!.children.find((child) => child.kind === 'paragraph');
  if (!paragraph) throw new Error('no paragraph');
  return paragraph;
}

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const delRun = (text: string) => `<w:r><w:delText xml:space="preserve">${text}</w:delText></w:r>`;
const ins = (id: string, inner: string, author = 'QA') =>
  `<w:ins w:id="${id}" w:author="${author}" w:date="2026-03-26T11:00:00Z">${inner}</w:ins>`;
const del = (id: string, inner: string, author = 'Dev') =>
  `<w:del w:id="${id}" w:author="${author}" w:date="2026-03-26T11:00:00Z">${inner}</w:del>`;

describe('tracked content reaches layout', () => {
  test('a run nested in w:ins produces a piece', () => {
    const pieces = piecesOfParagraph(firstParagraph(`<w:p>${ins('1', run('added'))}</w:p>`));
    expect(pieces.map((piece) => piece.text)).toEqual(['added']);
  });

  test('a run nested in w:del produces a piece in all-markup mode', () => {
    const pieces = piecesOfParagraph(firstParagraph(`<w:p>${del('2', delRun('gone'))}</w:p>`));
    expect(pieces.map((piece) => piece.text)).toEqual(['gone']);
  });

  test('the whole paragraph flows, not just its untracked runs', () => {
    const pieces = piecesOfParagraph(
      firstParagraph(`<w:p>${run('keep ')}${ins('1', run('new '))}${del('2', delRun('old'))}</w:p>`)
    );
    expect(pieces.map((piece) => piece.text).join('')).toBe('keep new old');
  });

  test('pieces carry their revision attribution, outermost first', () => {
    const pieces = piecesOfParagraph(
      firstParagraph(`<w:p>${run('plain')}${ins('7', run('tracked'), 'QA Reviewer')}</w:p>`)
    );
    expect(pieces[0]!.revisions ?? []).toEqual([]);
    expect(pieces[1]!.revisions).toEqual([
      {
        kind: 'insert',
        id: '7',
        author: 'QA Reviewer',
        date: '2026-03-26T11:00:00Z',
        nodeId: expect.any(String),
      },
    ]);
  });

  test('a nested revision keeps both attributions in containment order', () => {
    const pieces = piecesOfParagraph(
      firstParagraph(`<w:p>${del('9', ins('8', run('x'), 'A'), 'B')}</w:p>`)
    );
    expect(pieces[0]!.revisions?.map((entry) => [entry.kind, entry.author])).toEqual([
      ['delete', 'B'],
      ['insert', 'A'],
    ]);
  });

  test('provenance is read, never fabricated', () => {
    const pieces = piecesOfParagraph(
      firstParagraph(`<w:p><w:ins w:id="3" w:author="QA">${run('no date')}</w:ins></w:p>`)
    );
    expect(pieces[0]!.revisions?.[0]).toEqual({
      kind: 'insert',
      id: '3',
      author: 'QA',
      nodeId: expect.any(String),
    });
  });

  test('moveFrom and moveTo are attributed as moves, not as a delete/insert pair', () => {
    const pieces = piecesOfParagraph(
      firstParagraph(
        '<w:p><w:moveFrom w:id="1" w:author="QA">' +
          `${delRun('here')}</w:moveFrom>` +
          '<w:moveTo w:id="2" w:author="QA">' +
          `${run('there')}</w:moveTo></w:p>`
      )
    );
    expect(pieces.map((piece) => [piece.text, piece.revisions?.[0]?.kind])).toEqual([
      ['here', 'moveFrom'],
      ['there', 'moveTo'],
    ]);
  });

  test('a w:delText outside any deletion is not laid out', () => {
    // Malformed, and the one thing that must never happen is deleted text flowing as ordinary
    // text. The offset still advances, because the characters are in the model.
    const pieces = piecesOfParagraph(
      firstParagraph(`<w:p>${run('AB')}${delRun('XYZ')}${run('CD')}</w:p>`)
    );
    expect(pieces.map((piece) => [piece.text, piece.start, piece.end])).toEqual([
      ['AB', 0, 2],
      ['CD', 5, 7],
    ]);
  });

  test('tracked content occupies real line width', () => {
    // 10 characters at 6pt fill a 60pt measure exactly. If the insertion were dropped, this
    // would fit on one line.
    const paragraph = firstParagraph(`<w:p>${run('01234')}${ins('1', run('56789ABCDE'))}</w:p>`);
    const lines = breakParagraph(paragraph, 'p', 0, 60, measurer, undefined, null);
    expect(lines.length).toBeGreaterThan(1);
  });
});

describe('the model offset space includes tracked content', () => {
  test('paragraphTextOf counts inserted and deleted characters', () => {
    const part = load(
      `<w:p>${run('keep ')}${ins('1', run('new '))}${del('2', delRun('old'))}</w:p>`
    );
    const paragraph = part.root.children[0]!.children.find(
      (child) => child.kind === 'paragraph'
    ) as OoxmlParagraphNode;
    expect(paragraphTextOf(part, paragraph.id)).toBe('keep new old');
  });

  test('layout offsets and the op offset space agree', () => {
    // A disagreement here puts the caret and every tree op on a different character than the
    // one under the pointer.
    const part = load(`<w:p>${run('AB')}${ins('1', run('CD'))}${run('EF')}</w:p>`);
    const paragraph = part.root.children[0]!.children.find(
      (child) => child.kind === 'paragraph'
    ) as OoxmlParagraphNode;
    const pieces = piecesOfParagraph(paragraph);
    expect(pieces.map((piece) => [piece.text, piece.start, piece.end])).toEqual([
      ['AB', 0, 2],
      ['CD', 2, 4],
      ['EF', 4, 6],
    ]);
    expect(paragraphTextOf(part, paragraph.id)).toBe('ABCDEF');
  });
});

describe('display mode selects what layout produces', () => {
  const body = `<w:p>${run('keep ')}${ins('1', run('new '))}${del('2', delRun('old'))}</w:p>`;

  test('all-markup shows both halves', () => {
    const pieces = piecesOfParagraph(
      firstParagraph(body),
      [],
      undefined,
      undefined,
      undefined,
      'all-markup'
    );
    expect(pieces.map((piece) => piece.text).join('')).toBe('keep new old');
  });

  test('the proposed result drops deletions and keeps insertions', () => {
    const pieces = piecesOfParagraph(
      firstParagraph(body),
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      'proposed'
    );
    expect(pieces.map((piece) => piece.text).join('')).toBe('keep new ');
  });

  test('the original drops insertions and keeps deletions', () => {
    const pieces = piecesOfParagraph(
      firstParagraph(body),
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      'original'
    );
    expect(pieces.map((piece) => piece.text).join('')).toBe('keep old');
  });

  test('a suppressed revision still advances model offsets in every mode', () => {
    // Layout showing fewer characters than the model holds is the same situation `w:vanish`
    // already creates: the offset space belongs to the model, not to the view.
    const proposed = piecesOfParagraph(
      firstParagraph(body),
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      'proposed'
    );
    expect(proposed.map((piece) => [piece.text, piece.start])).toEqual([
      ['keep ', 0],
      ['new ', 5],
    ]);
    const original = piecesOfParagraph(
      firstParagraph(body),
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      'original'
    );
    expect(original.map((piece) => [piece.text, piece.start])).toEqual([
      ['keep ', 0],
      ['old', 9],
    ]);
  });

  test('a move resolves with the half its mode keeps', () => {
    const moved =
      '<w:p><w:moveFrom w:id="1" w:author="QA">' +
      `${delRun('here')}</w:moveFrom>` +
      '<w:moveTo w:id="2" w:author="QA">' +
      `${run('there')}</w:moveTo></w:p>`;
    expect(
      piecesOfParagraph(
        firstParagraph(moved),
        [],
        undefined,
        undefined,
        undefined,
        undefined,
        'proposed'
      ).map((piece) => piece.text)
    ).toEqual(['there']);
    expect(
      piecesOfParagraph(
        firstParagraph(moved),
        [],
        undefined,
        undefined,
        undefined,
        undefined,
        'original'
      ).map((piece) => piece.text)
    ).toEqual(['here']);
  });

  test('a document lays out differently per mode, and the package is untouched', () => {
    const part = load(
      `<w:p>${run('The ')}${del('1', delRun('old'))}${ins('2', run('new'))}${run(' text')}</w:p>`
    );
    const before = canonicalOoxmlFingerprint(part);
    const textOf = (mode: 'all-markup' | 'proposed' | 'original') =>
      linesOf(layoutSemanticDocument(part, 1, { measurer, displayMode: mode }))
        .map((line) => line.spans.map((span) => span.text).join(''))
        .join('');

    expect(textOf('all-markup')).toBe('The oldnew text');
    expect(textOf('proposed')).toBe('The new text');
    expect(textOf('original')).toBe('The old text');
    // "Show final" implemented as accept-all would mean switching view and saving silently
    // accepts every proposal in the file.
    expect(canonicalOoxmlFingerprint(part)).toBe(before);
    expect(serializeOoxmlPart(part)).toContain('<w:delText');
  });

  test('switching mode does not serve a stale break from the cache', () => {
    // The break cache is keyed per paragraph. A mode that drops deleted text wraps elsewhere,
    // so a key that ignored the mode would hand back the previous mode's lines.
    const part = load(`<w:p>${run('AB')}${del('1', delRun('CDEFGHIJ'))}</w:p>`);
    const cache = createParagraphLayoutCache<never>();
    const spans = (mode: 'all-markup' | 'proposed') =>
      linesOf(
        layoutSemanticDocument(part, 1, {
          measurer,
          displayMode: mode,
          cache: cache as never,
        })
      )
        .flatMap((line) => line.spans.map((span) => span.text))
        .join('');

    expect(spans('all-markup')).toBe('ABCDEFGHIJ');
    expect(spans('proposed')).toBe('AB');
    expect(spans('all-markup')).toBe('ABCDEFGHIJ');
  });

  test('spans carry the attribution through to the records', () => {
    const part = load(`<w:p>${run('plain ')}${ins('5', run('tracked'), 'QA')}</w:p>`);
    const spans = linesOf(layoutSemanticDocument(part, 1, { measurer })).flatMap(
      (line) => line.spans
    );
    const tracked = spans.filter((span) => span.revisions !== undefined);
    expect(tracked.length).toBeGreaterThan(0);
    expect(tracked.every((span) => span.revisions?.[0]?.author === 'QA')).toBe(true);
    expect(spans.filter((span) => span.text.startsWith('plain'))[0]?.revisions).toBeUndefined();
  });

  test('a nested revision is suppressed when its container is', () => {
    // Containment governs: an insertion inside a deletion does not survive the proposed
    // result, because the deletion it sits in was accepted.
    const nested = `<w:p>${del('9', ins('8', run('x')))}</w:p>`;
    expect(
      piecesOfParagraph(
        firstParagraph(nested),
        [],
        undefined,
        undefined,
        undefined,
        undefined,
        'proposed'
      )
    ).toEqual([]);
    expect(
      piecesOfParagraph(
        firstParagraph(nested),
        [],
        undefined,
        undefined,
        undefined,
        undefined,
        'original'
      ).map((piece) => piece.text)
    ).toEqual([]);
  });
});
