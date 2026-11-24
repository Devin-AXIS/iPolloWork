/** Horizontal OOXML table sides reflect when bidiVisual is enabled. */
export function tableSide(side: string, rtl: boolean): string {
  return rtl ? (side === 'left' ? 'right' : side === 'right' ? 'left' : side) : side;
}
