// Bounded ZIP read/write over fflate (document-engine task 2.3 / design D14).
// Reading enforces entry-count, total-decompressed-size and archive-ratio ceilings
// (zip-bomb guard) and normalizes every entry name through the OPC profile
// (path-traversal guard) BEFORE the bytes are handed on. Writing produces a
// deterministic archive.

import { unzipSync } from 'fflate';
import { normalizePartName, partNameKey } from './opc-names.ts';
import { writeZipEntriesSteps } from './zip-write.ts';

/**
 * Why a zip was refused at the trust boundary.
 *
 * `too-large` and `too-many-entries` are the zip-bomb guards; `bad-name` catches path traversal —
 * an entry with `..` or a leading `/` is rejected rather than normalized.
 */
export type ZipRejection = 'too-many-entries' | 'too-large' | 'bad-name' | 'inflate-error';

/**
 * Declared uncompressed bytes an archive may reach before `maxRatio` applies: 8 MiB.
 *
 * Small parts are where legitimate documents carry extreme ratios: a few kilobytes of zero
 * bytes, or a metafile drawn from long uniform runs, stores in a few dozen bytes. Above this
 * size the ratio applies to the whole archive, so splitting a bomb across many small entries
 * does not evade it. The most any archive may expand to is therefore the larger of 8 MiB and
 * `maxRatio` times its own length, and never more than `maxTotalBytes`: a tiny upload costs
 * the reader at most 8 MiB.
 */
export const ZIP_RATIO_EXEMPT_BYTES = 8 * 1024 * 1024;

/** Archive caps: entry count, total decompressed bytes, and the decompression ratio. */
export interface ZipLimits {
  readonly maxEntries: number;
  /** Max total UNCOMPRESSED bytes across the archive. */
  readonly maxTotalBytes: number;
  /**
   * Max ratio of the archive's total declared uncompressed bytes to the archive's own byte
   * length (zip-bomb guard). Applies once that total exceeds 8 MiB, so a small archive is
   * never refused for compressing well.
   */
  readonly maxRatio?: number;
}

/** The archive caps in force when a host configures none. Conservative and finite. */
export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 10_000,
  maxTotalBytes: 512 * 1024 * 1024,
  maxRatio: 200,
};

/** The read entries, or the typed refusal. Never throws — the bytes are untrusted. */
export type ZipReadResult =
  | { readonly ok: true; readonly entries: ReadonlyMap<string, Uint8Array> }
  | {
      readonly ok: false;
      readonly reason: ZipRejection;
      readonly detail?: string;
      readonly limit?: 'zip.maxTotalBytes' | 'zip.maxRatio';
    };

class ZipViolation extends Error {
  constructor(
    readonly reason: ZipRejection,
    readonly limit?: 'zip.maxTotalBytes' | 'zip.maxRatio'
  ) {
    super(reason);
  }
}

/**
 * Inflate a ZIP archive with bounds + OPC name normalization. Entry name, count, archive
 * ratio, and total-uncompressed-size limits are enforced BEFORE each entry is decompressed
 * (via fflate's pre-inflation filter), so a zip bomb or a traversal name is rejected without
 * ever being inflated. Keys are canonical part names.
 *
 * The budgets count each entry's DECLARED sizes, and the declared size is also a hard cap on
 * what the entry may produce: fflate inflates into a buffer of exactly `originalSize` bytes
 * and never grows it, so an entry whose stream holds more than it declares is truncated (or
 * refused as `inflate-error`), never expanded past its budget. A stored entry is copied at
 * its compressed size, so the larger of its two declared sizes is what counts.
 */
export function readZip(bytes: Uint8Array, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipReadResult {
  const maxRatio = limits.maxRatio ?? 200;
  let entryCount = 0;
  let totalUncompressed = 0;
  let badDetail: string | undefined;
  const seenNorms = new Set<string>();

  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(bytes, {
      // `size` = compressed, `originalSize` = uncompressed. This runs BEFORE inflation.
      filter: (file) => {
        if (file.name.endsWith('/')) return false; // directory entry — never inflated
        entryCount += 1;
        if (entryCount > limits.maxEntries) throw new ZipViolation('too-many-entries');
        const norm = normalizePartName(file.name);
        if (!norm.ok) {
          badDetail = `${file.name}: ${norm.reason}`;
          throw new ZipViolation('bad-name');
        }
        // Reject two entries whose names are OPC-equivalent (normalized AND case-folded,
        // e.g. `word/document.xml` vs `word/%64ocument.xml` vs `Word/Document.xml`) —
        // last-wins would smuggle/omit a part. Checked BEFORE inflation.
        const key = partNameKey(norm.partName);
        if (seenNorms.has(key)) {
          badDetail = `${file.name}: OPC-equivalent duplicate of ${norm.partName}`;
          throw new ZipViolation('bad-name');
        }
        seenNorms.add(key);
        // Both budgets are checked before this entry is decompressed. A stored entry is
        // copied at `size` bytes whatever it declares as `originalSize`.
        totalUncompressed += Math.max(file.originalSize, file.size);
        if (totalUncompressed > limits.maxTotalBytes)
          throw new ZipViolation('too-large', 'zip.maxTotalBytes');
        if (
          totalUncompressed > ZIP_RATIO_EXEMPT_BYTES &&
          totalUncompressed / Math.max(1, bytes.byteLength) > maxRatio
        )
          throw new ZipViolation('too-large', 'zip.maxRatio');
        return true;
      },
    });
  } catch (e) {
    if (e instanceof ZipViolation)
      return {
        ok: false,
        reason: e.reason,
        detail: badDetail,
        ...(e.limit === undefined ? {} : { limit: e.limit }),
      };
    return { ok: false, reason: 'inflate-error' };
  }

  const entries = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(raw)) {
    const norm = normalizePartName(name);
    if (norm.ok) entries.set(norm.partName, data);
  }
  return { ok: true, entries };
}

/** The modification time stamped on every entry written.
 *
 *  Without one, a writer stamps `Date.now()`, which makes the same document save to
 *  different bytes depending on when it was saved: a ZIP entry carries its time in the DOS
 *  format, whose resolution is two seconds, so two saves that land either side of a tick
 *  differ in that field and nowhere else. Save/reopen/save then stops being a fixed point,
 *  and any digest a caller takes over saved bytes stops being stable.
 *
 *  Mid-day on 1980-01-02 rather than the DOS epoch itself: the writer derives the year through
 *  the local-time `getFullYear`, so midnight on 1980-01-01 UTC lands in 1979 west of
 *  Greenwich and the year field underflows. */
const FIXED_ENTRY_MTIME = new Date(Date.UTC(1980, 0, 2, 12));

/** Deflate a set of canonical-part-name -> bytes into a ZIP archive. Every part name
 *  is re-validated through the OPC normalization profile before writing, so a
 *  traversal/encoded/normalized-alias name from an untrusted serialized model can
 *  never be smuggled into a ZIP entry (write-side path-traversal guard). */
export function writeZip(entries: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const steps = writeZipSteps(entries);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}

/**
 * {@link writeZip}, yielding between slices of a long entry. The archive is the same either
 * way.
 *
 * @internal
 */
export function writeZipSteps(
  entries: ReadonlyMap<string, Uint8Array>
): Generator<void, Uint8Array> {
  const named = new Map<string, Uint8Array>();
  const seen = new Set<string>();
  for (const [partName, data] of entries) {
    const norm = normalizePartName(partName);
    if (!norm.ok) throw new Error(`unsafe part name on write: ${partName} (${norm.reason})`);
    const fold = partNameKey(norm.partName); // OPC case-folded equivalence
    if (seen.has(fold))
      throw new Error(`OPC-equivalent duplicate part name on write: ${norm.partName}`);
    seen.add(fold);
    // Canonical part names carry a leading slash; ZIP entry names do not.
    named.set(norm.partName.replace(/^\//, ''), data);
  }
  return writeZipEntriesSteps(named, FIXED_ENTRY_MTIME);
}

export { strToU8, strFromU8 } from 'fflate';
