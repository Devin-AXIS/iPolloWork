// Refused-open state (editor lane).
//
// Split out of docx-editor.ts, which is at its line cap. One holder keeps the two reports of a
// refused open together: `parseError`, the engine's own text, which can quote the file, and
// `openFailure`, the stable code a host can show to a person.

import type {
  DocumentOpenFailure,
  DocumentOpenFailureReason,
  DocumentSource,
} from '@docx-editor.dev/core/contracts/editor';
import type { DocumentOpenDiagnosticCode } from '../automation/diagnostic-vocabulary.ts';
import { openDiagnosticCode } from '../automation/diagnostics.ts';
import { unloadableSourceReason } from './docx-editor-support.ts';

/** Exhaustive by type: a new open code fails the type check here until it has a reason. */
const REASONS: Readonly<Record<DocumentOpenDiagnosticCode, DocumentOpenFailureReason>> = {
  'open.zip-corrupt': 'damaged',
  'open.zip-invalid-entry-name': 'damaged',
  'open.xml-malformed': 'damaged',
  'open.content-types-invalid': 'damaged',
  'open.relationships-invalid': 'damaged',
  'open.unsupported-source': 'not-docx',
  'open.missing-main-document': 'not-docx',
  'open.zip-entry-limit': 'too-large',
  'open.zip-size-limit': 'too-large',
  'open.zip-ratio-limit': 'too-large',
  'open.xml-part-size-limit': 'too-large',
  'open.xml-depth-limit': 'too-large',
  'open.xml-element-limit': 'too-large',
  'open.relationship-limit': 'too-large',
  'open.part-limit': 'too-large',
  'open.xml-dtd-forbidden': 'blocked',
  'open.invalid-limits': 'unknown',
  'open.failed': 'unknown',
};

/** The refusal a person sees for one open code. Frozen, and a new object for each call. */
export function documentOpenFailure(code: DocumentOpenDiagnosticCode): DocumentOpenFailure {
  return Object.freeze({ code, reason: REASONS[code] ?? 'unknown' });
}

/** The facade's refused-open state. */
export interface DocumentOpenFailureState {
  readonly parseError: string | null;
  readonly failure: DocumentOpenFailure | null;
  /** The package or session refused the bytes. `detail` can quote the file. */
  reject(reason: string, limit?: string, detail?: string): void;
  /**
   * The source was not bytes at all. Returns the message that says what it was. With a
   * document still mounted, the state is kept: that document stays on screen.
   */
  refuseSource(source: DocumentSource, mounted?: boolean): string;
  /** The open threw. Reported as `open.failed`, with no engine text. */
  crash(): void;
  clear(): void;
}

/**
 * `changed` publishes the state: it must bump AND emit, because a refusal outside a mount has
 * no other emit to wake event-driven adapters. `reject` and `clear` run inside a mount that
 * publishes itself.
 */
export function createDocumentOpenFailureState(changed: () => void): DocumentOpenFailureState {
  let parseError: string | null = null;
  let failure: DocumentOpenFailure | null = null;
  return {
    get parseError() {
      return parseError;
    },
    get failure() {
      return failure;
    },
    reject(reason, limit, detail) {
      parseError = detail ? `${reason}: ${detail}` : reason;
      failure = documentOpenFailure(openDiagnosticCode(reason, limit));
    },
    refuseSource(source, mounted = false) {
      const message = unloadableSourceReason(source);
      if (mounted) return message;
      parseError = message;
      failure = documentOpenFailure('open.unsupported-source');
      changed();
      return message;
    },
    crash() {
      parseError = 'open failed';
      failure = documentOpenFailure('open.failed');
      changed();
    },
    clear() {
      parseError = null;
      failure = null;
    },
  };
}
