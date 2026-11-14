import { t } from '../shared/i18n.mjs';
import {
  ACTION_CARD_STATUS,
  ActionCardRegistry,
  actionCardStateText,
  createCallbackNamespace,
} from '../shared/action-card.mjs';
import { harnessApprovalText, APPROVAL_SUBMIT_RESULT } from '../shared/harness-approval.mjs';

/**
 * Telegram approval buttons on top of the shared HarnessApprovalQueue `render`
 * hook and the shared action-card foundation.
 *
 * A press is handled in this order, which is the whole safety story:
 *   1. answerCallbackQuery first (the spinner stops even when the press loses);
 *   2. actor check (only the user who started the turn can decide; a stranger
 *      gets a toast and does not consume the owner's press);
 *   3. a synchronous first-press claim (duplicate/concurrent taps submit once);
 *   4. submit through the shared queue, then edit the original message into a
 *      terminal receipt and clear its keyboard. `message is not modified` is
 *      success (the client already shows the receipt).
 *
 * The plain-text "请精准回复「批准」或「拒绝」" path is never replaced by the
 * card: a channel without keyboard support or a refused card send falls back to
 * the exact text the bridge sent before this feature.
 */

/** Versioned namespace so a stale `a1|`/future `ap2|` payload can never be replayed. */
export const TELEGRAM_APPROVAL_NAMESPACE_PREFIX = 'ap1';
export const TELEGRAM_APPROVAL_ACTIONS = Object.freeze({ approve: 'a', reject: 'd' });
export const TELEGRAM_APPROVAL_CALLBACK = createCallbackNamespace(
  TELEGRAM_APPROVAL_NAMESPACE_PREFIX,
);

const OUTCOME_BY_DECISION = Object.freeze({
  approve: 'allowed-once',
  reject: 'rejected',
});
const ACTION_BY_DECISION = Object.freeze({
  approve: TELEGRAM_APPROVAL_ACTIONS.approve,
  reject: TELEGRAM_APPROVAL_ACTIONS.reject,
});
const DECISION_BY_ACTION = Object.freeze({
  [TELEGRAM_APPROVAL_ACTIONS.approve]: 'approve',
  [TELEGRAM_APPROVAL_ACTIONS.reject]: 'reject',
});
const BUTTON_TEXT = Object.freeze({
  approve: '✅ 批准一次',
  reject: '❌ 拒绝',
});
/** The card body keeps the tool/argument summary; the buttons replace the prompt. */
const TERMINAL_LABEL = Object.freeze({
  'allowed-once': '✅ 已批准（仅本次）',
  rejected: '❌ 已拒绝',
  expired: '⏰ 已过期',
  unavailable: '⛔ 已失效',
});
/** Telegram rejects a single message body over this many characters. */
export const TELEGRAM_APPROVAL_CARD_MAX_CHARS = 4_096;
const EMPTY_KEYBOARD = Object.freeze({ inline_keyboard: [] });
const TERMINAL_STATUS_BY_OUTCOME = Object.freeze({
  'allowed-once': ACTION_CARD_STATUS.RESOLVED,
  rejected: ACTION_CARD_STATUS.RESOLVED,
  expired: ACTION_CARD_STATUS.EXPIRED,
  unavailable: ACTION_CARD_STATUS.REVOKED,
});
const DEFAULT_STATE_TEXT_OVERRIDES = Object.freeze({
  [ACTION_CARD_STATUS.CLAIMED]: '正在提交审批决定，请稍候。',
  [ACTION_CARD_STATUS.RESOLVED]: '该审批已处理，无需重复操作。',
  [ACTION_CARD_STATUS.EXPIRED]: '该审批已过期，已自动拒绝。',
  [ACTION_CARD_STATUS.SUPERSEDED]: '该审批已被新提示取代，请使用最新一条。',
  [ACTION_CARD_STATUS.STALE]: '该审批已失效，请等待新的审批提示。',
  [ACTION_CARD_STATUS.REVOKED]: '该审批已失效，请等待新的审批提示。',
  [ACTION_CARD_STATUS.UNKNOWN]: '该审批已处理或不存在，无需重复操作。',
});
const APPROVAL_CARD_NOTICES = Object.freeze({
  ownerOnly: '只有发起当前任务的用户可以处理这条审批。',
});

/** Encode one approval button payload (`ap1|<nonce>|<a|d>`). */
export function telegramApprovalCallbackData(nonce, decision) {
  const action = ACTION_BY_DECISION[decision];
  if (!action) throw new TypeError('An approval decision must be approve or reject');
  return TELEGRAM_APPROVAL_CALLBACK.encode({ nonce, action });
}

/** Parse one of our button payloads; null for anything else (question cards, etc.). */
export function parseTelegramApprovalCallback(data) {
  const parsed = TELEGRAM_APPROVAL_CALLBACK.parse(data);
  if (!parsed) return null;
  const decision = DECISION_BY_ACTION[parsed.action];
  if (!decision) return null;
  return { nonce: parsed.nonce, action: decision };
}

/** The two-button keyboard for one presentation. */
export function telegramApprovalMarkup(nonce) {
  return {
    inline_keyboard: [[
      {
        text: t(BUTTON_TEXT.approve),
        callback_data: telegramApprovalCallbackData(nonce, 'approve'),
      },
      {
        text: t(BUTTON_TEXT.reject),
        callback_data: telegramApprovalCallbackData(nonce, 'reject'),
      },
    ]],
  };
}

/**
 * The card body: today's approval text (tool + arguments + reason) without the
 * "type 批准/拒绝" prompt, which a button makes obsolete. The plain-text path
 * still uses the unmodified `harnessApprovalText` output.
 */
export function telegramApprovalCardText(pending) {
  const text = harnessApprovalText(pending?.interaction?.payload, {
    toolCall: pending?.toolCall,
    requiresMention: pending?.requiresMention === true,
    hasButtons: true,
  });
  return typeof text === 'string' && text ? text : (pending?.text ?? '');
}

function terminalCardText(cardText, outcome, resolvedText) {
  const label = TERMINAL_LABEL[outcome]
    ? t(TERMINAL_LABEL[outcome])
    : (typeof resolvedText === 'string' ? resolvedText : '');
  return label ? `${cardText}\n\n${label}` : cardText;
}

/**
 * Telegram adapter for the shared approval queue. One instance lives per bridge
 * and owns the nonce registry, so stale cards from earlier turns are recognisable
 * and a new approval in the same conversation supersedes the old keyboard.
 */
export class TelegramApprovalCard {
  #registry;
  #logger;
  #notices;

  constructor({
    logger = console,
    registry,
    stateTexts = {},
    ttlMs = 65 * 60_000,
  } = {}) {
    this.#registry = registry instanceof ActionCardRegistry
      ? registry
      : new ActionCardRegistry({ ttlMs });
    this.#logger = logger;
    this.#notices = {
      ...DEFAULT_STATE_TEXT_OVERRIDES,
      ...stateTexts,
    };
  }

  get registry() {
    return this.#registry;
  }

  /**
   * Build the `render` / `onResolved` / `send` context handed to
   * HarnessApprovalQueue. Returns an empty object when the bot cannot carry a
   * keyboard, leaving the queue's plain-text flow completely untouched.
   */
  createContext({ key, actor, target, send, bot } = {}) {
    if (typeof bot?.sendInteractionCard !== 'function'
      || typeof bot?.editInteractionCard !== 'function') {
      return {};
    }
    const rawSend = typeof send === 'function' ? send : async () => {};
    let card = null;
    // Nonce of the card being rendered, known before its message id is.
    let cardNonce = null;
    // A decision can land while `sendInteractionCard` is still in flight: the
    // buttons are visible but `card` (and therefore the message id) is not set
    // yet. Store the outcome so the terminal state is applied the moment the id
    // arrives instead of silently leaving a live keyboard behind.
    let pendingResolution = null;
    // The queue sends the terminal receipt as a separate text right after
    // `onResolved`; when the card edit already delivered it, that copy is noise.
    let swallowResolvedText = null;

    const guardedSend = async (text) => {
      if (swallowResolvedText !== null && text === swallowResolvedText) {
        swallowResolvedText = null;
        return;
      }
      return rawSend(text);
    };

    /**
     * Replace the card body with the receipt and clear its keyboard.
     * Returns true only when the chat already shows the receipt.
     */
    const applyTerminalState = async (settledCard, resolvedText, outcome) => {
      if (settledCard.messageId === null) return false;
      try {
        await bot.editInteractionCard(target, settledCard.messageId, {
          text: terminalCardText(settledCard.text, outcome, resolvedText),
          markup: EMPTY_KEYBOARD,
        });
        return true;
      } catch (error) {
        this.#logger.warn?.(
          '[dsh-im:telegram] could not update a resolved approval card; the text receipt follows:',
          error?.message ?? error,
        );
        await this.#retireKeyboard(bot, target, settledCard.messageId);
        return false;
      }
    };

    return {
      send: guardedSend,
      render: async (pending) => {
        const text = telegramApprovalCardText(pending);
        // sendInteractionCard cannot split a body, and sendMessage rejects
        // anything over 4096 characters. A body that big keeps the text path,
        // which splits the same bytes instead of logging a doomed 400.
        if (text.length > TELEGRAM_APPROVAL_CARD_MAX_CHARS) {
          this.#logger.warn?.(
            '[dsh-im:telegram] approval body exceeds the Telegram message limit; using the plain-text approval:',
            `${text.length} chars`,
          );
          await rawSend(pending.text);
          return;
        }
        const entry = this.#registry.issue({
          conversationKey: key,
          kind: 'approval',
          payload: { approvalId: pending.approvalId, actor },
        });
        cardNonce = entry.nonce;
        try {
          const sent = await bot.sendInteractionCard(target, {
            text,
            markup: telegramApprovalMarkup(entry.nonce),
          });
          card = {
            nonce: entry.nonce,
            approvalId: pending.approvalId,
            messageId: sent?.providerMessageIds?.at(-1) ?? null,
            text,
          };
          // The card now owns the decision guidance and the terminal receipt.
          pending.interactiveCard = true;
          // A decision raced the send: finish the terminal edit that
          // `onResolved` could not do while the message id was unknown.
          if (pendingResolution) {
            const { resolvedText, outcome } = pendingResolution;
            pendingResolution = null;
            await applyTerminalState(card, resolvedText, outcome);
          }
        } catch (error) {
          // A platform that refuses the keyboard must not lose the approval:
          // clear the registration and send the exact pre-card prompt instead.
          this.#registry.settle(entry.nonce, ACTION_CARD_STATUS.REVOKED);
          card = null;
          pendingResolution = null;
          this.#logger.warn?.(
            '[dsh-im:telegram] could not deliver an approval card; falling back to the plain-text approval:',
            error?.message ?? error,
          );
          await rawSend(pending.text);
        }
      },
      onResolved: async (resolvedText, outcome) => {
        const nonce = card?.nonce ?? cardNonce;
        if (!nonce) return false;
        // Settle first: a press arriving while the edit is in flight must be
        // refused instead of submitting the same decision twice.
        this.#registry.settle(
          nonce,
          TERMINAL_STATUS_BY_OUTCOME[outcome] ?? ACTION_CARD_STATUS.RESOLVED,
        );
        if (!card) {
          // The send response is still pending. Let the queue deliver the text
          // receipt now — the decision must never be lost — and remember the
          // outcome so `render` clears the buttons once the id is known.
          pendingResolution = { resolvedText, outcome };
          return false;
        }
        const delivered = await applyTerminalState(card, resolvedText, outcome);
        // The edit landed (or the client already shows it): tell the queue the
        // receipt is delivered so it skips the duplicate terminal text.
        if (delivered) swallowResolvedText = resolvedText;
        return delivered;
      },
    };
  }

  /**
   * Handle one inline-keyboard press. Returns false for payloads this card did
   * not produce, so question cards keep using their own path.
   */
  async handlePress(callback, { bot, answer, submit } = {}) {
    const parsed = parseTelegramApprovalCallback(callback?.data);
    if (!parsed) return false;
    const senderId = typeof callback?.senderId === 'string' ? callback.senderId : '';
    const entry = this.#registry.get(parsed.nonce);

    // Check the actor before claiming: a stranger's press must not consume the
    // owner's only chance to decide.
    if (entry
      && (entry.status === ACTION_CARD_STATUS.ACTIVE || entry.status === ACTION_CARD_STATUS.CLAIMED)
      && typeof entry.payload?.actor === 'string'
      && entry.payload.actor !== senderId) {
      await answer?.(t(APPROVAL_CARD_NOTICES.ownerOnly));
      return true;
    }

    // Synchronous claim: whoever gets here first owns the decision; a second tap
    // (or a second client) is told what happened without submitting again.
    const claimed = this.#registry.claim(parsed.nonce);
    if (claimed.status !== ACTION_CARD_STATUS.ACTIVE) {
      await answer?.(actionCardStateText(claimed.status, this.#notices));
      if (claimed.status !== ACTION_CARD_STATUS.CLAIMED) {
        await this.#retireKeyboard(bot, callback?.replyTarget, callback?.providerMessageId);
      }
      return true;
    }

    const live = claimed.entry;
    // Acknowledge before doing anything that can fail or take time.
    await answer?.();
    if (typeof submit !== 'function') {
      this.#registry.settle(parsed.nonce, ACTION_CARD_STATUS.STALE);
      return true;
    }
    const outcome = OUTCOME_BY_DECISION[parsed.action];
    let submitted = APPROVAL_SUBMIT_RESULT.RETRYABLE;
    try {
      // `detailed` distinguishes a landed decision, an in-flight decision,
      // a retryable failure and an invalid card that must be retired.
      submitted = await submit(live.payload?.approvalId, outcome, { actor: senderId, detailed: true });
    } catch (error) {
      this.#logger.warn?.(
        '[dsh-im:telegram] failed to submit an approval card decision:',
        error?.message ?? error,
      );
      submitted = APPROVAL_SUBMIT_RESULT.RETRYABLE;
    }
    if (submitted === APPROVAL_SUBMIT_RESULT.SUBMITTED) return true;
    if (submitted === APPROVAL_SUBMIT_RESULT.RETRYABLE
      || submitted === APPROVAL_SUBMIT_RESULT.BUSY) {
      // Keep the keyboard available after a failure or while a typed decision
      // is in flight. The queue blocks duplicate submissions; its resolution
      // hook retires the card on success. A later RPC failure can then be retried
      // with this same button instead of leaving it claimed or permanently stale.
      // The callback is already acknowledged; no second toast is needed.
      this.#registry.releaseClaim(parsed.nonce);
      return true;
    }
    // The live queue no longer has this approval (resolved elsewhere, route
    // closed). Retire the card instead of leaving a keyboard that keeps failing.
    this.#registry.settle(parsed.nonce, ACTION_CARD_STATUS.STALE);
    await this.#retireKeyboard(bot, callback?.replyTarget, callback?.providerMessageId);
    return true;
  }

  async #retireKeyboard(bot, target, providerMessageId) {
    if (typeof bot?.updateInteractionCard !== 'function') return;
    // Card delivery hands back string ids (Bot API message ids are numbers), so
    // normalise before validating; a string guard silently skipped every cleanup.
    const messageId = Number(providerMessageId);
    if (!target || !Number.isSafeInteger(messageId)) return;
    try {
      await bot.updateInteractionCard(target, messageId, { markup: EMPTY_KEYBOARD });
    } catch (error) {
      this.#logger.warn?.(
        '[dsh-im:telegram] could not clear a stale approval keyboard:',
        error?.message ?? error,
      );
    }
  }
}
