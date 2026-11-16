/** Keep provider protocol notices out of the suite's task conversation. */
import type { ClientContext } from "./native.ts";

/** Replace the technical truncation row while the suite is mounted.
 * @param ctx Native client plugin lifetime.
 */
export function mountOutputContinuationPresentation(ctx: ClientContext): void {
  ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
    name: "conversation.chat.node", key: "turn-max-tokens", priority: -100,
  }, () => null));
}
