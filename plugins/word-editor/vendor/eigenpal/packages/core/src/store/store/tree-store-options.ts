// Construction and transaction options of the tree document store.

import type { FieldResultsMode } from '../package/field-result-mode.ts';
import type { ContentLockPolicy } from '../package/ooxml-edit.ts';
import type { OoxmlPart } from '../package/ooxml-tree.ts';
import type { OoxmlPackage } from '../package/ooxml-package.ts';
import { settingsPartOf } from '../package/note-properties.ts';
import { placeholderTextOf } from '../package/building-blocks.ts';
import type { HistoryGroup } from './history-group.ts';
import type { ImpactClass } from './tree-op-types.ts';
import type { TreeStoryRef } from './tree-store.ts';

/** How one transaction behaves: its story scope, its attribution, and its selection marks. */
export interface TransactOptions {
  readonly origin?: string;
  /** Stable actor attribution for collaboration and audit correlation. */
  readonly actorId?: string;
  /** Stable constituent identity for collaboration duplicate correlation. */
  readonly operationId?: string;
  /**
   * Whether this transaction enters the legacy snapshot undo stack.
   *
   * Collaboration commits set this to false because their actor-local undo authority is the
   * CRDT undo manager. Omitted preserves the ordinary non-collaborative history behavior.
   */
  readonly recordsHistory?: boolean;
  /**
   * A COMMAND is one user intent that may need several ops (a toolbar click applying a
   * property across a multi-run selection). It is still exactly one history entry, which is
   * the same rule a plain transaction follows — the option exists to say so explicitly at
   * the call site rather than leaving it implied.
   */
  readonly scope?: 'transaction' | 'command';
  /**
   * Floor on the published impact. Header/footer story edits use `global` so every page
   * sharing the part invalidates rather than keeping stale furniture.
   */
  readonly minimumImpact?: ImpactClass;
  /** Story identity stamped onto the published ModelChange (package-aware targeting). */
  readonly story?: TreeStoryRef;
  /**
   * The gesture this transaction belongs to: consecutive transactions carrying the SAME
   * token extend one history entry (package from before the first, selection after the
   * latest). Another token, none, undo or redo closes the group. See {@link HistoryGroup}.
   */
  readonly historyGroup?: HistoryGroup;
  /**
   * How the transaction's ops address saved field results. `atomic` (the default) keeps
   * every field one offset unit; `editable` addresses saved results as text. See
   * `field-result-mode.ts`.
   */
  readonly fieldResults?: FieldResultsMode;
}

/** How a store is constructed: its limits, its history depth, and its identity source. */
export interface TreeDocumentStoreOptions {
  /** Bound on retained history entries. Oldest entries drop first. */
  readonly historyLimit?: number;
  /**
   * The document's `settings.xml`, for a store built from a PART rather than a package.
   *
   * Forms protection lives one part up from the op, and a store built from a part gets a
   * synthetic one-part package that cannot see it — so `w:documentProtection w:edit="forms"`
   * was enforced in the body and nowhere else, and a header, a footer or a note accepted every
   * write a protected document is supposed to refuse. Read through a getter, not captured: a
   * document can gain or lose protection while its stories stay open.
   */
  readonly settingsPart?: () => OoxmlPart | null | undefined;
  /**
   * Opt-in relaxation of `w:lock` for run-property writes. See {@link ContentLockPolicy};
   * absent, `contentLocked` and `sdtContentLocked` refuse formatting like any other write.
   */
  readonly contentLockPolicy?: ContentLockPolicy;
  /**
   * The glossary prompt a control's `w:placeholder/w:docPart` names, for a store built from
   * a PART. Its synthetic package holds no glossary, so an emptied control in a header or a
   * note would show the type's default prompt instead of the document's own.
   *
   * @internal
   */
  readonly placeholderText?: (docPart: string) => string | undefined;
}

/**
 * What the body and every story store of one package open with. `settingsPart` is the SAME
 * live getter for all of them: a story store is built from a PART, whose synthetic package holds
 * no `settings.xml`, and a store keeps its own working copy, so a replaced `settings.xml` left one
 * story reading stale protection. Protection that holds in a header but not the body is worse
 * than none: it looks enforced. The lock policy and the glossary prompts reach every story for
 * the same reason.
 */
export function storyStoreOptionsFor(
  pkg: () => OoxmlPackage,
  historyLimit: number,
  contentLockPolicy: ContentLockPolicy | undefined
): TreeDocumentStoreOptions {
  return {
    historyLimit,
    settingsPart: () => settingsPartOf(pkg()),
    placeholderText: (docPart) => placeholderTextOf(pkg(), docPart),
    ...(contentLockPolicy ? { contentLockPolicy } : {}),
  };
}
