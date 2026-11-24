import type { TreeDocOp } from '../store/store/tree-ops.ts';
import type { InsertCustomNodeWrite } from '../store/store/custom-node-writes.ts';
import type { AutomationCommentWrite, AutomationPackageEdit } from './document-port.ts';
import type { AutomationValue, AutomationError } from './protocol.ts';
import type { AutomationStoryId } from './stories.ts';
import type { AutomationPackageReads } from './reads.ts';

export type PlannedOperation =
  | { readonly ok: true; readonly kind: 'query'; readonly value: AutomationValue }
  | {
      readonly ok: true;
      readonly kind: 'command';
      readonly ops: readonly TreeDocOp[];
      /** Which story the ops address. A batch commits into one story; see `pinWrite`. */
      readonly story: AutomationStoryId;
      /**
       * The op commits as a PACKAGE transaction rather than inside a story's.
       *
       * A note's lifecycle rewrites the notes part, the references in every story that cited it,
       * a relationship and a content-type override, and the store publishes that as its own undo
       * unit. The host routes it through the port's lifecycle path, and the planner has already
       * refused it any company — one commit per batch, or the batch is not one transaction.
       */
      readonly lifecycle?: boolean;
      readonly solitary?: boolean;
      readonly packageEdits?: readonly AutomationPackageEdit[];
      /**
       * A relationship these ops need, and the ops once the package declares it.
       *
       * Present only for an external hyperlink target, and then `ops` is EMPTY: a relationship is a
       * package fact that outlives a refusal — it lives beside the trees, outside the undo stack —
       * so minting one while planning left a `Relationship` in `.rels` for a link a later refusal
       * meant the document never got, on a document that may not even have been writable. Planning
       * validates the target (see `authorableHyperlinkTarget`, the same gate the mint applies) and
       * schedules it; the application path mints it after the mode gate has passed and builds the
       * ops from the id it got back.
       */
      readonly relate?: {
        readonly url: string;
        readonly ops: (relationshipId: string) => readonly TreeDocOp[];
      };
      /** Computed after the commit, so a created paragraph can be named. */
      readonly answer: (post: AutomationPackageReads) => AutomationValue;
    }
  | {
      readonly ok: true;
      /**
       * A comment write, which is a package transaction of its own rather than a tree op.
       *
       * See `AutomationDocumentPort.applyCommentWrite`: a reply is markers plus `comments.xml`
       * plus `commentsExtended.xml` plus a relationship plus a content type, and the engine
       * already commits that as one thing. Solitary like a lifecycle op, for the same reason.
       */
      readonly kind: 'commentWrite';
      readonly write: AutomationCommentWrite;
      readonly story: AutomationStoryId;
      /**
       * The answer, given the committed state and the id the write minted.
       *
       * The id is carried separately because it does not exist until the package transaction runs:
       * a reply's `w:id` is chosen while writing `comments.xml`, and nothing in the post-commit
       * reads says which of the part's comments the caller just added.
       */
      readonly answer: (
        post: AutomationPackageReads,
        commentId: string | undefined
      ) => AutomationValue;
    }
  | {
      readonly ok: true;
      /**
       * A custom-node write: the data part, the node inside it, and the bound control.
       *
       * See `AutomationDocumentPort.applyCustomNodeWrite`. Its own kind rather than a command
       * with ops, because the store the binding quotes does not exist until the write runs — a
       * `TreeDocOp` carrying the `w:storeItemID` would have to be built from an id nothing has
       * minted yet. Solitary, like a comment write.
       */
      readonly kind: 'customNodeWrite';
      readonly write: InsertCustomNodeWrite;
      readonly story: AutomationStoryId;
      readonly answer: (post: AutomationPackageReads) => AutomationValue;
    }
  | {
      readonly ok: true;
      /**
       * A whole-document replacement: the decoded DOCX file, which the port opens and installs
       * as one undoable package update. See `AutomationDocumentPort.replaceDocument`. Solitary,
       * because every part changes.
       */
      readonly kind: 'documentReplace';
      readonly docx: Uint8Array;
      readonly story: AutomationStoryId;
      readonly answer: (post: AutomationPackageReads) => AutomationValue;
    }
  | { readonly ok: false; readonly error: AutomationError };
