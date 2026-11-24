let nextFilterId = 0;

/** Apply the final black/white colour mode without changing source image bytes. */
export function applyDrawingBilevelFilter(
  document: Document,
  outer: HTMLElement,
  frame: HTMLElement,
  threshold: number | undefined
): void {
  if (threshold === undefined || !Number.isFinite(threshold) || threshold < 0 || threshold > 1)
    return;
  const ns = 'http://www.w3.org/2000/svg';
  const node = (name: string, attributes: Record<string, string>) => {
    const element = document.createElementNS(ns, name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    return element;
  };
  const id = `docx-bilevel-${++nextFilterId}`;
  const svg = node('svg', { width: '0', height: '0', 'aria-hidden': 'true' });
  svg.style.position = 'absolute';
  svg.style.pointerEvents = 'none';
  const filter = node('filter', { id, 'color-interpolation-filters': 'sRGB' });
  filter.append(node('feColorMatrix', { type: 'saturate', values: '0' }));
  const step = node('feComponentTransfer', {});
  // One fixed-size lookup avoids rounding an intermediate threshold shift
  // down by one channel value, especially at the inclusive 0 and 1 endpoints.
  // Alpha is intentionally untouched.
  const table = Array.from({ length: 256 }, (_, value) => (value / 255 >= threshold ? 1 : 0)).join(
    ' '
  );
  for (const channel of ['R', 'G', 'B']) {
    step.append(node(`feFunc${channel}`, { type: 'discrete', tableValues: table }));
  }
  filter.append(step);
  svg.append(filter);
  outer.append(svg);
  frame.style.filter = `${frame.style.filter} url(#${id})`.trim();
}
