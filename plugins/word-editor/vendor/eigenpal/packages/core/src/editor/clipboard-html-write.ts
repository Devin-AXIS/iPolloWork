// Serializes a clipboard fragment package — the miniature WordprocessingML OPC zip the copy
// lane produces — into the visible half of the `text/html` flavour. Structure comes from the
// canonical tree (headings, real lists, tables, anchors); formatting comes from a small
// cascade over the FRAGMENT's styles part, emitted as inline CSS for external editors.
//
// Security posture: the fragment is read through the bounded `readOoxmlPackage` trust
// boundary, and this writer is a pure string builder — no DOM APIs, no insertion sinks.
// Every file-derived value is escaped or allowlist-validated before it reaches the output.

import { hyphenDisplayOf } from '../layout/field-run-text.ts';
import { readOoxmlPackage, type OoxmlPackage } from '../store/package/ooxml-package.ts';
import { withoutStoryEndParagraph } from '../store/package/ooxml-story-end-repair.ts';
import { resolveContentType } from '../store/package/content-types.ts';
import {
  WML_NAMESPACE_URI,
  WP_NAMESPACE_URI,
  DRAWINGML_MAIN_NAMESPACE_URI,
  RELATIONSHIPS_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
} from '../store/package/ooxml-tree.ts';
import { relationshipsOf } from '../store/package/package-edit.ts';
import { resolveInternalTarget } from '../store/package/opc-names.ts';
import type { RelationshipRecord } from '../store/package/relationships.ts';
import { attributeValueOf } from '../store/store/tree-op-nodes.ts';
import { contentControlContentOf } from '../store/package/content-control-walk.ts';
import { isFldSimple } from '../store/package/field-nodes.ts';
import {
  isInlineRunContainer,
  MAX_INLINE_CONTAINER_DEPTH,
  nextInlineContainerDepth,
} from '../store/package/ooxml-shared.ts';
import { clipboardBase64Of } from './clipboard-html-base64.ts';
import { equationHtml } from './clipboard-html-write-equations.ts';
import { isOmmlEquationAtom } from '../store/package/omml-display.ts';
import {
  foldAttribute,
  lastProperty,
  paragraphPropertySources,
  relatedPart,
  runPropertyLayers,
  runBooleanOn,
  runToggleOn,
  styleChain,
  styleIndexOf,
  toggleOn,
  type RunPropertyLayers,
  type StyleIndex,
} from './clipboard-html-write-cascade.ts';
import {
  attrOf,
  cssHexColor,
  cssShading,
  escapeAttr,
  escapeHtml,
  findDescendant,
  isElement,
  parseIntValue,
  parseTwipsValue,
  ptFromTwips,
  textUnder,
  wmlChild,
  wmlVal,
} from './clipboard-html-write-tree.ts';
import { clipboardBookmarkName, clipboardHyperlinkTarget } from './clipboard-html-links.ts';
import { clipboardLanguageTag } from './clipboard-html-language.ts';
import { htmlNumberingIndexOf, type HtmlNumberingIndex } from './clipboard-html-write-numbering.ts';
import { noteIdsOf, renderNoteList, shippedNoteIds } from './clipboard-html-write-notes.ts';
import { renderHtmlTable } from './clipboard-html-write-table.ts';
import { wordTabStopsCss } from './clipboard-html-tab-stops.ts';
import {
  WORD_HIGHLIGHT_COLORS,
  WORD_JC_TO_TEXT_ALIGN,
  wordBorderCss,
  wordCssFontFamily,
  wordLineSpacingCss,
  wordNoteReferenceHtml,
  wordParagraphClassOf,
  wordPositionalTabHtml,
  wordUnderlineCss,
  type WordNoteBodyContext,
} from './clipboard-html-word-elements.ts';

const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NUMBERING_REL = `${R_NS}/numbering`;
const FOOTNOTES_REL = `${R_NS}/footnotes`;
const ENDNOTES_REL = `${R_NS}/endnotes`;

const DEFAULT_MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_IMAGE_BYTES = 8 * 1024 * 1024;
const EMU_PER_PX = 9525;
const CLIPBOARD_IMAGE_MIMES: ReadonlyMap<string, string> = new Map([
  ['image/png', 'image/png'],
  ['image/jpeg', 'image/jpeg'],
  ['image/jpg', 'image/jpeg'],
  ['image/gif', 'image/gif'],
  ['image/bmp', 'image/bmp'],
  ['image/x-ms-bmp', 'image/bmp'],
  ['image/x-bmp', 'image/bmp'],
  ['image/webp', 'image/webp'],
  ['image/svg+xml', 'image/svg+xml'],
  ['image/tiff', 'image/tiff'],
  ['image/x-emf', 'image/x-emf'],
  ['image/x-wmf', 'image/x-wmf'],
]);

export interface InteropHtmlOptions {
  /** Per-image data: URI budget, bytes of source media. Default 2 MiB. */
  readonly maxImageBytes?: number;
  /** Total image budget. Default 8 MiB. Images beyond either budget are omitted. */
  readonly maxTotalImageBytes?: number;
}

interface RunCss {
  readonly css: string;
  readonly vanish: boolean;
  readonly vertAlign: 'superscript' | 'subscript' | null;
  readonly lang: string | null;
  readonly rtl: boolean;
}

function scriptToggleOn(
  layers: RunPropertyLayers,
  rtl: boolean,
  latinName: string,
  complexName: string
): boolean {
  const hasComplex =
    (layers.direct !== null && wmlChild(layers.direct, complexName) !== null) ||
    lastProperty(layers.defaults, complexName) !== null ||
    lastProperty(layers.tableLevel, complexName) !== null ||
    lastProperty(layers.paragraphLevel, complexName) !== null ||
    lastProperty(layers.characterLevel, complexName) !== null;
  const name = rtl && hasComplex ? complexName : latinName;
  return runToggleOn(layers, name);
}

function runCssOf(layers: RunPropertyLayers): RunCss {
  const sources = layers.all;
  if (runToggleOn(layers, 'vanish')) {
    return { css: '', vanish: true, vertAlign: null, lang: null, rtl: false };
  }
  const rules: string[] = [];

  const rtl = toggleOn(sources, 'rtl');
  const font =
    (rtl ? foldAttribute(sources, 'rFonts', 'cs') : undefined) ??
    foldAttribute(sources, 'rFonts', 'ascii') ??
    foldAttribute(sources, 'rFonts', 'hAnsi') ??
    foldAttribute(sources, 'rFonts', 'eastAsia') ??
    (!rtl ? foldAttribute(sources, 'rFonts', 'cs') : undefined);
  if (font !== undefined) {
    const family = wordCssFontFamily(font);
    if (family) rules.push(`font-family:${family}`);
  }
  const sz = parseIntValue(
    (rtl ? foldAttribute(sources, 'szCs', 'val') : undefined) ??
      foldAttribute(sources, 'sz', 'val') ??
      (!rtl ? foldAttribute(sources, 'szCs', 'val') : undefined)
  );
  if (sz !== null && sz > 0) rules.push(`font-size:${Math.round((sz / 2) * 100) / 100}pt`);
  // An OFF that overrides a style must be EXPLICIT in the CSS: the emitted
  // paragraph class maps back to w:pStyle on paste, and a silent off would let
  // the style re-bold what the author deliberately un-bolded.
  const styleLayers: RunPropertyLayers = { ...layers, direct: null };
  const styleSources = layers.direct ? sources.slice(0, -1) : sources;
  if (scriptToggleOn(layers, rtl, 'b', 'bCs')) rules.push('font-weight:bold');
  else if (scriptToggleOn(styleLayers, rtl, 'b', 'bCs')) rules.push('font-weight:normal');
  if (scriptToggleOn(layers, rtl, 'i', 'iCs')) rules.push('font-style:italic');
  else if (scriptToggleOn(styleLayers, rtl, 'i', 'iCs')) rules.push('font-style:normal');

  const decorations: string[] = [];
  const underline = lastProperty(sources, 'u');
  const underlineOn = underline !== null && wmlVal(underline) !== 'none';
  if (underlineOn) decorations.push('underline');
  // `w:dstrike` is NOT a §17.7.3 toggle: two style levels both set must never XOR off.
  const doubleStrike = runBooleanOn(layers, 'dstrike');
  if (runToggleOn(layers, 'strike') || doubleStrike) decorations.push('line-through');
  if (decorations.length > 0) {
    rules.push(`text-decoration:${decorations.join(' ')}`);
  } else {
    const styleU = lastProperty(styleSources, 'u');
    if (
      (styleU !== null && wmlVal(styleU) !== 'none') ||
      runToggleOn(styleLayers, 'strike') ||
      runBooleanOn(styleLayers, 'dstrike')
    ) {
      rules.push('text-decoration:none');
    }
  }
  // A `w:u w:val="none"` must not emit decoration styling, and the double-strike
  // marker only travels when no underline claims text-decoration-style.
  if (underlineOn) rules.push(...wordUnderlineCss(underline));
  if (doubleStrike && !underlineOn) rules.push('text-decoration-style:double');

  const color = cssHexColor(foldAttribute(sources, 'color', 'val'));
  if (color) rules.push(`color:${color}`);
  const spacing = parseTwipsValue(foldAttribute(sources, 'spacing', 'val'));
  if (spacing !== null) rules.push(`letter-spacing:${Math.round((spacing / 20) * 100) / 100}pt`);

  // Highlight wins over shading when both are present.
  const highlightVal = wmlVal(lastProperty(sources, 'highlight'));
  const highlight =
    highlightVal !== undefined && Object.hasOwn(WORD_HIGHLIGHT_COLORS, highlightVal)
      ? WORD_HIGHLIGHT_COLORS[highlightVal]
      : undefined;
  const shdFill = cssShading(lastProperty(sources, 'shd'));
  if (highlight) {
    // The mso declaration lets a reader reconstruct w:highlight instead of shading.
    rules.push(`background-color:${highlight}`, `mso-highlight:${highlightVal}`);
  } else if (shdFill) {
    rules.push(`background-color:${shdFill}`);
  }

  if (runToggleOn(layers, 'caps')) rules.push('text-transform:uppercase');
  else if (runToggleOn(styleLayers, 'caps')) rules.push('text-transform:none');
  if (runToggleOn(layers, 'smallCaps')) rules.push('font-variant:small-caps');
  else if (runToggleOn(styleLayers, 'smallCaps')) rules.push('font-variant:normal');

  const vertAlignVal = wmlVal(lastProperty(sources, 'vertAlign'));
  const vertAlign =
    vertAlignVal === 'superscript' || vertAlignVal === 'subscript' ? vertAlignVal : null;
  // An RTL run's language is the BIDI one; `w:val` names the Latin language. The
  // read lane routes the tag back into the right w:lang SLOT (bidi for rtl runs,
  // eastAsia for CJK tags), so the round trip never overwrites w:val with it.
  const lang = clipboardLanguageTag(
    (rtl ? foldAttribute(sources, 'lang', 'bidi') : undefined) ??
      foldAttribute(sources, 'lang', 'val') ??
      foldAttribute(sources, 'lang', 'bidi') ??
      foldAttribute(sources, 'lang', 'eastAsia')
  );

  return { css: rules.join(';'), vanish: false, vertAlign, lang, rtl };
}

function paragraphCssOf(
  sources: readonly OoxmlElement[],
  omitLeftMargin: boolean,
  rtl = false
): string {
  const rules: string[] = [];
  const jc = wmlVal(lastProperty(sources, 'jc'));
  const align =
    jc !== undefined && Object.hasOwn(WORD_JC_TO_TEXT_ALIGN, jc)
      ? WORD_JC_TO_TEXT_ALIGN[jc]
      : undefined;
  if (align)
    rules.push(
      `text-align:${rtl && align !== 'center' && align !== 'justify' ? (align === 'left' ? 'right' : 'left') : align}`
    );

  const before = parseTwipsValue(foldAttribute(sources, 'spacing', 'before'));
  if (before !== null && before >= 0) rules.push(`margin-top:${ptFromTwips(before)}`);
  const after = parseTwipsValue(foldAttribute(sources, 'spacing', 'after'));
  if (after !== null && after >= 0) rules.push(`margin-bottom:${ptFromTwips(after)}`);
  const line = parseTwipsValue(foldAttribute(sources, 'spacing', 'line'));
  const lineRule = foldAttribute(sources, 'spacing', 'lineRule');
  rules.push(...wordLineSpacingCss(line, lineRule));

  // Fold w:ind per SOURCE, like layout/style-cascade.ts: hanging/firstLine are one
  // mutually exclusive pair per statement, so a direct `w:firstLine="0"` cancels a
  // style's hanging instead of coexisting with it.
  let left: number | null = null;
  let right: number | null = null;
  let hanging: number | null = null;
  let firstLine: number | null = null;
  for (const source of sources) {
    const ind = wmlChild(source, 'ind');
    if (!ind) continue;
    const leftValue = parseTwipsValue(
      attrOf(ind, 'left', WML_NAMESPACE_URI) ?? attrOf(ind, 'start', WML_NAMESPACE_URI)
    );
    if (leftValue !== null) left = leftValue;
    const rightValue = parseTwipsValue(
      attrOf(ind, 'right', WML_NAMESPACE_URI) ?? attrOf(ind, 'end', WML_NAMESPACE_URI)
    );
    if (rightValue !== null) right = rightValue;
    const hangingValue = parseTwipsValue(attrOf(ind, 'hanging', WML_NAMESPACE_URI));
    const firstLineValue = parseTwipsValue(attrOf(ind, 'firstLine', WML_NAMESPACE_URI));
    if (hangingValue !== null) {
      hanging = hangingValue;
      firstLine = null;
    } else if (firstLineValue !== null) {
      firstLine = firstLineValue;
      hanging = null;
    }
  }
  if (!omitLeftMargin && left !== null)
    rules.push(`margin-${rtl ? 'right' : 'left'}:${ptFromTwips(left)}`);
  if (right !== null) rules.push(`margin-${rtl ? 'left' : 'right'}:${ptFromTwips(right)}`);
  if (hanging !== null && hanging !== 0) rules.push(`text-indent:${ptFromTwips(-hanging)}`);
  else if (firstLine !== null && firstLine !== 0)
    rules.push(`text-indent:${ptFromTwips(firstLine)}`);

  const tabStops = wordTabStopsCss(lastProperty(sources, 'tabs'));
  if (tabStops) rules.push(tabStops);

  if (toggleOn(sources, 'pageBreakBefore')) rules.push('page-break-before:always');
  if (toggleOn(sources, 'keepNext')) rules.push('page-break-after:avoid');
  if (toggleOn(sources, 'keepLines')) rules.push('page-break-inside:avoid');
  if (toggleOn(sources, 'widowControl')) rules.push('widows:2', 'orphans:2');

  const shading = cssShading(lastProperty(sources, 'shd'));
  if (shading) rules.push(`background-color:${shading}`);
  const paragraphBorders = lastProperty(sources, 'pBdr');
  if (paragraphBorders) {
    for (const edge of ['top', 'left', 'bottom', 'right'] as const) {
      const css = wordBorderCss(wmlChild(paragraphBorders, edge));
      if (css) rules.push(`border-${edge}:${css}`, `mso-border-${edge}-alt:${css}`);
    }
  }

  return rules.join(';');
}

export interface RenderContext {
  readonly pkg: OoxmlPackage;
  readonly styles: StyleIndex;
  readonly numbering: HtmlNumberingIndex;
  readonly docRels: readonly RelationshipRecord[];
  readonly maxImageBytes: number;
  readonly maxTotalImageBytes: number;
  /** Running total of inlined media bytes — one shared object, so per-note context
   *  forks (`{ ...ctx }`) keep charging the same whole-document budget. */
  readonly imageBudget: { used: number };
  /** `data:` URI per media part — the budget charges each part ONCE, and repeated
   *  references reuse the encoding. */
  readonly imageDataUris: Map<string, string | null>;
  /** Display ordinal per note id, assigned in body reference order. */
  readonly noteOrdinals: Record<'footnote' | 'endnote', Map<number, number>>;
  /** Ids with a definition in the package's notes parts; a reference to any other
   *  id is dangling and renders nothing instead of a dead anchor. */
  readonly availableNotes: Record<'footnote' | 'endnote', ReadonlySet<number>>;
  readonly noteBody: WordNoteBodyContext | null;
  /** Conditional table-style layers for the CURRENT cell (wholeTable first, then
   *  the cell's condition) — set by the table renderer's per-cell context fork. */
  readonly tableRPr?: readonly OoxmlElement[];
  readonly tablePPr?: readonly OoxmlElement[];
}

function noteOrdinalOf(ctx: RenderContext, kind: 'footnote' | 'endnote', id: number): number {
  const map = ctx.noteOrdinals[kind];
  const existing = map.get(id);
  if (existing !== undefined) return existing;
  const ordinal = map.size + 1;
  map.set(id, ordinal);
  return ordinal;
}

/** Complex-field state, one per block sequence — a field's instruction region can
 *  cross paragraph marks and tables. Runs render only when every open field is past
 *  its separator (the cached result); instruction and fldChar runs emit nothing.
 *  `inert` disarms the machinery when the sequence's fldChars are UNBALANCED (note
 *  bodies bypass extraction's balance pass): field results then render as plain
 *  content rather than an open `instr` blanking everything after it. */
export interface FieldState {
  readonly stack: Array<'instr' | 'result'>;
  readonly inert: boolean;
}

const LIST_FMT_TO_CSS: Readonly<Record<string, string>> = {
  decimal: 'decimal',
  decimalZero: 'decimal-leading-zero',
  lowerLetter: 'lower-alpha',
  upperLetter: 'upper-alpha',
  lowerRoman: 'lower-roman',
  upperRoman: 'upper-roman',
  // Marker-suppressed levels must NOT fall back to decimal: the receiver would
  // show numbers the source never displays.
  none: 'none',
};

interface ListPlacement {
  readonly numId: string;
  readonly abstractId: string;
  readonly level: number;
  readonly fmt: string;
  readonly start: number;
}

/** The declared format and start of one level of a numbering definition. */
function listLevelInfo(
  ctx: RenderContext,
  numId: string,
  abstractId: string,
  level: number
): { readonly fmt: string; readonly start: number } {
  const fmt =
    ctx.numbering.formatOverrides.get(`${numId}:${level}`) ??
    ctx.numbering.levelFormats.get(abstractId)?.get(String(level)) ??
    'decimal';
  const start =
    ctx.numbering.startOverrides.get(`${numId}:${level}`) ??
    ctx.numbering.levelStarts.get(abstractId)?.get(String(level)) ??
    1;
  return { fmt, start };
}

function listPlacementOf(
  ctx: RenderContext,
  sources: readonly OoxmlElement[]
): ListPlacement | null {
  let numId: string | undefined;
  let ilvl: string | undefined;
  for (const source of sources) {
    const numPr = wmlChild(source, 'numPr');
    if (!numPr) continue;
    const id = wmlVal(wmlChild(numPr, 'numId'));
    if (id !== undefined) numId = id;
    const level = wmlVal(wmlChild(numPr, 'ilvl'));
    if (level !== undefined) ilvl = level;
  }
  if (numId === undefined || numId === '0') return null;
  let abstractId = ctx.numbering.numToAbstract.get(numId);
  if (abstractId === undefined) return null;
  // A level-less abstractNum can delegate through w:numStyleLink: the linked
  // numbering STYLE names the numId whose abstract holds the real levels. Links
  // can chain; the hop cap matches the layout resolver's.
  for (let hop = 0; hop < 8; hop += 1) {
    if ((ctx.numbering.levelFormats.get(abstractId)?.size ?? 0) > 0) break;
    const linkedStyle = ctx.numbering.styleLinks.get(abstractId);
    const style = linkedStyle === undefined ? undefined : ctx.styles.byId.get(linkedStyle);
    const linkedNumId = wmlVal(
      wmlChild(wmlChild(wmlChild(style ?? null, 'pPr'), 'numPr'), 'numId')
    );
    const resolved =
      linkedNumId === undefined ? undefined : ctx.numbering.numToAbstract.get(linkedNumId);
    if (resolved === undefined || resolved === abstractId) break;
    abstractId = resolved;
  }
  const level = Math.min(Math.max(parseIntValue(ilvl) ?? 0, 0), 8);
  const info = listLevelInfo(ctx, numId, abstractId, level);
  return { numId, abstractId, level, fmt: info.fmt, start: info.start };
}

function clipboardImageMime(ctx: RenderContext, partName: string): string | null {
  const claimed = resolveContentType(ctx.pkg.contentTypes, partName);
  if (claimed.ok) {
    const mime = CLIPBOARD_IMAGE_MIMES.get(claimed.contentType.toLowerCase());
    if (mime !== undefined) return mime;
  }
  const dot = partName.lastIndexOf('.');
  const extension = dot === -1 ? '' : partName.slice(dot + 1).toLowerCase();
  if (extension === 'png') return 'image/png';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'bmp') return 'image/bmp';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'svg') return 'image/svg+xml';
  if (extension === 'tif' || extension === 'tiff') return 'image/tiff';
  if (extension === 'emf') return 'image/x-emf';
  if (extension === 'wmf') return 'image/x-wmf';
  return null;
}

function renderDrawing(ctx: RenderContext, drawing: OoxmlElement): string {
  // Kind-independent walk: a demoted-to-generic drawing still names its parts. Anchored
  // pictures render like inline ones — HTML has no float-anchor model worth emulating,
  // but the image itself must not vanish from the interop flavour.
  const inline =
    findDescendant(drawing, 'inline', WP_NAMESPACE_URI) ??
    findDescendant(drawing, 'anchor', WP_NAMESPACE_URI);
  if (!inline) return '';
  const blip = findDescendant(inline, 'blip', DRAWINGML_MAIN_NAMESPACE_URI);
  if (!blip) return '';
  const relId = attributeValueOf(blip, 'embed', RELATIONSHIPS_NAMESPACE_URI);
  if (!relId) return '';
  const record = ctx.docRels.find((r) => r.id === relId && r.targetMode !== 'External');
  if (!record) return '';
  const resolved = resolveInternalTarget(record.ownerPart, record.rawTarget);
  if (!resolved.ok) return '';
  // The reader keys partBytes by ZIP entry name (no leading slash); tolerate the
  // canonical spelling too, like the extract lane's own media resolution.
  const bytes =
    ctx.pkg.partBytes.get(resolved.partName.replace(/^\//, '')) ??
    ctx.pkg.partBytes.get(resolved.partName);
  if (!bytes) return '';

  const mime = clipboardImageMime(ctx, resolved.partName);
  if (!mime) return '';
  // The budget charges PER EMITTED REFERENCE — every `<img>` duplicates the data URI
  // in the output, so a hostile file cannot amplify one part into unbounded output.
  // The encoding itself is cached and computed once per part.
  if (bytes.byteLength > ctx.maxImageBytes) return '';
  if (ctx.imageBudget.used + bytes.byteLength > ctx.maxTotalImageBytes) return '';
  ctx.imageBudget.used += bytes.byteLength;
  let dataUri = ctx.imageDataUris.get(resolved.partName);
  if (dataUri === undefined || dataUri === null) {
    dataUri = `data:${mime};base64,${clipboardBase64Of(bytes)}`;
    ctx.imageDataUris.set(resolved.partName, dataUri);
  }

  const extent = findDescendant(inline, 'extent', WP_NAMESPACE_URI);
  const cx = extent ? parseIntValue(attributeValueOf(extent, 'cx', '')) : null;
  const cy = extent ? parseIntValue(attributeValueOf(extent, 'cy', '')) : null;
  // The pt CSS extents are unit-explicit, so a reader parses them the same way in
  // both its Word and plain conventions; the px attributes serve plain receivers.
  const ptOf = (emu: number): number => Math.round((emu / 12_700) * 100) / 100;
  const size =
    cx !== null && cy !== null && cx > 0 && cy > 0
      ? ` width="${Math.round(cx / EMU_PER_PX)}" height="${Math.round(cy / EMU_PER_PX)}"` +
        ` style="width:${ptOf(cx)}pt;height:${ptOf(cy)}pt"`
      : '';
  return `<img src="${dataUri}"${size}>`;
}

/** Advance the field stack over content that renders nothing (deleted regions).
 *  Walks EXACTLY what the renderer walks: a fldChar inside a drawing's textbox or
 *  an SDT's properties never reaches renderRun, so counting it would desync the
 *  balance probe from the render pass and blank everything after it. */
function advanceFieldState(node: OoxmlElement, fields: FieldState, depth = 0): void {
  if (depth >= MAX_INLINE_CONTAINER_DEPTH) return;
  const childDepth = isFldSimple(node) ? depth + 1 : nextInlineContainerDepth(node, depth);
  for (const child of node.children) {
    if (!isElement(child)) continue;
    if (child.kind === 'drawing') continue;
    if (child.kind === 'contentControl') {
      const content = child.children.find((inner) => inner.kind === 'contentControlContent');
      if (content && isElement(content)) advanceFieldState(content, fields, childDepth + 1);
      continue;
    }
    if (child.kind === 'fldChar') {
      advanceFieldCharacter(child, fields);
      continue;
    }
    advanceFieldState(child, fields, childDepth);
  }
}

function advanceFieldCharacter(node: OoxmlElement, fields: FieldState): void {
  const type = attributeValueOf(node, 'fldCharType', WML_NAMESPACE_URI);
  if (type === 'begin') fields.stack.push('instr');
  else if (type === 'separate' && fields.stack.length > 0) {
    fields.stack[fields.stack.length - 1] = 'result';
  } else if (type === 'end') fields.stack.pop();
}

function renderRun(
  ctx: RenderContext,
  run: OoxmlElement,
  paragraphPPr: OoxmlElement | null,
  fields: FieldState
): string {
  const rPr = run.children.find((child) => child.kind === 'runProperties');
  const layers = runPropertyLayers(
    ctx.styles,
    paragraphPPr,
    rPr && isElement(rPr) ? rPr : null,
    ctx.tableRPr
  );
  const style = runCssOf(layers);

  let inner = '';
  for (const child of run.children) {
    if (!isElement(child)) continue;
    if (child.kind === 'fldChar') {
      if (!fields.inert) advanceFieldCharacter(child, fields);
      continue;
    }
    if (child.kind === 'instrText') continue;
    if ((!fields.inert && fields.stack.some((mode) => mode === 'instr')) || style.vanish) continue;
    const positionalTab = wordPositionalTabHtml(child);
    if (positionalTab !== '') {
      inner += positionalTab;
      continue;
    }
    const noteReference = wordNoteReferenceHtml(
      child,
      ctx.noteBody,
      (kind, id) => noteOrdinalOf(ctx, kind, id),
      (kind, id) => ctx.availableNotes[kind].has(id)
    );
    if (noteReference !== '') {
      inner += noteReference;
      continue;
    }
    switch (child.kind) {
      case 'text':
        inner += escapeHtml(textUnder(child));
        break;
      case 'tab':
        inner += '<span style="white-space:pre;mso-tab-count:1">\t</span>';
        break;
      case 'hardBreak': {
        const type = attributeValueOf(child, 'type', WML_NAMESPACE_URI);
        inner += type === 'page' ? '<br style="page-break-before:always">' : '<br>';
        break;
      }
      case 'bookmarkStart': {
        const name = clipboardBookmarkName(attributeValueOf(child, 'name', WML_NAMESPACE_URI));
        if (name !== null) inner += `<a id="${escapeAttr(name)}"></a>`;
        break;
      }
      case 'drawing':
        inner += renderDrawing(ctx, child);
        break;
      // deletedText only appears under deletions; noteReference has no HTML mapping in v1.
      default:
        // A non-breaking hyphen copies as U+2011 and an optional hyphen as U+00AD.
        inner += hyphenDisplayOf(child)?.text ?? '';
        break;
    }
  }
  if (inner === '') return '';
  if (style.vertAlign === 'superscript') inner = `<sup>${inner}</sup>`;
  else if (style.vertAlign === 'subscript') inner = `<sub>${inner}</sub>`;
  const attributes =
    `${style.lang === null ? '' : ` lang="${style.lang}"`}` +
    `${style.rtl ? ' dir="rtl"' : ''}` +
    `${style.css === '' ? '' : ` style="${escapeAttr(style.css)}"`}`;
  return attributes === '' ? inner : `<span${attributes}>${inner}</span>`;
}

function renderInline(
  ctx: RenderContext,
  children: readonly OoxmlNode[],
  paragraphPPr: OoxmlElement | null,
  fields: FieldState,
  depth = 0
): string {
  if (depth >= MAX_INLINE_CONTAINER_DEPTH) return '';
  let out = '';
  for (const child of children) {
    if (!isElement(child)) continue;
    switch (isFldSimple(child) ? 'fldSimple' : child.kind) {
      case 'run':
        out += renderRun(ctx, child, paragraphPPr, fields);
        break;
      case 'hyperlink': {
        const inner = renderInline(ctx, child.children, paragraphPPr, fields, depth + 1);
        if (inner === '') break;
        const relId = attributeValueOf(child, 'id', RELATIONSHIPS_NAMESPACE_URI);
        // Match by id alone: producers vary the relationship Type string, and the
        // external/fragment gate below is what actually protects the output.
        const record = relId ? ctx.docRels.find((r) => r.id === relId) : undefined;
        // An internal-mode rel target is a part path, not a URL — only its fragment
        // form (a same-document anchor) survives into the interop flavour.
        const rawTarget =
          record === undefined
            ? undefined
            : record.targetMode === 'External' || record.rawTarget.startsWith('#')
              ? record.rawTarget
              : undefined;
        const target = clipboardHyperlinkTarget(
          rawTarget,
          attributeValueOf(child, 'anchor', WML_NAMESPACE_URI)
        );
        out += target !== null ? `<a href="${escapeAttr(target)}">${inner}</a>` : inner;
        break;
      }
      case 'bookmarkStart': {
        const name = clipboardBookmarkName(attributeValueOf(child, 'name', WML_NAMESPACE_URI));
        if (name !== null) out += `<a id="${escapeAttr(name)}"></a>`;
        break;
      }
      case 'fldSimple':
        // Cached results remain visible when nested simple fields become generic.
        out += renderInline(ctx, child.children, paragraphPPr, fields, depth + 1);
        break;
      case 'contentControl': {
        const content = child.children.find((inner) => inner.kind === 'contentControlContent');
        if (content && isElement(content)) {
          out += renderInline(ctx, content.children, paragraphPPr, fields, depth + 1);
        }
        break;
      }
      case 'revisionInsert':
      case 'revisionMoveTo':
        out += renderInline(ctx, child.children, paragraphPPr, fields, depth + 1);
        break;
      // Deleted and moved-away content never travels to external apps — but its
      // fldChars still terminate fields, or an unbalanced 'instr' state would blank
      // every later paragraph.
      case 'revisionDelete':
      case 'revisionMoveFrom':
        advanceFieldState(child, fields, depth);
        break;
      case 'generic':
        if (isOmmlEquationAtom(child)) {
          out += equationHtml(child);
        } else if (isInlineRunContainer(child)) {
          out += renderInline(ctx, child.children, paragraphPPr, fields, depth + 1);
        } else {
          const content = contentControlContentOf(child);
          if (content) out += renderInline(ctx, content, paragraphPPr, fields, depth + 1);
        }
        break;
    }
  }
  return out;
}

/** Heading level plus WHY: only a real Heading style earns the mappable class. */
function headingLevelOf(
  ctx: RenderContext,
  ownPPr: OoxmlElement | null
): { readonly level: number; readonly fromStyle: boolean } | null {
  const styleId = wmlVal(wmlChild(ownPPr, 'pStyle'));
  const chain = styleChain(ctx.styles, styleId, 'paragraph');
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const id = attributeValueOf(chain[index]!, 'styleId', WML_NAMESPACE_URI);
    const match = id ? /^Heading([1-6])$/.exec(id) : null;
    if (match) return { level: Number(match[1]), fromStyle: true };
  }
  // An outline level promotes to <h1>-<h6> only as DIRECT formatting on an unstyled
  // paragraph: a custom style, Normal, or docDefaults setting w:outlineLvl for the
  // TOC must not turn body text into HeadingN on a round trip.
  if (styleId === undefined) {
    const outline = parseIntValue(wmlVal(wmlChild(ownPPr, 'outlineLvl')));
    if (outline !== null && outline >= 0 && outline <= 5) {
      return { level: outline + 1, fromStyle: false };
    }
  }
  return null;
}

function paragraphClassOf(ctx: RenderContext, ownPPr: OoxmlElement | null): string | null {
  const chain = styleChain(ctx.styles, wmlVal(wmlChild(ownPPr, 'pStyle')), 'paragraph');
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const found = wordParagraphClassOf(
      attributeValueOf(chain[index]!, 'styleId', WML_NAMESPACE_URI)
    );
    if (found !== null) return found;
  }
  return null;
}

function renderParagraph(
  ctx: RenderContext,
  paragraph: OoxmlElement,
  options: { readonly asListItem: boolean },
  // The field state spans paragraphs: a complex field's instruction region can
  // cross a paragraph mark, and its content must stay out of the flavour.
  fields: FieldState
): string {
  const pPrNode = paragraph.children.find((child) => child.kind === 'paragraphProperties');
  const pPr = pPrNode && isElement(pPrNode) ? pPrNode : null;
  const sources = paragraphPropertySources(ctx.styles, pPr, ctx.tablePPr);
  const css = paragraphCssOf(sources, options.asListItem, toggleOn(sources, 'bidi'));
  const inner = renderInline(ctx, paragraph.children, pPr, fields);
  const styleAttr = css === '' ? '' : ` style="${escapeAttr(css)}"`;
  const dirAttr = toggleOn(sources, 'bidi') ? ' dir="rtl"' : '';
  const wordClass = paragraphClassOf(ctx, pPr);
  const classAttr = wordClass === null ? '' : ` class="${wordClass}"`;
  const heading = headingLevelOf(ctx, pPr);

  if (options.asListItem) {
    const listClass = heading?.fromStyle === true ? ` class="Heading${heading.level}"` : classAttr;
    return `<li${listClass}${dirAttr}${styleAttr}>${inner}</li>`;
  }
  const tag = heading === null ? 'p' : `h${heading.level}`;
  // The `Heading<N>` class is the marker the read lane maps back to the STYLE in
  // every dialect — earned only by a real Heading style. A direct outline level
  // gets the explicit `docx-outline` class instead, which the read lane's
  // heading-TAG fallback recognizes and skips, so plain body text does not
  // acquire a Heading style on the round trip.
  const headingAttr =
    heading === null
      ? classAttr
      : heading.fromStyle
        ? ` class="Heading${heading.level}"`
        : ' class="docx-outline"';
  return `<${tag}${headingAttr}${dirAttr}${styleAttr}>${inner}</${tag}>`;
}

/** Injected into the extracted table renderer, so the runtime dependency stays one-way. */
const tableRenderDeps = {
  renderBlocks: (ctx: RenderContext, children: readonly OoxmlNode[], shared?: FieldState) =>
    renderBlocks(ctx, children, shared),
  advanceFieldState,
};

interface OpenList {
  readonly tag: 'ol' | 'ul';
  readonly numId: string;
  readonly abstractId: string;
}

function renderBlocks(
  ctx: RenderContext,
  children: readonly OoxmlNode[],
  // A field can span from a body paragraph into a table cell; the table's cells
  // continue the CALLER's field state instead of resetting it.
  sharedFields?: FieldState
): string {
  let out = '';
  const openLists: OpenList[] = [];
  let listBaseLevel: number | null = null;
  /** Items already emitted per `numId:level`, so a reopened list resumes numbering. */
  const listProgress = new Map<string, number>();
  let fields = sharedFields;
  if (fields === undefined) {
    // Probe balance first: a sequence with unbalanced fldChars (note bodies bypass
    // extraction's balance pass) renders with the field machinery disarmed, so an
    // open `instr` cannot blank everything after it.
    const probe: FieldState = { stack: [], inert: false };
    for (const child of children) {
      if (isElement(child)) advanceFieldState(child, probe);
    }
    fields = { stack: [], inert: probe.stack.length > 0 };
  }

  const closeTopList = (): void => {
    const top = openLists.pop();
    if (top) out += `</${top.tag}>`;
  };
  const closeAllLists = (): void => {
    while (openLists.length > 0) closeTopList();
    listBaseLevel = null;
  };

  // A deeper level opens its nested list as a direct child of the enclosing list — the
  // shape every word-processor receiver accepts — and each `<li>` closes immediately.
  const emitListItem = (paragraph: OoxmlElement, placement: ListPlacement): void => {
    if (listBaseLevel !== null && placement.level < listBaseLevel) closeAllLists();
    // A DIFFERENT list closes every open level, not just the top: a new list
    // starting at ilvl >= 1 must not nest inside the previous list's outer
    // wrapper, or the read lane hands its items the old list's identity. "Same
    // list" compares the ABSTRACT id — Word's per-level style pattern (List
    // Number / List Number 2) uses one numId per level over one shared abstract,
    // and those levels must stay nested. A same-abstract numId switch at equal
    // depth is a restarted sibling list and closes only its own level.
    while (
      openLists.length > 0 &&
      openLists[openLists.length - 1]!.abstractId !== placement.abstractId
    ) {
      closeTopList();
    }
    if (openLists.length === 0) listBaseLevel = placement.level;
    const baseLevel = listBaseLevel ?? placement.level;
    const depth = placement.level - baseLevel + 1;
    while (openLists.length > depth) closeTopList();
    if (openLists.length === depth && openLists[depth - 1]!.numId !== placement.numId) {
      closeTopList();
    }
    while (openLists.length < depth) {
      // Each opened level uses ITS OWN declared format, and a reopened list resumes
      // from the running counter so an interrupting paragraph does not renumber it.
      const levelIndex = baseLevel + openLists.length;
      const info = listLevelInfo(ctx, placement.numId, placement.abstractId, levelIndex);
      const consumed =
        listProgress.get(`${placement.abstractId}:${placement.numId}:${levelIndex}`) ?? 0;
      const startValue = info.start + consumed;
      const tag: 'ol' | 'ul' = info.fmt === 'bullet' ? 'ul' : 'ol';
      const listType =
        tag === 'ol'
          ? Object.hasOwn(LIST_FMT_TO_CSS, info.fmt)
            ? LIST_FMT_TO_CSS[info.fmt]!
            : 'decimal'
          : null;
      const start = tag === 'ol' && startValue !== 1 ? ` start="${startValue}"` : '';
      out += listType
        ? `<${tag}${start} style="list-style-type:${escapeAttr(listType)}">`
        : `<${tag}>`;
      openLists.push({ tag, numId: placement.numId, abstractId: placement.abstractId });
    }
    const progressKey = `${placement.abstractId}:${placement.numId}:${placement.level}`;
    listProgress.set(progressKey, (listProgress.get(progressKey) ?? 0) + 1);
    // Word restarts sub-levels after each parent item — across the whole ABSTRACT,
    // so the per-level-numId pattern (List Number / List Number 2) restarts its
    // sublists too, not only keys under the current item's numId. The level is
    // the digits after the LAST separator, so a file-supplied id containing ':'
    // cannot confuse the match.
    const prefix = `${placement.abstractId}:`;
    for (const key of listProgress.keys()) {
      if (!key.startsWith(prefix)) continue;
      const levelPart = key.slice(key.lastIndexOf(':') + 1);
      if (/^\d+$/.test(levelPart) && Number(levelPart) > placement.level) {
        listProgress.delete(key);
      }
    }
    out += renderParagraph(ctx, paragraph, { asListItem: true }, fields);
  };

  const visit = (nodes: readonly OoxmlNode[]): void => {
    for (const child of nodes) {
      if (!isElement(child)) continue;
      switch (child.kind) {
        case 'paragraph': {
          const pPrNode = child.children.find((inner) => inner.kind === 'paragraphProperties');
          const pPr = pPrNode && isElement(pPrNode) ? pPrNode : null;
          const placement = listPlacementOf(ctx, paragraphPropertySources(ctx.styles, pPr));
          if (placement) {
            emitListItem(child, placement);
          } else {
            closeAllLists();
            out += renderParagraph(ctx, child, { asListItem: false }, fields);
          }
          break;
        }
        case 'table':
          closeAllLists();
          out += renderHtmlTable(ctx, child, fields, tableRenderDeps);
          break;
        case 'contentControl': {
          const content = child.children.find((inner) => inner.kind === 'contentControlContent');
          if (content && isElement(content)) visit(content.children);
          break;
        }
        case 'generic':
          // Unknown wrappers may hide block content; raw markup itself never travels.
          visit(child.children);
          break;
        case 'bookmarkStart': {
          // Without its anchor, `w:anchor` hyperlinks in the same copy dangle.
          const name = clipboardBookmarkName(attributeValueOf(child, 'name', WML_NAMESPACE_URI));
          if (name !== null) out += `<a id="${escapeAttr(name)}"></a>`;
          break;
        }
        default:
          // A skipped block-level child (a bare run under a generic wrapper) still
          // advances the field state the balance probe counted, or an open 'instr'
          // the probe saw closed blanks every later paragraph.
          if (!fields.inert) advanceFieldState(child, fields);
          break;
      }
    }
  };
  visit(children);
  closeAllLists();
  return out;
}

/**
 * Interop HTML for the fragment package's document body. Returns '' when the package
 * cannot be read.
 *
 * Returns the block sequence WITHOUT a wrapper element: the caller wraps the result in
 * the single `<div>` that also carries the fragment attribute (design D1), so this
 * writer never emits data attributes of its own.
 */
export function interopHtmlFromFragment(
  fragmentBytes: Uint8Array,
  options?: InteropHtmlOptions
): string {
  const read = readOoxmlPackage(fragmentBytes);
  if (!read.ok) return '';
  return interopHtmlFromFragmentPackage(withoutStoryEndParagraph(read.package), options);
}

/** The same writer over an ALREADY-ASSEMBLED fragment package (the copy path),
 *  so building the flavour never pays a second inflate + parse. */
export function interopHtmlFromFragmentPackage(
  pkg: OoxmlPackage,
  options?: InteropHtmlOptions
): string {
  const documentPart = pkg.parts.get(pkg.mainDocumentPart);
  if (!documentPart || !isElement(documentPart.root)) return '';
  const body = documentPart.root.children.find((child) => child.kind === 'body');
  if (!body || !isElement(body)) return '';

  const footnotesRoot = relatedPart(pkg, FOOTNOTES_REL, '/word/footnotes.xml');
  const endnotesRoot = relatedPart(pkg, ENDNOTES_REL, '/word/endnotes.xml');
  const ctx: RenderContext = {
    pkg,
    styles: styleIndexOf(pkg),
    numbering: htmlNumberingIndexOf(relatedPart(pkg, NUMBERING_REL, '/word/numbering.xml')),
    docRels: relationshipsOf(pkg, pkg.mainDocumentPart),
    maxImageBytes: options?.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES,
    maxTotalImageBytes: options?.maxTotalImageBytes ?? DEFAULT_MAX_TOTAL_IMAGE_BYTES,
    imageBudget: { used: 0 },
    imageDataUris: new Map(),
    noteOrdinals: { footnote: new Map(), endnote: new Map() },
    availableNotes: {
      footnote: noteIdsOf(footnotesRoot, 'footnote'),
      endnote: noteIdsOf(endnotesRoot, 'endnote'),
    },
    noteBody: null,
  };
  // The body renders FIRST (assigning reference ordinals), then the shipped set
  // closes over cross-note references before the note lists render.
  const bodyHtml = renderBlocks(ctx, body.children);
  const shipped = shippedNoteIds(
    ctx,
    { footnote: footnotesRoot, endnote: endnotesRoot },
    advanceFieldState
  );
  return (
    bodyHtml +
    renderNoteList(ctx, 'footnote', footnotesRoot, shipped.footnote, renderBlocks) +
    renderNoteList(ctx, 'endnote', endnotesRoot, shipped.endnote, renderBlocks)
  );
}
