// The loading indicator below the laid-out pages while a large document lays out the rest.
//
// The sliced open shows the first pages, which take input, while the rest are laid out (see
// `surface-progressive-open.ts`). The indicator is a real element in the band below the last
// laid-out page, a sibling of the pages layer: the page painter removes children it did not
// paint, and the element scrolls with the document because it lives in the same container. It
// holds the packaged spinner until a host takes it over with `setOpeningIndicatorHost`.

/**
 * Receives the element that shows the loading indicator below the laid-out pages, while a
 * large document lays out its remaining pages.
 *
 * @example
 * ```ts
 * editor.setOpeningIndicatorHost({
 *   publish(element) {
 *     // Render your indicator into `element`, or remove it when `element` is null.
 *   },
 * });
 * ```
 *
 * @public
 */
export interface OpeningIndicatorHost {
  /**
   * Called with the indicator element when the first pages show, and with `null` when the
   * remaining pages are laid out or the open is abandoned. The element is empty while a host
   * is set: render the host's content into it. It is centered in a band below the last
   * laid-out page, as wide as the page, and scrolls with the document.
   */
  publish(element: HTMLElement | null): void;
}

interface OpeningIndicator {
  readonly frame: HTMLElement;
  readonly status: HTMLElement;
  host: OpeningIndicatorHost | null;
}

const indicators = new WeakMap<object, OpeningIndicator>();

/** The height of the band below the laid-out pages that holds the indicator. */
const OPENING_INDICATOR_BAND_PX = 96;

function showPackagedSpinner(indicator: OpeningIndicator): void {
  if (indicator.host) {
    indicator.status.replaceChildren();
    return;
  }
  const spinner = indicator.status.ownerDocument.createElement('span');
  spinner.className = 'docx-editor__loading-spinner';
  spinner.setAttribute('aria-hidden', 'true');
  indicator.status.replaceChildren(spinner);
}

/**
 * Put the indicator below `container`'s laid-out pages while `surface` opens. Answers `place`,
 * which follows the pages after a paint, and `remove`, which ends the indicator. The element
 * moves with the surface's other children when the surface moves to another host.
 */
export function showOpeningIndicator(
  surface: object,
  container: HTMLElement
): { place(): void; remove(): void } {
  const document = container.ownerDocument;
  const frame = document.createElement('div');
  frame.className = 'docx-opening-indicator';
  frame.contentEditable = 'false';
  const status = document.createElement('div');
  status.className = 'docx-editor__loading-page-status';
  status.setAttribute('role', 'status');
  frame.append(status);
  const indicator: OpeningIndicator = { frame, status, host: null };
  indicators.set(surface, indicator);
  showPackagedSpinner(indicator);
  const place = (): void => {
    const pages = frame.parentElement?.querySelector<HTMLElement>(':scope > .docx-pages');
    const page = pages?.querySelector<HTMLElement>(':scope > .docx-page');
    frame.hidden = !pages || !page;
    if (!pages || !page) return;
    // Below the last laid-out page, where the next pages will appear: inline boxes, no
    // layout read.
    frame.style.left = page.style.left;
    frame.style.top = pages.style.height;
    frame.style.width = page.style.width;
    frame.style.height = `${OPENING_INDICATOR_BAND_PX}px`;
  };
  container.append(frame);
  place();
  return {
    place,
    remove: () => {
      if (indicators.get(surface) !== indicator) return;
      indicators.delete(surface);
      frame.remove();
      indicator.host?.publish(null);
    },
  };
}

/**
 * Hand the indicator's content to `host`, or give it back to the packaged spinner with
 * `null`. Does nothing when `surface` is not opening; the facade applies the host to each
 * surface it mounts.
 */
export function setOpeningIndicatorHost(surface: object, host: OpeningIndicatorHost | null): void {
  const indicator = indicators.get(surface);
  if (!indicator || indicator.host === host) return;
  const previous = indicator.host;
  indicator.host = host;
  previous?.publish(null);
  showPackagedSpinner(indicator);
  host?.publish(indicator.status);
}
