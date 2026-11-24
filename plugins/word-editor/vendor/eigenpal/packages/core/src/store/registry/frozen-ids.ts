// Globally stable, FROZEN identifiers for the engine's cross-cutting domains
// (document-engine task 0.1). These are the ids the store, binding, sync,
// layout, and output consumers reference; freezing them here — before any
// consumer exists — keeps them stable across the whole build.
//
// Command/query/schema ids are owned and frozen by the capability that
// introduces them (sections 4 and 7); this module freezes only the closed,
// engine-owned enumerations: origins, result classes, runtime ports, and
// layout dependency keys.

const ROOT = 'dev.docx-editor.core';

/**
 * Typed-origin domains (design D5 / ADR-S5). `mutation.*` are the canonical
 * write origins; `projection` and `awareness` MUST NOT enter history, audit,
 * snapshots, or replication.
 */
export const ORIGIN_IDS = {
  mutationHuman: `${ROOT}.origin.mutation.human`,
  mutationAgent: `${ROOT}.origin.mutation.agent`,
  mutationRemote: `${ROOT}.origin.mutation.remote`,
  mutationUndo: `${ROOT}.origin.mutation.undo`,
  mutationRedo: `${ROOT}.origin.mutation.redo`,
  mutationMigration: `${ROOT}.origin.mutation.migration`,
  mutationRepair: `${ROOT}.origin.mutation.repair`,
  mutationServer: `${ROOT}.origin.mutation.server`,
  projection: `${ROOT}.origin.projection`,
  awareness: `${ROOT}.origin.awareness`,
} as const;

/** Canonical writes carry a mutation origin; these are the undoable-eligibility inputs. */
export const CANONICAL_MUTATION_ORIGINS: readonly string[] = [
  ORIGIN_IDS.mutationHuman,
  ORIGIN_IDS.mutationAgent,
  ORIGIN_IDS.mutationRemote,
  ORIGIN_IDS.mutationUndo,
  ORIGIN_IDS.mutationRedo,
  ORIGIN_IDS.mutationMigration,
  ORIGIN_IDS.mutationRepair,
  ORIGIN_IDS.mutationServer,
];

/** Origins that never enter authored state / history / audit / snapshot / replication. */
export const NON_CANONICAL_ORIGINS: readonly string[] = [
  ORIGIN_IDS.projection,
  ORIGIN_IDS.awareness,
];

/**
 * Result taxonomy (design D8 / task 7.8). A transport/protocol failure that
 * prevents a valid envelope is a typed exception, not a member here.
 */
export const RESULT_IDS = {
  applied: `${ROOT}.result.applied`,
  validation: `${ROOT}.result.validation`,
  conflict: `${ROOT}.result.conflict`,
  resource: `${ROOT}.result.resource`,
  authorization: `${ROOT}.result.authorization`,
  aborted: `${ROOT}.result.aborted`,
} as const;

/** Runtime ports (extensions-and-runtime-ports spec; design D9). */
export const RUNTIME_PORT_IDS = {
  fonts: `${ROOT}.port.fonts`,
  shaping: `${ROOT}.port.shaping`,
  images: `${ROOT}.port.images`,
  clock: `${ROOT}.port.clock`,
  identity: `${ROOT}.port.identity`,
  persistence: `${ROOT}.port.persistence`,
  transport: `${ROOT}.port.transport`,
  scheduling: `${ROOT}.port.scheduling`,
  audit: `${ROOT}.port.audit`,
  authorization: `${ROOT}.port.authorization`,
  resourceAccounting: `${ROOT}.port.resource-accounting`,
  cancellation: `${ROOT}.port.cancellation`,
  externalResourceConsent: `${ROOT}.port.external-resource-consent`,
} as const;

/** Layout dependency keys (design D6 / task 8.2). */
export const DEPENDENCY_KEY_IDS = {
  style: `${ROOT}.dep.style`,
  numbering: `${ROOT}.dep.numbering`,
  section: `${ROOT}.dep.section`,
  story: `${ROOT}.dep.story`,
  font: `${ROOT}.dep.font`,
  image: `${ROOT}.dep.image`,
  table: `${ROOT}.dep.table`,
  field: `${ROOT}.dep.field`,
  note: `${ROOT}.dep.note`,
  headerFooter: `${ROOT}.dep.header-footer`,
  annotation: `${ROOT}.dep.annotation`,
} as const;

/** Every frozen id as a flat list, for the immutability / uniqueness gate. */
export const ALL_FROZEN_IDS: readonly string[] = [
  ...Object.values(ORIGIN_IDS),
  ...Object.values(RESULT_IDS),
  ...Object.values(RUNTIME_PORT_IDS),
  ...Object.values(DEPENDENCY_KEY_IDS),
];
