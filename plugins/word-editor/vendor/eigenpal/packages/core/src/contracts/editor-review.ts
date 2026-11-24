// Public review contract types. `contracts/editor.ts` re-exports this whole module, so every
// type declared here is public API: keep internal helpers out of this file.

/** Selection and unsupported-change policy for a bulk review decision. @public */
export interface ResolveReviewChangesOptions {
  action: 'accept' | 'reject';
  /** Defaults to revisions included by author visibility and the tracked-changes predicate. */
  scope?: 'visible' | 'document';
  /** Exact keys from getReviewItems(); overrides scope. Duplicate keys resolve once. */
  keys?: readonly string[];
  /** Defaults to skip. Strict refuses the entire selection if any target cannot resolve. */
  unsupported?: 'skip' | 'fail';
}

/**
 * Who and when a change of tracked-change author records. Shared by both selections.
 * @public
 */
export interface ReviewChangesAttribution {
  /**
   * The author to record. Defaults to the editor's `author`, so a reviewer adopts changes as
   * their own. A command with neither refuses, because `w:author` is required.
   */
  author?: string;
  /** An ISO 8601 `xsd:dateTime` to record. Omit it to keep each change's own date. */
  date?: string;
  /** Defaults to skip. Strict refuses the entire selection if any target cannot change. */
  unsupported?: 'skip' | 'fail';
}

/**
 * Selection and attribution for a change of tracked-change author. The changes stay pending.
 *
 * Select exact `keys` from `getReviewItems()`, or a `scope` narrowed by `authors`. The two
 * selections exclude each other.
 * @public
 */
export type SetReviewChangesAuthorOptions = ReviewChangesAttribution &
  (
    | {
        /** Exact keys from getReviewItems(). Duplicate keys change once. */
        keys: readonly string[];
        scope?: never;
        authors?: never;
      }
    | {
        keys?: never;
        /** Defaults to revisions shown by author visibility and the tracked-changes filter. */
        scope?: 'visible' | 'document';
        /** Only the changes these authors made, within `scope`. Matches `w:author` exactly. */
        authors?: readonly string[];
      }
  );

export type { ReviewDisplayMode } from '../layout/revision-projection.ts';

/**
 * How a keystroke reaches the document.
 *
 * `'suggesting'` changes what an edit MEANS rather than whether it is allowed: typing writes
 * `w:ins` and deleting writes `w:del` over the words it would have removed, so every change
 * arrives as a proposal somebody else accepts or rejects.
 */
export type DocumentEditingMode = 'editing' | 'suggesting' | 'viewing';
