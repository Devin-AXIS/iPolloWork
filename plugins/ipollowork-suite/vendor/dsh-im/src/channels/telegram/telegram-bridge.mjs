import { harnessQuestionText } from '../shared/harness-question.mjs';
import { t } from '../shared/i18n.mjs';
import { TextHarnessBridge, createTextBridgeStatus } from '../shared/text-harness-bridge.mjs';
import { workspaceLabels } from '../shared/workspace-labels.mjs';
import { TelegramApprovalCard } from './approval-card.mjs';

export const TELEGRAM_DESCRIPTOR = Object.freeze({
  key: 'telegram',
  label: 'Telegram',
  connectionLabel: ' Bot API 长轮询',
  // A finished turn leaves no reaction behind: Telegram keeps offering reaction
  // controls on a message that carries one, which repeats for the reader even
  // with reaction notifications off. A failure still keeps its mark.
  reactions: Object.freeze({ processing: '👀', success: null, error: '👎' }),
});

/** One keyboard row per option; beyond this the list stops being scannable. */
const MAX_CARD_OPTIONS = 8;

/**
 * Encode a press. Carries the presentation nonce so a keyboard left over from an
 * earlier question cannot answer a later one — a new request restarts its indexes
 * at zero, so the index alone would collide. Still far under Telegram's 64-byte
 * callback_data budget, so no server-side id table is needed.
 */
function cardCallbackData(nonce, questionIndex, optionIndex) {
  return `q|${nonce}|${questionIndex}|${optionIndex}`;
}

/** Parse a press produced by {@link cardCallbackData}; null for foreign payloads. */
export function parseTelegramCardCallback(data) {
  const match = typeof data === 'string'
    ? /^q\|([A-Za-z0-9_-]{1,16})\|(\d{1,4})\|(\d{1,4})$/u.exec(data)
    : null;
  if (!match) return null;
  return {
    nonce: match[1],
    questionIndex: Number(match[2]),
    optionIndex: Number(match[3]),
  };
}

/**
 * Inline-keyboard presentation for single-choice questions.
 *
 * Returns null — leaving the plain-text flow in charge — when a keyboard cannot
 * express every answer the request allows: no options, an unusable button label,
 * more options than fit, or multi-select (which needs an accumulating keyboard
 * plus a submit action this channel does not have yet).
 */
export const TELEGRAM_INTERACTION_CARD = Object.freeze({
  render(question, { questionIndex = 0, total = 1, requiresMention = false, nonce } = {}) {
    // Without an identity the press could not be attributed to this presentation.
    if (typeof nonce !== 'string' || !nonce) return null;
    const options = Array.isArray(question?.options) ? question.options : [];
    if (options.length === 0 || options.length > MAX_CARD_OPTIONS) return null;
    if (question.multiSelect === true) return null;
    if (options.some((option) => typeof option?.label !== 'string' || !option.label.trim())) {
      return null;
    }
    return {
      text: harnessQuestionText(question, questionIndex, total, {
        requiresMention,
        hasButtons: true,
      }),
      markup: {
        inline_keyboard: options.map((option, optionIndex) => [{
          text: option.label,
          callback_data: cardCallbackData(nonce, questionIndex, optionIndex),
        }]),
      },
    };
  },
  parse: parseTelegramCardCallback,
});

/**
 * One keyboard row per workspace. Rows stack with no pagination: beyond this
 * the phone view becomes a wall of buttons, so the bridge falls back to the
 * text list that already answers `/ws <index>` (explicit degradation).
 */
const MAX_WORKSPACE_BUTTONS = 20;

/**
 * Encode one workspace button. The path cannot ride in `callback_data` (64-byte
 * budget), so the press carries a presentation nonce plus the index into the
 * snapshot the bridge cached when it sent the card. A stale card therefore
 * cannot switch to a workspace that a fresher list no longer contains.
 */
function workspaceCardCallbackData(nonce, index) {
  // Versioned namespace (upstream convention, cf. openclaw tga1:/tgq1:): a future
  // payload change can tell an old card apart instead of mis-parsing it.
  return `w1|${nonce}|${index}`;
}

/** Parse a press produced by {@link workspaceCardCallbackData}; null for foreign payloads. */
export function parseTelegramWorkspaceCallback(data) {
  const match = typeof data === 'string'
    ? /^w1\|([A-Za-z0-9_-]{1,16})\|(\d{1,3})$/u.exec(data)
    : null;
  if (!match) return null;
  return { nonce: match[1], index: Number(match[2]) };
}

/**
 * Inline-keyboard presentation for the merged `/ws` listing.
 *
 * The card text is deliberately state-free: after a press only the keyboard is
 * replaced (`editMessageReplyMarkup`), so a "current: …" sentence in the body
 * would immediately lie about which workspace is current.
 */
export const TELEGRAM_WORKSPACE_CARD = Object.freeze({
  render(listing, { nonce } = {}) {
    if (typeof nonce !== 'string' || !nonce) return null;
    const paths = Array.isArray(listing?.paths) ? listing.paths : [];
    if (paths.length === 0 || paths.length > MAX_WORKSPACE_BUTTONS) return null;
    const current = typeof listing?.current === 'string' ? listing.current : null;
    const labels = workspaceLabels(paths, listing?.titles ?? {});
    return {
      text: t('选择要切换的工作区（共 {count} 个）：', { count: paths.length }),
      markup: {
        inline_keyboard: paths.map((path, index) => [{
          text: `${path === current ? '✓ ' : ''}${index + 1}. ${labels[index].label}`,
          callback_data: workspaceCardCallbackData(nonce, index),
        }]),
      },
    };
  },
  parse: parseTelegramWorkspaceCallback,
});

export class TelegramHarnessBridge extends TextHarnessBridge {
  constructor(options) {
    // Approval cards are on by default; `approvalCard: null` keeps the
    // plain-text approval flow for a caller that wants it (tests/tools).
    // The controller owns the per-conversation nonce registry.
    super({
      descriptor: TELEGRAM_DESCRIPTOR,
      interactionCard: TELEGRAM_INTERACTION_CARD,
      workspaceCard: TELEGRAM_WORKSPACE_CARD,
      ...options,
      approvalCard: options && Object.hasOwn(options, 'approvalCard')
        ? options.approvalCard
        : new TelegramApprovalCard({ logger: options?.logger }),
    });
  }
}

export { createTextBridgeStatus as createTelegramBridgeStatus };
