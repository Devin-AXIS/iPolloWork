// SmartArt projections stay honest: text a shape cannot show refuses the diagram, quarter-turned
// text lays out in the turned box, and theme or diagram part changes re-project instead of
// reusing a stale result.

import { describe, expect, test } from 'bun:test';
import { createInlineDrawingLayoutBundle } from '../../layout/inline-drawing-source.ts';
import { projectDrawingsInPackage, type DrawingProjection } from '../package/drawing-projection.ts';
import type { OoxmlPackage } from '../package/ooxml-package.ts';
import { readOoxmlPart, type OoxmlElement, type OoxmlNode } from '../package/ooxml-tree.ts';
import { simpleTextBody, smartArtPackage } from './smartart-fixture.ts';
import { diagramPartsToken } from '../package/diagram-parts.ts';

function projectOf(pkg: OoxmlPackage): DrawingProjection {
  const projections = projectDrawingsInPackage(pkg);
  expect(projections).toHaveLength(1);
  return projections[0]!;
}

const FILL = '<a:solidFill><a:schemeClr val="accent1"/></a:solidFill>';

function withPart(pkg: OoxmlPackage, name: string, root: OoxmlElement): OoxmlPackage {
  const parts = new Map(pkg.parts);
  parts.set(name, { ...parts.get(name)!, root });
  return { ...pkg, parts };
}

/** The same element tree with every `srgbClr` value replaced. */
function recolor(node: OoxmlNode, hex: string): OoxmlNode {
  if (node.kind === 'textValue') return node;
  if (node.localName === 'srgbClr') {
    return {
      ...node,
      attributes: node.attributes.map((attribute) =>
        attribute.localName === 'val' ? { ...attribute, value: hex } : attribute
      ),
    } as OoxmlNode;
  }
  const children = node.children.map((child) => recolor(child, hex));
  return children.some((child, index) => child !== node.children[index])
    ? ({ ...node, children } as OoxmlNode)
    : node;
}

describe('diagram text the lowering cannot express', () => {
  test('an unsupported vertical mode leaves the diagram to its placeholder', () => {
    const projection = projectOf(
      smartArtPackage({
        shapes: [
          {
            preset: 'rect',
            off: [0, 0],
            ext: [1000000, 500000],
            txBody: simpleTextBody('Vertical', 1800, 'vert="eaVert"'),
          },
        ],
      })
    );
    expect(projection.vectorShape).toBeNull();
    expect(projection.groupTextboxes).toBeUndefined();
    expect(projection.diagnostics.some((d) => d.code === 'unsupported-graphic')).toBe(true);
  });

  test('vertical text turns a quarter and lays out in the turned box', () => {
    const projection = projectOf(
      smartArtPackage({
        shapes: [
          {
            preset: 'rect',
            off: [0, 0],
            ext: [400000, 1200000],
            txBody: simpleTextBody('Upward', 1800, 'vert="vert270"'),
          },
        ],
      })
    );
    const [member] = projection.groupTextboxes!;
    expect(member!.rotationDegrees).toBe(270);
    // The 400000 x 1200000 box turns about its centre (200000, 600000).
    expect(member!.frameEmu).toEqual({ x: -400000, y: 400000, cx: 1200000, cy: 400000 });
  });
});

describe('diagram shape shadows', () => {
  test('a shadow turns with its shape unless rotWithShape is off', () => {
    const shadowed = (rotWithShape: string) =>
      projectOf(
        smartArtPackage({
          shapes: [
            {
              preset: 'rect',
              off: [0, 0],
              ext: [100000, 100000],
              rot: 5400000,
              fill: '<a:solidFill><a:srgbClr val="4472C4"/></a:solidFill>',
              extraSpPr:
                `<a:effectLst><a:outerShdw dist="127000" dir="0"${rotWithShape}>` +
                '<a:srgbClr val="000000"/></a:outerShdw></a:effectLst>',
            },
          ],
        })
      ).vectorShape!.components[0]!.shadow!;
    const turned = shadowed('');
    expect(turned.dxEmu).toBeCloseTo(0, 3);
    expect(turned.dyEmu).toBeCloseTo(127000, 3);
    const fixed = shadowed(' rotWithShape="0"');
    expect(fixed.dxEmu).toBeCloseTo(127000, 3);
    expect(fixed.dyEmu).toBeCloseTo(0, 3);
  });
});

describe('diagram projection invalidation', () => {
  const options = { shapes: [{ preset: 'rect', off: [0, 0], ext: [1000, 1000], fill: FILL }] };

  test('an unchanged package revision reuses the lowered text that layout keys on', () => {
    const pkg = smartArtPackage({
      shapes: [
        { preset: 'rect', off: [0, 0], ext: [1000000, 500000], txBody: simpleTextBody('Kept') },
      ],
    });
    const first = projectOf(pkg).groupTextboxes![0]!.story.content;
    const second = projectOf({ ...pkg, parts: new Map(pkg.parts) }).groupTextboxes![0]!.story
      .content;
    expect(second).toBe(first);
  });

  test('a theme change re-projects theme colours', () => {
    const pkg = smartArtPackage(options as never);
    expect(projectOf(pkg).vectorShape!.components[0]!.fillHex).toBe('4F81BD');
    const theme = pkg.parts.get('/word/theme/theme1.xml')!.root;
    const changed = withPart(
      pkg,
      '/word/theme/theme1.xml',
      recolor(theme, '00AA00') as OoxmlElement
    );
    expect(projectOf(changed).vectorShape!.components[0]!.fillHex).toBe('00AA00');
  });

  test('layout re-projects a drawing whose diagram part changed', () => {
    let pkg = smartArtPackage({
      shapes: [
        {
          preset: 'rect',
          off: [0, 0],
          ext: [1000, 1000],
          fill: '<a:solidFill><a:srgbClr val="4F81BD"/></a:solidFill>',
        },
      ],
    });
    let revision = 0;
    const reader = {
      packageRevision: () => revision,
      currentPackage: () => pkg,
      part: () => pkg.parts.get(pkg.mainDocumentPart)!,
    };
    const bundle = createInlineDrawingLayoutBundle({
      session: reader,
      decodePort: {
        decode: async () => {
          throw new Error('unused');
        },
      },
      onResourcesChanged: () => {},
    } as never);
    try {
      const id = projectOf(pkg).drawingNodeId;
      expect(bundle.bodyContext.projectionForAtom!(id)?.vectorShape?.components[0]?.fillHex).toBe(
        '4F81BD'
      );
      const drawing = pkg.parts.get('/word/diagrams/drawing1.xml')!.root;
      pkg = withPart(
        pkg,
        '/word/diagrams/drawing1.xml',
        recolor(drawing, 'FF0000') as OoxmlElement
      );
      revision += 1;
      bundle.sync(reader as never);
      expect(bundle.bodyContext.projectionForAtom!(id)?.vectorShape?.components[0]?.fillHex).toBe(
        'FF0000'
      );
    } finally {
      bundle.dispose();
    }
  });

  test('the diagram part token follows diagram roots wherever their parts live', () => {
    const pkg = smartArtPackage({
      shapes: [
        {
          preset: 'rect',
          off: [0, 0],
          ext: [1000, 1000],
          fill: '<a:solidFill><a:srgbClr val="4F81BD"/></a:solidFill>',
        },
      ],
    });
    const drawing = pkg.parts.get('/word/diagrams/drawing1.xml')!;
    const parts = new Map(pkg.parts);
    parts.delete('/word/diagrams/drawing1.xml');
    parts.set('/word/custom/shapes.xml', { ...drawing, name: '/word/custom/shapes.xml' });
    const moved = { ...pkg, parts };
    const before = diagramPartsToken(moved);
    const recolored = withPart(
      moved,
      '/word/custom/shapes.xml',
      recolor(drawing.root, 'FF0000') as OoxmlElement
    );
    expect(diagramPartsToken(recolored)).not.toBe(before);
    expect(diagramPartsToken({ ...moved, parts: new Map(moved.parts) })).toBe(before);
  });

  test('the recolouring helper parses back as the same structure', () => {
    const parsed = readOoxmlPart('<a:x xmlns:a="urn:a"><a:srgbClr val="000000"/></a:x>', {
      name: '/x.xml',
      contentType: 'application/xml',
    });
    if (!parsed.ok) throw new Error(parsed.reason);
    const recolored = recolor(parsed.part.root, 'ABCDEF') as OoxmlElement;
    expect(JSON.stringify(recolored)).toContain('ABCDEF');
  });
});
