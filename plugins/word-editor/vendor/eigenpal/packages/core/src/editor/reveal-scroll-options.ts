import type { ScrollToAnchorOptions } from '../contracts/editor.ts';
import type { RevealOptions } from './paginated-surface-contract.ts';

/**
 * Validate host scroll settings and apply reduced motion. `scrollToAnchor` and
 * `navigateToChange` share this, so one options object behaves the same in both.
 */
export function revealScrollOptions(
  options: ScrollToAnchorOptions,
  defaultBlock: NonNullable<ScrollToAnchorOptions['block']>,
  container: HTMLElement | null
): RevealOptions {
  const block = options.block ?? defaultBlock;
  const behavior = options.behavior ?? 'instant';
  const offsetPx = options.offsetPx ?? 24;
  if (!['start', 'center', 'centerIfNeeded', 'nearest'].includes(block))
    throw new TypeError('block must be start, center, centerIfNeeded, or nearest.');
  if (!['instant', 'smooth'].includes(behavior))
    throw new TypeError('behavior must be instant or smooth.');
  if (!Number.isFinite(offsetPx) || offsetPx < 0)
    throw new RangeError('offsetPx must be finite and nonnegative.');
  const reduced =
    container?.ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)')
      .matches ?? false;
  return { block, offsetPx, behavior: reduced ? 'instant' : behavior };
}
