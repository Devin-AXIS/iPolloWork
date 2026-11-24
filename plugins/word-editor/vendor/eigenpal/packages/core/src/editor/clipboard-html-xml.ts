/** Drop code units that XML 1.0 forbids in run text. */
export function xmlSafeText(text: string): string {
  let out = '';
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit !== 0x09 && (unit < 0x20 || unit === 0xfffe || unit === 0xffff)) continue;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text[index]! + text[index + 1]!;
        index += 1;
      }
      continue;
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) continue;
    out += text[index]!;
  }
  return out;
}
