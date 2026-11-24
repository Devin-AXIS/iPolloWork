// Shared conformance fixture format (document-engine task 1.5). One frozen JSON
// shape records revisions, origins, operations, model changes, snapshots,
// updates, anchors, authored-state hashes, and output hashes so the same fixture
// drives local, Yjs, binding, and cross-runtime conformance (sections 5, 6, 13).
// The DocOp/ModelChange payloads are carried opaquely here; their exact schemas
// are owned by sections 4 and 7. What is FROZEN is the container: field names,
// origin membership, revision monotonicity, hash format, and envelope shape.

import { CANONICAL_MUTATION_ORIGINS, NON_CANONICAL_ORIGINS } from '../registry/frozen-ids.ts';

/** Whether a recorded conformance step was expected to commit or be refused. */
export type FixtureOutcome =
  'applied' | 'aborted' | 'validation' | 'conflict' | 'resource' | 'authorization';

/** The change one step produced, summarized to what a fixture can compare across runtimes. */
export interface ModelChangeSummary {
  readonly fromRevision: number;
  readonly toRevision: number;
  readonly origin: string;
  readonly dirty: readonly string[];
  readonly dependencyKeys: readonly string[];
}

/** Where anchors sat after a step — how a fixture proves positions survived an edit. */
export interface AnchorSnapshot {
  readonly anchorId: string;
  readonly story: string;
  readonly block: string;
  readonly affinity: 'before' | 'after';
}

/** What one step must produce: its outcome, its change summary, and its authored-state hash. */
export interface FixtureExpectation {
  readonly outcome: FixtureOutcome;
  /** Present iff outcome === 'applied'; MUST be > baseRevision. */
  readonly committedRevision?: number;
  readonly modelChange?: ModelChangeSummary;
  /** 16-hex authored-state fingerprint (comparator 0.4). */
  readonly authoredStateHash?: string;
  readonly outputHash?: string;
  readonly anchors?: readonly AnchorSnapshot[];
}

/** One recorded operation and what it was expected to do. */
export interface FixtureStep {
  readonly baseRevision: number;
  readonly origin: string;
  /** Opaque DocOp payloads (schema owned by section 4). */
  readonly ops: readonly unknown[];
  readonly expect: FixtureExpectation;
}

/** Opaque encoded backend bytes (snapshot or replication update). */
export interface EncodedEnvelope {
  readonly kind: 'snapshot' | 'update';
  readonly protocolVersion: number;
  readonly schemaVersion: number;
  readonly documentId: string;
  readonly byteLength: number;
  /** Hex-encoded opaque bytes; length MUST equal byteLength. */
  readonly bytesHex: string;
}

/** Which implementation recorded a fixture — local store, Yjs, or a binding. */
export type FixtureSource =
  | { readonly kind: 'create' }
  | { readonly kind: 'docx'; readonly sha256: string; readonly bytesRef: string };

/**
 * The frozen conformance container: revisions, origins, operations, changes, snapshots and
 * hashes.
 *
 * The CONTAINER is what is frozen — field names, origin membership, revision monotonicity, hash
 * format. The op and change payloads travel opaquely, so their schemas can evolve without
 * invalidating every recorded fixture.
 */
export interface ConformanceFixture {
  readonly formatVersion: 1;
  readonly documentId: string;
  readonly source: FixtureSource;
  readonly steps: readonly FixtureStep[];
  readonly snapshots?: readonly EncodedEnvelope[];
  readonly updates?: readonly EncodedEnvelope[];
}

const VALID_ORIGINS = new Set<string>([...CANONICAL_MUTATION_ORIGINS, ...NON_CANONICAL_ORIGINS]);
const HASH_RE = /^[0-9a-f]{16}$/;
const HEX_RE = /^[0-9a-f]*$/;

/** Whether a fixture is well-formed, listing every structural violation. */
export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/** Structurally validate a fixture against the frozen format rules. */
export function validateFixture(fixture: ConformanceFixture): ValidationResult {
  const errors: string[] = [];
  const err = (m: string) => errors.push(m);

  if (fixture.formatVersion !== 1) err(`unsupported formatVersion ${fixture.formatVersion}`);
  if (!fixture.documentId) err('documentId is required');
  if (fixture.source.kind === 'docx' && !/^[0-9a-f]{64}$/.test(fixture.source.sha256)) {
    err('docx source requires a 64-hex sha256');
  }

  let lastRevision = -1;
  fixture.steps.forEach((step, i) => {
    const at = `step[${i}]`;
    if (!VALID_ORIGINS.has(step.origin)) err(`${at}: unknown origin ${step.origin}`);
    if (!Number.isInteger(step.baseRevision) || step.baseRevision < 0) {
      err(`${at}: baseRevision must be a non-negative integer`);
    }
    if (step.baseRevision < lastRevision)
      err(`${at}: baseRevision regressed below ${lastRevision}`);

    const e = step.expect;
    if (e.outcome === 'applied') {
      if (e.committedRevision === undefined) err(`${at}: applied step needs committedRevision`);
      else if (e.committedRevision <= step.baseRevision) {
        err(
          `${at}: committedRevision ${e.committedRevision} must exceed baseRevision ${step.baseRevision}`
        );
      } else lastRevision = e.committedRevision;
      if (e.modelChange) validateModelChange(e.modelChange, at, err);
    } else {
      // Failed/aborted steps commit nothing.
      if (e.committedRevision !== undefined)
        err(`${at}: ${e.outcome} step must not commit a revision`);
      if (e.authoredStateHash !== undefined)
        err(`${at}: ${e.outcome} step must not change authored state`);
    }
    if (e.authoredStateHash !== undefined && !HASH_RE.test(e.authoredStateHash)) {
      err(`${at}: authoredStateHash must be 16-hex`);
    }
    if (e.outputHash !== undefined && !HASH_RE.test(e.outputHash))
      err(`${at}: outputHash must be 16-hex`);
  });

  for (const env of [...(fixture.snapshots ?? []), ...(fixture.updates ?? [])]) {
    if (env.documentId !== fixture.documentId)
      err(`envelope documentId ${env.documentId} != ${fixture.documentId}`);
    if (!HEX_RE.test(env.bytesHex)) err('envelope bytesHex must be hex');
    if (env.bytesHex.length !== env.byteLength * 2) {
      err(
        `envelope byteLength ${env.byteLength} disagrees with ${env.bytesHex.length / 2} decoded bytes`
      );
    }
  }

  return { valid: errors.length === 0, errors };
}

function validateModelChange(mc: ModelChangeSummary, at: string, err: (m: string) => void): void {
  if (!VALID_ORIGINS.has(mc.origin)) err(`${at}: modelChange origin ${mc.origin} unknown`);
  if (mc.toRevision <= mc.fromRevision) err(`${at}: modelChange revision must advance`);
}
