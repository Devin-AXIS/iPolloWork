// The seam a host renders its own remote-caret labels through.
//
// The engine owns each label's element, geometry, class and presence colour, and rebuilds the
// labels wholesale on every repaint that moves them. A host owns only what goes INSIDE one,
// which is why these two types are the whole contract: an anchor says where, and a host says
// "tell me when the anchors change".

import type { CollaborationRemoteSelection } from '../collaboration/index.ts';

/**
 * One live remote-caret label the engine positioned. The host owns its content; the engine
 * still owns the label's geometry, class, and presence colour, and rebuilds the labels
 * wholesale on every repaint that moves them.
 *
 * @public
 */
export interface RemoteCaretLabelAnchor {
  readonly element: HTMLElement;
  readonly selection: CollaborationRemoteSelection;
}

/**
 * A host that renders its own content inside the engine's remote-caret labels.
 *
 * @public
 */
export interface RemoteCaretLabelHost {
  /**
   * Called after every paint that rebuilt the labels, with the current anchors.
   *
   * A skipped paint (nothing moved) does not re-publish: the host keeps its last anchors
   * until the next publish, and elements from a previous publish are dead after the next
   * one. An empty array is a real publish — every remote caret left the screen.
   *
   * Never mutate editor state synchronously from `publish` — a mutation repaints, and the
   * nested rebuild's publish would arrive before this one returned; only set host state.
   */
  publish(anchors: readonly RemoteCaretLabelAnchor[]): void;
}
