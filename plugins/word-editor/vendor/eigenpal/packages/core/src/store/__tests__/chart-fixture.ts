// Synthetic chart packages: one inline chart drawing whose chart part the test supplies.

import { strToU8, zipSync } from 'fflate';
import { readOoxmlPackage, type OoxmlPackage } from '../package/ooxml-package.ts';

export const C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const PR = 'http://schemas.openxmlformats.org/package/2006/relationships';

const THEME =
  `<a:theme xmlns:a="${A}" name="Test"><a:themeElements><a:clrScheme name="Test">` +
  '<a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>' +
  '<a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>' +
  '<a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2>' +
  '<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>' +
  '<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6>' +
  '<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink>' +
  '</a:clrScheme><a:fontScheme name="Test"><a:majorFont><a:latin typeface="Calibri Light"/>' +
  '<a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/>' +
  '<a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Test">' +
  '<a:fillStyleLst/><a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme>' +
  '</a:themeElements></a:theme>';

/** A string cache of `values`. */
export function strCache(values: readonly string[]): string {
  return (
    `<c:strRef><c:f>S!A1</c:f><c:strCache><c:ptCount val="${values.length}"/>` +
    values.map((value, index) => `<c:pt idx="${index}"><c:v>${value}</c:v></c:pt>`).join('') +
    '</c:strCache></c:strRef>'
  );
}

/** A number cache of `values` with `format`. */
export function numCache(values: readonly number[], format = 'General'): string {
  return (
    `<c:numRef><c:f>S!B1</c:f><c:numCache><c:formatCode>${format}</c:formatCode>` +
    `<c:ptCount val="${values.length}"/>` +
    values.map((value, index) => `<c:pt idx="${index}"><c:v>${value}</c:v></c:pt>`).join('') +
    '</c:numCache></c:numRef>'
  );
}

/** One `c:ser` with a name, categories and values. */
export function series(
  index: number,
  name: string,
  categories: readonly string[],
  values: readonly number[],
  extra = ''
): string {
  return (
    `<c:ser><c:idx val="${index}"/><c:order val="${index}"/><c:tx>${strCache([name])}</c:tx>${extra}` +
    `<c:cat>${strCache(categories)}</c:cat><c:val>${numCache(values)}</c:val></c:ser>`
  );
}

/** A chart space around `plotArea` children, with an optional title and legend. */
export function chartSpace(
  plotArea: string,
  options: { title?: string; legend?: string } = {}
): string {
  const title = options.title
    ? `<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>${options.title}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`
    : '';
  const legend = options.legend
    ? `<c:legend><c:legendPos val="${options.legend}"/></c:legend>`
    : '';
  return (
    `<c:chartSpace xmlns:c="${C}" xmlns:a="${A}" xmlns:r="${R}"><c:chart>${title}` +
    `<c:autoTitleDeleted val="${options.title ? 0 : 1}"/><c:plotArea><c:layout/>${plotArea}</c:plotArea>` +
    `${legend}<c:plotVisOnly val="1"/></c:chart></c:chartSpace>`
  );
}

/** Category and value axes for a bar, line or area plot with axis ids 1 and 2. */
export const CATEGORY_VALUE_AXES =
  '<c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/>' +
  '<c:axPos val="b"/><c:majorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="2"/></c:catAx>' +
  '<c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/>' +
  '<c:axPos val="l"/><c:majorGridlines/><c:numFmt formatCode="General" sourceLinked="1"/>' +
  '<c:majorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="1"/>' +
  '<c:crossBetween val="between"/></c:valAx>';

export interface ChartDocxOptions {
  /** Relationship target mode of the chart part. */
  readonly external?: boolean;
  readonly cx?: number;
  readonly cy?: number;
}

export function chartDocx(chartXml: string, options: ChartDocxOptions = {}): Uint8Array {
  const cx = options.cx ?? 5486400;
  const cy = options.cy ?? 3200400;
  const document =
    `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:r="${R}"><w:body><w:p><w:r><w:drawing>` +
    `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
    '<wp:docPr id="1" name="Chart 1"/><a:graphic>' +
    `<a:graphicData uri="${C}"><c:chart xmlns:c="${C}" r:id="rId10"/></a:graphicData></a:graphic>` +
    '</wp:inline></w:drawing></w:r></w:p><w:sectPr/></w:body></w:document>';
  const target = options.external ? 'https://example.invalid/chart1.xml' : 'charts/chart1.xml';
  const mode = options.external ? ' TargetMode="External"' : '';
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${PR}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${PR}"><Relationship Id="rId1" Type="${R}/theme" Target="theme/theme1.xml"/>` +
        `<Relationship Id="rId10" Type="${R}/chart" Target="${target}"${mode}/></Relationships>`
    ),
    'word/document.xml': strToU8(document),
    'word/theme/theme1.xml': strToU8(THEME),
    'word/charts/chart1.xml': strToU8(chartXml),
  });
}

export function chartPackage(chartXml: string, options: ChartDocxOptions = {}): OoxmlPackage {
  const result = readOoxmlPackage(chartDocx(chartXml, options));
  if (!result.ok) throw new Error(`package rejected: ${JSON.stringify(result)}`);
  return result.package;
}
