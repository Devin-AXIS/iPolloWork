import {
  readTwipsMeasure,
  WML_NAMESPACE_URI,
  type OoxmlElement,
} from '@docx-editor.dev/core/store';

// The ordinary margin reader is deliberately permissive. Its fallback values alone are
// insufficient evidence for a NEW negative table origin. Validate this lane's sources,
// without changing ordinary layout or rewriting any authored property.
function validMarginBox(box: OoxmlElement): boolean {
  if (box.namespaceUri !== WML_NAMESPACE_URI) return false;
  const seen = new Set<string>();
  for (const side of box.children) {
    if (side.kind === 'textValue') continue;
    const name =
      side.localName === 'start' ? 'left' : side.localName === 'end' ? 'right' : side.localName;
    if (
      side.namespaceUri !== WML_NAMESPACE_URI ||
      !['top', 'left', 'bottom', 'right'].includes(name) ||
      seen.has(name)
    )
      return false;
    seen.add(name);
    const widths = side.attributes.filter((item) => item.localName === 'w');
    const types = side.attributes.filter((item) => item.localName === 'type');
    const width = widths.length === 1 ? readTwipsMeasure(widths[0]!.value) : null;
    // A negative side pads like 0 (`readMarginSides`), so it states a margin like any other.
    if (width === null || widths[0]!.namespaceUri !== WML_NAMESPACE_URI || width > 31_680)
      return false;
    // Absent CT_TblWidth type is dxa; unsupported units do not prove an outer margin.
    if (
      types.length > 1 ||
      (types.length === 1 &&
        (types[0]!.namespaceUri !== WML_NAMESPACE_URI || types[0]!.value !== 'dxa'))
    )
      return false;
  }
  return true;
}

export function hasSupportedLegacyTableMargins(
  table: OoxmlElement,
  propertyNodes: readonly OoxmlElement[]
): boolean {
  const pending = [table, ...propertyNodes];
  while (pending.length > 0) {
    const node = pending.pop()!;
    for (const item of node.children) {
      if (item.kind === 'textValue' || item.kind === 'paragraph' || item.kind === 'table') continue;
      if (item.localName === 'tblCellMar' || item.localName === 'tcMar') {
        if (!validMarginBox(item)) return false;
      } else {
        pending.push(item);
      }
    }
  }
  return true;
}
