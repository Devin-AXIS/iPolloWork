// Frozen canonical comparator formats (document-engine task 0.4 / perf spec
// "Artifact comparators are explicit"). This freezes WHICH comparison mode each
// artifact class uses and its declared ephemera; the per-artifact producers in
// later sections emit values these comparators consume. Nothing here invents a
// tolerance for artifacts the spec requires to match exactly.

import { canonicalize, stableHash } from './canonical.ts';

/**
 * How one artifact class is compared.
 *
 * Frozen per artifact: nothing here invents a tolerance for an artifact the spec requires to
 * match exactly.
 */
export type ComparatorMode =
  // Byte-exact structural equality after canonicalization (keys sorted, ephemera dropped).
  | 'canonical-exact'
  // Exact equality of every field — no ephemera dropped (geometry, anchors, hit results).
  | 'exact'
  // Numeric tolerance — permitted ONLY for a documented unavoidable raster comparison.
  | 'tolerance'
  // Not an equivalence basis: a sync optimization whose coverage MUST NOT be
  // treated as proof of update/delete-set application (Yjs state vectors).
  | 'sync-optimization-only';

/** One artifact class's comparison mode and its declared ephemera — fields excluded from equality. */
export interface ComparatorDescriptor {
  readonly id: string;
  readonly mode: ComparatorMode;
  /** Object keys excluded from canonical-exact comparison (declared ephemera). */
  readonly ephemera: readonly string[];
  readonly note: string;
}

const ROOT = 'dev.docx-editor.core.comparator';

/** The frozen artifact comparator set. */
export const COMPARATORS = {
  authoredState: {
    id: `${ROOT}.authored-state`,
    mode: 'canonical-exact',
    // Authored state compares canonical normalized records excluding revision/
    // provenance/timestamp ephemera (perf spec).
    ephemera: ['revision', 'provenance', 'producedAt', 'commitId'],
    note: 'canonical normalized authored records; ephemera excluded',
  },
  anchor: {
    id: `${ROOT}.anchor`,
    mode: 'exact',
    ephemera: [],
    note: 'internal anchor identity/affinity compares exactly',
  },
  yjsStateVector: {
    id: `${ROOT}.yjs-state-vector`,
    mode: 'sync-optimization-only',
    ephemera: [],
    note: 'exchange optimization only; never proves update or delete-set coverage',
  },
  shapedRun: {
    id: `${ROOT}.shaped-run`,
    mode: 'exact',
    ephemera: [],
    note: 'glyph ids, clusters, and fixed-point advances compare exactly',
  },
  paginationFingerprint: {
    id: `${ROOT}.pagination-fingerprint`,
    mode: 'exact',
    ephemera: [],
    note: 'page/column boundaries, break causes, fixed-point geometry compare exactly',
  },
  semanticTree: {
    id: `${ROOT}.semantic-tree`,
    mode: 'exact',
    ephemera: [],
    note: 'reading order, roles, headings, alt text compare exactly',
  },
  hitTest: {
    id: `${ROOT}.hit-test`,
    mode: 'exact',
    ephemera: [],
    note: 'resolved hit target and cluster affinity compare exactly',
  },
  pdfSemantics: {
    id: `${ROOT}.pdf-semantics`,
    mode: 'canonical-exact',
    // Container metadata/object numbering/compression/subset naming are ephemera.
    ephemera: ['objectNumber', 'producer', 'creationDate', 'modDate', 'subsetTag'],
    note: 'canonical semantic PDF objects; container ephemera excluded',
  },
  rasterCheckpoint: {
    id: `${ROOT}.raster-checkpoint`,
    mode: 'tolerance',
    ephemera: [],
    note: 'documented unavoidable raster comparison; explicit tolerance only',
  },
  benchmarkEvidence: {
    id: `${ROOT}.benchmark-evidence`,
    mode: 'sync-optimization-only',
    ephemera: [],
    note: 'diagnostic evidence, not an equivalence basis',
  },
} as const satisfies Record<string, ComparatorDescriptor>;

/** Which frozen comparator to use. */
export type ComparatorName = keyof typeof COMPARATORS;

/** Whether two artifacts matched, and where they diverged when they did not. */
export interface ComparisonResult {
  readonly equal: boolean;
  /** Canonical forms when unequal (diagnostic). */
  readonly left?: string;
  readonly right?: string;
}

/**
 * Compare two artifacts under a named comparator. `canonical-exact` and `exact`
 * compare canonical forms (exact drops no ephemera). `tolerance` requires an
 * epsilon and compares finite numbers structurally. `sync-optimization-only`
 * throws — such artifacts are never an equivalence basis.
 */
export function compareArtifacts(
  name: ComparatorName,
  left: unknown,
  right: unknown,
  opts: { epsilon?: number } = {}
): ComparisonResult {
  const d = COMPARATORS[name];
  switch (d.mode) {
    case 'sync-optimization-only':
      throw new Error(`${d.id} is not an equivalence basis (${d.note})`);
    case 'tolerance': {
      if (opts.epsilon === undefined) throw new Error(`${d.id} requires an explicit epsilon`);
      return { equal: numbersWithin(left, right, opts.epsilon) };
    }
    case 'exact':
    case 'canonical-exact': {
      const ephemera = d.mode === 'canonical-exact' ? new Set(d.ephemera) : new Set<string>();
      const l = canonicalize(left, ephemera);
      const r = canonicalize(right, ephemera);
      return l === r ? { equal: true } : { equal: false, left: l, right: r };
    }
  }
}

/** Fingerprint an artifact under a named comparator's canonicalization policy. */
export function fingerprint(name: ComparatorName, value: unknown): string {
  const d = COMPARATORS[name];
  if (d.mode === 'tolerance' || d.mode === 'sync-optimization-only') {
    throw new Error(`${d.id} has no canonical fingerprint (${d.mode})`);
  }
  const ephemera = d.mode === 'canonical-exact' ? new Set(d.ephemera) : undefined;
  return stableHash(value, ephemera);
}

function numbersWithin(a: unknown, b: unknown, epsilon: number): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= epsilon;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => numbersWithin(x, b[i], epsilon));
  }
  return false;
}
