import { describe, expect, test } from 'bun:test';
import {
  canonicalOoxmlFingerprint,
  readOoxmlPart,
  validateOoxmlPart,
  type OoxmlDrawingNode,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import {
  IMAGE_WRAP_TARGETS,
  projectDrawing,
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  DEFAULT_SUPPORTED_MC_REQUIRES,
  type ImageWrapTarget,
} from '../package/drawing-projection.ts';
import { applyTreeOp, paragraphTextOf, validateTreeOp, type TreeDocOp } from '../store/tree-ops.ts';
import { formsProtectionRefusal } from '../store/tree-op-content-controls.ts';
import { drawingOpImpact, wrapTargetToAnchorSpec } from '../store/tree-op-drawings.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const CHART_URI = 'http://schemas.openxmlformats.org/drawingml/2006/chart';

const metadata = {
  name: '/word/document.xml',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
};

function parse(xml: string): OoxmlPart {
  const result = readOoxmlPart(xml, metadata);
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function apply(part: OoxmlPart, op: TreeDocOp): OoxmlPart {
  const result = applyTreeOp(part, op);
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  expect(validateOoxmlPart(result.part).ok).toBe(true);
  return result.part;
}

function refuse(part: OoxmlPart, op: TreeDocOp): string {
  const result = applyTreeOp(part, op);
  if (result.ok) throw new Error('expected rejection');
  return result.reason;
}

function drawingOf(part: OoxmlPart): OoxmlDrawingNode {
  const stack: OoxmlElement[] = [part.root];
  while (stack.length > 0) {
    const node = stack.shift()!;
    if (node.kind === 'drawing') return node;
    for (const child of node.children) {
      if (child.kind !== 'textValue') stack.push(child);
    }
  }
  throw new Error('missing drawing');
}

function inlinePictureDrawing(
  options: {
    readonly extent?: string;
    readonly embed?: string;
    readonly docPr?: string;
    readonly extraGeneric?: string;
  } = {}
): string {
  const extent = options.extent ?? 'cx="152400" cy="152400"';
  const docPr = options.docPr ?? 'id="1" name="green" descr="Green square" title="Green"';
  const extra = options.extraGeneric ?? '';
  return (
    `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    '<w:body><w:p><w:r><w:drawing>' +
    `<wp:inline distT="100" distB="200" distL="300" distR="400">` +
    `<wp:extent ${extent}/>` +
    '<wp:effectExtent l="10" t="20" r="30" b="40"/>' +
    `<wp:docPr ${docPr}/>` +
    '<wp:cNvGraphicFramePr/>' +
    `<a:graphic><a:graphicData uri="${PIC_URI}">` +
    '<pic:pic>' +
    '<pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
    `<pic:blipFill><a:blip r:embed="${options.embed ?? 'rId14'}"/>` +
    '<a:srcRect l="10000" t="20000" r="30000" b="40000"/>' +
    '<a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm rot="0"><a:ext cx="152400" cy="152400"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic>' +
    extra +
    '</wp:inline></w:drawing></w:r></w:p></w:body></w:document>'
  );
}

function anchoredPictureDrawing(
  options: {
    readonly wrap?: string;
    readonly anchorAttrs?: string;
  } = {}
): string {
  const wrap =
    options.wrap ?? '<wp:wrapSquare wrapText="left" distT="1" distB="2" distL="3" distR="4"/>';
  const anchorAttrs =
    options.anchorAttrs ??
    'distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" relativeHeight="952500" allowOverlap="1" layoutInCell="1"';
  return (
    `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body><w:p><w:r><w:drawing>` +
    `<wp:anchor ${anchorAttrs}>` +
    '<wp:simplePos x="100" y="200"/>' +
    '<wp:positionH relativeFrom="page"><wp:align>center</wp:align></wp:positionH>' +
    '<wp:positionV relativeFrom="line"><wp:posOffset>914400</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="952500" cy="952500"/>' +
    wrap +
    '<wp:docPr id="7" name="Picture 3" descr="Floating" title="Title text"/>' +
    '<wp:cNvGraphicFramePr/>' +
    `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic>` +
    '<pic:nvPicPr><pic:cNvPr id="7" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rId15"/></pic:blipFill>' +
    '<pic:spPr><a:xfrm rot="0"><a:ext cx="952500" cy="952500"/></a:xfrm><a:prstGeom prst="ellipse"/></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic>' +
    '</wp:anchor></w:drawing></w:r></w:p></w:body></w:document>'
  );
}

function extentOf(part: OoxmlPart): { cx: string; cy: string } {
  const walk = (node: OoxmlNode): { cx: string; cy: string } | null => {
    if (node.kind === 'textValue') return null;
    if (
      node.kind === 'drawingExtent' ||
      (node.localName === 'extent' && node.namespaceUri === WP)
    ) {
      const cx = node.attributes.find((a) => a.localName === 'cx')?.value;
      const cy = node.attributes.find((a) => a.localName === 'cy')?.value;
      return { cx: cx!, cy: cy! };
    }
    for (const child of node.children) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  const found = walk(part.root);
  if (!found) throw new Error('no extent');
  return found;
}

function findById(node: OoxmlNode, id: string): OoxmlNode | null {
  if (node.kind === 'textValue') return node.id === id ? node : null;
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findById(child, id);
    if (found) return found;
  }
  return null;
}

function firstNamed(part: OoxmlPart, localName: string): OoxmlNode {
  const visit = (node: OoxmlNode): OoxmlNode | null => {
    if (node.kind === 'textValue') return null;
    if (node.localName === localName) return node;
    for (const child of node.children) {
      const found = visit(child);
      if (found) return found;
    }
    return null;
  };
  const found = visit(part.root);
  if (!found) throw new Error(`no ${localName}`);
  return found;
}

function hasDescendant(node: OoxmlNode, kind: OoxmlNode['kind']): boolean {
  if (node.kind === kind) return true;
  return node.kind !== 'textValue' && node.children.some((child) => hasDescendant(child, kind));
}

function paragraphIdOf(part: OoxmlPart): string {
  const body = part.root.children[0] as OoxmlElement;
  return (body.children[0] as OoxmlElement).id;
}

describe('resizes drawing', () => {
  test('updates wp:extent and preserves unrelated generic siblings', () => {
    const part = parse(inlinePictureDrawing());
    const drawing = drawingOf(part);
    const docPrBefore = findById(part.root, drawing.id)!;
    const walkDocPr = (n: OoxmlNode): OoxmlNode | null => {
      if (n.kind === 'textValue') return null;
      if (n.kind === 'drawingDocPr' || n.localName === 'docPr') return n;
      for (const c of n.children) {
        const f = walkDocPr(c);
        if (f) return f;
      }
      return null;
    };
    const docPrFp = canonicalOoxmlFingerprint(walkDocPr(docPrBefore)! as OoxmlElement);
    const next = apply(part, {
      op: 'resizeDrawing',
      drawingNodeId: drawing.id,
      extentEmu: { cx: 914400, cy: 457200 },
    });
    expect(extentOf(next)).toEqual({ cx: '914400', cy: '457200' });
    expect(
      canonicalOoxmlFingerprint(walkDocPr(findById(next.root, drawing.id)!)! as OoxmlElement)
    ).toBe(docPrFp);
    expect(
      drawingOpImpact({
        op: 'resizeDrawing',
        drawingNodeId: drawing.id,
        extentEmu: { cx: 1, cy: 1 },
      })
    ).toBe('flow-structural');
  });
});

describe('replaces drawing resource', () => {
  test('swaps r:embed on the picture blip', () => {
    const part = parse(inlinePictureDrawing());
    const drawing = drawingOf(part);
    const next = apply(part, {
      op: 'replaceDrawingResource',
      drawingNodeId: drawing.id,
      relationshipId: 'rId99',
    });
    const walk = (node: OoxmlNode): string | null => {
      if (node.kind === 'textValue') return null;
      if (node.kind === 'pictureBlip' || node.localName === 'blip') {
        return node.attributes.find((a) => a.localName === 'embed')?.value ?? null;
      }
      for (const child of node.children) {
        const found = walk(child);
        if (found) return found;
      }
      return null;
    };
    expect(walk(next.root)).toBe('rId99');
  });
});

describe('crops drawing', () => {
  test('writes a:srcRect permille without touching extent', () => {
    const part = parse(inlinePictureDrawing());
    const drawing = drawingOf(part);
    const beforeExtent = extentOf(part);
    const next = apply(part, {
      op: 'cropDrawing',
      drawingNodeId: drawing.id,
      crop: { left: 5000, top: 10000, right: 15000, bottom: 20000 },
    });
    expect(extentOf(next)).toEqual(beforeExtent);
    const walk = (node: OoxmlNode): string | null => {
      if (node.kind === 'textValue') return null;
      if (node.kind === 'pictureSrcRect' || node.localName === 'srcRect') {
        const l = node.attributes.find((a) => a.localName === 'l')?.value;
        return l ?? null;
      }
      for (const child of node.children) {
        const found = walk(child);
        if (found) return found;
      }
      return null;
    };
    expect(walk(next.root)).toBe('5000');
  });
});

describe('positions drawing', () => {
  test('updates posOffset on an anchored drawing', () => {
    const part = parse(anchoredPictureDrawing());
    const drawing = drawingOf(part);
    const next = apply(part, {
      op: 'positionDrawing',
      drawingNodeId: drawing.id,
      position: { verticalEmu: 1234567, relativeToV: 'paragraph' },
    });
    const posOffset = (n: OoxmlNode): string | null => {
      if (n.kind === 'textValue') return null;
      if (n.kind === 'drawingPositionV' || (n.localName === 'positionV' && n.namespaceUri === WP)) {
        const off = n.children.find(
          (c) => c.kind === 'drawingPositionOffset' || c.localName === 'posOffset'
        );
        if (off && off.kind !== 'textValue') {
          const text = off.children.find((c) => c.kind === 'textValue');
          return text && text.kind === 'textValue' ? text.value : null;
        }
      }
      for (const c of n.children) {
        const found = posOffset(c);
        if (found) return found;
      }
      return null;
    };
    expect(posOffset(next.root)).toBe('1234567');
  });
});

describe('sets drawing wrap', () => {
  test.each(IMAGE_WRAP_TARGETS)('round-trips %s through wrapTargetToAnchorSpec', (target) => {
    const spec = wrapTargetToAnchorSpec(target);
    expect(spec).toBeDefined();
    if (target === 'behind') expect(spec.behindDocument).toBe(true);
    if (target === 'inFront') expect(spec.behindDocument).toBe(false);
    if (target === 'squareLeft') expect(spec.wrapText).toBe('left');
    if (target === 'squareRight') expect(spec.wrapText).toBe('right');
  });

  test('converts inline to anchored square in one transaction', () => {
    const part = parse(inlinePictureDrawing());
    const drawing = drawingOf(part);
    const next = apply(part, { op: 'setDrawingWrap', drawingNodeId: drawing.id, wrap: 'square' });
    expect(findById(next.root, drawing.id)?.children[0]?.kind).toBe('anchoredDrawing');
  });

  test('converts anchored to inline', () => {
    const part = parse(anchoredPictureDrawing());
    const drawing = drawingOf(part);
    const next = apply(part, { op: 'setDrawingWrap', drawingNodeId: drawing.id, wrap: 'inline' });
    expect(findById(next.root, drawing.id)?.children[0]?.kind).toBe('inlineDrawing');
  });

  test('wrap changes keep unsigned distance spellings and write malformed ones as zero', () => {
    const attrs = (node: OoxmlNode | undefined) =>
      Object.fromEntries(
        (node as OoxmlElement).attributes
          .filter((a) => a.localName.startsWith('dist'))
          .map((a) => [a.localName, a.value])
      );
    const part = parse(
      anchoredPictureDrawing({
        wrap: '<wp:wrapSquare wrapText="bothSides" distT="4294967291" distB="abc" distL="-5" distR="12700"/>',
        anchorAttrs:
          'distT="4294967291" distB="0" distL="114300" distR="114300" simplePos="0" behindDoc="0" locked="0" relativeHeight="952500" allowOverlap="1" layoutInCell="1"',
      })
    );
    const drawing = drawingOf(part);
    const square = apply(part, {
      op: 'setDrawingWrap',
      drawingNodeId: drawing.id,
      wrap: 'squareRight',
    });
    const anchor = findById(square.root, drawing.id)!.children[0] as OoxmlElement;
    const wrap = anchor.children.find((c) => c.kind === 'drawingWrapSquare');
    expect(attrs(wrap)).toEqual({ distT: '4294967291', distB: '0', distL: '0', distR: '12700' });
    const inline = apply(part, { op: 'setDrawingWrap', drawingNodeId: drawing.id, wrap: 'inline' });
    expect(attrs(findById(inline.root, drawing.id)!.children[0])).toEqual({
      distT: '4294967291',
      distR: '114300',
      distB: '0',
      distL: '114300',
    });
  });

  test('wrap changes keep inherited anchor distances for sides the old wrap omits', () => {
    const project = (part: OoxmlPart) =>
      projectDrawing(drawingOf(part), {
        ownerPartName: metadata.name,
        supportedMcRequires: DEFAULT_SUPPORTED_MC_REQUIRES,
        limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
      });
    const distances = (part: OoxmlPart) => {
      const projection = project(part);
      return projection.wrapGeometry?.distancesEmu ?? projection.inlineDistancesEmu;
    };
    const wrapAttrs = (part: OoxmlPart) => {
      const anchor = drawingOf(part).children[0] as OoxmlElement;
      const wrap = anchor.children.find(
        (c) => c.kind !== 'textValue' && c.localName.startsWith('wrap')
      ) as OoxmlElement;
      return wrap.attributes.filter((a) => a.localName.startsWith('dist')).map((a) => a.localName);
    };
    const anchorAttrs = (distances: string) =>
      `${distances} simplePos="0" behindDoc="0" locked="0" relativeHeight="952500" allowOverlap="1" layoutInCell="1"`;
    const tightWrap = (attrs: string) =>
      `<wp:wrapTight wrapText="bothSides" ${attrs}><wp:wrapPolygon edited="0"><wp:start x="0" y="0"/><wp:lineTo x="0" y="21600"/><wp:lineTo x="21600" y="21600"/><wp:lineTo x="21600" y="0"/><wp:lineTo x="0" y="0"/></wp:wrapPolygon></wp:wrapTight>`;
    const cases: readonly { source: string; wrap: ImageWrapTarget; kept: string[] }[] = [
      {
        source: anchoredPictureDrawing({
          wrap: '<wp:wrapSquare wrapText="bothSides"/>',
          anchorAttrs: anchorAttrs('distT="0" distB="0" distL="114300" distR="114300"'),
        }),
        wrap: 'squareLeft',
        kept: [],
      },
      {
        source: anchoredPictureDrawing({
          wrap: tightWrap('distL="10" distR="20"'),
          anchorAttrs: anchorAttrs('distT="50800" distB="50800" distL="0" distR="0"'),
        }),
        wrap: 'square',
        kept: ['distL', 'distR'],
      },
      {
        source: anchoredPictureDrawing({
          wrap: '<wp:wrapSquare wrapText="bothSides" distT="4294967291"/>',
          anchorAttrs: anchorAttrs('distT="12700" distB="25400" distL="38100" distR="50800"'),
        }),
        wrap: 'topAndBottom',
        kept: ['distT'],
      },
      { source: inlinePictureDrawing(), wrap: 'square', kept: [] },
    ];
    for (const { source, wrap, kept } of cases) {
      const part = parse(source);
      const next = apply(part, { op: 'setDrawingWrap', drawingNodeId: drawingOf(part).id, wrap });
      expect(distances(next)).toEqual(distances(part));
      expect(wrapAttrs(next)).toEqual(kept);
    }
    // wrapNone carries no distances, so the anchor values apply after a change to square.
    const front = parse(
      anchoredPictureDrawing({
        wrap: '<wp:wrapNone/>',
        anchorAttrs: anchorAttrs('distT="1" distB="2" distL="3" distR="4"'),
      })
    );
    const square = apply(front, {
      op: 'setDrawingWrap',
      drawingNodeId: drawingOf(front).id,
      wrap: 'square',
    });
    expect(distances(square)).toEqual({ top: 1, right: 4, bottom: 2, left: 3 });
    expect(wrapAttrs(square)).toEqual([]);
  });

  test('behind and inFront both use wrapNone differing only by behindDoc', () => {
    const behindPart = parse(
      anchoredPictureDrawing({ wrap: '<wp:wrapSquare wrapText="bothSides"/>' })
    );
    const drawing = drawingOf(behindPart);
    const behind = apply(behindPart, {
      op: 'setDrawingWrap',
      drawingNodeId: drawing.id,
      wrap: 'behind',
    });
    const front = apply(behindPart, {
      op: 'setDrawingWrap',
      drawingNodeId: drawing.id,
      wrap: 'inFront',
    });
    const anchor = (p: OoxmlPart) => findById(p.root, drawing.id)!.children[0] as OoxmlElement;
    expect(anchor(behind).attributes.find((a) => a.localName === 'behindDoc')?.value).toBe('1');
    expect(anchor(front).attributes.find((a) => a.localName === 'behindDoc')?.value).toBe('0');
    const wrapKind = (p: OoxmlPart) =>
      anchor(p).children.find(
        (c) => c.kind !== 'textValue' && String(c.localName).startsWith('wrap')
      )?.localName;
    expect(wrapKind(behind)).toBe('wrapNone');
    expect(wrapKind(front)).toBe('wrapNone');
  });
});

describe('sets drawing metadata', () => {
  test('updates title and descr with text-local impact', () => {
    const part = parse(inlinePictureDrawing());
    const drawing = drawingOf(part);
    const next = apply(part, {
      op: 'setDrawingMetadata',
      drawingNodeId: drawing.id,
      title: 'Banner title',
      description: 'Accessible description',
      hyperlink: null,
    });
    const projection = projectDrawing(drawingOf(next), {
      ownerPartName: metadata.name,
      supportedMcRequires: DEFAULT_SUPPORTED_MC_REQUIRES,
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    });
    expect(projection?.title).toBe('Banner title');
    expect(projection?.description).toBe('Accessible description');
    expect(
      drawingOpImpact({
        op: 'setDrawingMetadata',
        drawingNodeId: drawing.id,
        title: '',
        description: '',
        hyperlink: null,
      })
    ).toBe('text-local');
  });

  test('refuses unsafe hyperlink before mutation', () => {
    const part = parse(inlinePictureDrawing());
    const drawing = drawingOf(part);
    const before = canonicalOoxmlFingerprint(part.root);
    expect(
      refuse(part, {
        op: 'setDrawingMetadata',
        drawingNodeId: drawing.id,
        title: '',
        description: '',
        hyperlink: 'javascript:alert(1)',
      })
    ).toBe('invalid-drawing-value');
    expect(canonicalOoxmlFingerprint(part.root)).toBe(before);
  });
});

describe('sets drawing locks', () => {
  test('writes graphicFrameLocks and anchor locked flag', () => {
    const part = parse(inlinePictureDrawing());
    const drawing = drawingOf(part);
    const next = apply(part, {
      op: 'setDrawingLocks',
      drawingNodeId: drawing.id,
      locks: { resize: true, move: true },
    });
    const frameLocks = (p: OoxmlPart): boolean => {
      const walk = (n: OoxmlNode): boolean => {
        if (n.kind === 'textValue') return false;
        if (n.localName === 'graphicFrameLocks') {
          return n.attributes.some((a) => a.localName === 'noResize' && a.value === '1');
        }
        return n.children.some((c) => walk(c));
      };
      return walk(p.root);
    };
    expect(frameLocks(next)).toBe(true);
    const anchorLocked = (p: OoxmlPart): boolean => {
      const walk = (n: OoxmlNode): boolean => {
        if (n.kind === 'textValue') return false;
        if (n.localName === 'anchor' || n.kind === 'anchoredDrawing') {
          return n.attributes.some((a) => a.localName === 'locked' && a.value === '1');
        }
        return n.children.some((c) => walk(c));
      };
      return walk(p.root);
    };
    expect(anchorLocked(next)).toBe(false);
  });
});

describe('inserts drawing', () => {
  test('forms protection resolves a terminal wrapper drawing inside its control', () => {
    const host = parse(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:sdt><w:sdtPr/>` +
        '<w:sdtContent><w:smartTag><w:r><w:t>B</w:t></w:r></w:smartTag>' +
        '</w:sdtContent></w:sdt></w:p></w:body></w:document>'
    );
    const settings = readOoxmlPart(
      `<w:settings xmlns:w="${W}"><w:documentProtection w:edit="forms" ` +
        'w:enforcement="1"/></w:settings>',
      {
        name: '/word/settings.xml',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml',
      }
    );
    if (!settings.ok) throw new Error(settings.reason);
    const op: TreeDocOp = {
      op: 'insertDrawing',
      paragraphId: paragraphIdOf(host),
      offset: 1,
      drawing: drawingOf(parse(inlinePictureDrawing())),
    };
    expect(formsProtectionRefusal(host, settings.part, op)).toBeNull();
    const next = apply(host, op);
    const control = firstNamed(next, 'sdt');
    expect(hasDescendant(control, 'drawing')).toBe(true);
  });

  test('places a picture drawing atom at a legal paragraph offset', () => {
    const host = parse(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Hi</w:t></w:r></w:p></w:body></w:document>`
    );
    const template = parse(inlinePictureDrawing());
    const templateDrawing = drawingOf(template);
    const paragraphId = paragraphIdOf(host);
    const next = apply(host, {
      op: 'insertDrawing',
      paragraphId,
      offset: 2,
      drawing: templateDrawing,
    });
    expect(
      validateTreeOp(next, { op: 'insertText', paragraphId, offset: 2, text: '!' })
    ).toBeNull();
  });

  const trailingWrappers = [
    {
      name: 'smartTag',
      xml: '<w:smartTag><w:r><w:t>B</w:t></w:r></w:smartTag>',
    },
    {
      name: 'hyperlink',
      xml: '<w:hyperlink w:anchor="target"><w:r><w:t>B</w:t></w:r></w:hyperlink>',
    },
    {
      name: 'ins',
      xml: '<w:ins w:id="7" w:author="Prior"><w:r><w:t>B</w:t></w:r></w:ins>',
    },
  ] as const;

  for (const wrapper of trailingWrappers) {
    test.each([false, true])(
      `places a trailing drawing after ${wrapper.name} at its stated offset (tracked=%s)`,
      (tracked) => {
        const host = parse(
          `<w:document xmlns:w="${W}"><w:body><w:p>` +
            `<w:r><w:t>A</w:t></w:r>${wrapper.xml}</w:p></w:body></w:document>`
        );
        const templateDrawing = drawingOf(parse(inlinePictureDrawing()));
        const paragraphId = paragraphIdOf(host);
        const wrapperId = firstNamed(host, wrapper.name).id;
        const op: TreeDocOp = {
          op: 'insertDrawing',
          paragraphId,
          offset: 2,
          drawing: templateDrawing,
          ...(tracked ? { revision: { author: 'Reviewer' } } : {}),
        };
        expect(validateTreeOp(host, op)).toBeNull();
        const next = apply(host, op);
        const updatedWrapper = findById(next.root, wrapperId)!;
        const paragraph = findById(next.root, paragraphId)!;
        if (paragraph.kind === 'textValue') throw new Error('paragraph became text');
        const wrapperIndex = paragraph.children.findIndex((child) => child.id === wrapperId);
        expect(paragraphTextOf(next, paragraphId)).toBe(`AB\uFFFC`);
        expect(hasDescendant(updatedWrapper, 'drawing')).toBe(false);
        expect(hasDescendant(paragraph.children[wrapperIndex + 1]!, 'drawing')).toBe(true);
      }
    );
  }

  test.each([false, true])(
    'places a leading drawing before a paragraph-initial smartTag (tracked=%s)',
    (tracked) => {
      const host = parse(
        `<w:document xmlns:w="${W}"><w:body><w:p>` +
          '<w:smartTag><w:r><w:t>B</w:t></w:r></w:smartTag>' +
          '</w:p></w:body></w:document>'
      );
      const paragraphId = paragraphIdOf(host);
      const wrapperId = firstNamed(host, 'smartTag').id;
      const op: TreeDocOp = {
        op: 'insertDrawing',
        paragraphId,
        offset: 0,
        drawing: drawingOf(parse(inlinePictureDrawing())),
        ...(tracked ? { revision: { author: 'Reviewer' } } : {}),
      };
      expect(validateTreeOp(host, op)).toBeNull();
      const next = apply(host, op);
      const paragraph = findById(next.root, paragraphId)!;
      if (paragraph.kind === 'textValue') throw new Error('paragraph became text');
      const wrapperIndex = paragraph.children.findIndex((child) => child.id === wrapperId);

      expect(paragraphTextOf(next, paragraphId)).toBe(`\uFFFCB`);
      expect(hasDescendant(findById(next.root, wrapperId)!, 'drawing')).toBe(false);
      expect(wrapperIndex).toBeGreaterThan(0);
      expect(hasDescendant(paragraph.children[wrapperIndex - 1]!, 'drawing')).toBe(true);
    }
  );

  test.each([false, true])(
    'places a boundary drawing between adjacent wrappers (tracked=%s)',
    (tracked) => {
      const host = parse(
        `<w:document xmlns:w="${W}"><w:body><w:p>` +
          '<w:smartTag><w:r><w:t>A</w:t></w:r></w:smartTag>' +
          '<w:customXml><w:r><w:t>B</w:t></w:r></w:customXml>' +
          '</w:p></w:body></w:document>'
      );
      const paragraphId = paragraphIdOf(host);
      const leftId = firstNamed(host, 'smartTag').id;
      const rightId = firstNamed(host, 'customXml').id;
      const op: TreeDocOp = {
        op: 'insertDrawing',
        paragraphId,
        offset: 1,
        drawing: drawingOf(parse(inlinePictureDrawing())),
        ...(tracked ? { revision: { author: 'Reviewer' } } : {}),
      };
      expect(validateTreeOp(host, op)).toBeNull();
      const next = apply(host, op);
      const paragraph = findById(next.root, paragraphId)!;
      if (paragraph.kind === 'textValue') throw new Error('paragraph became text');
      const leftIndex = paragraph.children.findIndex((child) => child.id === leftId);
      const rightIndex = paragraph.children.findIndex((child) => child.id === rightId);

      expect(paragraphTextOf(next, paragraphId)).toBe(`A\uFFFCB`);
      expect(hasDescendant(findById(next.root, leftId)!, 'drawing')).toBe(false);
      expect(hasDescendant(findById(next.root, rightId)!, 'drawing')).toBe(false);
      expect(rightIndex).toBeGreaterThan(leftIndex + 1);
      expect(hasDescendant(paragraph.children[leftIndex + 1]!, 'drawing')).toBe(true);
    }
  );

  test('validation and apply place a trailing drawing outside a nested locked control', () => {
    const host = parse(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:smartTag>` +
        '<w:sdt><w:sdtPr><w:lock w:val="sdtContentLocked"/></w:sdtPr>' +
        '<w:sdtContent><w:r><w:t>Hi</w:t></w:r></w:sdtContent></w:sdt>' +
        '</w:smartTag></w:p></w:body></w:document>'
    );
    const templateDrawing = drawingOf(parse(inlinePictureDrawing()));
    const paragraphId = paragraphIdOf(host);
    const control = (() => {
      const walk = (node: OoxmlNode): OoxmlNode | null => {
        if (node.kind === 'textValue') return null;
        if (node.kind === 'contentControl') return node;
        for (const child of node.children) {
          const found = walk(child);
          if (found) return found;
        }
        return null;
      };
      return walk(host.root);
    })();
    if (!control) throw new Error('no content control');
    const op: TreeDocOp = {
      op: 'insertDrawing',
      paragraphId,
      offset: 2,
      drawing: templateDrawing,
    };
    expect(validateTreeOp(host, op)).toBeNull();
    const next = apply(host, op);
    const updatedControl = findById(next.root, control.id)!;
    const paragraph = findById(next.root, paragraphId)!;
    if (paragraph.kind === 'textValue') throw new Error('paragraph became text');
    expect(hasDescendant(updatedControl, 'drawing')).toBe(false);
    expect(hasDescendant(paragraph.children.at(-1)!, 'drawing')).toBe(true);
  });
});

describe('deletes drawing', () => {
  test('removes the drawing node from its run', () => {
    const part = parse(inlinePictureDrawing());
    const drawing = drawingOf(part);
    const next = apply(part, { op: 'deleteDrawing', drawingNodeId: drawing.id });
    expect(findById(next.root, drawing.id)).toBeNull();
  });
});

describe('refuses invalid or locked drawing operations', () => {
  test('refuses unknown drawing id', () => {
    const part = parse(inlinePictureDrawing());
    expect(
      refuse(part, { op: 'resizeDrawing', drawingNodeId: 'missing', extentEmu: { cx: 1, cy: 1 } })
    ).toBe('unknown-drawing');
  });

  test('refuses descendant node id', () => {
    const part = parse(inlinePictureDrawing());
    const inline = findById(part.root, drawingOf(part).id)!.children[0]!;
    expect(
      refuse(part, { op: 'resizeDrawing', drawingNodeId: inline.id, extentEmu: { cx: 1, cy: 1 } })
    ).toBe('not-a-drawing');
  });

  test('refuses non-picture graphic', () => {
    const xml = inlinePictureDrawing().replace(`uri="${PIC_URI}"`, 'uri="urn:example:graphic"');
    const graphicPart = parse(xml);
    const drawing = drawingOf(graphicPart);
    expect(
      refuse(graphicPart, {
        op: 'resizeDrawing',
        drawingNodeId: drawing.id,
        extentEmu: { cx: 1, cy: 1 },
      })
    ).toBe('not-a-picture-drawing');
  });

  test('refuses picture edits on a chart graphic as a chart', () => {
    const xml = inlinePictureDrawing().replace(`uri="${PIC_URI}"`, `uri="${CHART_URI}"`);
    const chartPart = parse(xml);
    const drawing = drawingOf(chartPart);
    expect(
      refuse(chartPart, {
        op: 'cropDrawing',
        drawingNodeId: drawing.id,
        crop: { left: 1000, top: 0, right: 0, bottom: 0 },
      })
    ).toBe('chart-drawing');
    expect(
      validateTreeOp(chartPart, {
        op: 'resizeDrawing',
        drawingNodeId: drawing.id,
        extentEmu: { cx: 1, cy: 1 },
      })
    ).toBeNull();
  });

  test('refuses resize when noResize lock is set', () => {
    let part = parse(inlinePictureDrawing());
    const drawing = drawingOf(part);
    part = apply(part, {
      op: 'setDrawingLocks',
      drawingNodeId: drawing.id,
      locks: { resize: true },
    });
    expect(
      refuse(part, { op: 'resizeDrawing', drawingNodeId: drawing.id, extentEmu: { cx: 2, cy: 2 } })
    ).toBe('drawing-locked');
  });

  test('refuses non-finite extent', () => {
    const part = parse(inlinePictureDrawing());
    const drawing = drawingOf(part);
    expect(
      refuse(part, {
        op: 'resizeDrawing',
        drawingNodeId: drawing.id,
        extentEmu: { cx: NaN, cy: 1 },
      })
    ).toBe('invalid-drawing-value');
    expect(
      refuse(part, { op: 'resizeDrawing', drawingNodeId: drawing.id, extentEmu: { cx: -1, cy: 1 } })
    ).toBe('invalid-drawing-value');
  });

  test('refuses tracked drawing deletion in suggesting mode', () => {
    const part = parse(inlinePictureDrawing());
    const drawing = drawingOf(part);
    const before = canonicalOoxmlFingerprint(part.root);
    expect(
      refuse(part, {
        op: 'deleteDrawing',
        drawingNodeId: drawing.id,
        revision: { author: 'Reviewer' },
      })
    ).toBe('trackedDrawingDeletionUnsupported');
    expect(canonicalOoxmlFingerprint(part.root)).toBe(before);
  });
});

describe('drawing op impact classes', () => {
  test('geometry ops are flow-structural; metadata is text-local', () => {
    const id = 'd1';
    expect(
      drawingOpImpact({ op: 'resizeDrawing', drawingNodeId: id, extentEmu: { cx: 1, cy: 1 } })
    ).toBe('flow-structural');
    expect(
      drawingOpImpact({ op: 'setDrawingWrap', drawingNodeId: id, wrap: 'tight' as ImageWrapTarget })
    ).toBe('flow-structural');
    expect(
      drawingOpImpact({
        op: 'setDrawingMetadata',
        drawingNodeId: id,
        title: '',
        description: '',
        hyperlink: null,
      })
    ).toBe('text-local');
  });
});

test('drawing insertion refuses invalid runtime bias values', () => {
  const host = parse(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Hi</w:t></w:r></w:p></w:body></w:document>`
  );
  const drawing = drawingOf(parse(inlinePictureDrawing()));
  for (const bias of ['bad', '', null, 0]) {
    const op: TreeDocOp = {
      op: 'insertDrawing',
      paragraphId: paragraphIdOf(host),
      offset: 1,
      drawing,
      bias: bias as 'left',
    };
    expect(validateTreeOp(host, op)).toBe('invalid-property-value');
    expect(applyTreeOp(host, op).ok).toBe(false);
  }
});
