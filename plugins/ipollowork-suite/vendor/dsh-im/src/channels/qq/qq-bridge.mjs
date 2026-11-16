import { captureGroupHistory } from '../shared/group-history.mjs';
import { SESSION_NAV_HELP_LINES } from '../shared/command-catalog.mjs';
import { BusyMessageDispatcher, canAutomaticallySteer } from '../shared/busy-message-dispatcher.mjs';
import { isPermissionCommand, runPermissionCommand } from '../shared/permission-command.mjs';
import { createDeferredDeliveryCoordinator, deferredOutcomeText } from '../shared/deferred-delivery-coordinator.mjs';
import { runWorkspaceCommand } from '../shared/workspace-command.mjs';
import { runCompactCommand } from '../shared/compact-command.mjs';
import { isClearCommand, runClearCommand } from '../shared/clear-command.mjs';
import { isResetCommand, runResetCommand } from '../shared/reset-command.mjs';
import { isHistoryCommand, runHistoryCommand } from '../shared/history-command.mjs';
import {
  isControlCommand,
  runControlCommand,
} from '../shared/control-command.mjs';
import { rememberConnectionTestTarget } from '../shared/connection-test.mjs';
import {
  harnessAnswerForQuestion,
  harnessQuestionText,
  validHarnessQuestion,
} from '../shared/harness-question.mjs';
import { HarnessApprovalQueue } from '../shared/harness-approval.mjs';
import {
  isModelCommand,
  runModelCommand,
} from '../shared/model-command.mjs';
import {
  isPresetCommand,
  runPresetCommand,
} from '../shared/preset-command.mjs';
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
  BatchInputManager,
  batchInputBusyMessage,
  batchInputGroupUnsupportedMessage,
  isBatchInputCommand,
} from '../shared/batch-input.mjs';
import {
  fetchImageBuffer,
  hasInboundImages,
  imagePromptDiagnostic,
  imagePromptUserMessage,
} from '../shared/image-prompt.mjs';
import {
  hasInboundFiles,
  inboundFileUserMessage,
  prefetchInboundFiles,
} from '../shared/inbound-file.mjs';
import {
  trackOutboundArtifactProviderPromise,
} from '../shared/semantic/artifact.mjs';
import { deliverOutboundArtifacts } from '../shared/semantic/artifact-delivery.mjs';
import {
  hasReplyReference,
  promptContentForInboundMessage,
} from '../shared/semantic/reply-reference.mjs';
import {
  createDeliveryReceipt,
  providerMessageIdsFor,
} from '../shared/semantic/delivery.mjs';
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
import { ApiError } from '@tencent-connect/qqbot-nodejs';
import { sendMarkdownReply } from './markdown-reply.mjs';
import {
  isQqMenuCommand, parseQqMenuCommand, QqMenuStore,
  qqMenuPage, qqMenuView, sendQqMenu,
} from './qq-menu.mjs';
import { withSessionBindingLock } from '../shared/session-binding-lock.mjs';
import { t } from '../shared/i18n.mjs';
import { isQqMessageAddressed, normalizeQqMentions } from './qq-mention.mjs';

function interactionResolvedText() {
  return t('这个问题已在其他客户端处理，无需再次回答。');
}
const DEFAULT_FILE_UPLOAD_TIMEOUT_MS = 120_000;

export const QQ_IMAGE_HOSTS = Object.freeze([
  '.myqcloud.com',
  '.qpic.cn',
  '.qq.com',
  '.qq.com.cn',
  '.tencentcos.com',
  '.ugcimg.cn',
]);

const QQ_IMAGE_FILENAME = /\.(?:gif|jpe?g|png|webp)$/i;

/** Durable queue-entry id; the conversation key keeps ids unique across chats. */
function pendingMessageId(key, messageId) {
  return `${key}\u0000${messageId}`;
}

const PENDING_RESTART_NOTICE = '排队中的消息在服务重启时被中断。为避免重复执行，未自动重放；如果该消息尚未处理，请重新发送。';

function helpText() {
  return [
    t('QQ 机器人已连接 DeepSeek Harness。'),
    '',
    t('直接发送文字、图片或文件即可继续当前会话。'),
    t('/menu 或 /m  打开可点击的功能菜单'),
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
    t('/permissionlist  按序号列出权限档位'),
    t('/permission [序号或完整ID]  查看或切换当前会话权限'),
    t('纯数字 ID：/permission id:<ID>'),
    t('/stop  停止当前任务'),
    t('/steer 补充指令  纠偏当前任务'),
    t('/batch  开始批量输入（仅私聊，最多 10 条文字）'),
    t('/send  提交当前批次'),
    t('/cancel  取消当前批次'),
    t('/status  检查连接状态'),
    t('/version  查看插件版本'),
    t('/help  显示本帮助'),
  ].join('\n');
}

function conversationKey(message) {
  return `${message.kind}:${message.kind === 'group' ? message.groupOpenid : message.senderId}`;
}

function senderAllowed(message, ownerUserOpenid) {
  return message?.kind === 'group'
    || ownerUserOpenid === '*'
    || message?.senderId === ownerUserOpenid;
}

function safeText(message) {
  return typeof message?.content === 'string' ? message.content.trim() : '';
}

function attachmentMediaType(attachment) {
  const value = nonEmptyString(attachment?.content_type ?? attachment?.contentType);
  if (!value) return null;
  return value.split(';', 1)[0].trim().toLowerCase();
}

function isQqImageAttachment(attachment) {
  const mediaType = attachmentMediaType(attachment);
  return mediaType?.startsWith('image/') === true
    || QQ_IMAGE_FILENAME.test(nonEmptyString(attachment?.filename) ?? '');
}

function hasQqImageAttachments(message) {
  return Array.isArray(message?.attachments)
    && message.attachments.some(isQqImageAttachment);
}

function hasQqFileAttachments(message) {
  return Array.isArray(message?.attachments)
    && message.attachments.some((attachment) => !isQqImageAttachment(attachment));
}

function qqAttachmentKind(attachment) {
  const mediaType = attachmentMediaType(attachment);
  if (mediaType?.startsWith('image/')) return 'image';
  if (mediaType?.startsWith('audio/')) return 'audio';
  if (mediaType?.startsWith('video/')) return 'video';
  return 'file';
}

function qqReplyReference(message) {
  const refMsgIdx = nonEmptyString(message?.refMsgIdx);
  if (!refMsgIdx) return null;
  const element = Array.isArray(message?.msgElements) ? message.msgElements[0] : null;
  const sourceAttachments = Array.isArray(element?.attachments) ? element.attachments : [];
  const attachments = sourceAttachments.map((attachment) => {
    const name = nonEmptyString(attachment?.filename);
    return { kind: qqAttachmentKind(attachment), ...(name ? { name } : {}) };
  });
  const asrText = sourceAttachments
    .filter((attachment) => qqAttachmentKind(attachment) === 'audio')
    .map((attachment) => nonEmptyString(attachment?.asr_refer_text))
    .filter(Boolean)
    .join('\n');
  const content = asrText || nonEmptyString(element?.content);
  return {
    messageId: refMsgIdx,
    ...(content ? { content } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(!content && attachments.length === 0 ? { unavailableReason: 'not-delivered' } : {}),
  };
}

async function fetchQqFileBuffer(url, { fetchImpl, signal }) {
  const normalizedUrl = url.startsWith('//') ? `https:${url}` : url;
  const response = await fetchImpl(new URL(normalizedUrl), {
    method: 'GET',
    signal,
    redirect: 'follow',
  });
  if (!response?.ok) {
    await response?.body?.cancel?.().catch?.(() => undefined);
    throw new Error(`QQ file download failed with HTTP ${response?.status ?? 'unknown'}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/** Convert QQ's attachment metadata into lazily downloaded image references. */
export function qqInboundMessage(message, { fetchImpl = fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  const images = [];
  const files = [];
  for (const attachment of message?.attachments ?? []) {
    const url = nonEmptyString(attachment?.url);
    const name = nonEmptyString(attachment?.filename) ?? undefined;
    const mediaType = attachmentMediaType(attachment);
    const declaredSize = Number(attachment?.size);
    if (isQqImageAttachment(attachment)) {
      images.push({
        ...(name ? { name } : {}),
        ...(mediaType?.startsWith('image/') ? { mediaType } : {}),
        ...(Number.isFinite(declaredSize) && declaredSize >= 0 ? { size: declaredSize } : {}),
        load: ({ signal, maxBytes }) => {
          if (!url) throw new Error('QQ image attachment has no download URL');
          return fetchImageBuffer(url, {
            fetchImpl,
            signal,
            maxBytes,
            allowedHosts: QQ_IMAGE_HOSTS,
          });
        },
      });
      continue;
    }
    files.push({
      name: name ?? (files.length === 0 ? 'file' : `file-${files.length + 1}`),
      ...(mediaType?.includes('/') ? { mediaType } : {}),
      ...(Number.isFinite(declaredSize) && declaredSize >= 0 ? { size: declaredSize } : {}),
      load: ({ signal } = {}) => {
        if (!url) throw new Error('QQ file attachment has no download URL');
        return fetchQqFileBuffer(url, { fetchImpl, signal });
      },
    });
  }
  const replyTo = qqReplyReference(message);
  return {
    content: safeText(message),
    images,
    files,
    ...(replyTo ? { replyTo } : {}),
  };
}

// QQ accepts passive replies to an inbound msg_id for a bounded window
// (C2C 60 min, group 5 min). Proactive C2C/group sends are quota-limited and
// are often refused, so a late result keeps the passive route while the
// window is still open and only falls back to proactive delivery after it.
const PASSIVE_REPLY_WINDOW_MS = Object.freeze({ c2c: 60 * 60_000, group: 5 * 60_000 });
const PASSIVE_REPLY_MARGIN_MS = 30_000;

function deferredQqTarget(message, target, acceptedAt) {
  const route = { scope: target.scope, targetId: target.targetId };
  const msgId = nonEmptyString(target.msgId);
  if (!msgId || !PASSIVE_REPLY_WINDOW_MS[target.scope]) return route;
  const sentAt = Date.parse(message?.timestamp ?? '');
  return { ...route, msgId, receivedAt: Number.isFinite(sentAt) ? Math.min(sentAt, acceptedAt) : acceptedAt };
}

export function deferredDeliveryTarget(target, now = Date.now()) {
  const route = { scope: target?.scope, targetId: target?.targetId };
  const window = PASSIVE_REPLY_WINDOW_MS[target?.scope];
  if (!nonEmptyString(target?.msgId) || !window || !Number.isFinite(target?.receivedAt)) return route;
  return now - target.receivedAt < window - PASSIVE_REPLY_MARGIN_MS ? { ...route, msgId: target.msgId } : route;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function artifactFailureText(fileName, error) {
  const name = String(fileName ?? t('结果文件')).replace(/[\r\n]+/g, ' ').trim() || t('结果文件');
  if (error?.name === 'UploadDailyLimitExceededError') {
    return t('结果文件「{name}」已生成，但 QQ 今日文件上传额度已用完，请稍后重试。', { name });
  }
  switch (error?.code) {
    case 'artifact-delivery-uncertain':
      return t('结果文件「{name}」的发送结果未能确认，请先检查聊天内是否已收到，不要立即重试。', { name });
    case 'artifact-permission-required':
      return t('结果文件「{name}」已生成，但当前 QQ 机器人没有文件消息权限。', { name });
    case 'artifact-too-large':
      return t('结果文件「{name}」超过当前 QQ 机器人可发送的文件大小，未发送。', { name });
    case 'artifact-empty':
      return t('结果文件「{name}」为空，QQ 不允许发送空文件。', { name });
    case 'artifact-changed':
    case 'artifact-invalid':
    case 'artifact-unavailable':
      return t('结果文件「{name}」暂时无法读取或准备发送，请确认文件仍可访问后重试。', { name });
    case 'artifact-rate-limited':
      return t('结果文件「{name}」暂时被 QQ 限流，未能发送，请稍后重试。', { name });
    case 'artifact-provider-rejected':
      return t('结果文件「{name}」已生成，但 QQ 拒绝了该文件或文件消息。', { name });
    default:
      return t('结果文件「{name}」已生成，但暂时未能通过 QQ 发送，请稍后重试。', { name });
  }
}

function answerTextForDelivery(answer, artifacts) {
  if (typeof answer === 'string' && answer.trim()) return answer;
  return artifacts.length > 0 ? t('结果文件已生成。') : answer;
}

function qqArtifactError(error, { dispatched = false } = {}) {
  if (error?.code?.startsWith?.('artifact-')) {
    return error;
  }
  if (error?.name === 'UploadDailyLimitExceededError') {
    const wrapped = new Error('QQ daily file upload limit exceeded', { cause: error });
    wrapped.name = error.name;
    wrapped.code = 'artifact-rate-limited';
    return wrapped;
  }
  const status = Number(error?.httpStatus);
  const wrapped = new Error('QQ file delivery failed', { cause: error });
  if (status === 401 || status === 403) wrapped.code = 'artifact-permission-required';
  else if (status === 413) wrapped.code = 'artifact-too-large';
  else if (status === 429) wrapped.code = 'artifact-rate-limited';
  else if ([400, 404, 405, 406, 410, 415, 422].includes(status)) {
    wrapped.code = 'artifact-provider-rejected';
  } else {
    wrapped.code = dispatched ? 'artifact-delivery-uncertain' : 'artifact-provider-failed';
  }
  return wrapped;
}

function abortReason(signal) {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted', 'AbortError');
}

function waitWithSignal(promise, signal) {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      callback(value);
    };
    const onAbort = () => finish(reject, abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
    if (signal.aborted) onAbort();
  });
}

/** Send one materialized artifact through QQ's native image message. */
export async function sendQqImage(
  bot,
  target,
  file,
  { signal, timeoutMs = DEFAULT_FILE_UPLOAD_TIMEOUT_MS } = {},
) {
  signal?.throwIfAborted();
  if (typeof bot?.sendImage !== 'function') {
    const unavailable = new Error('QQ image delivery is unavailable');
    unavailable.code = 'artifact-provider-unavailable';
    throw unavailable;
  }

  try {
    const timeout = AbortSignal.timeout(timeoutMs);
    const waitSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const pending = bot.sendImage(
      target,
      { buffer: file.bytes },
      { onProgress: () => signal?.throwIfAborted() },
    );
    trackOutboundArtifactProviderPromise(file, pending);
    return await waitWithSignal(pending, waitSignal);
  } catch (error) {
    if (signal?.aborted) throw abortReason(signal);
    throw qqArtifactError(error, { dispatched: true });
  }
}

async function sendQqFile(
  bot,
  target,
  file,
  { signal, timeoutMs = DEFAULT_FILE_UPLOAD_TIMEOUT_MS } = {},
) {
  signal?.throwIfAborted();
  if (typeof bot?.sendFile !== 'function') {
    const unavailable = new Error('QQ file delivery is unavailable');
    unavailable.code = 'artifact-provider-unavailable';
    throw unavailable;
  }

  try {
    const timeout = AbortSignal.timeout(timeoutMs);
    const waitSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const pending = bot.sendFile(
      target,
      { buffer: file.bytes },
      {
        fileName: file.fileName,
        onProgress: () => signal?.throwIfAborted(),
      },
    );
    trackOutboundArtifactProviderPromise(file, pending);
    return await waitWithSignal(pending, waitSignal);
  } catch (error) {
    if (signal?.aborted) throw abortReason(signal);
    throw qqArtifactError(error, { dispatched: true });
  }
}

function canClaimInteractionReply(message, pending) {
  return pending.questions[pending.index]
    && nonEmptyString(message?.senderId) === pending.actor
    && isQqMessageAddressed(message)
    && !hasQqImageAttachments(message)
    && !hasQqFileAttachments(message)
    && nonEmptyString(safeText(message));
}

export function createQqBridgeStatus() {
  return {
    messagesReceived: 0,
    messagesReplied: 0,
    messagesRejected: 0,
    artifactsSent: 0,
    artifactSendErrors: 0,
    lastMessageAt: null,
    lastReplyAt: null,
    lastRejectedAt: null,
    lastError: null,
    lastMessageError: null,
  };
}

export class QqHarnessBridge {
  #bot;
  #ownerUserOpenid;
  #harness;
  #state;
  #deferred;
  #contextEnhancement;
  #groupHistory;
  #accessPolicy;
  #status;
  #logger;
  #replyTimeoutMs;
  #signal;
  #fetchImpl;
  #fileUploadTimeoutMs;
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
  #batchInputs = new BatchInputManager();
  #menus = new QqMenuStore();
  #menuTasks = new Map();

  constructor({
    bot,
    ownerUserOpenid,
    harness,
    state,
    contextEnhancement,
    groupHistory,
    accessPolicy,
    status = createQqBridgeStatus(),
    logger = console,
    replyTimeoutMs = 600_000,
    signal,
    fetchImpl = fetch,
    fileUploadTimeoutMs = DEFAULT_FILE_UPLOAD_TIMEOUT_MS,
  }) {
    if (!bot || typeof bot.sendText !== 'function') throw new TypeError('QQ bot client is required');
    if (!ownerUserOpenid) throw new TypeError('QQ scanner identity is required');
    if (!harness || !state) throw new TypeError('Harness client and state store are required');
    if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
    if (!Number.isInteger(fileUploadTimeoutMs) || fileUploadTimeoutMs < 1) {
      throw new TypeError('fileUploadTimeoutMs must be a positive integer');
    }
    this.#bot = bot;
    this.#ownerUserOpenid = ownerUserOpenid;
    this.#harness = harness;
    this.#state = state;
    this.#contextEnhancement = contextEnhancement;
    this.#groupHistory = groupHistory;
    this.#accessPolicy = accessPolicy;
    this.#status = status;
    this.#logger = logger;
    this.#replyTimeoutMs = replyTimeoutMs;
    this.#signal = signal;
    this.#deferred = createDeferredDeliveryCoordinator({ harness, state, signal, logger,
      finalAnswerOnly: true,
      deliver: (entry, outcome) => this.#deliverDeferredOutcome(entry, outcome),
    });
    this.#fetchImpl = fetchImpl;
    this.#fileUploadTimeoutMs = Math.min(fileUploadTimeoutMs, DEFAULT_FILE_UPLOAD_TIMEOUT_MS);
    this.#approvals = new HarnessApprovalQueue({ label: 'qq', logger });
    // A queued message lives only in #queues. If the process dies before its
    // turn runs the user has already been told it is queued, so the persisted
    // entry must be replayed or reported as soon as the bridge starts.
    this.recoverPendingMessages();
  }

  get status() {
    return structuredClone(this.#status);
  }

  accept(message) {
    if (!this.#groupHistory || message?.kind !== 'group') return this.#accept(message);
    const normalized = { ...qqInboundMessage(message, { fetchImpl: this.#fetchImpl }), kind: 'group',
      senderId: message.senderId, senderIsBot: message.senderIsBot, addressed: isQqMessageAddressed(message) };
    return captureGroupHistory(this.#groupHistory, normalized, {
      channel: 'qq', scope: `app:${this.#bot.appId}`, groupId: message.groupOpenid,
      messageId: message.messageId, sentAt: message.timestamp, senderName: message.senderName,
      text: message.raw?.content ?? message.content ?? '',
      type: message.attachments?.length ? 'file' : 'text',
      capability: '仅保存实际投递的消息；未 @ 能力及跨应用群身份尚需验证，当前按应用来源隔离。',
    }, { logger: this.#logger })
      .then(() => { message.groupHistory = normalized.groupHistory; return this.#accept(message); });
  }

  #accept(message, { introduced = false } = {}) {
    if (this.#signal?.aborted) return Promise.resolve();
    const messageId = nonEmptyString(message?.messageId);
    const sender = nonEmptyString(message?.senderId);
    if (!messageId || !sender || message?.senderIsBot === true
      || !['c2c', 'group'].includes(message?.kind)
      || this.#state.hasSeen(messageId)
      || this.#acceptedMessageIds.has(messageId)) return Promise.resolve();
    message = normalizeQqMentions(message, new Set([this.#bot.appId]));
    const key = conversationKey(message);
    const addressed = isQqMessageAddressed(message);
    const commandText = safeText(message);
    const menuTextOnly = !hasQqImageAttachments(message) && !hasQqFileAttachments(message)
      && !qqReplyReference(message);
    const explicitMenu = menuTextOnly && isQqMenuCommand(commandText);
    const numericMenu = menuTextOnly && /^\d{1,2}$/u.test(commandText)
      && this.#menus.has(key, sender)
      && !this.#pendingInteractions.has(key) && !this.#approvals.hasPending(key)
      && this.#batchInputs.status(key).phase === 'idle';
    const menuInput = numericMenu
      ? `/m pick ${this.#menus.tokenFor(key, sender)} ${commandText}` : commandText;
    if (addressed) {
      const access = this.#accessPolicy
        ? evaluateInboundAccess(this.#accessPolicy, {
            conversationType: message.kind === 'c2c' ? 'direct' : 'group',
            senderIds: sender,
            text: commandText,
            hasImages: hasQqImageAttachments(message),
            hasFiles: hasQqFileAttachments(message),
            ...(explicitMenu || numericMenu || isPermissionCommand(commandText) ? { isCommand: true } : {}),
          })
        : senderAllowed(message, this.#ownerUserOpenid)
          ? { allowed: true, reason: 'legacy-owner' }
          : { allowed: false, reason: 'sender-not-allowed' };
      if (!access.allowed) {
        this.#acceptedMessageIds.set(messageId, null);
        return this.#finishAccessDecision(message, messageId, access);
      }
    }
    if (message.kind === 'c2c' && !explicitMenu && this.#state.needsMenuIntroduction?.(key)
      && (!this.#accessPolicy || evaluateInboundAccess(this.#accessPolicy, { conversationType: 'direct', senderIds: sender, isCommand: true }).allowed)) {
      return this.#state.introduceMenu(key, () => this.#showMenu(message, key, 'main'), { signal: this.#signal, logger: this.#logger })
        .then(() => this.#accept(message, { introduced: true }));
    }
    this.#acceptedMessageIds.set(messageId, captureContextEnhancement(
      this.#contextEnhancement,
      message.kind === 'c2c' ? 'direct' : 'group',
    ));
    if (message.kind === 'c2c'
      && (this.#ownerUserOpenid === '*' || sender === this.#ownerUserOpenid)
      && message.replyTarget?.scope === 'c2c'
      && nonEmptyString(message.replyTarget.targetId) === sender) {
      rememberConnectionTestTarget(this.#state, message.replyTarget);
    }
    const pending = this.#pendingInteractions.get(key);
    const batchCommand = isBatchInputCommand(commandText);
    const batchStatus = this.#batchInputs.status(key);
    // Ordinary prompts and other commands end number selection. A pending
    // question/approval or batch keeps its existing interpretation of digits.
    if (addressed && !explicitMenu && !numericMenu && !introduced) this.#menus.clear(key, sender);
    if (batchCommand && addressed && message.kind === 'group') {
      return this.#finishBatchResult(
        message,
        messageId,
        { message: batchInputGroupUnsupportedMessage() },
      );
    }
    if (message.kind === 'c2c'
      && (batchCommand || batchStatus.phase === 'collecting')) {
      if (explicitMenu) return this.#finishBatchResult(message, messageId, {
        message: t('当前正在批量输入，请先发送 /send 或 /cancel，再打开菜单。'),
      });
      const exactBatchStart = /^\/batch$/iu.test(commandText);
      const result = exactBatchStart
        && batchStatus.phase === 'idle'
        && (this.#queues.has(key) || pending || this.#approvals.hasPending(key))
        ? { handled: true, kind: 'busy', message: batchInputBusyMessage() }
        : this.#batchInputs.handle(key, commandText, {
            plainText: Boolean(commandText)
              && !hasQqImageAttachments(message)
              && !hasQqFileAttachments(message)
              && !qqReplyReference(message),
          });
      if (result.handled) {
        if (result.kind === 'submit') {
          return this.#enqueueMessage(
            {
              ...message,
              content: result.prompt,
              // The submission is exactly the collected text: the command
              // message's own attachments and quoted message are not part of it.
              attachments: [],
              refMsgIdx: undefined,
            },
            messageId,
            key,
            { batchSubmission: result },
          );
        }
        return this.#finishBatchResult(message, messageId, result);
      }
    }
    const commandRunner = explicitMenu || numericMenu
      ? () => this.#runMenuCommand(message, menuInput, key)
      : isClearCommand(commandText) ? runClearCommand
      : isResetCommand(commandText) ? runResetCommand
      : isHistoryCommand(commandText) ? runHistoryCommand
      : isPermissionCommand(commandText) ? runPermissionCommand
      : hasQqFileAttachments(message) ? null : isControlCommand(commandText)
      ? runControlCommand
      : (isModelCommand(commandText)
          ? runModelCommand
          : (isPresetCommand(commandText) ? runPresetCommand : null));
    if (commandRunner && addressed) {
      let task;
      task = this.#processFastCommand(
        message,
        messageId,
        key,
        commandText,
        commandRunner,
      ).catch((error) => {
        if (error?.code === 'turn-stopped' || this.#signal?.aborted) return;
        this.#status.lastError = error?.message ?? String(error);
        const failure = setLastMessageFailure(this.#status, error);
        this.#logger.error?.(
          `[dsh-im:qq] failed to process a command [${failure.referenceId}]:`,
          messageFailureDiagnostic(error, failure),
        );
        return this.#bot.sendText(message.replyTarget, messageFailureText(failure))
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
      text: hasQqImageAttachments(message) || hasQqFileAttachments(message) ? '' : safeText(message),
      addressed,
      hasPendingQuestion: Boolean(pending),
      questionCompletion: pending?.submitting || pending?.claimedReplyMessageId
        ? pending.queue
        : null,
      isQuestionPending: () => this.#pendingInteractions.has(key),
      send: (text) => this.#bot.sendText(message.replyTarget, text),
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
    if (pending && sender !== pending.actor) {
      return this.#enqueueMessage(message, messageId, key);
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
      eligible: () => addressed && menuTextOnly && !explicitMenu && !numericMenu
        && canAutomaticallySteer(this.#accessPolicy, message.kind === 'c2c' ? 'direct' : 'group', sender),
      harness: this.#harness, state: this.#state, status: this.#status,
      signal: this.#signal, control: { owner: this, key }, logger: this.#logger,
      acceptedMessageIds: this.#acceptedMessageIds,
      pendingInteraction: () => this.#pendingInteractions.has(key) || this.#approvals.hasPending(key),
      enhancement: {
        snapshot: this.#acceptedMessageIds.get(messageId),
        source: () => ({ channel: 'qq', senderId: sender,
          senderName: message.kind === 'group' ? message.senderName : undefined,
          chatId: message.kind === 'group' ? message.groupOpenid : sender }),
      },
      isQueued: () => this.#queues.has(key),
      enqueue: (options) => this.#enqueueMessage(message, messageId, key, options),
      send: (reply) => addressed ? this.#bot.sendText(message.replyTarget, reply) : Promise.resolve(),
      onError: (error) => this.#handleInteractionFailure(message, messageId, error),
    });
  }

  #enqueueMessage(message, messageId, key, {
    releaseMessageId = true,
    alreadyRecorded = false,
    batchSubmission = null,
  } = {}) {
    // Persist before the message joins the in-memory chain: the chain may wait
    // behind a long turn, and a restart in that window must not lose the input.
    const pending = this.#recordPendingMessage(message, messageId, key);
    const addressed = isQqMessageAddressed(message);
    const preparedMessage = addressed
      ? prefetchInboundFiles(
          qqInboundMessage(message, { fetchImpl: this.#fetchImpl }),
          { signal: this.#signal },
        )
      : undefined;
    const previous = this.#queues.get(key) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(() => pending)
      .then(() => this.#process(message, key, {
        alreadyRecorded,
        preparedMessage,
        batchSubmission,
      }))
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
      this.#logger.warn?.('[dsh-im:qq] queued-message recovery failed:', error?.message ?? error);
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
          '[dsh-im:qq] replaying a queued message that a restart interrupted:',
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
          '[dsh-im:qq] failed to recover a queued message:',
          entry?.messageId,
          error?.message ?? error,
        );
      }
    }
  }

  #recordPendingMessage(message, messageId, key) {
    if (typeof this.#state?.putPendingMessage !== 'function') return Promise.resolve();
    const text = safeText(message);
    if (!text) return Promise.resolve();
    const senderId = nonEmptyString(message.senderId);
    const entry = {
      id: pendingMessageId(key, messageId),
      key,
      messageId,
      kind: message.kind === 'group' ? 'group' : 'c2c',
      text,
      submitted: false,
      createdAt: new Date().toISOString(),
      ...(senderId ? { senderId } : {}),
      ...(message.replyTarget !== undefined ? { target: message.replyTarget } : {}),
    };
    return this.#state.putPendingMessage(entry).catch((error) => {
      this.#logger.warn?.('[dsh-im:qq] failed to persist a queued message:', error?.message ?? error);
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
      this.#logger.warn?.('[dsh-im:qq] failed to clear a queued-message entry:', error?.message ?? error);
    }
  }

  #replayPendingMessage(entry) {
    const message = this.#pendingReplayMessage(entry);
    if (!message) return Promise.resolve();
    return this.#enqueueMessage(message, entry.messageId, entry.key);
  }

  #pendingReplayMessage(entry) {
    const separator = String(entry.key).indexOf(':');
    if (separator < 0) return null;
    const kind = entry.key.slice(0, separator) === 'group' ? 'group' : 'c2c';
    const conversationId = entry.key.slice(separator + 1);
    if (!conversationId || !entry.messageId) return null;
    // Rebuild exactly the turn fields the queue path reads, so the recovered
    // text is dispatched as the user's own message with no added framing.
    return {
      kind,
      rawEventType: kind === 'group' ? 'GROUP_AT_MESSAGE_CREATE' : 'C2C_MESSAGE_CREATE',
      senderId: entry.senderId ?? '',
      messageId: entry.messageId,
      content: entry.text,
      ...(kind === 'group' ? { groupOpenid: conversationId } : {}),
      ...(entry.target !== undefined ? { replyTarget: entry.target } : {}),
    };
  }

  async #notifyInterruptedPending(entry) {
    if (entry.target === undefined || entry.target === null) {
      this.#logger.warn?.(
        '[dsh-im:qq] a queued message was interrupted by a restart but has no delivery target:',
        entry.messageId,
      );
      return;
    }
    try {
      await this.#bot.sendText(entry.target, t(PENDING_RESTART_NOTICE));
    } catch (error) {
      this.#logger.warn?.(
        '[dsh-im:qq] failed to report an interrupted queued message:',
        error?.message ?? error,
      );
    }
  }

  async #deliverDeferredOutcome(entry, outcome) {
    const text = deferredOutcomeText(outcome);
    const target = deferredDeliveryTarget(entry.target);
    if (!target.msgId) {
      await sendMarkdownReply(this.#bot, target, text, { logger: this.#logger });
      return true;
    }
    try {
      // The timeout notice already answered this msg_id once.
      await sendMarkdownReply(this.#bot, target, text, { logger: this.#logger, passiveRepliesUsed: 1 });
    } catch (error) {
      // Nothing was sent and QQ definitely refused the passive reply (window
      // closed early or budget spent), so the proactive route cannot duplicate it.
      if (!(error instanceof ApiError) || !(error.httpStatus >= 400 && error.httpStatus < 500)) throw error;
      this.#logger.warn?.('[dsh-im:qq] passive deferred reply was refused; retrying proactively:', error);
      await sendMarkdownReply(this.#bot, { scope: target.scope, targetId: target.targetId }, text, { logger: this.#logger });
    }
    return true;
  }

  #menuContext(key) {
    const workspace = this.#harness.currentWorkspace?.();
    const sessionWorkspace = typeof this.#harness.currentConversationWorkspace === 'function'
      ? this.#harness.currentConversationWorkspace(key) : workspace;
    return { workspace, sessionWorkspace, sessionId: this.#state.sessionFor(key) };
  }

  async #showMenu(message, key, name, pageView = null) {
    await this.#state.markMenuIntroduction?.(key);
    const actor = message.senderId;
    const context = this.#menuContext(key);
    const entry = this.#menus.begin(key, actor, context);
    const view = pageView ?? await qqMenuView(name, this.#harness, this.#state, key, {
      signal: this.#signal, busy: this.#queues.has(key)
        || this.#pendingInteractions.has(key) || this.#approvals.hasPending(key),
    });
    this.#signal?.throwIfAborted();
    this.#harness.assertWorkspaceScope?.();
    const current = this.#menuContext(key);
    if (current.workspace !== context.workspace || current.sessionWorkspace !== context.sessionWorkspace
      || current.sessionId !== context.sessionId) {
      return { message: t('会话或工作区已变化，请重新发送 /m。') };
    }
    if (!this.#menus.publish(key, actor, entry, view)) return { messages: [] };
    await sendQqMenu(this.#bot, message.replyTarget, view, entry.token, { logger: this.#logger });
    this.#status.messagesReplied += 1;
    this.#status.lastReplyAt = new Date().toISOString();
    return { messages: [] };
  }

  async #runMenuCommand(message, text, key) {
    const parsed = isQqMenuCommand(text) ? parseQqMenuCommand(text) : { number: Number(text) };
    if (parsed.error) return { message: t('菜单命令无效，请发送 /m 重新打开。') };
    if (parsed.name) return this.#showMenu(message, key, parsed.name);
    const choice = this.#menus.take(key, message.senderId, parsed.number, parsed.token, this.#menuContext(key));
    if (choice.error) return { message: choice.error };
    const action = choice.action;
    if (action.kind === 'section') return this.#showMenu(message, key, action.name);
    if (action.kind === 'page') return this.#showMenu(message, key, '', qqMenuPage(action.list, action.page));
    if (action.kind === 'archive') {
      await this.#state.setIncludeArchivedSessions(action.include);
      return this.#showMenu(message, key, 'main');
    }
    const command = action.text;
    const pendingInteraction = this.#pendingInteractions.has(key) || this.#approvals.hasPending(key);
    const isBusy = () => this.#queues.has(key) || this.#pendingInteractions.has(key)
      || this.#approvals.hasPending(key) || this.#batchInputs.status(key).phase !== 'idle';
    const needsIdle = /^\/(?:new|session|workspace|compact|clear)(?:\s|$)/u.test(command);
    if (isBusy() && needsIdle) {
      return { message: t('当前任务仍在运行，请先停止任务或等待任务完成后再执行此操作。') };
    }
    const options = { signal: this.#signal, isDirect: message.kind === 'c2c', pendingInteraction,
      control: { owner: this, key }, deferredDelivery: this.#deferred,
      enhancement: captureContextEnhancementSource(
        this.#contextEnhancement,
        message.kind === 'c2c' ? 'direct' : 'group',
        () => ({
          channel: 'qq',
          senderId: nonEmptyString(message.senderId),
          senderName: message.kind === 'group' ? message.senderName : undefined,
          chatId: message.kind === 'group' ? message.groupOpenid : message.senderId,
        }),
      ) };
    // Existing runners own all Host mutations and control authorization.
    const execute = async () => {
      this.#signal?.throwIfAborted();
      const current = this.#menuContext(key);
      if (current.workspace !== choice.context.workspace
        || current.sessionWorkspace !== choice.context.sessionWorkspace
        || current.sessionId !== choice.context.sessionId) {
        return { message: t('会话或工作区已变化，请重新发送 /m。') };
      }
      // A prompt may have started while this action waited for a prior menu command.
      if (needsIdle && isBusy()) return { message: t('当前任务仍在运行，请先停止任务或等待任务完成后再执行此操作。') };
      if (isControlCommand(command)) return runControlCommand(command, this.#harness, this.#state, key, options);
      if (isModelCommand(command)) return runModelCommand(command, this.#harness, this.#state, key, options);
      if (isPresetCommand(command)) return runPresetCommand(command, this.#harness, this.#state, key, options);
      if (command === '/new') return withSessionBindingLock(this.#state, key, async () => {
        if (isBusy()) return { message: t('当前任务仍在运行，请先停止任务或等待任务完成后再执行此操作。') };
        const locked = this.#menuContext(key);
        if (locked.workspace !== choice.context.workspace
          || locked.sessionWorkspace !== choice.context.sessionWorkspace
          || locked.sessionId !== choice.context.sessionId) {
          return { message: t('会话或工作区已变化，请重新发送 /m。') };
        }
        const created = await createConversationSession({ state: this.#state, harness: this.#harness, key });
        return { message: created.failed ? t('暂时无法创建新会话，请稍后重试。') : t('已开启新会话。请发送你的问题。') };
      });
      if (isClearCommand(command)) return runClearCommand(command, this.#harness, this.#state, key, options);
      if (isResetCommand(command)) return runResetCommand(command, this.#harness, this.#state, key, options);
      if (command === '/compact') return runCompactCommand(command, this.#harness, this.#state, key, options);
      return runWorkspaceCommand(command, this.#harness, key);
    };
    // Stop/steer must stay available while a slower menu mutation is pending.
    if (isControlCommand(command)) return execute();
    const previous = this.#menuTasks.get(key) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(execute);
    this.#menuTasks.set(key, task);
    try { return await task; }
    finally { if (this.#menuTasks.get(key) === task) this.#menuTasks.delete(key); }
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
    ]);
    await this.#deferred.whenIdle();
  }

  async #processFastCommand(message, messageId, key, text, runner) {
    this.#signal?.throwIfAborted();
    if (this.#state.hasSeen(messageId)) return;
    await this.#state.markSeen(messageId);
    this.#status.messagesReceived += 1;
    this.#status.lastMessageAt = new Date().toISOString();
    const result = await runner(text, this.#harness, this.#state, key, {
      signal: this.#signal,
      isDirect: message.kind === 'c2c',
      hasImages: hasQqImageAttachments(message),
      hasFiles: hasQqFileAttachments(message),
      pendingInteraction: this.#pendingInteractions.has(key)
        || this.#approvals.hasPending(key),
      busy: this.#queues.has(key),
      control: { owner: this, key },
      deferredDelivery: this.#deferred,
      enhancement: captureContextEnhancementSource(
        this.#contextEnhancement,
        message.kind === 'c2c' ? 'direct' : 'group',
        () => ({
          channel: 'qq',
          senderId: nonEmptyString(message.senderId),
          senderName: message.kind === 'group' ? message.senderName : undefined,
          chatId: message.kind === 'group' ? message.groupOpenid : message.senderId,
        }),
      ),
    });
    if (result?.stopped) {
      await Promise.allSettled([
        this.#cancelPendingInteraction(key),
        this.#approvals.closeRoute(key),
      ]);
    }
    for (const reply of result?.messages ?? [result?.message]) {
      if (reply) await this.#bot.sendText(message.replyTarget, reply);
    }
    this.#status.lastError = null;
  }

  #finishBatchResult(message, messageId, result) {
    let task;
    task = Promise.resolve().then(async () => {
      if (this.#state.hasSeen(messageId)) return;
      await this.#state.markSeen(messageId);
      this.#status.messagesReceived += 1;
      this.#status.lastMessageAt = new Date().toISOString();
      if (result.message) await this.#bot.sendText(message.replyTarget, result.message);
      this.#status.lastError = null;
    }).catch(async (error) => {
      if (this.#signal?.aborted) return;
      this.#status.lastError = error?.message ?? String(error);
      const failure = setLastMessageFailure(this.#status, error);
      this.#logger.error?.(
        `[dsh-im:qq] failed to process a batch input message [${failure.referenceId}]:`,
        messageFailureDiagnostic(error, failure),
      );
      await this.#bot.sendText(message.replyTarget, messageFailureText(failure))
        .catch(() => undefined);
    }).finally(() => {
      this.#acceptedMessageIds.delete(messageId);
      this.#commandTasks.delete(task);
    });
    this.#commandTasks.add(task);
    return task;
  }

  #finishAccessDecision(message, messageId, access) {
    let task;
    task = Promise.resolve().then(async () => {
      if (this.#state.hasSeen(messageId)) return;
      await this.#state.markSeen(messageId);
      if (access.reason === 'command-not-allowed') {
        this.#status.messagesReceived += 1;
        this.#status.lastMessageAt = new Date().toISOString();
        await this.#bot.sendText(message.replyTarget, t(COMMAND_PERMISSION_DENIED_MESSAGE));
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
      this.#logger.error?.('[dsh-im:qq] failed to apply inbound access policy:', error);
    }).finally(() => {
      this.#acceptedMessageIds.delete(messageId);
      this.#commandTasks.delete(task);
    });
    this.#commandTasks.add(task);
    return task;
  }

  async #deliverArtifacts(target, replyTo, artifacts = [], baseReceipt = null) {
    if (artifacts.length === 0) {
      return { receipt: baseReceipt, failureNoticeVisible: false, artifactSendErrors: 0 };
    }
    const delivery = await deliverOutboundArtifacts({
      artifacts,
      baseReceipt,
      deliveryId: replyTo,
      aggregatePresentation: baseReceipt ? 'qq-text-and-files' : 'qq-files',
      alwaysMerge: true,
      channelKey: 'qq',
      signal: this.#signal,
      sendImage: (file) => sendQqImage(this.#bot, target, file, {
        signal: this.#signal,
        timeoutMs: this.#fileUploadTimeoutMs,
      }),
      sendFile: (file) => sendQqFile(this.#bot, target, file, {
        signal: this.#signal,
        timeoutMs: this.#fileUploadTimeoutMs,
      }),
      onFailure: (artifact, error) => setLastMessageFailure(this.#status, error, {
        userMessage: artifactFailureText(artifact?.fileName, error),
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
      failureNoticeVisible: delivery.failureNoticeVisible,
      artifactSendErrors: delivery.artifactSendErrors,
    };
  }

  async #process(message, key, {
    alreadyRecorded = false,
    preparedMessage,
    batchSubmission = null,
  } = {}) {
    if (this.#signal?.aborted) return;
    const acceptedAt = Date.now();
    const messageId = nonEmptyString(message?.messageId);
    const sender = nonEmptyString(message?.senderId);
    if (!messageId || !sender || message.senderIsBot === true) return;
    if (!['c2c', 'group'].includes(message.kind)) return;
    if (!alreadyRecorded) {
      if (this.#state.hasSeen(messageId)) return;
      this.#status.messagesReceived += 1;
      this.#status.lastMessageAt = new Date().toISOString();
    }
    let messageRecorded = alreadyRecorded;
    const markMessageSeen = async () => {
      if (messageRecorded) return;
      await this.#state.markSeen(messageId);
      messageRecorded = true;
    };
    if (!isQqMessageAddressed(message)) return;

    const target = message.replyTarget;
    const promptMessage = preparedMessage
      ?? qqInboundMessage(message, { fetchImpl: this.#fetchImpl });
    const text = promptMessage.content;
    const hasImages = hasInboundImages(promptMessage);
    const hasFiles = hasInboundFiles(promptMessage);
    const hasReply = hasReplyReference(promptMessage);
    let stream = null;
    let batchSettled = batchSubmission === null;
    try {
      if (!text && !hasImages && !hasFiles && !hasReply) {
        await this.#bot.sendText(target, t('目前支持文字、图片和文件消息。'));
        await markMessageSeen();
        return;
      }
      const command = text.toLowerCase();
      if (!hasImages && !hasFiles && command === '/help') {
        await this.#bot.sendText(target, helpText());
        await markMessageSeen();
        return;
      }
      if (!hasImages && !hasFiles && command === '/status') {
        await this.#harness.ensureRunning({ signal: this.#signal });
        await this.#bot.sendText(target, t('QQ 机器人与 DeepSeek Harness 连接正常。'));
        await markMessageSeen();
        return;
      }
      if (!hasImages && !hasFiles && isNewCommand(text)) {
        const created = await createConversationSession({ state: this.#state, harness: this.#harness, key, title: newCommandTitle(text) });
        await this.#bot.sendText(target, created.failed ? t('暂时无法创建新会话，请稍后重试。') : t('已开启新会话。请发送你的问题。'));
        await markMessageSeen();
        return;
      }
      if (!hasImages && !hasFiles && isSessionNavCommand(text)) {
        const nav = await runSessionNavTextCommand(text, this.#harness, this.#state, key, {
          signal: this.#signal,
        });
        if (nav) {
          for (const reply of nav.messages ?? [nav.message]) {
            await this.#bot.sendText(target, reply);
          }
          if (nav.askText) {
            const followUp = this.#enqueueMessage(
              { ...message, content: nav.askText, attachments: [] },
              `${messageId}-ask`,
              key,
            );
            followUp.catch((error) => {
              this.#logger.warn?.(`[dsh-im:qq] follow-up ask after a nav command failed:`, error?.message ?? error);
              this.#bot.sendText(target, t('切换后的提问发送失败，请重试。')).catch(() => undefined);
            });
          }
        }
        await markMessageSeen();
        return;
      }
      const clearCommand = await runClearCommand(text, this.#harness, this.#state, key, {
        signal: this.#signal,
        hasImages,
        hasFiles,
        pendingInteraction: this.#pendingInteractions.has(key) || this.#approvals.hasPending(key),
        busy: this.#queues.has(key),
      });
      if (clearCommand) {
        await this.#bot.sendText(target, clearCommand.message);
        await markMessageSeen();
        return;
      }
      const resetCommand = await runResetCommand(text, this.#harness, this.#state, key, {
        signal: this.#signal,
        hasImages,
        hasFiles,
        pendingInteraction: this.#pendingInteractions.has(key) || this.#approvals.hasPending(key),
        busy: this.#queues.has(key),
      });
      if (resetCommand) {
        await this.#bot.sendText(target, resetCommand.message);
        await markMessageSeen();
        return;
      }
      const workspaceCommand = hasImages || hasFiles
        ? null
        : await runWorkspaceCommand(text, this.#harness, key);
      if (workspaceCommand) {
        for (const reply of workspaceCommand.messages ?? [workspaceCommand.message]) {
          await this.#bot.sendText(target, reply);
        }
        await markMessageSeen();
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
        await this.#bot.sendText(target, compactCommand.message);
        await markMessageSeen();
        return;
      }

      let content = hasImages || hasReply
        ? await promptContentForInboundMessage(promptMessage, { signal: this.#signal, deferImages: true })
        : undefined;
      const snapshot = this.#acceptedMessageIds.get(messageId);
      let contextEnhanced = false;
      if (snapshot) {
        const originalContent = content ?? text;
        content = enhanceContextContent(originalContent, snapshot, () => ({
          channel: 'qq',
          senderId: sender,
          senderName: message.kind === 'group' ? message.senderName : undefined,
          chatId: message.kind === 'group' ? message.groupOpenid : message.senderId,
        }));
        contextEnhanced = content !== originalContent;
      }
      // QQ stream_messages can acknowledge a final frame without rendering it in
      // some C2C clients. Standard Markdown delivery is the reliable reply path.
      const toolErrors = [];
      let answer;
      let artifacts = [];
      try {
        try {
          await this.#state.rememberAuthor?.(key, {
            senderId: sender,
            senderName: message.kind === 'group' ? message.senderName : undefined,
            isBot: message.senderIsBot === true,
          });
        } catch (error) {
          this.#logger.warn?.('[dsh-im:qq] unable to remember the conversation author:', error?.message ?? error);
        }
        // Persist consumption before handing the prompt to Harness. Provider
        // redelivery after a failed error notice must never execute it twice.
        await markMessageSeen();
        // The prompt is about to enter the Harness inbox, which is itself
        // durable. Marking the entry submitted first means a crash after this
        // point reports the message instead of replaying a turn the Harness may
        // already own.
        await this.#markPendingSubmitted(key, messageId);
        ({ answer, artifacts = [] } = await askInWorkspaceSession({
          onNotice: (notice) => this.#bot.sendText(target, notice),
          deferredDelivery: () => ({ coordinator: this.#deferred, target: deferredQqTarget(message, target, acceptedAt) }),
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
            groupHistory: message.groupHistory,
            timeoutMs: this.#replyTimeoutMs,
            signal: this.#signal,
            control: { owner: this, key },
            progressMode: 'all',
            finalAnswerOnly: true,
            onUpdate: (update) => {
              if (update.error) {
                const name = (nonEmptyString(update.toolName) ?? t('工具'))
                  .replace(/[\r\n]+/gu, ' ')
                  .slice(0, 80);
                toolErrors.push(t(
                  '工具调用「{name}」未成功，请检查工具配置或稍后重试。',
                  { name },
                ));
              }
            },
            onInteraction: (interaction) => this.#handleInteraction(interaction, {
              key,
              actor: sender,
              target,
              requiresMention: message.kind === 'group',
            }),
            onInteractionResolved: (resolution) => this.#handleInteractionResolved(resolution),
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
          this.#cancelPendingInteraction(key),
          this.#approvals.closeRoute(key),
        ]);
      }
      this.#signal?.throwIfAborted();
      const answerText = answerTextForDelivery(answer, artifacts);
      const displayAnswer = toolErrors.length > 0
        ? `${answerText}\n\n---\n\n${toolErrors.join('\n\n')}`
        : answerText;
      let textReceipt = null;
      let textSendError = null;
      try {
        let streamFinished = false;
        if (stream) {
          try {
            await stream.update(displayAnswer);
            streamFinished = true;
            textReceipt = createDeliveryReceipt({
              deliveryId: messageId,
              presentation: 'qq-text',
              providerMessageIds: providerMessageIdsFor(stream),
            });
            try {
              await stream.complete();
            } catch (error) {
              this.#logger.warn?.('[dsh-im:qq] QQ stream completion failed after visible final content:', error);
            }
          } catch (error) {
            stream.cancel?.();
            this.#logger.warn?.('[dsh-im:qq] QQ stream update failed; using markdown fallback:', error);
          }
        }
        if (!streamFinished) {
          const deliveries = await sendMarkdownReply(this.#bot, target, displayAnswer, {
            logger: this.#logger,
          });
          textReceipt = createDeliveryReceipt({
            deliveryId: messageId,
            presentation: 'qq-text',
            providerMessageIds: deliveries.flatMap((delivery) => providerMessageIdsFor(delivery)),
          });
        }
      } catch (error) {
        textSendError = channelDeliveryFailure(error);
        this.#logger.warn?.('[dsh-im:qq] final text delivery failed; continuing with result files:', error);
      }
      const delivery = await this.#deliverArtifacts(target, messageId, artifacts, textReceipt);
      const artifactDispatched = delivery.receipt?.artifacts?.some(
        ({ outcome }) => outcome === 'sent' || outcome === 'unknown',
      );
      if (textSendError && !artifactDispatched && !delivery.failureNoticeVisible) {
        throw textSendError;
      }
      if (textSendError && delivery.artifactSendErrors === 0) {
        setLastMessageFailure(this.#status, textSendError);
      }
      this.#status.messagesReplied += 1;
      this.#status.lastReplyAt = new Date().toISOString();
      this.#status.lastError = null;
      if (!textSendError && delivery.artifactSendErrors === 0) {
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
        try {
          stream?.cancel?.();
        } catch (streamError) {
          this.#logger.warn?.('[dsh-im:qq] unable to cancel a stopped QQ stream:', streamError);
        }
        try {
          await this.#bot.sendText(target, t('已停止。'));
        } catch (sendError) {
          this.#logger.warn?.('[dsh-im:qq] unable to announce a stopped QQ turn:', sendError);
        }
        await markMessageSeen();
        return;
      }
      try {
        stream?.cancel?.();
      } catch (streamError) {
        this.#logger.warn?.('[dsh-im:qq] unable to cancel a failed QQ stream:', streamError);
      }
      if (this.#signal?.aborted) return;
      this.#status.lastError = error?.message ?? String(error);
      const userMessage = inboundFileUserMessage(error)
        ?? imagePromptUserMessage(error);
      const failure = setLastMessageFailure(this.#status, error, {
        userMessage,
        reason: imagePromptDiagnostic(error)?.reason,
      });
      this.#logger.error?.(
        `[dsh-im:qq] failed to process an inbound message [${failure.referenceId}]:`,
        messageFailureDiagnostic(error, failure),
      );
      try {
        const errorMessage = messageFailureText(failure);
        await this.#bot.sendText(
          target,
          batchFailureMessage ? `${errorMessage}\n\n${batchFailureMessage}` : errorMessage,
        );
        await markMessageSeen();
      } catch (sendError) {
        this.#logger.error?.('[dsh-im:qq] failed to send the safe error reply:', sendError);
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

    if (!isQqMessageAddressed(message)) return;
    const text = nonEmptyString(safeText(message));
    if (!text || hasQqImageAttachments(message) || hasQqFileAttachments(message)) {
      await this.#bot.sendText(message.replyTarget, t('请用文字回答当前问题。'));
      return;
    }

    const pending = this.#pendingInteractions.get(key);
    if (!pending || pending !== expected || pending.submitting) {
      if (claimed && (!pending || pending !== expected)) {
        await this.#bot.sendText(message.replyTarget, interactionResolvedText());
        return;
      }
      return this.#enqueueMessage(message, messageId, key, {
        releaseMessageId: false,
        alreadyRecorded: true,
      });
    }
    pending.target = message.replyTarget;
    if (pending.needsPresentation) {
      try {
        await this.#presentInteraction(pending);
      } catch {
        this.#status.lastError = t('QQ 交互问题发送失败。');
        this.#logger.error?.('[dsh-im:qq] failed to retry an interaction question');
        pending.interaction.reconnect?.();
        return;
      }
      const presentedPending = this.#pendingInteractions.get(key);
      if (!presentedPending || presentedPending !== expected || presentedPending.submitting) {
        if (claimed && (!presentedPending || presentedPending !== expected)) {
          await this.#bot.sendText(message.replyTarget, interactionResolvedText())
            .catch(() => undefined);
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
        this.#status.lastError = t('QQ 交互问题发送失败。');
        this.#logger.error?.('[dsh-im:qq] failed to send the next interaction question');
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
        await this.#bot.sendText(pending.target, interactionResolvedText()).catch(() => undefined);
        return;
      }
      if (this.#pendingInteractions.get(key) !== pending) return;
      pending.submitting = false;
      pending.answers.pop();
      pending.index -= 1;
      this.#status.lastError = t('回答提交失败。');
      this.#logger.error?.('[dsh-im:qq] failed to answer a Harness interaction');
      await this.#bot.sendText(pending.target, t('回答提交失败，请重新发送当前问题的答案。'))
        .catch(() => undefined);
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
    target,
    requiresMention,
  }) {
    if (interaction?.kind === 'approval') {
      return this.#approvals.handleRequested(interaction, {
        key,
        actor,
        requiresMention,
        send: (text) => this.#bot.sendText(target, text),
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
      this.#logger.warn?.('[dsh-im:qq] ignored an invalid Harness question interaction');
      return;
    }

    if (interaction.recovered === true) {
      await interaction.respond({
        ok: false,
        error: {
          code: 'cancelled',
          message: 'QQ safely cancelled an interaction left by an earlier client.',
          details: {},
        },
      });
      await this.#bot.sendText(
        target,
        t('检测到这个 Session 中遗留的待回答问题，已安全取消并继续处理你刚才的消息。'),
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
          message: 'QQ is already handling another user interaction.',
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
      requiresMention,
      questions,
      answers: [],
      index: 0,
      target,
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
    const presentation = this.#bot.sendText(
      pending.target,
      harnessQuestionText(
        question,
        pending.index,
        pending.questions.length,
        { requiresMention: pending.requiresMention },
      ),
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
    await this.#bot.sendText(message.replyTarget, interactionResolvedText()).catch(() => undefined);
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
          message: 'The QQ interaction ended before the user answered.',
          details: {},
        },
      }, { signal: AbortSignal.timeout(5_000) });
    } catch (error) {
      if (error?.code !== 'interaction-not-pending') {
        this.#logger.warn?.('[dsh-im:qq] failed to cancel a pending Harness interaction');
      }
    }
  }

  async #handleInteractionFailure(message, messageId, error) {
    if (this.#signal?.aborted) return;
    this.#status.lastError = error?.message ?? String(error);
    const failure = setLastMessageFailure(this.#status, error);
    this.#logger.error?.(
      `[dsh-im:qq] failed to process an interaction reply [${failure.referenceId}]:`,
      messageFailureDiagnostic(error, failure),
    );
    if (!this.#state.hasSeen(messageId)) {
      await this.#state.markSeen(messageId).catch(() => undefined);
    }
    await this.#bot.sendText(message.replyTarget, messageFailureText(failure))
      .catch(() => undefined);
  }
}
