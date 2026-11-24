// Whether the browser holds input the surface has not handled yet (Chromium's
// `navigator.scheduling.isInputPending`). Every other engine answers false, which keeps the
// surface on its synchronous paths.

/**
 * `includeContinuous` folds mousemove/wheel into the answer. Paint deferral wants that
 * (any input beats a repaint); the commit-tail LAYOUT deferral must not — a moving
 * pointer over a large document would otherwise defer every toolbar op, paste and
 * programmatic write, so that gate asks for discrete input (keys, clicks) only.
 */
export function browserInputPending(container: Element, includeContinuous = true): boolean {
  const scheduling = (
    container.ownerDocument.defaultView?.navigator as
      | (Navigator & {
          scheduling?: {
            isInputPending?: (options?: { includeContinuous?: boolean }) => boolean;
          };
        })
      | undefined
  )?.scheduling;
  return scheduling?.isInputPending?.({ includeContinuous }) ?? false;
}
