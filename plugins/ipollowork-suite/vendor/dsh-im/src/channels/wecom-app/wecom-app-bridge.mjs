import { BusyMessageDispatcher, canAutomaticallySteer } from '../shared/busy-message-dispatcher.mjs';
import { createHash } from 'node:crypto';
import { menuIntroductionText } from '../shared/menu-introduction.mjs';
import { wecomAppMenuCommand } from './menu.mjs';
import { SESSION_NAV_HELP_LINES } from '../shared/command-catalog.mjs';
import { createDeferredDeliveryCoordinator, deferredOutcomeText } from '../shared/deferred-delivery-coordinator.mjs';
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
} from '../shared/context-enhancement.mjs';
import {
  DEFAULT_IMAGE_PROMPT,
  hasInboundImages,
  imagePromptDiagnostic,
  imagePromptUserMessage,
} from '../shared/image-prompt.mjs';
import {
  hasInboundFiles,
  inboundFileUserMessage,
} from '../shared/inbound-file.mjs';
import { rememberConnectionTestTarget } from '../shared/connection-test.mjs';
import { deliverOutboundArtifacts } from '../shared/semantic/artifact-delivery.mjs';
import {
  createDeliveryReceipt,
  providerMessageIdsFor,
} from '../shared/semantic/delivery.mjs';
import {
  hasReplyReference,
  promptContentForInboundMessage,
} from '../shared/semantic/reply-reference.mjs';
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
import { WECOM_APP_TEXT_MAX_BYTES, splitUtf8ByBytes } from './wecom-app-api.mjs';

const INTERACTION_RESOLVED_TEXT = () => t('这个问题已在其他客户端处理，无需再次回答。');
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const UNSUPPORTED_INBOUND_TEXT = () => t('企业微信应用目前支持文字和图片消息。');

const HELP_TEXT = () => [
  t('企业微信应用已连接 DeepSeek Harness，可在微信中直接使用。'),
  '',
  t('直接发送文字或图片即可继续当前会话。'),
  t('/new  开启一个全新会话'),
  t('/compact  压缩当前会话的较早上下文'),
  t('/clear  清空当前会话上下文（保留 Session 绑定和历史记录）'),
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

function messageText(message) {
  if (message?.msgtype === 'voice') return nonEmptyString(message.recognition ?? message.voice?.content) ?? '';
  if (message?.msgtype !== 'text') return '';
  return typeof message.text?.content === 'string' ? message.text.content : '';
}

function hasImageItems(message) {
  return message?.msgtype === 'image' && Boolean(message.image?.url || message.mediaId);
}

function supportedInboundType(message) {
  return ['text', 'image', 'voice', 'file', 'video'].includes(message?.msgtype);
}

function answerTextForDelivery(answer, artifacts) {
  return typeof answer === 'string' && answer.trim()
    ? answer
    : (Array.isArray(artifacts) && artifacts.length > 0 ? t('结果文件已生成。') : answer);
}

// Inbound image source: WeCom either hands out a directly fetchable PicUrl or
// a media_id downloadable through the authenticated media API. Loads are cached
// so an eager prefetch survives the queue wait without a second download.
function imageSource(api, image) {
  const url = nonEmptyString(image?.url);
  const mediaId = nonEmptyString(image?.mediaId) ?? nonEmptyString(image?.media_id);
  if (!url && !mediaId) return null;
  let cached = null;
  return {
    async load({ signal, maxBytes } = {}) {
      signal?.throwIfAborted();
      if (cached) return cached;
      let data;
      let name;
      if (url) {
        const response = await fetch(url, { signal });
        if (!response.ok) throw new Error(`企业微信图片下载失败（HTTP ${response.status}）`);
        const buffer = Buffer.from(await response.arrayBuffer());
        if (Number.isFinite(maxBytes) && buffer.length > maxBytes) {
          const error = new Error(`企业微信图片超过 ${maxBytes} 字节`);
          error.code = 'image-too-large';
          throw error;
        }
        data = buffer;
        const declared = nonEmptyString(response.headers?.get?.('content-disposition'));
        name = declared?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/iu)?.[1] ?? 'image';
      } else {
        const result = await api.downloadMedia({ mediaId, signal });
        data = result.data;
        name = result.filename ?? 'image';
      }
      if (Number.isFinite(maxBytes) && data.length > maxBytes) {
        const error = new Error(`企业微信图片超过 ${maxBytes} 字节`);
        error.code = 'image-too-large';
        throw error;
      }
      cached = { data, name };
      return cached;
    },
  };
}

export function wecomAppInboundMessage(message, api) {
  const media = ['voice', 'file', 'video'].includes(message?.msgtype) && nonEmptyString(message.mediaId);
  const voice = message?.msgtype === 'voice';
  return {
    content: messageText(message),
    images: hasImageItems(message)
      ? [imageSource(api, { url: message.image?.url, mediaId: message.mediaId })].filter(Boolean)
      : [],
    files: media ? [{
      name: voice ? `voice.${message.format === 'speex' ? 'spx' : 'amr'}` : message.msgtype === 'video' ? 'video.mp4' : 'file',
      ...(voice ? { mediaType: message.format === 'speex' ? 'audio/ogg' : 'audio/amr', transcript: messageText(message) } : {}),
      load: async ({ signal } = {}) => {
        const result = await api.downloadMedia({ mediaId: message.mediaId, signal });
        return { data: result.data, ...(result.filename ? { name: result.filename } : {}) };
      },
    }] : [],
  };
}

function canClaimInteractionReply(message, pending) {
  return pending.questions[pending.index]
    && nonEmptyString(message?.from?.userid) === pending.actor
    && !hasImageItems(message)
    && nonEmptyString(messageText(message));
}

export class WecomAppBridge {
  #api;
  #harness;
  #state;
  #status;
  #contextEnhancement;
  #accessPolicy;
  #logger;
  #replyTimeoutMs;
  #signal;
  #streamRegistry;
  #maxChunkBytes;
  #queues = new Map();
  #busyMessages = new BusyMessageDispatcher();
  #acceptedMessageIds = new Map();
  #commandTasks = new Set();
  #approvalTasks = new Set();
  #pendingInteractions = new Map();
  #interactionKeys = new Map();
  #approvals;
  #batchInputs;
  #deferred;
  #closed = false;
  #nativeMenuReady;

  constructor({
    api,
    harness,
    state,
    status,
    contextEnhancement,
    accessPolicy,
    logger = console,
    replyTimeoutMs = 600_000,
    signal,
    streamRegistry,
    maxChunkBytes = WECOM_APP_TEXT_MAX_BYTES,
    nativeMenuReady = () => false,
  }) {
    if (!api || typeof api.sendText !== 'function') throw new TypeError('WecomAppBridge requires a WecomAppApi');
    if (!harness || !state) throw new TypeError('WecomAppBridge requires Harness and state');
    this.#api = api;
    this.#harness = harness;
    this.#state = state;
    this.#status = status;
    this.#contextEnhancement = contextEnhancement;
    this.#accessPolicy = accessPolicy;
    this.#logger = logger;
    this.#replyTimeoutMs = replyTimeoutMs;
    this.#signal = signal;
    this.#streamRegistry = streamRegistry;
    this.#maxChunkBytes = maxChunkBytes;
    this.#nativeMenuReady = nativeMenuReady;
    this.#deferred = createDeferredDeliveryCoordinator({
      harness, state, signal, logger,
      deliver: (entry, outcome) => this.#deliverDeferredOutcome(entry, outcome),
    });
    this.#approvals = new HarnessApprovalQueue({ label: 'wecom-app', logger });
    this.#batchInputs = new BatchInputManager();
  }

  get status() {
    return structuredClone(this.#status);
  }

  async acceptEvent(message) {
    if (this.#closed || this.#signal?.aborted) return;
    const event = nonEmptyString(message?.event) ?? nonEmptyString(message?.eventtype);
    const sender = nonEmptyString(message?.from?.userid) ?? nonEmptyString(message?.FromUserName);
    if (!sender) return;
    if (event?.toLowerCase() === 'click') {
      const command = wecomAppMenuCommand(message.eventKey);
      if (!command || (!message.msgid && !message.createTime)) return;
      const id = message.msgid ?? `menu-${createHash('sha256').update(JSON.stringify([sender, message.createTime, message.eventKey])).digest('hex')}`;
      return this.accept({ ...message, msgid: id, msgtype: 'text', text: { content: command } });
    }
    if (event !== 'subscribe' && event !== 'enter_chat') return;
    if (this.#nativeMenuReady() || !evaluateInboundAccess(this.#accessPolicy, {
      conversationType: 'direct', senderIds: sender, isCommand: true,
    }).allowed) return;
    try {
      await this.#state.introduceMenu?.(conversationKey(sender), () => this.#send(sender, menuIntroductionText()), { signal: this.#signal, logger: this.#logger });
    } catch (error) {
      this.#logger.warn?.('[dsh-im:wecom-app] failed to send the welcome message:', error);
    }
  }

  accept(message, { sink } = {}) {
    if (this.#closed || this.#signal?.aborted) return Promise.resolve();
    const messageId = nonEmptyString(message?.msgid);
    const sender = nonEmptyString(message?.from?.userid);
    if (!messageId || !sender || !supportedInboundType(message)
      || this.#state.hasSeen(messageId) || this.#acceptedMessageIds.has(messageId)) {
      return Promise.resolve();
    }
    const commandText = nonEmptyString(messageText(message)) ?? '';
    const hasImages = hasImageItems(message);
    const access = evaluateInboundAccess(this.#accessPolicy, {
      conversationType: 'direct',
      senderIds: sender,
      text: commandText,
      hasImages,
      hasFiles: hasInboundFiles(wecomAppInboundMessage(message, this.#api)),
    });
    if (!access.allowed) {
      this.#acceptedMessageIds.set(messageId, null);
      return this.#finishAccessDecision(messageId, sender, access);
    }
    const introductionKey = conversationKey(sender);
    if (!this.#nativeMenuReady() && this.#state.needsMenuIntroduction?.(introductionKey)
      && evaluateInboundAccess(this.#accessPolicy, { conversationType: 'direct', senderIds: sender, isCommand: true }).allowed) {
      return this.#state.introduceMenu(introductionKey, () => this.#send(sender, menuIntroductionText()), { signal: this.#signal, logger: this.#logger })
        .then(() => this.accept(message, { sink }));
    }
    this.#acceptedMessageIds.set(messageId, captureContextEnhancement(
      this.#contextEnhancement,
      'direct',
    ));
    rememberConnectionTestTarget(this.#state, { toUserId: sender });
    const key = conversationKey(sender);
    const pending = this.#pendingInteractions.get(key);
    const batchCommand = isBatchInputCommand(commandText);
    const batchStatus = this.#batchInputs.status(key);
    if (batchCommand || batchStatus.phase === 'collecting') {
      const exactBatchStart = /^\/batch$/iu.test(commandText);
      const result = exactBatchStart
        && batchStatus.phase === 'idle'
        && (this.#queues.has(key) || pending || this.#approvals.hasPending(key))
        ? { handled: true, kind: 'busy', message: batchInputBusyMessage() }
        : this.#batchInputs.handle(key, commandText, { plainText: !hasImages });
      if (result.handled) {
        if (result.kind === 'submit') {
          return this.#enqueueMessage({
            ...message,
            msgtype: 'text',
            text: { content: result.prompt },
          }, messageId, key, { batchSubmission: result, sink: null });
        }
        return this.#finishBatchResult(messageId, key, sender, result);
      }
    }
    const commandRunner = isClearCommand(commandText) ? runClearCommand
      : isResetCommand(commandText) ? runResetCommand
      : isHistoryCommand(commandText) ? runHistoryCommand
      : isControlCommand(commandText)
      ? runControlCommand
      : (isModelCommand(commandText)
          ? runModelCommand
          : (isPresetCommand(commandText) ? runPresetCommand : null));
    if (commandRunner) {
      let task;
      task = this.#processFastCommand(message, messageId, key, sender, commandText, commandRunner)
        .catch((error) => {
          if (error?.code === 'turn-stopped' || this.#signal?.aborted) return;
          this.#status.lastError = error?.message ?? String(error);
          const failure = setLastMessageFailure(this.#status, error);
          this.#logger.error?.(
            `[dsh-im:wecom-app] failed to process a command [${failure.referenceId}]:`,
            messageFailureDiagnostic(error, failure),
          );
          return this.#send(sender, messageFailureText(failure)).catch(() => undefined);
        })
        .finally(() => {
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
      text: hasImages ? '' : commandText,
      addressed: true,
      hasPendingQuestion: Boolean(pending),
      questionCompletion: pending?.submitting || pending?.claimedReplyMessageId
        ? pending.queue
        : null,
      isQuestionPending: () => this.#pendingInteractions.has(key),
      send: (text) => this.#send(sender, text),
    });
    if (approval) {
      let task;
      task = approval.process(async () => {
        if (this.#state.hasSeen(messageId)) return false;
        await this.#state.markSeen(messageId);
        this.#status.messagesReceived += 1;
        this.#status.lastMessageAt = new Date().toISOString();
        return true;
      }).finally(() => {
        this.#acceptedMessageIds.delete(messageId);
        this.#approvalTasks.delete(task);
      });
      this.#approvalTasks.add(task);
      return task;
    }
    if (pending?.submitting || pending?.claimedReplyMessageId) {
      return this.#enqueueMessage(message, messageId, key, { sink: null });
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
      eligible: () => message.msgtype === 'text' && !hasImages
        && !hasReplyReference(wecomAppInboundMessage(message, this.#api))
        && canAutomaticallySteer(this.#accessPolicy, 'direct', sender),
      harness: this.#harness, state: this.#state, status: this.#status,
      signal: this.#signal, control: { owner: this, key }, logger: this.#logger,
      acceptedMessageIds: this.#acceptedMessageIds,
      pendingInteraction: () => this.#pendingInteractions.has(key) || this.#approvals.hasPending(key),
      enhancement: {
        snapshot: this.#acceptedMessageIds.get(messageId),
        source: () => ({ channel: 'wecom-app', senderId: sender, chatId: sender }),
      },
      isQueued: () => this.#queues.has(key),
      enqueue: (options) => this.#enqueueMessage(message, messageId, key, { ...options, sink }),
      send: (reply) => this.#send(sender, reply),
      onError: (error) => this.#handleInteractionFailure(message, messageId, error),
    });
  }

  #enqueueMessage(message, messageId, key, {
    releaseMessageId = true,
    alreadyRecorded = false,
    batchSubmission = null,
    sink = null,
  } = {}) {
    const preparedMessage = wecomAppInboundMessage(message, this.#api);
    const previous = this.#queues.get(key) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(() => this.#process(message, key, {
        alreadyRecorded,
        preparedMessage,
        batchSubmission,
        sink,
      }))
      .finally(() => {
        if (releaseMessageId) this.#acceptedMessageIds.delete(messageId);
        if (this.#queues.get(key) === current) this.#queues.delete(key);
      });
    this.#queues.set(key, current);
    return current;
  }

  #finishBatchResult(messageId, key, sender, result) {
    let task;
    task = Promise.resolve().then(async () => {
      if (this.#state.hasSeen(messageId)) return;
      await this.#state.markSeen(messageId);
      this.#status.messagesReceived += 1;
      this.#status.lastMessageAt = new Date().toISOString();
      if (result.message) await this.#send(sender, result.message);
      this.#status.lastError = null;
    }).catch(async (error) => {
      if (this.#signal?.aborted) return;
      this.#status.lastError = error?.message ?? String(error);
      const failure = setLastMessageFailure(this.#status, error);
      this.#logger.error?.(
        `[dsh-im:wecom-app] failed to process a batch input message [${failure.referenceId}]:`,
        messageFailureDiagnostic(error, failure),
      );
      await this.#send(sender, messageFailureText(failure)).catch(() => undefined);
    }).finally(() => {
      this.#acceptedMessageIds.delete(messageId);
      this.#commandTasks.delete(task);
    });
    this.#commandTasks.add(task);
    return task;
  }

  #finishAccessDecision(messageId, sender, access) {
    let task;
    task = Promise.resolve().then(async () => {
      if (this.#state.hasSeen(messageId)) return;
      await this.#state.markSeen(messageId);
      if (access.reason === 'command-not-allowed') {
        this.#status.messagesReceived += 1;
        this.#status.lastMessageAt = new Date().toISOString();
        await this.#send(sender, t(COMMAND_PERMISSION_DENIED_MESSAGE));
        this.#status.messagesReplied += 1;
        this.#status.lastReplyAt = new Date().toISOString();
      } else {
        this.#status.messagesRejected = (this.#status.messagesRejected ?? 0) + 1;
        this.#status.lastRejectedAt = new Date().toISOString();
      }
      this.#status.lastError = null;
    }).catch((error) => {
      if (this.#signal?.aborted) return;
      this.#status.lastError = error?.message ?? String(error);
      this.#logger.error?.('[dsh-im:wecom-app] failed to apply inbound access policy:', error);
    }).finally(() => {
      this.#acceptedMessageIds.delete(messageId);
      this.#commandTasks.delete(task);
    });
    this.#commandTasks.add(task);
    return task;
  }

  async #deliverDeferredOutcome(entry, outcome) {
    await this.#send(entry.target.toUserId, deferredOutcomeText(outcome));
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
    ]);
    await this.#deferred.whenIdle();
  }

  async close() {
    this.#closed = true;
    this.#deferred.close();
  }

  async #processFastCommand(message, messageId, key, sender, text, runner) {
    this.#signal?.throwIfAborted();
    if (this.#state.hasSeen(messageId)) return;
    await this.#state.markSeen(messageId);
    this.#status.messagesReceived += 1;
    this.#status.lastMessageAt = new Date().toISOString();
    const result = await runner(text, this.#harness, this.#state, key, {
      signal: this.#signal,
      isDirect: true,
      hasImages: hasImageItems(message),
      hasFiles: hasInboundFiles(wecomAppInboundMessage(message, this.#api)),
      pendingInteraction: this.#pendingInteractions.has(key)
        || this.#approvals.hasPending(key),
      busy: this.#queues.has(key) || this.#batchInputs.status(key).phase !== 'idle',
      control: { owner: this, key },
      deferredDelivery: this.#deferred,
      enhancement: captureContextEnhancementSource(
        this.#contextEnhancement,
        'direct',
        () => ({ channel: 'wecom-app', senderId: sender, chatId: sender }),
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
      await this.#send(sender, reply);
    }
    this.#status.lastError = null;
  }

  async #process(message, key, {
    alreadyRecorded = false,
    preparedMessage,
    batchSubmission = null,
    sink = null,
  } = {}) {
    this.#signal?.throwIfAborted();
    const messageId = nonEmptyString(message?.msgid);
    const sender = nonEmptyString(message?.from?.userid);
    if (!messageId || !sender) return;
    if (!alreadyRecorded) {
      if (this.#state.hasSeen(messageId)) return;
      this.#status.messagesReceived += 1;
      this.#status.lastMessageAt = new Date().toISOString();
    }
    let batchSettled = batchSubmission === null;
    let promptRecorded = false;
    let streamActive = Boolean(sink && !sink.finished());
    let streamedText = '';
    try {
      const promptMessage = preparedMessage ?? wecomAppInboundMessage(message, this.#api);
      const text = promptMessage.content;
      const hasImages = hasInboundImages(promptMessage);
      const hasFiles = hasInboundFiles(promptMessage);
      const hasReply = hasReplyReference(promptMessage);
      if (!text && !hasImages && !hasFiles && !hasReply) {
        await this.#send(sender, UNSUPPORTED_INBOUND_TEXT());
        await this.#state.markSeen(messageId);
        return;
      }
      const command = text.trim().toLowerCase();
      if (!hasImages && !hasFiles && ['/help', '/menu', '/m'].includes(command)) {
        await this.#send(sender, HELP_TEXT());
        await this.#state.markSeen(messageId);
        return;
      }
      if (!hasImages && !hasFiles && command === '/status') {
        await this.#harness.ensureRunning({ signal: this.#signal });
        await this.#send(sender, t('企业微信应用与 DeepSeek Harness 连接正常。'));
        await this.#state.markSeen(messageId);
        return;
      }
      if (!hasImages && !hasFiles && isNewCommand(text)) {
        const created = await createConversationSession({ state: this.#state, harness: this.#harness, key, title: newCommandTitle(text) });
        await this.#send(sender, created.failed ? t('暂时无法创建新会话，请稍后重试。') : t('已开启新会话。请发送你的问题。'));
        await this.#state.markSeen(messageId);
        return;
      }
      if (!hasImages && !hasFiles && isSessionNavCommand(text)) {
        const nav = await runSessionNavTextCommand(text, this.#harness, this.#state, key, {
          signal: this.#signal,
        });
        if (nav) {
          for (const reply of nav.messages ?? [nav.message]) {
            await this.#send(sender, reply);
          }
          if (nav.askText) {
            const followUp = this.#enqueueMessage(
              {
                ...message,
                msgtype: 'text',
                text: { content: nav.askText },
                image: undefined,
                mediaId: undefined,
              },
              `${messageId}-ask`,
              key,
              { sink },
            );
            followUp.catch((error) => {
              this.#logger.warn?.(`[dsh-im:wecom-app] follow-up ask after a nav command failed:`, error?.message ?? error);
              this.#send(sender, t('切换后的提问发送失败，请重试。')).catch(() => undefined);
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
          await this.#send(sender, reply);
        }
        await this.#state.markSeen(messageId);
        return;
      }
      const compactCommand = hasImages || hasFiles
        ? null
        : await runCompactCommand(text, this.#harness, this.#state, key, { signal: this.#signal });
      if (compactCommand) {
        await this.#send(sender, compactCommand.message);
        await this.#state.markSeen(messageId);
        return;
      }

      let answer;
      let artifacts = [];
      try {
        let content = hasImages || hasReply
          ? await promptContentForInboundMessage(promptMessage, { signal: this.#signal, deferImages: true })
          : undefined;
        const snapshot = this.#acceptedMessageIds.get(messageId);
        let contextEnhanced = false;
        if (snapshot) {
          const originalContent = content ?? text;
          content = enhanceContextContent(originalContent, snapshot, () => ({
            channel: 'wecom-app',
            senderId: sender,
            chatId: sender,
          }));
          contextEnhanced = content !== originalContent;
        }
        await this.#state.markSeen(messageId);
        promptRecorded = true;
        ({ answer, artifacts = [] } = await askInWorkspaceSession({
          onNotice: (notice) => this.#send(sender, notice),
          deferredDelivery: () => ({ coordinator: this.#deferred, target: { toUserId: sender } }),
          harness: this.#harness,
          state: this.#state,
          key,
          text,
          content,
          titleText: batchSubmission?.title,
          sourceGuidance: snapshot?.config?.guidance,
          contextEnhanced,
          createOptions: { signal: this.#signal },
          existsOptions: { signal: this.#signal },
          askOptions: {
            timeoutMs: this.#replyTimeoutMs,
            signal: this.#signal,
            control: { owner: this, key },
            onUpdate: streamActive
              ? async (update) => {
                  if (update?.type !== 'text') return;
                  streamedText = update.text;
                  this.#streamRegistry.appendStream(sink.streamId, streamedText, { replace: true });
                }
              : undefined,
            onInteraction: (interaction) => this.#handleInteraction(interaction, {
              key,
              actor: sender,
            }),
            onInteractionResolved: async (resolution) => {
              await this.#handleInteractionResolved(resolution);
            },
            files: promptMessage.files,
            images: promptMessage.images,
          },
        }));
        if (batchSubmission) {
          this.#batchInputs.complete(key, batchSubmission.token);
          batchSettled = true;
        }
      } catch (error) {
        if (streamActive && !sink.finished()) {
          const diagnostic = imagePromptDiagnostic(error);
          if (diagnostic?.userMessage) {
            this.#streamRegistry.appendStream(sink.streamId, `\n${diagnostic.userMessage}`);
          }
          this.#streamRegistry.finishStream(sink.streamId);
        }
        throw error;
      }
      const displayAnswer = answerTextForDelivery(answer, artifacts);
      if (streamActive && !sink.finished()) {
        if (displayAnswer && displayAnswer !== streamedText) {
          this.#streamRegistry.appendStream(sink.streamId, displayAnswer, { replace: true });
        }
        this.#streamRegistry.finishStream(sink.streamId);
      }
      const answerText = displayAnswer ?? t('结果文件已生成。');
      let textDeliveryError = null;
      let textReceipt = null;
      try {
        if (streamActive && sink.refreshes() > 0) {
          textReceipt = createDeliveryReceipt({
            deliveryId: messageId,
            presentation: 'wecom-app-stream',
            providerMessageIds: [sink.streamId],
          });
        } else {
          // The client never consumed the stream (or streaming is disabled):
          // fall back to explicit text messages so the answer still arrives.
          textReceipt = createDeliveryReceipt({
            deliveryId: messageId,
            presentation: 'wecom-app-text',
            providerMessageIds: await this.#send(sender, answerText),
          });
        }
      } catch (error) {
        textDeliveryError = channelDeliveryFailure(error);
      }
      const delivery = await this.#deliverArtifacts(sender, messageId, artifacts, textReceipt);
      if (textDeliveryError && !delivery.userVisible) throw textDeliveryError;
      if (textDeliveryError && delivery.artifactSendErrors === 0) {
        setLastMessageFailure(this.#status, textDeliveryError);
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
      const userMessage = inboundFileUserMessage(error) ?? imagePromptUserMessage(error);
      const imageDiagnostic = imagePromptDiagnostic(error);
      const failure = setLastMessageFailure(this.#status, error, {
        userMessage: userMessage ?? undefined,
        reason: imageDiagnostic?.reason ?? undefined,
      });
      this.#logger.error?.(
        `[dsh-im:wecom-app] failed to process an inbound message [${failure.referenceId}]:`,
        messageFailureDiagnostic(error, failure),
      );
      try {
        await this.#send(
          sender,
          batchFailureMessage
            ? `${messageFailureText(failure)}\n\n${batchFailureMessage}`
            : messageFailureText(failure),
        );
        if (!promptRecorded) await this.#state.markSeen(messageId);
      } catch (sendError) {
        this.#logger.error?.('[dsh-im:wecom-app] failed to send the safe error reply:', sendError);
      }
    }
  }

  async #send(sender, text) {
    const target = nonEmptyString(sender);
    const value = typeof text === 'string' ? text : '';
    if (!target || !value) return [];
    const providerMessageIds = [];
    const chunks = splitUtf8ByBytes(value, this.#maxChunkBytes);
    for (const chunk of chunks) {
      if (!chunk) continue;
      const result = await this.#api.sendText({ userId: target, content: chunk, signal: this.#signal });
      providerMessageIds.push(...providerMessageIdsFor(result));
    }
    return providerMessageIds;
  }

  async #processInteractionReply(message, messageId, key, expected) {
    this.#signal?.throwIfAborted();
    const current = this.#pendingInteractions.get(key);
    const claimed = expected.claimedReplyMessageId === messageId;
    if (!current || current !== expected || current.submitting) {
      if (claimed && (!current || current !== expected)) {
        return this.#discardResolvedInteractionReply(message, messageId);
      }
      return this.#enqueueMessage(message, messageId, key, { releaseMessageId: false, sink: null });
    }
    if (this.#state.hasSeen(messageId)) return;
    await this.#state.markSeen(messageId);
    this.#status.messagesReceived += 1;
    this.#status.lastMessageAt = new Date().toISOString();

    const text = nonEmptyString(messageText(message));
    if (!text || hasImageItems(message)) {
      await this.#send(expected.actor, t('请用文字回答当前问题。'));
      return;
    }

    const pending = this.#pendingInteractions.get(key);
    if (!pending || pending !== expected || pending.submitting) {
      if (claimed && (!pending || pending !== expected)) {
        await this.#send(expected.actor, INTERACTION_RESOLVED_TEXT());
        return;
      }
      return this.#enqueueMessage(message, messageId, key, {
        releaseMessageId: false,
        alreadyRecorded: true,
        sink: null,
      });
    }
    if (pending.needsPresentation) {
      try {
        await this.#presentInteraction(pending);
      } catch {
        this.#status.lastError = t('企业微信应用交互问题发送失败。');
        this.#logger.error?.('[dsh-im:wecom-app] failed to retry an interaction question');
        pending.interaction.reconnect?.();
        return;
      }
      const presentedPending = this.#pendingInteractions.get(key);
      if (!presentedPending || presentedPending !== expected || presentedPending.submitting) {
        if (claimed && (!presentedPending || presentedPending !== expected)) {
          await this.#send(expected.actor, INTERACTION_RESOLVED_TEXT()).catch(() => undefined);
          return;
        }
        return this.#enqueueMessage(message, messageId, key, {
          releaseMessageId: false,
          alreadyRecorded: true,
          sink: null,
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
        this.#status.lastError = t('企业微信应用交互问题发送失败。');
        this.#logger.error?.('[dsh-im:wecom-app] failed to send the next interaction question');
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
        await this.#send(pending.actor, INTERACTION_RESOLVED_TEXT()).catch(() => undefined);
        return;
      }
      if (this.#pendingInteractions.get(key) !== pending) return;
      pending.submitting = false;
      pending.answers.pop();
      pending.index -= 1;
      this.#status.lastError = t('回答提交失败。');
      this.#logger.error?.('[dsh-im:wecom-app] failed to answer a Harness interaction');
      await this.#send(pending.actor, t('回答提交失败，请重新发送当前问题的答案。')).catch(() => undefined);
    }
  }

  async presentSessionSyncApproval(interaction, context, options = {}) {
    return this.#approvals.handleSessionSyncRequested(interaction, context, {
      ...options, runtimeSignal: this.#signal, accessPolicy: this.#accessPolicy,
    });
  }

  async #handleInteraction(interaction, { key, actor }) {
    if (interaction?.kind === 'approval') {
      return this.#approvals.handleRequested(interaction, {
        key,
        actor,
        send: (text) => this.#send(actor, text),
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
      this.#logger.warn?.('[dsh-im:wecom-app] ignored an invalid Harness question interaction');
      return;
    }

    if (interaction.recovered === true) {
      await interaction.respond({
        ok: false,
        error: {
          code: 'cancelled',
          message: 'Wecom-app safely cancelled an interaction left by an earlier client.',
          details: {},
        },
      });
      await this.#send(actor, t('检测到这个 Session 中遗留的待回答问题，已安全取消并继续处理你刚才的消息。')).catch(() => undefined);
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
          message: 'Wecom-app is already handling another user interaction.',
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
      nonEmptyString(message?.from?.userid),
      INTERACTION_RESOLVED_TEXT(),
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
          message: 'The Enterprise WeChat app interaction ended before the user answered.',
          details: {},
        },
      }, { signal: AbortSignal.timeout(5_000) });
    } catch (error) {
      if (error?.code !== 'interaction-not-pending') {
        this.#logger.warn?.('[dsh-im:wecom-app] failed to cancel a pending Harness interaction');
      }
    }
  }

  async #handleInteractionFailure(message, messageId, error) {
    if (this.#signal?.aborted) return;
    this.#status.lastError = error?.message ?? String(error);
    const failure = setLastMessageFailure(this.#status, error);
    this.#logger.error?.(
      `[dsh-im:wecom-app] failed to process an interaction reply [${failure.referenceId}]:`,
      messageFailureDiagnostic(error, failure),
    );
    if (!this.#state.hasSeen(messageId)) {
      await this.#state.markSeen(messageId).catch(() => undefined);
    }
    await this.#send(
      nonEmptyString(message?.from?.userid),
      messageFailureText(failure),
    ).catch(() => undefined);
  }

  async #deliverArtifacts(sender, replyTo, artifacts, baseReceipt) {
    const sendArtifact = (kind) => (file) => this.#api.sendArtifactFile({
      userId: sender,
      kind,
      bytes: file.bytes,
      filename: file.fileName,
      signal: this.#signal,
    });
    const delivery = await deliverOutboundArtifacts({
      artifacts,
      baseReceipt,
      deliveryId: replyTo,
      aggregatePresentation: baseReceipt ? 'wecom-app-text-and-files' : 'wecom-app-files',
      channelKey: 'wecom-app',
      signal: this.#signal,
      sendImage: (file) => sendArtifact('image')(file),
      sendFile: (file) => sendArtifact('file')(file),
      onFailure: (artifact, error) => setLastMessageFailure(this.#status, error, {
        userMessage: artifactFailureText(artifact?.fileName, error),
        reason: error?.code,
      }),
      sendFailureNotice: (_artifact, _error, failure) => this.#send(sender, messageFailureText(failure)),
      logger: this.#logger,
    });
    this.#status.artifactsSent = (this.#status.artifactsSent ?? 0) + delivery.artifactsSent;
    this.#status.artifactSendErrors = (this.#status.artifactSendErrors ?? 0) + delivery.artifactSendErrors;
    return {
      receipt: delivery.receipt,
      userVisible: delivery.userVisible,
      artifactSendErrors: delivery.artifactSendErrors,
    };
  }
}

function artifactFailureText(fileName, error) {
  const name = String(fileName ?? t('结果文件')).replace(/[\r\n]+/g, ' ').trim() || t('结果文件');
  switch (error?.code) {
    case 'artifact-delivery-uncertain':
      return t('结果文件「{name}」发送结果未能确认，请先检查聊天内是否已收到，不要立即重试。', { name });
    case 'artifact-permission-required':
      return t('结果文件「{name}」已生成，但企业微信应用当前没有文件消息发送权限，请检查应用的文件发送能力。', { name });
    case 'artifact-too-large':
      return t('结果文件「{name}」超过企业微信可发送的文件大小，未发送。', { name });
    case 'artifact-rate-limited':
      return t('结果文件「{name}」暂时被企业微信限流，未能发送，请稍后重试。', { name });
    case 'artifact-provider-rejected':
      return t('结果文件「{name}」已生成，但企业微信拒绝了该文件消息。', { name });
    default:
      return t('结果文件「{name}」发送失败，请稍后重试。', { name });
  }
}
