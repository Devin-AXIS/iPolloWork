import { getImHostLanguage } from '../../src/channels/shared/i18n.mjs';
import { rewriteInjectedContextMessages } from '../../src/channels/shared/injected-context.mjs';
import {
  IM_SOURCE_GUIDANCE_CONTEXT,
  IM_SOURCE_GUIDANCE_ORDER,
  imSourceGuidance,
} from '../../src/channels/shared/im-source-guidance.mjs';

/** Row label for a quoted reply, in the mirrored Host interface language. */
const REPLY_LABELS = Object.freeze({ zh: '\u5f15\u7528', en: 'Quoted' });

/** Row label for a source block that names no readable field of its own. */
const SOURCE_LABELS = Object.freeze({ zh: '\u6765\u6e90', en: 'Source' });

/** Row label prefix for one collected conversation-context block. */
const CONTEXT_LABELS = Object.freeze({ zh: '\u4e0a\u4e0b\u4e0b', en: 'Context' });

/** Read the current reply-row label; an unknown language falls back to English. */
function replyLabel() {
  try {
    return getImHostLanguage() === 'en' ? REPLY_LABELS.en : REPLY_LABELS.zh;
  } catch {
    return REPLY_LABELS.en;
  }
}

/** Read the current nameless-source-row label; unknown languages fall back. */
function sourceLabel() {
  try {
    return getImHostLanguage() === 'en' ? SOURCE_LABELS.en : SOURCE_LABELS.zh;
  } catch {
    return SOURCE_LABELS.en;
  }
}

/** Read the current context-row label; unknown languages fall back. */
function contextLabel() {
  try {
    return getImHostLanguage() === 'en' ? CONTEXT_LABELS.en : CONTEXT_LABELS.zh;
  } catch {
    return CONTEXT_LABELS.en;
  }
}

/**
 * Pair every injected context block with the user message that carried it, and
 * materialize the source guidance as session-level prompt context.
 *
 * The prompt RPC cannot carry a message source, so a channel writes its source
 * block, guidance and quoted reply into the prompt text. `agent/pre-step` is
 * the one point where the claimed messages are already known and nothing is
 * committed yet: splitting the blocks there records each as its own
 * plugin-sourced message next to exactly the user message it belongs to,
 * whatever the inbox interleaved meanwhile. A Host without the Agent loop never
 * dispatches the event, and the prompt then keeps its inline blocks.
 *
 * Guidance is not per message but per conversation, so it is registered as
 * dynamic prompt context instead: the Host appends one durable snapshot per
 * Session and only re-renders it when a channel publishes different guidance.
 * Deployment policy still decides whether such snapshots exist at all, which is
 * why the message-side copy is kept until a channel has published a matching
 * value for that Session.
 *
 * @param ctx - owning Host context.
 * @param options.logger - Host logger for a rewrite that could not be trusted.
 * @param options.registry - guidance registry; tests inject their own.
 * @returns the Cordis disposer, or null when the context cannot listen.
 */
export function installInjectedContext(ctx, { logger, registry = imSourceGuidance } = {}) {
  if (typeof ctx?.on !== 'function') return null;

  const startGuidanceContext = (promptCtx) => {
    if (typeof promptCtx?.systemPrompt?.context !== 'function') return null;
    return promptCtx.systemPrompt.context({
      name: IM_SOURCE_GUIDANCE_CONTEXT,
      order: IM_SOURCE_GUIDANCE_ORDER,
      text: (assembly) => registry.get(assembly?.agent?.session?.id) ?? '',
    });
  };
  if (typeof ctx.inject === 'function') {
    // Same gating the outbound artifact tool uses: register once the service
    // exists instead of requiring it at load time.
    ctx.inject(['systemPrompt'], startGuidanceContext);
  } else {
    startGuidanceContext(ctx);
  }

  const disposeDisposed = ctx.on('agent/disposed', ({ agent }) => {
    const sessionId = agent?.session?.id;
    if (typeof sessionId === 'string') registry.forget(sessionId);
  }, { global: true });

  const listener = async ({ agent }, next) => {
    const decision = await next();
    if (decision === null || typeof decision !== 'object' || decision.kind !== 'enter') {
      return decision;
    }
    try {
      const rewritten = rewriteInjectedContextMessages(decision.messages, {
        labels: { reply: replyLabel(), source: sourceLabel(), context: contextLabel() },
        ownedGuidance: registry.get(agent?.session?.id),
      });
      return rewritten === null ? decision : { ...decision, messages: rewritten };
    } catch (error) {
      // A failed split must never cost the user their message: the blocks then
      // stay inline, which is the same fallback a Host without Agents uses.
      logger?.warn?.('[dsh-im] unable to split the injected context blocks:', error?.message ?? error);
      return decision;
    }
  };
  const disposePreStep = ctx.on('agent/pre-step', listener, { global: true });
  return () => {
    disposePreStep?.();
    disposeDisposed?.();
  };
}
