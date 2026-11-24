// Canonical comparator formats (document-engine task 0.4).
export { type Json, canonicalize, stableHash } from './canonical.ts';
export {
  type ComparatorMode,
  type ComparatorDescriptor,
  type ComparatorName,
  type ComparisonResult,
  COMPARATORS,
  compareArtifacts,
  fingerprint,
} from './comparators.ts';
