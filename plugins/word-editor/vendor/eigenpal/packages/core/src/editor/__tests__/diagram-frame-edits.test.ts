import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { canMoveInlineImage, moveInlineImage } from '../inline-image-drag.ts';
import { DIAGRAM_FRAME_REASON } from '../image-state-rules.ts';
import { DIAGRAM_RESCALE_REFUSAL } from '../../store/store/tree-op-diagram-drawing.ts';
import { findNode } from '../../store/package/ooxml-edit.ts';
import type { OoxmlElement, OoxmlNode } from '../../store/package/ooxml-tree.ts';
import { paragraphContainingNode } from '../../store/store/tree-op-nodes.ts';
import { simpleTextBody, smartArtDocx } from '../../store/__tests__/smartart-fixture.ts';

const cleaners: Array<() => void> = [];
afterEach(() => {
  for (const clean of cleaners.splice(0)) clean();
});

const EXTENT = [2_000_000, 1_000_000] as const;
const SHAPES = [
  {
    off: [100_000, 200_000] as const,
    ext: [1_000_000, 500_000] as const,
    txBody: simpleTextBody('Plan', 2000),
  },
];

function find(node: OoxmlNode, match: (node: OoxmlElement) => boolean): OoxmlElement[] {
  if (node.kind === 'textValue') return [];
  return [...(match(node) ? [node] : []), ...node.children.flatMap((kid) => find(kid, match))];
}

const attr = (node: OoxmlElement, name: string) =>
  node.attributes.find((a) => a.localName === name && a.namespaceUri === '')?.value;

function mount(bytes = smartArtDocx({ shapes: SHAPES, extent: EXTENT, leadingParagraphs: 1 })) {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: bytes });
  cleaners.push(() => {
    editor.destroy();
    container.remove();
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

function diagramId(editor: DocxEditorInstance): string {
  return find(editor.surface!.session.part().root, (node) => node.kind === 'drawing')[0]!.id;
}

function select(editor: DocxEditorInstance): string {
  const id = diagramId(editor);
  const paragraph = paragraphContainingNode(editor.surface!.session.part(), id)!;
  editor.surface!.selectDrawing(id, paragraph.id);
  return id;
}

/** The frame extent in the story part, and the first saved shape extent. */
function sizes(editor: DocxEditorInstance) {
  const pkg = editor.surface!.session.currentPackage();
  const extent = find(
    pkg.parts.get('/word/document.xml')!.root,
    (n) => n.localName === 'extent'
  )[0]!;
  const shape = find(pkg.parts.get('/word/diagrams/drawing1.xml')!.root, (n) => {
    return n.localName === 'ext';
  })[0]!;
  return {
    frame: [attr(extent, 'cx'), attr(extent, 'cy')],
    shape: [attr(shape, 'cx'), attr(shape, 'cy')],
  };
}

describe('diagram frame edits', () => {
  test('a selected diagram can resize, move and change wrap, but not crop', () => {
    const editor = mount();
    select(editor);
    const image = editor.snapshot().image;
    expect(image).not.toBeNull();
    expect({
      canResize: image!.canResize,
      canMove: image!.canMove,
      canChangeWrap: image!.canChangeWrap,
      canCrop: image!.canCrop,
    }).toEqual({ canResize: true, canMove: true, canChangeWrap: true, canCrop: false });
    expect(editor.snapshot().chart).toBeNull();
  });

  test('a resize rescales the saved drawing in the same undo step', () => {
    const editor = mount();
    select(editor);
    expect(sizes(editor)).toEqual({ frame: ['2000000', '1000000'], shape: ['1000000', '500000'] });
    const result = editor.exec({
      type: 'setImageProperties',
      widthEmu: 2_600_000,
      heightEmu: 700_000,
    });
    expect(result.ok).toBe(true);
    expect(sizes(editor)).toEqual({ frame: ['2600000', '700000'], shape: ['1300000', '350000'] });
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    expect(sizes(editor)).toEqual({ frame: ['2000000', '1000000'], shape: ['1000000', '500000'] });
    expect(editor.exec({ type: 'redo' }).ok).toBe(true);
    expect(sizes(editor)).toEqual({ frame: ['2600000', '700000'], shape: ['1300000', '350000'] });
  });

  test('a resized diagram keeps its size after save and reopen', async () => {
    const editor = mount();
    select(editor);
    editor.exec({ type: 'setImageProperties', widthEmu: 1_000_000, heightEmu: 500_000 });
    const bytes = new Uint8Array(await editor.save());
    const reopened = mount(bytes);
    expect(sizes(reopened)).toEqual({ frame: ['1000000', '500000'], shape: ['500000', '250000'] });
  });

  test('a resize sent with a hyperlink also rescales the saved drawing', () => {
    const editor = mount();
    select(editor);
    const result = editor.exec({
      type: 'setImageProperties',
      widthEmu: 4_000_000,
      heightEmu: 2_000_000,
      hyperlink: 'https://example.com/',
    });
    expect(result.ok).toBe(true);
    expect(sizes(editor)).toEqual({ frame: ['4000000', '2000000'], shape: ['2000000', '1000000'] });
  });

  test('a resize past the coordinate range refuses with the rescale reason', () => {
    const editor = mount(smartArtDocx({ shapes: SHAPES, extent: [1, 1], leadingParagraphs: 1 }));
    select(editor);
    for (const hyperlink of [undefined, 'https://example.com/']) {
      const result = editor.exec({
        type: 'setImageProperties',
        widthEmu: 100_000_000,
        heightEmu: 100_000_000,
        ...(hyperlink ? { hyperlink } : {}),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe(DIAGRAM_RESCALE_REFUSAL);
    }
    expect(sizes(editor).frame).toEqual(['1', '1']);
  });

  test('a diagram whose saved drawing another diagram shares cannot resize', () => {
    const files = unzipSync(smartArtDocx({ shapes: SHAPES, extent: EXTENT, leadingParagraphs: 1 }));
    const xml = strFromU8(files['word/document.xml']!);
    const paragraph = /<w:p><w:r><w:drawing>.*?<\/w:drawing><\/w:r><\/w:p>/.exec(xml)![0];
    files['word/document.xml'] = strToU8(xml.replace(paragraph, paragraph + paragraph));
    const editor = mount(zipSync(files));
    select(editor);
    const image = editor.snapshot().image!;
    expect({ canResize: image.canResize, canMove: image.canMove }).toEqual({
      canResize: false,
      canMove: true,
    });
    const result = editor.exec({
      type: 'setImageProperties',
      widthEmu: 1_000_000,
      heightEmu: 500_000,
    });
    expect(result.ok).toBe(false);
  });

  test('picture-only commands refuse with the diagram reason', () => {
    const editor = mount();
    select(editor);
    const crop = editor.exec({
      type: 'setImageProperties',
      crop: { left: 10, top: 0, right: 0, bottom: 0 },
    });
    expect(crop.ok).toBe(false);
    if (!crop.ok) expect(crop.reason).toBe(DIAGRAM_FRAME_REASON);
    expect(editor.exec({ type: 'transformImage', action: 'rotateCW' }).ok).toBe(false);
  });

  test('an inline diagram moves to another paragraph with its identity and parts', () => {
    const editor = mount();
    const surface = editor.surface!;
    const id = select(editor);
    const before = findNode(surface.session.part(), id);
    const target = surface.session.paragraphIds()[0]!;
    expect(canMoveInlineImage(editor, id)).toBe(true);
    const moved = moveInlineImage(
      surface,
      id,
      { paragraphId: target, offset: 4 },
      surface.session.packageRevision()
    );
    expect(moved.committed).toBe(true);
    expect(findNode(surface.session.part(), id)).toEqual(before);
    expect(paragraphContainingNode(surface.session.part(), id)?.id).toBe(target);
    expect(sizes(editor).shape).toEqual(['1000000', '500000']);
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    expect(paragraphContainingNode(surface.session.part(), id)?.id).not.toBe(target);
  });

  test('a diagram floats, takes a position and keeps both after reopen', async () => {
    const editor = mount();
    select(editor);
    expect(editor.exec({ type: 'setImageWrapType', target: 'square' }).ok).toBe(true);
    const moved = editor.exec({
      type: 'setImagePosition',
      horizontalEmu: 127_000,
      verticalEmu: 254_000,
    });
    expect(moved.ok).toBe(true);
    const reopened = mount(new Uint8Array(await editor.save()));
    const xml = JSON.stringify(
      reopened.surface!.session.currentPackage().parts.get('/word/document.xml')!.root
    );
    expect(xml).toContain('wrapSquare');
    expect(xml).toContain('127000');
    expect(xml).toContain('254000');
  });

  test('delete removes the diagram drawing', () => {
    const editor = mount();
    const id = select(editor);
    expect(editor.exec({ type: 'deleteImage' }).ok).toBe(true);
    expect(findNode(editor.surface!.session.part(), id)).toBeNull();
  });

  test('viewing refuses every frame edit', () => {
    const editor = mount();
    const id = select(editor);
    expect(editor.exec({ type: 'setEditingMode', mode: 'viewing' }).ok).toBe(true);
    const result = editor.exec({
      type: 'setImageProperties',
      widthEmu: 1_000_000,
      heightEmu: 500_000,
    });
    expect(result.ok).toBe(false);
    expect(canMoveInlineImage(editor, id)).toBe(false);
    expect(sizes(editor).frame).toEqual(['2000000', '1000000']);
  });
});

describe('inline chart move', () => {
  test('an inline chart moves to another paragraph like a picture', () => {
    const editor = mount();
    const surface = editor.surface!;
    const [first] = surface.session.paragraphIds();
    surface.setSelection({
      anchor: { paragraphId: first!, offset: 4 },
      head: { paragraphId: first!, offset: 4 },
    });
    expect(editor.exec({ type: 'insertChart', chartType: 'columnClustered' }).ok).toBe(true);
    const chartId = editor.snapshot().chart!.drawingNodeId;
    const target = paragraphContainingNode(surface.session.part(), diagramId(editor))!.id;
    expect(canMoveInlineImage(editor, chartId)).toBe(true);
    const moved = moveInlineImage(
      surface,
      chartId,
      { paragraphId: target, offset: 0 },
      surface.session.packageRevision()
    );
    expect(moved.committed).toBe(true);
    expect(paragraphContainingNode(surface.session.part(), chartId)?.id).toBe(target);
    expect(editor.snapshot().chart?.drawingNodeId).toBe(chartId);
  });
});
