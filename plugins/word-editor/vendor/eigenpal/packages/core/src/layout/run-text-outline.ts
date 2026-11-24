import type { OoxmlElement, OoxmlProperty } from '@docx-editor.dev/core/store';

const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const HEX = /^[0-9a-f]{6}$/i;

/** Read-only projection of the opaque, solid, single, centred outline subset. */
export function runTextOutlineProperty(node: OoxmlElement): OoxmlProperty | null {
  if (node.namespaceUri !== W14 || node.localName !== 'textOutline') return null;
  const off: OoxmlProperty = { localName: 'textOutline' };
  const attrs: Record<string, string> = {};
  for (const attr of node.attributes) {
    if (attr.namespaceUri !== W14 || !['w', 'cap', 'cmpd', 'algn'].includes(attr.localName)) {
      return off;
    }
    attrs[attr.localName] = attr.value;
  }
  if (
    (attrs.cmpd !== undefined && attrs.cmpd !== 'sng') ||
    (attrs.algn !== undefined && attrs.algn !== 'ctr') ||
    (attrs.cap !== undefined && !['flat', 'rnd', 'sq'].includes(attrs.cap)) ||
    !/^\d{1,8}$/.test(attrs.w ?? '') ||
    Number(attrs.w) > 20116800
  )
    return off;
  let color: string | undefined;
  let fill = false;
  let dash = false;
  let join = false;
  if (node.children.length > 7) return off;
  for (const child of node.children) {
    if (child.kind === 'textValue') {
      if (child.value.trim()) return off;
      continue;
    }
    if (child.namespaceUri !== W14) return off;
    if (child.localName === 'solidFill' && !fill && child.attributes.length === 0) {
      fill = true;
      if (
        child.children.length > 3 ||
        child.children.some((entry) => entry.kind === 'textValue' && entry.value.trim())
      )
        return off;
      const colors = child.children.filter((entry) => entry.kind !== 'textValue');
      if (colors.length !== 1) return off;
      const rgb = colors[0]!;
      if (rgb.namespaceUri !== W14 || rgb.localName !== 'srgbClr' || rgb.children.length !== 0)
        return off;
      if (rgb.attributes.length !== 1) return off;
      const value = rgb.attributes[0]!;
      if (value.namespaceUri !== W14 || value.localName !== 'val' || !HEX.test(value.value))
        return off;
      color = value.value.toUpperCase();
    } else if (child.localName === 'prstDash' && !dash) {
      dash = true;
      const value = child.attributes[0];
      if (
        child.children.length ||
        child.attributes.length !== 1 ||
        value?.namespaceUri !== W14 ||
        value.localName !== 'val' ||
        value.value !== 'solid'
      )
        return off;
    } else if (['round', 'bevel', 'miter'].includes(child.localName) && !join) {
      // CSS text stroke uses the browser's glyph-join rasterization. Keep the canonical
      // authored join untouched; this projection does not claim custom join parity.
      join = true;
      if (child.children.length) return off;
      if (child.localName === 'miter') {
        if (child.attributes.length > 1) return off;
        const limit = child.attributes[0];
        if (
          limit &&
          (limit.namespaceUri !== W14 ||
            limit.localName !== 'lim' ||
            !/^\d{1,8}$/.test(limit.value))
        )
          return off;
      } else if (child.attributes.length) return off;
    } else return off;
  }
  return color && Number(attrs.w) > 0
    ? { localName: 'textOutline', attributes: { w: attrs.w!, outlineColor: color } }
    : off;
}

/** Resolve only the validated projection; no XML markup enters the output lane. */
export function resolveTextOutline(
  property: OoxmlProperty
): { readonly widthPt: number; readonly color: string } | undefined {
  const raw = property.attributes?.w;
  const color = property.attributes?.outlineColor;
  if (!raw || !/^\d{1,8}$/.test(raw) || !color || !HEX.test(color)) return undefined;
  const width = Number(raw);
  return width > 0 && width <= 20116800
    ? Object.freeze({ widthPt: width / 12700, color: color.toUpperCase() })
    : undefined;
}
