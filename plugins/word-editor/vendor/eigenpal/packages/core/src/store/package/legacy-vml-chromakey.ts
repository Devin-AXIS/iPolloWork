/** Generated SVG only: remove an exact sRGB colour without removing near colours. */
export function legacyChromaKeyFilter(hex: string): { id: string; definition: string } {
  const id = `vml-key-${hex.slice(1)}`;
  const channels = ['R', 'G', 'B'].map((channel, index) => {
    const key = Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
    const table = Array.from({ length: 256 }, (_, value) => (value === key ? 1 : 0)).join(' ');
    return `<feFunc${channel} type="discrete" tableValues="${table}"/>`;
  });
  // All three channel matches are required. RGB is zero; alpha is clamped
  // from R + G + B - 2, then removed from the original (including its alpha).
  const definition = `<defs><filter id="${id}" color-interpolation-filters="sRGB"><feComponentTransfer in="SourceGraphic">${channels.join('')}</feComponentTransfer><feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 1 1 0 -2" result="key"/><feComposite in="SourceGraphic" in2="key" operator="out"/></filter></defs>`;
  return { id, definition };
}
