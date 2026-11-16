import { BusyMessageDispatcher, canAutomaticallySteer } from './busy-message-dispatcher.mjs';
import { randomBytes, randomUUID } from 'node:crypto';

import { createDeferredDeliveryCoordinator, deferredOutcomeText } from './deferred-delivery-coordinator.mjs';
import { t } from './i18n.mjs';
import { availableCommandCatalog, commandHelpLines, SHARED_COMMAND_CATALOG } from './command-catalog.mjs';
import {
  COMMAND_PERMISSION_DENIED_MESSAGE,
  evaluateInboundAccess,
} from './inbound-access.mjs';
import {
  captureContextEnhancement,
  captureContextEnhancementSource,
  enhanceContextContent,
} from './context-enhancement.mjs';
import { runWorkspaceCommand, workspaceSwitchFailureText } from './workspace-command.mjs';
import { runStatusCommand } from './status-command.mjs';
import { runCompactCommand } from './compact-command.mjs';
import { isClearCommand, runClearCommand } from './clear-command.mjs';
import { isResetCommand, runResetCommand } from './reset-command.mjs';
import { isHistoryCommand, runHistoryCommand } from './history-command.mjs';
import {
  isControlCommand,
  runControlCommand,
} from './control-command.mjs';
import {
  rememberConnectionTestTarget,
  sendRememberedConnectionTest,
} from './connection-test.mjs';
import {
  isModelCommand,
  runModelCommand,
} from './model-command.mjs';
import {
  isPresetCommand,
  runPresetCommand,
} from './preset-command.mjs';
import { askInWorkspaceSession } from './workspace-session.mjs';
import { HarnessApprovalQueue, harnessApprovalDecision } from './harness-approval.mjs';
import {
  BatchInputManager,
  batchInputBusyMessage,
  batchInputGroupUnsupportedMessage,
  isBatchInputCommand,
} from './batch-input.mjs';
import {
  hasInboundImages,
  imagePromptDiagnostic,
  imagePromptUserMessage,
} from './image-prompt.mjs';
import {
  hasInboundFiles,
  inboundFileUserMessage,
} from './inbound-file.mjs';
import {
  harnessAnswerForQuestion,
  harnessQuestionText,
  validHarnessQuestion,
} from './harness-question.mjs';
import { deliverOutboundArtifacts } from './semantic/artifact-delivery.mjs';
import { prependSpeakerLabel } from './speaker-label.mjs';
import {
  hasReplyReference,
  promptContentForInboundMessage,
} from './semantic/reply-reference.mjs';
import {
  createDeliveryReceipt,
  createTextDeliveryBlock,
  providerMessageIdsFor,
} from './semantic/delivery.mjs';
import {
  messageFailureDiagnostic,
  channelDeliveryFailure,
  clearLastMessageFailure,
  messageFailureText,
  setLastMessageFailure,
} from './message-failure.mjs';
import { logDeliveryFailure } from './delivery-failure-log.mjs';
import { beginStatusReaction } from './status-reaction.mjs';
import { startNewConversation, isNewCommand, newCommandTitle } from './new-command.mjs';
import {
  isSessionNavCommand,
  runSessionNavCommand,
} from './session-nav-command.mjs';
import {
  documentSendSupported,
  buttonPreviewSupported,
} from './channel-capabilities.mjs';
import { createActionNonce } from './action-card.mjs';

/** Cap and TTL for the in-memory workspace-picker snapshots behind button presses. */
const MAX_WORKSPACE_CARDS = 50;
const WORKSPACE_CARD_TTL_MS = 60 * 60 * 1000;
const WORKSPACE_CARD_NONCE_BYTES = 9;

const INTERACTION_RESOLVED_TEXT = '这个问题已在其他客户端处理，无需再次回答。';
const FILE_ONLY_COMPLETION_TEXT = '任务已完成。';

/**
 * How many times one inbound message may be re-delivered after a failed turn.
 *
 * A failure releases the message's `markSeen` so the next poll retries it, which
 * would otherwise loop forever on a mail that always fails. After this many
 * attempts the mark stays and the message is treated as handled.
 */
const MAX_DELIVERY_ATTEMPTS = 3;
/** How many plain-text messages one coalescing window folds into one dispatch. */
const MAX_COALESCE_MEMBERS = 8;

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function canClaimInteractionReply(message, pending, senderId) {
  return pending.actor === senderId
    && (message.kind !== 'group' || message.addressed === true)
    && !hasInboundImages(message)
    && !hasInboundFiles(message)
    && Boolean(controlTextOf(message));
}

function artifactFailureText(fileName, error, descriptor) {
  const name = String(fileName ?? t('结果文件'))
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 255) || t('结果文件');
  switch (error?.code) {
    case 'artifact-delivery-uncertain':
      return t('结果文件「{name}」的发送结果未能确认，请先检查聊天内是否已收到，不要立即重试。', { name });
    case 'artifact-permission-required':
      if (descriptor?.key === 'slack') {
        return t('结果文件「{name}」已生成，但 Slack 应用缺少 files:write 权限。请更新 Manifest、重新安装应用并重新连接机器人后重试。', { name });
      }
      if (descriptor?.key === 'discord') {
        return t('结果文件「{name}」已生成，但机器人缺少 Discord 的 Send Messages、Attach Files 或 Read Message History 权限。', { name });
      }
      if (descriptor?.key === 'telegram') {
        return t('结果文件「{name}」已生成，但 Telegram 不允许机器人在当前聊天发送文档，请检查聊天权限。', { name });
      }
      if (descriptor?.key === 'matrix') {
        return t('结果文件「{name}」已生成，但 Matrix homeserver 拒绝了媒体上传，请检查其媒体大小限制与上传权限。', { name });
      }
      return t('结果文件「{name}」已生成，但当前机器人没有文件发送权限，请检查渠道权限。', { name });
    case 'artifact-too-large':
      return t('结果文件「{name}」超过当前渠道大小上限，未发送。', { name });
    case 'artifact-empty':
      return t('结果文件「{name}」为空，未发送。', { name });
    case 'artifact-invalid':
    case 'artifact-changed':
    case 'artifact-unavailable':
      return t('结果文件「{name}」暂时无法读取或准备发送，请确认文件仍可访问后重试。', { name });
    case 'artifact-rate-limited':
      return t('结果文件「{name}」暂时被当前渠道限流，未能发送，请稍后重试。', { name });
    case 'artifact-provider-rejected':
      return t('结果文件「{name}」已生成，但当前渠道拒绝了该文件或文件消息。', { name });
    default:
      return t('结果文件「{name}」已生成，但当前渠道暂时未能发送，请稍后重试。', { name });
  }
}

export function createTextBridgeStatus() {
  return {
    messagesReceived: 0,
    messagesReplied: 0,
    messagesRejected: 0,
    lastMessageAt: null,
    lastReplyAt: null,
    lastRejectedAt: null,
    lastError: null,
    lastMessageError: null,
    reactionsAdded: 0,
    reactionsRemoved: 0,
    reactionErrors: 0,
  };
}

/**
 * The text a channel's control commands and approval decisions are parsed from.
 *
 * A channel may decorate `content` for the model — the email channel prepends
 * the mail headers so a subject line reaches the model — while `controlText`
 * keeps the undecorated body. Without this a decorated message made `/help`
 * and "批准" unrecognisable.
 */
function controlTextOf(message) {
  return cleanText(message?.controlText ?? message?.content);
}

/** Durable queue-entry id; the conversation key keeps ids unique across chats. */
function pendingMessageId(key, messageId) {
  return `${key}\u0000${messageId}`;
}

const PENDING_RESTART_NOTICE = '排队中的消息在服务重启时被中断。为避免重复执行，未自动重放；如果该消息尚未处理，请重新发送。';

// Callback namespace for the /tail preview "Hide" button: the payload is the
// nonce of the preview message the bot must delete when pressed.
const TAIL_HIDE_CALLBACK_PREFIX = 'tailhide|';

export class TextHarnessBridge {
  #descriptor;
  #bot;
  #harness;
  #state;
  #deferred;
  #contextEnhancement;
  #accessPolicy;
  #thinkingTraces;
  #status;
  #logger;
  #replyTimeoutMs;
  #signal;
  #keepaliveIntervalMs;
  #queues = new Map();
  // Crash-recovery for #queues, started with the bridge; see recoverPendingMessages().
  #pendingRecovery = null;
  #busyMessages = new BusyMessageDispatcher();
  #pendingInteractions = new Map();
  #interactionKeys = new Map();
  // Keep the accepted configuration through the existing queue/reply lifecycle.
  #acceptedMessageIds = new Map();
  #approvalTasks = new Set();
  #commandTasks = new Set();
  #approvals;
  #batches = new BatchInputManager();
  #interactionCard;
  #workspaceCard;
  // Workspace picker snapshots by nonce: the press carries an index, not a path.
  #workspaceCards = new Map();
  // Conversation key → the one picker card that is still authoritative there.
  #workspaceCardKeys = new Map();
  // /tail preview messages by nonce, so the "Hide" press can delete the bot's
  // own preview message. Keyed by nonce → { target, providerMessageId }.
  #tailPreviewMessages = new Map();
  // Optional channel-supplied approval card controller (see HarnessApprovalQueue's
  // render hook). Null keeps every channel's existing plain-text approval flow.
  #approvalCard;
  #contextHooks = null;
  // Delivery attempts per message id. A failed turn releases its `markSeen` so
  // the next poll can retry, and this counter is what keeps that from becoming
  // an infinite loop on a mail that always fails.
  #deliveryAttempts = new Map();
  // Who opened the in-flight turn per conversation key, for the same-sender
  // auto-steer lane; and the open coalescing windows awaiting their flush.
  #turnAuthors = new Map();
  #coalescing = new Map();
  #autoSteerSameSender = false;
  #autoSteerLimit = 0;
  #coalesceWindowMs = 0;

  constructor({
    descriptor,
    bot,
    harness,
    state,
    contextEnhancement,
    accessPolicy,
    thinkingTraces = false,
    status = createTextBridgeStatus(),
    logger = console,
    replyTimeoutMs = 600_000,
    signal,
    keepaliveIntervalMs = 4_000,
    interactionCard = null,
    workspaceCard = null,
    approvalCard = null,
    approvalTimeoutMs,
    contextHooks = null,
    autoSteerSameSender = false,
    autoSteerLimit = 0,
    coalesceWindowMs = 0,
  }) {
    if (!descriptor?.key || !descriptor?.label) throw new TypeError('A channel descriptor is required');
    if (!bot || typeof bot.sendText !== 'function') throw new TypeError('A bot client is required');
    if (!harness || !state) throw new TypeError('Harness client and state store are required');
    this.#descriptor = descriptor;
    this.#bot = bot;
    this.#harness = harness;
    this.#state = state;
    this.#contextEnhancement = contextEnhancement;
    this.#accessPolicy = accessPolicy;
    this.#thinkingTraces = thinkingTraces;
    this.#status = status;
    this.#logger = logger;
    this.#replyTimeoutMs = replyTimeoutMs;
    this.#signal = signal;
    this.#keepaliveIntervalMs = keepaliveIntervalMs;
    this.#interactionCard = interactionCard ?? null;
    this.#workspaceCard = workspaceCard ?? null;
    this.#approvalCard = approvalCard ?? null;
    // Opt-in follow-up lanes for channels whose groups run on rapid consecutive
    // posts: fold a same sender's burst into one dispatch, and steer that
    // sender's own mid-turn follow-ups into the in-flight turn instead of
    // queueing them behind the answer they are meant to correct. Off unless a
    // channel asks for them, so every other channel keeps the plain queue.
    this.#autoSteerSameSender = autoSteerSameSender === true;
    this.#autoSteerLimit = Number.isSafeInteger(autoSteerLimit) && autoSteerLimit > 0
      ? Math.min(autoSteerLimit, 20)
      : 0;
    this.#coalesceWindowMs = Number.isSafeInteger(coalesceWindowMs) && coalesceWindowMs > 0
      ? Math.min(coalesceWindowMs, 3_000)
      : 0;
    // Channel-supplied conversation context pipeline (collect/render/consume/deliver).
    // Channels own what context means and how it is framed; the bridge only runs
    // the steps at the right points of one turn, so every hook is optional and a
    // channel without one pays no context work at all.
    this.#contextHooks = contextHooks && typeof contextHooks === 'object' ? contextHooks : null;
    this.#deferred = createDeferredDeliveryCoordinator({ harness, state, signal, logger,
      deliver: (entry, outcome) => this.#deliverDeferredOutcome(entry, outcome),
    });
    this.#approvals = new HarnessApprovalQueue({
      label: descriptor.key,
      logger,
      // Tests and hosts may shorten the approval deadline; the default stays.
      ...(Number.isFinite(approvalTimeoutMs) && approvalTimeoutMs > 0
        ? { approvalTimeoutMs }
        : {}),
    });
    // A queued message lives only in #queues. If the process dies before its
    // turn runs the user has already been told it is queued, so the persisted
    // entry must be replayed or reported as soon as the bridge starts.
    this.recoverPendingMessages();
  }

  get status() {
    return structuredClone(this.#status);
  }

  accept(message, { contextSnapshot, accessDecision, busyMessageMode } = {}) {
    if (this.#signal?.aborted) return Promise.resolve();
    const conversationId = cleanText(message?.conversationId);
    const kind = message?.kind === 'group' ? 'group' : 'direct';
    const normalized = { ...message, kind, conversationId };
    const messageId = cleanText(normalized.messageId);
    const senderId = cleanText(normalized.senderId);
    if (!messageId || !senderId || !conversationId || normalized.senderIsBot === true
      || this.#state.hasSeen(messageId) || this.#acceptedMessageIds.has(messageId)) {
      return Promise.resolve();
    }
    // Preserve the channel trigger boundary. Access policy never turns an
    // unaddressed group message into a denial reply.
    if (kind === 'group' && normalized.addressed !== true) {
      this.#status.messagesRejected += 1;
      this.#status.lastRejectedAt = new Date().toISOString();
      this.#acceptedMessageIds.set(messageId, null);
      return this.#finishLocalMessage(normalized, messageId, null);
    }
    if (this.#accessPolicy || accessDecision) {
      const hasImages = hasInboundImages(normalized);
      const hasFiles = hasInboundFiles(normalized);
      const decision = accessDecision ?? evaluateInboundAccess(this.#accessPolicy, {
        conversationType: kind,
        senderIds: [senderId, cleanText(normalized.senderAlternateId)].filter(Boolean),
        // The same control text the command runner below parses. A channel may
        // decorate `content` for the model (email prepends the mail headers), and
        // a decorated body never looks like a command — so reading `content` here
        // recognized no command at all and skipped the command-permission gate.
        text: controlTextOf(normalized),
        hasImages,
        hasFiles,
      });
      if (!decision.allowed) {
        this.#status.messagesRejected += 1;
        this.#status.lastRejectedAt = new Date().toISOString();
        // Mark policy denials so a webhook replay cannot repeat local work or
        // a command-permission notice.
        this.#acceptedMessageIds.set(messageId, null);
        return this.#finishLocalMessage(
          normalized,
          messageId,
          decision.reason === 'command-not-allowed'
            ? t(COMMAND_PERMISSION_DENIED_MESSAGE)
            : null,
          { recordReceived: decision.reason === 'command-not-allowed' },
        );
      }
    }
    this.#acceptedMessageIds.set(messageId, contextSnapshot === undefined
      ? captureContextEnhancement(this.#contextEnhancement, message?.kind)
      : contextSnapshot);
    const statusReaction = beginStatusReaction({
      adapter: this.#bot,
      target: normalized.kind === 'direct' || normalized.addressed === true
        ? normalized.reactionTarget
        : null,
      reactions: this.#descriptor.reactions,
      status: this.#status,
      logger: this.#logger,
      label: this.#descriptor.key,
    });
    normalized.statusReaction = statusReaction;

    const processing = this.#acceptAcceptedMessage(normalized, messageId, senderId, busyMessageMode);
    void processing.then(
      () => statusReaction.success(),
      () => statusReaction.error(),
    );
    return processing;
  }

  #acceptAcceptedMessage(normalized, messageId, senderId, busyMessageMode) {
    if (normalized.kind === 'direct') {
      rememberConnectionTestTarget(
        this.#state,
        normalized.connectionTestTarget ?? normalized.replyTarget,
      );
    }

    const key = `${normalized.kind}:${normalized.conversationId}`;
    const pending = this.#pendingInteractions.get(key);
    const text = controlTextOf(normalized);
    if (isClearCommand(text) && (
      this.#queues.has(key)
      || pending
      || this.#approvals.hasPending(key)
      || this.#batches.status(key).phase !== 'idle'
    )) {
      return this.#finishLocalMessage(
        normalized,
        messageId,
        t('当前会话正在生成回复或等待交互，请先完成交互或发送 /stop，再执行 /clear。'),
      );
    }
    const batchCommand = isBatchInputCommand(text);
    if (batchCommand && normalized.kind === 'group' && normalized.addressed === true) {
      return this.#finishLocalMessage(
        normalized,
        messageId,
        batchInputGroupUnsupportedMessage(),
      );
    }
    if (batchCommand && normalized.kind === 'direct') {
      const exactBatch = /^\/batch$/iu.test(text);
      if (exactBatch && (
        this.#queues.has(key)
        || Boolean(pending)
        || this.#approvals.hasPending(key)
      )) {
        return this.#finishLocalMessage(normalized, messageId, batchInputBusyMessage());
      }
      const batch = this.#batches.handle(key, text, {
        plainText: Boolean(text)
          && normalized.plainText !== false
          && !hasInboundImages(normalized)
          && !hasInboundFiles(normalized)
          && !hasReplyReference(normalized),
      });
      if (batch.handled) {
        if (batch.kind === 'submit') {
          return this.#enqueueMessage({
            ...normalized,
            content: batch.prompt,
            // The submission is exactly the collected text; a quote or an
            // attachment on the command itself is not part of it.
            replyTo: null,
            images: [],
            files: [],
            batchSubmission: { token: batch.token, title: batch.title },
          }, messageId, senderId, key);
        }
        return this.#finishLocalMessage(normalized, messageId, batch.message);
      }
    } else if (normalized.kind === 'direct'
      && this.#batches.status(key).phase === 'collecting') {
      const batch = this.#batches.handle(key, text, {
        plainText: Boolean(text)
          && normalized.plainText !== false
          && !hasInboundImages(normalized)
          && !hasInboundFiles(normalized)
          && !hasReplyReference(normalized),
      });
      if (batch.handled) {
        return this.#finishLocalMessage(normalized, messageId, batch.message);
      }
    }
    const collectingBatch = normalized.kind === 'direct'
      && this.#batches.status(key).phase === 'collecting';
    const commandRunner = collectingBatch ? null : isClearCommand(text) ? runClearCommand
      : isResetCommand(text) ? runResetCommand
      : isHistoryCommand(text) ? runHistoryCommand
      : hasInboundFiles(normalized) ? null : isControlCommand(text)
      ? runControlCommand
      : (isModelCommand(text)
          ? runModelCommand
          : (isPresetCommand(text) ? runPresetCommand : null));
    if (commandRunner && (normalized.kind !== 'group' || normalized.addressed === true)) {
      let task;
      task = this.#processFastCommand(
        normalized,
        messageId,
        key,
        commandRunner,
        senderId,
      ).finally(() => {
        this.#acceptedMessageIds.delete(messageId);
        this.#commandTasks.delete(task);
      });
      this.#commandTasks.add(task);
      return task;
    }
    // An addressed plain-text request that is no approve/reject token while only
    // an approval waits is the sender moving on, not a decision: reject the
    // waiting tool call and run this message as its own turn, so the room is not
    // held behind a decision that is not coming. A pending question keeps its
    // ordinary flow — the asking actor's @ text answers it, and other senders
    // queue behind the turn (questions belong to the asking actor). Direct chats
    // keep the plain decide-by-token path; their exits are the commands.
    const addressedTrigger = normalized.kind === 'group' && normalized.addressed === true
      && normalized.plainText !== false
      && !hasInboundImages(normalized) && !hasInboundFiles(normalized)
      && Boolean(text);
    if (addressedTrigger && !pending
      && this.#approvals.hasPending(key) && harnessApprovalDecision(text) === null) {
      let task;
      task = this.#retireWaitingInteractions(key, pending)
        .then(() => this.#bot.sendText(normalized.replyTarget, t('已不再等待原有的待回答或待审批，已将其取消，先回应你的新请求。')))
        .catch(() => undefined)
        .then(() => this.#dispatchTrigger(normalized, messageId, senderId, key))
        .finally(() => {
          this.#acceptedMessageIds.delete(messageId);
          this.#commandTasks.delete(task);
        });
      this.#commandTasks.add(task);
      return task;
    }
    const approval = this.#approvals.claimReply({
      key,
      actor: senderId,
      messageId,
      // Approval decisions are parsed from the control text, exactly like the
      // commands above: a decorated `content` hid "批准" behind the mail headers,
      // so a plain-body approval never claimed its pending request.
      text: hasInboundImages(normalized) || hasInboundFiles(normalized)
        ? ''
        : controlTextOf(normalized),
      addressed: normalized.kind !== 'group' || normalized.addressed === true,
      hasPendingQuestion: Boolean(pending),
      questionCompletion: pending?.submitting || pending?.claimedReplyMessageId
        ? pending.queue
        : null,
      isQuestionPending: () => this.#pendingInteractions.has(key),
      send: (text) => this.#bot.sendText(normalized.replyTarget, text),
    });
    if (approval) {
      let task;
      task = approval.process(async () => {
          if (this.#state.hasSeen(messageId)) return false;
          await this.#state.markSeen(messageId);
          this.#status.messagesReceived += 1;
          this.#status.lastMessageAt = new Date().toISOString();
          return true;
        })
        .finally(() => {
          this.#acceptedMessageIds.delete(messageId);
          this.#approvalTasks.delete(task);
        });
      this.#approvalTasks.add(task);
      return task;
    }
    if (pending && pending.actor !== senderId) {
      return this.#enqueueMessage(normalized, messageId, senderId, key);
    }
    if (pending?.submitting || pending?.claimedReplyMessageId) {
      return this.#enqueueMessage(normalized, messageId, senderId, key);
    }
    if (pending) {
      if (canClaimInteractionReply(normalized, pending, senderId)) {
        pending.claimedReplyMessageId = messageId;
      }
      const previous = pending.queue ?? Promise.resolve();
      const current = previous
        .catch(() => undefined)
        .then(() => this.#processInteractionReply(
          normalized,
          messageId,
          senderId,
          key,
          pending,
        ))
        .finally(() => {
          this.#acceptedMessageIds.delete(messageId);
          if (pending.claimedReplyMessageId === messageId) {
            pending.claimedReplyMessageId = null;
          }
          if (pending.queue === current) pending.queue = null;
        });
      pending.queue = current;
      return current;
    }
    return this.#dispatchTrigger(normalized, messageId, senderId, key, {
      // Ordinary destinations of the lanes fall through to the busy-mode dispatcher,
      // keeping its steering, receipts, and routing serialization for what the lanes decline.
      exit: (exitOptions) => this.#busyMessages.dispatch({
        key, messageId, text: normalized.content,
        commandText: text, mode: busyMessageMode,
        onFailure: (error) => this.#signal?.aborted || error?.code === 'turn-stopped'
          ? normalized.statusReaction?.clear() : normalized.statusReaction?.error(),
        eligible: () => normalized.plainText !== false
          && !hasInboundImages(normalized) && !hasInboundFiles(normalized)
          && !hasReplyReference(normalized)
          && canAutomaticallySteer(this.#accessPolicy, normalized.kind,
            [senderId, normalized.senderAlternateId].filter(Boolean)),
        harness: this.#harness, state: this.#state, status: this.#status,
        signal: this.#signal, control: { owner: this, key }, logger: this.#logger,
        acceptedMessageIds: this.#acceptedMessageIds,
        pendingInteraction: () => this.#pendingInteractions.has(key) || this.#approvals.hasPending(key),
        enhancement: {
          snapshot: this.#acceptedMessageIds.get(messageId),
          source: () => {
            const source = normalized.contextSource?.();
            return { channel: this.#descriptor.key, senderId, senderName: source?.senderName,
              conversationTitle: source?.conversationTitle,
              chatId: source?.chatId ?? normalized.conversationId, threadId: source?.threadId };
          },
        },
        isQueued: () => this.#queues.has(key),
        enqueue: (enqueueOptions) => this.#enqueueMessage(normalized, messageId, senderId, key, enqueueOptions),
        send: (reply) => this.#bot.sendText(normalized.replyTarget, reply),
      }),
    });
  }

  /**
   * The ordinary trigger exit, where a message becomes a turn. Three lanes:
   * while the conversation runs, a plain-text follow-up from the very sender
   * who opened the in-flight turn steers that turn (the room hears the
   * correction at the next model step instead of after the whole answer);
   * on an idle conversation, consecutive plain-text posts from one sender fold
   * into a single dispatch inside a short window, so a burst split across
   * bubbles becomes one turn; everything else — other senders, media, composed
   * payloads — keeps the per-conversation queue that preserves one voice at a
   * time.
   * An `exit` hook, when provided, receives every ordinary queue destination of
   * the lanes, so a channel can fall through to richer routing (busy-mode steering
   * and queue receipts) for what these lanes decline.
   */
  #dispatchTrigger(message, messageId, senderId, key, { exit } = {}) {
    const toQueue = (options) => (exit
      ? exit(options)
      : this.#enqueueMessage(message, messageId, senderId, key, options));
    const plainText = !hasInboundImages(message) && !hasInboundFiles(message)
      && message.plainText !== false
      && Boolean(controlTextOf(message));
    const author = this.#turnAuthors.get(key);
    if (author !== undefined && plainText
      && this.#autoSteerSameSender && this.#autoSteerLimit > 0
      && author.senderId === senderId && author.steered < this.#autoSteerLimit) {
      const text = this.#steerTextFor(message, messageId, senderId);
      const sessionId = this.#state.sessionFor?.(key) ?? null;
      if (text && sessionId !== null && typeof this.#harness.steerActiveTurn === 'function') {
        return this.#harness
          .steerActiveTurn(sessionId, text, { owner: this, key }, this.#signal ? { signal: this.#signal } : undefined)
          .then((steered) => (steered
            ? this.#settleSteeredTurn(author, messageId, key)
            : toQueue()))
          .catch(() => toQueue());
      }
    }
    if (!this.#queues.has(key) && !this.#pendingInteractions.has(key) && !this.#approvals.hasPending(key)) {
      const open = this.#coalescing.get(key);
      if (open !== undefined) {
        if (open.senderId === senderId && plainText && open.members.length < MAX_COALESCE_MEMBERS) {
          open.members.push({ message, messageId });
          return Promise.resolve();
        }
        // A different sender, or a payload the window may not fold: this
        // message dispatches on its own while the window keeps collecting.
        return toQueue();
      }
      if (this.#coalesceWindowMs > 0 && plainText) {
        const opened = { senderId, members: [{ message, messageId }] };
        const timer = setTimeout(() => { void this.#flushCoalesced(key); }, this.#coalesceWindowMs);
        timer.unref?.();
        this.#coalescing.set(key, opened);
        return Promise.resolve();
      }
    }
    return toQueue();
  }

  /**
   * Tag a turn's own delivery target with its conversation key so the channel can
   * retire the resulting bubble from that conversation's ambient window: the text
   * is in the Session transcript already. Local notices, command output, and
   * interaction prompts send on unstamped targets and stay readable as room facts.
   */
  #turnDeliveryTarget(target, conversationKey) {
    if (!target || typeof target !== 'object'
      || typeof conversationKey !== 'string' || !conversationKey) return target;
    return { ...target, dshTurnKey: conversationKey };
  }

  /** The model-facing body of an auto-steered follow-up, labelled like a turn. */
  #steerTextFor(message, messageId, senderId) {
    const body = cleanText(message.content) || controlTextOf(message);
    if (!body) return null;
    const labelled = message.kind === 'group' ? prependSpeakerLabel(body, message.speakerName) : body;
    const snapshot = this.#acceptedMessageIds.get(messageId);
    if (!snapshot) return labelled;
    // A mid-turn follow-up carries the same provenance as the message that
    // opened the turn, so the member who steers is identified to the model too.
    const contextSource = message.contextSource?.();
    return enhanceContextContent(labelled, snapshot, () => ({
      channel: this.#descriptor.key,
      senderId,
      senderName: contextSource?.senderName,
      conversationTitle: contextSource?.conversationTitle,
      chatId: contextSource?.chatId ?? message.conversationId,
      threadId: contextSource?.threadId,
    }));
  }

  /** A steered message became part of the in-flight turn: settle its receipt. */
  async #settleSteeredTurn(author, messageId, key) {
    author.steered += 1;
    if (!this.#state.hasSeen(messageId)) await this.#state.markSeen(messageId);
    this.#status.messagesReceived += 1;
    this.#status.lastMessageAt = new Date().toISOString();
    this.#acceptedMessageIds.delete(messageId);
    // The steered body now lives in the in-flight turn, just like a folded
    // coalescer member: the channel retires its bubble from the ambient window
    // with the turn instead of re-serving text this session has taken in.
    if (this.#contextHooks?.onSteered) {
      void Promise.resolve(this.#contextHooks.onSteered({ conversationKey: key, messageId }))
        .catch((error) => {
          this.#logger.warn?.(
            `[dsh-im:${this.#descriptor.key}] could not retire a steered follow-up from the ambient window:`,
            error?.message ?? error,
          );
        });
    }
    return true;
  }

  /**
   * Dispatch a folded window as one turn: the merged body carries every
   * member's text, the answer targets the newest message, and the extra
   * members travel as `coalescedEventIds` so the channel ledger can retire
   * them from its ambient window before it re-serves what this turn already
   * says.
   */
  async #flushCoalesced(key) {
    const open = this.#coalescing.get(key);
    if (open === undefined) return;
    this.#coalescing.delete(key);
    if (this.#signal?.aborted) {
      for (const member of open.members) this.#acceptedMessageIds.delete(member.messageId);
      return;
    }
    const bodies = [];
    for (const member of open.members) {
      const body = cleanText(member.message.content) || controlTextOf(member.message);
      if (body && !bodies.includes(body)) bodies.push(body);
      this.#acceptedMessageIds.delete(member.messageId);
      if (!this.#state.hasSeen(member.messageId)) await this.#state.markSeen(member.messageId);
      this.#status.messagesReceived += 1;
    }
    if (bodies.length === 0) return;
    this.#status.lastMessageAt = new Date().toISOString();
    const last = open.members[open.members.length - 1];
    const merged = {
      ...last.message,
      content: bodies.join('\n\n'),
      ...(open.members.length > 1
        ? { coalescedEventIds: open.members.slice(0, -1).map((member) => member.messageId) }
        : {}),
    };
    return this.#enqueueMessage(merged, last.messageId, open.senderId, key, { alreadyRecorded: true });
  }

  #finishLocalMessage(message, messageId, reply, { recordReceived = true } = {}) {
    let task;
    task = (async () => {
      if (this.#state.hasSeen(messageId)) return;
      await this.#state.markSeen(messageId);
      if (recordReceived) {
        this.#status.messagesReceived += 1;
        this.#status.lastMessageAt = new Date().toISOString();
      }
      if (reply) await this.#bot.sendText(message.replyTarget, reply);
      this.#status.lastError = null;
    })().catch(async (error) => {
      if (this.#signal?.aborted) {
        message.statusReaction?.clear();
        return;
      }
      message.statusReaction?.error();
      this.#status.lastError = error?.message ?? String(error);
      const failure = setLastMessageFailure(this.#status, error);
      this.#logger.error?.(
        `[dsh-im:${this.#descriptor.key}] failed to process a batch input message [${failure.referenceId}]:`,
        messageFailureDiagnostic(error, failure),
      );
    }).finally(() => {
      this.#acceptedMessageIds.delete(messageId);
      this.#commandTasks.delete(task);
    });
    this.#commandTasks.add(task);
    return task;
  }

  #enqueueMessage(message, messageId, senderId, key, {
    releaseMessageId = true,
    alreadyRecorded = false,
  } = {}) {
    // Persist before the message joins the in-memory chain: the chain may wait
    // behind a long turn, and a restart in that window must not lose the input.
    const pending = this.#recordPendingMessage(message, messageId, senderId, key);
    const previous = this.#queues.get(key) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(() => pending)
      .then(() => this.#process(
        message,
        messageId,
        senderId,
        key,
        { alreadyRecorded },
      ))
      .finally(async () => {
        if (releaseMessageId) this.#acceptedMessageIds.delete(messageId);
        if (this.#queues.get(key) === current) this.#queues.delete(key);
        await this.#removePendingMessage(pendingMessageId(key, messageId));
      });
    this.#queues.set(key, current);
    return current;
  }

  /**
   * Replay (submitted: false) or report (submitted: true) the messages this
   * bridge persisted before a restart. Idempotent: each entry is removed as it
   * is handled, and the returned promise is shared with waitForIdle().
   */
  recoverPendingMessages() {
    this.#pendingRecovery ??= this.#recoverPendingMessages().catch((error) => {
      this.#logger.warn?.(
        `[dsh-im:${this.#descriptor.key}] queued-message recovery failed:`,
        error?.message ?? error,
      );
    });
    return this.#pendingRecovery;
  }

  async #recoverPendingMessages() {
    if (typeof this.#state?.pendingMessages !== 'function') return;
    const entries = this.#state.pendingMessages();
    if (!Array.isArray(entries) || entries.length === 0) return;
    for (const entry of entries) {
      if (!entry || this.#signal?.aborted) return;
      try {
        if (entry.submitted === true) {
          await this.#notifyInterruptedPending(entry);
          await this.#removePendingMessage(entry.id);
          continue;
        }
        this.#logger.warn?.(
          `[dsh-im:${this.#descriptor.key}] replaying a queued message that a restart interrupted:`,
          entry.messageId,
        );
        // The turn never reached Harness, so any earlier mark-seen is an
        // attempt, not a completed delivery; clear it so the replay can run.
        if (typeof this.#state.unmarkSeen === 'function') {
          await this.#state.unmarkSeen(entry.messageId).catch(() => undefined);
        }
        await this.#replayPendingMessage(entry);
      } catch (error) {
        this.#logger.warn?.(
          `[dsh-im:${this.#descriptor.key}] failed to recover a queued message:`,
          entry?.messageId,
          error?.message ?? error,
        );
      }
    }
  }

  #recordPendingMessage(message, messageId, senderId, key) {
    if (typeof this.#state?.putPendingMessage !== 'function') return Promise.resolve();
    const text = controlTextOf(message);
    if (!text) return Promise.resolve();
    const entry = {
      id: pendingMessageId(key, messageId),
      key,
      messageId,
      kind: message.kind === 'group' ? 'group' : 'direct',
      text,
      submitted: false,
      createdAt: new Date().toISOString(),
      ...(senderId ? { senderId } : {}),
      ...(message.replyTarget !== undefined ? { target: message.replyTarget } : {}),
    };
    return this.#state.putPendingMessage(entry).catch((error) => {
      this.#logger.warn?.(
        `[dsh-im:${this.#descriptor.key}] failed to persist a queued message:`,
        error?.message ?? error,
      );
    });
  }

  async #markPendingSubmitted(key, messageId) {
    if (typeof this.#state?.patchPendingMessage !== 'function') return;
    await this.#state.patchPendingMessage(pendingMessageId(key, messageId), { submitted: true });
  }

  async #removePendingMessage(id) {
    if (typeof this.#state?.removePendingMessage !== 'function') return;
    try {
      await this.#state.removePendingMessage(id);
    } catch (error) {
      this.#logger.warn?.(
        `[dsh-im:${this.#descriptor.key}] failed to clear a queued-message entry:`,
        error?.message ?? error,
      );
    }
  }

  #replayPendingMessage(entry) {
    const message = this.#pendingReplayMessage(entry);
    if (!message) return Promise.resolve();
    return this.#enqueueMessage(message, entry.messageId, entry.senderId ?? '', entry.key);
  }

  #pendingReplayMessage(entry) {
    const separator = String(entry.key).indexOf(':');
    if (separator < 0) return null;
    const kind = entry.key.slice(0, separator);
    const conversationId = entry.key.slice(separator + 1);
    if (!conversationId || !entry.messageId) return null;
    // Rebuild exactly the turn fields the queue path reads, so the recovered
    // text is dispatched as the user's own message with no added framing.
    return {
      messageId: entry.messageId,
      senderId: entry.senderId ?? '',
      kind: kind === 'group' ? 'group' : 'direct',
      conversationId,
      content: entry.text,
      controlText: entry.text,
      addressed: true,
      plainText: true,
      ...(entry.target !== undefined ? { replyTarget: entry.target } : {}),
    };
  }

  async #notifyInterruptedPending(entry) {
    if (entry.target === undefined || entry.target === null) {
      this.#logger.warn?.(
        `[dsh-im:${this.#descriptor.key}] a queued message was interrupted by a restart but has no delivery target:`,
        entry.messageId,
      );
      return;
    }
    try {
      await this.#bot.sendText(entry.target, t(PENDING_RESTART_NOTICE));
    } catch (error) {
      this.#logger.warn?.(
        `[dsh-im:${this.#descriptor.key}] failed to report an interrupted queued message:`,
        error?.message ?? error,
      );
    }
  }

  async #deliverDeferredOutcome(entry, outcome) {
    const text = deferredOutcomeText(outcome);
    return typeof this.#bot.sendDelivery === 'function'
      ? this.#bot.sendDelivery(entry.target, createTextDeliveryBlock(text, outcome.found ? 'markdown' : 'plain'))
      : this.#bot.sendText(entry.target, text);
  }

  async waitForIdle() {
    await this.#pendingRecovery;
    await this.#busyMessages.whenIdle();
    await Promise.allSettled([
      ...this.#queues.values(),
      ...[...this.#pendingInteractions.values()].flatMap((pending) => (
        pending.queue ? [pending.queue] : []
      )),
      ...this.#approvalTasks,
      ...this.#commandTasks,
      // An unexpired coalescing window drains through its own timer: wait out
      // its worst-case life so a shutdown never drops folded messages before
      // the flush enqueues them for the queue wait below to cover.
      ...this.#coalescing.values().map(() => new Promise((resolve) => {
        const timer = setTimeout(resolve, this.#coalesceWindowMs + 25);
        timer.unref?.();
      })),
    ]);
    await this.#deferred.whenIdle();
  }

  async #processFastCommand(message, messageId, key, runner, senderId) {
    if (this.#state.hasSeen(messageId)) return;
    await this.#state.markSeen(messageId);
    this.#status.messagesReceived += 1;
    this.#status.lastMessageAt = new Date().toISOString();
    const target = message.replyTarget;
    try {
      const result = await runner(
        controlTextOf(message),
        this.#harness,
        this.#state,
        key,
        {
          signal: this.#signal,
          isDirect: message.kind === 'direct',
          hasImages: hasInboundImages(message),
          hasFiles: hasInboundFiles(message),
          pendingInteraction: this.#pendingInteractions.has(key)
            || this.#approvals.hasPending(key),
          control: { owner: this, key },
          deferredDelivery: this.#deferred,
          enhancement: captureContextEnhancementSource(
            this.#contextEnhancement,
            message.kind,
            () => {
              const source = message.contextSource?.();
              return {
                channel: this.#descriptor.key,
                senderId,
                senderName: source?.senderName,
                conversationTitle: source?.conversationTitle,
                chatId: source?.chatId ?? message.conversationId,
                threadId: source?.threadId,
              };
            },
          ),
        },
      );
      if (result?.stopped) {
        await Promise.allSettled([
          this.#cancelPendingInteraction(key),
          this.#approvals.closeRoute(key),
        ]);
      }
      for (const reply of result?.messages ?? [result?.message]) {
        if (reply) await this.#bot.sendText(target, reply);
      }
      this.#status.lastError = null;
    } catch (error) {
      if (error?.code === 'turn-stopped' || this.#signal?.aborted) {
        message.statusReaction?.clear();
        return;
      }
      message.statusReaction?.error();
      this.#status.lastError = error?.message ?? String(error);
      const failure = setLastMessageFailure(this.#status, error);
      this.#logger.error?.(
        `[dsh-im:${this.#descriptor.key}] failed to process a command [${failure.referenceId}]:`,
        messageFailureDiagnostic(error, failure),
      );
      await this.#bot.sendText(target, messageFailureText(failure)).catch(() => undefined);
    }
  }

  sendConnectionTest(text) {
    return sendRememberedConnectionTest({
      state: this.#state,
      text,
      channelLabel: t('{label}机器人', { label: this.#descriptor.label }),
      send: (target, message) => this.#bot.sendText(target, message),
    });
  }

  sendProactiveText(target, text, { signal, format = 'plain' } = {}) {
    signal?.throwIfAborted();
    if (format === 'markdown' && typeof this.#bot.sendDelivery === 'function') {
      return this.#bot.sendDelivery(target, createTextDeliveryBlock(text, format));
    }
    return this.#bot.sendText(target, text);
  }

  async #deliverArtifacts(target, replyTo, artifacts = [], baseReceipt) {
    const delivery = await deliverOutboundArtifacts({
      artifacts,
      baseReceipt,
      deliveryId: replyTo,
      channelKey: this.#descriptor.key,
      signal: this.#signal,
      sendImage: typeof this.#bot.sendImage === 'function'
        ? (file) => this.#bot.sendImage(target, file)
        : undefined,
      sendFile: typeof this.#bot.sendFile === 'function'
        ? (file) => this.#bot.sendFile(target, file)
        : undefined,
      onFailure: (artifact, error) => setLastMessageFailure(this.#status, error, {
        userMessage: artifactFailureText(artifact?.fileName, error, this.#descriptor),
        reason: error?.code,
      }),
      sendFailureNotice: (_artifact, _error, failure) => this.#bot.sendText(
        target,
        messageFailureText(failure),
      ),
      logger: this.#logger,
    });
    this.#status.artifactsSent = (this.#status.artifactsSent ?? 0)
      + delivery.artifactsSent;
    this.#status.artifactSendErrors = (this.#status.artifactSendErrors ?? 0)
      + delivery.artifactSendErrors;
    return {
      receipt: delivery.receipt,
      userVisible: delivery.userVisible,
      artifactSendErrors: delivery.artifactSendErrors,
    };
  }

  async #process(message, messageId, senderId, conversationKey, {
    alreadyRecorded = false,
  } = {}) {
    if (!alreadyRecorded) {
      if (this.#state.hasSeen(messageId)) return;
      await this.#state.markSeen(messageId);
      this.#status.messagesReceived += 1;
      this.#status.lastMessageAt = new Date().toISOString();
    }

    const target = message.replyTarget;
    const text = controlTextOf(message);
    const batchSubmission = message.batchSubmission;
    let stream = null;
    let semanticStream = false;
    // Thinking streams accept the same delivery-block contract as semantic
    // streams: finish() must receive { text, format } so a markdown answer
    // renders rich instead of falling back to plain text.
    let thinkingStream = false;
    // A keepalive heartbeat keeps short-lived carriers (e.g. Telegram's
    // private-chat Rich Draft) visible during long silent stretches such as a
    // running tool call. Declared outside the try so every exit path (including
    // pre-prompt failures like image parsing) clears the timer.
    let keepaliveTimer = null;
    const stopKeepalive = () => {
      if (keepaliveTimer !== null) clearInterval(keepaliveTimer);
      keepaliveTimer = null;
    };
    try {
      this.#signal?.throwIfAborted();
      if (message.kind === 'group' && message.addressed !== true) {
        this.#status.messagesRejected += 1;
        this.#status.lastRejectedAt = new Date().toISOString();
        return;
      }
      const hasImages = hasInboundImages(message);
      const hasFiles = hasInboundFiles(message);
      const hasReply = hasReplyReference(message);
      if (!text && !hasImages && !hasFiles && !hasReply) {
        await this.#bot.sendText(target, t('目前支持文字、图片和文件消息。'));
        return;
      }
      const command = text.toLowerCase();
      if (!hasImages && !hasFiles && command === '/help') {
        await this.#bot.sendText(target, [
          t('{label}机器人已连接 DeepSeek Harness。', { label: this.#descriptor.label }),
          '',
          t('直接发送文字、图片或文件即可继续当前会话。'),
          ...commandHelpLines(this.#descriptor.key, availableCommandCatalog(SHARED_COMMAND_CATALOG, {
            supportsFork: this.#harness.supportsSessionFork?.() ?? true,
          })),
        ].join('\n'));
        return;
      }
      if (!hasImages && !hasFiles && command === '/status') {
        const status = await runStatusCommand({
          descriptor: this.#descriptor,
          harness: this.#harness,
          state: this.#state,
          conversationKey,
          signal: this.#signal,
        });
        await this.#bot.sendText(target, status.message);
        return;
      }
      const workspaceCommand = !hasImages && !hasFiles
        ? await runWorkspaceCommand(text, this.#harness, conversationKey)
        : null;
      if (workspaceCommand && await this.#presentWorkspaceCommand(
        target, workspaceCommand, conversationKey,
      )) return;
      if (workspaceCommand) {
        for (const reply of workspaceCommand.messages ?? [workspaceCommand.message]) {
          await this.#bot.sendText(target, reply);
        }
        return;
      }
      if (!hasImages && !hasFiles && isNewCommand(text)) {
        const receipt = await startNewConversation({
          state: this.#state,
          harness: this.#harness,
          key: conversationKey,
          title: newCommandTitle(text),
        });
        if (this.#contextHooks?.onSessionCleared) {
          try {
            await this.#contextHooks.onSessionCleared(conversationKey);
          } catch (error) {
            // The cleared session is already done; a failed context reset must not block the command.
            this.#logger.warn?.(`[dsh-im:${this.#descriptor.key}] failed to reset context anchors after /new:`, error?.message ?? error);
          }
        }
        await this.#bot.sendText(target, `${receipt}\n${t('请发送你的问题。')}`);
        return;
      }
      if (!hasImages && !hasFiles && isSessionNavCommand(text)) {
        const result = await runSessionNavCommand(
          text,
          this.#harness,
          this.#state,
          conversationKey,
          { signal: this.#signal, isDirect: message.kind === 'direct' },
        );
        if (result) {
          await this.#presentSessionNavResult(target, result);
          if (result.askText) {
            // /go N <text>, /prev <text>, /next <text>: switch, then submit the
            // remainder through the ordinary prompt path. Never await the queued
            // follow-up here — we are inside the queue's own job, so awaiting the
            // next job deadlocks. The queue runs it right after this job returns.
            const followUp = this.#enqueueMessage(
              {
                ...message,
                controlText: result.askText,
                content: result.askText,
                images: undefined,
                files: undefined,
                replyTo: undefined,
                batchSubmission: undefined,
              },
              `${messageId}-ask`,
              senderId,
              conversationKey,
            );
            followUp.catch((error) => {
              this.#logger.warn?.(
                `[dsh-im:${this.#descriptor.key}] follow-up ask after a nav command failed:`,
                error?.message ?? error,
              );
              this.#bot.sendText(target, t('切换后的提问发送失败，请重试。')).catch(() => undefined);
            });
          }
        }
        return;
      }
      const compactCommand = !hasImages && !hasFiles
        ? await runCompactCommand(
            text,
            this.#harness,
            this.#state,
            conversationKey,
            { signal: this.#signal },
          )
        : null;
      if (compactCommand) {
        await this.#bot.sendText(target, compactCommand.message);
        return;
      }

      await this.#bot.sendTyping?.(target).catch((error) => {
        this.#logger.warn?.(`[dsh-im:${this.#descriptor.key}] typing indicator failed:`, error);
      });
      let streamFinished = false;
      if (this.#thinkingTraces && typeof this.#bot.openThinkingStream === 'function') {
        try {
          stream = await this.#bot.openThinkingStream(this.#turnDeliveryTarget(target, conversationKey));
          thinkingStream = true;
        } catch (error) {
          stream = null;
          this.#logger.warn?.(
            `[dsh-im:${this.#descriptor.key}] unable to start a thinking stream; using final delivery:`,
            error,
          );
        }
      }
      if (!stream) {
        if (typeof this.#bot.openDeliveryStream === 'function') {
          try {
            stream = await this.#bot.openDeliveryStream(this.#turnDeliveryTarget(target, conversationKey));
            semanticStream = true;
          } catch (error) {
            this.#logger.warn?.(
              `[dsh-im:${this.#descriptor.key}] unable to start a semantic reply stream; using final delivery:`,
              error,
            );
          }
        } else if (typeof this.#bot.openStream === 'function') {
          try {
            stream = await this.#bot.openStream(this.#turnDeliveryTarget(target, conversationKey));
          } catch (error) {
            this.#logger.warn?.(
              `[dsh-im:${this.#descriptor.key}] unable to start a streamed reply; using text:`,
              error,
            );
          }
        }
      }
      const thinkingMode = Boolean(stream
        && this.#thinkingTraces
        && typeof stream.sendToolTrace === 'function');
      // What the model sees. A message may carry two texts: `controlText`, the
      // plain body the parsers read, and `content`, the same body decorated for
      // the model — the email channel prefixes the mail headers there, so a
      // subject-only instruction is not silently dropped. Falling back to the
      // parsed text kept commands working but lost that decoration entirely.
      let content = hasImages || hasReply
        ? await promptContentForInboundMessage(message, { signal: this.#signal, deferImages: true })
        : cleanText(message.content) || undefined;
      // A room conversation is shared by everyone who addresses the bot in it, so
      // the delivered prompt says whose turn this is. Only the model-facing content
      // is labelled; the parsed control text, commands, and ledger keys keep the
      // unlabelled body they were read from.
      if (message.kind === 'group') content = prependSpeakerLabel(content, message.speakerName);
      const snapshot = this.#acceptedMessageIds.get(messageId);
      let contextEnhanced = false;
      // contextSource() is enhancement-only: it is read here, under an enabled
      // snapshot, and nowhere else. The author record below reuses this read.
      let contextSource = null;
      if (snapshot) {
        const originalContent = content ?? text;
        contextSource = message.contextSource?.() ?? null;
        content = enhanceContextContent(originalContent, snapshot, () => ({
          channel: this.#descriptor.key,
          senderId,
          senderName: contextSource?.senderName,
          conversationTitle: contextSource?.conversationTitle,
          chatId: contextSource?.chatId ?? message.conversationId,
          threadId: contextSource?.threadId,
        }));
        contextEnhanced = content !== originalContent;
      }
      // Collected after command handling so control commands never pay for a
      // context lookup, and only for a plain-text prompt: a composed or media
      // payload already carries its own structure and stays untouched.
      let contextEntries = null;
      if (this.#contextHooks?.collect && this.#contextHooks.enabled?.() !== false && !batchSubmission
        && (content === undefined || typeof content === 'string') && !hasImages && !hasFiles) {
        try {
          const collected = await this.#contextHooks.collect({
            message,
            conversationKey,
            sessionIdHint: this.#state.sessionFor?.(conversationKey) ?? null,
          });
          if (Array.isArray(collected) && collected.length > 0) {
            contextEntries = collected;
            const block = this.#contextHooks.render?.(collected) ?? '';
            if (block) content = `${block}\n\n${content ?? ''}`;
          }
        } catch (error) {
          // Context is an enhancement: a collector failure must not lose the user's own turn.
          this.#logger.warn?.(`[dsh-im:${this.#descriptor.key}] context collection failed; prompting without context:`, error?.message ?? error);
        }
      }
      // Start the keepalive only after the inbound payload is ready, so a
      // pre-prompt failure (image parsing, context building) cannot leave the
      // timer running; the outermost finally below clears it on every path.
      if (stream && stream.keepalive === true && typeof stream.refresh === 'function') {
        let refreshing = false;
        keepaliveTimer = setInterval(async () => {
          // Skip ticks while the previous heartbeat is pending so redundant
          // refreshes cannot queue ahead of the final answer on a slow network.
          if (refreshing) return;
          refreshing = true;
          try {
            await Promise.allSettled([
              this.#bot.sendTyping?.(target),
              stream.refresh(),
            ]);
          } catch {
            // Keepalive is best-effort, including synchronous adapter failures.
          } finally {
            refreshing = false;
          }
        }, this.#keepaliveIntervalMs);
        keepaliveTimer.unref?.();
      }
      // From here the conversation has a turn in flight that this sender
      // opened: the auto-steer lane keys its authorship decision off this
      // record, and the finally below retires it when the turn settles.
      this.#turnAuthors.set(conversationKey, { senderId, steered: 0, turnMessageId: messageId });
      // Persist who spoke here last, so a later describeConversation() can name
      // the sender of a group turn without replaying any message text. Channels
      // that own a different state store simply skip it.
      // The sender id and bot flag are always kept. A display name is kept only
      // when the channel already exposes it (Matrix speakerName) or context
      // enhancement read it above; a disabled enhancement never leaks names.
      try {
        await this.#state.rememberAuthor?.(conversationKey, {
          senderId,
          senderName: message.senderName ?? message.speakerName ?? contextSource?.senderName,
          senderUsername: message.senderUsername ?? contextSource?.senderUsername,
          isBot: message.senderIsBot === true,
        });
      } catch (error) {
        this.#logger.warn?.(`[dsh-im:${this.#descriptor.key}] unable to remember the conversation author:`, error?.message ?? error);
      }
      // The prompt is about to enter the Harness inbox, which is itself durable.
      // Marking the entry submitted first means a crash after this point reports
      // the message instead of replaying a turn the Harness may already own.
      await this.#markPendingSubmitted(conversationKey, messageId);
      const { sessionId, answer, artifacts = [] } = await askInWorkspaceSession({
        onNotice: (notice) => this.#bot.sendText(target, notice),
        deferredDelivery: () => ({ coordinator: this.#deferred, target: this.#descriptor.key === 'whatsapp' ? { jid: target.jid, selfChat: target.selfChat } : target }),
        harness: this.#harness,
        state: this.#state,
        key: conversationKey,
        text,
        content,
        titleText: batchSubmission?.title,
        sourceGuidance: snapshot?.config?.guidance,
        contextEnhanced,
        createOptions: this.#signal ? { signal: this.#signal } : undefined,
        existsOptions: this.#signal ? { signal: this.#signal } : undefined,
        askOptions: {
          groupHistory: message.groupHistory,
          timeoutMs: this.#replyTimeoutMs,
          signal: this.#signal,
          control: { owner: this, key: conversationKey },
          // Thinking mode needs every update (reasoning + tool calls) in
          // order; latest mode filters as before. Only thinking mode subscribes
          // to reasoning updates, so default-mode consumers on other channels
          // never see them (their progress handlers would render update.text).
          progressMode: thinkingMode ? 'all' : undefined,
          reasoning: thinkingMode,
          onUpdate: stream ? async (update) => {
            if (thinkingMode) {
              // Only the 💭 and 🔧 lines are surfaced; status/text updates
              // and the assistant-message canonical text are not.
              if (update.type === 'reasoning') {
                await stream.sendThinking(update.text);
              } else if (update.type === 'tool') {
                await stream.sendToolTrace(update.name, update.arguments);
              }
              return;
            }
            if (update.type === 'reasoning') return;
            // A carrier that delivers the answer as its own message must not
            // stream that answer into itself first: the reader would see the
            // reply twice, and every preview costs an edit.
            if (update.type === 'text' && stream.previewAnswer === false) return;
            const progress = update.type === 'text' ? update.text
              : update.type === 'tool' ? t('正在使用{name}…', { name: update.name }) : update.text;
            if (progress) {
              const format = update.type === 'text' ? 'markdown' : 'plain';
              await stream.update(semanticStream
                ? createTextDeliveryBlock(progress, format)
                : progress);
            }
          } : undefined,
          onInteraction: async (interaction) => {
            if (stream?.keepalive === true && typeof stream.stopPreview === 'function') {
              stopKeepalive();
              await stream.stopPreview();
            }
            return this.#handleInteraction(interaction, {
              key: conversationKey,
              actor: senderId,
              target,
              requiresMention: message.kind === 'group' && message.requiresMention !== false,
            });
          },
          onInteractionResolved: (resolution) => this.#handleInteractionResolved(resolution),
          files: message.files,
          images: message.images,
        },
      });
      stopKeepalive();
      if (batchSubmission) {
        this.#batches.complete(conversationKey, batchSubmission.token);
      }
      // The completed turn consumed its context: ambient records stop being offered
      // and a thread-root anchor is stamped for this session. A failed ask throws
      // past this point, so a failed turn re-offers its context on the next message.
      if (contextEntries && this.#contextHooks?.onConsumed) {
        try {
          await this.#contextHooks.onConsumed({ conversationKey, sessionId, entries: contextEntries });
        } catch (error) {
          this.#logger.warn?.(`[dsh-im:${this.#descriptor.key}] context consumption marking failed:`, error?.message ?? error);
        }
      }
      const fileOnlyCompletion = !cleanText(answer) && artifacts.length > 0;
      const visibleAnswer = fileOnlyCompletion
        ? t(FILE_ONLY_COMPLETION_TEXT)
        : answer;
      const answerFormat = fileOnlyCompletion ? 'plain' : 'markdown';
      let textDeliveryError = null;
      let textReceipt = null;
      // What the channel observed about the send itself; it is written to the
      // log together with the reference id the user is shown.
      let deliveryEvidence = null;
      if (stream) {
        try {
          const result = await stream.finish(semanticStream || thinkingStream
            ? createTextDeliveryBlock(visibleAnswer, answerFormat)
            : visibleAnswer);
          streamFinished = true;
          deliveryEvidence = result?.deliveryEvidence ?? deliveryEvidence;
          textReceipt = createDeliveryReceipt({
            deliveryId: messageId,
            presentation: result?.presentation
              ?? stream.presentation
              ?? `${this.#descriptor.key}-stream`,
            providerMessageIds: [
              ...providerMessageIdsFor(stream),
              ...providerMessageIdsFor(result),
            ],
            deliveryOutcome: result?.deliveryOutcome,
            reason: result?.reason,
          });
        } catch (error) {
          stream.cancel?.();
          this.#logger.warn?.(
            `[dsh-im:${this.#descriptor.key}] streamed reply finalization failed; using text:`,
            error,
          );
        }
      }
      if (!streamFinished) {
        try {
          const answerTarget = this.#turnDeliveryTarget(target, conversationKey);
          const result = typeof this.#bot.sendDelivery === 'function'
            ? await this.#bot.sendDelivery(
                answerTarget,
                createTextDeliveryBlock(visibleAnswer, answerFormat),
              )
            : await this.#bot.sendText(answerTarget, visibleAnswer);
          deliveryEvidence = result?.deliveryEvidence ?? deliveryEvidence;
          textReceipt = createDeliveryReceipt({
            deliveryId: messageId,
            presentation: result?.presentation ?? `${this.#descriptor.key}-text`,
            providerMessageIds: providerMessageIdsFor(result),
            deliveryOutcome: result?.deliveryOutcome,
            reason: result?.reason,
          });
        } catch (error) {
          textDeliveryError = channelDeliveryFailure(error);
          deliveryEvidence = error?.deliveryEvidence ?? deliveryEvidence;
        }
      }
      const finalDeliveryUnknown = textReceipt?.deliveryOutcome === 'unknown';
      if (textReceipt?.deliveryOutcome === 'failed') {
        textDeliveryError = channelDeliveryFailure(
          Object.assign(new Error('Final text delivery failed'), { code: textReceipt.reason }),
          { uncertain: false },
        );
      } else if (finalDeliveryUnknown) {
        textDeliveryError = channelDeliveryFailure(
          Object.assign(new Error('Final text delivery outcome is unknown'), { code: textReceipt.reason }),
        );
      }
      if (textDeliveryError && deliveryEvidence) {
        // The catch further down reports this error, and the log line must
        // carry the same evidence the channel recorded for the failed send.
        textDeliveryError.deliveryEvidence = deliveryEvidence;
      }
      // A failed final text must not discard an already registered result file.
      // Settle the independent attachment path before surfacing the text error.
      const delivery = await this.#deliverArtifacts(target, messageId, artifacts, textReceipt);
      if (textDeliveryError && (!delivery.userVisible || finalDeliveryUnknown)) {
        textDeliveryError.deliveryReceipt = delivery.receipt;
        throw textDeliveryError;
      }
      if (textDeliveryError && delivery.artifactSendErrors === 0) {
        const failure = setLastMessageFailure(this.#status, textDeliveryError);
        logDeliveryFailure(this.#logger, this.#descriptor.key, failure, textDeliveryError.deliveryEvidence);
      }
      if (delivery.userVisible) {
        this.#status.messagesReplied += 1;
        this.#status.lastReplyAt = new Date().toISOString();
        this.#status.lastError = null;
        if (!textDeliveryError && delivery.artifactSendErrors === 0) {
          clearLastMessageFailure(this.#status);
        }
      }
      // The turn produced an answer, so its retry budget is spent and reset.
      this.#deliveryAttempts.delete(messageId);
      if (this.#contextHooks?.onDelivered) {
        const deliveredEventIds = [
          ...new Set([
            ...(Array.isArray(textReceipt?.providerMessageIds) ? textReceipt.providerMessageIds : []),
            ...(Array.isArray(delivery.receipt?.providerMessageIds) ? delivery.receipt.providerMessageIds : []),
          ]),
        ];
        if (deliveredEventIds.length > 0) {
          try {
            await this.#contextHooks.onDelivered({ conversationKey, sessionId, providerMessageIds: deliveredEventIds });
          } catch (error) {
            // A missing binding only costs reply classification quality for these events; the answer itself reached the room.
            this.#logger.warn?.(`[dsh-im:${this.#descriptor.key}] bot event binding recording failed:`, error?.message ?? error);
          }
        }
      }
      return delivery.receipt;
    } catch (error) {
      stopKeepalive();
      const turnStopped = error?.code === 'turn-stopped';
      if (batchSubmission && turnStopped) {
        this.#batches.complete(conversationKey, batchSubmission.token);
      }
      const failedBatch = batchSubmission && !turnStopped
        ? this.#batches.fail(conversationKey, batchSubmission.token)
        : null;
      if (turnStopped) {
        message.statusReaction?.clear();
        if (stream) {
          try {
            await stream.finish(t('已停止。'));
          } catch {
            stream.cancel?.();
          }
        }
        return;
      }
      if (this.#signal?.aborted) {
        message.statusReaction?.clear();
        stream?.cancel?.();
        return;
      }
      message.statusReaction?.error();
      this.#status.lastError = error?.message ?? String(error);
      const presentStreamFailure = async (text) => {
        const method = typeof stream?.fail === 'function'
          ? 'fail'
          : (typeof stream?.finish === 'function' ? 'finish' : null);
        if (!method) return false;
        try {
          const result = await stream[method](text);
          return method === 'fail'
            ? Boolean(result) && result.deliveryOutcome !== 'failed'
            : result !== false && result?.deliveryOutcome !== 'failed';
        } catch (streamError) {
          this.#logger.warn?.(
            `[dsh-im:${this.#descriptor.key}] unable to finalize the failed stream:`,
            streamError,
          );
          return false;
        }
      };
      const imageErrorMessage = imagePromptUserMessage(error);
      const fileErrorMessage = inboundFileUserMessage(error);
      const failure = setLastMessageFailure(this.#status, error, {
        userMessage: fileErrorMessage ?? imageErrorMessage,
        reason: imagePromptDiagnostic(error)?.reason,
      });
      const failureText = failedBatch?.retained
        ? `${messageFailureText(failure)}\n\n${failedBatch.message}`
        : messageFailureText(failure);
      this.#logger.error?.(
        `[dsh-im:${this.#descriptor.key}] failed to process a message [${failure.referenceId}]:`,
        messageFailureDiagnostic(error, failure),
      );
      // One line per failed or unconfirmed delivery, carrying the same id the
      // user will quote back: a reference id nobody can grep is useless.
      logDeliveryFailure(this.#logger, this.#descriptor.key, failure, error?.deliveryEvidence);
      if (await presentStreamFailure(failureText)) {
        return error.deliveryReceipt;
      }
      stream?.cancel?.();
      try {
        await this.#bot.sendText(target, failureText);
      } catch (sendError) {
        this.#logger.error?.(
          `[dsh-im:${this.#descriptor.key}] failed to send the safe error reply:`,
          sendError,
        );
      }
      // The turn produced no answer, so this id is "attempted", not "handled".
      // Releasing the mark lets the next poll retry it; `alreadyRecorded` means
      // an outer caller owns the mark, so it is left alone there.
      if (!alreadyRecorded) await this.#releaseFailedDelivery(messageId);
      return error.deliveryReceipt;
    } finally {
      stopKeepalive();
      const inFlight = this.#turnAuthors.get(conversationKey);
      if (inFlight?.turnMessageId === messageId) this.#turnAuthors.delete(conversationKey);
      await Promise.allSettled([
        this.#cancelPendingInteraction(conversationKey),
        this.#approvals.closeRoute(conversationKey),
      ]);
    }
  }

  /**
   * Release the `markSeen` of a turn that failed without delivering anything,
   * so the next poll can pick the message up again.
   *
   * Bounded: a message is retried at most `MAX_DELIVERY_ATTEMPTS` times, after
   * which the mark stays and the id becomes a tombstone. That keeps a mail that
   * always fails from being re-executed forever, while a transient Harness
   * outage no longer drops it permanently.
   *
   * Returns true when the message was released and will be retried.
   */
  async #releaseFailedDelivery(messageId) {
    const attempts = (this.#deliveryAttempts.get(messageId) ?? 0) + 1;
    if (attempts >= MAX_DELIVERY_ATTEMPTS) {
      // Give up: keep the mark so the id is never replayed, and stop tracking
      // it. The sender has already been told the turn failed.
      this.#deliveryAttempts.delete(messageId);
      this.#logger.warn?.(
        `[dsh-im:${this.#descriptor.key}] giving up on a message after `
        + `${attempts} failed delivery attempts; it will not be retried.`,
      );
      return false;
    }
    this.#deliveryAttempts.set(messageId, attempts);
    if (typeof this.#state?.unmarkSeen !== 'function') return false;
    try {
      await this.#state.unmarkSeen(messageId);
      return true;
    } catch (error) {
      this.#logger.warn?.(
        `[dsh-im:${this.#descriptor.key}] unable to release a failed message for retry:`,
        error,
      );
      return false;
    }
  }

  /**
   * Advance the pending interaction with one answer.
   *
   * `resolveAnswer` lets a caller that already knows the exact answer supply it
   * directly. A button press uses this: replaying its label as reply text would
   * re-parse a numeric label such as "2" as the second option, submitting a
   * different option than the one pressed.
   */
  async #processInteractionReply(
    message,
    messageId,
    senderId,
    key,
    expected,
    { resolveAnswer } = {},
  ) {
    if (this.#signal?.aborted) {
      message.statusReaction?.clear();
      return;
    }
    const current = this.#pendingInteractions.get(key);
    const claimed = expected.claimedReplyMessageId === messageId;
    if (!current || current !== expected || current.submitting) {
      if (claimed && (!current || current !== expected)) {
        return this.#discardResolvedInteractionReply(message, messageId);
      }
      return this.#enqueueMessage(message, messageId, senderId, key, {
        releaseMessageId: false,
      });
    }
    if (this.#state.hasSeen(messageId)) return;
    await this.#state.markSeen(messageId);
    this.#status.messagesReceived += 1;
    this.#status.lastMessageAt = new Date().toISOString();

    if (message.kind === 'group' && message.addressed !== true) {
      this.#status.messagesRejected += 1;
      this.#status.lastRejectedAt = new Date().toISOString();
      return;
    }

    const target = message.replyTarget;
    const text = controlTextOf(message);
    if (!text || hasInboundImages(message) || hasInboundFiles(message)) {
      try {
        await this.#bot.sendText(target, t('请用文字回答当前问题。'));
      } catch (error) {
        this.#logger.error?.(
          `[dsh-im:${this.#descriptor.key}] failed to reject a non-text interaction reply:`,
          error,
        );
      }
      return;
    }

    const pending = this.#pendingInteractions.get(key);
    if (!pending || pending !== expected || pending.submitting) {
      if (claimed && (!pending || pending !== expected)) {
        return this.#discardResolvedInteractionReply(message, messageId, {
          alreadyRecorded: true,
        });
      }
      return this.#enqueueMessage(message, messageId, senderId, key, {
        releaseMessageId: false,
        alreadyRecorded: true,
      });
    }
    pending.target = target;
    if (pending.needsPresentation) {
      const presentationWasInFlight = pending.presentationTask !== null;
      try {
        await this.#presentInteraction(pending);
      } catch (error) {
        message.statusReaction?.error();
        this.#status.lastError = t('{label}交互问题发送失败。', { label: this.#descriptor.label });
        this.#logger.error?.(
          `[dsh-im:${this.#descriptor.key}] failed to retry an interaction question:`,
          error,
        );
        pending.interaction.reconnect?.();
        return;
      }
      const presented = this.#pendingInteractions.get(key);
      if (!presented || presented !== expected || presented.submitting) {
        if (claimed && (!presented || presented !== expected)) {
          return this.#discardResolvedInteractionReply(message, messageId, {
            alreadyRecorded: true,
          });
        }
        return this.#enqueueMessage(message, messageId, senderId, key, {
          releaseMessageId: false,
          alreadyRecorded: true,
        });
      }
      // A reply can arrive after the platform accepted the question message but
      // before its send promise settles. In that case it is already a valid
      // answer. A message which itself retried a failed presentation is not.
      if (!presentationWasInFlight) return;
    }

    const question = pending.questions[pending.index];
    if (!question) return;
    const answer = typeof resolveAnswer === 'function'
      ? resolveAnswer(question)
      : harnessAnswerForQuestion(question, text);
    if (!answer) return;
    // Retire this question's keyboard before moving on: the answer is already in,
    // and a card left behind in the chat stays pressable after the batch advances.
    await this.#retireInteractionCard(pending.target, pending.cardMessageId);
    pending.cardMessageId = null;
    pending.answers.push(answer);
    pending.index += 1;
    if (pending.index < pending.questions.length) {
      if (pending.claimedReplyMessageId === messageId) {
        pending.claimedReplyMessageId = null;
      }
      pending.needsPresentation = true;
      try {
        await this.#presentInteraction(pending);
      } catch (error) {
        message.statusReaction?.error();
        this.#status.lastError = t('{label}交互问题发送失败。', { label: this.#descriptor.label });
        this.#logger.error?.(
          `[dsh-im:${this.#descriptor.key}] failed to send the next interaction question:`,
          error,
        );
        pending.interaction.reconnect?.();
      }
      return;
    }

    pending.submitting = true;
    try {
      await pending.interaction.respond({
        ok: true,
        value: {
          sessionId: pending.sessionId,
          answer: { answers: pending.answers },
        },
      });
      this.#clearPendingInteraction(key, pending.interactionId);
      this.#status.lastError = null;
    } catch (error) {
      if (error?.code === 'interaction-not-pending') {
        this.#clearPendingInteraction(key, pending.interactionId);
        if (this.#signal?.aborted) {
          message.statusReaction?.clear();
          return;
        }
        try {
          await this.#bot.sendText(target, t(INTERACTION_RESOLVED_TEXT));
        } catch (sendError) {
          this.#logger.error?.(
            `[dsh-im:${this.#descriptor.key}] failed to send an expired interaction notice:`,
            sendError,
          );
        }
        return;
      }
      if (this.#signal?.aborted) {
        message.statusReaction?.clear();
        return;
      }
      if (this.#pendingInteractions.get(key) !== pending) {
        message.statusReaction?.clear();
        return;
      }
      message.statusReaction?.error();
      pending.submitting = false;
      pending.answers.pop();
      pending.index -= 1;
      this.#status.lastError = t('回答提交失败。');
      this.#logger.error?.(
        `[dsh-im:${this.#descriptor.key}] failed to answer a Harness interaction:`,
        error,
      );
      try {
        await this.#bot.sendText(target, t('回答提交失败，请重新发送当前问题的答案。'));
      } catch (sendError) {
        this.#logger.error?.(
          `[dsh-im:${this.#descriptor.key}] failed to send an interaction retry notice:`,
          sendError,
        );
      }
    }
  }

  /** Acknowledge a press so the client stops its spinner; never fails the answer. */
  async #answerInteractionCallback(callback, text) {
    if (typeof this.#bot.answerInteractionCallback !== 'function') return;
    try {
      await this.#bot.answerInteractionCallback(callback.callbackQueryId, text);
    } catch (error) {
      this.#logger.warn?.(
        `[dsh-im:${this.#descriptor.key}] could not acknowledge a button press:`,
        error?.message ?? error,
      );
    }
  }

  /** Drop a handled card's keyboard so the same press cannot be submitted twice. */
  async #retireInteractionCard(target, providerMessageId) {
    if (!providerMessageId || typeof this.#bot.updateInteractionCard !== 'function') return;
    try {
      await this.#bot.updateInteractionCard(target, providerMessageId, {
        markup: { inline_keyboard: [] },
      });
    } catch (error) {
      this.#logger.warn?.(
        `[dsh-im:${this.#descriptor.key}] could not retire an interaction card:`,
        error?.message ?? error,
      );
    }
  }

  /**
   * Accept an inline-keyboard press. The press is replayed as the option label the
   * text flow already understands, so a button and a typed reply share one
   * submission path and cannot drift apart.
   */
  async acceptCallback(callback) {
    if (this.#signal?.aborted) return;
    const conversationId = cleanText(callback?.conversationId);
    const senderId = cleanText(callback?.senderId);
    const messageId = cleanText(callback?.messageId);
    if (!conversationId || !senderId || !messageId || callback?.senderIsBot === true) return;
    const kind = callback.kind === 'group' ? 'group' : 'direct';
    const key = `${kind}:${conversationId}`;
    // The /tail preview "Hide" button is a stateless delete of the bot's own
    // message; route its namespace before any interaction bookkeeping.
    if (typeof callback?.data === 'string' && callback.data.startsWith(TAIL_HIDE_CALLBACK_PREFIX)) {
      return this.#handleTailHidePress(callback, callback.data.slice(TAIL_HIDE_CALLBACK_PREFIX.length));
    }
    // Workspace pickers are stateless cards, not pending questions: route their
    // namespace before the question bookkeeping so a press can never touch it.
    const workspacePress = this.#workspaceCard?.parse?.(callback.data) ?? null;
    if (workspacePress) return this.#handleWorkspaceCardPress(callback, key, workspacePress);
    // Approval cards own their callback namespace; every other press keeps using
    // the question-card path below. The card acknowledges the press itself (the
    // ack must be the first round-trip), so this branch runs before any other
    // work in acceptCallback.
    if (this.#approvalCard && typeof this.#approvalCard.handlePress === 'function') {
      const handled = await this.#approvalCard.handlePress(callback, {
        bot: this.#bot,
        answer: (text) => this.#answerInteractionCallback(callback, text),
        submit: (approvalId, outcome, options) => (
          this.#approvals.submitByApprovalId(approvalId, outcome, options)
        ),
      }).catch((error) => {
        this.#logger.error?.(
          `[dsh-im:${this.#descriptor.key}] failed to handle an approval card press:`,
          error,
        );
        return false;
      });
      if (handled) return;
    }
    const pending = this.#pendingInteractions.get(key);
    const notice = (text) => this.#answerInteractionCallback(callback, text);
    if (!pending) return notice(t('该问题已处理，无需再次选择。'));
    if (pending.actor !== senderId) {
      return notice(t('只有发起当前任务的用户可以处理这条问题。'));
    }
    // A press can arrive while an earlier one is still being submitted: the
    // acknowledgement round-trip is a real window, and a user who sees no feedback
    // presses again. Claim synchronously, before the first await, so the second
    // press cannot advance the same question twice.
    if (pending.submitting || pending.callbackClaimed) {
      return notice(t('正在提交你的选择，请稍候。'));
    }

    const question = pending.questions[pending.index];
    const parsed = this.#interactionCard?.parse?.(callback.data) ?? null;
    const option = parsed && Array.isArray(question?.options)
      ? question.options[parsed.optionIndex]
      : undefined;
    if (!question || !parsed
      || !pending.cardNonce || parsed.nonce !== pending.cardNonce
      || parsed.questionIndex !== pending.index
      || !option || typeof option.label !== 'string') {
      return notice(t('这个选项已失效，请使用最新一条问题。'));
    }
    // Multi-select needs a keyboard that accumulates choices and a submit action;
    // until that exists the request keeps the text answer it has always accepted.
    if (question.multiSelect === true) {
      return notice(t('多选问题请直接回复文字。'));
    }

    pending.callbackClaimed = true;
    // A press can beat the card's own send promise — Telegram delivers the update
    // as soon as its API accepted the keyboard. Wait for delivery so the card id
    // exists and the shared submission path can retire its keyboard.
    await pending.presentationTask?.catch(() => undefined);
    await notice(t('已选择：{label}', { label: option.label }));
    await this.#processInteractionReply(
      {
        kind,
        conversationId,
        messageId,
        senderId,
        addressed: true,
        content: option.label,
        replyTarget: callback.replyTarget ?? pending.target,
        statusReaction: null,
      },
      messageId,
      senderId,
      key,
      pending,
      // The press already identifies its option by index, so answer with that
      // exact label. Replaying the label as reply text would re-parse a numeric
      // label such as "2" as the second option and submit a different one.
      { resolveAnswer: (current) => ({ id: current.id, selected: [option.label] }) },
    ).catch((error) => {
      this.#logger.error?.(
        `[dsh-im:${this.#descriptor.key}] failed to submit a card answer:`,
        error,
      );
    }).finally(() => {
      // A failed submission rolls the question back, so let the user press again.
      if (this.#pendingInteractions.get(key) === pending) pending.callbackClaimed = false;
    });
  }

  /**
   * Render a session-navigation command result. Text replies are split and sent
   * as-is; a /tail preview may carry a Hide button on button-capable channels;
   * a /tail export is delivered as a document on file-capable channels.
   */
  async #presentSessionNavResult(target, result) {
    if (result?.document) {
      if (documentSendSupported(this.#descriptor.key, this.#bot)) {
        try {
          await this.#bot.sendFile(target, {
            fileName: result.document.fileName,
            mediaType: result.document.mediaType,
            bytes: Buffer.from(result.document.content, 'utf8'),
          });
          return;
        } catch (error) {
          this.#logger.warn?.(
            `[dsh-im:${this.#descriptor.key}] failed to send the /tail export:`,
            error?.message ?? error,
          );
        }
      }
      await this.#bot.sendText(target, t('当前渠道不支持发送文件。'));
      return;
    }
    if (result?.hide === true && buttonPreviewSupported(this.#descriptor.key, this.#bot)) {
      await this.#sendTailPreviewWithHide(target, result);
      return;
    }
    for (const reply of result?.messages ?? [result?.message]) {
      if (reply) await this.#bot.sendText(target, reply);
    }
  }

  /** Send a /tail preview with a single Hide button, falling back to plain text. */
  async #sendTailPreviewWithHide(target, result) {
    const nonce = createActionNonce(6);
    const markup = {
      inline_keyboard: [[{ text: t('隐藏消息'), callback_data: `${TAIL_HIDE_CALLBACK_PREFIX}${nonce}` }]],
    };
    let sent;
    try {
      sent = await this.#bot.sendInteractionCard(target, { text: result.message, markup });
    } catch (error) {
      this.#logger.warn?.(
        `[dsh-im:${this.#descriptor.key}] unable to send the /tail preview card; falling back to text:`,
        error?.message ?? error,
      );
      for (const reply of result.messages ?? [result.message]) {
        if (reply) await this.#bot.sendText(target, reply);
      }
      return;
    }
    const messageId = Array.isArray(sent?.providerMessageIds) && sent.providerMessageIds.length > 0
      ? String(sent.providerMessageIds[0])
      : undefined;
    if (messageId) this.#tailPreviewMessages.set(nonce, { target, messageId });
  }

  /** Hide a /tail preview by deleting the bot's own message. Best-effort. */
  async #handleTailHidePress(callback, nonce) {
    const entry = this.#tailPreviewMessages.get(nonce);
    if (entry) this.#tailPreviewMessages.delete(nonce);
    await this.#answerInteractionCallback(callback, t('已隐藏。'));
    if (!entry?.messageId || typeof this.#bot.deleteMessage !== 'function') return;
    try {
      await this.#bot.deleteMessage(entry.target, entry.messageId);
    } catch (error) {
      this.#logger.warn?.(
        `[dsh-im:${this.#descriptor.key}] unable to delete a /tail preview:`,
        error?.message ?? error,
      );
    }
  }

  /**
   * Send the merged /ws listing as an interactive picker when the channel and
   * the payload support one. Returns false so the caller can fall back to the
   * text list: a failed or impossible card must never lose the listing.
   */
  async #presentWorkspaceCommand(target, command, conversationKey) {
    const listing = command?.listing;
    if (!listing
      || typeof this.#workspaceCard?.render !== 'function'
      || typeof this.#bot.sendInteractionCard !== 'function') return false;
    const nonce = randomBytes(WORKSPACE_CARD_NONCE_BYTES).toString('base64url');
    const card = this.#workspaceCard.render(listing, { nonce });
    if (!card) return false;
    const entry = { listing, key: conversationKey, target, createdAt: Date.now(), submitting: false };
    this.#rememberWorkspaceCard(nonce, entry);
    try {
      const sent = await this.#bot.sendInteractionCard(target, card);
      entry.messageId = Array.isArray(sent?.providerMessageIds) && sent.providerMessageIds.length > 0
        ? String(sent.providerMessageIds[0])
        : undefined;
      await this.#activateWorkspaceCard(conversationKey, nonce);
      return true;
    } catch (error) {
      this.#workspaceCards.delete(nonce);
      this.#logger.warn?.(
        `[dsh-im:${this.#descriptor.key}] unable to send the workspace picker; `
        + 'falling back to the text list:',
        error?.message ?? error,
      );
      return false;
    }
  }

  /**
   * Only one picker stays authoritative per conversation. The previous card's
   * keyboard is retired as soon as its replacement exists, so an old "current"
   * marker can never be pressed after a newer list is on screen.
   */
  async #activateWorkspaceCard(conversationKey, nonce) {
    const previousNonce = this.#workspaceCardKeys.get(conversationKey);
    this.#workspaceCardKeys.set(conversationKey, nonce);
    if (!previousNonce || previousNonce === nonce) return;
    const previous = this.#workspaceCards.get(previousNonce);
    this.#workspaceCards.delete(previousNonce);
    if (!previous?.messageId) return;
    await this.#retireCardKeyboard(previous.target, previous.messageId, previousNonce);
  }

  /** Drop a card's keyboard in place; failures are diagnostics, never user-facing. */
  async #retireCardKeyboard(target, messageId, nonce) {
    if (!target || !messageId || typeof this.#bot.updateInteractionCard !== 'function') return;
    try {
      await this.#bot.updateInteractionCard(target, String(messageId), {
        markup: { inline_keyboard: [] },
      });
    } catch (error) {
      // "message is not modified" and "message to edit not found" are both fine here.
      this.#logger.warn?.(
        `[dsh-im:${this.#descriptor.key}] unable to retire a workspace picker${nonce ? ` (${nonce})` : ''}:`,
        error?.message ?? error,
      );
    }
  }

  #rememberWorkspaceCard(nonce, entry) {
    const now = Date.now();
    for (const [key, stored] of this.#workspaceCards) {
      if (now - stored.createdAt > WORKSPACE_CARD_TTL_MS) this.#workspaceCards.delete(key);
    }
    // Keep the caller's object identity: it is the same entry whose messageId is
    // filled in once the Bot API answers, and retirement reads it from here.
    this.#workspaceCards.set(nonce, entry);
    while (this.#workspaceCards.size > MAX_WORKSPACE_CARDS) {
      const oldest = this.#workspaceCards.keys().next().value;
      if (oldest === undefined) break;
      this.#workspaceCards.delete(oldest);
    }
  }

  /** Answer a workspace press through the current card snapshot. */
  async #handleWorkspaceCardPress(callback, key, press) {
    if (this.#signal?.aborted) return;
    const notice = (text) => this.#answerInteractionCallback(callback, text);
    const expired = t('这个列表已过期，请重新发送 /ws。');
    const entry = this.#workspaceCards.get(press.nonce);
    if (!entry || entry.key !== key || Date.now() - entry.createdAt > WORKSPACE_CARD_TTL_MS) {
      // A card this bridge can still identify gets its dead keyboard removed so
      // the same press is not offered again; an unrecognized card is only toasted
      // because editing an id we never issued is not a safe assumption.
      if (entry && entry.key === key) {
        this.#workspaceCards.delete(press.nonce);
        if (this.#workspaceCardKeys.get(key) === press.nonce) this.#workspaceCardKeys.delete(key);
        await this.#retireCardKeyboard(
          callback.replyTarget ?? entry.target,
          String(callback.providerMessageId),
          press.nonce,
        );
      }
      return notice(expired);
    }
    const kind = callback.kind === 'group' ? 'group' : 'direct';
    // The card is a command surface: the same command-permission gate as typing
    // the command applies to a press, otherwise a keyboard could bypass it.
    const decision = evaluateInboundAccess(this.#accessPolicy, {
      conversationType: kind,
      senderIds: [cleanText(callback.senderId)].filter(Boolean),
      isCommand: true,
    });
    if (!decision.allowed) return notice(t(COMMAND_PERMISSION_DENIED_MESSAGE));
    const path = entry.listing?.paths?.[press.index];
    if (typeof path !== 'string') return notice(expired);
    // Claim synchronously, before the first await: a second press arriving
    // while the switch is in flight must not switch a second time.
    if (entry.submitting) return notice(t('正在切换工作区，请稍候。'));
    // Idempotency follows the live authoritative current, not the snapshot: a
    // typed /ws or another card may have switched since this one was sent.
    let liveCurrent = null;
    try {
      if (typeof this.#harness.currentWorkspace === 'function') {
        liveCurrent = this.#harness.currentWorkspace();
      }
    } catch {
      // A failed read only loses the pre-check; the switch below still reports.
    }
    // The card's current marker is only a display snapshot; it cannot prove
    // that another command or conversation has not changed the bot workspace.
    if (path === liveCurrent) {
      return notice(t('已经在工作区：{workspace}', { workspace: path }));
    }
    entry.submitting = true;
    try {
      const switched = await this.#harness.switchWorkspace(path);
      const current = typeof switched === 'string' && switched ? switched : path;
      // Keep the snapshot truthful: the next press compares against this value.
      entry.listing = { ...entry.listing, current };
      const card = this.#workspaceCard.render(entry.listing, { nonce: press.nonce });
      if (card && typeof this.#bot.updateInteractionCard === 'function') {
        try {
          await this.#bot.updateInteractionCard(
            callback.replyTarget ?? entry.target,
            String(callback.providerMessageId),
            { markup: card.markup },
          );
        } catch (error) {
          this.#logger.warn?.(
            `[dsh-im:${this.#descriptor.key}] unable to re-mark the workspace picker:`,
            error?.message ?? error,
          );
        }
      }
      return await notice(t('工作区已切换为：{workspace}', { workspace: current }));
    } catch (error) {
      // Same classification as the typed command, so a card press and /ws N
      // cannot word the same failure differently.
      return notice(
        workspaceSwitchFailureText(error) ?? t('暂时无法切换工作区，请稍后重试。'),
      );
    } finally {
      entry.submitting = false;
    }
  }

  async presentSessionSyncApproval(interaction, context, options = {}) {
    return this.#approvals.handleSessionSyncRequested(interaction, context, {
      ...options, runtimeSignal: this.#signal ?? options.runtimeSignal, accessPolicy: this.#accessPolicy,
    });
  }

  async #handleInteraction(interaction, {
    key,
    actor,
    target,
    requiresMention,
  }) {
    if (interaction?.kind === 'approval') {
      const send = (text) => this.#bot.sendText(target, text);
      // Optional interactive-card presentation. The shared queue calls
      // `render(pending, send)` instead of the plain text when present and
      // `onResolved(text, outcome)` after any decision (button or typed reply).
      let cardContext = null;
      if (this.#approvalCard && typeof this.#approvalCard.createContext === 'function') {
        try {
          cardContext = this.#approvalCard.createContext({
            key,
            actor,
            target,
            send,
            bot: this.#bot,
            logger: this.#logger,
          });
        } catch (error) {
          this.#logger.warn?.(
            `[dsh-im:${this.#descriptor.key}] approval card unavailable; keeping the text approval:`,
            error?.message ?? error,
          );
        }
      }
      return this.#approvals.handleRequested(interaction, {
        key,
        actor,
        requiresMention,
        send: typeof cardContext?.send === 'function' ? cardContext.send : send,
        ...(typeof cardContext?.render === 'function' ? { render: cardContext.render } : {}),
        ...(typeof cardContext?.onResolved === 'function'
          ? { onResolved: cardContext.onResolved }
          : {}),
      });
    }
    if (interaction?.kind !== 'question') return;
    const questions = interaction?.payload?.questions;
    const interactionId = cleanText(interaction?.interactionId) || cleanText(interaction?.rpcId);
    if (!cleanText(interaction?.rpcId)
      || !interactionId
      || !cleanText(interaction?.sessionId)
      || !Array.isArray(questions)
      || questions.length === 0
      || questions.some((question) => !validHarnessQuestion(question))) {
      this.#logger.warn?.(
        `[dsh-im:${this.#descriptor.key}] ignored an invalid Harness question interaction`,
      );
      return;
    }

    if (interaction.recovered === true) {
      await this.#respondCancellation(
        interaction,
        `${this.#descriptor.label} safely cancelled an interaction left by an earlier client.`,
      );
      try {
        await this.#bot.sendText(
          target,
          t('检测到这个 Session 中遗留的待回答问题，已安全取消并继续处理你刚才的消息。'),
        );
      } catch (error) {
        this.#logger.error?.(
          `[dsh-im:${this.#descriptor.key}] failed to send an interaction recovery notice:`,
          error,
        );
      }
      return;
    }

    const existing = this.#pendingInteractions.get(key);
    if (existing?.interactionId === interactionId) {
      existing.interaction = interaction;
      if (existing.needsPresentation) await this.#presentInteraction(existing);
      return;
    }
    if (this.#interactionKeys.has(interactionId)) return;
    if (existing) {
      this.#logger.warn?.(
        `[dsh-im:${this.#descriptor.key}] cancelled a second pending Harness question`,
      );
      await this.#respondCancellation(
        interaction,
        `${this.#descriptor.label} is already handling another user interaction.`,
      );
      return;
    }

    const pending = {
      kind: 'question',
      interactionId,
      sessionId: interaction.sessionId,
      interaction,
      actor,
      requiresMention,
      questions,
      answers: [],
      index: 0,
      target,
      queue: null,
      claimedReplyMessageId: null,
      submitting: false,
      needsPresentation: true,
      presentationTask: null,
      cardMessageId: null,
      // Identity of the keyboard currently on screen, and the guard that keeps two
      // presses of the same card from advancing one question twice.
      cardNonce: null,
      callbackClaimed: false,
    };
    this.#pendingInteractions.set(key, pending);
    this.#interactionKeys.set(interactionId, key);
    await this.#presentInteraction(pending);
  }

  async #handleInteractionResolved(resolution) {
    if (resolution?.kind === 'approval') {
      await this.#approvals.handleResolved(resolution);
      return;
    }
    const interactionId = cleanText(resolution?.interactionId);
    if (resolution?.kind !== 'question' || !interactionId) return;
    const key = this.#interactionKeys.get(interactionId);
    if (!key) return;
    this.#clearPendingInteraction(key, interactionId);
  }

  /** Build card content for the current question, or null to keep the text flow. */
  #interactionCardFor(pending, question) {
    if (!this.#interactionCard || typeof this.#interactionCard.render !== 'function') return null;
    if (typeof this.#bot.sendInteractionCard !== 'function') return null;
    if (pending.submitting) return null;
    let card = null;
    try {
      card = this.#interactionCard.render(question, {
        questionIndex: pending.index,
        total: pending.questions.length,
        requiresMention: pending.requiresMention,
        nonce: pending.cardNonce,
      });
    } catch (error) {
      this.#logger.warn?.(
        `[dsh-im:${this.#descriptor.key}] interaction card renderer failed:`,
        error,
      );
      return null;
    }
    if (!card || typeof card.text !== 'string' || !card.text || !card.markup) return null;
    return card;
  }

  #presentInteraction(pending) {
    if (pending.presentationTask) return pending.presentationTask;
    const question = pending.questions[pending.index];
    if (!question) return Promise.resolve();
    const task = (async () => {
      // A fresh nonce per presentation: a later question restarts its indexes at
      // zero, so without one an old card's keyboard would answer the new question.
      pending.cardNonce = randomUUID().slice(0, 8);
      const card = this.#interactionCardFor(pending, question);
      if (card) {
        try {
          const sent = await this.#bot.sendInteractionCard(pending.target, {
            text: card.text,
            markup: card.markup,
          });
          pending.cardMessageId = sent?.providerMessageIds?.at(-1) ?? null;
          pending.needsPresentation = false;
          return;
        } catch (error) {
          // A platform that refuses the keyboard must not lose the question:
          // fall through to the plain-text flow this channel already had.
          pending.cardMessageId = null;
          this.#logger.warn?.(
            `[dsh-im:${this.#descriptor.key}] could not deliver an interaction card; `
              + 'falling back to plain text:',
            error?.message ?? error,
          );
        }
      }
      await this.#bot.sendText(
        pending.target,
        harnessQuestionText(
          question,
          pending.index,
          pending.questions.length,
          { requiresMention: pending.requiresMention },
        ),
      );
      pending.needsPresentation = false;
    })();
    pending.presentationTask = task;
    task.then(
      () => {
        if (pending.presentationTask === task) pending.presentationTask = null;
      },
      () => {
        if (pending.presentationTask === task) pending.presentationTask = null;
      },
    );
    return task;
  }

  async #discardResolvedInteractionReply(message, messageId, {
    alreadyRecorded = false,
  } = {}) {
    if (!alreadyRecorded) {
      if (this.#state.hasSeen(messageId)) return;
      await this.#state.markSeen(messageId);
      this.#status.messagesReceived += 1;
      this.#status.lastMessageAt = new Date().toISOString();
    }
    try {
      await this.#bot.sendText(message.replyTarget, t(INTERACTION_RESOLVED_TEXT));
    } catch (error) {
      this.#logger.error?.(
        `[dsh-im:${this.#descriptor.key}] failed to send an expired interaction notice:`,
        error,
      );
    }
  }

  #takePendingInteraction(key, interactionId) {
    const pending = this.#pendingInteractions.get(key);
    if (!pending
      || (interactionId !== undefined && pending.interactionId !== interactionId)) return null;
    this.#pendingInteractions.delete(key);
    this.#interactionKeys.delete(pending.interactionId);
    return pending;
  }

  #clearPendingInteraction(key, interactionId) {
    return this.#takePendingInteraction(key, interactionId) !== null;
  }

  async #respondCancellation(interaction, message) {
    try {
      await interaction.respond({
        ok: false,
        error: { code: 'cancelled', message, details: {} },
      }, { signal: AbortSignal.timeout(5_000) });
    } catch (error) {
      if (error?.code !== 'interaction-not-pending') throw error;
    }
  }

  async #cancelPendingInteraction(key) {
    const pending = this.#takePendingInteraction(key);
    if (!pending || pending.kind !== 'question') return;
    try {
      await this.#respondCancellation(
        pending.interaction,
        `The ${this.#descriptor.label} interaction ended before the user answered.`,
      );
    } catch (error) {
      this.#logger.warn?.(
        `[dsh-im:${this.#descriptor.key}] failed to cancel a pending Harness interaction:`,
        error,
      );
    }
  }

  /**
   * Retire what waits on a human decision in this conversation: the pending
   * question loses its card and gets the same safe cancellation the recovered
   * path uses, and active tool approvals are rejected. The caller follows it
   * with the new request's dispatch, so the room hears the answer instead of
   * the waiting.
   */
  async #retireWaitingInteractions(key, pending) {
    if (pending) {
      this.#clearPendingInteraction(key, pending.interactionId);
      pending.claimedReplyMessageId = null;
      if (pending.cardMessageId) {
        await this.#retireInteractionCard(pending.target, pending.cardMessageId);
        pending.cardMessageId = null;
      }
      if (pending.kind === 'question') {
        try {
          await this.#respondCancellation(
            pending.interaction,
            `The ${this.#descriptor.label} sender moved on to a new request before answering.`,
          );
        } catch (error) {
          this.#logger.warn?.(
            `[dsh-im:${this.#descriptor.key}] failed to cancel an unanswered pending question:`,
            error?.message ?? error,
          );
        }
      }
    }
    await this.#approvals.rejectRoute(key).catch(() => 0);
  }
}
