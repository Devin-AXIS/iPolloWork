# Artifact Card Hit Testing Design

## Goal

Keep the session transcript's visual scroll position and its DOM hit-test
position synchronized so an artifact card such as `entry.html` opens when the
user clicks the visible card.

## Cause

The transcript restores a persisted manual `scrollTop` by assigning the value
directly to the scroll container. In the affected Electron/WebView flow, the
compositor can retain a different visual offset from the DOM layout offset.
The card is painted on screen, but its DOM rectangle is outside the viewport,
so pointer input targets content at a different transcript position.

## Design

Centralize programmatic transcript positioning in a helper that scrolls a
short-lived, invisible DOM anchor into view. The helper clamps the requested
offset to the actual scroll range, positions the anchor at that offset, calls
`scrollIntoView`, and removes the anchor immediately. Unlike pixel-based
`scrollTop` and `scrollTo` updates, this is a tested Electron path that
synchronizes the compositor's visual layer with DOM hit testing.

The helper becomes the only path used by the session scroll controller for:

- jumping to the latest message;
- performing the animation-frame confirmation for that jump; and
- restoring a saved manual transcript position on session selection.

The helper preserves existing sticky/manual scroll-store semantics and does
not change the artifact-card component or preview routing. A unit regression
test verifies the transient anchor path is used for immediate and smooth
programmatic positions, which protects the Electron compositor synchronization
contract.

## Validation

1. The regression test fails before the helper exists because direct
   `scrollTop` assignment remains in the controller.
2. The test passes after the controller exclusively uses the helper.
3. In the running Electron application, bring `entry.html` into view, click
   the visible card using pointer input, and assert that the right-side
   artifact tab is visible.
