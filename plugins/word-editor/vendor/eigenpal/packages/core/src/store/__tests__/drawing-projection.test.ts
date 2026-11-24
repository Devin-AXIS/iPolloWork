import { describe, expect, test } from 'bun:test';
import {
  WML_NAMESPACE_URI,
  canonicalOoxmlFingerprint,
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlDrawingNode,
  type OoxmlElement,
  type OoxmlPart,
} from '../index.ts';
import { MC_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  DEFAULT_SUPPORTED_MC_REQUIRES,
  createDrawingRelationshipResolver,
  drawingAccessibility,
  projectDrawing,
  projectDrawingsInPart,
  projectDrawingsInPackage,
} from '../package/drawing-projection.ts';
import { HYPERLINK_RELATIONSHIP_TYPE } from '../package/hyperlink.ts';
import type { OoxmlExternalTarget, OoxmlPackage } from '../package/ooxml-package.ts';

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const CHART_URI = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const IMAGE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';

function inlinePictureDrawingWithDocPrHlink(
  options: {
    readonly hlinkRelId?: string;
    readonly docPrInner?: string;
  } = {}
): string {
  const hlinkRelId = options.hlinkRelId ?? 'rIdHlink';
  const docPrInner =
    options.docPrInner ?? `<a:hlinkClick xmlns:a="${A}" xmlns:r="${R}" r:id="${hlinkRelId}"/>`;
  return inlinePictureDrawing().replace(
    '<wp:docPr id="1" name="green" descr="Green square" title="Green"/>',
    `<wp:docPr id="1" name="linked" descr="" title="">${docPrInner}</wp:docPr>`
  );
}

function packageWithStory(
  part: OoxmlPart,
  options: {
    readonly externalTargets?: readonly OoxmlExternalTarget[];
    readonly relationships?: OoxmlPackage['relationships'];
  } = {}
): OoxmlPackage {
  return Object.freeze({
    parts: new Map([[part.name, part]]),
    partBytes: new Map(),
    relationships: options.relationships ?? new Map(),
    externalTargets: Object.freeze(options.externalTargets ?? []),
    contentTypes: { defaults: new Map(), overrides: new Map() },
    mainDocumentPart: part.name,
  });
}

function externalHyperlink(
  ownerPart: string,
  id: string,
  target: string,
  sinkSafe: boolean
): OoxmlExternalTarget {
  return Object.freeze({
    ownerPart,
    id,
    type: HYPERLINK_RELATIONSHIP_TYPE,
    rawTarget: target,
    sinkSafe,
  });
}

const metadata = {
  name: '/word/document.xml',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
};

function parse(xml: string): OoxmlPart {
  const result = readOoxmlPart(xml, metadata);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.part;
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

function projectDrawingOf(part: OoxmlPart): ReturnType<typeof projectDrawing> {
  const projections = projectDrawingsInPart(part);
  expect(projections.length).toBeGreaterThanOrEqual(1);
  return projections[0]!;
}

function inlinePictureDrawing(
  options: {
    readonly extent?: string;
    readonly embed?: string;
    readonly link?: string;
    readonly docPr?: string;
    readonly graphicDataUri?: string;
    readonly inner?: string;
    readonly inlineAttrs?: string;
    readonly graphicInner?: string;
  } = {}
): string {
  const extent = options.extent ?? 'cx="152400" cy="152400"';
  const embed = options.embed;
  const linkAttr = options.link ? ` r:link="${options.link}"` : '';
  const embedAttr = options.link && embed === undefined ? '' : ` r:embed="${embed ?? 'rId14'}"`;
  const docPr = options.docPr ?? 'id="1" name="green" descr="Green square" title="Green"';
  const graphicDataUri = options.graphicDataUri ?? PIC_URI;
  const inner = options.inner ?? '';
  const graphicInner = options.graphicInner ?? '';
  const inlineAttrs = options.inlineAttrs ?? 'distT="100" distB="200" distL="300" distR="400"';
  return (
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    '<w:body><w:p><w:r><w:drawing>' +
    `<wp:inline ${inlineAttrs}>` +
    `<wp:extent ${extent}/>` +
    '<wp:effectExtent l="10" t="20" r="30" b="40"/>' +
    `<wp:docPr ${docPr}/>` +
    '<wp:cNvGraphicFramePr/>' +
    `<a:graphic><a:graphicData uri="${graphicDataUri}">` +
    (graphicInner ||
      '<pic:pic>' +
        '<pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
        `<pic:blipFill><a:blip${embedAttr}${linkAttr}><a:lum bright="70000" contrast="20000"/><a:grayscl/></a:blip>` +
        '<a:srcRect l="10000" t="20000" r="30000" b="40000"/>' +
        '<a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
        '<pic:spPr><a:xfrm rot="5400000" flipH="1" flipV="0"><a:ext cx="152400" cy="152400"/></a:xfrm>' +
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
        '</pic:pic>') +
    '</a:graphicData></a:graphic>' +
    inner +
    '</wp:inline></w:drawing></w:r></w:p></w:body></w:document>'
  );
}

function anchoredPictureDrawing(
  options: {
    readonly wrap?: string;
    readonly positionH?: string;
    readonly positionV?: string;
    readonly anchorAttrs?: string;
  } = {}
): string {
  const wrap =
    options.wrap ?? '<wp:wrapSquare wrapText="left" distT="1" distB="2" distL="3" distR="4"/>';
  const positionH =
    options.positionH ??
    '<wp:positionH relativeFrom="page"><wp:align>center</wp:align></wp:positionH>';
  const positionV =
    options.positionV ??
    '<wp:positionV relativeFrom="line"><wp:posOffset>914400</wp:posOffset></wp:positionV>';
  const anchorAttrs =
    options.anchorAttrs ??
    'distT="0" distB="0" distL="0" distR="0" simplePos="1" allowOverlap="0" behindDoc="1" locked="1" layoutInCell="1" relativeHeight="952500" hidden="1"';
  return (
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body><w:p><w:r><w:drawing>` +
    `<wp:anchor ${anchorAttrs}>` +
    '<wp:simplePos x="100" y="200"/>' +
    positionH +
    positionV +
    '<wp:extent cx="952500" cy="952500"/>' +
    '<wp:effectExtent l="5" t="6" r="7" b="8"/>' +
    wrap +
    '<wp:docPr id="7" name="Picture 3" descr="Floating" title="Title text"/>' +
    '<wp:cNvGraphicFramePr><a:graphicFrameLocks noMove="1" noResize="1"/></wp:cNvGraphicFramePr>' +
    `<a:graphic><a:graphicData uri="${PIC_URI}"><pic:pic>` +
    '<pic:nvPicPr><pic:cNvPr id="3" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
    `<pic:blipFill><a:blip r:embed="rId15"/><a:tile tx="0" ty="0"/></pic:blipFill>` +
    '<pic:spPr><a:xfrm rot="0"><a:ext cx="952500" cy="952500"/></a:xfrm><a:prstGeom prst="ellipse"/></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic>' +
    '</wp:anchor></w:drawing></w:r></w:p></w:body></w:document>'
  );
}

describe('projectDrawing', () => {
  test('projects inline picture attributes and picture payload', () => {
    const part = parse(inlinePictureDrawing());
    const projection = projectDrawing(drawingOf(part), {
      ownerPartName: part.name,
      supportedMcRequires: DEFAULT_SUPPORTED_MC_REQUIRES,
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    });
    expect(projection).not.toBeNull();
    expect(projection!.kind).toBe('inline');
    expect(projection!.wrap).toBe('inline');
    expect(projection!.extentEmu).toEqual({ cx: 152400, cy: 152400 });
    expect(projection!.inlineDistancesEmu).toEqual({
      top: 100,
      right: 400,
      bottom: 200,
      left: 300,
    });
    expect(projection!.effectExtentEmu).toEqual({ top: 20, right: 30, bottom: 40, left: 10 });
    expect(projection!.name).toBe('green');
    expect(projection!.description).toBe('Green square');
    expect(projection!.title).toBe('Green');
    expect(projection!.relationshipId).toBe('rId14');
    expect(projection!.picture).toMatchObject({
      embeddedRelationshipId: 'rId14',
      fillMode: 'stretch',
      presetGeometry: 'rect',
      crop: { left: 0.1, top: 0.2, right: 0.3, bottom: 0.4 },
      transform: { rotationDegrees: 90, flipHorizontal: true, flipVertical: false },
    });
    expect(projection!.effects).toEqual({ grayscale: true, brightness: 70, contrast: 20 });
  });

  test('projects anchored wrap, position, locks, and hidden metadata', () => {
    const part = parse(anchoredPictureDrawing());
    const projection = projectDrawing(drawingOf(part), {
      ownerPartName: part.name,
      supportedMcRequires: DEFAULT_SUPPORTED_MC_REQUIRES,
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    });
    expect(projection!.kind).toBe('anchored');
    expect(projection!.wrap).toBe('squareLeft');
    expect(projection!.wrapGeometry).toMatchObject({
      element: 'square',
      textSide: 'left',
      distancesEmu: { top: 1, right: 4, bottom: 2, left: 3 },
    });
    expect(projection!.position).toMatchObject({
      simplePosition: { xEmu: 100, yEmu: 200 },
      horizontal: { relativeFrom: 'page', align: 'center', offsetEmu: null },
      vertical: { relativeFrom: 'line', align: null, offsetEmu: 914400 },
    });
    expect(projection!.anchor).toMatchObject({
      simplePos: true,
      behindDocument: true,
      layoutInCell: true,
      allowOverlap: false,
      relativeHeight: 952500,
    });
    expect(projection!.hidden).toBe(true);
    // `locked="1"` fixes only the anchor paragraph; the frame locks say the rest.
    expect(projection!.locks).toEqual({
      select: false,
      move: true,
      resize: true,
      changeAspect: false,
    });
    expect(projection!.picture!.fillMode).toBe('tile');
  });

  test('reads anchor flags as xsd:boolean: words as well as digits, whitespace collapsed', () => {
    const part = parse(
      anchoredPictureDrawing({
        wrap: '<wp:wrapNone/>',
        anchorAttrs:
          'distT="0" distB="0" distL="0" distR="0" simplePos="false" behindDoc=" true " ' +
          'locked="false" layoutInCell="true" allowOverlap="\tfalse" relativeHeight="2" hidden=" 0"',
      })
    );
    const drawing = drawingOf(part);
    expect(drawing.children[0]?.kind).toBe('anchoredDrawing');
    const projection = projectDrawing(drawing, {
      ownerPartName: part.name,
      supportedMcRequires: DEFAULT_SUPPORTED_MC_REQUIRES,
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    });
    expect(projection!.anchor).toMatchObject({
      simplePos: false,
      behindDocument: true,
      layoutInCell: true,
      allowOverlap: false,
    });
    expect(projection!.hidden).toBe(false);
    // wrapNone behind the text is the 'behind' paint layer, not 'inFront'.
    expect(projection!.wrap).toBe('behind');
  });

  test('maps wrap none to behind and inFront by behindDoc', () => {
    const behind = parse(
      anchoredPictureDrawing({
        wrap: '<wp:wrapNone/>',
        anchorAttrs:
          'simplePos="0" behindDoc="1" locked="0" relativeHeight="1" allowOverlap="1" layoutInCell="1"',
      })
    );
    const front = parse(
      anchoredPictureDrawing({
        wrap: '<wp:wrapNone/>',
        anchorAttrs:
          'simplePos="0" behindDoc="0" locked="0" relativeHeight="1" allowOverlap="1" layoutInCell="1"',
      })
    );
    const ctx = {
      ownerPartName: metadata.name,
      supportedMcRequires: DEFAULT_SUPPORTED_MC_REQUIRES,
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    };
    expect(projectDrawing(drawingOf(behind), ctx)!.wrap).toBe('behind');
    expect(projectDrawing(drawingOf(front), ctx)!.wrap).toBe('inFront');
  });

  test('reads linked blips without synthesizing embed ids', () => {
    const part = parse(inlinePictureDrawing({ embed: undefined, link: 'rIdExternal' }));
    const projection = projectDrawing(drawingOf(part), {
      ownerPartName: part.name,
      supportedMcRequires: DEFAULT_SUPPORTED_MC_REQUIRES,
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    });
    expect(projection!.picture!.embeddedRelationshipId).toBeNull();
    expect(projection!.picture!.linkedRelationshipId).toBe('rIdExternal');
    expect(projection!.relationshipId).toBe('rIdExternal');
  });

  test('reports unsupported non-picture graphic payloads', () => {
    const part = parse(inlinePictureDrawing({ graphicDataUri: CHART_URI }));
    const projection = projectDrawing(drawingOf(part), {
      ownerPartName: part.name,
      supportedMcRequires: DEFAULT_SUPPORTED_MC_REQUIRES,
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    });
    expect(projection!.picture).toBeNull();
    expect(projection!.diagnostics.some((d) => d.code === 'unsupported-graphic')).toBe(true);
  });

  test('returns null for invalid extent geometry', () => {
    const result = readOoxmlPart(
      inlinePictureDrawing({ extent: 'cx="wide" cy="152400"' }),
      metadata
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const projections = projectDrawingsInPart(result.part, {
      supportedMcRequires: DEFAULT_SUPPORTED_MC_REQUIRES,
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    });
    expect(projections).toHaveLength(0);
  });

  test('selects first supported mc:Choice and preserves canonical branches', () => {
    const part = parse(
      inlinePictureDrawing({
        graphicInner:
          `<mc:AlternateContent xmlns:mc="${MC_NAMESPACE_URI}">` +
          `<mc:Choice Requires="w14"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId14"/></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></mc:Choice>` +
          `<mc:Fallback><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdFallback"/></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></mc:Fallback>` +
          `</mc:AlternateContent>`,
      }).replace('xmlns:w=', `xmlns:w14="urn:word14" xmlns:w=`)
    );
    const before = canonicalOoxmlFingerprint(part.root);
    const supported = new Set(['urn:word14']);
    const projections = projectDrawingsInPart(part, { supportedMcRequires: supported });
    expect(projections).toHaveLength(1);
    expect(projections[0]!.relationshipId).toBe('rId14');
    expect(projections[0]!.compatibilityBranchNodeId).not.toBeNull();
    expect(canonicalOoxmlFingerprint(part.root)).toBe(before);
    expect(serializeOoxmlPart(part)).toContain('mc:AlternateContent');
  });

  test('falls back when no mc:Choice Requires prefix is supported', () => {
    const part = parse(
      inlinePictureDrawing({
        graphicInner:
          `<mc:AlternateContent xmlns:mc="${MC_NAMESPACE_URI}">` +
          `<mc:Choice Requires="w15"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdMissing"/></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></mc:Choice>` +
          `<mc:Fallback><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId14"/></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></mc:Fallback>` +
          `</mc:AlternateContent>`,
      }).replace('xmlns:w=', `xmlns:w15="urn:word15" xmlns:w=`)
    );
    const projections = projectDrawingsInPart(part, {
      supportedMcRequires: new Set(['urn:word14']),
    });
    expect(projections).toHaveLength(1);
    expect(projections[0]!.relationshipId).toBe('rId14');
    expect(serializeOoxmlPart(part)).toContain('mc:Fallback');
  });

  test('returns resource-refused unrenderable projection when limits are exceeded', () => {
    const branches = Array.from(
      { length: 70 },
      (_, index) =>
        `<mc:Choice Requires="w14"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId${index}"/></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></mc:Choice>`
    ).join('');
    const part = parse(
      inlinePictureDrawing({
        graphicInner:
          `<mc:AlternateContent xmlns:mc="${MC_NAMESPACE_URI}">${branches}` +
          `<mc:Fallback><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId14"/></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></mc:Fallback>` +
          `</mc:AlternateContent>`,
      }).replace('xmlns:w=', `xmlns:w14="urn:word14" xmlns:w=`)
    );
    const projection = projectDrawing(drawingOf(part), {
      ownerPartName: part.name,
      supportedMcRequires: new Set(['urn:word14']),
      limits: { ...DEFAULT_DRAWING_PROJECTION_LIMITS, maxCompatibilityBranches: 2 },
    });
    expect(projection!.diagnostics.some((d) => d.code === 'resource-refused')).toBe(true);
    expect(projection!.extentEmu.cx).toBe(152400);
    expect(projection!.picture).toBeNull();
  });

  test('1.7 no-synthesis: preserves authored docPr name and descr exactly', () => {
    const part = parse(
      inlinePictureDrawing({
        docPr: 'id="9" name="banner" descr="Test banner" title=""',
      })
    );
    const projection = projectDrawing(drawingOf(part), {
      ownerPartName: part.name,
      supportedMcRequires: DEFAULT_SUPPORTED_MC_REQUIRES,
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    });
    expect(projection!.name).toBe('banner');
    expect(projection!.description).toBe('Test banner');
    expect(drawingAccessibility(projection!).label).toBe('Test banner');
    expect(drawingAccessibility(projection!).decorative).toBe(false);
    const withoutDescr = parse(
      inlinePictureDrawing({ docPr: 'id="9" name="Picture 3" descr="" title=""' })
    );
    const decorative = projectDrawing(drawingOf(withoutDescr), {
      ownerPartName: part.name,
      supportedMcRequires: DEFAULT_SUPPORTED_MC_REQUIRES,
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    });
    expect(drawingAccessibility(decorative!).label).toBeNull();
    expect(drawingAccessibility(decorative!).decorative).toBe(true);
    expect(serializeOoxmlPart(withoutDescr)).not.toContain('descr="Generated');
  });

  test('projectDrawing leaves canonical fingerprint unchanged', () => {
    const part = parse(inlinePictureDrawing());
    const before = canonicalOoxmlFingerprint(part.root);
    projectDrawing(drawingOf(part), {
      ownerPartName: part.name,
      supportedMcRequires: DEFAULT_SUPPORTED_MC_REQUIRES,
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    });
    expect(canonicalOoxmlFingerprint(part.root)).toBe(before);
  });
});

describe('uses owner story relationship context', () => {
  test('threads ownerPartName for document, header, footer, footnote, and endnote stories', () => {
    const ctx = {
      supportedMcRequires: DEFAULT_SUPPORTED_MC_REQUIRES,
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    };
    const drawingXml = (embed: string) =>
      inlinePictureDrawing()
        .match(/<w:drawing>[\s\S]*<\/w:drawing>/)![0]
        .replace('rId14', embed);

    const document = parse(inlinePictureDrawing({ embed: 'rIdShared' }));
    const header = readOoxmlPart(
      `<w:hdr xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:p><w:r>${drawingXml('rIdShared')}</w:r></w:p></w:hdr>`,
      {
        name: '/word/header1.xml',
        contentType: 'application/vnd.openxmlformats-officedocument.header+xml',
      }
    );
    expect(header.ok).toBe(true);
    const footer = readOoxmlPart(
      `<w:ftr xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:p><w:r>${drawingXml('rIdShared')}</w:r></w:p></w:ftr>`,
      {
        name: '/word/footer1.xml',
        contentType: 'application/vnd.openxmlformats-officedocument.footer+xml',
      }
    );
    expect(footer.ok).toBe(true);
    const footnotes = readOoxmlPart(
      `<w:footnotes xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:footnote w:id="1"><w:p><w:r>${drawingXml('rIdFN1')}</w:r></w:p></w:footnote></w:footnotes>`,
      {
        name: '/word/footnotes.xml',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml',
      }
    );
    expect(footnotes.ok).toBe(true);
    const endnotes = readOoxmlPart(
      `<w:endnotes xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:endnote w:id="2"><w:p><w:r>${drawingXml('rIdEN1')}</w:r></w:p></w:endnote></w:endnotes>`,
      {
        name: '/word/endnotes.xml',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml',
      }
    );
    expect(endnotes.ok).toBe(true);

    const projections = [
      ...projectDrawingsInPart(document, ctx),
      ...projectDrawingsInPart(header.part!, ctx),
      ...projectDrawingsInPart(footer.part!, ctx),
      ...projectDrawingsInPart(footnotes.part!, ctx),
      ...projectDrawingsInPart(endnotes.part!, ctx),
    ];
    expect(projections.map((p) => p.ownerPartName).sort()).toEqual([
      '/word/document.xml',
      '/word/endnotes.xml',
      '/word/footer1.xml',
      '/word/footnotes.xml',
      '/word/header1.xml',
    ]);
    const sharedRid = projections.filter((p) => p.relationshipId === 'rIdShared');
    expect(sharedRid).toHaveLength(3);
    expect(sharedRid.map((p) => p.ownerPartName).sort()).toEqual([
      '/word/document.xml',
      '/word/footer1.xml',
      '/word/header1.xml',
    ]);
    expect(new Set(sharedRid.map((p) => `${p.ownerPartName}:${p.relationshipId}`)).size).toBe(3);
    expect(projections.find((p) => p.ownerPartName === '/word/endnotes.xml')!.relationshipId).toBe(
      'rIdEN1'
    );
  });
});

function runLevelMcDrawingXml(
  options: {
    readonly choiceEmbed?: string;
    readonly fallbackEmbed?: string;
    readonly choiceRequires?: string;
    readonly xmlnsExtra?: string;
    readonly inner?: string;
  } = {}
): string {
  const choiceEmbed = options.choiceEmbed ?? 'rIdChoice';
  const fallbackEmbed = options.fallbackEmbed ?? 'rIdFallback';
  const choiceRequires = options.choiceRequires ?? 'w14';
  const xmlnsExtra = options.xmlnsExtra ?? `xmlns:w14="urn:word14"`;
  const drawingInner =
    options.inner ?? inlinePictureDrawing().match(/<w:drawing>[\s\S]*<\/w:drawing>/)![0];
  return (
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:mc="${MC_NAMESPACE_URI}" ${xmlnsExtra} xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    '<w:body><w:p><w:r>' +
    `<mc:AlternateContent xmlns:mc="${MC_NAMESPACE_URI}">` +
    `<mc:Choice Requires="${choiceRequires}">${drawingInner.replace('rId14', choiceEmbed)}</mc:Choice>` +
    `<mc:Fallback>${drawingInner.replace('rId14', fallbackEmbed)}</mc:Fallback>` +
    '</mc:AlternateContent>' +
    '</w:r></w:p></w:body></w:document>'
  );
}

describe('fix round 1 — run-level MC and bounds', () => {
  test('projects run-level MC supported choice with first-choice relationship id', () => {
    const part = parse(
      runLevelMcDrawingXml({ choiceEmbed: 'rIdChoice', fallbackEmbed: 'rIdFallback' })
    );
    const before = canonicalOoxmlFingerprint(part.root);
    const projections = projectDrawingsInPart(part, {
      supportedMcRequires: new Set(['urn:word14']),
    });
    expect(projections).toHaveLength(1);
    expect(projections[0]!.relationshipId).toBe('rIdChoice');
    expect(canonicalOoxmlFingerprint(part.root)).toBe(before);
  });

  test('run-level MC falls back when Requires prefix is unbound', () => {
    const part = parse(
      runLevelMcDrawingXml({
        choiceRequires: 'w14',
        xmlnsExtra: 'xmlns:w14="urn:not-supported"',
        choiceEmbed: 'rIdMissing',
        fallbackEmbed: 'rIdFallback',
      })
    );
    const projections = projectDrawingsInPart(part, {
      supportedMcRequires: new Set(['urn:word14']),
    });
    expect(projections[0]!.relationshipId).toBe('rIdFallback');
  });

  test('missing Requires does not select Choice', () => {
    const drawingInner = inlinePictureDrawing().match(/<w:drawing>[\s\S]*<\/w:drawing>/)![0];
    const part = parse(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:mc="${MC_NAMESPACE_URI}" xmlns:w14="urn:word14" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
        '<w:body><w:p><w:r>' +
        `<mc:AlternateContent xmlns:mc="${MC_NAMESPACE_URI}">` +
        `<mc:Choice>${drawingInner.replace('rId14', 'rIdMissing')}</mc:Choice>` +
        `<mc:Fallback>${drawingInner}</mc:Fallback>` +
        '</mc:AlternateContent></w:r></w:p></w:body></w:document>'
    );
    const projections = projectDrawingsInPart(part, {
      supportedMcRequires: new Set(['urn:word14']),
    });
    expect(projections[0]!.relationshipId).toBe('rId14');
  });

  test('resource-refused returns unrenderable projection when extent known before branch limit', () => {
    const branches = Array.from(
      { length: 70 },
      (_, index) =>
        `<mc:Choice Requires="w14"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId${index}"/></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></mc:Choice>`
    ).join('');
    const part = parse(
      inlinePictureDrawing({
        graphicInner:
          `<mc:AlternateContent xmlns:mc="${MC_NAMESPACE_URI}">${branches}` +
          `<mc:Fallback><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId14"/></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></mc:Fallback>` +
          `</mc:AlternateContent>`,
      }).replace('xmlns:w=', `xmlns:w14="urn:word14" xmlns:w=`)
    );
    const projection = projectDrawing(drawingOf(part), {
      ownerPartName: part.name,
      supportedMcRequires: new Set(['urn:word14']),
      limits: { ...DEFAULT_DRAWING_PROJECTION_LIMITS, maxCompatibilityBranches: 2 },
    });
    expect(projection!.extentEmu.cx).toBe(152400);
    expect(projection!.diagnostics.some((d) => d.code === 'resource-refused')).toBe(true);
    expect(projection!.picture).toBeNull();
  });

  test('graphic MC branch enumeration hits limit without stack overflow', () => {
    const branches = Array.from(
      { length: 50 },
      () =>
        `<mc:Choice Requires="w14"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId14"/></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></mc:Choice>`
    ).join('');
    const part = parse(
      inlinePictureDrawing({
        graphicInner:
          `<mc:AlternateContent xmlns:mc="${MC_NAMESPACE_URI}">${branches}` +
          `<mc:Fallback><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId14"/></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></mc:Fallback>` +
          `</mc:AlternateContent>`,
      }).replace('xmlns:w=', `xmlns:w14="urn:word14" xmlns:w=`)
    );
    const projection = projectDrawing(drawingOf(part), {
      ownerPartName: part.name,
      supportedMcRequires: new Set(['urn:word14']),
      limits: { ...DEFAULT_DRAWING_PROJECTION_LIMITS, maxCompatibilityBranches: 2 },
    });
    expect(projection).not.toBeNull();
    expect(projection!.diagnostics.some((d) => d.code === 'resource-refused')).toBe(true);
    expect(projection!.extentEmu.cx).toBe(152400);
  });

  test('reports all schema-valid vertical reference frames without rewriting', () => {
    const verticalFrames = [
      'bottomMargin',
      'insideMargin',
      'line',
      'margin',
      'outsideMargin',
      'page',
      'paragraph',
      'topMargin',
    ] as const;
    for (const frame of verticalFrames) {
      const part = parse(
        anchoredPictureDrawing({
          positionV: `<wp:positionV relativeFrom="${frame}"><wp:posOffset>100</wp:posOffset></wp:positionV>`,
        })
      );
      const projection = projectDrawing(drawingOf(part), {
        ownerPartName: part.name,
        supportedMcRequires: DEFAULT_SUPPORTED_MC_REQUIRES,
        limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
      });
      expect(projection!.position!.vertical.relativeFrom).toBe(frame);
    }
  });

  test('ignores hostile misplaced generic blip outside picture payload', () => {
    const part = parse(
      inlinePictureDrawing({
        inner: `<a:blip xmlns:a="${A}" r:embed="rIdEvil"/>`,
      })
    );
    const projection = projectDrawing(drawingOf(part), {
      ownerPartName: part.name,
      supportedMcRequires: DEFAULT_SUPPORTED_MC_REQUIRES,
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    });
    expect(projection!.relationshipId).toBe('rId14');
    expect(projection!.picture!.embeddedRelationshipId).toBe('rId14');
  });

  test('projection graph is deeply immutable', () => {
    const part = parse(inlinePictureDrawing());
    const projection = projectDrawing(drawingOf(part), {
      ownerPartName: part.name,
      supportedMcRequires: DEFAULT_SUPPORTED_MC_REQUIRES,
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    })!;
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.extentEmu)).toBe(true);
    expect(Object.isFrozen(projection.diagnostics)).toBe(true);
    expect(() => {
      (projection.extentEmu as { cx: number }).cx = 0;
    }).toThrow();
    const parts = projectDrawingsInPart(part);
    expect(Object.isFrozen(parts)).toBe(true);
    expect(Object.isFrozen(parts[0]!.picture!.crop)).toBe(true);
  });
});

describe('fix round 2 — bounded traversal and chain reads', () => {
  test('wide part collection stops deterministically at visit limit without stack overflow', () => {
    const paragraphs = Array.from(
      { length: 200 },
      (_, index) => `<w:p><w:r><w:t>p${index}</w:t></w:r></w:p>`
    ).join('');
    const drawingParagraph = inlinePictureDrawing().match(
      /<w:p><w:r><w:drawing>[\s\S]*<\/w:drawing><\/w:r><\/w:p>/
    )![0];
    const part = parse(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
        `<w:body>${paragraphs}${drawingParagraph}</w:body></w:document>`
    );
    // The part SCAN is no longer truncated by the per-drawing walk budget (that silently
    // dropped every drawing late in a large document); the budget still bounds each
    // drawing's own subtree walk, deterministically and without stack overflow.
    const limited = projectDrawingsInPart(part, {
      limits: { ...DEFAULT_DRAWING_PROJECTION_LIMITS, maxVisitedElements: 40 },
    });
    expect(limited).toHaveLength(1);
    const full = projectDrawingsInPart(part);
    expect(full).toHaveLength(1);
  });

  test('deep revision nesting still finds drawing without stack overflow', () => {
    let inner = inlinePictureDrawing().match(/<w:r><w:drawing>[\s\S]*<\/w:drawing><\/w:r>/)![0];
    for (let depth = 0; depth < 80; depth += 1) {
      inner = `<w:ins w:author="a${depth}">${inner}</w:ins>`;
    }
    const part = parse(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body><w:p>${inner}</w:p></w:body></w:document>`
    );
    const projections = projectDrawingsInPart(part);
    expect(projections).toHaveLength(1);
    expect(projections[0]!.relationshipId).toBe('rId14');
  });

  test('compatibility run-level MC ignores nested hostile blip outside blipFill chain', () => {
    const nestedEvil =
      '<pic:pic>' +
      '<pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
      `<pic:blipFill><a:blip r:embed="rIdGood"/><a:stretch/></pic:blipFill>` +
      `<a:blip xmlns:a="${A}" r:embed="rIdEvil"/>` +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>';
    const part = parse(
      runLevelMcDrawingXml({
        inner: inlinePictureDrawing({ graphicInner: nestedEvil }).match(
          /<w:drawing>[\s\S]*<\/w:drawing>/
        )![0],
      })
    );
    const projections = projectDrawingsInPart(part, {
      supportedMcRequires: new Set(['urn:word14']),
    });
    expect(projections[0]!.relationshipId).toBe('rIdGood');
  });

  test('compatibility run-level MC ignores wrong-namespace blip sibling', () => {
    const wrongNs =
      '<pic:pic>' +
      '<pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
      `<pic:blipFill><b:blip xmlns:b="urn:evil" r:embed="rIdEvil"/><a:blip r:embed="rIdGood"/><a:stretch/></pic:blipFill>` +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>';
    const part = parse(
      runLevelMcDrawingXml({
        inner: inlinePictureDrawing({ graphicInner: wrongNs }).match(
          /<w:drawing>[\s\S]*<\/w:drawing>/
        )![0],
      })
    );
    const projections = projectDrawingsInPart(part, {
      supportedMcRequires: new Set(['urn:word14']),
    });
    expect(projections[0]!.relationshipId).toBe('rIdGood');
  });
});

describe('fix round 3 — docPr hyperlink semantics', () => {
  test('typed docPr keeps hlinkClick child without demotion', () => {
    const part = parse(inlinePictureDrawingWithDocPrHlink());
    const inline = drawingOf(part).children[0] as OoxmlElement;
    const docPr = inline.children.find((child) => child.kind === 'drawingDocPr');
    expect(docPr?.kind).toBe('drawingDocPr');
    expect(
      docPr?.children.some(
        (child) =>
          child.kind === 'generic' && child.namespaceUri === A && child.localName === 'hlinkClick'
      )
    ).toBe(true);
  });

  test('part projection without relationship context leaves hyperlinkHref null', () => {
    const part = parse(inlinePictureDrawingWithDocPrHlink());
    const projections = projectDrawingsInPart(part);
    expect(projections[0]!.hyperlinkHref).toBeNull();
  });

  test('package projection resolves external hyperlink target from owner rels', () => {
    const part = parse(inlinePictureDrawingWithDocPrHlink({ hlinkRelId: 'rIdHlink' }));
    const pkg = packageWithStory(part, {
      externalTargets: [externalHyperlink(part.name, 'rIdHlink', 'https://example.com/safe', true)],
    });
    const projections = projectDrawingsInPackage(pkg);
    expect(projections[0]!.hyperlinkHref).toBe('https://example.com/safe');
  });

  test('same relationship id in different owner parts resolves distinct safe targets', () => {
    const document = parse(inlinePictureDrawingWithDocPrHlink({ hlinkRelId: 'rIdShared' }));
    const headerXml = inlinePictureDrawingWithDocPrHlink({ hlinkRelId: 'rIdShared' }).match(
      /<w:drawing>[\s\S]*<\/w:drawing>/
    )![0];
    const header = readOoxmlPart(
      `<w:hdr xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:p><w:r>${headerXml}</w:r></w:p></w:hdr>`,
      {
        name: '/word/header1.xml',
        contentType: 'application/vnd.openxmlformats-officedocument.header+xml',
      }
    );
    expect(header.ok).toBe(true);
    const pkg = Object.freeze({
      parts: new Map([
        [document.name, document],
        [header.part!.name, header.part!],
      ]),
      partBytes: new Map(),
      relationships: new Map(),
      externalTargets: Object.freeze([
        externalHyperlink(document.name, 'rIdShared', 'https://document.example/safe', true),
        externalHyperlink(header.part!.name, 'rIdShared', 'https://header.example/safe', true),
      ]),
      contentTypes: { defaults: new Map(), overrides: new Map() },
      mainDocumentPart: document.name,
    }) as OoxmlPackage;
    const projections = projectDrawingsInPackage(pkg);
    expect(projections.find((p) => p.ownerPartName === document.name)!.hyperlinkHref).toBe(
      'https://document.example/safe'
    );
    expect(projections.find((p) => p.ownerPartName === header.part!.name)!.hyperlinkHref).toBe(
      'https://header.example/safe'
    );
  });

  test('never exposes relationship id string as hyperlinkHref', () => {
    const part = parse(
      inlinePictureDrawingWithDocPrHlink({
        docPrInner: `<a:hlinkClick xmlns:a="${A}" xmlns:r="${R}" r:id="https://evil.example/looks-like-url"/>`,
      })
    );
    const pkg = packageWithStory(part, {
      externalTargets: [
        externalHyperlink(
          part.name,
          'https://evil.example/looks-like-url',
          'https://real.example',
          true
        ),
      ],
    });
    expect(projectDrawingsInPackage(pkg)[0]!.hyperlinkHref).toBe('https://real.example');
    expect(projectDrawingsInPart(part)[0]!.hyperlinkHref).toBeNull();
  });

  test('unsafe external scheme and wrong relationship type yield null href', () => {
    const part = parse(inlinePictureDrawingWithDocPrHlink({ hlinkRelId: 'rIdBad' }));
    const unsafe = packageWithStory(part, {
      externalTargets: [externalHyperlink(part.name, 'rIdBad', 'javascript:alert(1)', false)],
    });
    expect(projectDrawingsInPackage(unsafe)[0]!.hyperlinkHref).toBeNull();

    const wrongType = parse(inlinePictureDrawingWithDocPrHlink({ hlinkRelId: 'rIdImage' }));
    const imagePkg = packageWithStory(wrongType, {
      externalTargets: [
        Object.freeze({
          ownerPart: wrongType.name,
          id: 'rIdImage',
          type: IMAGE_REL,
          rawTarget: 'https://example.com/image.png',
          sinkSafe: true,
        }),
      ],
    });
    expect(projectDrawingsInPackage(imagePkg)[0]!.hyperlinkHref).toBeNull();
  });

  test('missing and internal hyperlink relationships yield null href', () => {
    const missing = parse(inlinePictureDrawingWithDocPrHlink({ hlinkRelId: 'rIdMissing' }));
    expect(projectDrawingsInPackage(packageWithStory(missing))[0]!.hyperlinkHref).toBeNull();

    const internal = parse(inlinePictureDrawingWithDocPrHlink({ hlinkRelId: 'rIdInternal' }));
    const internalPkg = packageWithStory(internal, {
      relationships: new Map([
        [
          internal.name,
          Object.freeze([
            Object.freeze({
              ownerPart: internal.name,
              id: 'rIdInternal',
              type: HYPERLINK_RELATIONSHIP_TYPE,
              rawTarget: 'other.docx',
              targetMode: 'Internal' as const,
              order: 0,
            }),
          ]),
        ],
      ]),
    });
    expect(projectDrawingsInPackage(internalPkg)[0]!.hyperlinkHref).toBeNull();
  });

  test('ignores hostile hlinkClick under graphic, nested wrapper, or wrong namespace', () => {
    const underGraphic = parse(
      inlinePictureDrawing({
        inner: `<a:hlinkClick xmlns:a="${A}" xmlns:r="${R}" r:id="rIdHlink"/>`,
      })
    );
    const pkgGraphic = packageWithStory(underGraphic, {
      externalTargets: [
        externalHyperlink(underGraphic.name, 'rIdHlink', 'https://example.com/nope', true),
      ],
    });
    expect(projectDrawingsInPackage(pkgGraphic)[0]!.hyperlinkHref).toBeNull();

    const nested = parse(
      inlinePictureDrawingWithDocPrHlink({
        docPrInner:
          `<a:wrapper xmlns:a="${A}">` +
          `<a:hlinkClick xmlns:a="${A}" xmlns:r="${R}" r:id="rIdHlink"/>` +
          '</a:wrapper>',
      })
    );
    const pkgNested = packageWithStory(nested, {
      externalTargets: [
        externalHyperlink(nested.name, 'rIdHlink', 'https://example.com/nope', true),
      ],
    });
    expect(projectDrawingsInPackage(pkgNested)[0]!.hyperlinkHref).toBeNull();

    const wrongNs = parse(
      inlinePictureDrawingWithDocPrHlink({
        docPrInner: `<b:hlinkClick xmlns:b="urn:evil" xmlns:r="${R}" r:id="rIdHlink"/>`,
      })
    );
    const pkgWrongNs = packageWithStory(wrongNs, {
      externalTargets: [
        externalHyperlink(wrongNs.name, 'rIdHlink', 'https://example.com/nope', true),
      ],
    });
    expect(projectDrawingsInPackage(pkgWrongNs)[0]!.hyperlinkHref).toBeNull();
  });

  test('run-level MC resolves docPr hyperlink through package relationship context', () => {
    const drawingInner = inlinePictureDrawingWithDocPrHlink({ hlinkRelId: 'rIdMcHlink' }).match(
      /<w:drawing>[\s\S]*<\/w:drawing>/
    )![0];
    const part = parse(runLevelMcDrawingXml({ inner: drawingInner }));
    const pkg = packageWithStory(part, {
      externalTargets: [
        externalHyperlink(part.name, 'rIdMcHlink', 'https://mc.example/safe', true),
      ],
    });
    const projections = projectDrawingsInPackage(pkg, {
      supportedMcRequires: new Set(['urn:word14']),
    });
    expect(projections[0]!.hyperlinkHref).toBe('https://mc.example/safe');
  });

  test('createDrawingRelationshipResolver is owner-scoped', () => {
    const part = parse(inlinePictureDrawingWithDocPrHlink({ hlinkRelId: 'rIdShared' }));
    const pkg = packageWithStory(part, {
      externalTargets: [externalHyperlink(part.name, 'rIdShared', 'https://scoped.example', true)],
    });
    const resolve = createDrawingRelationshipResolver(pkg, '/word/other.xml');
    expect(resolve('rIdShared')).toBeNull();
    expect(
      projectDrawing(drawingOf(part), {
        ownerPartName: part.name,
        supportedMcRequires: DEFAULT_SUPPORTED_MC_REQUIRES,
        limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
        resolveRelationship: createDrawingRelationshipResolver(pkg, part.name),
      })!.hyperlinkHref
    ).toBe('https://scoped.example');
  });
});
