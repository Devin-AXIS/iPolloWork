// Saving the same parts twice has to produce the same bytes, whenever the two saves
// happen. A ZIP entry carries a modification time in the DOS format, and fflate stamps
// the current one unless it is told otherwise — so the writer that does not pin it
// produces output that differs, in that field alone, across a two-second boundary. It
// reads as a save/reopen fidelity failure, and it reproduces roughly never on a fast
// machine and often on a loaded one.
import { describe, expect, test } from 'bun:test';
import { writeZip } from '../zip.ts';

const parts = new Map([
  ['/word/document.xml', new TextEncoder().encode('<w:document/>')],
  ['/[Content_Types].xml', new TextEncoder().encode('<Types/>')],
]);

/** Local file header: signature(4) version(2) flags(2) method(2), then the DOS time and
 *  date this asserts on. */
const DOS_TIME_OFFSET = 10;

describe('writeZip is deterministic', () => {
  test('the entry timestamp does not come from the clock', () => {
    const now = Date.now;
    try {
      const first = writeZip(parts);
      // Far enough that any clock-derived field would have to move.
      Date.now = () => now() + 7 * 24 * 60 * 60 * 1000;
      const second = writeZip(parts);
      expect([...second]).toEqual([...first]);
    } finally {
      Date.now = now;
    }
  });

  test('it is the DOS epoch, so the year field cannot underflow', () => {
    const bytes = writeZip(parts);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const date = view.getUint16(DOS_TIME_OFFSET + 2, true);
    // DOS packs the year into the top seven bits, counted from 1980.
    expect(date >>> 9).toBe(0);
  });
});
