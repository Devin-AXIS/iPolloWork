import type {
  CanResult,
  EditorCommand,
  EditorExecOptions,
  ExecResult,
  HistoryGroup,
  HistoryGroupOptions,
} from '../contracts/editor.ts';
import type { HistoryGroupOutcome, HistoryDiagnostic } from '../contracts/editor-scope.ts';
import { observeHistoryGroup, type HistoryCaptureKind } from '@docx-editor.dev/core/store';
import { runWithHistoryGroup } from './history-group-scope.ts';

// Synchronous commands whose writes commit through the surface inside `exec`. The package
// coordinator merges a group's frames across stories and package units, so a review
// decision and a counter-proposal can share one undo step with formatting. Everything else is
// refused before writing rather than promised a group it would not get: undo and redo are
// boundaries, image commands finish asynchronously, typing lands through the type buffer, and
// view commands write nothing.
const GROUPABLE = new Set<EditorCommand['type']>([
  'resolveAllReviewChanges',
  'acceptAllRevisions',
  'rejectAllRevisions',
  'setReviewChangesAuthor',
  'addComment',
  'replyComment',
  'resolveComment',
  'acceptRevision',
  'rejectRevision',
  'proposeInsertion',
  'proposeDeletion',
  'proposeReplacement',
  'replaceMatch',
  'replaceAcceptedText',
  'replaceAllMatches',
  'replaceText',
  'applyFormatting',
  'splitParagraph',
  'mergeParagraphs',
  'removeTabMark',
  'toggleMark',
  'setMarkAttr',
  'setAlignment',
  'setParagraphDirection',
  'clearFormatting',
  'setLineSpacing',
  'setParagraphSpacing',
  'setParagraphStyle',
  'setParagraphFormat',
]);
const CLOSED_GROUP_REFUSAL = Object.freeze({
  ok: false as const,
  code: 'unsupported' as const,
  reason:
    'historyGroup must be an open handle from this editor and document; begin a new group after end(), detach, or load',
});

interface GroupRecord {
  readonly token: symbol;
  owner: WeakRef<object> | undefined;
  closed: boolean;
  committed: boolean;
  undoEpoch: number;
  lastOutcome: HistoryGroupOutcome | null;
}

/** One commit's report from the history authority. */
interface FrameCapture {
  readonly kind: HistoryCaptureKind;
  readonly reason: HistoryGroupOutcome['reason'];
}

/**
 * The frames of one browser automation batch: `bind` runs each surface commit as a frame,
 * and `finish` settles the batch into one outcome.
 */
export interface AutomationHistoryFrames {
  bind<T>(owner: object, commit: () => T): T;
  finish(): HistoryGroupOutcome | null;
}

/** Owns handles, admission and reporting, but never a second history stack. */
export class EditorHistoryGroups {
  private readonly records = new WeakMap<HistoryGroup, GroupRecord>();
  private undoEpoch = 0;
  private burst: { key: string; time: number; count: number } | undefined;
  constructor(
    private readonly owner: () => object | null,
    private readonly diagnose: (diagnostic: HistoryDiagnostic) => void,
    private readonly target: () => string
  ) {}
  private diagnoseWrites(command: EditorCommand, result: ExecResult, grouped = false): void {
    if (command.type !== 'setMarkAttr' || !result.ok || !result.changed) return;
    const key = `${grouped}:${command.mark}:${command.attr}:${this.target()}`;
    const time = Date.now();
    const previous = this.burst;
    const count = previous?.key === key && time - previous.time <= 250 ? previous.count + 1 : 1;
    this.burst = { key, time, count };
    if (count === 3)
      this.diagnose({
        kind: grouped ? 'possible-fragmented-gesture' : 'possible-ungrouped-gesture',
        reason:
          'Three rapid formatting writes started separate groups at the same selection. For a continuous control, retain one handle with bindHistoryGroup; separate clicks may be intentional.',
      });
  }

  begin(): HistoryGroup {
    const owner = this.owner();
    const record: GroupRecord = {
      token: Symbol('gesture'),
      owner: owner ? new WeakRef(owner) : undefined,
      closed: false,
      committed: false,
      undoEpoch: this.undoEpoch,
      lastOutcome: null,
    };
    const handle = createHandle(record, new WeakRef(this));
    this.records.set(handle, record);
    return handle;
  }

  owns(owner: object | undefined): boolean {
    return owner !== undefined && owner === this.owner();
  }

  /** Refusal for a handle that is not open on this editor and document, or null. */
  validate(options?: HistoryGroupOptions): Extract<CanResult, { ok: false }> | null {
    const group = options?.historyGroup;
    if (group === undefined) return null;
    return this.token(group) === undefined ? CLOSED_GROUP_REFUSAL : null;
  }

  /** The store token of an open handle this editor owns, or `undefined`. */
  token(group: HistoryGroup): symbol | undefined {
    const record = this.records.get(group);
    return record && group.state === 'open' ? record.token : undefined;
  }

  gate(
    command: EditorCommand,
    options?: EditorExecOptions
  ): Extract<CanResult, { ok: false }> | null {
    const invalid = this.validate(options);
    if (invalid || options?.historyGroup === undefined) return invalid;
    if (!GROUPABLE.has(command.type)) {
      return {
        ok: false,
        code: 'unsupported',
        reason: `${command.type} does not support history grouping`,
      };
    }
    return null;
  }

  note(command: EditorCommand): void {
    if (command.type === 'undo' || command.type === 'redo') this.undoEpoch++;
  }

  /** Run one write, bound to the handle in `options`; `command` is absent for a review method. */
  run(
    owner: object,
    command: EditorCommand | undefined,
    options: HistoryGroupOptions | undefined,
    run: () => ExecResult
  ): ExecResult {
    const group = options?.historyGroup;
    const record = group && this.records.get(group);
    if (!record) {
      const result = runWithHistoryGroup(owner, undefined, run);
      if (command) this.diagnoseWrites(command, result);
      return result;
    }
    let capture: FrameCapture | undefined;
    const result = observeHistoryGroup(
      record.token,
      (kind, reason) => (capture = { kind, reason }),
      () => runWithHistoryGroup(owner, record.token, run)
    );
    if (!result.ok) return result;
    const history = this.settle(record, capture);
    if (history.kind === 'started' && command) this.diagnoseWrites(command, result, true);
    else this.burst = undefined;
    return { ...result, history };
  }

  /**
   * The frames of one automation run, or `null` for a handle that is not open here.
   *
   * One object spans every batch of the run, so the run settles ONCE into one outcome.
   * Each commit is observed on its own, because one commit can report twice (a story entry,
   * then the coordinator's merge) and the last report is its answer. The run's outcome is
   * its first commit's, unless any commit split it.
   */
  automationFrames(group: HistoryGroup): AutomationHistoryFrames | null {
    const record = this.token(group) === undefined ? undefined : this.records.get(group);
    if (!record) return null;
    const frames: FrameCapture[] = [];
    return {
      bind: (owner, commit) => {
        let capture: FrameCapture | undefined;
        const result = observeHistoryGroup(
          record.token,
          (kind, reason) => (capture = { kind, reason }),
          () => runWithHistoryGroup(owner, record.token, commit)
        );
        if (capture) frames.push(capture);
        return result;
      },
      finish: () => {
        if (frames.length === 0) return null;
        this.burst = undefined;
        // Split wins. A later commit that STARTED an entry means something closed the group
        // between two commits of this run, so the run is more than one undo step too.
        const broken = frames.find(
          (frame, index) => frame.kind === 'split' || (index > 0 && frame.kind === 'started')
        );
        return this.settle(record, broken ? { kind: 'split', reason: broken.reason } : frames[0]);
      },
    };
  }

  /** Turn the authority's report into the frame's outcome, and remember it on the record. */
  private settle(record: GroupRecord, capture: FrameCapture | undefined): HistoryGroupOutcome {
    const split = capture?.kind === 'split' || (capture?.kind === 'started' && record.committed);
    const history: HistoryGroupOutcome =
      capture === undefined
        ? { kind: 'none', reason: 'no-history' }
        : split
          ? {
              kind: 'split',
              reason:
                capture.reason ??
                (record.undoEpoch !== this.undoEpoch ? 'undo-redo' : 'history-boundary'),
            }
          : { kind: capture.kind };
    if (capture) {
      record.committed = true;
      record.undoEpoch = this.undoEpoch;
    }
    record.lastOutcome = history;
    if (history.kind === 'split')
      this.diagnose({ kind: 'split', reason: history.reason ?? 'history-boundary' });
    return history;
  }
}

// This factory captures weak ownership only. Keeping an expired handle must not keep
// a destroyed editor or an old document's surface, package, and layout alive.
function createHandle(record: GroupRecord, manager: WeakRef<EditorHistoryGroups>): HistoryGroup {
  return Object.freeze({
    get state() {
      return !record.closed && manager.deref()?.owns(record.owner?.deref())
        ? ('open' as const)
        : ('closed' as const);
    },
    get lastOutcome() {
      return record.lastOutcome;
    },
    end() {
      record.closed = true;
      record.owner = undefined;
    },
  }) as HistoryGroup;
}

/**
 * History groups owned per MOUNT: a handle closes on detach and on document replacement, and
 * never reopens when the same surface is attached again.
 */
export function createMountHistoryGroups(
  mount: () => { readonly mounted: boolean; readonly generation: number },
  diagnose: (diagnostic: HistoryDiagnostic) => void,
  target: () => string
): EditorHistoryGroups {
  let owner = { generation: -1, token: {} };
  return new EditorHistoryGroups(
    () => {
      const { mounted, generation } = mount();
      if (!mounted) return null;
      if (owner.generation !== generation) owner = { generation, token: {} };
      return owner.token;
    },
    diagnose,
    target
  );
}
