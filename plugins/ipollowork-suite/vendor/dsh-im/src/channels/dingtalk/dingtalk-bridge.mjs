import { BusyMessageDispatcher, canAutomaticallySteer } from '../shared/busy-message-dispatcher.mjs';
import { menuIntroductionText } from '../shared/menu-introduction.mjs';
import { SESSION_NAV_HELP_LINES } from '../shared/command-catalog.mjs';
import { createDeferredDeliveryCoordinator, deferredOutcomeText } from '../shared/deferred-delivery-coordinator.mjs';
import {
  DINGTALK_DONE_REACTION_NAME,
  DINGTALK_ERROR_REACTION_NAME,
  DINGTALK_THINKING_REACTION_NAME,
  normalizeDingtalkSessionWebhook,
  splitDingtalkText,
} from './dingtalk-api.mjs';
import { createDingTalkCardStream } from './dingtalk-card-stream.mjs';
import { dingtalkMenuSnapshot, dingtalkMenuCommand, isDingtalkMenuCommand } from './dingtalk-menu.mjs';
import {
  harnessAnswerForQuestion,
  harnessQuestionText,
  validHarnessQuestion,
} from '../shared/harness-question.mjs';
import { HarnessApprovalQueue } from '../shared/harness-approval.mjs';
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
import { conversationSessionWorkspace, runWorkspaceCommand } from '../shared/workspace-command.mjs';
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
  hasInboundImages,
  imagePromptDiagnostic,
  imagePromptUserMessage,
} from '../shared/image-prompt.mjs';
import {
  InboundFileError,
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
import { DINGTALK_RECENT_OUTBOUND_MATCH_TOLERANCE_MS } from './state-store.mjs';
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

const CARD_INITIAL_TEXT = '已连接 DeepSeek Harness，正在思考…';
const INTERACTION_RESOLVED_TEXT = '这个问题已在其他客户端处理，无需再次回答。';

const HELP_TEXT_LINES = [
  '钉钉机器人已连接 DeepSeek Harness。',
  '',
  '直接发送文字、图片或文件即可继续当前会话。',
  '/m 或 /menu  打开下拉操作菜单',
  '/new  开启一个全新会话',
  '/compact  压缩当前会话的较早上下文',
  '/clear  清空当前会话上下文（保留 Session 绑定和历史记录）',
  '/history [数量]  查看最近历史消息（默认 3 条，最多 5 条）',
  '/workspace 工作区序号或绝对路径  切换工作区',
  '/workspacelist  列出工作区绝对路径',
  '/ws、/wsl、/workspaces  工作区命令别名',
  '/sessionlist 或 /sessions [工作区序号或绝对路径]  列出会话 ID 和标题',
  '/sessionlist --all  跨工作区汇总会话（每个工作区默认显示 10 个，可用 --limit N 调整）',
  '/sessionlist --limit N  仅列出当前工作区前 N 个会话',
  '/session Session ID、当前工作区序号或标题关键词  将当前聊天绑定到指定会话',
  ...SESSION_NAV_HELP_LINES,
  '/models  按序号列出所有可用模型',
  '/reasoninglist 或 /reasonings  按序号列出当前模型可用推理等级',
  '/reasoning [序号、等级ID或 --default]  查看或切换当前推理等级',
  '/model [序号或完整模型ID] [推理等级ID]  查看或切换当前会话模型',
  '示例：先发 /models，再发 /model 2 [推理等级ID]',
  '/presetlist 或 /presets  按序号列出可用 Agent Preset',
  '/preset [序号或完整ID]  查看或设置当前机器人 Agent Preset',
  '纯数字 ID：/preset id:<ID>',
  '/preset --default  跟随 Host 默认',
  '/stop  停止当前任务',
  '/steer 补充指令  纠偏当前任务',
  '/batch  开始批量输入（仅私聊，最多 10 条文字）',
  '/send  提交当前批次',
  '/cancel  取消当前批次',
  '/status  检查连接状态',
  '/version  查看插件版本',
  '/help  显示本帮助',
];

function helpText() {
  return HELP_TEXT_LINES.map((line) => t(line)).join('\n');
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function dingtalkFileProviderIds(result) {
  const ids = providerMessageIdsFor(result);
  const processQueryKey = nonEmptyString(result?.processQueryKey);
  if (processQueryKey && !ids.includes(processQueryKey)) ids.push(processQueryKey);
  return ids;
}

function safeErrorDiagnostic(error) {
  const chain = [];
  const seen = new Set();
  let current = error;
  while (current && typeof current === 'object' && chain.length < 3 && !seen.has(current)) {
    seen.add(current);
    const name = nonEmptyString(current.name)?.slice(0, 80);
    const code = nonEmptyString(current.code)?.slice(0, 80);
    const providerCode = nonEmptyString(current.providerCode)?.slice(0, 160);
    const status = Number.isInteger(current.status) ? current.status : undefined;
    chain.push({
      ...(name ? { name } : {}),
      ...(code ? { code } : {}),
      ...(providerCode ? { providerCode } : {}),
      ...(status ? { status } : {}),
    });
    current = current.cause;
  }
  return chain;
}

function dingtalkImageErrorUserMessage(error) {
  let current = error;
  const seen = new Set();
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    if (current.code === 'image-download-address-failed') {
      return t('钉钉未能换取图片下载地址，请重新发送；若持续失败，请检查机器人的“企业内机器人发送消息权限”。');
    }
    if (current.code === 'invalid-image-download') {
      return t('钉钉没有返回图片下载地址，请重新发送。');
    }
    if (current.code === 'image-content-download-failed') {
      return t('钉钉返回的图片临时地址无法读取，请重新发送。');
    }
    current = current.cause;
  }
  return imagePromptUserMessage(error);
}

function senderStaffId(message) {
  return nonEmptyString(message?.senderStaffId) ?? nonEmptyString(message?.senderId);
}

function parsedMessageContent(message) {
  if (message?.content && typeof message.content === 'object') return message.content;
  if (typeof message?.content !== 'string') return null;
  try {
    const parsed = JSON.parse(message.content);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function richTextEntries(content) {
  const entries = content?.richText ?? content?.rich_text;
  return Array.isArray(entries) ? entries : [];
}

function richTextEntryText(entry) {
  if (typeof entry?.text === 'string') return nonEmptyString(entry.text);
  if (typeof entry?.text?.content === 'string') return nonEmptyString(entry.text.content);
  if (String(entry?.type).toLowerCase() === 'text' && typeof entry?.content === 'string') {
    return nonEmptyString(entry.content);
  }
  return null;
}

function downloadCodeFor(value) {
  return nonEmptyString(value?.downloadCode) ?? nonEmptyString(value?.pictureDownloadCode);
}

function dingtalkImageEntries(msgtype, content) {
  if (msgtype === 'picture') return [content];
  if (msgtype !== 'richtext') return [];
  return richTextEntries(content)
    .filter((entry) => String(entry?.type ?? '').toLowerCase() === 'picture');
}

function dingtalkTimestampMs(value) {
  const number = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.trunc(number < 10_000_000_000 ? number * 1_000 : number);
}

function usefulReplyText(value) {
  const text = nonEmptyString(value);
  return text && !/^\[interactive card message\]$/iu.test(text) ? text : null;
}

function dingtalkReplyMessage(message) {
  if (message?.text?.isReplyMsg !== true) return null;
  const replied = message.text.repliedMsg;
  if (!replied || typeof replied !== 'object') return null;
  const msgtype = nonEmptyString(replied.msgType ?? replied.msgtype)?.toLowerCase() ?? '';
  const repliedContent = parsedMessageContent({ content: replied.content }) ?? {};
  // Quoted richText entries use msgType instead of the direct callback's type.
  const content = msgtype === 'richtext' ? {
    ...repliedContent,
    richText: richTextEntries(repliedContent).map((entry) => ({
      ...entry, type: entry?.type ?? entry?.msgType ?? entry?.msgtype,
    })),
  } : repliedContent;
  return {
    msgtype,
    robotCode: message.robotCode,
    text: {
      content: nonEmptyString(repliedContent.text)
        ?? (typeof replied.content === 'string' ? replied.content : ''),
    },
    content,
  };
}

function dingtalkReplyReference(message, options) {
  if (message?.text?.isReplyMsg !== true) return null;
  const pseudoMessage = dingtalkReplyMessage(message);
  if (!pseudoMessage) return { unavailableReason: 'not-delivered' };
  const replied = message.text.repliedMsg;
  const { msgtype, content: repliedContent } = pseudoMessage;
  const normalized = dingtalkInboundMessage(pseudoMessage, options);
  let attachments = [];
  if (msgtype === 'picture') {
    attachments = [{ kind: 'image' }];
  } else if (msgtype === 'file') {
    const name = nonEmptyString(repliedContent.fileName ?? repliedContent.file_name);
    attachments = [{ kind: 'file', ...(name ? { name } : {}) }];
  } else if (msgtype === 'richtext') {
    attachments = dingtalkImageEntries(msgtype, repliedContent)
      .map(() => ({ kind: 'image' }));
  } else if (msgtype === 'voice' || msgtype === 'audio') {
    attachments = [{ kind: 'audio' }];
  } else if (msgtype === 'video') {
    attachments = [{ kind: 'video' }];
  }

  const messageId = nonEmptyString(replied.msgId ?? replied.messageId);
  const authorId = nonEmptyString(replied.senderId ?? replied.senderStaffId);
  const authorName = nonEmptyString(replied.senderNick ?? replied.senderName);
  const content = usefulReplyText(normalized.content)
    ?? usefulReplyText(repliedContent.text)
    ?? usefulReplyText(repliedContent.summary)
    ?? usefulReplyText(repliedContent.title);
  const processQueryKey = nonEmptyString(
    message?.originalProcessQueryKey ?? repliedContent.processQueryKey,
  );
  const createdAt = dingtalkTimestampMs(replied.createdAt ?? replied.createTime);
  const load = !content && attachments.length === 0
    && typeof options?.loadReplyContent === 'function'
    ? ({ signal } = {}) => options.loadReplyContent({
        ...(messageId ? { messageId } : {}),
        ...(processQueryKey ? { processQueryKey } : {}),
        ...(createdAt === null ? {} : { createdAt }),
      }, { signal })
    : null;
  const supported = [
    'text', 'picture', 'file', 'richtext', 'voice', 'audio', 'video',
    'interactivecard', 'chatrecord',
  ]
    .includes(msgtype);
  return {
    ...(messageId ? { messageId } : {}),
    ...(authorId ? { authorId } : {}),
    ...(authorName ? { authorName } : {}),
    ...(content ? { content } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(load ? { load } : {}),
    ...(!content && attachments.length === 0 && !load
      ? { unavailableReason: supported ? 'not-delivered' : 'unsupported' }
      : {}),
  };
}

// Resolve only the immediate quote, after command/interaction routing has finished.
function prepareDingtalkReplyAttachments(message, promptMessage, options) {
  const quoted = dingtalkReplyMessage(message);
  if (!quoted) return promptMessage;
  if (['audio', 'voice', 'video'].includes(quoted.msgtype)) quoted.msgtype = 'file';
  const imageCodes = dingtalkImageEntries(quoted.msgtype, quoted.content).map(downloadCodeFor);
  const fileCodes = quoted.msgtype === 'file' ? [downloadCodeFor(quoted.content)] : [];
  if ([...imageCodes, ...fileCodes].some((code) => !code)) {
    throw new InboundFileError(
      'dingtalk-quoted-attachment-unavailable',
      'DingTalk did not deliver a download reference for the quoted attachment.',
      t('钉钉未提供引用附件的下载信息，无法读取原附件。请直接重新发送附件后再提问。'),
    );
  }
  if (imageCodes.length === 0 && fileCodes.length === 0) return promptMessage;
  const currentType = String(message?.msgtype ?? '').toLowerCase();
  const currentContent = parsedMessageContent(message);
  const seen = new Set([
    ...dingtalkImageEntries(currentType, currentContent).map(downloadCodeFor),
    ...(currentType === 'file' ? [downloadCodeFor(currentContent)] : []),
  ].filter(Boolean));
  const take = (code) => {
    if (seen.has(code)) return false;
    seen.add(code);
    return true;
  };
  const normalized = dingtalkInboundMessage(quoted, options);
  const images = normalized.images.filter((_, index) => take(imageCodes[index]));
  const files = normalized.files.filter((_, index) => take(fileCodes[index]));
  const prefetched = prefetchInboundFiles({ files }, { signal: options.signal });
  return {
    ...promptMessage,
    images: [...promptMessage.images, ...images],
    files: [...promptMessage.files, ...prefetched.files],
  };
}

/** Normalize DingTalk picture and richText callbacks into lazy image references. */
export function dingtalkInboundMessage(message, {
  api,
  clientId,
  clientSecret,
  loadReplyContent,
} = {}) {
  const msgtype = String(message?.msgtype ?? '').toLowerCase();
  const content = parsedMessageContent(message);
  const richEntries = msgtype === 'richtext' ? richTextEntries(content) : [];
  const audio = ['audio', 'voice'].includes(msgtype);
  const text = msgtype === 'text'
    ? nonEmptyString(message?.text?.content) ?? ''
    : audio ? nonEmptyString(content?.recognition) ?? ''
      : richEntries.map(richTextEntryText).filter(Boolean).join('\n');
  const imageCodes = dingtalkImageEntries(msgtype, content).map(downloadCodeFor).filter(Boolean);
  const fileCode = ['file', 'audio', 'voice', 'video'].includes(msgtype) ? downloadCodeFor(content) : null;
  const replyTo = dingtalkReplyReference(message, {
    api,
    clientId,
    clientSecret,
    loadReplyContent,
  });
  return {
    content: text,
    images: imageCodes.map((downloadCode, index) => ({
      name: index === 0 ? 'image' : `image-${index + 1}`,
      load: ({ signal, maxBytes }) => {
        if (typeof api?.downloadImage !== 'function') {
          throw new Error('DingTalk API does not support image downloads');
        }
        return api.downloadImage({
          clientId,
          clientSecret,
          robotCode: message?.robotCode,
          downloadCode,
          signal,
          maxBytes,
        });
      },
    })),
    files: fileCode ? [{
      name: nonEmptyString(content?.fileName ?? content?.file_name) ?? (audio ? 'voice.amr' : msgtype === 'video' ? 'video.mp4' : 'file'),
      ...(audio ? { mediaType: 'audio/amr', transcript: text } : {}),
      load: ({ signal } = {}) => {
        if (typeof api?.downloadFile !== 'function') {
          throw new Error('DingTalk API does not support file downloads');
        }
        return api.downloadFile({
          clientId,
          clientSecret,
          robotCode: message?.robotCode,
          downloadCode: fileCode,
          signal,
        });
      },
    }] : [],
    ...(replyTo ? { replyTo } : {}),
  };
}

function conversationKey(message, sender) {
  if (String(message?.conversationType) === '2') {
    const conversationId = nonEmptyString(message?.conversationId);
    if (!conversationId) throw new Error('DingTalk group message has no conversation id');
    return `group:${conversationId}`;
  }
  return `p2p:${sender}`;
}

function cardTarget(message, sender) {
  if (String(message?.conversationType) === '2') {
    return {
      type: 'group',
      openConversationId: nonEmptyString(message?.conversationId),
      atUserIds: { [sender]: nonEmptyString(message?.senderNick) ?? sender },
    };
  }
  return { type: 'user', userId: sender };
}

function fileTarget(message, sender, clientId) {
  const robotCode = nonEmptyString(message?.robotCode) ?? clientId;
  if (String(message?.conversationType) === '2') {
    return {
      type: 'group',
      openConversationId: nonEmptyString(message?.conversationId),
      robotCode,
    };
  }
  return { type: 'user', userId: sender, robotCode };
}

function artifactFailureText(fileName, error) {
  const name = String(fileName ?? t('结果文件')).replace(/[\r\n]+/g, ' ').trim() || t('结果文件');
  switch (error?.code) {
    case 'artifact-delivery-uncertain':
      return t('结果文件「{name}」发送结果未能确认，请先检查聊天内是否已收到，不要立即重试。', { name });
    case 'artifact-permission-required':
      return t('结果文件「{name}」已生成，但钉钉应用或机器人缺少文件消息权限。请开通应用 qyapi_base 权限，并确认机器人具备文件消息发送能力。', { name });
    case 'artifact-too-large':
      return t('结果文件「{name}」超过当前钉钉机器人可发送的文件大小，未发送。', { name });
    case 'artifact-rate-limited':
      return t('结果文件「{name}」暂时被钉钉限流，未能发送，请稍后重试。', { name });
    case 'artifact-provider-rejected':
      return t('结果文件「{name}」已生成，但钉钉拒绝了该文件消息，请检查文件类型和机器人文件消息配置。', { name });
    case 'artifact-invalid':
    case 'artifact-changed':
    case 'artifact-unavailable':
      return t('结果文件「{name}」暂时无法读取或准备发送，请确认文件仍可访问后重试。', { name });
    default:
      return t('结果文件「{name}」已生成，但暂时未能通过钉钉发送，请稍后重试。', { name });
  }
}

function progressText(update) {
  if (update?.type === 'text' && nonEmptyString(update.text)) return update.text;
  if (update?.type === 'tool') {
    if (update.name === 'web_search') return t('_正在搜索网络并整理信息…_');
    return t('_正在使用 {name}…_', { name: nonEmptyString(update.name) ?? t('工具') });
  }
  return t('_{text}_', { text: nonEmptyString(update?.text) ?? t('正在处理…') });
}

function canClaimInteractionReply(message, pending, sender) {
  if (pending.needsPresentation || !pending.questions[pending.index]) return false;
  if (pending.actor !== sender) return false;
  if (String(message?.conversationType) === '2' && message?.isInAtList !== true) return false;
  if (message?.msgtype !== 'text' || !nonEmptyString(message?.text?.content)) return false;
  try {
    normalizeDingtalkSessionWebhook(message.sessionWebhook);
    return true;
  } catch {
    return false;
  }
}

function ensureStats(status) {
  status.stats ??= {};
  for (const key of [
    'messagesReceived',
    'messagesReplied',
    'messagesRejected',
    'messagesIgnored',
    'reactionsAdded',
    'reactionsRemoved',
    'reactionErrors',
  ]) {
    status[key] ??= 0;
    status.stats[key] = status[key];
  }
  status.pendingSenders ??= [];
}

function increment(status, key) {
  status[key] = (status[key] ?? 0) + 1;
  status.stats ??= {};
  status.stats[key] = status[key];
}

export function createDingtalkBridgeStatus({ pendingSenders = [] } = {}) {
  return {
    messagesReceived: 0,
    messagesReplied: 0,
    messagesRejected: 0,
    messagesIgnored: 0,
    reactionsAdded: 0,
    reactionsRemoved: 0,
    reactionErrors: 0,
    lastMessageAt: null,
    lastReplyAt: null,
    lastRejectedAt: null,
    lastError: null,
    lastMessageError: null,
    pendingSenders: structuredClone(pendingSenders),
    stats: {
      messagesReceived: 0,
      messagesReplied: 0,
      messagesRejected: 0,
      messagesIgnored: 0,
      reactionsAdded: 0,
      reactionsRemoved: 0,
      reactionErrors: 0,
    },
  };
}

export class DingtalkHarnessBridge {
  #api;
  #clientId;
  #clientSecret;
  #harness;
  #state;
  #deferred;
  #contextEnhancement;
  #accessPolicy;
  #status;
  #logger;
  #replyTimeoutMs;
  #reactionTimeoutMs;
  #maxMessageChars;
  #signal;
  #queues = new Map();
  #busyMessages = new BusyMessageDispatcher();
  #pendingInteractions = new Map();
  #interactionKeys = new Map();
  #interactionTasks = new Set();
  #commandTasks = new Set();
  #menus = new Map();
  // Keep the accepted configuration through the existing queue/reply lifecycle.
  #acceptedMessageIds = new Map();
  #approvals;
  #batchInputs = new BatchInputManager();

  constructor({
    api,
    clientId,
    clientSecret,
    harness,
    state,
    contextEnhancement,
    accessPolicy,
    status = createDingtalkBridgeStatus(),
    logger = console,
    replyTimeoutMs = 600_000,
    reactionTimeoutMs = 5_000,
    maxMessageChars = 4_000,
    signal,
  }) {
    if (!api || typeof api.sendText !== 'function') throw new TypeError('DingTalk API is required');
    if (!nonEmptyString(clientId) || !nonEmptyString(clientSecret)) {
      throw new TypeError('DingTalk app credentials are required');
    }
    if (!harness || !state) throw new TypeError('Harness client and state store are required');
    this.#api = api;
    this.#clientId = clientId.trim();
    this.#clientSecret = clientSecret.trim();
    this.#harness = harness;
    this.#state = state;
    this.#contextEnhancement = contextEnhancement;
    this.#accessPolicy = accessPolicy;
    this.#status = status;
    this.#logger = logger;
    this.#approvals = new HarnessApprovalQueue({ label: 'DingTalk', logger });
    this.#replyTimeoutMs = replyTimeoutMs;
    this.#reactionTimeoutMs = Number.isFinite(reactionTimeoutMs) && reactionTimeoutMs > 0
      ? Math.floor(reactionTimeoutMs)
      : 5_000;
    this.#maxMessageChars = maxMessageChars;
    this.#signal = signal;
    this.#deferred = createDeferredDeliveryCoordinator({ harness, state, signal, logger,
      deliver: (entry, outcome) => this.#deliverDeferredOutcome(entry, outcome),
    });
    ensureStats(this.#status);
    this.#refreshPendingSenders();
  }

  get status() {
    this.#refreshPendingSenders();
    return structuredClone(this.#status);
  }

  accept(message, { contextSnapshot, busyMessageMode } = {}) {
    if (this.#signal?.aborted) return Promise.resolve();
    const messageId = nonEmptyString(message?.msgId);
    const sender = senderStaffId(message);
    if (!messageId || !sender || this.#state.hasSeen(messageId)
      || this.#acceptedMessageIds.has(messageId)) return Promise.resolve();
    const conversationType = String(message.conversationType) === '2' ? 'group'
      : String(message.conversationType) === '1' ? 'direct' : null;

    let key;
    try {
      key = conversationKey(message, sender);
    } catch {
      increment(this.#status, 'messagesRejected');
      this.#status.lastRejectedAt = new Date().toISOString();
      return Promise.resolve();
    }

    let sessionWebhook = null;
    try {
      sessionWebhook = normalizeDingtalkSessionWebhook(message.sessionWebhook);
    } catch {
      // An unsafe reply route must never be able to submit an approval.
    }
    const pending = this.#pendingInteractions.get(key);
    const promptMessage = this.#inboundMessage(message, key);
    const commandText = nonEmptyString(promptMessage.content) ?? '';
    const addressed = String(message.conversationType) !== '2' || message?.isInAtList === true;
    const direct = String(message.conversationType) !== '2';
    if (addressed) {
      const access = evaluateInboundAccess(this.#accessPolicy, {
        conversationType,
        senderIds: sender,
        text: commandText,
        hasImages: hasInboundImages(promptMessage),
        hasFiles: hasInboundFiles(promptMessage),
        ...(isDingtalkMenuCommand(commandText) ? { isCommand: true } : {}),
      });
      if (!access.allowed) {
        this.#acceptedMessageIds.set(messageId, null);
        return this.#finishAccessDecision(message, messageId, sessionWebhook, access);
      }
    }
    if (direct && sessionWebhook && !isDingtalkMenuCommand(commandText)
      && this.#state.needsMenuIntroduction?.(key)
      && evaluateInboundAccess(this.#accessPolicy, { conversationType, senderIds: sender, isCommand: true }).allowed) {
      return this.#state.introduceMenu(key, () => this.#showMenu(message, key), { signal: this.#signal, logger: this.#logger })
        .then(() => this.accept(message, { contextSnapshot, busyMessageMode }));
    }
    this.#acceptedMessageIds.set(messageId, contextSnapshot === undefined ? captureContextEnhancement(
      this.#contextEnhancement,
      conversationType,
    ) : contextSnapshot);
    if (sessionWebhook && direct) {
      rememberConnectionTestTarget(this.#state, { sessionWebhook });
    }
    const statusReaction = sessionWebhook && addressed ? this.#startStatusReaction(message) : null;
    const finish = (task) => Promise.resolve(task).then(
      (value) => {
        this.#finishStatusReaction(
          statusReaction,
          this.#signal?.aborted ? 'clear' : 'success',
        );
        return value;
      },
      (error) => {
        this.#finishStatusReaction(
          statusReaction,
          this.#signal?.aborted || error?.name === 'AbortError' || error?.code === 'turn-stopped'
            ? 'clear'
            : 'error',
        );
        throw error;
      },
    );
    const batchCommand = String(message?.msgtype).toLowerCase() === 'text'
      && isBatchInputCommand(commandText);
    const batchStatus = this.#batchInputs.status(key);
    if (batchCommand && !direct && sessionWebhook && addressed) {
      return finish(this.#finishBatchResult(
        messageId,
        sessionWebhook,
        { message: batchInputGroupUnsupportedMessage() },
        statusReaction,
      ));
    }
    if (direct && sessionWebhook && !isDingtalkMenuCommand(commandText)
      && (batchCommand || batchStatus.phase === 'collecting')) {
      const exactBatchStart = /^\/batch$/iu.test(commandText);
      const result = exactBatchStart
        && batchStatus.phase === 'idle'
        && (this.#queues.has(key) || pending || this.#approvals.hasPending(key))
        ? { handled: true, kind: 'busy', message: batchInputBusyMessage() }
        : this.#batchInputs.handle(key, commandText, {
            plainText: Boolean(commandText)
              && String(message?.msgtype).toLowerCase() === 'text'
              && !hasInboundFiles(promptMessage)
              && !hasInboundImages(promptMessage)
              && !hasReplyReference(promptMessage),
          });
      if (result.handled) {
        if (result.kind === 'submit') {
          return finish(this.#enqueueMessage(
            {
              ...message,
              msgtype: 'text',
              text: { content: result.prompt },
            },
            messageId,
            sender,
            key,
            { batchSubmission: result, statusReaction },
          ));
        }
        return finish(this.#finishBatchResult(
          messageId,
          sessionWebhook,
          result,
          statusReaction,
        ));
      }
    }
    const commandRunner = isDingtalkMenuCommand(commandText)
      && !hasInboundFiles(promptMessage) && !hasInboundImages(promptMessage)
      ? async () => { await this.#showMenu(message, key); }
      : isClearCommand(commandText) ? runClearCommand
      : isResetCommand(commandText) ? runResetCommand
      : isHistoryCommand(commandText) ? runHistoryCommand
      : hasInboundFiles(promptMessage) ? null : isControlCommand(commandText)
      ? runControlCommand
      : (isModelCommand(commandText)
          ? runModelCommand
          : (isPresetCommand(commandText) ? runPresetCommand : null));
    if (commandRunner && sessionWebhook && addressed) {
      let task;
      task = this.#processFastCommand(
        message,
        messageId,
        key,
        sessionWebhook,
        promptMessage,
        commandRunner,
      ).catch((error) => {
        if (error?.code === 'turn-stopped' || this.#signal?.aborted) {
          this.#finishStatusReaction(statusReaction, 'clear');
          return;
        }
        this.#finishStatusReaction(statusReaction, 'error');
        this.#status.lastError = error?.message ?? String(error);
        const failure = setLastMessageFailure(this.#status, error);
        this.#logger.error?.(
          `[dsh-dingtalk] failed to process a command [${failure.referenceId}]`,
          messageFailureDiagnostic(error, failure),
        );
        return this.#send(sessionWebhook, messageFailureText(failure), this.#atUsersFor(message)).catch(() => undefined);
      }).finally(() => {
        this.#acceptedMessageIds.delete(messageId);
        this.#commandTasks.delete(task);
      });
      this.#commandTasks.add(task);
      return finish(task);
    }
    const approvalReply = this.#approvals.claimReply({
      key,
      actor: sender,
      messageId,
      text: sessionWebhook && message?.msgtype === 'text'
        ? nonEmptyString(message?.text?.content) ?? ''
        : '',
      addressed: String(message?.conversationType) !== '2' || message?.isInAtList === true,
      hasPendingQuestion: Boolean(pending),
      questionCompletion: pending?.submitting || pending?.claimedReplyMessageId
        ? pending.queue
        : null,
      isQuestionPending: () => this.#pendingInteractions.has(key),
      send: sessionWebhook
        ? (reply) => this.#send(sessionWebhook, reply, this.#atUsersFor(message))
        : async () => undefined,
    });
    if (approvalReply) {
      let current;
      current = approvalReply.process(async () => {
          if (this.#state.hasSeen(messageId)) return false;
          await this.#state.markSeen(messageId);
          increment(this.#status, 'messagesReceived');
          this.#status.lastMessageAt = new Date().toISOString();
          if (!sessionWebhook) {
            increment(this.#status, 'messagesRejected');
            this.#status.lastRejectedAt = new Date().toISOString();
            this.#status.lastError = t('钉钉消息没有安全的回复地址。');
          }
          return true;
        })
        .catch((error) => {
          if (this.#signal?.aborted) {
            this.#finishStatusReaction(statusReaction, 'clear');
            return;
          }
          this.#finishStatusReaction(statusReaction, 'error');
          this.#status.lastError = t('钉钉审批处理失败。');
          this.#logger.error?.('[dsh-dingtalk] failed to process an approval reply', error);
        })
        .finally(() => {
          this.#acceptedMessageIds.delete(messageId);
          this.#interactionTasks.delete(current);
        });
      this.#interactionTasks.add(current);
      return finish(current);
    }

    if (pending && pending.actor !== sender) {
      return finish(this.#enqueueMessage(message, messageId, sender, key, { statusReaction }));
    }
    // Once one valid answer has been claimed, later messages are subsequent
    // prompts even if the network submission eventually needs a retry. Invalid
    // replies do not claim the question, so the next valid answer can still
    // pass through this interaction queue.
    if (pending?.submitting || pending?.claimedReplyMessageId) {
      return finish(this.#enqueueMessage(message, messageId, sender, key, { statusReaction }));
    }
    if (pending) {
      if (canClaimInteractionReply(message, pending, sender)) {
        pending.claimedReplyMessageId = messageId;
      }
      const previous = pending.queue ?? Promise.resolve();
      const current = previous
        .catch(() => undefined)
        .then(() => this.#processInteractionReply(
          message,
          messageId,
          sender,
          key,
          pending,
          statusReaction,
        ))
        .finally(() => {
          this.#acceptedMessageIds.delete(messageId);
          if (pending.claimedReplyMessageId === messageId) {
            pending.claimedReplyMessageId = null;
          }
          if (pending.queue === current) pending.queue = null;
        });
      pending.queue = current;
      return finish(current);
    }
    return finish(this.#busyMessages.dispatch({
      key, messageId, text: commandText, mode: busyMessageMode,
      onFailure: (error) => this.#finishStatusReaction(statusReaction,
        this.#signal?.aborted || error?.code === 'turn-stopped' ? 'clear' : 'error'),
      eligible: () => Boolean(sessionWebhook) && addressed && String(message.msgtype).toLowerCase() === 'text'
        && !hasInboundImages(promptMessage) && !hasInboundFiles(promptMessage)
        && !hasReplyReference(promptMessage) && !isDingtalkMenuCommand(commandText)
        && canAutomaticallySteer(this.#accessPolicy, conversationType, sender),
      harness: this.#harness, state: this.#state, status: this.#status,
      signal: this.#signal, control: { owner: this, key }, logger: this.#logger,
      acceptedMessageIds: this.#acceptedMessageIds,
      pendingInteraction: () => this.#pendingInteractions.has(key) || this.#approvals.hasPending(key),
      enhancement: {
        snapshot: this.#acceptedMessageIds.get(messageId),
        source: () => ({ channel: 'dingtalk', senderId: sender, senderName: message.senderNick,
          conversationTitle: message.conversationTitle, chatId: message.conversationId }),
      },
      isQueued: () => this.#queues.has(key),
      enqueue: (options) => this.#enqueueMessage(message, messageId, sender, key, { ...options, statusReaction }),
      send: (reply) => sessionWebhook && addressed
        ? this.#send(sessionWebhook, reply, this.#atUsersFor(message)) : Promise.resolve(),
    }));
  }

  async #showMenu(message, key) {
    await this.#state.markMenuIntroduction?.(key);
    if (typeof this.#api.createMenuCard !== 'function') {
      await this.#send(message.sessionWebhook, helpText(), this.#atUsersFor(message));
      return;
    }
    const snapshot = await dingtalkMenuSnapshot(this.#harness, this.#state, key, this.#signal);
    const now = Date.now();
    for (const [id, entry] of this.#menus) {
      if (entry.expiresAt <= now || entry.key === key) this.#menus.delete(id);
    }
    while (this.#menus.size >= 256) this.#menus.delete(this.#menus.keys().next().value);
    let cardInstanceId;
    try {
      ({ cardInstanceId } = await this.#api.createMenuCard({
        clientId: this.#clientId, clientSecret: this.#clientSecret,
        target: cardTarget(message, senderStaffId(message)), data: snapshot.data, signal: this.#signal,
      }));
    } catch (error) {
      this.#signal?.throwIfAborted();
      if (!(error?.status >= 400 && error.status < 500) || error.status === 429) throw error;
      await this.#send(message.sessionWebhook, menuIntroductionText(), this.#atUsersFor(message));
      return;
    }
    this.#menus.set(cardInstanceId, {
      ...snapshot, key, message, cardInstanceId, expiresAt: now + 30 * 60_000, busy: false,
    });
  }

  acceptCard(callback, messageId) {
    if (this.#signal?.aborted || !nonEmptyString(messageId) || this.#state.hasSeen(messageId)) {
      return Promise.resolve();
    }
    const entry = this.#menus.get(callback?.outTrackId);
    if (!entry || entry.busy || entry.expiresAt <= Date.now()
      || callback?.userId !== senderStaffId(entry.message)) return Promise.resolve();
    const command = dingtalkMenuCommand(entry, callback);
    if (!command) return Promise.resolve();
    entry.busy = true;
    let task;
    task = this.#processMenuAction(entry, command, messageId).catch(async (error) => {
      if (this.#signal?.aborted) return;
      this.#status.lastError = error?.message ?? String(error);
      this.#logger.warn?.('[dsh-dingtalk] menu action failed', safeErrorDiagnostic(error));
      await this.#api.updateMenuCard({
        clientId: this.#clientId, clientSecret: this.#clientSecret,
        cardInstanceId: entry.cardInstanceId,
        data: { notice: t('操作未完成，请重新发送 /m 后重试。') }, signal: this.#signal,
      }).catch(() => undefined);
    }).finally(() => { entry.busy = false; this.#commandTasks.delete(task); });
    this.#commandTasks.add(task);
    return task;
  }

  async #processMenuAction(entry, command, messageId) {
    await this.#state.markSeen(messageId);
    const { key, message } = entry;
    const options = {
      signal: this.#signal, isDirect: String(message.conversationType) === '1',
      pendingInteraction: this.#pendingInteractions.has(key) || this.#approvals.hasPending(key),
      control: { owner: this, key }, deferredDelivery: this.#deferred,
      enhancement: captureContextEnhancementSource(
        this.#contextEnhancement,
        String(message.conversationType) === '1' ? 'direct' : 'group',
        () => ({
          channel: 'dingtalk',
          senderId: senderStaffId(message),
          senderName: message.senderNick,
          conversationTitle: message.conversationTitle,
          chatId: message.conversationId,
        }),
      ),
    };
    const access = evaluateInboundAccess(this.#accessPolicy, {
      conversationType: options.isDirect ? 'direct' : 'group',
      senderIds: senderStaffId(message), text: command, isCommand: true,
    });
    let result;
    if (!access.allowed) {
      await this.#api.updateMenuCard({
        clientId: this.#clientId, clientSecret: this.#clientSecret,
        cardInstanceId: entry.cardInstanceId,
        data: { notice: t(COMMAND_PERMISSION_DENIED_MESSAGE) }, signal: this.#signal,
      });
      return;
    }
    const sessionWorkspace = await conversationSessionWorkspace(this.#harness, key, { signal: this.#signal });
    if (entry.workspace !== this.#harness.currentWorkspace?.()
      || entry.sessionWorkspace !== sessionWorkspace
      || entry.sessionId !== this.#state.sessionFor(key)) {
      result = { message: t('会话或工作区已变化，菜单已刷新，请重新选择。') };
    } else if ((this.#queues.has(key) || options.pendingInteraction || this.#batchInputs.status(key).phase !== 'idle')
      && !['/stop', '/help', '/status', '/history'].includes(command)) {
      result = { message: t('当前任务尚未结束，请先停止任务或等待完成后再操作。') };
    } else if (command === '/new') {
      const created = await createConversationSession({ state: this.#state, harness: this.#harness, key });
      result = { message: created.failed ? t('暂时无法创建新会话，请稍后重试。') : t('已开启新会话。请发送你的问题。') };
    } else if (command === '/status') {
      await this.#harness.ensureRunning({ signal: this.#signal });
      result = { message: t('钉钉机器人与 DeepSeek Harness 连接正常。') };
    } else if (command === '/help') {
      result = { message: helpText() };
    } else {
      result = await runWorkspaceCommand(command, this.#harness, key)
        ?? await runClearCommand(command, this.#harness, this.#state, key, options)
        ?? await runResetCommand(command, this.#harness, this.#state, key, options)
        ?? await runCompactCommand(command, this.#harness, this.#state, key, options)
        ?? await runControlCommand(command, this.#harness, this.#state, key, options)
        ?? await runHistoryCommand(command, this.#harness, this.#state, key, options)
        ?? await runModelCommand(command, this.#harness, this.#state, key, options)
        ?? await runPresetCommand(command, this.#harness, this.#state, key, options);
    }
    if (result?.stopped) await Promise.allSettled([
      this.#cancelPendingInteraction(key), this.#approvals.closeRoute(key),
    ]);
    const snapshot = await dingtalkMenuSnapshot(this.#harness, this.#state, key, this.#signal);
    if (command === '/help' || command === '/history') {
      for (const reply of result?.messages ?? [result?.message]) {
        if (reply) await this.#send(message.sessionWebhook, reply, this.#atUsersFor(message));
      }
    } else snapshot.data.notice = (result?.message ?? '').slice(0, 300);
    await this.#api.updateMenuCard({
      clientId: this.#clientId, clientSecret: this.#clientSecret,
      cardInstanceId: entry.cardInstanceId, data: snapshot.data, signal: this.#signal,
    });
    Object.assign(entry, snapshot);
    this.#status.lastError = null;
  }

  #runReactionCall(method, target, reactionName, kind) {
    const controller = new AbortController();
    const operation = Promise.resolve().then(() => this.#api[method]({
      clientId: this.#clientId,
      clientSecret: this.#clientSecret,
      ...target,
      reactionName,
      signal: controller.signal,
    }));
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new DOMException('DingTalk reaction timed out', 'TimeoutError');
        controller.abort(error);
        reject(error);
      }, this.#reactionTimeoutMs);
      timer.unref?.();
    });
    return Promise.race([operation, timeout])
      .then(() => {
        increment(this.#status, kind === 'add' ? 'reactionsAdded' : 'reactionsRemoved');
        return true;
      })
      .catch((error) => {
        increment(this.#status, 'reactionErrors');
        this.#logger.debug?.(`[dsh-dingtalk] ${method} failed`, safeErrorDiagnostic(error));
        return false;
      })
      .finally(() => clearTimeout(timer));
  }

  #startStatusReaction(message) {
    if (typeof this.#api.addReaction !== 'function'
      || typeof this.#api.recallReaction !== 'function') return null;
    const messageId = nonEmptyString(message?.msgId);
    const conversationId = nonEmptyString(message?.conversationId);
    if (!messageId || !conversationId) return null;
    const target = {
      messageId,
      conversationId,
      robotCode: nonEmptyString(message?.robotCode) ?? this.#clientId,
    };
    return {
      target,
      attached: this.#runReactionCall(
        'addReaction',
        target,
        DINGTALK_THINKING_REACTION_NAME,
        'add',
      ),
      terminal: false,
    };
  }

  #finishStatusReaction(reaction, outcome) {
    if (!reaction || reaction.terminal) return;
    reaction.terminal = true;
    const terminalName = outcome === 'success'
      ? DINGTALK_DONE_REACTION_NAME
      : outcome === 'error' ? DINGTALK_ERROR_REACTION_NAME : null;
    // Preserve attach -> recall -> terminal ordering without extending the message task.
    void reaction.attached.then(async (attached) => {
      let cleaned = await this.#runReactionCall(
        'recallReaction',
        reaction.target,
        DINGTALK_THINKING_REACTION_NAME,
        'remove',
      );
      if (!attached || !cleaned) {
        await new Promise((resolve) => {
          const retry = setTimeout(resolve, Math.min(1_000, this.#reactionTimeoutMs));
          retry.unref?.();
        });
        cleaned = await this.#runReactionCall(
          'recallReaction',
          reaction.target,
          DINGTALK_THINKING_REACTION_NAME,
          'remove',
        ) || cleaned;
      }
      if (!cleaned || !terminalName || this.#signal?.aborted) return;
      await this.#runReactionCall('addReaction', reaction.target, terminalName, 'add');
    }).catch(() => undefined);
  }

  #enqueueMessage(message, messageId, sender, key, {
    releaseMessageId = true,
    alreadyRecorded = false,
    batchSubmission = null,
    statusReaction = null,
  } = {}) {
    let hasSafeReplyRoute = false;
    try {
      normalizeDingtalkSessionWebhook(message.sessionWebhook);
      hasSafeReplyRoute = true;
    } catch {
      // Keep the existing rejection path without downloading an unusable file.
    }
    const addressed = String(message.conversationType) !== '2' || message.isInAtList === true;
    const preparedMessage = hasSafeReplyRoute && addressed
      ? prefetchInboundFiles(this.#inboundMessage(message, key), { signal: this.#signal })
      : undefined;
    const previous = this.#queues.get(key) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(() => this.#process(message, messageId, sender, key, {
        alreadyRecorded,
        preparedMessage,
        batchSubmission,
        statusReaction,
      }))
      .finally(() => {
        if (releaseMessageId) this.#acceptedMessageIds.delete(messageId);
        if (this.#queues.get(key) === current) this.#queues.delete(key);
      });
    this.#queues.set(key, current);
    return current;
  }

  #inboundMessage(message, key) {
    return dingtalkInboundMessage(message, {
      api: this.#api,
      clientId: this.#clientId,
      clientSecret: this.#clientSecret,
      loadReplyContent: (reference, options) => this.#loadReplyContent(key, reference, options),
    });
  }

  async #loadReplyContent(key, reference, { signal } = {}) {
    const indexed = this.#state.recentOutboundTextFor?.({
      conversationKey: key,
      ...reference,
    });
    if (indexed) return { content: indexed };
    const quotedAt = dingtalkTimestampMs(reference?.createdAt);
    if (quotedAt === null) return { unavailableReason: 'not-delivered' };
    const sessionId = this.#state.sessionFor(key);
    const session = typeof sessionId === 'string' && sessionId
      ? this.#harness.workspaceSession?.(sessionId, key)
      : null;
    const text = await recoverAssistantTextByTimestamp({
      session,
      quotedAt,
      signal,
      toleranceMs: DINGTALK_RECENT_OUTBOUND_MATCH_TOLERANCE_MS,
    });
    if (!text) return { unavailableReason: 'not-delivered' };
    try {
      await this.#state.rememberOutboundMessage?.({
        conversationKey: key,
        text,
        sentAt: quotedAt,
        completedAt: quotedAt,
        providerMessageIds: [reference?.processQueryKey, reference?.messageId]
          .map(nonEmptyString)
          .filter(Boolean),
      });
    } catch (error) {
      this.#logger.warn?.('[dsh-dingtalk] failed to remember a recovered quote:', error);
    }
    return { content: text };
  }

  async #deliverDeferredOutcome(entry, outcome) {
    const text = deferredOutcomeText(outcome);
    if (outcome.found && ['createAiCard', 'updateAiCard', 'finishAiCard'].every((name) => typeof this.#api[name] === 'function')) {
      const card = createDingTalkCardStream({ api: this.#api, clientId: this.#clientId,
        clientSecret: this.#clientSecret, target: entry.target, signal: this.#signal, logger: this.#logger });
      if (await card.start(t(CARD_INITIAL_TEXT)) && await card.finish(text)) return true;
      this.#logger.warn?.('[dsh-dingtalk] deferred card unavailable; sending robot text');
    }
    await this.#api.sendRobotText({ clientId: this.#clientId, clientSecret: this.#clientSecret,
      target: entry.target, text, signal: this.#signal });
    return true;
  }

  async waitForIdle() {
    await this.#busyMessages.whenIdle();
    await Promise.allSettled([
      ...this.#queues.values(),
      ...[...this.#pendingInteractions.values()].flatMap((pending) => (
        pending.queue ? [pending.queue] : []
      )),
      ...this.#interactionTasks,
      ...this.#commandTasks,
    ]);
    await this.#deferred.whenIdle();
  }

  async #processFastCommand(message, messageId, key, sessionWebhook, prompt, runner) {
    this.#signal?.throwIfAborted();
    if (this.#state.hasSeen(messageId)) return;
    await this.#state.markSeen(messageId);
    increment(this.#status, 'messagesReceived');
    this.#status.lastMessageAt = new Date().toISOString();
    const result = await runner(
      nonEmptyString(prompt.content) ?? '',
      this.#harness,
      this.#state,
      key,
      {
        signal: this.#signal,
        isDirect: String(message.conversationType) === '1',
        hasImages: hasInboundImages(prompt),
        hasFiles: hasInboundFiles(prompt),
        pendingInteraction: this.#pendingInteractions.has(key)
          || this.#approvals.hasPending(key),
        busy: this.#queues.has(key) || this.#batchInputs.status(key).phase !== 'idle',
        control: { owner: this, key },
        deferredDelivery: this.#deferred,
        enhancement: captureContextEnhancementSource(
          this.#contextEnhancement,
          String(message.conversationType) === '1' ? 'direct' : 'group',
          () => ({
            channel: 'dingtalk',
            senderId: senderStaffId(message),
            senderName: message.senderNick,
            conversationTitle: message.conversationTitle,
            chatId: message.conversationId,
          }),
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
      if (reply) await this.#send(sessionWebhook, reply, this.#atUsersFor(message));
    }
    this.#status.lastError = null;
  }

  #finishBatchResult(messageId, sessionWebhook, result, statusReaction) {
    let task;
    task = Promise.resolve().then(async () => {
      if (this.#state.hasSeen(messageId)) return;
      await this.#state.markSeen(messageId);
      increment(this.#status, 'messagesReceived');
      this.#status.lastMessageAt = new Date().toISOString();
      if (result.message) await this.#send(sessionWebhook, result.message);
      this.#status.lastError = null;
    }).catch(async (error) => {
      if (this.#signal?.aborted) {
        this.#finishStatusReaction(statusReaction, 'clear');
        return;
      }
      this.#finishStatusReaction(statusReaction, 'error');
      this.#status.lastError = error?.message ?? String(error);
      const failure = setLastMessageFailure(this.#status, error);
      this.#logger.error?.(
        `[dsh-dingtalk] failed to process a batch input message [${failure.referenceId}]`,
        messageFailureDiagnostic(error, failure),
      );
      await this.#send(sessionWebhook, messageFailureText(failure)).catch(() => undefined);
    }).finally(() => {
      this.#acceptedMessageIds.delete(messageId);
      this.#commandTasks.delete(task);
    });
    this.#commandTasks.add(task);
    return task;
  }

  #finishAccessDecision(message, messageId, sessionWebhook, access) {
    let task;
    task = Promise.resolve().then(async () => {
      if (this.#state.hasSeen(messageId)) return;
      await this.#state.markSeen(messageId);
      if (access.reason === 'command-not-allowed' && sessionWebhook) {
        increment(this.#status, 'messagesReceived');
        this.#status.lastMessageAt = new Date().toISOString();
        await this.#send(
          sessionWebhook,
          t(COMMAND_PERMISSION_DENIED_MESSAGE),
          this.#atUsersFor(message),
        );
        increment(this.#status, 'messagesReplied');
        this.#status.lastReplyAt = new Date().toISOString();
      } else {
        increment(this.#status, 'messagesRejected');
        this.#status.lastRejectedAt = new Date().toISOString();
      }
      this.#status.lastError = null;
    }).catch((error) => {
      if (this.#signal?.aborted) return;
      this.#status.lastError = error?.message ?? String(error);
      this.#logger.error?.('[dsh-dingtalk] failed to apply inbound access policy', error);
    }).finally(() => {
      this.#acceptedMessageIds.delete(messageId);
      this.#commandTasks.delete(task);
    });
    this.#commandTasks.add(task);
    return task;
  }

  async #process(message, messageId, sender, key, {
    alreadyRecorded = false,
    preparedMessage,
    batchSubmission = null,
    statusReaction = null,
  } = {}) {
    this.#signal?.throwIfAborted();
    if (!alreadyRecorded) {
      if (this.#state.hasSeen(messageId)) return;
      await this.#state.markSeen(messageId);
      increment(this.#status, 'messagesReceived');
      this.#status.lastMessageAt = new Date().toISOString();
    }

    if (String(message.conversationType) === '2' && message.isInAtList !== true) {
      increment(this.#status, 'messagesIgnored');
      return;
    }

    let sessionWebhook;
    try {
      sessionWebhook = normalizeDingtalkSessionWebhook(message.sessionWebhook);
    } catch {
      increment(this.#status, 'messagesRejected');
      this.#status.lastRejectedAt = new Date().toISOString();
      this.#status.lastError = t('钉钉消息没有安全的回复地址。');
      return;
    }

    const promptMessage = preparedMessage ?? this.#inboundMessage(message, key);
    const text = promptMessage.content;
    const hasImages = hasInboundImages(promptMessage);
    const hasFiles = hasInboundFiles(promptMessage);
    const hasReply = hasReplyReference(promptMessage);
    const isPlainText = String(message?.msgtype).toLowerCase() === 'text';
    let cardStream = null;
    let cardStarted = false;
    let cardStartedAt = null;
    let batchSettled = batchSubmission === null;
    try {
      if (!text && !hasImages && !hasFiles && !hasReply) {
        await this.#send(sessionWebhook, t('目前支持文字、图片和文件消息。'), this.#atUsersFor(message));
        return;
      }

      const command = text.toLowerCase();
      if (isPlainText && !hasImages && !hasFiles && command === '/help') {
        await this.#send(sessionWebhook, helpText(), this.#atUsersFor(message));
        return;
      }
      if (isPlainText && !hasImages && !hasFiles && command === '/status') {
        await this.#harness.ensureRunning({ signal: this.#signal });
        await this.#send(sessionWebhook, t('钉钉机器人与 DeepSeek Harness 连接正常。'), this.#atUsersFor(message));
        return;
      }
      if (isPlainText && !hasImages && !hasFiles && isNewCommand(text)) {
        const created = await createConversationSession({ state: this.#state, harness: this.#harness, key, title: newCommandTitle(text) });
        await this.#send(sessionWebhook, created.failed ? t('暂时无法创建新会话，请稍后重试。') : t('已开启新会话。请发送你的问题。'), this.#atUsersFor(message));
        return;
      }
      if (isPlainText && !hasImages && !hasFiles && isSessionNavCommand(text)) {
        const nav = await runSessionNavTextCommand(text, this.#harness, this.#state, key, {
          signal: this.#signal,
        });
        if (nav) {
          for (const reply of nav.messages ?? [nav.message]) {
            await this.#send(sessionWebhook, reply, this.#atUsersFor(message));
          }
          if (nav.askText) {
            const followUp = this.#enqueueMessage(
              { ...message, msgtype: 'text', text: { content: nav.askText } },
              `${messageId}-ask`,
              sender,
              key,
              { statusReaction },
            );
            followUp.catch((error) => {
              this.#logger.warn?.(`[dsh-im:dingtalk] follow-up ask after a nav command failed:`, error?.message ?? error);
              this.#send(sessionWebhook, t('切换后的提问发送失败，请重试。'), this.#atUsersFor(message)).catch(() => undefined);
            });
          }
        }
        return;
      }
      const workspaceCommand = isPlainText && !hasImages && !hasFiles
        ? await runWorkspaceCommand(text, this.#harness, key)
        : null;
      if (workspaceCommand) {
        for (const reply of workspaceCommand.messages ?? [workspaceCommand.message]) {
          await this.#send(sessionWebhook, reply, this.#atUsersFor(message));
        }
        return;
      }
      const compactCommand = isPlainText && !hasImages && !hasFiles
        ? await runCompactCommand(
            text,
            this.#harness,
            this.#state,
            key,
            { signal: this.#signal },
          )
        : null;
      if (compactCommand) {
        await this.#send(sessionWebhook, compactCommand.message, this.#atUsersFor(message));
        return;
      }

      const modelMessage = prepareDingtalkReplyAttachments(message, promptMessage, {
        api: this.#api, clientId: this.#clientId, clientSecret: this.#clientSecret,
        signal: this.#signal,
      });
      let content = hasInboundImages(modelMessage) || hasReply
        ? await promptContentForInboundMessage(modelMessage, { signal: this.#signal, deferImages: true })
        : undefined;
      const snapshot = this.#acceptedMessageIds.get(messageId);
      let contextEnhanced = false;
      if (snapshot) {
        const originalContent = content ?? text;
        content = enhanceContextContent(originalContent, snapshot, () => ({
          channel: 'dingtalk',
          senderId: sender,
          senderName: message.senderNick,
          conversationTitle: message.conversationTitle,
          chatId: message.conversationId,
        }));
        contextEnhanced = content !== originalContent;
      }
      if (typeof this.#api.createAiCard === 'function'
        && typeof this.#api.updateAiCard === 'function'
        && typeof this.#api.finishAiCard === 'function') {
        cardStream = createDingTalkCardStream({
          api: this.#api,
          clientId: this.#clientId,
          clientSecret: this.#clientSecret,
          target: cardTarget(message, sender),
          signal: this.#signal,
          logger: this.#logger,
        });
        const startedAt = Date.now();
        cardStarted = await cardStream.start(t(CARD_INITIAL_TEXT));
        if (cardStarted) cardStartedAt = startedAt;
      }
      const { answer, artifacts = [] } = await askInWorkspaceSession({
        onNotice: (notice) => this.#send(sessionWebhook, notice, this.#atUsersFor(message)),
        deferredDelivery: () => ({ coordinator: this.#deferred, target: { ...cardTarget(message, sender), robotCode: this.#clientId } }),
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
          onUpdate: cardStarted
            ? (update) => cardStream.push(progressText(update))
            : undefined,
          onInteraction: (interaction) => this.#handleInteraction(interaction, {
            key,
            actor: sender,
            sessionWebhook,
            requiresMention: String(message.conversationType) === '2',
          }),
          onInteractionResolved: (resolution) => this.#handleInteractionResolved(resolution),
          files: modelMessage.files,
          images: modelMessage.images,
        },
      });
      if (batchSubmission) {
        this.#batchInputs.complete(key, batchSubmission.token);
        batchSettled = true;
      }
      const answerText = typeof answer === 'string' && answer.trim()
        ? answer
        : artifacts.length > 0 ? t('结果文件已生成。') : answer;
      let textDeliveryError = null;
      let textReceipt = null;
      let streamed = false;
      const deliveryStartedAt = cardStartedAt ?? Date.now();
      try {
        streamed = cardStarted && await cardStream.finish(answerText);
        if (streamed) {
          textReceipt = createDeliveryReceipt({
            deliveryId: messageId,
            presentation: 'dingtalk-card',
            providerMessageIds: cardStream.providerMessageIds,
          });
        } else {
          // Failed streams close the card with a notice pointing to a
          // follow-up message. Deliver the answer through that fallback.
          textReceipt = createDeliveryReceipt({
            deliveryId: messageId,
            presentation: 'dingtalk-text',
            providerMessageIds: await this.#send(sessionWebhook, answerText, this.#atUsersFor(message)),
          });
        }
        try {
          await this.#state.rememberOutboundMessage?.({
            conversationKey: key,
            text: answerText,
            sentAt: deliveryStartedAt,
            completedAt: Date.now(),
            providerMessageIds: providerMessageIdsFor(textReceipt),
          });
        } catch (error) {
          this.#logger.warn?.('[dsh-dingtalk] failed to remember an outbound message:', error);
        }
      } catch (error) {
        textDeliveryError = channelDeliveryFailure(error);
      }
      const delivery = await this.#deliverArtifacts(
        fileTarget(message, sender, this.#clientId),
        sessionWebhook,
        messageId,
        artifacts,
        textReceipt,
      );
      if (textDeliveryError && !delivery.userVisible) throw textDeliveryError;
      if (textDeliveryError && delivery.artifactSendErrors === 0) {
        setLastMessageFailure(this.#status, textDeliveryError);
      }
      increment(this.#status, 'messagesReplied');
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
        this.#finishStatusReaction(statusReaction, 'clear');
        if (cardStarted) await cardStream.finish(t('已停止。')).catch(() => undefined);
        return;
      }
      if (this.#signal?.aborted) {
        this.#finishStatusReaction(statusReaction, 'clear');
        return;
      }
      this.#finishStatusReaction(statusReaction, 'error');
      this.#status.lastError = error?.message ?? String(error);
      const userMessage = inboundFileUserMessage(error)
        ?? dingtalkImageErrorUserMessage(error);
      const failure = setLastMessageFailure(this.#status, error, {
        userMessage,
        reason: imagePromptDiagnostic(error)?.reason,
      });
      this.#logger.error?.(
        `[dsh-dingtalk] failed to process an inbound message [${failure.referenceId}]`,
        messageFailureDiagnostic(error, failure),
      );
      try {
        const errorText = messageFailureText(failure);
        const visibleError = batchFailureMessage
          ? `${errorText}\n\n${batchFailureMessage}`
          : errorText;
        const streamed = cardStarted && await cardStream.finish(visibleError);
        if (!streamed) {
          await this.#send(sessionWebhook, visibleError, this.#atUsersFor(message));
        }
      } catch {
        this.#logger.error?.('[dsh-dingtalk] failed to send the safe error reply');
      }
    } finally {
      await this.#cancelPendingInteraction(key);
      await this.#approvals.closeRoute(key);
    }
  }

  async #processInteractionReply(
    message,
    messageId,
    sender,
    key,
    expected,
    statusReaction,
  ) {
    this.#signal?.throwIfAborted();
    const current = this.#pendingInteractions.get(key);
    const claimed = expected.claimedReplyMessageId === messageId;
    if (!current || current !== expected || current.submitting) {
      if (claimed && (!current || current !== expected)) {
        return this.#discardResolvedInteractionReply(message, messageId);
      }
      return this.#enqueueMessage(message, messageId, sender, key, {
        releaseMessageId: false,
        statusReaction,
      });
    }
    if (this.#state.hasSeen(messageId)) return;
    await this.#state.markSeen(messageId);
    increment(this.#status, 'messagesReceived');
    this.#status.lastMessageAt = new Date().toISOString();

    if (String(message.conversationType) === '2' && message.isInAtList !== true) {
      increment(this.#status, 'messagesIgnored');
      return;
    }

    let sessionWebhook;
    try {
      sessionWebhook = normalizeDingtalkSessionWebhook(message.sessionWebhook);
    } catch {
      increment(this.#status, 'messagesRejected');
      this.#status.lastRejectedAt = new Date().toISOString();
      this.#status.lastError = t('钉钉消息没有安全的回复地址。');
      return;
    }

    const text = message?.msgtype === 'text' ? nonEmptyString(message?.text?.content) : null;
    if (!text) {
      try {
        await this.#send(sessionWebhook, t('请用文字回答当前问题。'), this.#atUsersFor(message));
      } catch {
        this.#logger.error?.('[dsh-dingtalk] failed to reject a non-text interaction reply');
      }
      return;
    }

    const pending = this.#pendingInteractions.get(key);
    if (!pending || pending !== expected || pending.submitting) {
      if (claimed && (!pending || pending !== expected)) {
        try {
          await this.#send(sessionWebhook, t(INTERACTION_RESOLVED_TEXT), this.#atUsersFor(message));
        } catch {
          this.#logger.error?.('[dsh-dingtalk] failed to send an expired interaction notice');
        }
        return;
      }
      return this.#enqueueMessage(message, messageId, sender, key, {
        releaseMessageId: false,
        alreadyRecorded: true,
        statusReaction,
      });
    }
    pending.sessionWebhook = sessionWebhook;
    if (pending.needsPresentation) {
      try {
        await this.#presentInteraction(pending);
      } catch {
        this.#finishStatusReaction(statusReaction, 'error');
        this.#status.lastError = t('钉钉交互问题发送失败。');
        this.#logger.error?.('[dsh-dingtalk] failed to retry an interaction question');
        pending.interaction.reconnect?.();
      }
      return;
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
        this.#finishStatusReaction(statusReaction, 'error');
        this.#status.lastError = t('钉钉交互问题发送失败。');
        this.#logger.error?.('[dsh-dingtalk] failed to send the next interaction question');
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
      if (this.#signal?.aborted) {
        this.#finishStatusReaction(statusReaction, 'clear');
        return;
      }
      if (this.#pendingInteractions.get(key) !== pending) return;
      if (error?.code === 'interaction-not-pending') {
        this.#clearPendingInteraction(key, pending.interactionId);
        try {
          await this.#send(sessionWebhook, t(INTERACTION_RESOLVED_TEXT), this.#atUsersFor(message));
        } catch {
          this.#logger.error?.('[dsh-dingtalk] failed to send an expired interaction notice');
        }
        return;
      }
      this.#finishStatusReaction(statusReaction, 'error');
      pending.submitting = false;
      pending.answers.pop();
      pending.index -= 1;
      this.#status.lastError = t('回答提交失败。');
      this.#logger.error?.('[dsh-dingtalk] failed to answer a Harness interaction');
      try {
        await this.#send(sessionWebhook, t('回答提交失败，请重新发送当前问题的答案。'), this.#atUsersFor(message));
      } catch {
        this.#logger.error?.('[dsh-dingtalk] failed to send an interaction retry notice');
      }
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
    sessionWebhook,
    requiresMention,
  }) {
    if (await this.#approvals.handleRequested(interaction, {
      key,
      actor,
      requiresMention,
      send: (text) => this.#send(sessionWebhook, text),
    })) return;

    // Approval requests return above; the existing question state machine stays unchanged.
    if (interaction?.kind !== 'question') return;
    const questions = interaction?.payload?.questions;
    const interactionId = typeof interaction?.interactionId === 'string'
      ? interaction.interactionId
      : interaction?.rpcId;
    if (typeof interaction.rpcId !== 'string'
      || typeof interactionId !== 'string'
      || typeof interaction.sessionId !== 'string'
      || !Array.isArray(questions)
      || questions.length === 0
      || questions.some((question) => !validHarnessQuestion(question))) {
      this.#logger.warn?.('[dsh-dingtalk] ignored an invalid Harness question interaction');
      return;
    }

    if (interaction.recovered === true) {
      await interaction.respond({
        ok: false,
        error: {
          code: 'cancelled',
          message: 'DingTalk safely cancelled an interaction left by an earlier client.',
          details: {},
        },
      });
      try {
        await this.#send(sessionWebhook, t('检测到这个 Session 中遗留的待回答问题，已安全取消并继续处理你刚才的消息。'));
      } catch {
        this.#logger.error?.('[dsh-dingtalk] failed to send an interaction recovery notice');
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
      this.#logger.warn?.('[dsh-dingtalk] cancelled a second pending Harness question');
      await interaction.respond({
        ok: false,
        error: {
          code: 'cancelled',
          message: 'DingTalk is already handling another user interaction.',
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
      sessionWebhook,
      queue: null,
      claimedReplyMessageId: null,
      submitting: false,
      needsPresentation: true,
    };
    this.#pendingInteractions.set(key, pending);
    this.#interactionKeys.set(pending.interactionId, key);
    await this.#presentInteraction(pending);
  }

  async #handleInteractionResolved(resolution) {
    if (await this.#approvals.handleResolved(resolution)) return;
    const interactionId = resolution?.interactionId;
    if (resolution?.kind !== 'question' || typeof interactionId !== 'string') return;
    const key = this.#interactionKeys.get(interactionId);
    if (!key) return;
    this.#clearPendingInteraction(key, interactionId);
  }

  async #presentInteraction(pending) {
    const question = pending.questions[pending.index];
    if (!question) return;
    await this.#send(
      pending.sessionWebhook,
      harnessQuestionText(
        question,
        pending.index,
        pending.questions.length,
        { requiresMention: pending.requiresMention },
      ),
    );
    pending.needsPresentation = false;
  }

  async #discardResolvedInteractionReply(message, messageId) {
    if (this.#state.hasSeen(messageId)) return;
    await this.#state.markSeen(messageId);
    increment(this.#status, 'messagesReceived');
    this.#status.lastMessageAt = new Date().toISOString();
    let sessionWebhook;
    try {
      sessionWebhook = normalizeDingtalkSessionWebhook(message.sessionWebhook);
    } catch {
      increment(this.#status, 'messagesRejected');
      this.#status.lastRejectedAt = new Date().toISOString();
      return;
    }
    try {
      await this.#send(sessionWebhook, t(INTERACTION_RESOLVED_TEXT), this.#atUsersFor(message));
    } catch {
      this.#logger.error?.('[dsh-dingtalk] failed to send an expired interaction notice');
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

  async #cancelPendingInteraction(key) {
    const pending = this.#takePendingInteraction(key);
    if (!pending || pending.kind !== 'question') return;
    try {
      await pending.interaction.respond({
        ok: false,
        error: {
          code: 'cancelled',
          message: 'The DingTalk interaction ended before the user answered.',
          details: {},
        },
      }, { signal: AbortSignal.timeout(5_000) });
    } catch (error) {
      if (error?.code !== 'interaction-not-pending') {
        this.#logger.warn?.('[dsh-dingtalk] failed to cancel a pending Harness interaction');
      }
    }
  }

  #refreshPendingSenders() {
    if (typeof this.#state.pendingSenders === 'function') {
      this.#status.pendingSenders = this.#state.pendingSenders();
    }
  }

  #atUsersFor(message) {
    const sender = senderStaffId(message);
    return String(message?.conversationType) === '2' && sender
        ? { atUserIds: [sender] }
        : undefined;
  }

  async #send(sessionWebhook, text, at) {
    const providerMessageIds = [];
    for (const chunk of splitDingtalkText(text, this.#maxMessageChars)) {
      this.#signal?.throwIfAborted();
      const result = await this.#api.sendText({
        clientId: this.#clientId,
        clientSecret: this.#clientSecret,
        sessionWebhook,
        text: chunk,
        at,
        signal: this.#signal,
      });
      providerMessageIds.push(...providerMessageIdsFor(result));
    }
    return providerMessageIds;
  }

  async #deliverArtifacts(target, sessionWebhook, replyTo, artifacts, baseReceipt) {
    const sendArtifact = async (method, file) => dingtalkFileProviderIds(
      await this.#api[method]({
        clientId: this.#clientId,
        clientSecret: this.#clientSecret,
        target,
        file,
        signal: this.#signal,
      }),
    );
    const delivery = await deliverOutboundArtifacts({
      artifacts,
      baseReceipt,
      deliveryId: replyTo,
      aggregatePresentation: baseReceipt ? 'dingtalk-text-and-files' : 'dingtalk-files',
      channelKey: 'dingtalk',
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
        sessionWebhook,
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
}

export const DingTalkHarnessBridge = DingtalkHarnessBridge;
export const createDingTalkBridgeStatus = createDingtalkBridgeStatus;
