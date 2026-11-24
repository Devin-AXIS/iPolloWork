// Capability/runtime registry public surface (document-engine task 0.1).
export { ID_KINDS, type IdKind, type CapabilityId, isValidId, assertValidId } from './ids.ts';
export { type SemVer, parseSemVer, compareSemVer, satisfies } from './versions.ts';
export {
  RegistryError,
  type RegistryErrorCode,
  type ReplacementPolicy,
  type Contribution,
  type FeatureBundle,
  type ResolvedRegistry,
  type ResolveOptions,
  resolve,
} from './registry.ts';
export {
  ORIGIN_IDS,
  CANONICAL_MUTATION_ORIGINS,
  NON_CANONICAL_ORIGINS,
  RESULT_IDS,
  RUNTIME_PORT_IDS,
  DEPENDENCY_KEY_IDS,
  ALL_FROZEN_IDS,
} from './frozen-ids.ts';
