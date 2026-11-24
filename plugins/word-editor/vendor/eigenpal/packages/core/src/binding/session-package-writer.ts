import type { OoxmlPackage } from '@docx-editor.dev/core/store';
import { writeOoxmlPackageSteps } from '../store/package/ooxml-package.ts';

// Retain at most one compressed document per session, never an XML copy per undo state.
const MAX_CACHED_SAVE_BYTES = 8 * 1024 * 1024;

/** Writes a session's packages, reusing the bytes of the last package it wrote. */
export interface SessionPackageWriter {
  /** The bytes of `pkg`, written now. */
  (pkg: OoxmlPackage): Uint8Array;
  /** The same bytes, written in steps a caller can pause between. */
  steps(pkg: OoxmlPackage): Generator<void, Uint8Array>;
}

/** Cache only exact immutable package snapshots; every caller owns its returned bytes. */
export function createSessionPackageWriter(): SessionPackageWriter {
  // A weak key avoids keeping a previous package/tree alive after the session advances.
  // Replacing the map on a miss also bounds retained output when undo keeps old keys alive.
  let cached = new WeakMap<OoxmlPackage, Uint8Array>();
  function* steps(pkg: OoxmlPackage): Generator<void, Uint8Array> {
    const previous = cached.get(pkg);
    if (previous) return previous.slice();
    const bytes = yield* writeOoxmlPackageSteps(pkg);
    cached = new WeakMap();
    if (bytes.byteLength <= MAX_CACHED_SAVE_BYTES) cached.set(pkg, bytes.slice());
    return bytes;
  }
  const write = (pkg: OoxmlPackage): Uint8Array => {
    const run = steps(pkg);
    for (;;) {
      const next = run.next();
      if (next.done) return next.value;
    }
  };
  return Object.assign(write, { steps });
}
