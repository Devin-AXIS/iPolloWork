// A minimal synthetic DOCX holding one SmartArt drawing: the story part's `w:drawing` with
// `dgm:relIds`, the data model with its `dsp:dataModelExt` pointer, stub layout, quick style
// and colour parts, the saved `dsp:drawing` built from shape specs, a theme and settings.
// Every part is generated here; no real document content is used.

import { strToU8, zipSync } from 'fflate';
import { readOoxmlPackage, type OoxmlPackage } from '../package/ooxml-package.ts';

export const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
export const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
export const DGM = 'http://schemas.openxmlformats.org/drawingml/2006/diagram';
export const DSP = 'http://schemas.microsoft.com/office/drawing/2008/diagram';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
export const DATA_REL = `${R}/diagramData`;
export const LAYOUT_REL = `${R}/diagramLayout`;
export const STYLE_REL = `${R}/diagramQuickStyle`;
export const COLORS_REL = `${R}/diagramColors`;
export const DRAWING_REL = 'http://schemas.microsoft.com/office/2007/relationships/diagramDrawing';

/** One saved `dsp:sp`; XML-valued fields are inserted verbatim. */
export interface SmartArtShapeSpec {
  readonly preset?: string;
  readonly avLst?: Readonly<Record<string, number>>;
  /** Raw `a:custGeom` element, used instead of the preset. */
  readonly custGeom?: string;
  readonly off: readonly [number, number];
  readonly ext: readonly [number, number];
  readonly rot?: number;
  readonly flipH?: boolean;
  readonly flipV?: boolean;
  /** Raw fill element; defaults to a solid `4F81BD` fill. Pass '' for none written. */
  readonly fill?: string;
  /** Raw `a:ln` element; defaults to no outline element. */
  readonly ln?: string;
  /** Raw `dsp:style` children; defaults to minor font with an `lt1` colour. */
  readonly style?: string;
  /** Raw `dsp:txBody` children (bodyPr, lstStyle, paragraphs). */
  readonly txBody?: string;
  readonly txXfrm?: Readonly<{
    off: readonly [number, number];
    ext: readonly [number, number];
    rot?: number;
  }>;
  readonly hidden?: boolean;
  /** Raw extra `dsp:spPr` children appended after the line (effects, 3D). */
  readonly extraSpPr?: string;
}

export interface SmartArtGroupSpec {
  readonly group: Readonly<{
    off: readonly [number, number];
    ext: readonly [number, number];
    chOff: readonly [number, number];
    chExt: readonly [number, number];
  }>;
  readonly children: readonly (SmartArtShapeSpec | SmartArtGroupSpec)[];
}

export interface SmartArtDocxOptions {
  readonly shapes?: readonly (SmartArtShapeSpec | SmartArtGroupSpec)[];
  /** Graphic frame extent in EMU. */
  readonly extent?: readonly [number, number];
  readonly anchored?: boolean;
  /** Raw `dgm:bg` children, such as a solid fill. */
  readonly background?: string;
  /** Raw `dgm:whole` children, such as an `a:ln`. */
  readonly whole?: string;
  /**
   * Where the drawing relationship lives: the story part (as Office writes it), the data
   * part, nowhere (`none`), or a relationship to a part missing from the package.
   */
  readonly drawingRelationship?: 'document' | 'data' | 'none' | 'dangling';
  /** Leave out the drawing part pointer `dsp:dataModelExt`. */
  readonly omitDataModelExt?: boolean;
  readonly dataRelationshipType?: string;
  readonly drawingRelationshipType?: string;
  /** Make the drawing relationship external. */
  readonly drawingExternal?: boolean;
  /** Replace the whole drawing part with this XML. */
  readonly drawingPartXml?: string;
  /** Replace the whole data part with this XML. */
  readonly dataPartXml?: string;
  /** Leave out `r:dm` on `dgm:relIds`. */
  readonly omitDataId?: boolean;
  /** Extra paragraphs before the diagram paragraph. */
  readonly leadingParagraphs?: number;
  /** Replace the layout, quick style and colour parts with this XML. */
  readonly layoutPartXml?: string;
  readonly stylePartXml?: string;
  readonly colorsPartXml?: string;
}

const DEFAULT_STYLE =
  '<a:lnRef idx="2"><a:scrgbClr r="0" g="0" b="0"/></a:lnRef>' +
  '<a:fillRef idx="1"><a:scrgbClr r="0" g="0" b="0"/></a:fillRef>' +
  '<a:effectRef idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:effectRef>' +
  '<a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef>';

function isGroup(spec: SmartArtShapeSpec | SmartArtGroupSpec): spec is SmartArtGroupSpec {
  return 'group' in spec;
}

function shapeXml(spec: SmartArtShapeSpec): string {
  const xfrmAttributes =
    (spec.rot ? ` rot="${spec.rot}"` : '') +
    (spec.flipH ? ' flipH="1"' : '') +
    (spec.flipV ? ' flipV="1"' : '');
  const avLst = Object.entries(spec.avLst ?? {})
    .map(([name, value]) => `<a:gd name="${name}" fmla="val ${value}"/>`)
    .join('');
  const geometry =
    spec.custGeom ??
    `<a:prstGeom prst="${spec.preset ?? 'rect'}"><a:avLst>${avLst}</a:avLst></a:prstGeom>`;
  const fill = spec.fill ?? '<a:solidFill><a:srgbClr val="4F81BD"/></a:solidFill>';
  const txXfrm = spec.txXfrm
    ? `<dsp:txXfrm${spec.txXfrm.rot ? ` rot="${spec.txXfrm.rot}"` : ''}>` +
      `<a:off x="${spec.txXfrm.off[0]}" y="${spec.txXfrm.off[1]}"/>` +
      `<a:ext cx="${spec.txXfrm.ext[0]}" cy="${spec.txXfrm.ext[1]}"/></dsp:txXfrm>`
    : '';
  return (
    '<dsp:sp modelId="{00000000-0000-0000-0000-000000000000}">' +
    `<dsp:nvSpPr><dsp:cNvPr id="0" name=""${spec.hidden ? ' hidden="1"' : ''}/><dsp:cNvSpPr/></dsp:nvSpPr>` +
    `<dsp:spPr><a:xfrm${xfrmAttributes}><a:off x="${spec.off[0]}" y="${spec.off[1]}"/>` +
    `<a:ext cx="${spec.ext[0]}" cy="${spec.ext[1]}"/></a:xfrm>${geometry}${fill}${spec.ln ?? ''}` +
    `${spec.extraSpPr ?? ''}</dsp:spPr>` +
    `<dsp:style>${spec.style ?? DEFAULT_STYLE}</dsp:style>` +
    (spec.txBody !== undefined ? `<dsp:txBody>${spec.txBody}</dsp:txBody>` : '') +
    txXfrm +
    '</dsp:sp>'
  );
}

function treeXml(specs: readonly (SmartArtShapeSpec | SmartArtGroupSpec)[]): string {
  return specs
    .map((spec) => {
      if (!isGroup(spec)) return shapeXml(spec);
      const g = spec.group;
      return (
        '<dsp:grpSp><dsp:nvGrpSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvGrpSpPr/></dsp:nvGrpSpPr>' +
        `<dsp:grpSpPr><a:xfrm><a:off x="${g.off[0]}" y="${g.off[1]}"/><a:ext cx="${g.ext[0]}" cy="${g.ext[1]}"/>` +
        `<a:chOff x="${g.chOff[0]}" y="${g.chOff[1]}"/><a:chExt cx="${g.chExt[0]}" cy="${g.chExt[1]}"/></a:xfrm></dsp:grpSpPr>` +
        treeXml(spec.children) +
        '</dsp:grpSp>'
      );
    })
    .join('');
}

/** A text body with one centred paragraph of `text` at `size` hundredths of a point. */
export function simpleTextBody(text: string, size = 2000, bodyPr = 'anchor="ctr"'): string {
  return (
    `<a:bodyPr ${bodyPr}><a:noAutofit/></a:bodyPr><a:lstStyle/>` +
    `<a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="${size}"/><a:t>${text}</a:t></a:r></a:p>`
  );
}

const THEME =
  `<a:theme xmlns:a="${A}" name="Synthetic"><a:themeElements>` +
  '<a:clrScheme name="Synthetic">' +
  '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>' +
  '<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
  '<a:dk2><a:srgbClr val="1F497D"/></a:dk2><a:lt2><a:srgbClr val="EEECE1"/></a:lt2>' +
  '<a:accent1><a:srgbClr val="4F81BD"/></a:accent1><a:accent2><a:srgbClr val="C0504D"/></a:accent2>' +
  '<a:accent3><a:srgbClr val="9BBB59"/></a:accent3><a:accent4><a:srgbClr val="8064A2"/></a:accent4>' +
  '<a:accent5><a:srgbClr val="4BACC6"/></a:accent5><a:accent6><a:srgbClr val="F79646"/></a:accent6>' +
  '<a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink>' +
  '</a:clrScheme>' +
  '<a:fontScheme name="Synthetic"><a:majorFont><a:latin typeface="Cambria"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>' +
  '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>' +
  '<a:fmtScheme name="Synthetic"><a:fillStyleLst>' +
  '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
  '<a:solidFill><a:schemeClr val="phClr"><a:tint val="50000"/></a:schemeClr></a:solidFill>' +
  '<a:solidFill><a:schemeClr val="phClr"><a:shade val="50000"/></a:schemeClr></a:solidFill>' +
  '</a:fillStyleLst><a:lnStyleLst>' +
  '<a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>' +
  '<a:ln w="25400"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>' +
  '<a:ln w="38100"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>' +
  '</a:lnStyleLst><a:effectStyleLst>' +
  '<a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle>' +
  '<a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst>' +
  '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
  '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
  '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
  '</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>';

const SETTINGS =
  `<w:settings xmlns:w="${W}"><w:clrSchemeMapping w:bg1="light1" w:t1="dark1" w:bg2="light2" ` +
  'w:t2="dark2" w:accent1="accent1" w:accent2="accent2" w:accent3="accent3" w:accent4="accent4" ' +
  'w:accent5="accent5" w:accent6="accent6" w:hyperlink="hyperlink" w:followedHyperlink="followedHyperlink"/>' +
  '</w:settings>';

function relationships(entries: readonly (readonly [string, string, string, boolean?])[]): string {
  return (
    `<Relationships xmlns="${REL}">` +
    entries
      .map(
        ([id, type, target, external]) =>
          `<Relationship Id="${id}" Type="${type}" Target="${target}"${external ? ' TargetMode="External"' : ''}/>`
      )
      .join('') +
    '</Relationships>'
  );
}

/** The bytes of a DOCX with one SmartArt drawing. */
export function smartArtDocx(options: SmartArtDocxOptions = {}): Uint8Array {
  const [cx, cy] = options.extent ?? [5486400, 3200400];
  const placement = options.drawingRelationship ?? 'document';
  const relIds =
    `<dgm:relIds xmlns:dgm="${DGM}" xmlns:r="${R}"${options.omitDataId ? '' : ' r:dm="rId10"'} ` +
    'r:lo="rId11" r:qs="rId12" r:cs="rId13"/>';
  const graphic = `<a:graphic xmlns:a="${A}"><a:graphicData uri="${DGM}">${relIds}</a:graphicData></a:graphic>`;
  const frame = options.anchored
    ? '<wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="1" ' +
      'behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>' +
      '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
      '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
      `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapSquare wrapText="bothSides"/>` +
      `<wp:docPr id="1" name="Diagram 1"/><wp:cNvGraphicFramePr/>${graphic}</wp:anchor>`
    : `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
      `<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="1" name="Diagram 1"/>` +
      `<wp:cNvGraphicFramePr/>${graphic}</wp:inline>`;
  const leading = '<w:p><w:r><w:t>Body text</w:t></w:r></w:p>'.repeat(
    options.leadingParagraphs ?? 0
  );
  const document =
    `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}"><w:body>${leading}` +
    `<w:p><w:r><w:drawing>${frame}</w:drawing></w:r></w:p>` +
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>' +
    '</w:sectPr></w:body></w:document>';
  const dataModelExt = options.omitDataModelExt
    ? ''
    : `<dgm:extLst><a:ext uri="http://schemas.microsoft.com/office/drawing/2008/diagram">` +
      `<dsp:dataModelExt xmlns:dsp="${DSP}" relId="rId20" minVer="http://schemas.openxmlformats.org/drawingml/2006/diagram"/>` +
      '</a:ext></dgm:extLst>';
  const data =
    options.dataPartXml ??
    `<dgm:dataModel xmlns:dgm="${DGM}" xmlns:a="${A}"><dgm:ptLst>` +
      '<dgm:pt modelId="{1}" type="doc"><dgm:prSet/><dgm:spPr/><dgm:t><a:bodyPr/><a:lstStyle/><a:p/></dgm:t></dgm:pt>' +
      '</dgm:ptLst><dgm:cxnLst/>' +
      `<dgm:bg>${options.background ?? ''}</dgm:bg><dgm:whole>${options.whole ?? ''}</dgm:whole>` +
      `${dataModelExt}</dgm:dataModel>`;
  const drawing =
    options.drawingPartXml ??
    `<dsp:drawing xmlns:dgm="${DGM}" xmlns:dsp="${DSP}" xmlns:a="${A}"><dsp:spTree>` +
      '<dsp:nvGrpSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvGrpSpPr/></dsp:nvGrpSpPr><dsp:grpSpPr/>' +
      `${treeXml(options.shapes ?? [])}</dsp:spTree></dsp:drawing>`;
  const drawingEntry = [
    'rId20',
    options.drawingRelationshipType ?? DRAWING_REL,
    options.drawingExternal ? 'https://example.invalid/drawing1.xml' : 'diagrams/drawing1.xml',
    options.drawingExternal,
  ] as const;
  const documentRels: (readonly [string, string, string, boolean?])[] = [
    ['rId1', `${R}/theme`, 'theme/theme1.xml'],
    ['rId2', `${R}/settings`, 'settings.xml'],
    ['rId10', options.dataRelationshipType ?? DATA_REL, 'diagrams/data1.xml'],
    ['rId11', LAYOUT_REL, 'diagrams/layout1.xml'],
    ['rId12', STYLE_REL, 'diagrams/quickStyle1.xml'],
    ['rId13', COLORS_REL, 'diagrams/colors1.xml'],
  ];
  if (placement === 'document' || placement === 'dangling') documentRels.push(drawingEntry);
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(relationships([['rId1', `${R}/officeDocument`, 'word/document.xml']])),
    'word/_rels/document.xml.rels': strToU8(relationships(documentRels)),
    'word/document.xml': strToU8(document),
    'word/theme/theme1.xml': strToU8(THEME),
    'word/settings.xml': strToU8(SETTINGS),
    'word/diagrams/data1.xml': strToU8(data),
    'word/diagrams/layout1.xml': strToU8(
      options.layoutPartXml ?? `<dgm:layoutDef xmlns:dgm="${DGM}" uniqueId="urn:test/layout"/>`
    ),
    'word/diagrams/quickStyle1.xml': strToU8(
      options.stylePartXml ?? `<dgm:styleDef xmlns:dgm="${DGM}" uniqueId="urn:test/style"/>`
    ),
    'word/diagrams/colors1.xml': strToU8(
      options.colorsPartXml ?? `<dgm:colorsDef xmlns:dgm="${DGM}" uniqueId="urn:test/colors"/>`
    ),
  };
  if (placement === 'data') {
    files['word/diagrams/_rels/data1.xml.rels'] = strToU8(
      relationships([[drawingEntry[0], drawingEntry[1], 'drawing1.xml', drawingEntry[3]]])
    );
  }
  if (placement !== 'dangling') files['word/diagrams/drawing1.xml'] = strToU8(drawing);
  return zipSync(files);
}

export function openPackage(bytes: Uint8Array): OoxmlPackage {
  const result = readOoxmlPackage(bytes);
  if (!result.ok) throw new Error(`package rejected: ${JSON.stringify(result)}`);
  return result.package;
}

export function smartArtPackage(options: SmartArtDocxOptions = {}): OoxmlPackage {
  return openPackage(smartArtDocx(options));
}
