// Synthetic chartex packages: one inline chartex drawing, optionally wrapped in the
// `mc:AlternateContent` Office writes around it, whose chartex part the test supplies.

import { strToU8, zipSync } from 'fflate';
import { readOoxmlPackage, type OoxmlPackage } from '../package/ooxml-package.ts';

export const CX = 'http://schemas.microsoft.com/office/drawing/2014/chartex';
const C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const CX1 = 'http://schemas.microsoft.com/office/drawing/2015/9/8/chartex';
const CS = 'http://schemas.microsoft.com/office/drawing/2012/chartStyle';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
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

const GRAY_TEXT =
  '<a:schemeClr val="tx1"><a:lumMod val="65000"/><a:lumOff val="35000"/></a:schemeClr>';
const LIGHT_LINE =
  '<a:ln w="9525"><a:solidFill><a:schemeClr val="tx1"><a:lumMod val="15000"/>' +
  '<a:lumOff val="85000"/></a:schemeClr></a:solidFill></a:ln>';

function entry(name: string, font: string, rest: string): string {
  return (
    `<cs:${name}><cs:lnRef idx="0"/><cs:fillRef idx="0"/><cs:effectRef idx="0"/>` +
    `<cs:fontRef idx="minor">${font}</cs:fontRef>${rest}</cs:${name}>`
  );
}

/** A chart style part with the entries a chartex chart reads, in the default look. */
export const CHART_STYLE_XML =
  `<cs:chartStyle xmlns:cs="${CS}" xmlns:a="${A}" id="395">` +
  entry('categoryAxis', GRAY_TEXT, `<cs:spPr>${LIGHT_LINE}</cs:spPr><cs:defRPr sz="900"/>`) +
  entry(
    'chartArea',
    '<a:schemeClr val="tx1"/>',
    `<cs:spPr><a:solidFill><a:schemeClr val="bg1"/></a:solidFill>${LIGHT_LINE}</cs:spPr><cs:defRPr sz="1000"/>`
  ) +
  entry('dataLabel', GRAY_TEXT, '<cs:defRPr sz="900"/>') +
  '<cs:dataPoint><cs:lnRef idx="0"/><cs:fillRef idx="0"><cs:styleClr val="auto"/></cs:fillRef>' +
  '<cs:effectRef idx="0"/><cs:fontRef idx="minor"><a:schemeClr val="tx1"/></cs:fontRef>' +
  '<cs:spPr><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></cs:spPr></cs:dataPoint>' +
  entry('gridlineMajor', '<a:schemeClr val="tx1"/>', `<cs:spPr>${LIGHT_LINE}</cs:spPr>`) +
  entry('legend', GRAY_TEXT, '<cs:defRPr sz="900"/>') +
  entry('plotArea', '<a:schemeClr val="tx1"/>', '') +
  entry(
    'seriesLine',
    '<a:schemeClr val="tx1"/>',
    '<cs:spPr><a:ln w="9525" cap="flat"><a:solidFill><a:srgbClr val="D9D9D9"/></a:solidFill></a:ln></cs:spPr>'
  ) +
  entry('title', GRAY_TEXT, '<cs:defRPr sz="1400"/>') +
  entry('valueAxis', GRAY_TEXT, '<cs:defRPr sz="900"/>') +
  '</cs:chartStyle>';

/** The colourful colour style: the six accents, then darker and lighter passes. */
export const COLOR_STYLE_XML =
  `<cs:colorStyle xmlns:cs="${CS}" xmlns:a="${A}" meth="cycle" id="10">` +
  [1, 2, 3, 4, 5, 6].map((index) => `<a:schemeClr val="accent${index}"/>`).join('') +
  '<cs:variation/><cs:variation><a:lumMod val="60000"/></cs:variation></cs:colorStyle>';

export interface WaterfallOptions {
  readonly categories?: readonly string[];
  readonly values?: readonly number[];
  readonly subtotals?: readonly number[];
  /** Undefined: an empty title element; null: no title element. */
  readonly title?: string | null;
  readonly labels?: boolean;
  readonly connectorLines?: boolean;
  readonly legend?: string | null;
  readonly formatCode?: string;
  /** Extra markup inside the series, after the data id. */
  readonly seriesExtra?: string;
  readonly layoutId?: string;
}

/** A waterfall chartex part. */
export function waterfallChartSpace(options: WaterfallOptions = {}): string {
  const categories = options.categories ?? ['Start', 'Up', 'Down', 'End'];
  const values = options.values ?? [100, 40, -30, 110];
  const points = (list: readonly (string | number)[]) =>
    list.map((value, index) => `<cx:pt idx="${index}">${value}</cx:pt>`).join('');
  const title =
    options.title === null
      ? ''
      : options.title === undefined
        ? '<cx:title pos="t" align="ctr" overlay="0"/>'
        : `<cx:title pos="t" align="ctr" overlay="0"><cx:tx><cx:txData><cx:v>${options.title}</cx:v></cx:txData></cx:tx></cx:title>`;
  const labels =
    options.labels === false
      ? ''
      : '<cx:dataLabels pos="outEnd"><cx:visibility seriesName="0" categoryName="0" value="1"/></cx:dataLabels>';
  const connectors = options.connectorLines === false ? '<cx:visibility connectorLines="0"/>' : '';
  const subtotals = (options.subtotals ?? [0, categories.length - 1])
    .map((index) => `<cx:idx val="${index}"/>`)
    .join('');
  const legend =
    options.legend === null
      ? ''
      : `<cx:legend pos="${options.legend ?? 't'}" align="ctr" overlay="0"/>`;
  return (
    `<cx:chartSpace xmlns:cx="${CX}" xmlns:a="${A}" xmlns:r="${R}"><cx:chartData><cx:data id="0">` +
    `<cx:strDim type="cat"><cx:f>Sheet1!$A$2:$A$9</cx:f><cx:lvl ptCount="${categories.length}">${points(categories)}</cx:lvl></cx:strDim>` +
    `<cx:numDim type="val"><cx:f>Sheet1!$B$2:$B$9</cx:f><cx:lvl ptCount="${values.length}" formatCode="${options.formatCode ?? 'General'}">${points(values)}</cx:lvl></cx:numDim>` +
    `</cx:data></cx:chartData><cx:chart>${title}<cx:plotArea><cx:plotAreaRegion>` +
    `<cx:series layoutId="${options.layoutId ?? 'waterfall'}" uniqueId="{00000000-0000-4000-8000-000000000001}">` +
    '<cx:tx><cx:txData><cx:f>Sheet1!$B$1</cx:f><cx:v>Amount</cx:v></cx:txData></cx:tx>' +
    `${labels}<cx:dataId val="0"/>${options.seriesExtra ?? ''}` +
    `<cx:layoutPr>${connectors}<cx:subtotals>${subtotals}</cx:subtotals></cx:layoutPr></cx:series></cx:plotAreaRegion>` +
    '<cx:axis id="0"><cx:catScaling gapWidth="0.5"/><cx:tickLabels/></cx:axis>' +
    '<cx:axis id="1"><cx:valScaling/><cx:majorGridlines/><cx:tickLabels/></cx:axis>' +
    `</cx:plotArea>${legend}</cx:chart></cx:chartSpace>`
  );
}

/** A classic clustered column chart part titled `title`, with two cached points. */
export function classicBarChartSpace(title = 'Quarterly totals'): string {
  const cache = (values: readonly (string | number)[], numeric: boolean) =>
    (numeric
      ? '<c:numRef><c:f>S!B1</c:f><c:numCache><c:formatCode>General</c:formatCode>'
      : '<c:strRef><c:f>S!A1</c:f><c:strCache>') +
    `<c:ptCount val="${values.length}"/>` +
    values.map((value, index) => `<c:pt idx="${index}"><c:v>${value}</c:v></c:pt>`).join('') +
    (numeric ? '</c:numCache></c:numRef>' : '</c:strCache></c:strRef>');
  return (
    `<c:chartSpace xmlns:c="${C}" xmlns:a="${A}" xmlns:r="${R}"><c:chart>` +
    `<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>${title}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>` +
    '<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>' +
    `<c:ser><c:idx val="0"/><c:order val="0"/><c:tx>${cache(['Alpha'], false)}</c:tx>` +
    `<c:cat>${cache(['North', 'South'], false)}</c:cat><c:val>${cache([3, 5], true)}</c:val></c:ser>` +
    '<c:axId val="1"/><c:axId val="2"/></c:barChart>' +
    '<c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>' +
    '<c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:crossAx val="1"/></c:valAx>' +
    '</c:plotArea><c:plotVisOnly val="1"/></c:chart></c:chartSpace>'
  );
}

/** A one-pixel PNG: the picture fallback Office saves beside a chartex drawing. */
const FALLBACK_PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGM4ceIEAAS0AlkWLoFAAAAAAElFTkSuQmCC'
  ),
  (char) => char.charCodeAt(0)
);

export interface ChartexDocxOptions {
  /** Wrap the drawing in `mc:AlternateContent` with a picture fallback, as Office writes it. */
  readonly alternateContent?: boolean;
  /** With `alternateContent`, leave the `mc:Fallback` empty: nothing that paints. */
  readonly emptyFallback?: boolean;
  /** Leave out the chart style and colour style parts. */
  readonly noStyleParts?: boolean;
  /** `chartXml` is a classic `c:chartSpace` part, referenced through `c:chart`. */
  readonly classic?: boolean;
  /** Lock attributes for the chart's `a:graphicFrameLocks`, such as `noSelect="1"`. */
  readonly frameLocks?: string;
  readonly cx?: number;
  readonly cy?: number;
}

export function chartexDocx(chartXml: string, options: ChartexDocxOptions = {}): Uint8Array {
  const cx = options.cx ?? 5486400;
  const cy = options.cy ?? 3200400;
  const inline = (graphic: string, id: number, framePr = '') =>
    `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:docPr id="${id}" name="Chart ${id}"/>${framePr}<a:graphic>${graphic}</a:graphic></wp:inline></w:drawing>`;
  const chart = inline(
    options.classic
      ? `<a:graphicData uri="${C}"><c:chart xmlns:c="${C}" r:id="rId10"/></a:graphicData>`
      : `<a:graphicData uri="${CX}"><cx:chart xmlns:cx="${CX}" r:id="rId10"/></a:graphicData>`,
    1,
    options.frameLocks
      ? `<wp:cNvGraphicFramePr><a:graphicFrameLocks ${options.frameLocks}/></wp:cNvGraphicFramePr>`
      : ''
  );
  const chartPart = options.classic ? 'chart1.xml' : 'chartEx1.xml';
  const fallback = inline(
    `<a:graphicData uri="${PIC}"><pic:pic xmlns:pic="${PIC}"><pic:nvPicPr><pic:cNvPr id="0" name=""/>` +
      '<pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId11"/></pic:blipFill>' +
      `<pic:spPr><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData>`,
    2
  );
  const fallbackXml = options.emptyFallback ? '' : fallback;
  const run = options.alternateContent
    ? `<mc:AlternateContent><mc:Choice Requires="cx1">${chart}</mc:Choice><mc:Fallback>${fallbackXml}</mc:Fallback></mc:AlternateContent>`
    : chart;
  const document =
    `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:r="${R}" xmlns:mc="${MC}" ` +
    `xmlns:cx1="${CX1}"><w:body><w:p><w:r>${run}</w:r></w:p><w:sectPr/></w:body></w:document>`;
  const styleParts = !options.noStyleParts;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (options.classic
          ? '<Override PartName="/word/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>'
          : '<Override PartName="/word/charts/chartEx1.xml" ContentType="application/vnd.ms-office.chartex+xml"/>') +
        '<Override PartName="/word/charts/style1.xml" ContentType="application/vnd.ms-office.chartstyle+xml"/>' +
        '<Override PartName="/word/charts/colors1.xml" ContentType="application/vnd.ms-office.chartcolorstyle+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${PR}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${PR}"><Relationship Id="rId1" Type="${R}/theme" Target="theme/theme1.xml"/>` +
        (options.classic
          ? `<Relationship Id="rId10" Type="${R}/chart" Target="charts/chart1.xml"/>`
          : '<Relationship Id="rId10" Type="http://schemas.microsoft.com/office/2014/relationships/chartEx" Target="charts/chartEx1.xml"/>') +
        `<Relationship Id="rId11" Type="${R}/image" Target="media/fallback.png"/></Relationships>`
    ),
    'word/document.xml': strToU8(document),
    'word/theme/theme1.xml': strToU8(THEME),
    [`word/charts/${chartPart}`]: strToU8(chartXml),
    'word/media/fallback.png': FALLBACK_PNG,
    ...(styleParts
      ? {
          [`word/charts/_rels/${chartPart}.rels`]: strToU8(
            `<Relationships xmlns="${PR}">` +
              '<Relationship Id="rId1" Type="http://schemas.microsoft.com/office/2011/relationships/chartStyle" Target="style1.xml"/>' +
              '<Relationship Id="rId2" Type="http://schemas.microsoft.com/office/2011/relationships/chartColorStyle" Target="colors1.xml"/>' +
              '</Relationships>'
          ),
          'word/charts/style1.xml': strToU8(CHART_STYLE_XML),
          'word/charts/colors1.xml': strToU8(COLOR_STYLE_XML),
        }
      : {}),
  });
}

export function chartexPackage(chartXml: string, options: ChartexDocxOptions = {}): OoxmlPackage {
  const result = readOoxmlPackage(chartexDocx(chartXml, options));
  if (!result.ok) throw new Error(`package rejected: ${JSON.stringify(result)}`);
  return result.package;
}
