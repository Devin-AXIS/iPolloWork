// Run and paragraph XML emitters for the external-HTML projection — split from
// clipboard-html-read.ts at the max-lines cap. Every file-derived value is escaped;
// enumerated properties interpolate only allowlisted tokens.

import { escapeXml, escapeXmlAttribute } from '../store/package/sinks.ts';
import { xmlSafeText } from './clipboard-html-xml.ts';
import type { HtmlParaProps, HtmlRunProps } from './clipboard-html-styles.ts';

/** `w:rPr`, children in CT_RPr sequence order. */
export function rPrXml(props: HtmlRunProps): string {
  let inner = '';
  if (props.rStyle !== undefined) {
    inner += `<w:rStyle w:val="${escapeXmlAttribute(props.rStyle)}"/>`;
  }
  if (props.font !== undefined) {
    const face = escapeXmlAttribute(xmlSafeText(props.font));
    inner += props.rtl
      ? `<w:rFonts w:cs="${face}"/>`
      : `<w:rFonts w:ascii="${face}" w:hAnsi="${face}"/>`;
  }
  // `false` is an EXPLICIT off (`font-weight:normal`, `text-decoration:none`),
  // which must out-vote a paragraph style on paste; `undefined` stays silent.
  if (props.bold) inner += '<w:b/>';
  else if (props.bold === false) inner += '<w:b w:val="0"/>';
  if (props.italic) inner += '<w:i/>';
  else if (props.italic === false) inner += '<w:i w:val="0"/>';
  if (props.caps) inner += '<w:caps/>';
  else if (props.caps === false) inner += '<w:caps w:val="0"/>';
  if (props.smallCaps) inner += '<w:smallCaps/>';
  else if (props.smallCaps === false) inner += '<w:smallCaps w:val="0"/>';
  if (props.doubleStrike) inner += '<w:dstrike/>';
  else if (props.strike) inner += '<w:strike/>';
  else if (props.strike === false) inner += '<w:strike w:val="0"/>';
  if (props.color !== undefined) inner += `<w:color w:val="${props.color}"/>`;
  if (props.charSpacingTwentieths !== undefined) {
    inner += `<w:spacing w:val="${props.charSpacingTwentieths}"/>`;
  }
  if (props.szHalfPoints !== undefined) inner += `<w:sz w:val="${props.szHalfPoints}"/>`;
  if (props.highlight !== undefined) {
    inner += `<w:highlight w:val="${escapeXmlAttribute(props.highlight)}"/>`;
  }
  if (props.underline) {
    inner += `<w:u w:val="${props.underlineVal ?? 'single'}"${
      props.underlineColor === undefined ? '' : ` w:color="${props.underlineColor}"`
    }/>`;
  } else if (props.underline === false) {
    inner += '<w:u w:val="none"/>';
  }
  if (props.shdFill !== undefined) {
    inner += `<w:shd w:val="clear" w:color="auto" w:fill="${props.shdFill}"/>`;
  }
  if (props.vertAlign !== undefined) inner += `<w:vertAlign w:val="${props.vertAlign}"/>`;
  if (props.rtl) inner += '<w:rtl/>';
  let langVal = props.langVal;
  let langEastAsia = props.langEastAsia;
  let langBidi = props.langBidi;
  if (props.lang !== undefined) {
    if (props.rtl) langBidi ??= props.lang;
    else if (/^(?:zh|ja|ko)(?:-|$)/i.test(props.lang)) langEastAsia ??= props.lang;
    else langVal ??= props.lang;
  }
  const langAttributes =
    `${langVal === undefined ? '' : ` w:val="${escapeXmlAttribute(langVal)}"`}` +
    `${langEastAsia === undefined ? '' : ` w:eastAsia="${escapeXmlAttribute(langEastAsia)}"`}` +
    `${langBidi === undefined ? '' : ` w:bidi="${escapeXmlAttribute(langBidi)}"`}`;
  if (langAttributes.length > 0) {
    inner += `<w:lang${langAttributes}/>`;
  }
  // Last in `CT_RPr`.
  if (props.changeXml !== undefined) inner += props.changeXml;
  return inner.length > 0 ? `<w:rPr>${inner}</w:rPr>` : '';
}

export function textRunXml(text: string, props: HtmlRunProps): string {
  return `<w:r>${rPrXml(props)}<w:t xml:space="preserve">${escapeXml(xmlSafeText(text))}</w:t></w:r>`;
}

/** `w:pPr`, children in CT_PPr sequence order. */
export function pPrXml(para: HtmlParaProps): string {
  let inner = '';
  if (para.styleId !== undefined) {
    inner += `<w:pStyle w:val="${escapeXmlAttribute(para.styleId)}"/>`;
  }
  if (para.keepNext) inner += '<w:keepNext/>';
  if (para.keepLines) inner += '<w:keepLines/>';
  if (para.pageBreakBefore) inner += '<w:pageBreakBefore/>';
  if (para.widowControl) inner += '<w:widowControl/>';
  if (para.numPr) {
    inner +=
      `<w:numPr><w:ilvl w:val="${para.numPr.ilvl}"/>` +
      `<w:numId w:val="${escapeXmlAttribute(para.numPr.numId)}"/></w:numPr>`;
  }
  if (para.borders !== undefined) {
    let borders = '';
    for (const edge of ['top', 'left', 'bottom', 'right'] as const) {
      const border = para.borders[edge];
      if (border === undefined) continue;
      borders +=
        `<w:${edge} w:val="${border.val}" w:sz="${border.szEighthPoints}" ` +
        `w:space="0" w:color="${border.color}"/>`;
    }
    if (borders.length > 0) inner += `<w:pBdr>${borders}</w:pBdr>`;
  }
  if (para.shdFill !== undefined) {
    inner += `<w:shd w:val="clear" w:color="auto" w:fill="${para.shdFill}"/>`;
  }
  if (para.tabs !== undefined && para.tabs.length > 0) {
    inner += `<w:tabs>${para.tabs
      .map(
        (tab) =>
          `<w:tab w:val="${tab.val}" w:pos="${tab.posTwips}"` +
          (tab.leader === undefined ? '/>' : ` w:leader="${tab.leader}"/>`)
      )
      .join('')}</w:tabs>`;
  }
  if (para.bidi) inner += '<w:bidi/>';
  if (
    para.spacingBeforeTwips !== undefined ||
    para.spacingAfterTwips !== undefined ||
    para.lineTwentieths !== undefined
  ) {
    let spacing = '<w:spacing';
    if (para.spacingBeforeTwips !== undefined) {
      spacing += ` w:before="${para.spacingBeforeTwips}"`;
    }
    if (para.spacingAfterTwips !== undefined) {
      spacing += ` w:after="${para.spacingAfterTwips}"`;
    }
    if (para.lineTwentieths !== undefined) {
      spacing += ` w:line="${para.lineTwentieths}" w:lineRule="${para.lineRule ?? 'auto'}"`;
    }
    inner += `${spacing}/>`;
  }
  const first = para.firstLineTwips;
  // HTML margins and `text-align` name PHYSICAL sides; a bidi paragraph's `w:ind` sides and
  // `w:jc` `left`/`right` are its leading and trailing ones, so they mirror there.
  const [leading, trailing] = para.bidi
    ? [para.indRightTwips, para.indLeftTwips]
    : [para.indLeftTwips, para.indRightTwips];
  if (leading !== undefined || trailing !== undefined || first !== undefined) {
    let ind = '<w:ind';
    if (leading !== undefined) ind += ` w:left="${leading}"`;
    if (trailing !== undefined) ind += ` w:right="${trailing}"`;
    if (first !== undefined) {
      ind += first >= 0 ? ` w:firstLine="${first}"` : ` w:hanging="${-first}"`;
    }
    inner += `${ind}/>`;
  }
  // `start`/`end` are the leading and trailing sides, which is what `w:jc` `left`/`right`
  // already mean; physical `left`/`right` mirror in a bidi paragraph.
  const jc =
    para.jc === 'start'
      ? 'left'
      : para.jc === 'end'
        ? 'right'
        : para.bidi && (para.jc === 'left' || para.jc === 'right')
          ? para.jc === 'left'
            ? 'right'
            : 'left'
          : para.jc;
  if (jc !== undefined) inner += `<w:jc w:val="${jc}"/>`;
  // The mark's `w:rPr`, then `w:pPrChange`: the last two children of `CT_PPr`.
  if (para.markRevisionXml) inner += `<w:rPr>${para.markRevisionXml}</w:rPr>`;
  if (para.changeXml !== undefined) inner += para.changeXml;
  return inner.length > 0 ? `<w:pPr>${inner}</w:pPr>` : '';
}

export function paragraphXml(para: HtmlParaProps, runs: readonly string[]): string {
  return `<w:p>${pPrXml(para)}${runs.join('')}</w:p>`;
}

/** Heading direct formatting: bold plus these sizes in half-points (h1=32pt … h6=14pt). */
export const HEADING_SZ: Record<string, number> = {
  h1: 64,
  h2: 52,
  h3: 44,
  h4: 36,
  h5: 32,
  h6: 28,
};

/** Append a page break: fold it into the previous paragraph when one exists. */
export function appendPageBreak(out: string[]): void {
  const last = out[out.length - 1];
  if (last?.endsWith('</w:p>')) {
    out[out.length - 1] = `${last.slice(0, -6)}<w:r><w:br w:type="page"/></w:r></w:p>`;
    return;
  }
  out.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
}

const FURNITURE_ONLY = /^(?:<w:bookmark(?:Start|End)\b[^>]*\/>)+$/;

/** Amortized furniture-only check: a `runs` array only grows, so each entry tests
 *  once — re-testing the whole array per whitespace node would be quadratic under
 *  an anchor-flood paste. */
const furnitureScan = new WeakMap<string[], { checked: number; furniture: boolean }>();
export function isFurnitureOnly(runs: string[]): boolean {
  let state = furnitureScan.get(runs);
  if (!state) {
    state = { checked: 0, furniture: true };
    furnitureScan.set(runs, state);
  }
  while (state.furniture && state.checked < runs.length) {
    state.furniture = FURNITURE_ONLY.test(runs[state.checked]!);
    state.checked += 1;
  }
  return state.furniture;
}
