// Derived line alignment state. Keep it outside the public pending-line record shape.
const advances = new WeakMap<object, number>();

export function lineHangingPunctuationAdvance(line: object): number {
  return advances.get(line) ?? 0;
}

export function setLineHangingPunctuationAdvance(line: object, advance: number | undefined): void {
  if (advance === undefined) advances.delete(line);
  else advances.set(line, advance);
}

export function copyLineHangingPunctuation<Line extends object>(
  source: object,
  target: Line
): Line {
  const advance = advances.get(source);
  if (advance !== undefined) advances.set(target, advance);
  return target;
}
