// The TIFF decoder walks directory chains with no visited set and loops over file-supplied
// value counts, so `decodeTiffFrame` hands it a copy confined to the first directory.

import { describe, expect, test } from 'bun:test';
import { decodeTiffFrame } from '../tiff-frame.ts';
import { resolveImageResourceLimits } from '../../runtime/limits.ts';
import {
  baselineRgbTiff,
  buildTiff,
  TIFF_FIELD_LONG,
  TIFF_FIELD_SHORT,
} from '../../__tests__/tiff-test-bytes.ts';

const LIMITS = resolveImageResourceLimits();

/** The header's first-directory offset, and the offset of that directory's next pointer. */
function directoryPointers(bytes: Uint8Array): { directoryAt: number; nextAt: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const directoryAt = view.getUint32(4, true);
  return { directoryAt, nextAt: directoryAt + 2 + view.getUint16(directoryAt, true) * 12 };
}

describe('decodeTiffFrame directory confinement', () => {
  test('a 26-byte directory whose next pointer names itself returns promptly', async () => {
    const bytes = new Uint8Array(26);
    const view = new DataView(bytes.buffer);
    bytes.set([0x49, 0x49], 0);
    view.setUint16(2, 42, true);
    view.setUint32(4, 8, true);
    view.setUint16(8, 1, true);
    view.setUint16(10, 256, true);
    view.setUint16(12, TIFF_FIELD_LONG, true);
    view.setUint32(14, 1, true);
    view.setUint32(18, 8, true);
    view.setUint32(22, 8, true);
    expect(await decodeTiffFrame(bytes, LIMITS)).toBeNull();
    // The caller's bytes are not rewritten.
    expect(view.getUint32(22, true)).toBe(8);
  });

  test('a decodable first page still decodes when its next pointer loops back', async () => {
    const bytes = baselineRgbTiff(16, 8);
    const { directoryAt, nextAt } = directoryPointers(bytes);
    new DataView(bytes.buffer).setUint32(nextAt, directoryAt, true);
    const frame = await decodeTiffFrame(bytes, LIMITS);
    expect(frame?.pixelWidth).toBe(16);
    expect(frame?.pixelHeight).toBe(8);
    expect(frame?.rgba.length).toBe(16 * 8 * 4);
  });

  test('a nested directory tag that points at its own directory is not followed', async () => {
    const plain = buildTiff({ entries: [] });
    const directoryAt = directoryPointers(plain).directoryAt;
    const bytes = buildTiff({
      entries: [
        { tag: 256, fieldType: TIFF_FIELD_LONG, count: 1, value: 8 },
        { tag: 257, fieldType: TIFF_FIELD_LONG, count: 1, value: 8 },
        { tag: 330, fieldType: TIFF_FIELD_LONG, count: 1, value: directoryAt },
      ],
    });
    // The extent has no strips, so the decode itself throws; it must not recurse forever.
    await decodeTiffFrame(bytes, LIMITS).then(
      (frame) => expect(frame).toBeNull(),
      (error: unknown) => expect(error).not.toBeInstanceOf(RangeError)
    );
  });

  test('a value count far past the end of the bytes is not looped over', async () => {
    const bytes = buildTiff({
      entries: [
        { tag: 256, fieldType: TIFF_FIELD_LONG, count: 1, value: 8 },
        { tag: 257, fieldType: TIFF_FIELD_LONG, count: 1, value: 8 },
        { tag: 258, fieldType: TIFF_FIELD_SHORT, count: 0xffffffff, value: 8 },
      ],
    });
    expect(await decodeTiffFrame(bytes, LIMITS).catch(() => null)).toBeNull();
  });

  test.each([
    ['a directory offset past the end', buildTiff({ entries: [], directoryOffset: 4096 })],
    ['a directory offset inside the header', buildTiff({ entries: [], directoryOffset: 2 })],
    ['an entry count past the end', buildTiff({ entries: [], entryCount: 400 })],
    ['a big-format magic', buildTiff({ entries: [], magic: 43 })],
    ['an unknown byte order', buildTiff({ entries: [], byteOrderMark: 'XX' })],
  ])('%s is refused', async (_name, bytes) => {
    expect(await decodeTiffFrame(bytes, LIMITS)).toBeNull();
  });
});

test('a big-endian file decodes through the confinement', async () => {
  const { default: UTIF } = (await import('utif2')) as unknown as {
    default: { encodeImage(rgba: Uint8Array, width: number, height: number): ArrayBuffer };
  };
  const bytes = new Uint8Array(UTIF.encodeImage(new Uint8Array(3 * 2 * 4).fill(200), 3, 2));
  expect(String.fromCharCode(bytes[0]!, bytes[1]!)).toBe('MM');
  const frame = await decodeTiffFrame(bytes, LIMITS);
  expect(frame?.pixelWidth).toBe(3);
  expect(frame?.pixelHeight).toBe(2);
});
