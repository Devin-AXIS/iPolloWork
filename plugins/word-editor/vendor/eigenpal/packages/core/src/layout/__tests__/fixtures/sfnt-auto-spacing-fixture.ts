/** Metadata-only font fixtures. They contain no outlines or third-party font bytes. */
export function autoSpacingSfntFixture(
  averageWidth = 128,
  unitsPerEm = 256,
  tableCount = 2,
  base = 0
): Uint8Array {
  const head = base + 12 + tableCount * 16;
  const os2 = head + 56;
  const bytes = new Uint8Array(os2 + 96);
  const view = new DataView(bytes.buffer);
  view.setUint32(base, 0x00010000);
  view.setUint16(base + 4, tableCount);
  for (let index = 0; index < tableCount; index++) {
    const record = base + 12 + index * 16;
    view.setUint32(
      record,
      index === 0 ? 0x68656164 : index === 1 ? 0x4f532f32 : 0x41000000 + index
    );
    view.setUint32(record + 8, index === 0 ? head : index === 1 ? os2 : bytes.length);
    view.setUint32(record + 12, index === 0 ? 54 : index === 1 ? 96 : 0);
  }
  view.setUint16(head + 18, unitsPerEm);
  view.setUint16(os2, 3);
  view.setInt16(os2 + 2, averageWidth);
  return bytes;
}

export function autoSpacingCollectionFixture(): Uint8Array {
  const first = autoSpacingSfntFixture(128, 256, 2, 20);
  const second = autoSpacingSfntFixture(821, 2048, 2, first.length);
  const bytes = new Uint8Array(second.length);
  bytes.set(first.subarray(20), 20);
  bytes.set(second.subarray(first.length), first.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x74746366);
  view.setUint32(4, 0x00010000);
  view.setUint32(8, 2);
  view.setUint32(12, 20);
  view.setUint32(16, first.length);
  return bytes;
}
