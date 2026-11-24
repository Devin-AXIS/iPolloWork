// The two formatting lanes must reach the same runs (fixes #498).
//
// The store lane (`direct-properties.ts`) is what the automation object model writes
// through; the surface lane (`surface-formatting.ts`) is what the toolbar writes through.
// They kept their own container walks and drifted per container kind: the store descended
// `w:fldSimple` and the surface did not, the surface descended an inline `w:sdt` and the
// store did not. Either direction is the same silent bug — one lane applies, the other plans
// zero edits over the same selection, and an empty op list is not an error anywhere.
//
// These tests ask both lanes the same question over every container the shared walk
// descends, and assert the answers are identical.

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  runPropertyEdits as storeRunPropertyEdits,
  runsCovering,
  type OoxmlNode,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import {
  hasAuthoredRunProperties,
  runPropertyEdits as surfaceRunPropertyEdits,
} from '../surface-formatting.ts';
import { fontRead } from '../../automation/formatting.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PARAGRAPH = '/word/document.xml#0.0.0';
const RED = { localName: 'color', attributes: { val: 'FF0000' } } as const;

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return typeInlineControls(result.part);
}

/** Retype generic `w:sdt` / `w:sdtContent` to the typed control kinds the reader emits. */
function typeInlineControls(part: OoxmlPart): OoxmlPart {
  const visit = (node: OoxmlNode): OoxmlNode => {
    if (node.kind === 'textValue') return node;
    const children = node.children.map(visit);
    if (node.kind === 'generic' && node.localName === 'sdt') {
      return { ...node, kind: 'contentControl', children } as OoxmlNode;
    }
    if (node.kind === 'generic' && node.localName === 'sdtContent') {
      return { ...node, kind: 'contentControlContent', children } as OoxmlNode;
    }
    return { ...node, children };
  };
  return { ...part, root: visit(part.root) as OoxmlPart['root'] };
}

const spans = (edits: readonly { start: number; end: number }[]): string[] =>
  edits.map((edit) => `${edit.start}..${edit.end}`);

/** Both lanes, over the same range, as comparable answers. */
function bothLanes(part: OoxmlPart, start: number, end: number) {
  return {
    store: spans(storeRunPropertyEdits(part, PARAGRAPH, start, end, RED)),
    surface: spans(surfaceRunPropertyEdits(part, PARAGRAPH, start, end, RED)),
  };
}

describe('formatting lane parity per run container', () => {
  test('w:fldSimple: both lanes format the result runs', () => {
    // The store lane already descended; the surface lane handed the whole `w:fldSimple` to
    // its callback, so the toolbar planned nothing over a selection the automation lane
    // formatted. The field is ONE offset — its result runs own the face through
    // `formatRunIds` — so both lanes answer one edit per result run over that offset.
    const part = load(
      '<w:p>' +
        '<w:r><w:t xml:space="preserve">at </w:t></w:r>' +
        '<w:fldSimple w:instr=" PAGE "><w:r><w:t>7</w:t></w:r></w:fldSimple>' +
        '</w:p>'
    );
    const answers = bothLanes(part, 0, 4);
    expect(answers.surface).toEqual(answers.store);
    expect(answers.store).toEqual(['0..3', '3..4']);
    expect(runsCovering(part, PARAGRAPH, 3, 4)).toHaveLength(1);
  });

  test('w:fldSimple: the eraser gate sees the result run inside it', () => {
    const part = load(
      '<w:p><w:fldSimple w:instr=" PAGE ">' +
        '<w:r><w:rPr><w:b/></w:rPr><w:t>7</w:t></w:r>' +
        '</w:fldSimple></w:p>'
    );
    expect(hasAuthoredRunProperties(part, PARAGRAPH, 0, 1)).toBe(true);
  });

  test('inline w:sdt: both lanes format the run inside the control', () => {
    // The other direction — the surface descended and the store did not, so automation
    // `setFont` inside a form field planned zero run edits: a partial span was misrefused
    // as `invalid-offset` and a whole-paragraph span reported applied while formatting only
    // the paragraph mark.
    const part = load(
      '<w:p>' +
        '<w:r><w:t xml:space="preserve">Name: </w:t></w:r>' +
        '<w:sdt><w:sdtPr><w:alias w:val="Name"/></w:sdtPr>' +
        '<w:sdtContent><w:r><w:t>Ada</w:t></w:r></w:sdtContent></w:sdt>' +
        '<w:r><w:t>!</w:t></w:r>' +
        '</w:p>'
    );
    const whole = bothLanes(part, 0, 10);
    expect(whole.store).toEqual(whole.surface);
    expect(whole.store).toEqual(['0..6', '6..9', '9..10']);

    const inside = bothLanes(part, 6, 9);
    expect(inside.store).toEqual(inside.surface);
    expect(inside.store).toEqual(['6..9']);
    expect(runsCovering(part, PARAGRAPH, 6, 9)).toHaveLength(1);
  });

  test('w:hyperlink and w:ins nested either way agree in both lanes', () => {
    const part = load(
      '<w:p>' +
        '<w:ins w:id="1" w:author="A">' +
        '<w:hyperlink r:id="rId1"><w:r><w:t>link</w:t></w:r></w:hyperlink>' +
        '</w:ins>' +
        '<w:hyperlink r:id="rId2">' +
        '<w:ins w:id="2" w:author="A"><w:r><w:t>more</w:t></w:r></w:ins>' +
        '</w:hyperlink>' +
        '</w:p>'
    );
    const answers = bothLanes(part, 0, 8);
    expect(answers.store).toEqual(answers.surface);
    expect(answers.store).toEqual(['0..4', '4..8']);
  });

  test('a run inside a control inside a tracked insertion is reached by both lanes', () => {
    const part = load(
      '<w:p><w:ins w:id="1" w:author="A">' +
        '<w:sdt><w:sdtContent><w:r><w:t>deep</w:t></w:r></w:sdtContent></w:sdt>' +
        '</w:ins></w:p>'
    );
    const answers = bothLanes(part, 0, 4);
    expect(answers.store).toEqual(answers.surface);
    expect(answers.store).toEqual(['0..4']);
  });

  test('both lanes hide the same deletion, and reveal it in the same mode', () => {
    const part = load(
      '<w:p>' +
        '<w:r><w:t>abc</w:t></w:r>' +
        '<w:del w:id="3" w:author="A"><w:r><w:delText>XYZ</w:delText></w:r></w:del>' +
        '</w:p>'
    );
    expect(spans(storeRunPropertyEdits(part, PARAGRAPH, 0, 6, RED))).toEqual(['0..3']);
    expect(spans(surfaceRunPropertyEdits(part, PARAGRAPH, 0, 6, RED))).toEqual(['0..3']);
    expect(spans(storeRunPropertyEdits(part, PARAGRAPH, 0, 6, RED, 'all-markup'))).toEqual([
      '0..3',
      '3..6',
    ]);
    expect(spans(surfaceRunPropertyEdits(part, PARAGRAPH, 0, 6, RED, 'all-markup'))).toEqual([
      '0..3',
      '3..6',
    ]);
  });

  test('`original` reaches the deletion and hides the insertion', () => {
    const part = load(
      '<w:p>' +
        '<w:ins w:id="1" w:author="A"><w:r><w:t>new</w:t></w:r></w:ins>' +
        '<w:del w:id="2" w:author="A"><w:r><w:delText>old</w:delText></w:r></w:del>' +
        '</w:p>'
    );
    expect(spans(storeRunPropertyEdits(part, PARAGRAPH, 0, 6, RED, 'original'))).toEqual(['3..6']);
    expect(spans(surfaceRunPropertyEdits(part, PARAGRAPH, 0, 6, RED, 'original'))).toEqual([
      '3..6',
    ]);
  });

  test('the automation lane reads the surface display mode, not a default of its own', () => {
    // The defaults are NOT what the lanes use: with the review module registered the surface
    // renders `all-markup`, while a lane that passed nothing would read the resolved result.
    // The port carries the reader's view so a script and the toolbar agree over one selection.
    const part = load(
      '<w:p>' +
        '<w:r><w:t>abc</w:t></w:r>' +
        '<w:del w:id="3" w:author="A"><w:r><w:delText>XYZ</w:delText></w:r></w:del>' +
        '</w:p>'
    );
    const spans = [{ paragraphId: PARAGRAPH, start: 0, end: 6 }];
    // Struck text carries its own face; the resolved result never sees it.
    expect(fontRead(part, spans).bold).toBe(null);
    expect(fontRead(part, spans, 'proposed').bold).toBe(null);
    // With the deletion in reach the answers still agree with the write lane's reach.
    expect(runsCovering(part, PARAGRAPH, 0, 6, 'all-markup')).toHaveLength(2);
    expect(runsCovering(part, PARAGRAPH, 0, 6, 'proposed')).toHaveLength(1);
  });

  test('a move pair takes the write on the half the view renders, and does not mirror', () => {
    // `w:moveFrom` and `w:moveTo` hold the same words at different offsets. Only one half
    // survives the decision on the move, so copying the format onto the twin would put it on
    // text that appears only when somebody asks for the original back (#497).
    const part = load(
      '<w:p>' +
        '<w:moveFrom w:id="1" w:author="A"><w:r><w:delText>gone</w:delText></w:r></w:moveFrom>' +
        '<w:moveTo w:id="2" w:author="A"><w:r><w:t>gone</w:t></w:r></w:moveTo>' +
        '</w:p>'
    );
    expect(spans(storeRunPropertyEdits(part, PARAGRAPH, 0, 8, RED))).toEqual(['4..8']);
    expect(spans(surfaceRunPropertyEdits(part, PARAGRAPH, 0, 8, RED))).toEqual(['4..8']);
    expect(spans(storeRunPropertyEdits(part, PARAGRAPH, 0, 8, RED, 'original'))).toEqual(['0..4']);
  });
});
