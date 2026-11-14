import { BusyMessageDispatcher, canAutomaticallySteer } from '../shared/busy-message-dispatcher.mjs';
import { menuIntroductionText } from '../shared/menu-introduction.mjs';
import { SESSION_NAV_HELP_LINES } from '../shared/command-catalog.mjs';
import { createDeferredDeliveryCoordinator, deferredOutcomeText } from '../shared/deferred-delivery-coordinator.mjs';
import {
  DEFAULT_WEIXIN_MAX_MESSAGE_CHARS,
  extractWeixinFiles,
  extractWeixinImages,
  extractWeixinReplyReference,
  extractWeixinText,
  splitWeixinText,
  weixinMessageId,
  weixinMessageTimestampMs,
} from './weixin-api.mjs';
import {
  harnessAnswerForQuestion,
  harnessQuestionText,
  validHarnessQuestion,
} from '../shared/harness-question.mjs';
import { HarnessApprovalQueue } from '../shared/harness-approval.mjs';
import {
  BatchInputManager,
  batchInputBusyMessage,
  isBatchInputCommand,
} from '../shared/batch-input.mjs';
import { runCompactCommand } from '../shared/compact-command.mjs';
import { runPlanCommand, runGoalCommand } from '../shared/plan-goal-command.mjs';
import { isClearCommand, runClearCommand } from '../shared/clear-command.mjs';
import { isResetCommand, runResetCommand } from '../shared/reset-command.mjs';
import { isHistoryCommand, runHistoryCommand } from '../shared/history-command.mjs';
import {
  isControlCommand,
  runControlCommand,
} from '../shared/control-command.mjs';
import {
  isModelCommand,
  runModelCommand,
} from '../shared/model-command.mjs';
import {
  isPresetCommand,
  runPresetCommand,
} from '../shared/preset-command.mjs';
import { runWorkspaceCommand } from '../shared/workspace-command.mjs';
import { askInWorkspaceSession } from '../shared/workspace-session.mjs';
import {
  isSessionNavCommand,
  runSessionNavTextCommand,
} from '../shared/session-nav-command.mjs';
import { createConversationSession, isNewCommand, newCommandTitle } from '../shared/new-command.mjs';
import {
  captureContextEnhancement,
  captureContextEnhancementSource,
  enhanceContextContent,
  withSentAt,
} from '../shared/context-enhancement.mjs';
import {
  hasInboundImages,
  imagePromptDiagnostic,
  imagePromptUserMessage,
} from '../shared/image-prompt.mjs';
import {
  hasInboundFiles,
  inboundFileUserMessage,
  prefetchInboundFiles,
} from '../shared/inbound-file.mjs';
import { rememberConnectionTestTarget } from '../shared/connection-test.mjs';
import { deliverOutboundArtifacts } from '../shared/semantic/artifact-delivery.mjs';
import {
  hasReplyReference,
  promptContentForInboundMessage,
} from '../shared/semantic/reply-reference.mjs';
import {
  createDeliveryReceipt,
  providerMessageIdsFor,
} from '../shared/semantic/delivery.mjs';
import { recoverAssistantTextByTimestamp } from '../shared/session-reply-recovery.mjs';
import {
  messageFailureDiagnostic,
  channelDeliveryFailure,
  clearLastMessageFailure,
  messageFailureText,
  setLastMessageFailure,
} from '../shared/message-failure.mjs';
import {
  COMMAND_PERMISSION_DENIED_MESSAGE,
  evaluateInboundAccess,
} from '../shared/inbound-access.mjs';
import { t } from '../shared/i18n.mjs';

const INTERACTION_RESOLVED_TEXT = () => t('这个问题已在其他客户端处理，无需再次回答。');
const DEFAULT_TYPING_KEEPALIVE_MS = 5_000;
const TYPING_RETRY_DELAY_MS = 60_000;
const WEIXIN_SEND_DIAGNOSTIC = Symbol('weixin-send-diagnostic');
const WEIXIN_REPLY_HISTORY_PAGE_SIZE = 100;
const WEIXIN_REPLY_HISTORY_MAX_PAGES = 3;
const WEIXIN_REPLY_HISTORY_TIMEOUT_MS = 5_000;
const WEIXIN_REPLY_HISTORY_MATCH_TOLERANCE_MS = 15_000;

const HELP_TEXT = () => [
  t('微信已连接 DeepSeek Harness。'),
  '',
  t('直接发送文字、图片、文件或带文字识别结果的语音即可继续当前会话。'),
  t('/new  开启一个全新会话'),
  t('/compact  压缩当前会话的较早上下文'),
  t('/clear  清空当前会话上下文（保留 Session 绑定和历史记录）'),
  t('/plan  进入计划模式（/plan off 退出，可附带说明文字）'),
  t('/goal [目标]  设置目标（clear 清除、edit 修改、pause 暂停、resume 恢复；不带参数查看）'),
  t('/history [数量]  查看最近历史消息（默认 3 条，最多 5 条）'),
  t('/workspace 工作区序号或绝对路径  切换工作区'),
  t('/workspacelist  列出工作区绝对路径'),
  t('/ws、/wsl、/workspaces  工作区命令别名'),
  t('/sessionlist 或 /sessions [工作区序号或绝对路径]  列出会话 ID 和标题'),
  t('/sessionlist --all  跨工作区汇总会话（每个工作区默认显示 10 个，可用 --limit N 调整）'),
  t('/sessionlist --limit N  仅列出当前工作区前 N 个会话'),
  t('/session Session ID、当前工作区序号或标题关键词  将当前聊天绑定到指定会话'),
  ...SESSION_NAV_HELP_LINES.map((line) => t(line)),
  t('/models  按序号列出所有可用模型'),
  t('/reasoninglist 或 /reasonings  按序号列出当前模型可用推理等级'),
  t('/reasoning [序号、等级ID或 --default]  查看或切换当前推理等级'),
  t('/model [序号或完整模型ID] [推理等级ID]  查看或切换当前会话模型'),
  t('示例：先发 /models，再发 /model 2 [推理等级ID]'),
  t('/presetlist 或 /presets  按序号列出可用 Agent Preset'),
  t('/preset [序号或完整ID]  查看或设置当前机器人 Agent Preset'),
  t('纯数字 ID：/preset id:<ID>'),
  t('/preset --default  跟随 Host 默认'),
  t('/stop  停止当前任务'),
  t('/steer 补充指令  纠偏当前任务'),
  t('/batch  开始批量输入（仅私聊，最多 10 条文字）'),
  t('/send  提交当前批次'),
  t('/cancel  取消当前批次'),
  t('/status  检查连接状态'),
  t('/version  查看插件版本'),
  t('/help  显示本帮助'),
].join('\n');

function conversationKey(userId) {
  return `p2p:${userId}`;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeDiagnosticToken(value) {
  const token = value === undefined || value === null ? '' : String(value).trim();
  return /^-?[A-Za-z0-9_.:-]{1,160}$/u.test(token) ? token : '-';
}

function weixinApiHost(baseUrl) {
  try {
    return safeDiagnosticToken(new URL(baseUrl).hostname.toLowerCase());
  } catch {
    return '-';
  }
}

function createWeixinSendDiagnostic({
  baseUrl,
  text,
  chunk,
  chunkIndex,
  chunkCount,
  maxMessageChars,
  contextToken,
  runId,
  error,
}) {
  const status = Number(error?.status ?? error?.httpStatus);
  const http = Number.isInteger(status)
    ? String(status)
    : error?.code === 'send-rejected' ? '2xx' : '-';
  return [
    'endpoint=sendmessage',
    `host=${weixinApiHost(baseUrl)}`,
    `chunk=${chunkIndex + 1}/${chunkCount}`,
    `chunkChars=${chunk.length}`,
    `chunkUtf8Bytes=${Buffer.byteLength(chunk, 'utf8')}`,
    `totalChars=${text.length}`,
    `totalUtf8Bytes=${Buffer.byteLength(text, 'utf8')}`,
    `limitChars=${maxMessageChars}`,
    `contextToken=${contextToken ? 'yes' : 'no'}`,
    `runId=${runId ? 'yes' : 'no'}`,
    `http=${http}`,
    `provider=${safeDiagnosticToken(error?.providerCode)}`,
    `cause=${safeDiagnosticToken(error?.code ?? error?.name)}`,
  ].join(' ');
}

export function weixinSendError(error, details) {
  const diagnostic = createWeixinSendDiagnostic({ ...details, error });
  const wrapped = new Error(`Weixin text delivery failed (${diagnostic})`, { cause: error });
  const code = safeDiagnosticToken(error?.code);
  wrapped.code = code === '-' ? 'weixin-send-failed' : code;
  const status = Number(error?.status ?? error?.httpStatus);
  if (Number.isInteger(status)) wrapped.status = status;
  const providerCode = safeDiagnosticToken(error?.providerCode);
  if (providerCode !== '-') wrapped.providerCode = providerCode;
  wrapped[WEIXIN_SEND_DIAGNOSTIC] = diagnostic;
  return wrapped;
}

export function weixinSendFailureOptions(error, { proactive = false } = {}) {
  let current = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const diagnostic = current[WEIXIN_SEND_DIAGNOSTIC];
    if (typeof diagnostic === 'string' && diagnostic) {
      return {
        reason: 'weixin-send-failed',
        userMessage: [
          proactive
            ? t('微信主动消息发送失败。长轮询在线不代表消息可以发送。')
            : t('回复已经生成，但微信发送失败，可能只收到部分内容。请将下面的诊断信息完整反馈给管理员。'),
          ...(String(current.providerCode) === '-2' ? [
            t('iLink 拒绝发送，可能涉及会话有效期、发送额度或消息内容。可让接收者发一条消息后重试；不要通过反复发送心跳尝试续期。'),
          ] : []),
          t('微信发送诊断：{diagnostic}', { diagnostic }),
        ].join('\n'),
      };
    }
    current = current.cause;
  }
  return undefined;
}

export function weixinInboundMessage(message, api, state, { loadReplyContent } = {}) {
  const toUserId = nonEmptyString(message?.from_user_id);
  const replyTo = extractWeixinReplyReference(message, {
    resolveContent: (reference) => state?.recentOutboundTextFor?.({
      toUserId,
      ...reference,
    }),
    ...(typeof loadReplyContent === 'function' ? {
      loadContent: (reference, options) => loadReplyContent({
        toUserId,
        ...reference,
      }, options),
    } : {}),
  });
  return {
    content: extractWeixinText(message) ?? '',
    images: typeof api?.inboundImages === 'function'
      ? api.inboundImages(message)
      : extractWeixinImages(message),
    files: typeof api?.inboundFiles === 'function'
      ? api.inboundFiles(message)
      : extractWeixinFiles(message),
    ...(replyTo ? { replyTo } : {}),
  };
}

function hasWeixinImageItems(message) {
  return Array.isArray(message?.item_list)
    && message.item_list.some((item) => item?.image_item && typeof item.image_item === 'object');
}

function hasWeixinFileItems(message) {
  return Array.isArray(message?.item_list)
    && message.item_list.some((item) => item?.file_item && typeof item.file_item === 'object');
}

function isNativeWeixinText(message) {
  return Array.isArray(message?.item_list)
    && message.item_list.length > 0
    && message.item_list.every((item) => (
      item?.type === 1 && typeof item.text_item?.text === 'string'
    ))
    && Boolean(nonEmptyString(extractWeixinText(message)));
}

function canClaimInteractionReply(message, pending) {
  return pending.questions[pending.index]
    && nonEmptyString(message?.from_user_id) === pending.actor
    && !hasWeixinImageItems(message)
    && !hasWeixinFileItems(message)
    && nonEmptyString(extractWeixinText(message));
}

function artifactFailureText(fileName, error) {
  const name = String(fileName ?? t('结果文件')).replace(/[\r\n]+/g, ' ').trim() || t('结果文件');
  switch (error?.code) {
    case 'artifact-delivery-uncertain':
      return t('结果文件「{name}」发送结果未能确认，请先检查聊天内是否已收到，不要立即重试。', { name });
    case 'artifact-permission-required':
      return t('结果文件「{name}」已生成，但微信机器人当前没有文件消息发送权限，请检查机器人文件消息能力。', { name });
    case 'artifact-too-large':
      return t('结果文件「{name}」超过当前微信会话可发送的文件大小，未发送。', { name });
    case 'artifact-upload-timeout':
      return t('结果文件「{name}」上传微信时长时间没有进展，已超时，文件尚未发送。请检查网络后重试，或压缩、拆分文件后发送。', { name });
    case 'artifact-rate-limited':
      return t('结果文件「{name}」暂时被微信限流，未能发送，请稍后重试。', { name });
    case 'artifact-provider-rejected':
      return t('结果文件「{name}」已生成，但微信拒绝了该文件消息。', { name });
    case 'artifact-invalid':
    case 'artifact-changed':
    case 'artifact-unavailable':
      return t('结果文件「{name}」暂时无法读取或准备发送，请确认文件仍可访问后重试。', { name });
    default:
      return t('结果文件「{name}」已生成，但暂时未能通过微信发送，请稍后重试。', { name });
  }
}

export function createWeixinBridgeStatus() {
  return {
    messagesReceived: 0,
    messagesReplied: 0,
    messagesRejected: 0,
    lastMessageAt: null,
    lastReplyAt: null,
    lastRejectedAt: null,
    lastError: null,
    lastMessageError: null,
  };
}

export class WeixinHarnessBridge {
  #api;
  #baseUrl;
  #token;
  #ownerUserId;
  #harness;
  #state;
  #deferred;
  #contextEnhancement;
  #accessPolicy;
  #status;
  #logger;
  #replyTimeoutMs;
  #maxMessageChars;
  #typingKeepaliveMs;
  #signal;
  #queues = new Map();
  #busyMessages = new BusyMessageDispatcher();
  #pendingInteractions = new Map();
  #interactionKeys = new Map();
  // Keep the accepted configuration through the existing queue/reply lifecycle.
  #acceptedMessageIds = new Map();
  #approvalTasks = new Set();
  #commandTasks = new Set();
  #approvals;
  #batchInputs = new BatchInputManager();
  #typingTicket = null;
  #typingTarget = null;
  #typingTimer = null;
  #typingGeneration = 0;
  #typingTail = Promise.resolve();
  #typingClosed = false;
  #typingRetryAt = 0;
  #typingTicketStale = false;

  constructor({
    api,
    baseUrl,
    token,
    ownerUserId,
    harness,
    state,
    contextEnhancement,
    accessPolicy,
    status = createWeixinBridgeStatus(),
    logger = console,
    replyTimeoutMs = 600_000,
    maxMessageChars = DEFAULT_WEIXIN_MAX_MESSAGE_CHARS,
    typingKeepaliveMs = DEFAULT_TYPING_KEEPALIVE_MS,
    signal,
  }) {
    if (!api || typeof api.sendText !== 'function') throw new TypeError('Weixin API is required');
    if (!baseUrl || !token || !ownerUserId) throw new TypeError('Weixin account credentials are required');
    if (!harness || !state) throw new TypeError('Harness client and state store are required');
    if (!Number.isFinite(typingKeepaliveMs) || typingKeepaliveMs <= 0) {
      throw new TypeError('typingKeepaliveMs must be a positive number');
    }
    this.#api = api;
    this.#baseUrl = baseUrl;
    this.#token = token;
    this.#ownerUserId = ownerUserId;
    this.#harness = harness;
    this.#state = state;
    this.#contextEnhancement = contextEnhancement;
    this.#accessPolicy = accessPolicy;
    this.#status = status;
    this.#logger = logger;
    this.#replyTimeoutMs = replyTimeoutMs;
    this.#maxMessageChars = maxMessageChars;
    this.#typingKeepaliveMs = typingKeepaliveMs;
    this.#signal = signal;
    this.#deferred = createDeferredDeliveryCoordinator({ harness, state, signal, logger,
      deliver: (entry, outcome) => this.#deliverDeferredOutcome(entry, outcome),
    });
    this.#approvals = new HarnessApprovalQueue({ label: 'weixin', logger });
  }

  get status() {
    return structuredClone(this.#status);
  }

  accept(message) {
    if (this.#signal?.aborted) return Promise.resolve();
    if (message?.message_type === 2) return Promise.resolve();
    const messageId = weixinMessageId(message);
    const sender = nonEmptyString(message?.from_user_id);
    if (!messageId || !sender || this.#state.hasSeen(messageId)
      || this.#acceptedMessageIds.has(messageId)) return Promise.resolve();
    const commandText = nonEmptyString(extractWeixinText(message)) ?? '';
    const access = this.#accessPolicy
      ? evaluateInboundAccess(this.#accessPolicy, {
          conversationType: 'direct',
          senderIds: sender,
          text: commandText,
          hasImages: hasWeixinImageItems(message),
          hasFiles: hasWeixinFileItems(message),
        })
      : sender === this.#ownerUserId
        ? { allowed: true, reason: 'legacy-owner' }
        : { allowed: false, reason: 'sender-not-allowed' };
    if (!access.allowed) {
      this.#acceptedMessageIds.set(messageId, null);
      return this.#finishAccessDecision(messageId, sender, message, access);
    }
    const introductionKey = conversationKey(sender);
    if (this.#state.needsMenuIntroduction?.(introductionKey)
      && (!this.#accessPolicy || evaluateInboundAccess(this.#accessPolicy, { conversationType: 'direct', senderIds: sender, isCommand: true }).allowed)) {
      return this.#state.introduceMenu(introductionKey, () => this.#send(sender, menuIntroductionText(), message.context_token, message.run_id), { signal: this.#signal, logger: this.#logger })
        .then(() => this.accept(message));
    }
    // Capture through the *source* entry point, not the bare config snapshot:
    // the enhancement that renders the user message is read back from this map
    // at prompt time, and a rendered `sentAt` selection needs the factory that
    // carries the moment. Nothing is read here; the thunk runs only when that
    // render selects `sentAt`.
    this.#acceptedMessageIds.set(messageId, captureContextEnhancementSource(
      this.#contextEnhancement,
      'direct',
      withSentAt(
        () => ({ channel: 'weixin', senderId: sender, chatId: sender }),
        // A thunk: the platform send time (falling back to the iLink message-id
        // clock) is only decoded when a `sentAt` selection actually renders.
        () => message?.create_time_ms ?? weixinMessageTimestampMs(messageId),
      ),
    ));
    if (sender === this.#ownerUserId) {
      rememberConnectionTestTarget(this.#state, { toUserId: sender });
    }
    const key = conversationKey(sender);
    const contextToken = nonEmptyString(message?.context_token) ?? undefined;
    void this.#state.rememberContextToken?.({
      userId: sender,
      contextToken,
      seq: message.seq,
      messageTimeMs: message.create_time_ms ?? weixinMessageTimestampMs(messageId),
    }).catch((error) => this.#logger.warn?.('[dsh-weixin] failed to persist conversation context:', error));
    const runId = nonEmptyString(message?.run_id) ?? undefined;
    const pending = this.#pendingInteractions.get(key);
    const batchCommand = isBatchInputCommand(commandText);
    const batchStatus = this.#batchInputs.status(key);
    if (batchCommand || batchStatus.phase === 'collecting') {
      const exactBatchStart = /^\/batch$/iu.test(commandText);
      const result = exactBatchStart
        && batchStatus.phase === 'idle'
        && (this.#queues.has(key) || pending || this.#approvals.hasPending(key))
        ? { handled: true, kind: 'busy', message: batchInputBusyMessage() }
        : this.#batchInputs.handle(key, commandText, {
            plainText: isNativeWeixinText(message)
              && !extractWeixinReplyReference(message),
          });
      if (result.handled) {
        if (result.kind === 'submit') {
          return this.#enqueueMessage({
            ...message,
            item_list: [{ type: 1, text_item: { text: result.prompt } }],
          }, messageId, key, { batchSubmission: result });
        }
        return this.#finishBatchResult(
          message,
          messageId,
          key,
          sender,
          contextToken,
          runId,
          result,
        );
      }
    }
    const commandRunner = isClearCommand(commandText) ? runClearCommand
      : isResetCommand(commandText) ? runResetCommand
      : isHistoryCommand(commandText) ? runHistoryCommand
      : hasWeixinFileItems(message) ? null : isControlCommand(commandText)
      ? runControlCommand
      : (isModelCommand(commandText)
          ? runModelCommand
          : (isPresetCommand(commandText) ? runPresetCommand : null));
    if (commandRunner) {
      let task;
      task = this.#processFastCommand(
        message,
        messageId,
        key,
        sender,
        contextToken,
        runId,
        commandText,
        commandRunner,
      ).catch((error) => {
        if (error?.code === 'turn-stopped' || this.#signal?.aborted) return;
        this.#status.lastError = error?.message ?? String(error);
        const failure = setLastMessageFailure(this.#status, error);
        this.#logger.error?.(
          `[dsh-weixin] failed to process a command [${failure.referenceId}]:`,
          messageFailureDiagnostic(error, failure),
        );
        return this.#sendOutOfBand(key, sender, messageFailureText(failure), contextToken, runId)
          .catch(() => undefined);
      }).finally(() => {
        this.#acceptedMessageIds.delete(messageId);
        this.#commandTasks.delete(task);
      });
      this.#commandTasks.add(task);
      return task;
    }
    const approval = this.#approvals.claimReply({
      key,
      actor: sender,
      messageId,
      text: hasWeixinImageItems(message) || hasWeixinFileItems(message)
        ? ''
        : extractWeixinText(message),
      addressed: true,
      hasPendingQuestion: Boolean(pending),
      questionCompletion: pending?.submitting || pending?.claimedReplyMessageId
        ? pending.queue
        : null,
      isQuestionPending: () => this.#pendingInteractions.has(key),
      send: (text) => this.#send(sender, text, contextToken, runId),
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
    if (pending?.submitting || pending?.claimedReplyMessageId) {
      return this.#enqueueMessage(message, messageId, key);
    }
    if (pending) {
      if (canClaimInteractionReply(message, pending)) {
        pending.claimedReplyMessageId = messageId;
      }
      const previous = pending.queue ?? Promise.resolve();
      const current = previous
        .catch(() => undefined)
        .then(() => this.#processInteractionReply(message, messageId, key, pending))
        .catch((error) => this.#handleInteractionFailure(message, messageId, error))
        .finally(() => {
          this.#acceptedMessageIds.delete(messageId);
          if (pending.claimedReplyMessageId === messageId) pending.claimedReplyMessageId = null;
          if (pending.queue === current) pending.queue = null;
        });
      pending.queue = current;
      return current;
    }
    return this.#busyMessages.dispatch({
      key, messageId, text: commandText,
      eligible: () => isNativeWeixinText(message) && !extractWeixinReplyReference(message)
        && canAutomaticallySteer(this.#accessPolicy, 'direct', sender),
      harness: this.#harness, state: this.#state, status: this.#status,
      signal: this.#signal, control: { owner: this, key }, logger: this.#logger,
      acceptedMessageIds: this.#acceptedMessageIds,
      pendingInteraction: () => this.#pendingInteractions.has(key) || this.#approvals.hasPending(key),
      enhancement: this.#acceptedMessageIds.get(messageId),
      isQueued: () => this.#queues.has(key),
      enqueue: (options) => this.#enqueueMessage(message, messageId, key, options),
      send: (reply) => this.#sendOutOfBand(key, sender, reply, contextToken, runId),
      steerReceipt: false,
      onError: (error) => this.#handleInteractionFailure(message, messageId, error),
    });
  }

  #enqueueMessage(message, messageId, key, {
    releaseMessageId = true,
    alreadyRecorded = false,
    batchSubmission = null,
  } = {}) {
    const preparedMessage = prefetchInboundFiles(
      this.#inboundMessage(message),
      { signal: this.#signal },
    );
    const previous = this.#queues.get(key) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(() => this.#process(message, key, {
        alreadyRecorded,
        preparedMessage,
        batchSubmission,
      }))
      .finally(() => {
        if (releaseMessageId) this.#acceptedMessageIds.delete(messageId);
        if (this.#queues.get(key) === current) this.#queues.delete(key);
      });
    this.#queues.set(key, current);
    return current;
  }

  #inboundMessage(message) {
    return weixinInboundMessage(message, this.#api, this.#state, {
      loadReplyContent: (reference, options) => this.#loadReplyContent(reference, options),
    });
  }

  async #loadReplyContent(reference, { signal: callerSignal } = {}) {
    const indexed = this.#state.recentOutboundTextFor?.(reference);
    if (indexed) return { content: indexed };
    const quotedAt = [
      weixinMessageTimestampMs(reference?.messageId),
      Number(reference?.createTimeMs),
      Number(reference?.updateTimeMs),
    ].find(Number.isSafeInteger);
    if (quotedAt === undefined) return { unavailableReason: 'not-delivered' };
    const sender = nonEmptyString(reference?.toUserId);
    const key = sender ? conversationKey(sender) : null;
    const sessionId = key ? this.#state.sessionFor(key) : null;
    const session = typeof sessionId === 'string' && sessionId
      ? this.#harness.workspaceSession?.(sessionId, key)
      : null;
    if (typeof session?.readHistory !== 'function') {
      return { unavailableReason: 'not-delivered' };
    }
    const text = await recoverAssistantTextByTimestamp({
      session,
      quotedAt,
      signal: callerSignal,
      pageSize: WEIXIN_REPLY_HISTORY_PAGE_SIZE,
      maxPages: WEIXIN_REPLY_HISTORY_MAX_PAGES,
      timeoutMs: WEIXIN_REPLY_HISTORY_TIMEOUT_MS,
      toleranceMs: WEIXIN_REPLY_HISTORY_MATCH_TOLERANCE_MS,
    });
    if (!text) return { unavailableReason: 'not-delivered' };
    const messageId = nonEmptyString(reference?.messageId);
    try {
      await this.#state.rememberOutboundMessage?.({
        toUserId: sender,
        text,
        sentAt: quotedAt,
        completedAt: quotedAt,
        providerMessageIds: messageId ? [messageId] : [],
      });
    } catch (error) {
      this.#logger.warn?.('[dsh-weixin] failed to remember a recovered quote:', error);
    }
    return { content: text };
  }

  #finishBatchResult(message, messageId, key, sender, contextToken, runId, result) {
    let task;
    task = Promise.resolve().then(async () => {
      if (this.#state.hasSeen(messageId)) return;
      await this.#state.markSeen(messageId);
      this.#status.messagesReceived += 1;
      this.#status.lastMessageAt = new Date().toISOString();
      if (result.message) {
        await this.#sendOutOfBand(key, sender, result.message, contextToken, runId);
      }
      this.#status.lastError = null;
    }).catch(async (error) => {
      if (this.#signal?.aborted) return;
      this.#status.lastError = error?.message ?? String(error);
      const failure = setLastMessageFailure(this.#status, error);
      this.#logger.error?.(
        `[dsh-weixin] failed to process a batch input message [${failure.referenceId}]:`,
        messageFailureDiagnostic(error, failure),
      );
      await this.#sendOutOfBand(key, sender, messageFailureText(failure), contextToken, runId)
        .catch(() => undefined);
    }).finally(() => {
      this.#acceptedMessageIds.delete(messageId);
      this.#commandTasks.delete(task);
    });
    this.#commandTasks.add(task);
    return task;
  }

  #finishAccessDecision(messageId, sender, message, access) {
    const contextToken = nonEmptyString(message?.context_token) ?? undefined;
    const runId = nonEmptyString(message?.run_id) ?? undefined;
    let task;
    task = Promise.resolve().then(async () => {
      if (this.#state.hasSeen(messageId)) return;
      await this.#state.markSeen(messageId);
      if (access.reason === 'command-not-allowed') {
        this.#status.messagesReceived += 1;
        this.#status.lastMessageAt = new Date().toISOString();
        await this.#send(sender, t(COMMAND_PERMISSION_DENIED_MESSAGE), contextToken, runId);
        this.#status.messagesReplied += 1;
        this.#status.lastReplyAt = new Date().toISOString();
      } else {
        this.#status.messagesRejected += 1;
        this.#status.lastRejectedAt = new Date().toISOString();
      }
      this.#status.lastError = null;
    }).catch((error) => {
      if (this.#signal?.aborted) return;
      this.#status.lastError = error?.message ?? String(error);
      this.#logger.error?.('[dsh-weixin] failed to apply inbound access policy:', error);
    }).finally(() => {
      this.#acceptedMessageIds.delete(messageId);
      this.#commandTasks.delete(task);
    });
    this.#commandTasks.add(task);
    return task;
  }

  async #deliverDeferredOutcome(entry, outcome) {
    await this.#send(entry.target.toUserId, deferredOutcomeText(outcome), undefined, undefined, { stopTyping: false });
    return true;
  }

  async waitForIdle() {
    await this.#busyMessages.whenIdle();
    await Promise.allSettled([
      ...this.#queues.values(),
      ...[...this.#pendingInteractions.values()].flatMap((pending) => (
        pending.queue ? [pending.queue] : []
      )),
      ...this.#approvalTasks,
      ...this.#commandTasks,
      this.#typingTail,
    ]);
    await this.#deferred.whenIdle();
  }

  async close() {
    this.#deferred.close();
    this.#typingClosed = true;
    await this.#stopTyping({ signal: AbortSignal.timeout(5_000) });
  }

  async #processFastCommand(
    message,
    messageId,
    key,
    sender,
    contextToken,
    runId,
    text,
    runner,
  ) {
    this.#signal?.throwIfAborted();
    if (this.#state.hasSeen(messageId)) return;
    await this.#state.markSeen(messageId);
    this.#status.messagesReceived += 1;
    this.#status.lastMessageAt = new Date().toISOString();
    const result = await runner(text, this.#harness, this.#state, key, {
      signal: this.#signal,
      isDirect: true,
      hasImages: hasWeixinImageItems(message),
      hasFiles: hasWeixinFileItems(message),
      pendingInteraction: this.#pendingInteractions.has(key)
        || this.#approvals.hasPending(key),
      busy: this.#queues.has(key) || this.#batchInputs.status(key).phase !== 'idle',
      control: { owner: this, key },
      deferredDelivery: this.#deferred,
      enhancement: captureContextEnhancementSource(
        this.#contextEnhancement,
        'direct',
        // The moment rides on the factory as a thunk, so a local command that
        // never renders a source block -- and a scope that is off or does not
        // select `sentAt` -- reads nothing from the inbound message.
        withSentAt(
          () => ({ channel: 'weixin', senderId: sender, chatId: sender }),
          // Platform send time, falling back to the iLink message-id clock.
          () => message?.create_time_ms ?? weixinMessageTimestampMs(messageId),
        ),
      ),
    });
    if (result?.stopped) {
      await Promise.allSettled([
        this.#cancelPendingInteraction(key),
        this.#approvals.closeRoute(key),
      ]);
    }
    for (const reply of result?.messages ?? [result?.message]) {
      if (!reply) continue;
      if (result?.stopped) {
        await this.#send(sender, reply, contextToken, runId);
      } else {
        await this.#sendOutOfBand(key, sender, reply, contextToken, runId);
      }
    }
    this.#status.lastError = null;
  }

  async #process(message, key, {
    alreadyRecorded = false,
    preparedMessage,
    batchSubmission = null,
  } = {}) {
    this.#signal?.throwIfAborted();
    const messageId = weixinMessageId(message);
    const sender = nonEmptyString(message?.from_user_id);
    if (!messageId || !sender) return;
    if (!alreadyRecorded) {
      if (this.#state.hasSeen(messageId)) return;
      this.#status.messagesReceived += 1;
      this.#status.lastMessageAt = new Date().toISOString();
    }
    const contextToken = typeof message.context_token === 'string' ? message.context_token : undefined;
    const runId = typeof message.run_id === 'string' ? message.run_id : undefined;
    let batchSettled = batchSubmission === null;
    let promptRecorded = false;
    try {
      const promptMessage = preparedMessage ?? this.#inboundMessage(message);
      const text = promptMessage.content;
      const hasImages = hasInboundImages(promptMessage);
      const hasFiles = hasInboundFiles(promptMessage);
      const hasReply = hasReplyReference(promptMessage);
      if (!text && !hasImages && !hasFiles && !hasReply) {
        await this.#send(sender, t('目前支持文字、图片、文件，以及微信已转成文字的语音消息。'), contextToken, runId);
        await this.#state.markSeen(messageId);
        return;
      }

      const command = text.trim().toLowerCase();
      if (!hasImages && !hasFiles && ['/help', '/menu', '/m'].includes(command)) {
        await this.#send(sender, HELP_TEXT(), contextToken, runId);
        await this.#state.markSeen(messageId);
        return;
      }
      if (!hasImages && !hasFiles && command === '/status') {
        await this.#harness.ensureRunning({ signal: this.#signal });
        await this.#send(sender, t('微信与 DeepSeek Harness 连接正常。'), contextToken, runId);
        await this.#state.markSeen(messageId);
        return;
      }
      if (!hasImages && !hasFiles && isNewCommand(text)) {
        const created = await createConversationSession({ state: this.#state, harness: this.#harness, key, title: newCommandTitle(text) });
        await this.#send(sender, created.failed ? t('暂时无法创建新会话，请稍后重试。') : t('已开启新会话。请发送你的问题。'), contextToken, runId);
        await this.#state.markSeen(messageId);
        return;
      }
      if (!hasImages && !hasFiles && isSessionNavCommand(text)) {
        const nav = await runSessionNavTextCommand(text, this.#harness, this.#state, key, {
          signal: this.#signal,
        });
        if (nav) {
          for (const reply of nav.messages ?? [nav.message]) {
            await this.#send(sender, reply, contextToken, runId);
          }
          if (nav.askText) {
            const followUp = this.#enqueueMessage(
              { ...message, item_list: [{ type: 1, text_item: { text: nav.askText } }] },
              `${messageId}-ask`,
              key,
            );
            followUp.catch((error) => {
              this.#logger.warn?.(`[dsh-im:weixin] follow-up ask after a nav command failed:`, error?.message ?? error);
              this.#send(sender, t('切换后的提问发送失败，请重试。'), contextToken, runId).catch(() => undefined);
            });
          }
        }
        await this.#state.markSeen(messageId);
        return;
      }
      const workspaceCommand = hasImages || hasFiles
        ? null
        : await runWorkspaceCommand(text, this.#harness, key);
      if (workspaceCommand) {
        for (const reply of workspaceCommand.messages ?? [workspaceCommand.message]) {
          await this.#send(sender, reply, contextToken, runId);
        }
        await this.#state.markSeen(messageId);
        return;
      }
      const compactCommand = hasImages || hasFiles
        ? null
        : await runCompactCommand(
            text,
            this.#harness,
            this.#state,
            key,
            { signal: this.#signal },
          );
      if (compactCommand) {
        await this.#send(sender, compactCommand.message, contextToken, runId);
        await this.#state.markSeen(messageId);
        return;
      }

      const planCommand = hasImages || hasFiles
        ? null
        : await runPlanCommand(
            text,
            this.#harness,
            this.#state,
            key,
            { signal: this.#signal },
          );
      if (planCommand) {
        await this.#send(sender, planCommand.message, contextToken, runId);
        await this.#state.markSeen(messageId);
        return;
      }

      const goalCommand = hasImages || hasFiles
        ? null
        : await runGoalCommand(
            text,
            this.#harness,
            this.#state,
            key,
            { signal: this.#signal },
          );
      if (goalCommand) {
        await this.#send(sender, goalCommand.message, contextToken, runId);
        await this.#state.markSeen(messageId);
        return;
      }

      let answer;
      let artifacts = [];
      await this.#startTyping(sender, contextToken);
      try {
        let content = hasImages || hasReply
          ? await promptContentForInboundMessage(promptMessage, { signal: this.#signal, deferImages: true })
          : undefined;
        const captured = this.#acceptedMessageIds.get(messageId);
        let contextEnhanced = false;
        if (captured) {
          const originalContent = content ?? text;
          // The capture already carries the moment its own source published, so
          // `enhanceContextContent` accepts it as-is: passing only `.snapshot`
          // here would drop `sentAt` and silently render no block at all.
          content = enhanceContextContent(originalContent, captured);
          contextEnhanced = content !== originalContent;
        }
        await this.#state.markSeen(messageId);
        promptRecorded = true;
        ({ answer, artifacts = [] } = await askInWorkspaceSession({
          onNotice: (notice) => this.#send(sender, notice, contextToken, runId, { stopTyping: false }),
          deferredDelivery: () => ({ coordinator: this.#deferred, target: { toUserId: sender } }),
          harness: this.#harness,
          state: this.#state,
          key,
          text,
          content,
          titleText: batchSubmission?.title,
          sourceGuidance: captured?.snapshot?.config?.guidance,
          contextEnhanced,
          createOptions: { signal: this.#signal },
          existsOptions: { signal: this.#signal },
          askOptions: {
            timeoutMs: this.#replyTimeoutMs,
            signal: this.#signal,
            control: { owner: this, key },
            onUpdate: () => this.#resumeTyping(key, sender, contextToken),
            onInteraction: (interaction) => this.#handleInteraction(interaction, {
              key,
              actor: sender,
              contextToken,
              runId,
            }),
            onInteractionResolved: async (resolution) => {
              await this.#handleInteractionResolved(resolution);
              await this.#resumeTyping(key, sender, contextToken);
            },
            files: promptMessage.files,
            images: promptMessage.images,
          },
        }));
        if (batchSubmission) {
          this.#batchInputs.complete(key, batchSubmission.token);
          batchSettled = true;
        }
      } finally {
        await Promise.allSettled([
          this.#stopTyping(),
          this.#cancelPendingInteraction(key),
          this.#approvals.closeRoute(key),
        ]);
      }
      const answerText = typeof answer === 'string' && answer.trim()
        ? answer
        : artifacts.length > 0 ? t('结果文件已生成。') : answer;
      let textDeliveryError = null;
      let textReceipt = null;
      try {
        textReceipt = createDeliveryReceipt({
          deliveryId: messageId,
          presentation: 'weixin-text',
          providerMessageIds: await this.#send(sender, answerText, contextToken, runId),
        });
      } catch (error) {
        textDeliveryError = channelDeliveryFailure(error);
      }
      const delivery = await this.#deliverArtifacts(
        sender,
        messageId,
        artifacts,
        contextToken,
        runId,
        textReceipt,
      );
      if (textDeliveryError && !delivery.userVisible) throw textDeliveryError;
      if (textDeliveryError && delivery.artifactSendErrors === 0) {
        setLastMessageFailure(
          this.#status,
          textDeliveryError,
          weixinSendFailureOptions(textDeliveryError),
        );
      }
      if (!promptRecorded) await this.#state.markSeen(messageId);
      this.#status.messagesReplied += 1;
      this.#status.lastReplyAt = new Date().toISOString();
      this.#status.lastError = null;
      if (!textDeliveryError && delivery.artifactSendErrors === 0) {
        clearLastMessageFailure(this.#status);
      }
      return delivery.receipt;
    } catch (error) {
      let batchFailureMessage = null;
      if (!batchSettled && batchSubmission) {
        if (error?.code === 'turn-stopped') {
          this.#batchInputs.complete(key, batchSubmission.token);
        } else {
          batchFailureMessage = this.#batchInputs.fail(key, batchSubmission.token).message ?? null;
        }
        batchSettled = true;
      }
      if (error?.code === 'turn-stopped') {
        if (!promptRecorded) await this.#state.markSeen(messageId);
        return;
      }
      if (this.#signal?.aborted) return;
      this.#status.lastError = error?.message ?? String(error);
      const userMessage = inboundFileUserMessage(error)
        ?? imagePromptUserMessage(error);
      const imageDiagnostic = imagePromptDiagnostic(error);
      const sendFailureOptions = weixinSendFailureOptions(error);
      const failure = setLastMessageFailure(this.#status, error, {
        userMessage: userMessage ?? sendFailureOptions?.userMessage,
        reason: imageDiagnostic?.reason ?? sendFailureOptions?.reason,
      });
      this.#logger.error?.(
        `[dsh-weixin] failed to process an inbound message [${failure.referenceId}]:`,
        messageFailureDiagnostic(error, failure),
      );
      try {
        await this.#send(
          sender,
          batchFailureMessage
            ? `${messageFailureText(failure)}\n\n${batchFailureMessage}`
            : messageFailureText(failure),
          contextToken,
          runId,
        );
        if (!promptRecorded) await this.#state.markSeen(messageId);
      } catch (sendError) {
        this.#logger.error?.('[dsh-weixin] failed to send the safe error reply:', sendError);
      }
    }
  }

  async #processInteractionReply(message, messageId, key, expected) {
    this.#signal?.throwIfAborted();
    const current = this.#pendingInteractions.get(key);
    const claimed = expected.claimedReplyMessageId === messageId;
    if (!current || current !== expected || current.submitting) {
      if (claimed && (!current || current !== expected)) {
        return this.#discardResolvedInteractionReply(message, messageId);
      }
      return this.#enqueueMessage(message, messageId, key, { releaseMessageId: false });
    }
    if (this.#state.hasSeen(messageId)) return;
    await this.#state.markSeen(messageId);
    this.#status.messagesReceived += 1;
    this.#status.lastMessageAt = new Date().toISOString();

    const text = nonEmptyString(extractWeixinText(message));
    const contextToken = nonEmptyString(message?.context_token) ?? undefined;
    const runId = nonEmptyString(message?.run_id) ?? undefined;
    if (!text || hasWeixinImageItems(message)) {
      await this.#send(
        expected.actor,
        t('请用文字回答当前问题。'),
        contextToken,
        runId,
      );
      return;
    }

    const pending = this.#pendingInteractions.get(key);
    if (!pending || pending !== expected || pending.submitting) {
      if (claimed && (!pending || pending !== expected)) {
        await this.#send(
          expected.actor,
          INTERACTION_RESOLVED_TEXT(),
          contextToken,
          runId,
        );
        return;
      }
      return this.#enqueueMessage(message, messageId, key, {
        releaseMessageId: false,
        alreadyRecorded: true,
      });
    }
    pending.contextToken = contextToken;
    pending.runId = runId;
    if (pending.needsPresentation) {
      try {
        await this.#presentInteraction(pending);
      } catch {
        this.#status.lastError = t('微信交互问题发送失败。');
        this.#logger.error?.('[dsh-weixin] failed to retry an interaction question');
        pending.interaction.reconnect?.();
        return;
      }
      const presentedPending = this.#pendingInteractions.get(key);
      if (!presentedPending || presentedPending !== expected || presentedPending.submitting) {
        if (claimed && (!presentedPending || presentedPending !== expected)) {
          await this.#send(
            expected.actor,
            INTERACTION_RESOLVED_TEXT(),
            contextToken,
            runId,
          ).catch(() => undefined);
          return;
        }
        return this.#enqueueMessage(message, messageId, key, {
          releaseMessageId: false,
          alreadyRecorded: true,
        });
      }
    }

    const question = pending.questions[pending.index];
    if (!question) return;
    pending.answers.push(harnessAnswerForQuestion(question, text));
    pending.index += 1;
    if (pending.index < pending.questions.length) {
      if (pending.claimedReplyMessageId === messageId) {
        pending.claimedReplyMessageId = null;
      }
      pending.needsPresentation = true;
      try {
        await this.#presentInteraction(pending);
      } catch {
        this.#status.lastError = t('微信交互问题发送失败。');
        this.#logger.error?.('[dsh-weixin] failed to send the next interaction question');
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
      if (this.#signal?.aborted) return;
      if (error?.code === 'interaction-not-pending') {
        this.#clearPendingInteraction(key, pending.interactionId);
        await this.#send(
          pending.actor,
          INTERACTION_RESOLVED_TEXT(),
          pending.contextToken,
          pending.runId,
        ).catch(() => undefined);
        return;
      }
      if (this.#pendingInteractions.get(key) !== pending) return;
      pending.submitting = false;
      pending.answers.pop();
      pending.index -= 1;
      this.#status.lastError = t('回答提交失败。');
      this.#logger.error?.('[dsh-weixin] failed to answer a Harness interaction');
      await this.#send(
        pending.actor,
        t('回答提交失败，请重新发送当前问题的答案。'),
        pending.contextToken,
        pending.runId,
      ).catch(() => undefined);
    }
  }

  async presentSessionSyncApproval(interaction, context, options = {}) {
    return this.#approvals.handleSessionSyncRequested(interaction, context, {
      ...options, runtimeSignal: this.#signal, accessPolicy: this.#accessPolicy,
    });
  }

  async #handleInteraction(interaction, {
    key,
    actor,
    contextToken,
    runId,
  }) {
    if (interaction?.kind === 'approval') {
      return this.#approvals.handleRequested(interaction, {
        key,
        actor,
        send: (text) => this.#send(actor, text, contextToken, runId),
      });
    }
    if (interaction?.kind !== 'question') return;
    const questions = interaction?.payload?.questions;
    const interactionId = typeof interaction?.interactionId === 'string'
      ? interaction.interactionId
      : interaction?.rpcId;
    if (typeof interaction?.rpcId !== 'string'
      || typeof interactionId !== 'string'
      || typeof interaction.sessionId !== 'string'
      || !Array.isArray(questions)
      || questions.length === 0
      || questions.some((question) => !validHarnessQuestion(question))) {
      this.#logger.warn?.('[dsh-weixin] ignored an invalid Harness question interaction');
      return;
    }

    if (interaction.recovered === true) {
      await interaction.respond({
        ok: false,
        error: {
          code: 'cancelled',
          message: 'Weixin safely cancelled an interaction left by an earlier client.',
          details: {},
        },
      });
      await this.#send(
        actor,
        t('检测到这个 Session 中遗留的待回答问题，已安全取消并继续处理你刚才的消息。'),
        contextToken,
        runId,
      ).catch(() => undefined);
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
      await interaction.respond({
        ok: false,
        error: {
          code: 'cancelled',
          message: 'Weixin is already handling another user interaction.',
          details: {},
        },
      });
      return;
    }

    const pending = {
      kind: 'question',
      interactionId,
      sessionId: interaction.sessionId,
      interaction,
      actor,
      questions,
      answers: [],
      index: 0,
      contextToken,
      runId,
      queue: null,
      claimedReplyMessageId: null,
      presentationPromise: null,
      submitting: false,
      needsPresentation: true,
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
    const interactionId = resolution?.interactionId;
    if (resolution?.kind !== 'question' || typeof interactionId !== 'string') return;
    const key = this.#interactionKeys.get(interactionId);
    if (!key) return;
    this.#clearPendingInteraction(key, interactionId);
  }

  #presentInteraction(pending) {
    if (!pending.needsPresentation) return Promise.resolve();
    if (pending.presentationPromise) return pending.presentationPromise;
    const question = pending.questions[pending.index];
    if (!question) return Promise.resolve();
    const presentation = this.#send(
      pending.actor,
      harnessQuestionText(question, pending.index, pending.questions.length),
      pending.contextToken,
      pending.runId,
    ).then(() => {
      pending.needsPresentation = false;
    }).finally(() => {
      if (pending.presentationPromise === presentation) pending.presentationPromise = null;
    });
    pending.presentationPromise = presentation;
    return presentation;
  }

  async #discardResolvedInteractionReply(message, messageId) {
    if (this.#state.hasSeen(messageId)) return;
    await this.#state.markSeen(messageId);
    this.#status.messagesReceived += 1;
    this.#status.lastMessageAt = new Date().toISOString();
    await this.#send(
      nonEmptyString(message?.from_user_id),
      INTERACTION_RESOLVED_TEXT(),
      nonEmptyString(message?.context_token) ?? undefined,
      nonEmptyString(message?.run_id) ?? undefined,
    ).catch(() => undefined);
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

  async #cancelPendingInteraction(key) {
    const pending = this.#takePendingInteraction(key);
    if (!pending || pending.kind !== 'question') return;
    try {
      await pending.interaction.respond({
        ok: false,
        error: {
          code: 'cancelled',
          message: 'The Weixin interaction ended before the user answered.',
          details: {},
        },
      }, { signal: AbortSignal.timeout(5_000) });
    } catch (error) {
      if (error?.code !== 'interaction-not-pending') {
        this.#logger.warn?.('[dsh-weixin] failed to cancel a pending Harness interaction');
      }
    }
  }

  async #handleInteractionFailure(message, messageId, error) {
    if (this.#signal?.aborted) return;
    this.#status.lastError = error?.message ?? String(error);
    const failure = setLastMessageFailure(this.#status, error);
    this.#logger.error?.(
      `[dsh-weixin] failed to process an interaction reply [${failure.referenceId}]:`,
      messageFailureDiagnostic(error, failure),
    );
    if (!this.#state.hasSeen(messageId)) {
      await this.#state.markSeen(messageId).catch(() => undefined);
    }
    await this.#send(
      nonEmptyString(message?.from_user_id),
      messageFailureText(failure),
      nonEmptyString(message?.context_token) ?? undefined,
      nonEmptyString(message?.run_id) ?? undefined,
    ).catch(() => undefined);
  }

  async #send(toUserId, text, contextToken, runId, { stopTyping = true } = {}) {
    if (stopTyping) await this.#stopTyping();
    contextToken ??= this.#state.contextTokenFor?.(toUserId);
    const providerMessageIds = [];
    const chunks = splitWeixinText(text, this.#maxMessageChars);
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      const chunk = chunks[chunkIndex];
      const sentAt = Date.now();
      try {
        const result = await this.#api.sendText({
          baseUrl: this.#baseUrl,
          token: this.#token,
          toUserId,
          text: chunk,
          contextToken,
          runId,
          signal: this.#signal,
        });
        const chunkMessageIds = providerMessageIdsFor(result);
        providerMessageIds.push(...chunkMessageIds);
        try {
          await this.#state.rememberOutboundMessage?.({
            toUserId,
            text: chunk,
            sentAt,
            completedAt: Date.now(),
            providerMessageIds: chunkMessageIds,
          });
        } catch (error) {
          this.#logger.warn?.('[dsh-weixin] failed to remember an outbound message:', error);
        }
      } catch (error) {
        throw weixinSendError(error, {
          baseUrl: this.#baseUrl,
          text,
          chunk,
          chunkIndex,
          chunkCount: chunks.length,
          maxMessageChars: this.#maxMessageChars,
          contextToken,
          runId,
        });
      }
    }
    return providerMessageIds;
  }

  async #sendOutOfBand(key, toUserId, text, contextToken, runId) {
    try {
      return await this.#send(toUserId, text, contextToken, runId);
    } finally {
      if (this.#queues.has(key)) {
        await this.#resumeTyping(key, toUserId, contextToken);
      }
    }
  }

  #queueTyping(operation) {
    const task = this.#typingTail
      .catch(() => undefined)
      .then(operation);
    this.#typingTail = task.catch(() => undefined);
    return task;
  }

  async #startTyping(toUserId, contextToken) {
    const target = nonEmptyString(toUserId);
    if (!target
      || this.#typingClosed
      || this.#signal?.aborted
      || Date.now() < this.#typingRetryAt
      || typeof this.#api.getConfig !== 'function'
      || typeof this.#api.sendTyping !== 'function') return false;
    if (this.#typingTarget === target) return true;

    const generation = ++this.#typingGeneration;
    try {
      return await this.#queueTyping(async () => {
        if (generation !== this.#typingGeneration || this.#typingClosed) return false;
        let ticket = this.#typingTicket;
        if (!ticket) {
          const config = await this.#api.getConfig({
            baseUrl: this.#baseUrl,
            token: this.#token,
            toUserId: target,
            contextToken,
            signal: this.#signal,
          });
          ticket = nonEmptyString(config?.typingTicket);
          if (!ticket) {
            this.#typingRetryAt = Date.now() + TYPING_RETRY_DELAY_MS;
            return false;
          }
          if (generation !== this.#typingGeneration || this.#typingClosed) return false;
          this.#typingTicket = ticket;
          this.#typingRetryAt = 0;
        }

        this.#typingTarget = target;
        await this.#api.sendTyping({
          baseUrl: this.#baseUrl,
          token: this.#token,
          toUserId: target,
          typingTicket: ticket,
          status: 1,
          signal: this.#signal,
        });
        if (generation !== this.#typingGeneration || this.#typingClosed) return false;
        this.#typingTicketStale = false;
        this.#typingRetryAt = 0;
        this.#scheduleTyping(generation);
        return true;
      });
    } catch (error) {
      if (generation === this.#typingGeneration) {
        this.#clearTypingTimer();
        this.#typingTicketStale = Boolean(this.#typingTarget && this.#typingTicket);
        this.#typingRetryAt = Date.now() + TYPING_RETRY_DELAY_MS;
      }
      if (!this.#signal?.aborted && !this.#typingClosed) {
        this.#logger.warn?.('[dsh-weixin] typing indicator failed:', error);
      }
      return false;
    }
  }

  async #stopTyping({ signal = AbortSignal.timeout(5_000) } = {}) {
    ++this.#typingGeneration;
    this.#clearTypingTimer();
    const target = this.#typingTarget;
    const ticket = this.#typingTicket;
    const stale = this.#typingTicketStale;
    this.#typingTarget = null;
    if (typeof this.#api.sendTyping !== 'function') return false;
    try {
      return await this.#queueTyping(async () => {
        if (!target || !ticket) return false;
        try {
          await this.#api.sendTyping({
            baseUrl: this.#baseUrl,
            token: this.#token,
            toUserId: target,
            typingTicket: ticket,
            status: 2,
            signal,
          });
        } finally {
          if (stale && this.#typingTicket === ticket) this.#typingTicket = null;
          this.#typingTicketStale = false;
        }
        return true;
      });
    } catch (error) {
      if (!signal?.aborted) {
        this.#logger.warn?.('[dsh-weixin] typing cancellation failed:', error);
      }
      return false;
    }
  }

  #scheduleTyping(generation) {
    this.#clearTypingTimer();
    if (generation !== this.#typingGeneration || !this.#typingTarget || this.#typingClosed) return;
    const timer = setTimeout(() => {
      if (this.#typingTimer === timer) this.#typingTimer = null;
      void this.#queueTyping(async () => {
        if (generation !== this.#typingGeneration || !this.#typingTarget || this.#typingClosed) {
          return false;
        }
        await this.#api.sendTyping({
          baseUrl: this.#baseUrl,
          token: this.#token,
          toUserId: this.#typingTarget,
          typingTicket: this.#typingTicket,
          status: 1,
          signal: this.#signal,
        });
        return true;
      }).then((sent) => {
        if (sent) this.#scheduleTyping(generation);
      }).catch((error) => {
        if (generation !== this.#typingGeneration) return;
        this.#typingTicketStale = Boolean(this.#typingTarget && this.#typingTicket);
        this.#typingRetryAt = Date.now() + TYPING_RETRY_DELAY_MS;
        if (!this.#signal?.aborted && !this.#typingClosed) {
          this.#logger.warn?.('[dsh-weixin] typing keepalive failed:', error);
        }
      });
    }, this.#typingKeepaliveMs);
    timer.unref?.();
    this.#typingTimer = timer;
  }

  #clearTypingTimer() {
    if (this.#typingTimer) clearTimeout(this.#typingTimer);
    this.#typingTimer = null;
  }

  #resumeTyping(key, toUserId, contextToken) {
    if (this.#pendingInteractions.has(key) || this.#approvals.hasPending(key)) {
      return Promise.resolve(false);
    }
    return this.#startTyping(toUserId, contextToken);
  }

  async #deliverArtifacts(toUserId, replyTo, artifacts, contextToken, runId, baseReceipt) {
    const sendArtifact = (method, file) => this.#api[method]({
      baseUrl: this.#baseUrl,
      token: this.#token,
      toUserId,
      file,
      contextToken,
      runId,
      signal: this.#signal,
    });
    const delivery = await deliverOutboundArtifacts({
      artifacts,
      baseReceipt,
      deliveryId: replyTo,
      aggregatePresentation: baseReceipt ? 'weixin-text-and-files' : 'weixin-files',
      channelKey: 'weixin',
      signal: this.#signal,
      sendImage: typeof this.#api.sendImage === 'function'
        ? (file) => sendArtifact('sendImage', file)
        : undefined,
      sendFile: typeof this.#api.sendFile === 'function'
        ? (file) => sendArtifact('sendFile', file)
        : undefined,
      onFailure: (artifact, error) => setLastMessageFailure(this.#status, error, {
        userMessage: artifactFailureText(artifact?.fileName, error),
        reason: error?.code,
      }),
      sendFailureNotice: (_artifact, _error, failure) => this.#send(
        toUserId,
        messageFailureText(failure),
        contextToken,
        runId,
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
}
