// Deterministic ZIP writing in steps.
//
// The archive layout is the one fflate's `zipSync` writes: a local header and the deflated
// data per entry, then the central directory and the end record, with sizes in the headers
// and no data descriptors. Entries up to one slice deflate in one call, exactly as `zipSync`
// deflates them. A longer entry deflates through a stream, one slice per step, so a caller
// that pauses between steps never runs one long task. A streamed entry can compress to
// different bytes than a one-shot deflate would; both inflate to the same content.

import { Deflate, deflateSync } from 'fflate';

/** Input bytes deflated and checksummed per step. */
export const ZIP_WRITE_SLICE_BYTES = 256 * 1024;

/** One entry's compressed bytes, produced in steps. */
export type ZipEntryCompressor = (data: Uint8Array) => Generator<void, Uint8Array>;

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1)
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value;
  }
  return table;
})();

function crc32Update(crc: number, data: Uint8Array): number {
  let value = crc;
  for (let index = 0; index < data.length; index += 1)
    value = CRC_TABLE[(value ^ data[index]!) & 0xff]! ^ (value >>> 8);
  return value;
}

/** Deflate one entry, a slice per step once it is longer than one slice. */
export function* deflateInSlices(data: Uint8Array): Generator<void, Uint8Array> {
  if (data.length <= ZIP_WRITE_SLICE_BYTES) return deflateSync(data);
  const chunks: Uint8Array[] = [];
  let length = 0;
  const stream = new Deflate((chunk) => {
    chunks.push(chunk);
    length += chunk.length;
  });
  for (let at = 0; at < data.length; at += ZIP_WRITE_SLICE_BYTES) {
    const end = Math.min(at + ZIP_WRITE_SLICE_BYTES, data.length);
    stream.push(data.subarray(at, end), end === data.length);
    yield;
  }
  return concat(chunks, length);
}

function concat(chunks: readonly Uint8Array[], length: number): Uint8Array {
  if (chunks.length === 1) return chunks[0]!;
  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

function* checksumInSlices(data: Uint8Array): Generator<void, number> {
  let crc = -1;
  for (let at = 0; at < data.length; at += ZIP_WRITE_SLICE_BYTES) {
    crc = crc32Update(crc, data.subarray(at, at + ZIP_WRITE_SLICE_BYTES));
    if (at + ZIP_WRITE_SLICE_BYTES < data.length) yield;
  }
  return ~crc >>> 0;
}

/** DOS date and time, from local-time fields as `zipSync` reads them. */
function dosDateTime(mtime: Date): number {
  const year = mtime.getFullYear() - 1980;
  if (year < 0 || year > 119) throw new Error('ZIP entry time is outside the DOS date range');
  return (
    ((year << 25) |
      ((mtime.getMonth() + 1) << 21) |
      (mtime.getDate() << 16) |
      (mtime.getHours() << 11) |
      (mtime.getMinutes() << 5) |
      (mtime.getSeconds() >> 1)) >>>
    0
  );
}

interface WrittenEntry {
  readonly name: Uint8Array;
  readonly utf8: boolean;
  readonly crc: number;
  readonly size: number;
  readonly compressed: Uint8Array;
  readonly offset: number;
}

/** The fields the local header and the central directory record share, from `at`. */
function writeSharedFields(view: DataView, at: number, entry: WrittenEntry, time: number): void {
  view.setUint16(at, 20, true);
  view.setUint16(at + 2, entry.utf8 ? 0x0800 : 0, true);
  view.setUint16(at + 4, 8, true);
  view.setUint32(at + 6, time, true);
  view.setUint32(at + 10, entry.crc, true);
  view.setUint32(at + 14, entry.compressed.length, true);
  view.setUint32(at + 18, entry.size, true);
  view.setUint16(at + 22, entry.name.length, true);
}

/**
 * Write `entries` (ZIP entry name -> bytes) as a deflated archive, yielding between slices.
 *
 * @internal `compress` is replaceable so tests can prove the layout against `zipSync`.
 */
export function* writeZipEntriesSteps(
  entries: ReadonlyMap<string, Uint8Array>,
  mtime: Date,
  compress: ZipEntryCompressor = deflateInSlices
): Generator<void, Uint8Array> {
  const encoder = new TextEncoder();
  const time = dosDateTime(mtime);
  const written: WrittenEntry[] = [];
  let offset = 0;
  let centralLength = 0;
  for (const [entryName, data] of entries) {
    const name = encoder.encode(entryName);
    if (name.length > 0xffff) throw new Error(`ZIP entry name is too long: ${entryName}`);
    const crc = yield* checksumInSlices(data);
    const compressed = yield* compress(data);
    written.push({
      name,
      utf8: name.length !== entryName.length,
      crc,
      size: data.length,
      compressed,
      offset,
    });
    offset += 30 + name.length + compressed.length;
    centralLength += 46 + name.length;
  }
  if (written.length > 0xffff || offset + centralLength > 0xffffffff)
    throw new Error('the archive needs ZIP64, which this writer does not produce');

  const out = new Uint8Array(offset + centralLength + 22);
  const view = new DataView(out.buffer);
  let central = offset;
  for (const entry of written) {
    view.setUint32(entry.offset, 0x04034b50, true);
    writeSharedFields(view, entry.offset + 4, entry, time);
    out.set(entry.name, entry.offset + 30);
    out.set(entry.compressed, entry.offset + 30 + entry.name.length);

    view.setUint32(central, 0x02014b50, true);
    view.setUint16(central + 4, 20, true);
    writeSharedFields(view, central + 6, entry, time);
    view.setUint32(central + 42, entry.offset, true);
    out.set(entry.name, central + 46);
    central += 46 + entry.name.length;
  }
  view.setUint32(central, 0x06054b50, true);
  view.setUint16(central + 8, written.length, true);
  view.setUint16(central + 10, written.length, true);
  view.setUint32(central + 12, centralLength, true);
  view.setUint32(central + 16, offset, true);
  return out;
}
