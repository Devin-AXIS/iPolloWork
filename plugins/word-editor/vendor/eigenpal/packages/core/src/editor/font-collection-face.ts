// Browser materialization of an admitted collection face. The canonical source stays intact.
import { HARD_MAX_FONT_BYTES } from '../layout/font-resource.ts';
const MAX_BYTES = HARD_MAX_FONT_BYTES;
function requireValue(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function checksum(bytes: Uint8Array): number {
  let sum = 0;
  for (let p = 0; p < bytes.length; p += 4) {
    const word =
      ((bytes[p] || 0) * 0x1000000 +
        (bytes[p + 1] || 0) * 0x10000 +
        (bytes[p + 2] || 0) * 0x100 +
        (bytes[p + 3] || 0)) >>>
      0;
    sum = (sum + word) >>> 0;
  }
  return sum;
}
export { checksum as sfntChecksum };

/** Copy an admitted collection face to a complete, standalone SFNT for FontFace. */
export function materializeCollectionFace(bytes: Uint8Array, faceIndex = 0): Uint8Array {
  requireValue(
    bytes instanceof Uint8Array && bytes.length >= 12 && bytes.length <= MAX_BYTES,
    'Unsupported font byte length'
  );
  requireValue(Number.isSafeInteger(faceIndex) && faceIndex >= 0, 'Invalid face index');
  const input = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const range = (start: number, length: number) => {
    requireValue(
      Number.isSafeInteger(start) &&
        Number.isSafeInteger(length) &&
        start >= 0 &&
        length >= 0 &&
        start + length <= bytes.length,
      'Font range exceeds source'
    );
  };
  const tag = (p: number) => String.fromCharCode(...bytes.subarray(p, p + 4));
  if (tag(0) !== 'ttcf') {
    requireValue(faceIndex === 0, 'Face index requires a collection');
    requireValue(
      [0x00010000, 0x4f54544f, 0x74727565].includes(input.getUint32(0)),
      'Unsupported SFNT version'
    );
    return bytes.slice();
  }
  const version = input.getUint32(4);
  requireValue(version === 0x00010000 || version === 0x00020000, 'Unsupported TTC version');
  const count = input.getUint32(8);
  requireValue(count > 0 && faceIndex < count, 'Collection face absent');
  range(12, count * 4 + (version === 0x00020000 ? 12 : 0));
  // The TTC header's signature describes the collection, not the selected SFNT.
  // Selected face tables, including DSIG, are preserved without verifying signatures.
  const headerEnd = 12 + count * 4 + (version === 0x00020000 ? 12 : 0);
  const base = input.getUint32(12 + faceIndex * 4);
  range(base, 12);
  const scalar = input.getUint32(base);
  requireValue(
    [0x00010000, 0x4f54544f, 0x74727565, 0x74797031].includes(scalar),
    'Unsupported face version'
  );
  const tableCount = input.getUint16(base + 4);
  requireValue(tableCount > 0, 'Missing face tables');
  range(base, 12 + tableCount * 16);
  requireValue(base >= headerEnd, 'Selected directory overlaps collection header');
  const protectedRanges = [
    [0, headerEnd],
    [base, base + 12 + tableCount * 16],
  ];
  const tables: { name: string; offset: number; length: number; destination: number }[] = [],
    tags = new Set<string>();
  for (let n = 0; n < tableCount; n++) {
    const p = base + 12 + n * 16;
    const name = tag(p),
      offset = input.getUint32(p + 8),
      length = input.getUint32(p + 12);
    requireValue(
      /^[\x20-\x7e]{4}$/.test(name) && !tags.has(name),
      'Invalid or duplicate table tag'
    );
    tags.add(name);
    range(offset, length);
    for (const [start, stop] of protectedRanges) {
      requireValue(
        length === 0 || offset >= stop || offset + length <= start,
        'Table overlaps collection directory'
      );
    }
    tables.push({ name, offset, length, destination: 0 });
  }
  // The existing validator bounds uint16 table counts through the actual byte directory.
  // A sorted interval check keeps work O(n log n), without adding a table-count ceiling.
  const intervals = tables
    .filter((table) => table.length > 0)
    .sort((left, right) => left.offset - right.offset);
  for (let n = 1; n < intervals.length; n++) {
    requireValue(
      intervals[n].offset >= intervals[n - 1].offset + intervals[n - 1].length,
      'Selected face tables overlap'
    );
  }
  const head = tables.find((table) => table.name === 'head');
  requireValue(head && head.length >= 54, 'Missing or truncated head table');
  tables.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  let size = 12 + tableCount * 16;
  for (const table of tables) {
    table.destination = size;
    size += (table.length + 3) & ~3;
    requireValue(size <= MAX_BYTES, 'Standalone face exceeds byte ceiling');
  }
  const result = new Uint8Array(size),
    output = new DataView(result.buffer);
  output.setUint32(0, scalar);
  output.setUint16(4, tableCount);
  const power = 2 ** Math.floor(Math.log2(tableCount));
  output.setUint16(6, power * 16);
  output.setUint16(8, Math.log2(power));
  output.setUint16(10, tableCount * 16 - power * 16);
  for (const [n, table] of tables.entries()) {
    const p = 12 + n * 16;
    for (let i = 0; i < 4; i++) result[p + i] = table.name.charCodeAt(i);
    result.set(bytes.subarray(table.offset, table.offset + table.length), table.destination);
    if (table.name === 'head') output.setUint32(table.destination + 8, 0);
    output.setUint32(
      p + 4,
      checksum(result.subarray(table.destination, table.destination + table.length))
    );
    output.setUint32(p + 8, table.destination);
    output.setUint32(p + 12, table.length);
  }
  output.setUint32(head.destination + 8, (0xb1b0afba - checksum(result)) >>> 0);
  return result;
}
