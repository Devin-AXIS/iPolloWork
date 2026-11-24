import { readTwipsMeasure, type OoxmlElement } from '@docx-editor.dev/core/store';
import { breakPreparedParagraph } from './paragraph-break-request.ts';
import {
  readParagraphFrame,
  paragraphFrameAttributes,
  supportsParagraphFrameContent,
  type ParagraphFrame,
} from './paragraph-frame.ts';
import type { InlineDrawingLayoutContext } from './drawing-layout.ts';
import { paragraphIsRtl } from './rtl-paragraph.ts';
import type { LineRecord, ParagraphFragmentRecord, TextMeasurer } from './semantic-records.ts';
import type { ParagraphLayoutInputs, StyleCascadeTable } from './style-cascade.ts';

function ignoredFrameMeasureIsValid(raw: string | undefined, signed: boolean): boolean {
  if (raw === undefined) return true;
  const twips = readTwipsMeasure(raw);
  if (twips === null || (!signed && twips < 0)) return false;
  const points = twips / 20;
  return Number.isFinite(points) && Math.abs(points) <= 1584;
}

/**
 * Resolve auto-width drop caps only when their authored size and line band are explicit. The
 * drop cap's width is measured under the document's `compatibilityMode`, as its lines are.
 */
export function resolveParagraphFrame(
  paragraph: OoxmlElement,
  inputs: ParagraphLayoutInputs,
  measurer: TextMeasurer,
  styles: StyleCascadeTable | undefined,
  drawings?: InlineDrawingLayoutContext,
  compatibilityMode?: number
): ParagraphFrame | undefined {
  const ordinary = readParagraphFrame(inputs.props);
  if (ordinary) {
    if (!supportsParagraphFrameContent(paragraph, drawings)) return undefined;
    if (!ordinary.autoWidth) return ordinary;
    const width = inputs.available + inputs.indent.left + inputs.indent.right;
    return width > 0 && width <= 1584 ? { ...ordinary, width } : undefined;
  }
  const attributes = paragraphFrameAttributes(inputs.props);
  if (
    !attributes ||
    !['drop', 'margin'].includes(attributes.dropCap ?? '') ||
    inputs.lineSpacing.rule !== 'exact' ||
    inputs.lineSpacing.value <= 0 ||
    inputs.lineSpacing.value > 1584 ||
    inputs.listItem ||
    inputs.spacing.before !== 0 ||
    inputs.spacing.after !== 0 ||
    inputs.shading !== undefined ||
    Object.values(inputs.borders).some(Boolean)
  )
    return undefined;
  const count = Number(attributes.lines ?? '1');
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 100 ||
    !supportsParagraphFrameContent(paragraph)
  )
    return undefined;
  const dropCapRtl = paragraphIsRtl(inputs.props);
  if (attributes.dropCap === 'drop' && dropCapRtl) return undefined;
  if (
    Object.keys(attributes).some(
      (key) =>
        ![
          'dropCap',
          'lines',
          'wrap',
          'hAnchor',
          'vAnchor',
          'hSpace',
          'vSpace',
          'anchorLock',
          'w',
          'h',
          'hRule',
          'x',
          'y',
          'xAlign',
          'yAlign',
        ].includes(key)
    ) ||
    (attributes.wrap !== undefined &&
      !['auto', 'around', 'tight', 'through', 'none', 'notBeside'].includes(attributes.wrap)) ||
    (attributes.hAnchor !== undefined &&
      !['page', 'margin', 'text'].includes(attributes.hAnchor)) ||
    (attributes.vAnchor !== undefined &&
      !['page', 'margin', 'text'].includes(attributes.vAnchor)) ||
    (attributes.hRule !== undefined && !['auto', 'atLeast', 'exact'].includes(attributes.hRule)) ||
    (attributes.xAlign !== undefined &&
      !['left', 'center', 'right', 'inside', 'outside'].includes(attributes.xAlign)) ||
    (attributes.yAlign !== undefined &&
      !['inline', 'top', 'center', 'bottom', 'inside', 'outside'].includes(attributes.yAlign)) ||
    ['x', 'y'].some((name) => !ignoredFrameMeasureIsValid(attributes[name], true)) ||
    ['w', 'h'].some((name) => !ignoredFrameMeasureIsValid(attributes[name], false)) ||
    (attributes.anchorLock !== undefined &&
      !['0', '1', 'true', 'false', 'on', 'off'].includes(attributes.anchorLock))
  )
    return undefined;
  // Refuse long/complex frame stories before shaping them as an auto-width cap.
  const nodes = [paragraph];
  let characters = 0;
  while (nodes.length) {
    for (const node of nodes.pop()!.children) {
      if (node.kind === 'textValue') characters += node.value.length;
      else nodes.push(node);
      if (characters > 32) return undefined;
    }
  }
  const width = intrinsicFrameWidth(paragraph, inputs, measurer, styles, compatibilityMode);
  if (width === undefined) return undefined;
  const frame = readParagraphFrame([
    {
      localName: 'framePr',
      attributes: {
        x: '0',
        y: '0',
        w: String(Math.ceil(width * 20)),
        hSpace: attributes.hSpace ?? '0',
        vSpace: attributes.vSpace ?? '0',
        wrap: attributes.wrap ?? 'around',
        anchorLock: attributes.anchorLock ?? '0',
      },
    },
  ]);
  return frame
    ? {
        ...frame,
        width,
        dropCap: attributes.dropCap as 'drop' | 'margin',
        dropCapRtl,
        dropCapLines: count,
        token: `drop-cap:${attributes.dropCap}:${paragraph.id}:${frame.token}`,
      }
    : undefined;
}

function intrinsicFrameWidth(
  paragraph: OoxmlElement,
  inputs: ParagraphLayoutInputs,
  measurer: TextMeasurer,
  styles: StyleCascadeTable | undefined,
  compatibilityMode: number | undefined
): number | undefined {
  const lines = breakPreparedParagraph({
    paragraph,
    paragraphId: paragraph.id,
    indentLeft: inputs.indent.left,
    available: inputs.available,
    measurer,
    cache: undefined,
    cacheKey: null,
    formatting: inputs,
    producer: 'drop-cap-probe',
    ...(compatibilityMode === undefined ? {} : { compatibilityMode }),
    styleCascade: styles,
    tabStops: inputs.tabStops,
    flow: { firstLineOffset: inputs.indent.firstLine - inputs.indent.hanging },
  });
  if (
    lines.length !== 1 ||
    lines.some((line) =>
      line.spans.some(
        (span) =>
          span.equation ||
          span.projected ||
          span.style.baselineShiftPt !== line.spans[0]?.style.baselineShiftPt
      )
    )
  )
    return undefined;
  let width = 0;
  for (const line of lines) {
    for (const span of line.spans)
      width = Math.max(width, span.box.x + span.box.width + inputs.indent.right);
  }
  if (width === 0) width = Math.min(inputs.available, Math.max(0.001, inputs.indent.right));
  width = Math.min(width, inputs.available);
  if (!(width > 0) || width > 1584) return undefined;
  return Math.min(inputs.available, width + 0.001);
}

/** The cap shares the baseline of the last occupied body line, independent of its font descent. */
export function alignDropCap(
  fragment: ParagraphFragmentRecord,
  count: number,
  anchorLines: readonly LineRecord[],
  anchorY: number
): { fragment: ParagraphFragmentRecord; height: number } {
  const first = fragment.lines[0];
  const anchor = anchorLines[0];
  if (!first || !anchor) return { fragment, height: fragment.box.height };
  const last = anchorLines[Math.min(count, anchorLines.length) - 1]!;
  const missing = Math.max(0, count - anchorLines.length) * last.box.height;
  const baseline = last.box.y + last.baseline + missing - anchorY;
  const height = last.box.y + last.box.height + missing - anchorY;
  // Export/paint subtract run position from the line baseline. The drop-cap frame owns
  // its baseline, so retain the style and compensate in the published line geometry.
  const shift = first.spans[0]?.style.baselineShiftPt ?? 0;
  const delta = baseline + shift - first.baseline - first.box.y;
  return {
    height,
    fragment: {
      ...fragment,
      box: { ...fragment.box, height },
      lines: fragment.lines.map((line) => ({
        ...line,
        baseline: line.baseline + delta,
        spans: line.spans.map((span) => ({ ...span, box: { ...span.box, y: span.box.y + delta } })),
      })),
    },
  };
}
