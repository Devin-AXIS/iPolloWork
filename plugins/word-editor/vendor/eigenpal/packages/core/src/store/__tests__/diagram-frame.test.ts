import { describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { readOoxmlPackage, type OoxmlPackage } from '../package/ooxml-package.ts';
import {
  diagramDrawingPartName,
  holdsDiagramGraphic,
  scaleDiagramDrawing,
  withRescaledDiagramDrawing,
} from '../package/diagram-frame.ts';
import type { OoxmlElement, OoxmlNode } from '../package/ooxml-tree.ts';
import { simpleTextBody, smartArtDocx } from './smartart-fixture.ts';

function open(bytes: Uint8Array): OoxmlPackage {
  const read = readOoxmlPackage(bytes);
  if (!read.ok) throw new Error('package failed to read');
  return read.package;
}

function find(node: OoxmlNode, match: (node: OoxmlElement) => boolean): OoxmlElement[] {
  if (node.kind === 'textValue') return [];
  return [...(match(node) ? [node] : []), ...node.children.flatMap((kid) => find(kid, match))];
}

const attr = (node: OoxmlElement, name: string) =>
  node.attributes.find((a) => a.localName === name && a.namespaceUri === '')?.value;

function diagramDrawing(pkg: OoxmlPackage): OoxmlElement {
  return find(pkg.parts.get('/word/document.xml')!.root, (node) => node.kind === 'drawing')[0]!;
}

const SHAPES = [
  {
    off: [100_000, 200_000] as const,
    ext: [1_000_000, 500_000] as const,
    ln: '<a:ln w="25400"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>',
    txBody: simpleTextBody('Plan', 1868),
    txXfrm: { off: [120_000, 220_000] as const, ext: [960_000, 460_000] as const },
  },
  {
    group: {
      off: [1_200_000, 0] as const,
      ext: [800_000, 400_000] as const,
      chOff: [0, 0] as const,
      chExt: [800_000, 400_000] as const,
    },
    children: [{ off: [0, 0] as const, ext: [800_000, 400_000] as const }],
  },
];

describe('diagram frame', () => {
  test('finds the diagram drawing and its saved drawing part', () => {
    const pkg = open(smartArtDocx({ shapes: SHAPES, extent: [2_000_000, 1_000_000] }));
    const drawing = diagramDrawing(pkg);
    expect(holdsDiagramGraphic(drawing)).toBe(true);
    expect(diagramDrawingPartName(pkg, '/word/document.xml', drawing)).toBe(
      '/word/diagrams/drawing1.xml'
    );
  });

  test('scales positions on each axis and font sizes by the smaller axis, in whole points', () => {
    const pkg = open(smartArtDocx({ shapes: SHAPES, extent: [2_000_000, 1_000_000] }));
    const root = pkg.parts.get('/word/diagrams/drawing1.xml')!.root;
    const scaled = scaleDiagramDrawing(root, 1.3, 0.7);
    const offsets = find(scaled, (n) => n.localName === 'off').map((n) => [
      attr(n, 'x'),
      attr(n, 'y'),
    ]);
    // The shape, its text rectangle, the group, and the group member.
    expect(offsets).toEqual([
      ['130000', '140000'],
      ['156000', '154000'],
      ['1560000', '0'],
      ['0', '0'],
    ]);
    const group = find(scaled, (n) => n.localName === 'chExt')[0]!;
    expect([attr(group, 'cx'), attr(group, 'cy')]).toEqual(['1040000', '280000']);
    // 18.68 pt at 0.7 is 13.076 pt, which rounds to a whole 13 pt.
    expect(find(scaled, (n) => n.localName === 'rPr').map((n) => attr(n, 'sz'))).toEqual(['1300']);
    // Line widths and node ids keep their values.
    expect(find(scaled, (n) => n.localName === 'ln').map((n) => attr(n, 'w'))).toEqual(['25400']);
    expect(scaled.id).toBe(root.id);
    expect(scaleDiagramDrawing(root, 1, 1)).toBe(root);
  });

  test('rescales the saved drawing part, and leaves a package without one unchanged', () => {
    const pkg = open(smartArtDocx({ shapes: SHAPES, extent: [2_000_000, 1_000_000] }));
    const drawing = diagramDrawing(pkg);
    const from = { cx: 2_000_000, cy: 1_000_000 };
    const next = withRescaledDiagramDrawing(pkg, '/word/document.xml', drawing, from, {
      cx: 1_000_000,
      cy: 500_000,
    })!;
    expect(next).not.toBe(pkg);
    const first = find(next.parts.get('/word/diagrams/drawing1.xml')!.root, (n) => {
      return n.localName === 'ext';
    })[0]!;
    expect([attr(first, 'cx'), attr(first, 'cy')]).toEqual(['500000', '250000']);
    expect(withRescaledDiagramDrawing(pkg, '/word/document.xml', drawing, from, from)).toBe(pkg);

    const bare = open(
      smartArtDocx({ shapes: SHAPES, extent: [2_000_000, 1_000_000], drawingRelationship: 'none' })
    );
    expect(
      withRescaledDiagramDrawing(bare, '/word/document.xml', diagramDrawing(bare), from, {
        cx: 1,
        cy: 1,
      })
    ).toBe(bare);
  });

  test('refuses a rescale that would leave the coordinate range', () => {
    const pkg = open(smartArtDocx({ shapes: SHAPES, extent: [1, 1] }));
    const root = pkg.parts.get('/word/diagrams/drawing1.xml')!.root;
    expect(scaleDiagramDrawing(root, 100_000_000, 100_000_000)).toBeNull();
    const drawing = diagramDrawing(pkg);
    const to = { cx: 100_000_000, cy: 100_000_000 };
    const from = { cx: 1, cy: 1 };
    expect(withRescaledDiagramDrawing(pkg, '/word/document.xml', drawing, from, to)).toBeNull();
  });

  test('refuses a rescale of a drawing part that two diagrams share', () => {
    const files = unzipSync(smartArtDocx({ shapes: SHAPES, extent: [2_000_000, 1_000_000] }));
    const xml = strFromU8(files['word/document.xml']!);
    const paragraph = /<w:p><w:r><w:drawing>.*?<\/w:drawing><\/w:r><\/w:p>/.exec(xml)![0];
    files['word/document.xml'] = strToU8(xml.replace(paragraph, paragraph + paragraph));
    const pkg = open(zipSync(files));
    const from = { cx: 2_000_000, cy: 1_000_000 };
    const to = { cx: 1_000_000, cy: 500_000 };
    const drawing = diagramDrawing(pkg);
    expect(withRescaledDiagramDrawing(pkg, '/word/document.xml', drawing, from, to)).toBeNull();
  });
});
