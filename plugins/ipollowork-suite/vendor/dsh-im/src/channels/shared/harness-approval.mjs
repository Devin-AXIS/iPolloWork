import { t } from './i18n.mjs';
import { evaluateInboundAccess } from './inbound-access.mjs';

const APPROVAL_REPLIES = new Map([
  ['批准', 'allowed-once'],
  ['同意', 'allowed-once'],
  ['yes', 'allowed-once'],
  ['拒绝', 'rejected'],
  ['不同意', 'rejected'],
  ['no', 'rejected'],
]);

export const COMPETITIVE_APPROVAL_CHANNELS = Object.freeze([
  'feishu', 'weixin', 'dingtalk', 'wecom', 'wecom-app', 'qq',
  'telegram', 'slack', 'discord', 'whatsapp', 'matrix',
]);

const APPROVAL_UNAVAILABLE_TEXT = '机器人端无法处理这次审批，请到 Web 查看。';
const APPROVAL_PROMPT = '请精准回复「批准」或「拒绝」（也支持：同意 / 不同意 / yes / no）。';
const APPROVAL_AFTER_QUESTION_PROMPT = '请先完成当前问题，再精准回复「批准」或「拒绝」。';
const APPROVAL_RESOLVED_TEXT = '该审批已处理，无需再次回复。';
const APPROVAL_TIMEOUT_TEXT = '审批已超时，已自动拒绝此次操作。';
const APPROVAL_TIMEOUT_UNCONFIRMED_TEXT = '审批已超时，正在自动拒绝，但暂未得到确认，稍后会自动重试。';
const DEFAULT_APPROVAL_TIMEOUT_MS = 60 * 60_000;
const EXPIRY_RETRY_BASE_MS = 30_000;
const EXPIRY_RETRY_MAX_MS = 5 * 60_000;
const RESOLVED_ROUTE_TTL_MS = 5 * 60_000;
const MAX_RESOLVED_ROUTES = 2_048;

/**
 * How a card-driven decision ended, so a channel card can tell "the decision is
 * in" from "still submitting", "try again" and "this card can never work again".
 *
 * A transient Host/RPC failure keeps the approval pending, which makes the
 * press retryable: the card must hand its keyboard back instead of staying
 * `claimed` forever behind a "still submitting" toast.
 */
export const APPROVAL_SUBMIT_RESULT = Object.freeze({
  /** The Host accepted the decision; the approval is gone from the queue. */
  SUBMITTED: 'submitted',
  /** Another decision is in flight; keep the card until its outcome is known. */
  BUSY: 'busy',
  /** Nothing was decided and the approval is still pending: press again. */
  RETRYABLE: 'retryable',
  /** The approval is no longer decidable here (resolved, expired, closed). */
  GONE: 'gone',
});

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function printableText(value) {
  return cleanText(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

export function harnessApprovalDecision(text) {
  return APPROVAL_REPLIES.get(cleanText(text).toLowerCase()) ?? null;
}

export function validHarnessApproval(payload) {
  return payload?.type === 'approval/requested'
    && Boolean(cleanText(payload.sessionId))
    && Boolean(cleanText(payload.approvalId))
    && Boolean(cleanText(payload.toolName))
    && (payload.callId === undefined || Boolean(cleanText(payload.callId)))
    && (payload.reason === undefined || typeof payload.reason === 'string');
}

function toolArguments(toolCall) {
  const source = toolCall?.arguments;
  if (source !== null && typeof source === 'object') {
    try {
      return JSON.stringify(source, null, 2);
    } catch {
      return null;
    }
  }
  if (typeof source !== 'string') return null;
  const raw = printableText(source);
  // Harness treats an empty tool argument string as an empty object.
  if (!raw) return source === '' ? '{}' : null;
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export function harnessApprovalText(payload, {
  toolCall,
  requiresMention = false,
  maxArgumentsLength = 6_000,
  hasButtons = false,
} = {}) {
  if (!validHarnessApproval(payload)) return null;
  const callId = cleanText(payload.callId);
  if (!callId
    || cleanText(toolCall?.callId) !== callId
    || cleanText(toolCall?.name) !== cleanText(payload.toolName)) return null;
  const operation = toolArguments(toolCall);
  if (!operation || operation.length > maxArgumentsLength) return null;

  const lines = [
    t('DeepSeek Harness 需要你的审批：'),
    '',
    t('工具：{tool}', { tool: printableText(payload.toolName) }),
    t('操作参数：'),
    operation,
  ];
  const reason = printableText(payload.reason);
  if (reason) lines.push(t('原因：{reason}', { reason }));
  // A button card carries the intent itself: asking the user to type a decision
  // (or to @ the bot in a group) would be misleading next to the buttons. The
  // plain-text path below stays byte-identical to what it has always sent.
  if (!hasButtons) {
    lines.push('', t(APPROVAL_PROMPT));
    if (requiresMention) lines.push('', t('群聊中请 @机器人 后发送审批决定。'));
  }
  return lines.join('\n');
}

function approvalResult(pending, outcome) {
  return {
    ok: true,
    value: {
      sessionId: pending.sessionId,
      approvalId: pending.approvalId,
      outcome,
    },
  };
}

function approvalOutcomeText(outcome) {
  if (outcome === 'expired') return t(APPROVAL_TIMEOUT_TEXT);
  if (outcome === 'unavailable') return t(APPROVAL_UNAVAILABLE_TEXT);
  if (outcome === 'allowed-once') return t('已批准，仅对本次操作有效。');
  if (outcome === 'rejected') return t('已拒绝此次操作。');
  return t(APPROVAL_RESOLVED_TEXT);
}

export class HarnessApprovalQueue {
  #label;
  #logger;
  #byId = new Map();
  #routes = new Map();
  #resolvedRoutes = new Map();
  #approvalTimeoutMs;

  constructor({ label = 'IM', logger = console, approvalTimeoutMs = DEFAULT_APPROVAL_TIMEOUT_MS } = {}) {
    this.#label = label;
    this.#logger = logger;
    this.#approvalTimeoutMs = Number.isFinite(approvalTimeoutMs) && approvalTimeoutMs > 0
      ? approvalTimeoutMs
      : DEFAULT_APPROVAL_TIMEOUT_MS;
  }

  hasPending(key) {
    return this.#routes.get(key)?.items.some((pending) => !pending.inactive) === true;
  }

  /**
   * Reject the active approvals of one route: the sender moved on to a new
   * addressed request instead of deciding the tool call, and the conversation
   * must not wait behind a decision that is not coming.
   * @param {string} key The route key.
   * @returns {Promise<number>} How many approvals were rejected.
   */
  async rejectRoute(key) {
    const route = this.#routes.get(key);
    if (!route) return 0;
    let rejected = 0;
    for (const pending of [...route.items]) {
      if (pending.inactive || pending.resolving) continue;
      await this.#submit(pending, 'rejected').catch(() => undefined);
      rejected += 1;
    }
    return rejected;
  }

  claimReply({
    key,
    actor,
    text,
    addressed = true,
    hasPendingQuestion = false,
    questionCompletion,
    isQuestionPending,
    send,
  }) {
    const route = this.#routes.get(key);
    const pending = route?.items[0];
    const decision = harnessApprovalDecision(text);
    const notice = (value, resolved = false) => ({
      ...(resolved ? { resolved: true } : {}),
      process: async (before) => {
        if (typeof before === 'function' && await before() === false) return;
        await send(value);
      },
    });
    // Match Harness' own interaction precedence: a live ask_user_question
    // outranks sibling approvals. Otherwise a question answer such as "yes"
    // could accidentally authorize a tool call.
    const deferredByQuestion = hasPendingQuestion
      && pending
      && questionCompletion
      && typeof questionCompletion.then === 'function';
    if (hasPendingQuestion && !deferredByQuestion) return null;
    if (!pending || pending.inactive) {
      const resolvedUntil = this.#resolvedRoutes.get(key) ?? 0;
      if (resolvedUntil <= Date.now()) {
        this.#resolvedRoutes.delete(key);
        return null;
      }
      if (!decision) return null;
      return notice(t(APPROVAL_RESOLVED_TEXT), true);
    }
    if (pending.actor !== actor || (pending.requiresMention && addressed !== true)) {
      if (!decision) return null;
      return notice(t('只有发起当前任务的用户可以处理这条审批。'));
    }

    return {
      process: async (before) => {
        const presentedWhenClaimed = pending.presented;
        const previous = pending.replyTail ?? Promise.resolve();
        const task = previous
          .catch(() => undefined)
          .then(async () => {
            if (typeof before === 'function' && await before() === false) return;
            if (deferredByQuestion) {
              await questionCompletion.catch(() => undefined);
              if (pending.inactive || pending.resolving) return;
              if (typeof isQuestionPending === 'function' && isQuestionPending()) {
                await send(t(APPROVAL_AFTER_QUESTION_PROMPT));
                return;
              }
            }
            await pending.activationTask?.catch(() => undefined);
            await pending.presentationTask?.catch(() => undefined);
            if (!pending.inactive && pending.expiring) {
              await send(t(APPROVAL_TIMEOUT_UNCONFIRMED_TEXT));
              return;
            }
            if (pending.inactive || pending.resolving) {
              await send(t(APPROVAL_RESOLVED_TEXT));
              return;
            }
            pending.send = send;
            // Never turn a decision sent before the operation was visibly
            // presented into an approval. This also covers a failed presentation
            // and the small FIFO promotion window before the next item is shown.
            if (!presentedWhenClaimed || !pending.presented) {
              if (!pending.presented) await this.#present(pending);
              if (pending.inactive || pending.resolving) return;
              await send(t(APPROVAL_PROMPT));
              return;
            }
            if (pending.submitting) {
              await send(t('审批决定正在提交，请稍候。'));
              return;
            }
            if (!decision) {
              // A button card already tells the user how to decide; repeating
              // the type-the-decision prompt would contradict its buttons.
              if (!pending.interactiveCard) await send(t(APPROVAL_PROMPT));
              return;
            }
            await this.#submit(pending, decision);
          });
        pending.replyTail = task;
        try {
          await task;
        } finally {
          if (pending.replyTail === task) pending.replyTail = null;
        }
      },
    };
  }

  /** Present a bound private-chat approval without creating an IM prompt. */
  async handleSessionSyncRequested(interaction, context, { signal, completion, runtimeSignal, accessPolicy } = {}) {
    if (signal?.aborted || runtimeSignal?.aborted) return false;
    const validateRoute = context.validate;
    context = { ...context, validate: async () => {
      await validateRoute?.();
      if (!context.actor || !evaluateInboundAccess(accessPolicy, {
        conversationType: 'direct', senderIds: [context.actor], text: 'yes',
      }).allowed) throw new Error('Approval recipient is no longer allowed');
    } };
    await context.validate();
    if (signal?.aborted || runtimeSignal?.aborted) return false;
    let resolved = false;
    const finish = (outcome) => this.handleResolved({
      kind: 'approval', interactionId: interaction.interactionId, outcome,
    });
    const onStop = () => {
      queueMicrotask(async () => {
        if (resolved) return;
        try {
          await interaction.withdraw?.();
          await finish('unavailable');
        } catch (error) {
          this.#logger.warn?.(`[dsh-im:${this.#label}] failed to withdraw a stopped approval:`, error);
        }
      });
    };
    runtimeSignal?.addEventListener('abort', onStop, { once: true });
    Promise.resolve(completion).then(async (outcome) => {
      resolved = true;
      runtimeSignal?.removeEventListener('abort', onStop);
      await finish(outcome);
    }).catch((error) => this.#logger.warn?.(`[dsh-im:${this.#label}] failed to retire a synced approval:`, error));
    try {
      await this.handleRequested(interaction, context);
      if (runtimeSignal?.aborted) onStop();
      return this.#byId.has(interaction.interactionId);
    } catch (error) {
      runtimeSignal?.removeEventListener('abort', onStop);
      await interaction.withdraw?.();
      await finish('unavailable');
      throw error;
    }
  }

  async handleRequested(interaction, context) {
    if (interaction?.kind !== 'approval') return false;
    const payload = interaction.payload;
    const approvalId = cleanText(payload?.approvalId);
    if (!cleanText(interaction.rpcId)
      || !cleanText(interaction.sessionId)
      || !approvalId
      || !validHarnessApproval(payload)
      || payload.sessionId !== interaction.sessionId
      || typeof interaction.respond !== 'function') {
      this.#logger.warn?.(`[dsh-im:${this.#label}] ignored an invalid Harness approval`);
      return true;
    }

    if (interaction.recovered === true) {
      await this.#rejectInteraction(interaction, payload);
      return true;
    }

    const existing = this.#byId.get(approvalId);
    if (existing) {
      existing.interaction = interaction;
      existing.toolCall = interaction.toolCall;
      if (!existing.presented) await this.#present(existing);
      return true;
    }

    const send = context?.send;
    const key = cleanText(context?.key);
    const actor = cleanText(context?.actor);
    if (!key || !actor || typeof send !== 'function') {
      this.#logger.warn?.(`[dsh-im:${this.#label}] ignored an approval without a reply route`);
      await this.#rejectInteraction(interaction, payload);
      return true;
    }
    // Optional channel-provided renderer. When present, the approval is shown
    // as an interactive card (e.g. Feishu approve/reject buttons) instead of
    // plain text. Channels that don't provide one keep the text-reply path.
    const render = typeof context?.render === 'function' ? context.render : null;

    const text = harnessApprovalText(payload, {
      toolCall: interaction.toolCall,
      requiresMention: context.requiresMention === true,
    });
    if (!text) {
      const rejected = await this.#rejectInteraction(interaction, payload);
      await send(rejected
        ? (interaction.withdraw ? t(APPROVAL_UNAVAILABLE_TEXT) : t('无法完整展示这次操作，已安全拒绝此次审批。'))
        : t(APPROVAL_RESOLVED_TEXT));
      return true;
    }

    const pending = {
      approvalId,
      sessionId: interaction.sessionId,
      interaction,
      toolCall: interaction.toolCall,
      key,
      actor,
      requiresMention: context.requiresMention === true,
      send,
      render,
      validate: context.validate,
      onResolved: typeof context.onResolved === 'function' ? context.onResolved : null,
      text,
      presented: false,
      presentationTask: null,
      deliveryCompleted: false,
      replyTail: null,
      submitting: false,
      // Set by a channel renderer once an interactive card really reached the
      // user. It means the card owns the decision guidance and the receipt, so
      // the plain-text prompts/receipts below must stay quiet.
      interactiveCard: false,
      inactive: false,
      resolving: false,
      closedOutcome: null,
      resolutionNotified: false,
      activationTask: null,
      timeoutTimer: null,
      expired: false,
      expiring: false,
      expiryAttempts: 0,
      expiryNoticeSent: false,
    };
    this.#byId.set(approvalId, pending);
    const route = this.#routes.get(key) ?? { items: [] };
    route.items.push(pending);
    this.#routes.set(key, route);
    pending.timeoutTimer = setTimeout(() => {
      void this.#expire(pending).catch((error) => {
        this.#logger.warn?.(`[dsh-im:${this.#label}] failed to expire an approval:`, error);
      });
    }, this.#approvalTimeoutMs);
    pending.timeoutTimer.unref?.();
    if (route.items[0] === pending) await this.#present(pending);
    return true;
  }

  /**
   * Submit an approval decision by id, as triggered by a channel card button
   * (e.g. Feishu approve/reject). Returns false when no matching pending
   * approval is found. Callers may pass the acting user to enforce that only
   * the originating actor can decide.
   *
   * Pass `{ detailed: true }` to get an {@link APPROVAL_SUBMIT_RESULT} instead of
   * a boolean: an interactive card has to tell a retryable submission failure
   * apart from an in-flight decision, one that landed, or an invalid card.
   */
  async submitByApprovalId(approvalId, outcome, { actor, detailed = false } = {}) {
    const pending = this.#byId.get(cleanText(approvalId));
    const gone = detailed ? APPROVAL_SUBMIT_RESULT.GONE : false;
    if (!pending || pending.inactive || pending.resolving) return gone;
    if (actor !== undefined && pending.actor !== actor) return gone;
    if (pending.submitting) return detailed ? APPROVAL_SUBMIT_RESULT.BUSY : false;
    const result = await this.#submit(pending, outcome);
    if (!detailed) return true;
    return result ?? APPROVAL_SUBMIT_RESULT.RETRYABLE;
  }

  async handleResolved(resolution) {
    if (resolution?.kind !== 'approval') return false;
    const pending = this.#byId.get(cleanText(resolution.interactionId));
    if (!pending) return true;
    // A queued item may already be the next route head while the previous
    // item's confirmation is still in flight. Preserve that route barrier so
    // resolving this item cannot expose a later approval out of order.
    pending.resolving = true;
    if (pending.activationTask) {
      await pending.activationTask.catch(() => undefined);
    }
    if (pending.inactive || this.#byId.get(pending.approvalId) !== pending) return true;
    const presentationTask = pending.presentationTask;
    const shouldNotify = pending.presented || presentationTask;
    const send = pending.send;
    const next = this.#remove(pending);
    // The host reports our own timeout rejection as a plain rejection.
    const outcome = pending.expiring && resolution.outcome === 'rejected' ? 'expired' : resolution.outcome;
    await this.#transition(next, async () => {
      let delivered = pending.presented;
      if (presentationTask) {
        delivered = await presentationTask.then(() => true, () => false);
      }
      if (shouldNotify && delivered) {
        await this.#notifyResolved(pending, outcome, send);
      }
    });
    return true;
  }

  async closeRoute(key) {
    const route = this.#routes.get(key);
    if (!route) return;
    const pendingItems = [...route.items];
    for (const pending of pendingItems) this.#remove(pending);
    await Promise.all(pendingItems.map(async (pending) => {
      try {
        if (pending.interaction.withdraw) await pending.interaction.withdraw();
        else await pending.interaction.respond(
          approvalResult(pending, 'rejected'),
          { signal: AbortSignal.timeout(5_000) },
        );
        pending.closedOutcome = pending.interaction.withdraw ? 'unavailable' : 'rejected';
        if (pending.presented || pending.deliveryCompleted) {
          await this.#notifyResolved(pending, pending.closedOutcome);
        }
      } catch (error) {
        if (error?.code === 'interaction-not-pending') {
          pending.closedOutcome = 'resolved';
          if (pending.presented || pending.deliveryCompleted) {
            await this.#notifyResolved(pending, 'resolved');
          }
        } else {
          this.#logger.warn?.(`[dsh-im:${this.#label}] failed to reject a closing approval:`, error);
        }
      }
    }));
  }

  async #present(pending) {
    if (this.#routes.get(pending.key)?.items[0] !== pending
      || pending.inactive || pending.resolving || pending.presented) return;
    await pending.activationTask?.catch(() => undefined);
    if (this.#routes.get(pending.key)?.items[0] !== pending
      || pending.inactive || pending.resolving || pending.presented) return;
    if (pending.presentationTask) return pending.presentationTask;
    // A channel-provided renderer shows the approval as an interactive card
    // (e.g. approve/reject buttons); otherwise fall back to plain text.
    const task = Promise.resolve().then(async () => {
      await pending.validate?.();
      if (pending.inactive || pending.resolving) return;
      if (pending.render) await pending.render(pending, pending.send);
      else await pending.send(pending.text);
    });
    pending.presentationTask = task;
    try {
      await task;
      pending.deliveryCompleted = true;
      if (!pending.inactive) {
        pending.presented = true;
      } else if (pending.closedOutcome) {
        await this.#notifyResolved(pending, pending.closedOutcome);
      }
    } catch (error) {
      if (!pending.interaction.withdraw) throw error;
      pending.presentationTask = null;
      await pending.interaction.withdraw();
      await this.handleResolved({ kind: 'approval', interactionId: pending.approvalId, outcome: 'unavailable' });
      this.#logger.warn?.(`[dsh-im:${this.#label}] approval presentation unavailable:`, error);
    } finally {
      if (pending.presentationTask === task) pending.presentationTask = null;
    }
  }

  async #expire(pending) {
    pending.timeoutTimer = null;
    pending.expired = true;
    // An in-flight decision wins; #submit expires the approval if it fails.
    if (pending.inactive || pending.resolving || pending.submitting) return;
    pending.resolving = true;
    pending.expiring = true;
    // Keep the route barrier: an earlier confirmation must finish before a
    // later approval can be presented.
    await pending.activationTask?.catch(() => undefined);
    if (pending.inactive || this.#byId.get(pending.approvalId) !== pending) return;
    await this.#releaseExpired(pending);
  }

  async #releaseExpired(pending) {
    pending.timeoutTimer = null;
    if (pending.inactive) return;
    let outcome = 'expired';
    try {
      // Reject rather than withdraw: a withdrawal only retires the IM side and
      // would leave a shared Web approval waiting without a bound.
      await pending.interaction.respond(
        approvalResult(pending, 'rejected'),
        { signal: AbortSignal.timeout(5_000) },
      );
    } catch (error) {
      if (error?.code !== 'interaction-not-pending') {
        if (pending.inactive) return;
        this.#logger.warn?.(`[dsh-im:${this.#label}] failed to release an expired approval:`, error);
        this.#retryExpiry(pending);
        if (!pending.expiryNoticeSent && pending.presented) {
          pending.expiryNoticeSent = true;
          await pending.send(t(APPROVAL_TIMEOUT_UNCONFIRMED_TEXT)).catch(() => undefined);
        }
        return;
      }
      outcome = 'resolved';
    }
    if (pending.inactive) return;
    const presentationTask = pending.presentationTask;
    const shouldNotify = pending.presented || presentationTask;
    const send = pending.send;
    const next = this.#remove(pending);
    pending.closedOutcome = outcome;
    await this.#transition(next, async () => {
      let delivered = pending.presented;
      if (presentationTask) {
        delivered = await presentationTask.then(() => true, () => false);
      }
      if (shouldNotify && delivered) await this.#notifyResolved(pending, outcome, send);
    });
  }

  #retryExpiry(pending) {
    const delay = Math.min(EXPIRY_RETRY_BASE_MS * 2 ** pending.expiryAttempts, EXPIRY_RETRY_MAX_MS);
    pending.expiryAttempts += 1;
    pending.timeoutTimer = setTimeout(() => {
      void this.#releaseExpired(pending).catch((error) => {
        this.#logger.warn?.(`[dsh-im:${this.#label}] failed to expire an approval:`, error);
      });
    }, delay);
    pending.timeoutTimer.unref?.();
  }

  async #submit(pending, outcome) {
    pending.submitting = true;
    try {
      if (pending.validate) {
        try { await pending.validate(); }
        catch (error) {
          await pending.interaction.withdraw?.();
          throw Object.assign(new Error('Approval route is no longer available', { cause: error }), {
            code: 'interaction-not-pending',
          });
        }
      }
      await pending.interaction.respond(approvalResult(pending, outcome));
    } catch (error) {
      if (error?.code === 'interaction-not-pending') {
        const send = pending.send;
        const next = this.#remove(pending);
        await this.#transition(next, async () => {
          await this.#notifyResolved(pending, 'resolved', send);
        });
        return APPROVAL_SUBMIT_RESULT.GONE;
      }
      if (pending.inactive) return APPROVAL_SUBMIT_RESULT.GONE;
      pending.submitting = false;
      this.#logger.error?.(`[dsh-im:${this.#label}] failed to submit an approval:`, error);
      // The deadline passed while this decision was in flight.
      if (pending.expired) {
        await this.#expire(pending);
        return APPROVAL_SUBMIT_RESULT.GONE;
      }
      await pending.send(t('审批提交失败，请重新回复「批准」或「拒绝」。')).catch(() => undefined);
      // The approval is still pending: the caller may offer the press again.
      return APPROVAL_SUBMIT_RESULT.RETRYABLE;
    }

    const send = pending.send;
    const next = this.#remove(pending);
    await this.#transition(next, async () => {
      await this.#notifyResolved(pending, outcome, send);
    });
    return APPROVAL_SUBMIT_RESULT.SUBMITTED;
  }

  async #notifyResolved(pending, outcome, send = pending.send) {
    if (pending.resolutionNotified) return;
    // Claim notification before awaiting the channel, so a concurrent close or
    // resolved event cannot replace the confirmed result or notify twice.
    pending.resolutionNotified = true;
    const text = approvalOutcomeText(outcome);
    let deliveredByPresentation = false;
    try {
      // A card renderer returns true when it already edited the original message
      // into the receipt; the separate terminal text would then be a duplicate
      // (and the pending.send may have been swapped by an interim text reply).
      deliveredByPresentation = (await pending.onResolved?.(text, outcome)) === true;
    } catch (error) {
      this.#logger.warn?.(`[dsh-im:${this.#label}] failed to update a resolved approval:`, error);
    }
    if (deliveredByPresentation) return;
    await send(text).catch(() => undefined);
  }

  async #transition(next, work) {
    let release;
    const barrier = new Promise((resolve) => { release = resolve; });
    if (next) next.activationTask = barrier;
    try {
      await work();
    } finally {
      release();
      if (next?.activationTask === barrier) next.activationTask = null;
    }
    await this.#promote(next);
  }

  async #promote(pending) {
    if (!pending) return;
    try {
      await this.#present(pending);
    } catch (error) {
      this.#logger.error?.(
        `[dsh-im:${this.#label}] failed to present the next approval:`,
        error,
      );
      try {
        pending.interaction.reconnect?.();
      } catch {
        // A replay will retry presentation when the transport can reconnect.
      }
    }
  }

  #remove(pending) {
    if (pending.inactive) return null;
    pending.inactive = true;
    if (pending.timeoutTimer) {
      clearTimeout(pending.timeoutTimer);
      pending.timeoutTimer = null;
    }
    this.#rememberResolvedRoute(pending.key);
    this.#byId.delete(pending.approvalId);
    const route = this.#routes.get(pending.key);
    if (!route) return null;
    const wasCurrent = route.items[0] === pending;
    const index = route.items.indexOf(pending);
    if (index !== -1) route.items.splice(index, 1);
    if (route.items.length === 0) {
      this.#routes.delete(pending.key);
      return null;
    }
    return wasCurrent ? route.items[0] : null;
  }

  #rememberResolvedRoute(key) {
    const now = Date.now();
    for (const [routeKey, expiresAt] of this.#resolvedRoutes) {
      if (expiresAt <= now) this.#resolvedRoutes.delete(routeKey);
    }
    this.#resolvedRoutes.delete(key);
    this.#resolvedRoutes.set(key, now + RESOLVED_ROUTE_TTL_MS);
    while (this.#resolvedRoutes.size > MAX_RESOLVED_ROUTES) {
      this.#resolvedRoutes.delete(this.#resolvedRoutes.keys().next().value);
    }
  }

  async #rejectInteraction(interaction, payload) {
    try {
      if (interaction.withdraw) {
        await interaction.withdraw();
        return true;
      }
      await interaction.respond({
        ok: true,
        value: {
          sessionId: interaction.sessionId,
          approvalId: payload.approvalId,
          outcome: 'rejected',
        },
      }, { signal: AbortSignal.timeout(5_000) });
      return true;
    } catch (error) {
      if (error?.code === 'interaction-not-pending') return false;
      throw error;
    }
  }
}
