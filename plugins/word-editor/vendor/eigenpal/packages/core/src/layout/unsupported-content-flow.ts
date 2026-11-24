import type { FieldAwarePiece } from './field-pieces.ts';
import { growLineMetrics, type PendingLine } from './pending-line.ts';
import type { StyleSpanRecord, TextMeasurer } from './semantic-records.ts';
import { paragraphSpanMetadata } from './paragraph-span-metadata.ts';

/** Publish a component's reserved box without inventing model characters. */
export function appendUnsupportedContent(
  line: PendingLine,
  piece: FieldAwarePiece,
  paragraphId: string,
  x: number,
  atomWidth: number
): void {
  const unsupported = piece.unsupported!;
  const descent = Math.max(0, line.height - line.baseline);
  line.baseline = Math.max(line.baseline, unsupported.height);
  line.height = line.baseline + descent;
  line.spans.push({
    range: { paragraphId, start: piece.start, end: piece.end },
    text: '\uFFFC',
    props: piece.props,
    style: piece.style,
    projected: true,
    unsupported,
    box: { x: x, y: 0, width: atomWidth, height: unsupported.height },
    ...paragraphSpanMetadata(piece),
  });
  line.width += atomWidth;
  line.end = piece.end;
}

/** Publish an equation's laid box on the line's baseline. The caller makes room for it first. */
export function appendEquation(
  line: PendingLine,
  piece: FieldAwarePiece,
  equation: NonNullable<StyleSpanRecord['equation']>,
  paragraphId: string,
  x: number
): void {
  const { box, baseline } = equation.geometry;
  const priorDescent = Math.max(0, line.height - line.baseline);
  line.baseline = Math.max(line.baseline, baseline);
  line.height = line.baseline + Math.max(priorDescent, Math.max(0, box.height - baseline));
  line.spans.push({
    range: { paragraphId, start: piece.start, end: piece.end },
    text: '\uFFFC',
    props: piece.props,
    style: piece.style,
    box: { x, y: 0, width: box.width, height: box.height },
    projected: true,
    equation,
    ...paragraphSpanMetadata(piece),
  });
  line.width += box.width;
  line.end = piece.end;
}

/**
 * Publish a column break's zero-width span; the caller closes the line. Like a trailing hard
 * break, not like a page break, the break leaves the paragraph's remainder to lay out after
 * the column advance: the common form `<w:p><w:r><w:br w:type="column"/></w:r></w:p>` opens one
 * empty line, the paragraph mark, at the top of the next column before the following block.
 */
export function appendColumnBreak(
  line: PendingLine,
  piece: FieldAwarePiece,
  paragraphId: string,
  x: number,
  measurer: TextMeasurer
): void {
  const metrics = measurer.lineMetrics(piece.style);
  line.spans.push({
    range: { paragraphId, start: piece.start, end: piece.end },
    text: piece.text,
    props: piece.props,
    style: piece.style,
    box: { x, y: 0, width: 0, height: metrics.height },
    ...(piece.link ? { link: piece.link } : {}),
    ...paragraphSpanMetadata(piece),
  });
  growLineMetrics(line, metrics);
  line.end = piece.end;
}
