/**
 * A peer's presence color is attacker-controlled: it arrives over awareness from whoever is in
 * the room, and the engine paints it into a CSS custom property that the stylesheet consumes in
 * a `background` shorthand. A custom property substitutes verbatim, so `url(...)` is a valid
 * `<bg-image>` there — an unvalidated color is a zero-click GET to any host the peer names, on
 * every replica that paints their caret. A length cap does not help: `url(//host/t)` is short.
 *
 * So the only colors that reach a style property are the two shapes this engine itself produces:
 * a hex literal, or a reference to one of the review author slots the core stylesheet owns.
 * Anything else is dropped and the caller falls back to the accent color.
 */

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * `var(--doc-review-author-N)` and nothing else: no fallback argument, because a fallback is
 * attacker-controlled content in the same position (`var(--x, url(...))`).
 */
const AUTHOR_SLOT_COLOR = /^var\(--doc-review-author-[0-9]{1,2}\)$/;

/**
 * Return `value` when it is a color this engine can safely paint, otherwise `undefined`.
 *
 * @public
 */
export function safeParticipantColor(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value.length > 64) return undefined;
  if (HEX_COLOR.test(value)) return value;
  if (AUTHOR_SLOT_COLOR.test(value)) return value;
  return undefined;
}
