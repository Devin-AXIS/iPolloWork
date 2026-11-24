// Shared conformance fixture format + replay harness (document-engine task 1.5).
export {
  type FixtureOutcome,
  type ModelChangeSummary,
  type AnchorSnapshot,
  type FixtureExpectation,
  type FixtureStep,
  type EncodedEnvelope,
  type FixtureSource,
  type ConformanceFixture,
  type ValidationResult,
  validateFixture,
} from './fixture-format.ts';
export {
  type ReplayOutcome,
  type ReplayStore,
  type ReplayReport,
  replayFixture,
  hashAuthored,
} from './harness.ts';
