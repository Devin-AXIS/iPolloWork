// Lower a DrawingML text body (`a:bodyPr`, `a:lstStyle`, `a:p`/`a:r`) into a read-only
// WordprocessingML story, so the text box layout and both painters handle diagram text.
//
// The lowering states every paragraph and run property it knows explicitly, so the document's
// paragraph style and run defaults do not leak into shape text: DrawingML text has its own
// defaults (18 pt, single spacing, no space between paragraphs) and its own theme font slots.
// Every file-derived string reaches the generated markup through `escapeXml`/
// `escapeXmlAttribute`; numbers are parsed, bounded and re-printed, never copied.

import { findDirectChild } from './drawing-shape-readers.ts';
import { isElement } from './drawing-projection-walk.ts';
import {
  resolveColorNode,
  type ShapeColor,
  type ShapeSchemeColorResolver,
} from './drawing-shape-color.ts';
import { schemaAttributeValue } from './ooxml-drawing-rules.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI, readOoxmlPart, type OoxmlElement } from './ooxml-tree.ts';
import { escapeXml, escapeXmlAttribute, isValidXmlText } from './sinks.ts';

const A = DRAWINGML_MAIN_NAMESPACE_URI;
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** Bounds on what one shape's text may carry; past them the text does not lower. */
const MAX_PARAGRAPHS = 256;
const MAX_RUNS = 2048;
const MAX_TEXT_UNITS = 65_536;
/** Generated markup for one text body; font names and run properties repeat per run. */
const MAX_XML_UNITS = 4_194_304;
/** Longer typeface names fall back to the theme font rather than repeating per run. */
const MAX_FACE_UNITS = 128;

/** DrawingML's run size when nothing names one: 18 pt (ECMA-376 21.1.2.3.9). */
const DEFAULT_SIZE_HUNDREDTHS = 1800;
const MIN_SIZE_HUNDREDTHS = 100;
const MAX_SIZE_HUNDREDTHS = 400_000;
/** `a:bodyPr` inset defaults in EMU. */
const DEFAULT_INSET_LR_EMU = 91_440;
const DEFAULT_INSET_TB_EMU = 45_720;
const EMU_PER_TWIP = 635;
/** A generous bullet glyph width, in ems, for deciding whether a bullet fits its indent. */
const BULLET_WIDTH_EM = 0.6;

/** The text a shape's style supplies: `a:fontRef` names a theme font slot and a colour. @internal */
export interface DrawingTextDefaults {
  readonly fontSlot: 'major' | 'minor' | null;
  readonly color: ShapeColor | null;
}

/**
 * A lowered text body; `'no-text'` when it holds nothing to paint; `'unsupported'` when it
 * holds text the lowering cannot express (a vertical mode other than a quarter turn, several
 * columns, or a body past the bounds), so its shape must not render without it.
 *
 * @internal
 */
export type TextBodyLowering = LoweredDrawingText | 'no-text' | 'unsupported';

/** @internal */
export interface LoweredDrawingText {
  /** A `w:txbxContent` root holding the lowered paragraphs; node ids are namespaced. */
  readonly content: OoxmlElement;
  readonly insetsEmu: Readonly<{ top: number; right: number; bottom: number; left: number }>;
  readonly verticalAnchor: 'top' | 'center' | 'bottom';
  readonly noWrap: boolean;
  /** Clockwise turn `a:bodyPr/@rot` adds to the text, in degrees. */
  readonly rotationDegrees: number;
  /**
   * `vert="vert"` (90) or `vert="vert270"` (270): the lines run along the box's long side, so
   * the story lays out in the box turned a quarter. Insets are already in text space.
   */
  readonly quarterTurn: 0 | 90 | 270;
}

function child(parent: OoxmlElement | null | undefined, localName: string): OoxmlElement | null {
  return parent ? findDirectChild(parent.children, { namespaceUri: A, localName }) : null;
}

/** The first element child, such as the one colour inside a colour wrapper. */
function firstElement(parent: OoxmlElement | null): OoxmlElement | null {
  for (const node of parent?.children ?? []) if (isElement(node)) return node;
  return null;
}

function attr(element: OoxmlElement | null | undefined, name: string): string | undefined {
  return element ? schemaAttributeValue(element.attributes, name) : undefined;
}

/** A bounded integer attribute, or null when absent or out of range. */
function intAttr(
  element: OoxmlElement | null | undefined,
  name: string,
  min: number,
  max: number
): number | null {
  const raw = attr(element, name);
  if (raw === undefined || !/^[+-]?\d{1,10}$/.test(raw)) return null;
  const value = Number(raw);
  return value >= min && value <= max ? value : null;
}

function flagAttr(element: OoxmlElement | null | undefined, name: string): boolean | null {
  const raw = attr(element, name);
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  return null;
}

/** Paragraph properties after `a:lstStyle` level inheritance: the paragraph's own win. */
interface ParagraphProps {
  readonly align: string | undefined;
  readonly marginLeftEmu: number;
  readonly indentEmu: number;
  /** Line spacing: a multiple of single, or exact points. */
  readonly line: { readonly percent: number } | { readonly points: number };
  readonly before: { readonly percent: number } | { readonly points: number };
  readonly after: { readonly percent: number } | { readonly points: number };
  readonly bullet: BulletProps | null;
  readonly defaultRun: OoxmlElement | null;
}

/**
 * A character bullet. Its font, size and colour follow the paragraph's first run unless
 * `a:buFont`, `a:buSzPct`/`a:buSzPts` or `a:buClr` name their own.
 */
interface BulletProps {
  readonly char: string;
  readonly font: string | undefined;
  readonly sizeScale: number;
  readonly sizePoints: number | null;
  readonly color: OoxmlElement | null;
}

function spacingValue(
  element: OoxmlElement | null
): { readonly percent: number } | { readonly points: number } | null {
  const percent = intAttr(child(element, 'spcPct'), 'val', 0, 13_200_000);
  if (percent !== null) return { percent: percent / 100_000 };
  const points = intAttr(child(element, 'spcPts'), 'val', 0, 158_400);
  if (points !== null) return { points: points / 100 };
  return null;
}

function levelProperties(lstStyle: OoxmlElement | null, level: number): OoxmlElement | null {
  return child(lstStyle, `lvl${level + 1}pPr`);
}

function paragraphProps(paragraph: OoxmlElement, lstStyle: OoxmlElement | null): ParagraphProps {
  const own = child(paragraph, 'pPr');
  const level = intAttr(own, 'lvl', 0, 8) ?? 0;
  const inherited = levelProperties(lstStyle, level);
  const pick = <T>(read: (props: OoxmlElement | null) => T | null, fallback: T): T =>
    read(own) ?? read(inherited) ?? fallback;
  const bulletOf = (props: OoxmlElement | null): ParagraphProps['bullet'] | null => {
    if (!props) return null;
    if (child(props, 'buNone'))
      return { char: '', font: undefined, sizeScale: 1, sizePoints: null, color: null };
    const authored = attr(child(props, 'buChar'), 'char');
    if (authored === undefined) return null;
    // One bullet character paints, as a longer value draws only its first.
    const char = [...authored][0] ?? '';
    const percent = intAttr(child(props, 'buSzPct'), 'val', 25_000, 400_000);
    const points = intAttr(child(props, 'buSzPts'), 'val', 100, 400_000);
    const color = firstElement(child(props, 'buClr'));
    return {
      char,
      font: attr(child(props, 'buFont'), 'typeface'),
      sizeScale: percent !== null ? percent / 100_000 : 1,
      sizePoints: points !== null ? points / 100 : null,
      color,
    };
  };
  const bullet = pick(bulletOf, null);
  return {
    align: pick((props) => attr(props, 'algn') ?? null, 'l'),
    marginLeftEmu: pick((props) => intAttr(props, 'marL', 0, 51_206_400), 0),
    indentEmu: pick((props) => intAttr(props, 'indent', -51_206_400, 51_206_400), 0),
    line: pick((props) => spacingValue(child(props, 'lnSpc')), { percent: 1 }),
    before: pick((props) => spacingValue(child(props, 'spcBef')), { points: 0 }),
    after: pick((props) => spacingValue(child(props, 'spcAft')), { points: 0 }),
    bullet: bullet && bullet.char !== '' ? bullet : null,
    defaultRun: child(own, 'defRPr') ?? child(inherited, 'defRPr'),
  };
}

const ALIGNMENTS: ReadonlyMap<string, string> = new Map([
  ['l', 'left'],
  ['ctr', 'center'],
  ['r', 'right'],
  ['just', 'both'],
  ['justLow', 'both'],
  ['dist', 'distribute'],
  ['thaiDist', 'thaiDistribute'],
]);

/** A typeface name the lowering may copy: bounded and valid in XML. */
function usableFace(face: string | undefined): string | undefined {
  return face !== undefined && face.length <= MAX_FACE_UNITS && isValidXmlText(face)
    ? face
    : undefined;
}

/** A theme font token (`+mn-lt`, `+mj-ea`, …) as its WordprocessingML theme slot. */
function themeFontSlot(typeface: string): string | null {
  const match = /^\+(mn|mj)-(lt|ea|cs)$/.exec(typeface);
  if (!match) return null;
  const major = match[1] === 'mj' ? 'major' : 'minor';
  return match[2] === 'lt'
    ? `${major}HAnsi`
    : match[2] === 'ea'
      ? `${major}EastAsia`
      : `${major}Bidi`;
}

interface RunContext {
  readonly defaults: DrawingTextDefaults;
  readonly resolveSchemeColor?: ShapeSchemeColorResolver;
  readonly fontScale: number;
}

/** What a bullet changes on the run properties it copies from the first run. */
interface RunOverrides {
  readonly face?: string;
  readonly sizeScale?: number;
  readonly sizePoints?: number | null;
  readonly color?: OoxmlElement | null;
}

/** One run's `w:rPr`, from the run's `a:rPr` over the paragraph's default run properties. */
function runProperties(
  own: OoxmlElement | null,
  fallback: OoxmlElement | null,
  context: RunContext,
  overrides: RunOverrides = {}
): { readonly xml: string; readonly sizePoints: number } {
  const pick = (name: string): string | undefined => attr(own, name) ?? attr(fallback, name);
  const sizeRaw =
    intAttr(own, 'sz', MIN_SIZE_HUNDREDTHS, MAX_SIZE_HUNDREDTHS) ??
    intAttr(fallback, 'sz', MIN_SIZE_HUNDREDTHS, MAX_SIZE_HUNDREDTHS) ??
    DEFAULT_SIZE_HUNDREDTHS;
  const sizePoints = Math.max(
    1,
    overrides.sizePoints ?? (sizeRaw / 100) * context.fontScale * (overrides.sizeScale ?? 1)
  );
  // Half points, the unit `w:sz` carries; rounding keeps a valid integer.
  const halfPoints = Math.max(2, Math.round(sizePoints * 2));
  const parts: string[] = [];
  const face = (name: string) =>
    usableFace(attr(child(own, name), 'typeface')) ??
    usableFace(attr(child(fallback, name), 'typeface'));
  const latin = face('latin');
  const eastAsian = face('ea');
  const complex = face('cs');
  const slot = context.defaults.fontSlot ?? 'minor';
  const fontAttributes: string[] = [];
  const latinFace = overrides.face ?? latin ?? `+${slot === 'major' ? 'mj' : 'mn'}-lt`;
  const latinTheme = themeFontSlot(latinFace);
  if (latinTheme) {
    fontAttributes.push(`w:asciiTheme="${latinTheme}"`, `w:hAnsiTheme="${latinTheme}"`);
  } else {
    const face = escapeXmlAttribute(latinFace);
    fontAttributes.push(`w:ascii="${face}"`, `w:hAnsi="${face}"`);
  }
  const eastAsianFace = eastAsian ?? `+${slot === 'major' ? 'mj' : 'mn'}-ea`;
  const eastAsianTheme = themeFontSlot(eastAsianFace);
  if (eastAsianTheme) fontAttributes.push(`w:eastAsiaTheme="${eastAsianTheme}"`);
  else fontAttributes.push(`w:eastAsia="${escapeXmlAttribute(eastAsianFace)}"`);
  const complexFace = complex ?? `+${slot === 'major' ? 'mj' : 'mn'}-cs`;
  const complexTheme = themeFontSlot(complexFace);
  if (complexTheme) fontAttributes.push(`w:cstheme="${complexTheme}"`);
  else fontAttributes.push(`w:cs="${escapeXmlAttribute(complexFace)}"`);
  parts.push(`<w:rFonts ${fontAttributes.join(' ')}/>`);
  const bold = flagAttr(own, 'b') ?? flagAttr(fallback, 'b') ?? false;
  const italic = flagAttr(own, 'i') ?? flagAttr(fallback, 'i') ?? false;
  parts.push(`<w:b w:val="${bold ? 1 : 0}"/><w:bCs w:val="${bold ? 1 : 0}"/>`);
  parts.push(`<w:i w:val="${italic ? 1 : 0}"/><w:iCs w:val="${italic ? 1 : 0}"/>`);
  const caps = pick('cap');
  if (caps === 'all') parts.push('<w:caps/>');
  else if (caps === 'small') parts.push('<w:smallCaps/>');
  const strike = pick('strike');
  if (strike === 'sngStrike') parts.push('<w:strike/>');
  else if (strike === 'dblStrike') parts.push('<w:dstrike/>');
  const fill = child(own, 'solidFill') ?? child(fallback, 'solidFill');
  const fillColor = overrides.color ?? (fill ? fill.children.find(isElement) : undefined);
  const color =
    (fillColor ? resolveColorNode(fillColor, context.resolveSchemeColor) : null) ??
    context.defaults.color;
  parts.push(`<w:color w:val="${color ? color.hex : '000000'}"/>`);
  const spacing =
    intAttr(own, 'spc', -400_000, 400_000) ?? intAttr(fallback, 'spc', -400_000, 400_000);
  // `spc` is in hundredths of a point; `w:spacing` is in twips.
  if (spacing !== null && spacing !== 0)
    parts.push(`<w:spacing w:val="${Math.round(spacing / 5)}"/>`);
  // `kern` is the smallest size, in hundredths of a point, that kerns; `w:kern` is half points.
  const kern = intAttr(own, 'kern', 0, 400_000) ?? intAttr(fallback, 'kern', 0, 400_000);
  if (kern !== null && kern > 0)
    parts.push(`<w:kern w:val="${Math.max(1, Math.round(kern / 50))}"/>`);
  parts.push(`<w:sz w:val="${halfPoints}"/><w:szCs w:val="${halfPoints}"/>`);
  const underline = pick('u');
  parts.push(`<w:u w:val="${underline && underline !== 'none' ? 'single' : 'none'}"/>`);
  const baseline = intAttr(own, 'baseline', -10_000_000, 10_000_000);
  if (baseline !== null && baseline !== 0)
    parts.push(`<w:vertAlign w:val="${baseline > 0 ? 'superscript' : 'subscript'}"/>`);
  return { xml: `<w:rPr>${parts.join('')}</w:rPr>`, sizePoints };
}

/** Points of a spacing value; a percentage is of the paragraph's first line height. */
function spacingPoints(
  value: { readonly percent: number } | { readonly points: number },
  sizePoints: number
): number {
  // A DrawingML line at 100% is 1.2 times the font size.
  return 'points' in value ? value.points : value.percent * sizePoints * 1.2;
}

function textOfRun(run: OoxmlElement): string {
  let text = '';
  for (const node of child(run, 't')?.children ?? []) {
    if (node.kind === 'textValue') text += node.value;
  }
  return text;
}

/** Lower one text body; see {@link TextBodyLowering}. @internal */
export function lowerDrawingTextBody(
  txBody: OoxmlElement,
  partName: string,
  defaults: DrawingTextDefaults,
  resolveSchemeColor?: ShapeSchemeColorResolver
): TextBodyLowering {
  const bodyPr = child(txBody, 'bodyPr');
  const vert = attr(bodyPr, 'vert');
  const quarterTurn = vert === 'vert' ? 90 : vert === 'vert270' ? 270 : 0;
  if (vert !== undefined && vert !== 'horz' && quarterTurn === 0) return 'unsupported';
  if ((intAttr(bodyPr, 'numCol', 1, 16) ?? 1) !== 1) return 'unsupported';
  const lstStyle = child(txBody, 'lstStyle');
  const normAutofit = child(bodyPr, 'normAutofit');
  const fontScale = (intAttr(normAutofit, 'fontScale', 1_000, 100_000) ?? 100_000) / 100_000;
  const lineReduction = (intAttr(normAutofit, 'lnSpcReduction', 0, 90_000) ?? 0) / 100_000;
  const spaceFirstLast = flagAttr(bodyPr, 'spcFirstLastPara') ?? false;
  const runContext: RunContext = { defaults, resolveSchemeColor, fontScale };

  const paragraphs: OoxmlElement[] = [];
  for (const node of txBody.children) {
    if (isElement(node) && node.namespaceUri === A && node.localName === 'p') paragraphs.push(node);
  }
  if (paragraphs.length === 0) return 'no-text';
  if (paragraphs.length > MAX_PARAGRAPHS) return 'unsupported';
  let xmlUnits = 0;
  let runCount = 0;
  let textUnits = 0;
  let anyText = false;
  const xml: string[] = [];
  for (const [index, paragraph] of paragraphs.entries()) {
    const props = paragraphProps(paragraph, lstStyle);
    const runs: string[] = [];
    let firstSize: number | null = null;
    let firstRun: { readonly own: OoxmlElement | null; readonly xml: string } | null = null;
    for (const node of paragraph.children) {
      if (!isElement(node) || node.namespaceUri !== A) continue;
      if (node.localName !== 'r' && node.localName !== 'br' && node.localName !== 'fld') continue;
      runCount += 1;
      if (runCount > MAX_RUNS) return 'unsupported';
      const rPr = runProperties(child(node, 'rPr'), props.defaultRun, runContext);
      firstSize ??= rPr.sizePoints;
      firstRun ??= { own: child(node, 'rPr'), xml: rPr.xml };
      if (node.localName === 'br') {
        runs.push(`<w:r>${rPr.xml}<w:br/></w:r>`);
        continue;
      }
      const text = textOfRun(node);
      textUnits += text.length;
      if (textUnits > MAX_TEXT_UNITS || !isValidXmlText(text)) return 'unsupported';
      if (text.trim() !== '') anyText = true;
      runs.push(`<w:r>${rPr.xml}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`);
      xmlUnits += rPr.xml.length + text.length * 6;
      if (xmlUnits > MAX_XML_UNITS) return 'unsupported';
    }
    const endRun = runProperties(child(paragraph, 'endParaRPr'), props.defaultRun, runContext);
    const sizePoints = firstSize ?? endRun.sizePoints;
    const bullet =
      props.bullet && firstRun && isValidXmlText(props.bullet.char) ? props.bullet : null;
    let bulletTab = false;
    if (bullet && firstRun) {
      const face = usableFace(bullet.font);
      const bulletProps = runProperties(firstRun.own, props.defaultRun, runContext, {
        ...(face ? { face } : {}),
        sizeScale: bullet.sizeScale,
        sizePoints: bullet.sizePoints,
        color: bullet.color,
      });
      // The text starts at the left margin when the bullet fits in the hanging space, and
      // right after the bullet when it does not. The fit is judged on a wide bullet glyph,
      // since the lowering cannot measure: a tab past an overrun bullet would jump to the
      // next default stop instead.
      bulletTab = -props.indentEmu / 12_700 >= bulletProps.sizePoints * BULLET_WIDTH_EM;
      runs.unshift(
        `<w:r>${bulletProps.xml}<w:t xml:space="preserve">${escapeXml(bullet.char)}</w:t></w:r>` +
          (bulletTab ? `<w:r>${bulletProps.xml}<w:tab/></w:r>` : '')
      );
    }
    const line =
      'points' in props.line
        ? `w:line="${Math.max(20, Math.round(props.line.points * 20))}" w:lineRule="exact"`
        : `w:line="${Math.max(12, Math.round(240 * Math.max(0.05, props.line.percent - lineReduction)))}" w:lineRule="auto"`;
    const first = index === 0;
    const last = index === paragraphs.length - 1;
    const before = first && !spaceFirstLast ? 0 : spacingPoints(props.before, sizePoints);
    const after = last && !spaceFirstLast ? 0 : spacingPoints(props.after, sizePoints);
    const left = Math.round(props.marginLeftEmu / EMU_PER_TWIP);
    const indent = Math.round(props.indentEmu / EMU_PER_TWIP);
    const ind =
      indent < 0
        ? `<w:ind w:left="${left}" w:right="0" w:hanging="${-indent}"/>`
        : `<w:ind w:left="${left}" w:right="0" w:firstLine="${indent}"/>`;
    const jc = ALIGNMENTS.get(props.align ?? 'l') ?? 'left';
    xml.push(
      `<w:p><w:pPr><w:keepNext w:val="0"/><w:keepLines w:val="0"/><w:widowControl w:val="0"/>` +
        (bulletTab ? `<w:tabs><w:tab w:val="left" w:pos="${left}"/></w:tabs>` : '') +
        // Shape text does not snap to the document grid.
        `<w:snapToGrid w:val="0"/>` +
        `<w:spacing w:before="${Math.round(before * 20)}" w:after="${Math.round(after * 20)}" ${line}/>` +
        `${ind}<w:contextualSpacing w:val="0"/><w:jc w:val="${jc}"/>${firstRun?.xml ?? endRun.xml}</w:pPr>${runs.join('')}</w:p>`
    );
  }
  if (!anyText) return 'no-text';
  const parsed = readOoxmlPart(`<w:txbxContent xmlns:w="${W_NS}">${xml.join('')}</w:txbxContent>`, {
    name: partName,
    contentType: 'application/xml',
  });
  if (!parsed.ok) return 'unsupported';
  const inset = (name: string, fallback: number): number =>
    intAttr(bodyPr, name, 0, 51_206_400) ?? fallback;
  const box = {
    top: inset('tIns', DEFAULT_INSET_TB_EMU),
    right: inset('rIns', DEFAULT_INSET_LR_EMU),
    bottom: inset('bIns', DEFAULT_INSET_TB_EMU),
    left: inset('lIns', DEFAULT_INSET_LR_EMU),
  };
  // Turned a quarter clockwise, the text's top edge lies on the box's right side.
  const insetsEmu =
    quarterTurn === 90
      ? { top: box.right, right: box.bottom, bottom: box.left, left: box.top }
      : quarterTurn === 270
        ? { top: box.left, right: box.top, bottom: box.right, left: box.bottom }
        : box;
  const anchor = attr(bodyPr, 'anchor');
  const rotation = intAttr(bodyPr, 'rot', -21_600_000, 21_600_000) ?? 0;
  return {
    content: parsed.part.root,
    insetsEmu,
    verticalAnchor: anchor === 'ctr' ? 'center' : anchor === 'b' ? 'bottom' : 'top',
    noWrap: attr(bodyPr, 'wrap') === 'none',
    rotationDegrees: rotation / 60_000,
    quarterTurn,
  };
}
