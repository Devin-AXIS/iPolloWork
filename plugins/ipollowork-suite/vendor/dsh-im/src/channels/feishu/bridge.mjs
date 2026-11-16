import { captureGroupHistory } from '../shared/group-history.mjs';
import { BusyMessageDispatcher, canAutomaticallySteer } from '../shared/busy-message-dispatcher.mjs';
import { isPermissionCommand, runPermissionCommand } from '../shared/permission-command.mjs';
import { randomUUID } from 'node:crypto';
import { chunkMarkdownText } from '../shared/markdown-chunks.mjs';
import QRCode from '../shared/qrcode.mjs';
import { waitForFeishuOperation } from './feishu-channel.mjs';
import { startNewConversation, isNewCommand, newCommandTitle } from '../shared/new-command.mjs';
import {
  conversationKey,
  conversationScope,
  extractInboundMessage,
  extractText,
  isAllowedSender,
  isBotSender,
  isTopicKey,
  managedTopicKey,
  managedTopicRoot,
  splitText,
  stripLocalImageMarkdown,
} from './message-utils.mjs';
import {
  hasInboundImages,
  imagePromptDiagnostic,
  imagePromptUserMessage,
} from '../shared/image-prompt.mjs';
import {
  hasReplyReference,
  promptContentForInboundMessage,
} from '../shared/semantic/reply-reference.mjs';
import {
  hasInboundFiles,
  inboundFileUserMessage,
} from '../shared/inbound-file.mjs';
import {
  harnessAnswerForQuestion,
  harnessQuestionText,
  validHarnessQuestion,
} from '../shared/harness-question.mjs';
import { HarnessApprovalQueue } from '../shared/harness-approval.mjs';
import { AssistantTextAccumulator, textFromHarnessContent } from '../shared/harness-client.mjs';
import { registerSessionSyncMirror } from '../shared/session-sync-registry.mjs';
import { extractCompletedTurnAnswer } from '../shared/deferred-delivery.mjs';
import {
  BatchInputManager,
  batchInputBusyMessage,
  batchInputGroupUnsupportedMessage,
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
import { rememberConnectionTestTarget } from '../shared/connection-test.mjs';
import {
  isModelCommand,
  runModelCommand,
} from '../shared/model-command.mjs';
import {
  isPresetCommand,
  runPresetCommand,
} from '../shared/preset-command.mjs';
import {
  boundSessionIdFor,
  parseSessionListArgument,
  resolveSessionListWorkspace,
  runWorkspaceCommand,
  workspacePathSnapshot,
} from '../shared/workspace-command.mjs';
import { askInWorkspaceSession } from '../shared/workspace-session.mjs';
import {
  isSessionNavCommand,
  runSessionNavTextCommand,
} from '../shared/session-nav-command.mjs';
import { createDeferredDeliveryCoordinator, deferredOutcomeText } from '../shared/deferred-delivery-coordinator.mjs';
import {
  captureContextEnhancement,
  captureContextEnhancementSource,
  enhanceContextContent,
} from '../shared/context-enhancement.mjs';
import { deliverOutboundArtifacts } from '../shared/semantic/artifact-delivery.mjs';
import {
  createDeliveryReceipt,
  providerMessageIdsFor,
} from '../shared/semantic/delivery.mjs';
import {
  channelDeliveryFailure,
  clearLastMessageFailure,
  messageFailureDiagnostic,
  messageFailureText,
  setLastMessageFailure,
} from '../shared/message-failure.mjs';
import { beginStatusReaction } from '../shared/status-reaction.mjs';
import {
  COMMAND_PERMISSION_DENIED_MESSAGE,
  evaluateInboundAccess,
} from '../shared/inbound-access.mjs';
import { isSharedLocalCommand } from '../shared/command-permission.mjs';
import {
  MENU_PAGE_SIZE,
  PRESET_FOLLOW_DEFAULT_SENTINEL,
  REASONING_DEFAULT_SENTINEL,
  STEER_CUSTOM_SENTINEL,
  approvalCard,
  completionCard,
  customSteerCard,
  helpCard,
  menuCard,
  menuHelpText,
  modelCard,
  presetCard,
  answeredQuestionCard,
  questionCard,
  sessionListCard,
  splitStepStreamCardBlocks,
  statusCard,
  stepStreamCard,
  steerCard,
  watchListCard,
  workspaceListCard,
  stepStatusText,
} from './feishu-cards.mjs';
import { t } from '../shared/i18n.mjs';
import { MAX_WATCHES_PER_KEY } from './state-store.mjs';
import {
  FEISHU_GROUP_RESPONSE_MODES,
  normalizeFeishuGroupResponseMode,
} from './group-response-mode.mjs';
import {
  FEISHU_STEP_PUSH_MODES,
  normalizeFeishuStepPushMode,
  normalizeFeishuStepCardPanels,
} from './step-push-mode.mjs';
import { FeishuLiveCot } from './live-cot.mjs';

// Lazily evaluated: t() must run after setImHostLanguage, not at import time.
const INTERACTION_RESOLVED_TEXT = () => t('这个问题已在其他客户端处理，无需再次回答。');
const RESOLVED_REPLY_TTL_MS = 30 * 60_000;
/** Managed-topic root candidates expire without a returned thread_id. */
const ROOT_CANDIDATE_TTL_MS = 30 * 60_000;
/** Bound main-feed roots awaiting a topic so silent drops cannot grow them. */
const MAX_ROOT_CANDIDATES = 512;
const MAX_TOPIC_ANCHORS = 4_000;
/** Conversations remembered as auto-continued-round delivery targets (LRU). */
const MAX_CONVERSATION_ROUTES = 512;

const MENU_COMMAND = /^\/m(?:enu)?$/i;
const REPAIR_COMMAND_PREFIX = /^\/repair(?:\s|$)/i;
const REPAIR_COMMAND = /^\/repair(?:\s+(qr|status|cancel|verify))?\s*$/i;
const WATCH_COMMAND = /^\/watch(?:\s+([^\s]+))?$/i;
const UNWATCH_COMMAND = /^\/unwatch(?:\s+([^\s]+))?$/i;
const WATCHLIST_COMMAND = /^\/watchlist$/i;
const SESSION_LIST_PREFIX = /^\/(?:sessionlist|sessions)(?:\s|$)/i;
const WORKSPACE_LIST_COMMAND = /^\/(?:workspacelist|workspaces|wsl)(?:\s+all)?$/i;
// After the merge a bare /workspace or /ws opens the same picker card.
const BARE_WORKSPACE_COMMAND = /^\/(?:workspace|ws)$/i;
const NUMBER_REPLY = /^\d{1,2}$/;
/** A displayed menu stays number-tappable for this long. */
const MENU_TTL_MS = 10 * 60_000;
const MAX_TRACKED_MENUS = 50;
/** Bound callback work per conversation so retries cannot exhaust Host RPCs. */
const MAX_PENDING_CARD_ACTIONS_PER_KEY = 8;
/** Bound actual stop/steer submissions independently from ordinary card UI work. */
const MAX_PENDING_CARD_CONTROLS_PER_KEY = 8;
/** Provider retries may arrive after the original callback has already settled. */
const CARD_ACTION_DEDUPE_TTL_MS = 10 * 60_000;
const MAX_COMPLETED_CARD_ACTIONS = 400;
/** Keep pre-persistence completion arrivals long enough for a new watch to baseline. */
const COMPLETION_OBSERVATION_TTL_MS = 10 * 60_000;
const MAX_OBSERVED_COMPLETION_SESSIONS = 100;
const MAX_OBSERVED_COMPLETIONS_PER_SESSION = 50;
const MAX_OBSERVED_COMPLETIONS = 500;
/** Collapse callback-flood notices instead of amplifying overload into more API calls. */
const CARD_OVERLOAD_NOTICE_COOLDOWN_MS = 5_000;
/** Cards should degrade promptly when one optional Host data source is slow. */
const CARD_DATA_TIMEOUT_MS = 5_000;
const REPAIR_LINK_WAIT_MS = 15_000;
const REPAIR_POLL_INTERVAL_MS = 1_000;
const REPAIR_AUTHORIZATION_STATES = new Set([
  'starting', 'qr_ready', 'polling', 'slow_down', 'domain_switched',
]);
const REPAIR_ACTIVE_STATES = new Set([...REPAIR_AUTHORIZATION_STATES, 'saving']);
const REPAIR_TERMINAL_STATES = new Set([
  'succeeded', 'expired', 'cancelled', 'error',
]);
const REPAIR_URL_HOSTS = new Set([
  'accounts.feishu.cn',
  'open.feishu.cn',
  'accounts.larksuite.com',
  'open.larksuite.com',
]);

const ARCHIVED_COMMAND = /^\/archived(?:\s+(on|off))?$/i;
/** Matches fast card commands that should not be queued behind a running task. */
const CARD_COMMAND = /^\/(?:m(?:enu)?|new|help|status|compact|clear|(?:sessionlist|sessions)(?:\s|$)|workspacelist|workspaces|wsl|watchlist|archived(?:\s+(on|off))?)$/i;

// ── Step push (分步直推) limits ──────────────────────────────────────────────
/** Feishu allows 5 msg/s per chat; step push stays well below that. */
const STEP_PUSH_MIN_INTERVAL_MS = 250;
/** One turn never pushes more step messages than this (熔断阈值). */
const STEP_PUSH_MAX_MESSAGES_PER_TURN = 200;
/** Excerpt bounds for step push message rendering. */
const STEP_PUSH_SUMMARY_MAX_CHARS = 120;
const STEP_PUSH_ARGUMENTS_MAX_CHARS = 400;
const STEP_PUSH_ERROR_MAX_CHARS = 200;
/** Silence threshold before the thinking status heartbeat appears. */
const STEP_PUSH_HEARTBEAT_AFTER_MS = 20_000;
/** The thinking heartbeat refreshes its elapsed time at this cadence. */
const STEP_PUSH_HEARTBEAT_REFRESH_MS = 30_000;
/** One turn never refreshes the thinking heartbeat more than this. */
const STEP_PUSH_HEARTBEAT_MAX_UPDATES = 30;
/** One pending heartbeat id is retried at most this many times across
 *  recall boundaries before it is abandoned (with a warning). */
const STEP_PUSH_HEARTBEAT_RECALL_ATTEMPTS = 3;
/** One post message carries at most this many UTF-8 bytes after its rich-text
 *  content has been JSON encoded (Feishu caps rich-text requests at 30KB). */
const STEP_PUSH_POST_CHUNK_MAX_BYTES = 24_000;
/** Streaming-card mode coalesces card renders behind one PATCH per interval —
 *  patching the same message is far more rate sensitive than posting. */
const STEP_STREAM_PATCH_MIN_INTERVAL_MS = 1_000;
/** Confirm missed boundaries from history; elapsed time is never completion. */
const MIRROR_CHECK_MS = 30_000;
/** Retire orphan snapshots outside Feishu's message update window. */
const MIRROR_STALE_MS = 14 * 24 * 60 * 60_000;
const MIRROR_RECOVERY_MAX_FAILURES = 20;

/**
 * The one-line label an auto-continued round shows in the conversation. The
 * Harness goal driver feeds the round a `<goal_round>` prompt that must never
 * reach the chat, so both the goal-round card and the session-sync mirror
 * announce the round by number instead of echoing that text.
 */
function goalRoundLabel(round) {
  return Number.isSafeInteger(round) && round > 0
    ? t('🔄 目标自动续跑（第 {round} 轮）', { round })
    : t('🔄 目标自动续跑');
}

function mirrorErrorText(error) {
  return [error?.response?.data?.msg, error?.msg, error?.message]
    .filter((value) => typeof value === 'string' && value.trim()).join('; ') || String(error);
}

function isExpiredMirrorError(error) {
  return /Message has expired when updating message|Message can only be updated within fourteen days/i
    .test(mirrorErrorText(error));
}
/** One answer chunk inside the streaming card: small enough that the block
 *  splitter can always distribute blocks across sealed/live cards. */
const STEP_STREAM_ANSWER_CHUNK_MAX_BYTES = 18_000;
/** Panels (tool summary / thinking) shed their oldest lines past this budget
 *  so a single panel can never outgrow the card on its own. */
const STEP_STREAM_PANEL_MAX_BYTES = 12_000;
/** One thinking note is excerpted to this many characters inside its panel. */
const STEP_STREAM_NOTE_MAX_CHARS = 500;

/** Split independently rendered posts with the shared structure-aware splitter.
 * Budget the serialized payload, including reopened fences and JSON escapes.
 * Retry from the original source when lowering the character bound so that
 * generated fences are never mistaken for source content on a second split. */
function splitStepPostMarkdown(text, limit = STEP_PUSH_POST_CHUNK_MAX_BYTES) {
  const source = String(text ?? '');
  const encodedBytes = (markdown) => Buffer.byteLength(JSON.stringify({
    zh_cn: { content: [[{ tag: 'md', text: markdown }]] },
  }), 'utf8');
  if (encodedBytes(source) <= limit) return [source];
  const overhead = encodedBytes('');
  let bound = limit - overhead;
  while (bound > 0) {
    const chunks = chunkMarkdownText(source, bound);
    const largest = chunks.reduce((size, chunk) => Math.max(size, encodedBytes(chunk)), 0);
    if (largest <= limit) return chunks;
    bound = Math.min(bound - 1, Math.floor(bound * (limit - overhead) / (largest - overhead)));
  }
  throw new RangeError('Feishu step push post byte limit is too small');
}
/** Salient tool-argument fields for the intent summary, in priority order. */
const STEP_PUSH_INTENT_FIELDS = [
  'command', 'file_path', 'path', 'query', 'url', 'pattern', 'prompt', 'cmd',
];
/** Bounds the per-conversation step push send-state cache. */
const MAX_STEP_PUSH_SEND_STATES = 512;
/** Real clock used by step push throttling; tests inject a fake one. */
const DEFAULT_STEP_PUSH_CLOCK = Object.freeze({
  now: () => Date.now(),
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});

/** Pretty-print a tool call's arguments for an approval card. */
function operationArguments(toolCall) {
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

/** Strip control characters so the approval card text stays clean. */
function printableText(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

function isFeishuLocalCommand(text, { hasImages = false, hasFiles = false } = {}) {
  if (isPermissionCommand(text)) return true;
  if (hasImages || hasFiles || typeof text !== 'string') return false;
  const command = text.trim();
  return MENU_COMMAND.test(command)
    || REPAIR_COMMAND_PREFIX.test(command)
    || WATCH_COMMAND.test(command)
    || UNWATCH_COMMAND.test(command)
    || WATCHLIST_COMMAND.test(command)
    || ARCHIVED_COMMAND.test(command);
}

/**
 * A p2p text message that is nothing but a mention of the bot.
 *
 * The mention is stripped before we see the text, so `@bot` arrives as an empty
 * body — indistinguishable from an empty message unless the message type is
 * checked. Deliberately narrow:
 *
 *   - only `p2p`, where the reader is talking to the bot directly;
 *   - only `text`, so a voice note, video, sticker or forwarded card keeps its
 *     own "not supported" notice instead of silently opening a menu;
 *   - only when nothing else came with it, so `@bot 你好` stays a prompt.
 *
 * The caller also treats this as a command for access control, because opening
 * the menu is `/m` by another route and carries the same information.
 */
function isBareMentionMenuRequest(event, text, {
  hasImages = false,
  hasFiles = false,
  hasReply = false,
} = {}) {
  if (event?.message?.chat_type !== 'p2p') return false;
  if (event?.message?.message_type !== 'text') return false;
  if (hasImages || hasFiles || hasReply) return false;
  return !String(text ?? '').trim();
}

/**
 * A message that is nothing but a mention of the bot, with no body of its own.
 * There is no question to answer — a direct chat opens the menu card for it and
 * a group gets the "text, image and file only" notice — so it must not open a
 * topic either: an empty topic would leave an empty session behind, and every
 * look at the menu would create another one.
 *
 * Mirrors the reply-reference test (`feishuReplyTargetId`): an explicit quote
 * keeps the message a real question even when the mention is all the text it
 * carries.
 */
function isBareMentionMessage(event) {
  if (event?.message?.message_type !== 'text') return false;
  const messageId = nonEmptyString(event?.message?.message_id);
  const parentId = nonEmptyString(event?.message?.parent_id);
  const rootId = nonEmptyString(event?.message?.root_id);
  if (parentId || (rootId && rootId !== messageId)) return false;
  return !String(extractText(event) ?? '').trim();
}

/** Canonical workspace/session help advertised by every bridge family. */
const WORKSPACE_HELP_LINES = [
  '/workspace 工作区序号或绝对路径  切换工作区',
  '/session Session ID、当前工作区序号或标题关键词  将当前聊天绑定到指定会话',
  '/workspacelist  列出工作区绝对路径',
  '/sessionlist 或 /sessions [工作区序号或绝对路径]  列出会话 ID 和标题',
  '/sessionlist --all  跨工作区汇总会话（每个工作区默认显示 10 个，可用 --limit N 调整）',
  '/sessionlist --limit N  仅列出当前工作区前 N 个会话',
];

/** Safe user-facing text for bind/workspace failures (no raw messages). */
function safeErrorText(error) {
  switch (error?.code) {
    case 'workspace-not-absolute':
      return t('工作区必须是绝对路径。');
    case 'workspace-not-found':
      return t('工作区路径不存在。');
    case 'workspace-not-directory':
      return t('工作区路径必须指向一个目录。');
    case 'workspace-bot-not-found':
      return t('机器人正在移除或已重新接入，无法操作原会话的工作区。');
    default:
      return t('操作失败，请稍后重试。');
  }
}

function artifactFailureText(fileName, error) {
  const name = String(fileName ?? t('结果文件')).replace(/[\r\n]+/g, ' ').trim() || t('结果文件');
  switch (error?.code) {
    case 'artifact-permission-required':
      return t('结果文件「{name}」已生成，但机器人缺少飞书文件上传权限 im:resource。请私聊机器人执行 /repair 命令，或者在「IM机器人」设置页点击“补全权限”按钮并扫码。完成飞书要求的发布审批后重试。', { name });
    case 'artifact-too-large':
      return t('结果文件「{name}」超过飞书 30 MB 上限，未发送。', { name });
    case 'artifact-empty':
      return t('结果文件「{name}」为空，飞书不允许发送空文件。', { name });
    case 'artifact-changed':
    case 'artifact-invalid':
    case 'artifact-unavailable':
      return t('结果文件「{name}」暂时无法读取或准备发送，请确认文件仍可访问后重试。', { name });
    case 'artifact-rate-limited':
      return t('结果文件「{name}」暂时被飞书限流，未能发送，请稍后重试。', { name });
    case 'artifact-delivery-uncertain':
      return t('结果文件「{name}」发送结果未能确认，请先检查聊天内是否已收到，不要立即重试。', { name });
    default:
      return t('结果文件「{name}」已生成，但暂时未能发送，请稍后重试。', { name });
  }
}

function answerTextForDelivery(answer, artifacts) {
  if (typeof answer === 'string' && answer.trim()) return answer;
  return artifacts.length > 0 ? t('结果文件已生成。') : answer;
}

/** Collapse a step push excerpt into one tidy line. */
function stepPushLine(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim();
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Accept SDK payload fields that may already be objects or JSON strings. */
function callbackObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Normalize a single-select value without corrupting valid commas in an id/path. */
function callbackSingleOption(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const selected = callbackSingleOption(entry);
      if (selected !== null) return selected;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    if ('value' in value) return callbackSingleOption(value.value);
    if ('option' in value) return callbackSingleOption(value.option);
    return null;
  }
  if (typeof value !== 'string') return null;
  const source = value.trim();
  if (!source) return null;
  if (source.startsWith('[') || source.startsWith('{') || source.startsWith('"')) {
    try {
      const parsed = JSON.parse(source);
      if (parsed !== value) return callbackSingleOption(parsed);
    } catch { /* plain value below */ }
  }
  return source;
}

/** Normalize multi-select values across current and legacy SDK shapes. */
function callbackMultiOptionValues(value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap((entry) => callbackMultiOptionValues(entry));
  if (value && typeof value === 'object') {
    if ('value' in value) return callbackMultiOptionValues(value.value);
    if ('option' in value) return callbackMultiOptionValues(value.option);
    return [];
  }
  if (typeof value !== 'string') return [];
  const source = value.trim();
  if (!source) return [];
  if (source.startsWith('[') || source.startsWith('{') || source.startsWith('"')) {
    try {
      const parsed = JSON.parse(source);
      if (parsed !== value) return callbackMultiOptionValues(parsed);
    } catch { /* plain value below */ }
  }
  return source.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function validLastSeq(value) {
  return Number.isSafeInteger(value) && value >= -1;
}

function validEventSeq(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function watchBoundary(entry) {
  return Number.isSafeInteger(entry?.watchStartedAt) && entry.watchStartedAt >= 0
    ? entry.watchStartedAt
    : null;
}

function watchNeedsBaseline(entry) {
  return entry && (watchBoundary(entry) !== null || !validLastSeq(entry.lastSeq));
}

function orderedHistoryEvents(history) {
  return (Array.isArray(history?.events) ? history.events : [])
    .map((entry) => entry?.event ?? entry)
    .filter((entry) => entry && typeof entry === 'object' && validEventSeq(entry.seq))
    .sort((left, right) => left.seq - right.seq);
}

function senderOpenId(event) {
  return nonEmptyString(event?.sender?.sender_id?.open_id)
    ?? nonEmptyString(event?.sender?.sender_id?.user_id);
}

function strictSenderOpenId(event) {
  return nonEmptyString(event?.sender?.sender_id?.open_id);
}

function abortableDelay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(done, milliseconds);
    timer.unref?.();
    function done() {
      signal?.removeEventListener('abort', aborted);
      resolve();
    }
    function aborted() {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    }
    signal?.addEventListener('abort', aborted, { once: true });
  });
}

function repairSnapshot(value, { botId } = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const registration = source.registration && typeof source.registration === 'object'
    ? source.registration
    : source;
  const operation = nonEmptyString(registration.operation) ?? nonEmptyString(source.operation);
  if (operation && operation !== 'callback_repair') {
    throw new Error('The active Feishu operation is not a callback repair');
  }
  const selectedBotId = nonEmptyString(registration.botId) ?? nonEmptyString(source.botId);
  if (botId && selectedBotId && selectedBotId !== botId) {
    throw new Error('The Feishu repair belongs to another bot');
  }
  const state = nonEmptyString(registration.state);
  const attempt = registration.attemptId ?? registration.attempt;
  const attemptId = typeof attempt === 'string' || Number.isFinite(attempt)
    ? String(attempt)
    : null;
  if (!state || !attemptId) throw new Error('Feishu returned an invalid repair status');
  const verificationUrl = nonEmptyString(registration.verificationUrl)
    ?? nonEmptyString(registration.qrCodeUrl);
  const expiresAt = Number(registration.expiresAt);
  const remainingSeconds = Number(registration.remainingSeconds);
  const pollIntervalMs = Number(registration.pollIntervalMs)
    || (Number(registration.pollIntervalSeconds) * 1000);
  return {
    state,
    attemptId,
    botId: selectedBotId,
    verificationUrl,
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : null,
    remainingSeconds: Number.isFinite(remainingSeconds) ? remainingSeconds : null,
    pollIntervalMs: Number.isFinite(pollIntervalMs) && pollIntervalMs > 0
      ? pollIntervalMs
      : null,
    error: registration.error && typeof registration.error === 'object'
      ? { code: nonEmptyString(registration.error.code), message: nonEmptyString(registration.error.message) }
      : null,
  };
}

function safeRepairUrl(rawUrl, expectedAppId) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || !REPAIR_URL_HOSTS.has(url.hostname)) {
    throw new Error('Feishu returned an untrusted repair URL');
  }
  if (url.searchParams.get('tp') !== 'sdk'
    || url.searchParams.get('clientID') !== expectedAppId
    || url.searchParams.has('createOnly')) {
    throw new Error('Feishu returned an invalid existing-app repair URL');
  }
  if (url.toString().includes('{{client_id}}') || url.toString().includes('%7B%7Bclient_id%7D%7D')) {
    throw new Error('Feishu returned an unresolved client id placeholder');
  }
  return url.toString();
}

function canClaimInteractionReply(event, pending) {
  return pending.needsPresentation !== true
    && pending.questions[pending.index]
    && senderOpenId(event) === pending.actor
    && event?.message?.message_type === 'text'
    && nonEmptyString(extractText(event));
}

function ensureStatus(status) {
  for (const key of ['messagesReceived', 'messagesReplied', 'messagesRejected']) {
    status[key] ??= 0;
  }
  status.lastMessageAt ??= null;
  status.lastReplyAt ??= null;
  status.lastRejectedAt ??= null;
  status.lastError ??= null;
  status.lastMessageError ??= null;
}

export class FeishuHarnessBridge {
  #client;
  #channel;
  #harness;
  #state;
  #contextEnhancement;
  #groupHistory;
  #groupHistoryScope;
  #accessPolicy;
  #queues = new Map();
  #busyMessages = new BusyMessageDispatcher();
  #batchInputs = new BatchInputManager();
  #pendingInteractions = new Map();
  #interactionKeys = new Map();
  #resolvedQuestionReplies = new Map();
  // issue #162：已提交答案的 interactionId → 过期时间（TTL-only，惰性清理，
  // 与 #resolvedQuestionReplies 同风格）。陈旧点击据此给出「已回答」提示。
  #answeredInteractionIds = new Map();
  // Keep the accepted configuration through the existing queue/reply lifecycle.
  #acceptedMessageIds = new Map();
  #interactionTasks = new Set();
  #commandTasks = new Set();
  /** All accepted card work, including tasks waiting behind an earlier click. */
  #cardActionTasks = new Set();
  /** Per-conversation navigation/configuration serialization tails. */
  #cardActionTails = new Map();
  /** Per-conversation serialization for actual stop/steer side effects. */
  #cardControlTails = new Map();
  /** Pending callback count per conversation, used for bounded backpressure. */
  #cardActionCounts = new Map();
  /** Pending control count per conversation, isolated from ordinary UI work. */
  #cardControlCounts = new Map();
  /** Same callback retry joins the original task instead of repeating side effects. */
  #cardActionInFlight = new Map();
  /** Stop is idempotent per conversation; coalesce floods while one stop is pending. */
  #cardStopInFlight = new Map();
  /** Stable ids coalesced into a stop move to the completed cache when it settles. */
  #cardStopFollowers = new Map();
  /** Settled provider event ids stay deduplicated for a bounded retry window. */
  #completedCardActions = new Map();
  /** Last overload notice time per conversation. */
  #cardOverloadNoticeAt = new Map();
  #approvals;
  #status;
  #allowedSenderOpenIds;
  #replyTimeoutMs;
  #logger;
  #signal;
  #botId;
  /** Optional voice capability (语音输入/语音回复); null disables all voice paths. */
  #voice = null;
  /**
   * Pending voice turns: session key → { replyTo }, consumed when the full
   * answer lands. Keyed by the same session key as the message queue so
   * concurrent topics of one group chat never share a voice slot.
   */
  #voiceTurns = new Map();
  #appId;
  #botOpenId;
  #groupResponseMode;
  /**
   * When true (the default), a question addressed to the bot opens a Feishu
   * topic of its own — in groups and in direct chats alike — and the answer
   * stays inside it. Turning it off keeps every question in the chat's main
   * session and answers it in the main feed.
   */
  #mentionTopicReply = true;
  /** When true, streaming turns push tool calls and interim notes as discrete messages. */
  #stepPush = false;
  /** Step push presentation: discrete posts, a CardKit card, or native live CoT. */
  #stepPushMode = FEISHU_STEP_PUSH_MODES.POST;
  #stepCardPanels;
  /** Per-conversation step push state: key → { lastSentAt, count, breakerLogged }. */
  #stepPushSendState = new Map();
  /** Live streaming step cards: key → per-turn card state (streaming_card mode). */
  #stepCards = new Map();
  /** In-flight turn stop markers: key → { requested } for 已停止 sealing. */
  #stepStopFlags = new Map();
  /** Injectable clock for step push throttling (tests pass a fake one). */
  #stepPushClock;
  /** Group chats this bot has seen; only these may use topic replies. */
  #groupChatIds = new Set();
  /** Anchor message id → whether its replies should stay in a Feishu topic. */
  #anchorTopicReply = new Map();
  /** Main-feed roots this bot intends to auto-open as topics, awaiting thread_id. */
  #rootCandidates = new Map();
  /** Last successfully injected topic root per conversation and AI session. */
  #topicAnchors = new Map();
  #repair;
  #repairAttempt = null;
  #repairMonitorVersion = 0;
  #repairPollIntervalMs;
  #repairLinkWaitMs;
  /** Number-tappable menus: conversation key → menu state. */
  #menus = new Map();
  /** Interactive-card message id → route context for button callbacks. */
  #cardKeys = new Map();
  /** The global event-mux watcher (one per bridge). */
  #eventWatcher = null;
  #deferred;
  /** Serializes completion work per session without blocking unrelated sessions. */
  #eventTails = new Map();
  /** Coalesces baseline compensation and records whether a trailing pass is needed. */
  #pendingCompensations = new Map();
  /** Bounded live arrivals bridge target-list, persistence, and history-projection races. */
  #observedCompletionEvents = new Map();
  /** Earliest completion that still needs delivery for each watch. */
  #failedWatchSeqs = new Map();
  /** Host resolver: sessionId -> synced DM targets [{ openId, botId }]. */
  #sessionSyncTargetsFor = null;
  /** Per-turn mirrors and recent delivery receipts, scoped to this bot. */
  #sessionSyncTurns = new Map();
  #sessionSyncCurrentTurns = new Map();
  #sessionSyncIdleTimers = new Map();
  /** Conversation keys with an IM ask in flight (set BEFORE the turn starts). */
  #imTurnKeys = new Set();
  /** Where each conversation posts: { chatId, replyToMessageId } (last inbound). */
  #conversationRoutes = new Map();
  /** Goal rounds currently rendering into a bound conversation, by key. */
  #goalRounds = new Map();
  // A goal round's user/message carries `source.kind === 'goal'` but no
  // `data.turn`; the turn/start right before it does. Keep the latest start
  // so the round can still be identified without inventing a turn.
  #goalTurnStarts = new Map();
  #cardDataTimeoutMs;
  #requestTimeoutMs;
  /** When true, approval/question interactions render as Feishu cards (buttons). */
  #interactionCards = true;
  #nativeMenuReady;

  constructor({
    client,
    channel,
    harness,
    state,
    contextEnhancement,
    groupHistory,
    groupHistoryScope = 'feishu',
    accessPolicy,
    status,
    allowedSenderOpenIds = new Set(),
    botId,
    appId,
    botOpenId,
    groupResponseMode = FEISHU_GROUP_RESPONSE_MODES.ALL,
    mentionTopicReply = true,
    stepPush = false,
    stepPushMode = FEISHU_STEP_PUSH_MODES.POST,
    stepCardPanels,
    stepPushClock = null,
    repair,
    repairPollIntervalMs = REPAIR_POLL_INTERVAL_MS,
    repairLinkWaitMs = REPAIR_LINK_WAIT_MS,
    cardDataTimeoutMs = CARD_DATA_TIMEOUT_MS,
    requestTimeoutMs = 15_000,
    replyTimeoutMs = 600_000,
    interactionCards = true,
    nativeMenuReady = () => false,
    sessionSyncTargetsFor = null,
    logger = console,
    voice = null,
    signal,
  }) {
    if (!client || !harness || !state || !status) {
      throw new TypeError('Feishu bridge dependencies are required');
    }
    if (repair !== undefined && repair !== null) {
      if (!repair || typeof repair.start !== 'function'
        || typeof repair.status !== 'function'
        || typeof repair.cancel !== 'function') {
        throw new TypeError('Feishu repair capability requires start/status/cancel');
      }
      if (!nonEmptyString(botId) || !nonEmptyString(appId)) {
        throw new TypeError('Feishu repair capability requires botId and appId');
      }
    }
    if (!Number.isFinite(repairPollIntervalMs) || repairPollIntervalMs <= 0
      || !Number.isFinite(repairLinkWaitMs) || repairLinkWaitMs <= 0
      || !Number.isFinite(cardDataTimeoutMs) || cardDataTimeoutMs <= 0
      || !Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
      throw new TypeError('Feishu timing values must be positive numbers');
    }
    if (stepPushClock !== null
      && (typeof stepPushClock !== 'object' || Array.isArray(stepPushClock)
        || typeof stepPushClock.now !== 'function'
        || typeof stepPushClock.delay !== 'function')) {
      throw new TypeError('Feishu step push clock requires now and delay functions');
    }
    if (voice !== null && voice !== undefined
      && (typeof voice !== 'object' || Array.isArray(voice)
        || (voice.enabled !== false
          && (typeof voice.transcribeIncoming !== 'function'
            || typeof voice.synthesize !== 'function')))) {
      throw new TypeError('Feishu voice capability requires transcribeIncoming and synthesize functions');
    }
    this.#client = client;
    this.#nativeMenuReady = nativeMenuReady;
    this.#channel = channel;
    this.#harness = harness;
    this.#state = state;
    this.#contextEnhancement = contextEnhancement;
    this.#groupHistory = groupHistory;
    this.#groupHistoryScope = groupHistoryScope;
    this.#accessPolicy = accessPolicy;
    this.#status = status;
    this.#allowedSenderOpenIds = allowedSenderOpenIds;
    this.#botId = nonEmptyString(botId);
    this.#appId = nonEmptyString(appId);
    this.#botOpenId = nonEmptyString(botOpenId);
    this.#groupResponseMode = normalizeFeishuGroupResponseMode(groupResponseMode);
    this.#mentionTopicReply = mentionTopicReply !== false;
    this.#stepPush = stepPush === true;
    this.#stepPushMode = normalizeFeishuStepPushMode(stepPushMode);
    this.#stepCardPanels = normalizeFeishuStepCardPanels(stepCardPanels);
    this.#stepPushClock = stepPushClock ?? DEFAULT_STEP_PUSH_CLOCK;
    this.#voice = voice ?? null;
    this.#repair = repair ?? null;
    this.#repairPollIntervalMs = repairPollIntervalMs;
    this.#repairLinkWaitMs = repairLinkWaitMs;
    this.#cardDataTimeoutMs = cardDataTimeoutMs;
    this.#requestTimeoutMs = requestTimeoutMs;
    this.#replyTimeoutMs = replyTimeoutMs;
    this.#interactionCards = interactionCards === true;
    this.#sessionSyncTargetsFor = typeof sessionSyncTargetsFor === 'function'
      ? sessionSyncTargetsFor
      : null;
    this.#logger = logger;
    this.#approvals = new HarnessApprovalQueue({ label: 'Feishu', logger });
    this.#signal = signal;
    ensureStatus(this.#status);
    this.#deferred = createDeferredDeliveryCoordinator({
      harness, state, signal, logger, watch: false,
      deliver: (entry, outcome) => this.#deliverDeferredOutcome(entry, outcome),
    });
    if (this.#sessionSyncTargetsFor && this.#botId && !this.#signal?.aborted) {
      const unregister = registerSessionSyncMirror({ channel: 'feishu', botId: this.#botId },
        (request) => this.#deliverSessionSyncMirror(request));
      this.#signal?.addEventListener('abort', () => {
        unregister();
        for (const timer of this.#sessionSyncIdleTimers.values()) clearTimeout(timer);
        this.#sessionSyncIdleTimers.clear();
      }, { once: true });
    }
    // Persisted watches and mirrors resume without waiting for an IM message.
    if (typeof this.#harness?.watchHarnessEvents === 'function') {
      queueMicrotask(() => {
        this.#ensureEventWatcher();
        void this.#sealOrphanMirrors();
      });
    }
  }

  /** Recover only a known finished turn, using its last successful card JSON. */
  async #sealOrphanMirrors(onlyKey = null) {
    for (const [key, queuedEntry] of this.#state.mirrorEntries?.() ?? []) {
      if (onlyKey !== null && key !== onlyKey) continue;
      if (!queuedEntry?.sessionId) continue;
      await this.#queueEventTask(queuedEntry.sessionId, async () => {
        if (this.#signal?.aborted) return;
        // An adopted turn now owns this record and will finish through its queue.
        if (this.#sessionSyncTurns.has(key)) return;
        // A queued timer must not resurrect a deleted record or overwrite a
        // newer snapshot/failure count with the entry captured before queuing.
        let entry = this.#state.mirrorEntries?.().find(([entryKey]) => entryKey === key)?.[1];
        if (!entry?.chatId || !entry.sessionId || !Number.isSafeInteger(entry.turn)
          || !Array.isArray(entry.cardIds) || !entry.cardIds.length) return;
        const now = Date.now();
        if (!Number.isFinite(entry.claimedAt) || entry.claimedAt <= 0 || entry.claimedAt > now) {
          entry = { ...entry, claimedAt: now };
          await this.#state.setMirror?.(key, entry);
        }
        if (now - entry.claimedAt >= MIRROR_STALE_MS) {
          await this.#clearMirrorRecovery(key, 'snapshot expired');
          return;
        }
        const failures = Number.isSafeInteger(entry.recoveryFailures) && entry.recoveryFailures > 0
          ? entry.recoveryFailures : 0;
        if (failures >= MIRROR_RECOVERY_MAX_FAILURES) {
          await this.#clearMirrorRecovery(key, 'recovery failure limit reached');
          return;
        }
        try {
          const events = await this.#mirrorHistory(entry.sessionId, entry.turn);
          if (this.#signal?.aborted) return;
          const outcome = extractCompletedTurnAnswer(events, { turn: entry.turn });
          if (outcome.endSeq < 0) {
            this.#scheduleMirrorCheck(`recovery\0${key}`, () => this.#sealOrphanMirrors(key));
            return;
          }
          if (this.#restoreMirrorCard(key, entry)) {
            const result = await this.#finishStepCard(key, {
              answerText: outcome.text, stopped: outcome.reason !== 'completed',
            });
            if (!result?.ok) throw result?.error ?? new Error('Recovered mirror could not deliver its final answer');
            await this.#clearMirrorRecovery(key);
            return;
          }
          const content = JSON.parse(entry.lastContent);
          const elements = content?.body?.elements;
          if (!Array.isArray(elements)) return;
          const last = elements.at(-1);
          const status = `_${stepStatusText(outcome.reason === 'completed' ? 'completed' : 'stopped')}_`;
          if (last?.tag === 'markdown' && /^_.*_$/s.test(last.content ?? '')) last.content = status;
          else elements.push({ tag: 'markdown', content: status });
          // Earlier chunks are sealed history; update only the live card.
          await this.#patchStepCard(entry.cardIds.at(-1), JSON.stringify(content));
          await this.#clearMirrorRecovery(key);
        } catch (error) {
          if (this.#signal?.aborted) return;
          const current = this.#state.mirrorEntries?.().find(([entryKey]) => entryKey === key)?.[1];
          if (!current) return;
          if (isExpiredMirrorError(error)) {
            await this.#clearMirrorRecovery(key, 'message expired');
            return;
          }
          await this.#state.setMirror?.(key, { ...current, recoveryFailures: failures + 1 });
          if (failures + 1 >= MIRROR_RECOVERY_MAX_FAILURES) {
            await this.#clearMirrorRecovery(key, 'recovery failure limit reached');
            return;
          }
          this.#logger.warn?.('[dsh-feishu] mirror recovery failed:', mirrorErrorText(error),
            { sessionId: entry.sessionId, turn: entry.turn, recoveryFailures: failures + 1 });
          this.#scheduleMirrorCheck(`recovery\0${key}`, () => this.#sealOrphanMirrors(key));
        }
      });
    }
  }

  async #clearMirrorRecovery(key, reason = null) {
    const timerKey = `recovery\0${key}`;
    clearTimeout(this.#sessionSyncIdleTimers.get(timerKey));
    this.#sessionSyncIdleTimers.delete(timerKey);
    const entry = this.#state.mirrorEntries?.().find(([entryKey]) => entryKey === key)?.[1];
    await this.#state.clearMirror?.(key);
    if (reason && entry) {
      this.#logger.warn?.('[dsh-feishu] mirror recovery stopped:', reason,
        { sessionId: entry.sessionId, turn: entry.turn, recoveryFailures: entry.recoveryFailures ?? 0 });
    }
  }

  setGroupResponseMode(value) {
    this.#groupResponseMode = normalizeFeishuGroupResponseMode(value);
  }

  setMentionTopicReply(value) {
    this.#mentionTopicReply = value !== false;
  }

  setStepPush(value) {
    this.#stepPush = value === true;
  }

  setStepPushMode(value) {
    this.#stepPushMode = normalizeFeishuStepPushMode(value);
  }

  setStepCardPanels(value) {
    this.#stepCardPanels = normalizeFeishuStepCardPanels(value);
  }

  setVoice(voice) {
    this.#voice = voice ?? null;
  }

  get stepPushMode() {
    return this.#stepPushMode;
  }

  #isAddressed(event) {
    if (event?.message?.chat_type === 'p2p') return true;
    return this.#isMentioned(event);
  }

  /**
   * Whether this message mentions the bot. Unlike #isAddressed — which answers
   * "does this chat expect a reply at all" and is therefore always true in a
   * direct chat — this asks the literal question, so a topic is only opened for
   * a message the reader actually addressed to the bot.
   */
  #isMentioned(event) {
    const mentions = Array.isArray(event?.message?.mentions) ? event.message.mentions : [];
    if (!this.#botOpenId) return mentions.length > 0;
    return mentions.some((mention) => mention?.id?.open_id === this.#botOpenId
      || mention?.open_id === this.#botOpenId);
  }

  /**
   * Conversation key for one inbound event, for groups and direct chats alike.
   *
   * - A message inside a topic resolves back to the managed key when the bot
   *   rooted that topic, so the whole topic keeps one session; every other
   *   thread keeps the key the channel would have used without managed topics.
   * - A main-feed message that mentions the bot opens a fresh managed topic
   *   session instead of joining the chat's shared session. A bare "@bot" is
   *   excluded: it is a menu request, not a question.
   * - Everything else stays in the chat's shared session.
   */
  #resolveKey(event) {
    const messageId = nonEmptyString(event?.message?.message_id);
    const threadId = nonEmptyString(event?.message?.thread_id);
    if (threadId) {
      const root = this.#state?.topicRootFor?.(threadId) ?? null;
      if (root) return managedTopicKey(conversationScope(event), root.rootMessageId);
      return conversationKey(event);
    }
    if (this.#mentionTopicReply
      && messageId
      && this.#isMentioned(event)
      && !isBareMentionMessage(event)) {
      return managedTopicKey(conversationScope(event), messageId);
    }
    return conversationKey(event);
  }

  /**
   * Record whether replies anchored on `messageId` should stay in a topic.
   * `asRoot` marks a main-feed question this bot will auto-open as a topic.
   * The flag is keyed on the conversation shape alone: once a conversation is
   * happening inside a topic, its replies belong to that topic whether the
   * bot auto-opens topics (群话题回复) or the user maintains them manually.
   */
  #rememberTopicReply(messageId, key) {
    if (!nonEmptyString(messageId)) return;
    this.#anchorTopicReply.set(messageId, isTopicKey(key));
    if (this.#anchorTopicReply.size > 2048) {
      const oldest = this.#anchorTopicReply.keys().next().value;
      if (oldest !== undefined) this.#anchorTopicReply.delete(oldest);
    }
    if (typeof key === 'string' && key.startsWith('group:')) {
      const chatId = key.split(':')[1];
      if (chatId) this.#groupChatIds.add(chatId);
    }
  }

  /** Whether a reply anchored on `replyTo` must ask Feishu to keep it in a topic. */
  #replyInThreadFor(replyTo) {
    // Topic membership is decided by the conversation shape alone (see
    // #rememberTopicReply): a manual-topic chat threads its replies even
    // when the 群话题回复 switch is off.
    return nonEmptyString(replyTo)
      && this.#anchorTopicReply.get(replyTo) === true;
  }

  /** Drop expired root candidates so a silently dropped reply cannot leak memory. */
  #pruneRootCandidates(now = Date.now()) {
    for (const [messageId, expiresAt] of this.#rootCandidates) {
      if (expiresAt <= now) this.#rootCandidates.delete(messageId);
    }
  }

  /** Track a main-feed root this bot will auto-open as a topic, bounded + TTL'd. */
  #rememberTopicRoot(messageId) {
    if (!nonEmptyString(messageId)) return;
    const now = Date.now();
    this.#pruneRootCandidates(now);
    this.#rootCandidates.delete(messageId);
    this.#rootCandidates.set(messageId, now + ROOT_CANDIDATE_TTL_MS);
    while (this.#rootCandidates.size > MAX_ROOT_CANDIDATES) {
      const oldest = this.#rootCandidates.keys().next().value;
      if (oldest === undefined) break;
      this.#rootCandidates.delete(oldest);
    }
  }

  /** Forget a root candidate once its topic opened or the reply degraded. */
  #forgetTopicRoot(messageId) {
    if (!nonEmptyString(messageId)) return;
    this.#rootCandidates.delete(messageId);
  }

  /** Persist thread_id once Feishu auto-opened a topic from a managed root. */
  async #registerTopicFromReply(replyTo, chatId, response) {
    await this.#registerTopicReply(replyTo, chatId, response?.data?.thread_id);
  }

  /**
   * Record the topic for a root this bot asked Feishu to open. The reply
   * response carries the thread_id in most cases; when it does not — we have
   * seen a topic come back without one — read it back from the message we
   * replied to. Feishu opened the topic either way, and a topic left
   * unrecorded would answer its follow-ups from the chat's own session instead
   * of the topic's.
   */
  async #registerTopicReply(rootMessageId, chatId, threadId) {
    const known = nonEmptyString(threadId);
    if (known) {
      await this.#registerTopicThreadId(known, rootMessageId, chatId);
      return;
    }
    await this.#ensureTopicRegistered(rootMessageId, chatId);
  }

  /**
   * Fallback for a threaded reply that reported no thread_id: ask Feishu which
   * topic the replied-to message now belongs to. Only runs while that message
   * is still a pending root candidate, so a topic already recorded — or a
   * conversation that has no topics at all — costs no extra API call.
   */
  async #ensureTopicRegistered(rootMessageId, chatId) {
    this.#pruneRootCandidates();
    if (!nonEmptyString(rootMessageId) || !this.#rootCandidates.has(rootMessageId)) return;
    const threadId = await this.#readTopicThreadId(rootMessageId);
    if (threadId) {
      await this.#registerTopicThreadId(threadId, rootMessageId, chatId);
      return;
    }
    // Still no topic: drop the candidate so a later addressed question opens a
    // fresh session rather than reusing a stale slot.
    this.#forgetTopicRoot(rootMessageId);
  }

  /** The topic a message belongs to, or null when it is not in one. */
  async #readTopicThreadId(messageId) {
    const read = this.#client?.im?.v1?.message?.get;
    if (typeof read !== 'function') return null;
    try {
      const response = await read({ path: { message_id: messageId } });
      if (response?.code && response.code !== 0) return null;
      const items = Array.isArray(response?.data?.items) ? response.data.items : [];
      const item = items.find((candidate) => nonEmptyString(candidate?.message_id) === messageId)
        ?? items[0];
      return nonEmptyString(item?.thread_id);
    } catch (error) {
      this.#logger.warn?.(
        '[dsh-feishu] could not read the topic of a replied-to message:',
        error?.message ?? String(error),
      );
      return null;
    }
  }

  /** Persist thread_id when the reply anchor is a root this bot auto-opened. */
  async #registerTopicThreadId(threadId, rootMessageId, chatId) {
    this.#pruneRootCandidates();
    if (!threadId || !this.#rootCandidates.has(rootMessageId)) return;
    this.#rootCandidates.delete(rootMessageId);
    if (!chatId || typeof this.#state?.setTopic !== 'function') return;
    try {
      await this.#state.setTopic(threadId, { rootMessageId, chatId });
    } catch (error) {
      this.#logger.warn?.('[dsh-feishu] failed to record managed topic:', error?.message ?? String(error));
    }
  }

  /**
   * Remember where a conversation posts, so a turn opened outside the IM can
   * render into it later. Called for every accepted inbound message; a host
   * that already knows a binding can register it the same way.
   */
  rememberConversationRoute(key, { chatId, replyToMessageId = null } = {}) {
    const conversation = nonEmptyString(chatId);
    if (!nonEmptyString(key) || !conversation) return;
    this.#conversationRoutes.delete(key);
    this.#conversationRoutes.set(key, {
      chatId: conversation,
      replyToMessageId: nonEmptyString(replyToMessageId),
    });
    while (this.#conversationRoutes.size > MAX_CONVERSATION_ROUTES) {
      this.#conversationRoutes.delete(this.#conversationRoutes.keys().next().value);
    }
  }

  accept(event) {
    if (!this.#groupHistory || event?.message?.chat_type !== 'group') return this.#accept(event);
    const content = extractInboundMessage({ ...event, message: { ...event.message, mentions: [] } }, this.#client);
    const message = { ...content, kind: 'group', senderId: senderOpenId(event),
      senderIsBot: isBotSender(event) };
    return captureGroupHistory(this.#groupHistory, message, {
      channel: 'feishu', scope: this.#groupHistoryScope, groupId: event.message.chat_id,
      messageId: event.message.message_id, sentAt: Number(event.message.create_time),
      type: event.message.message_type, text: content.content,
      threadId: event.message.thread_id, replyToMessageId: event.message.parent_id,
      capability: '需授权 im:message.group_msg；授权采集不改变群回复模式。',
    }, { logger: this.#logger }).then(() => { event.groupHistory = message.groupHistory; return this.#accept(event); });
  }

  #accept(event) {
    if (this.#signal?.aborted) return Promise.resolve();
    const messageId = nonEmptyString(event?.message?.message_id);
    if (!messageId) return Promise.resolve();
    const addressed = this.#isAddressed(event);
    // Bot messages require a known, explicit group mention even in all-message mode.
    if (isBotSender(event) && (
      event?.message?.chat_type !== 'group'
      || !this.#botOpenId
      || !addressed
      || senderOpenId(event) === this.#botOpenId
    )) return Promise.resolve();
    if (!this.#accessPolicy && !isAllowedSender(event, this.#allowedSenderOpenIds)) {
      this.#status.messagesRejected += 1;
      this.#status.lastRejectedAt = new Date().toISOString();
      this.#logger.warn?.('[dsh-feishu] ignored a message from a sender outside the legacy allowlist');
      return Promise.resolve();
    }
    if (event?.message?.chat_type !== 'p2p'
      && this.#groupResponseMode === FEISHU_GROUP_RESPONSE_MODES.MENTION
      && !addressed) {
      return Promise.resolve();
    }
    if (this.#state.hasSeen(messageId) || this.#acceptedMessageIds.has(messageId)) {
      return Promise.resolve();
    }

    let key;
    try {
      key = this.#resolveKey(event);
    } catch {
      this.#status.messagesRejected += 1;
      this.#status.lastRejectedAt = new Date().toISOString();
      return Promise.resolve();
    }
    this.#rememberTopicReply(messageId, key);
    this.rememberConversationRoute(key, {
      chatId: event.message.chat_id,
      replyToMessageId: messageId,
    });

    const commandMessage = extractInboundMessage(event, this.#client);
    const commandText = nonEmptyString(commandMessage.content) ?? '';
    const hasImages = hasInboundImages(commandMessage);
    const hasFiles = hasInboundFiles(commandMessage);
    const conversationType = event.message.chat_type === 'p2p' ? 'direct'
      : event.message.chat_type === 'group' ? 'group' : null;
    const access = evaluateInboundAccess(this.#accessPolicy, {
      conversationType,
      senderIds: senderOpenId(event),
      text: commandText,
      hasImages,
      hasFiles,
      isCommand: isSharedLocalCommand(commandText, {
        hasImages,
        hasFiles,
      }) || isFeishuLocalCommand(commandText, { hasImages, hasFiles })
        || (!hasImages && !hasFiles && NUMBER_REPLY.test(commandText) && this.#menus.has(key))
        // Opening the menu on a bare mention is the `/m` command by another
        // route, so it must clear the same command gate. Treating it as plain
        // chat let a sender without `canExecuteCommands` receive a menu that
        // carries workspace paths and other session titles.
        || isBareMentionMenuRequest(event, commandText, {
          hasImages,
          hasFiles,
          hasReply: hasReplyReference(commandMessage),
        }),
    });
    if (!access.allowed) {
      this.#acceptedMessageIds.set(messageId, null);
      return this.#finishAccessDecision(event, messageId, access);
    }
    if (conversationType === 'direct' && !this.#nativeMenuReady()
      && !/^\/(?:m|menu|help)$/iu.test(commandText) && this.#state.needsMenuIntroduction?.(key)
      && evaluateInboundAccess(this.#accessPolicy, { conversationType, senderIds: senderOpenId(event), isCommand: true }).allowed) {
      return this.#state.introduceMenu(key, () => this.#sendMenuCard(key, event.message.chat_id), { signal: this.#signal, logger: this.#logger })
        .then(() => this.#accept(event));
    }
    // Register a managed-topic root only after access is allowed, so a
    // rejected or ignored question never reserves a candidate slot.
    if (this.#mentionTopicReply
      && !nonEmptyString(event?.message?.thread_id)
      && isTopicKey(key)
      && key.includes(':managed:')) {
      this.#rememberTopicRoot(messageId);
    }
    if (event.message.chat_type === 'p2p') {
      const chatId = nonEmptyString(event.message.chat_id);
      if (chatId) rememberConnectionTestTarget(this.#state, { chatId });
    }

    this.#acceptedMessageIds.set(messageId, captureContextEnhancement(
      this.#contextEnhancement,
      conversationType,
    ));
    const processingReaction = this.#beginReaction(messageId);
    const batchText = event.message.message_type === 'text'
      ? nonEmptyString(extractText(event)) ?? ''
      : '';
    const batchCommand = event.message.message_type === 'text'
      && isBatchInputCommand(batchText);
    const pending = this.#pendingInteractions.get(key);
    const batchStatus = this.#batchInputs.status(key);
    if (batchCommand && event.message.chat_type !== 'p2p') {
      return this.#finishBatchResult(
        event,
        messageId,
        processingReaction,
        { message: batchInputGroupUnsupportedMessage() },
      );
    }
    if (event.message.chat_type === 'p2p'
      && (batchCommand || batchStatus.phase === 'collecting')) {
      const exactBatchStart = /^\/batch$/iu.test(batchText);
      const result = exactBatchStart
        && batchStatus.phase === 'idle'
        && (this.#queues.has(key) || pending || this.#approvals.hasPending(key))
        ? { handled: true, kind: 'busy', message: batchInputBusyMessage() }
        : this.#batchInputs.handle(key, batchText, {
            plainText: event.message.message_type === 'text'
              && Boolean(batchText)
              && !hasReplyReference(commandMessage),
          });
      if (result.handled) {
        if (result.kind === 'submit') {
          const submissionEvent = {
            ...event,
            batchSubmission: { token: result.token, title: result.title },
            message: {
              ...event.message,
              message_type: 'text',
              content: JSON.stringify({ text: result.prompt }),
              mentions: [],
              // The submission is exactly the collected text, so quoting the
              // message that carried /send must not attach it to the batch.
              parent_id: undefined,
              root_id: undefined,
            },
          };
          return this.#enqueueMessage(
            submissionEvent,
            messageId,
            key,
            processingReaction,
          );
        }
        return this.#finishBatchResult(
          event,
          messageId,
          processingReaction,
          result,
        );
      }
    }
    // Card commands (/m, /help, /status, etc.) bypass the queue so they
    // respond immediately even when a harness task is still streaming.
    if (CARD_COMMAND.test(commandText)) {
      const processing = Promise.resolve()
        .then(() => this.#handle(event, key, { alreadyRecorded: false }))
        .then(() => this.#finishReaction(messageId, processingReaction, 'DONE'))
        .catch((error) => this.#handleMessageFailure(
          event,
          messageId,
          processingReaction,
          error,
        ))
        .finally(() => this.#acceptedMessageIds.delete(messageId));
      return processing;
    }
    const commandRunner = isHistoryCommand(commandText) ? runHistoryCommand
      : isPermissionCommand(commandText) ? runPermissionCommand
      : hasInboundFiles(commandMessage) ? null : isControlCommand(commandText)
      ? runControlCommand
      : (isModelCommand(commandText)
          ? runModelCommand
          : (isPresetCommand(commandText) ? runPresetCommand : null));
    // In all-message group mode, history must still be refused locally rather
    // than becoming a normal prompt when no mention is present.
    if (commandRunner && (addressed || commandRunner === runHistoryCommand)) {
      const processing = this.#processFastCommand(
        event,
        messageId,
        key,
        commandMessage,
        commandRunner,
      );
      let current;
      current = processing
        .then(() => this.#finishReaction(messageId, processingReaction, 'DONE'))
        .catch((error) => this.#handleMessageFailure(
          event,
          messageId,
          processingReaction,
          error,
        ))
        .finally(() => {
          this.#acceptedMessageIds.delete(messageId);
          this.#commandTasks.delete(current);
        });
      this.#commandTasks.add(current);
      return current;
    }
    if (!hasImages && this.#isResolvedQuestionReply(event, key)) {
      const current = Promise.resolve()
        .then(() => this.#discardResolvedInteractionReply(event, messageId))
        .then(() => this.#finishReaction(messageId, processingReaction, 'DONE'))
        .catch((error) => this.#handleMessageFailure(
          event,
          messageId,
          processingReaction,
          error,
        ))
        .finally(() => this.#acceptedMessageIds.delete(messageId));
      return current;
    }
    const approvalReply = this.#approvals.claimReply({
      key,
      actor: senderOpenId(event),
      messageId,
      text: extractText(event) ?? '',
      addressed,
      hasPendingQuestion: Boolean(pending),
      questionCompletion: pending?.submitting || pending?.claimedReplyMessageId
        ? pending.queue
        : null,
      isQuestionPending: () => this.#pendingInteractions.has(key),
      send: (text) => this.#send(event.message.chat_id, text, { replyTo: event.message.message_id }),
    });
    if (approvalReply) {
      const processing = approvalReply.process(async () => {
        if (this.#state.hasSeen(messageId)) return false;
        await this.#state.markSeen(messageId);
        this.#status.lastMessageAt = new Date().toISOString();
        this.#status.messagesReceived += 1;
        return true;
      });
      let current;
      current = processing
        .then(() => this.#finishReaction(messageId, processingReaction, 'DONE'))
        .catch((error) => this.#handleMessageFailure(
          event,
          messageId,
          processingReaction,
          error,
        ))
        .finally(() => {
          this.#acceptedMessageIds.delete(messageId);
          this.#interactionTasks.delete(current);
        });
      this.#interactionTasks.add(current);
      return current;
    }
    if (pending && senderOpenId(event) !== pending.actor) {
      return this.#enqueueMessage(event, messageId, key, processingReaction);
    }
    if (pending && hasImages) {
      const previous = pending.queue ?? Promise.resolve();
      const interruption = previous.catch(() => undefined)
        .then(() => this.#interruptQuestionForImage(event, key, pending))
        .finally(() => {
          if (pending.queue === interruption) pending.queue = null;
          this.#interactionTasks.delete(interruption);
        });
      pending.queue = interruption;
      this.#interactionTasks.add(interruption);
      // Reserve the image's FIFO position before stopping releases the original turn.
      return this.#enqueueMessage(event, messageId, key, processingReaction);
    }
    if (pending?.submitting || pending?.claimedReplyMessageId) {
      return this.#enqueueMessage(event, messageId, key, processingReaction);
    }
    if (pending) {
      if (canClaimInteractionReply(event, pending)) pending.claimedReplyMessageId = messageId;
      const previous = pending.queue ?? Promise.resolve();
      const processing = previous
        .catch(() => undefined)
        .then(() => this.#processInteractionReply(
          event,
          messageId,
          key,
          pending,
          processingReaction,
        ));
      pending.queue = processing;

      const releaseInteraction = () => {
        if (pending.claimedReplyMessageId === messageId) {
          pending.claimedReplyMessageId = null;
        }
        if (pending.queue === processing) pending.queue = null;
      };
      let current;
      current = processing
        .then(
          () => {
            releaseInteraction();
            return this.#finishReaction(messageId, processingReaction, 'DONE');
          },
          (error) => {
            releaseInteraction();
            return this.#handleMessageFailure(
              event,
              messageId,
              processingReaction,
              error,
            );
          },
        )
        .finally(() => {
          releaseInteraction();
          this.#acceptedMessageIds.delete(messageId);
          this.#interactionTasks.delete(current);
        });
      this.#interactionTasks.add(current);
      return current;
    }
    return this.#busyMessages.dispatch({
      key, messageId, text: commandText,
      eligible: () => event.message.message_type === 'text' && !hasImages && !hasFiles
        && !hasReplyReference(commandMessage) && !isFeishuLocalCommand(commandText)
        && !(NUMBER_REPLY.test(commandText) && this.#menus.has(key))
        && canAutomaticallySteer(this.#accessPolicy, conversationType, senderOpenId(event)),
      harness: this.#harness, state: this.#state, status: this.#status,
      signal: this.#signal, control: { owner: this, key }, logger: this.#logger,
      acceptedMessageIds: this.#acceptedMessageIds,
      pendingInteraction: () => this.#pendingInteractions.has(key) || this.#approvals.hasPending(key),
      enhancement: {
        snapshot: this.#acceptedMessageIds.get(messageId),
        source: () => ({ channel: 'feishu', senderId: senderOpenId(event),
          chatId: event.message.chat_id, threadId: event.message.thread_id }),
      },
      isQueued: () => this.#queues.has(key),
      enqueue: (options) => this.#enqueueMessage(event, messageId, key, processingReaction, options),
      send: (reply) => this.#send(event.message.chat_id, reply, { replyTo: messageId }),
      onSteered: () => this.#finishReaction(messageId, processingReaction, 'DONE'),
      onError: (error) => this.#handleMessageFailure(event, messageId, processingReaction, error),
    });
  }

  #finishBatchResult(event, messageId, processingReaction, result) {
    let current;
    current = Promise.resolve()
      .then(async () => {
        if (this.#state.hasSeen(messageId)) return;
        await this.#state.markSeen(messageId);
        this.#status.lastMessageAt = new Date().toISOString();
        this.#status.messagesReceived += 1;
        if (result?.message) await this.#send(event.message.chat_id, result.message, { replyTo: event.message.message_id });
        this.#status.lastError = null;
      })
      .then(() => this.#finishReaction(messageId, processingReaction, 'DONE'))
      .catch((error) => this.#handleMessageFailure(
        event,
        messageId,
        processingReaction,
        error,
      ))
      .finally(() => {
        this.#acceptedMessageIds.delete(messageId);
        this.#commandTasks.delete(current);
      });
    this.#commandTasks.add(current);
    return current;
  }

  #logAccessDenied(conversationType, reason) {
    this.#logger.info?.('[dsh-feishu] inbound access denied', {
      botId: this.#accessPolicy?.botId,
      conversationType,
      reason,
    });
  }

  #finishAccessDecision(event, messageId, access) {
    let current;
    current = Promise.resolve().then(async () => {
      if (this.#state.hasSeen(messageId)) return;
      await this.#state.markSeen(messageId);
      this.#logAccessDenied(event.message.chat_type === 'p2p' ? 'direct' : 'group', access.reason);
      if (access.reason === 'command-not-allowed') {
        this.#status.lastMessageAt = new Date().toISOString();
        this.#status.messagesReceived += 1;
        await this.#send(
          event.message.chat_id,
          t(COMMAND_PERMISSION_DENIED_MESSAGE),
          { replyTo: event.message.message_id },
        );
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
      this.#logger.warn?.('[dsh-feishu] failed to apply inbound access policy');
    }).finally(() => {
      this.#acceptedMessageIds.delete(messageId);
      this.#commandTasks.delete(current);
    });
    this.#commandTasks.add(current);
    return current;
  }

  #enqueueMessage(event, messageId, key, processingReaction, {
    releaseMessageId = true,
    alreadyRecorded = false,
    finalize = true,
  } = {}) {
    const previous = this.#queues.get(key) ?? Promise.resolve();
    const work = previous
      .catch(() => undefined)
      .then(() => this.#handle(event, key, { alreadyRecorded }));
    const settled = finalize
      ? work
        .then(async (receipt) => {
          await this.#finishReaction(messageId, processingReaction, 'DONE');
          return receipt;
        })
        .catch((error) => this.#handleMessageFailure(
          event,
          messageId,
          processingReaction,
          error,
        ))
      : work;
    let current;
    current = settled.finally(() => {
      if (releaseMessageId) this.#acceptedMessageIds.delete(messageId);
      if (this.#queues.get(key) === current) this.#queues.delete(key);
    });
    this.#queues.set(key, current);
    return current;
  }

  #recordFailure(error, {
    logLabel = 'operation',
    logLevel = 'warn',
    userMessage,
    reason,
  } = {}) {
    this.#status.lastError = error?.message ?? String(error);
    const failure = setLastMessageFailure(this.#status, error, { userMessage, reason });
    this.#logger?.[logLevel]?.(
      `[dsh-feishu] ${logLabel} failed [${failure.referenceId}]:`,
      messageFailureDiagnostic(error, failure),
    );
    return failure;
  }

  async #sendFailure(chatId, error, options = {}) {
    const failure = this.#recordFailure(error, options);
    const text = options.appendMessage
      ? `${messageFailureText(failure)}\n\n${options.appendMessage}`
      : messageFailureText(failure);
    await this.#send(chatId, text, { replyTo: options.replyTo }).catch(() => undefined);
    return failure;
  }

  async #handleMessageFailure(event, messageId, processingReaction, error) {
    if (error?.code === 'turn-stopped') {
      await this.#removeProcessingReaction(messageId, processingReaction);
      if (error?.batchInputMessage) {
        await this.#send(event.message.chat_id, error.batchInputMessage, { replyTo: event.message.message_id }).catch(() => undefined);
      }
      return;
    }
    if (this.#signal?.aborted) {
      await this.#removeProcessingReaction(messageId, processingReaction);
      return;
    }
    const userMessage = inboundFileUserMessage(error)
      ?? imagePromptUserMessage(error);
    const failure = this.#recordFailure(error, {
      logLabel: 'message handling',
      logLevel: 'error',
      userMessage,
      reason: imagePromptDiagnostic(error)?.reason,
    });
    await this.#finishReaction(messageId, processingReaction, 'ERROR');
    const failureText = error?.batchInputMessage
      ? `${messageFailureText(failure)}\n\n${error.batchInputMessage}`
      : messageFailureText(failure);
    await this.#send(
      event.message.chat_id,
      failureText,
      { replyTo: event.message.message_id },
    ).catch(() => undefined);
  }

  async waitForIdle() {
    await this.#busyMessages.whenIdle();
    // Drain to a fixed point: awaited work can register compensation or
    // another serialized tail before it settles.
    for (;;) {
      await this.#deferred.whenIdle();
      const tasks = [
        ...this.#queues.values(),
        ...[...this.#pendingInteractions.values()].flatMap((pending) => (
          pending.queue ? [pending.queue] : []
        )),
        ...this.#interactionTasks,
        ...this.#commandTasks,
        ...this.#cardActionTasks,
        ...this.#eventTails.values(),
        ...[...this.#pendingCompensations.values()].map((pending) => pending.promise),
      ];
      if (tasks.length === 0) return;
      await Promise.allSettled(tasks);
      await this.#deferred.whenIdle();
      if (this.#queues.size === 0
        && this.#interactionTasks.size === 0
        && this.#commandTasks.size === 0
        && this.#cardActionTasks.size === 0
        && this.#eventTails.size === 0
        && this.#pendingCompensations.size === 0
        && ![...this.#pendingInteractions.values()].some((pending) => pending.queue)) return;
    }
  }

  #cardDataSignal() {
    const timeout = AbortSignal.timeout(this.#cardDataTimeoutMs);
    return this.#signal ? AbortSignal.any([this.#signal, timeout]) : timeout;
  }

  #hasPendingInteraction(key) {
    return this.#pendingInteractions.has(key) || this.#approvals.hasPending(key);
  }

  async #processFastCommand(event, messageId, key, message, runner) {
    this.#signal?.throwIfAborted();
    if (this.#state.hasSeen(messageId)) return;
    await this.#state.markSeen(messageId);
    this.#status.lastMessageAt = new Date().toISOString();
    this.#status.messagesReceived += 1;
    let result = await runner(
      nonEmptyString(message.content) ?? '',
      this.#harness,
      this.#state,
      key,
      {
        signal: this.#signal,
        isDirect: event.message.chat_type === 'p2p',
        hasImages: hasInboundImages(message),
        deferredDelivery: this.#deferred,
        hasFiles: hasInboundFiles(message),
        pendingInteraction: this.#hasPendingInteraction(key),
        busy: this.#queues.has(key),
        control: { owner: this, key },
        enhancement: captureContextEnhancementSource(
          this.#contextEnhancement,
          event.message.chat_type === 'p2p' ? 'direct' : 'group',
          () => ({
            channel: 'feishu',
            senderId: senderOpenId(event),
            chatId: event.message.chat_id,
            threadId: event.message.thread_id,
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
      if (reply) await this.#send(event.message.chat_id, reply, { replyTo: event.message.message_id });
    }
    this.#status.lastError = null;
  }

  async #handle(event, key, { alreadyRecorded = false } = {}) {
    this.#signal?.throwIfAborted();
    const messageId = event.message.message_id;
    if (!alreadyRecorded) {
      if (this.#state.hasSeen(messageId)) return;
      await this.#state.markSeen(messageId);
      this.#status.lastMessageAt = new Date().toISOString();
      this.#status.messagesReceived += 1;
    }

    const message = extractInboundMessage(event, this.#client);
    let text = message.content;
    let voiceTurnReplyTo = null;
    // 语音输入(渠道能力):音频消息先转写成文字并写回 message.content——
    // 下方命令识别与 #answerWithStream 都从 content 取文本。转写失败(或返回
    // 空文本)时保持原语义,走"仅支持文字、图片和文件"的明确降级提示。
    if (event.message.message_type === 'audio' && this.#voice?.enabled) {
      try {
        const transcript = await this.#voice.transcribeIncoming(event, this.#client);
        if (transcript) {
          text = transcript;
          message.content = transcript;
          message.files = message.files.map(file => ({ ...file, transcript }));
          voiceTurnReplyTo = event.message.message_id;
        }
      } catch (error) {
        this.#logger.warn?.('[dsh-feishu-voice] 语音转写失败:', error?.message ?? String(error));
      }
    }
    const hasImages = hasInboundImages(message);
    const hasFiles = hasInboundFiles(message);
    const hasReply = hasReplyReference(message);
    // 语音转写后的命令权限复检:accept() 的访问判定发生在转写前,音频消息
    // 没有命令文本,按普通消息放行;转写得到的文本可能包含命令,须用与
    // accept() 相同的命令识别与权限规则再校验一次,防止"允许聊天、禁止命令"
    // 的用户经语音入口绕过 canExecuteCommands——文字与语音入口行为一致。
    // 仅"命令不允许"给用户提示(与文字路径同文案),其余拒绝原因静默丢弃。
    if (voiceTurnReplyTo) {
      const transcribedAccess = evaluateInboundAccess(this.#accessPolicy, {
        conversationType: event.message.chat_type === 'p2p' ? 'direct'
          : event.message.chat_type === 'group' ? 'group' : null,
        senderIds: senderOpenId(event),
        text,
        hasImages,
        hasFiles,
        isCommand: isSharedLocalCommand(text, { hasImages, hasFiles })
          || isFeishuLocalCommand(text, { hasImages, hasFiles })
          || (!hasImages && !hasFiles && NUMBER_REPLY.test(text) && this.#menus.has(key)),
      });
      if (!transcribedAccess.allowed) {
        this.#logAccessDenied(event.message.chat_type === 'p2p' ? 'direct' : 'group', transcribedAccess.reason);
        if (transcribedAccess.reason === 'command-not-allowed') {
          await this.#send(
            event.message.chat_id,
            t(COMMAND_PERMISSION_DENIED_MESSAGE),
            { replyTo: event.message.message_id },
          );
          this.#status.messagesReplied += 1;
          this.#status.lastReplyAt = new Date().toISOString();
        }
        this.#status.lastError = null;
        return;
      }
    }
    // 命令识别对 text 与纯文本 post 一视同仁：post 富文本若仅含单个
    // 文本段落（如复制粘贴的 /new），同样按命令处理；带图片/文件不认。
    // accept() 侧已用 nonEmptyString(content) 判定，两侧保持一致。
    const rawCommandText = text ? text.trim() : '';
    const commandText = !hasImages && !hasFiles && text ? rawCommandText : null;
    if (!text && !hasImages && !hasFiles && !hasReply) {
      // An "@bot" with nothing else carries no instruction to parse, and the
      // menu card is what the reader is reaching for — answer it the way `/m`
      // does rather than with a "text only" notice. Kept to plain p2p text so a
      // voice note, video or forwarded card still gets its own notice.
      if (isBareMentionMenuRequest(event, text, { hasImages, hasFiles, hasReply })) {
        await this.#sendMenuCard(key, event.message.chat_id, { replyTo: event.message.message_id });
        return;
      }
      await this.#send(event.message.chat_id, t('目前支持文字、图片和文件消息。'), { replyTo: event.message.message_id });
      return;
    }

    if (commandText !== null && REPAIR_COMMAND_PREFIX.test(commandText)) {
      await this.#handleRepairCommand(event, commandText);
      return;
    }
    if (isPermissionCommand(text)) {
      const result = await runPermissionCommand(text, this.#harness, this.#state, key, {
        signal: this.#signal, hasImages, hasFiles,
      });
      for (const reply of result.messages) {
        await this.#send(event.message.chat_id, reply, { replyTo: event.message.message_id });
      }
      return;
    }
    if (commandText === '/help') {
      await this.#send(event.message.chat_id, menuHelpText(), { replyTo: event.message.message_id });
      return;
    }
    if (MENU_COMMAND.test(commandText)) {
      await this.#sendMenuCard(key, event.message.chat_id, { replyTo: event.message.message_id });
      return;
    }
    if (isNewCommand(commandText)) {
      if (this.#queues.has(key) || this.#hasPendingInteraction(key)) {
        await this.#send(
          event.message.chat_id,
          t('当前任务仍在运行，请先停止任务或等待任务完成后再开启新会话。'),
          { replyTo: event.message.message_id },
        );
        return;
      }
      await this.#send(event.message.chat_id, await startNewConversation({
        state: this.#state, harness: this.#harness, key,
        title: newCommandTitle(commandText),
      }), { replyTo: event.message.message_id });
      await this.#sendMenuCard(key, event.message.chat_id, { replyTo: event.message.message_id });
      return;
    }
    if (commandText === '/status') {
      await this.#showStatusText(key, event.message.chat_id, event.message.message_id);
      return;
    }
    if (isSessionNavCommand(commandText)) {
      const nav = await runSessionNavTextCommand(commandText, this.#harness, this.#state, key, {
        signal: this.#signal,
      });
      if (nav) {
        for (const reply of nav.messages ?? [nav.message]) {
          await this.#send(event.message.chat_id, reply, { replyTo: event.message.message_id });
        }
        if (nav.askText) {
          const followUp = this.#enqueueMessage(
            {
              ...event,
              message: {
                ...event.message,
                message_type: 'text',
                content: JSON.stringify({ text: nav.askText }),
              },
            },
            `${messageId}-ask`,
            key,
            null,
          );
          followUp.catch((error) => {
            this.#logger.warn?.(`[dsh-im:feishu] follow-up ask after a nav command failed:`, error?.message ?? error);
            this.#send(event.message.chat_id, t('切换后的提问发送失败，请重试。'), { replyTo: event.message.message_id }).catch(() => undefined);
          });
        }
      }
      return;
    }
    if (commandText === '/compact') {
      const compactCommand = await runCompactCommand(commandText, this.#harness, this.#state, key, { signal: this.#signal });
      if (compactCommand) {
        await this.#send(event.message.chat_id, compactCommand.message, { replyTo: event.message.message_id });
      }
      return;
    }
    if (isClearCommand(rawCommandText)) {
      const clearCommand = await runClearCommand(rawCommandText, this.#harness, this.#state, key, {
        signal: this.#signal,
        hasImages,
        hasFiles,
        pendingInteraction: this.#hasPendingInteraction(key),
        busy: this.#queues.has(key),
      });
      if (clearCommand) {
        await this.#send(event.message.chat_id, clearCommand.message, { replyTo: event.message.message_id });
      }
      return;
    }
    if (isResetCommand(rawCommandText)) {
      const resetCommand = await runResetCommand(rawCommandText, this.#harness, this.#state, key, {
        signal: this.#signal,
        hasImages,
        hasFiles,
        pendingInteraction: this.#hasPendingInteraction(key),
        busy: this.#queues.has(key),
      });
      if (resetCommand) {
        await this.#send(event.message.chat_id, resetCommand.message, { replyTo: event.message.message_id });
      }
      return;
    }
    if (SESSION_LIST_PREFIX.test(commandText)) {
      const argument = commandText.replace(/^\/(?:sessionlist|sessions)/i, '').trim();
      const request = parseSessionListArgument(argument);
      if (request.error) {
        await this.#send(event.message.chat_id, request.error, { replyTo: event.message.message_id });
        return;
      }
      if (request.all) {
        const result = await runWorkspaceCommand(text, this.#harness, key);
        for (const reply of result.messages ?? [result.message]) {
          await this.#send(event.message.chat_id, reply, { replyTo: event.message.message_id });
        }
        return;
      }
      await this.#showSessions(
        { chatId: event.message.chat_id, key, replyTo: event.message.message_id },
        request.selector || null,
        0,
        { limit: request.limit },
      );
      return;
    }
    if (BARE_WORKSPACE_COMMAND.test(commandText)
      && this.#harness.conversationDirectoryConfig?.()?.enabled === true) return;
    if (BARE_WORKSPACE_COMMAND.test(commandText) || WORKSPACE_LIST_COMMAND.test(commandText)) {
      await this.#showWorkspaces({ chatId: event.message.chat_id, key, replyTo: event.message.message_id }, {
        includeConversationDirectories: /\s+all$/iu.test(commandText),
      });
      return;
    }
    if (WATCH_COMMAND.test(commandText)) {
      const target = (WATCH_COMMAND.exec(commandText)?.[1] ?? '').trim() || null;
      await this.#runWatch(key, event.message.chat_id, target, { replyTo: event.message.message_id });
      return;
    }
    if (UNWATCH_COMMAND.test(commandText)) {
      const target = (UNWATCH_COMMAND.exec(commandText)?.[1] ?? '').trim() || null;
      await this.#runUnwatch(key, event.message.chat_id, target, { replyTo: event.message.message_id });
      return;
    }
    if (WATCHLIST_COMMAND.test(commandText)) {
      await this.#showWatchList(key, event.message.chat_id, { replyTo: event.message.message_id });
      return;
    }
    if (ARCHIVED_COMMAND.test(commandText)) {
      const match = ARCHIVED_COMMAND.exec(commandText);
      const value = match[1]?.toLowerCase();
      if (value !== 'on' && value !== 'off') {
        await this.#send(event.message.chat_id, t('用法：/archived on（包含归档会话）或 /archived off（隐藏归档会话）'), { replyTo: event.message.message_id });
        return;
      }
      if (typeof this.#state?.setIncludeArchivedSessions === 'function') {
        await this.#state.setIncludeArchivedSessions(value === 'on');
      }
      await this.#send(
        event.message.chat_id,
        value === 'on' ? t('已开启：会话列表包含归档会话。') : t('已关闭：会话列表隐藏归档会话。'),
        { replyTo: event.message.message_id },
      );
      return;
    }
    if (NUMBER_REPLY.test(commandText)) {
      const menu = this.#takeMenu(key);
      if (menu) {
        await this.#handleMenuPick(menu, Number(commandText), {
          chatId: event.message.chat_id,
          key,
          event,
        });
        return;
      }
    }
    const workspaceCommand = commandText === null
      ? null
      : await runWorkspaceCommand(text, this.#harness, key);
    if (workspaceCommand) {
      for (const reply of workspaceCommand.messages ?? [workspaceCommand.message]) {
        await this.#send(event.message.chat_id, reply, { replyTo: event.message.message_id });
      }
      return;
    }
    const compactCommand = commandText === null
      ? null
      : await runCompactCommand(
          commandText,
          this.#harness,
          this.#state,
          key,
          { signal: this.#signal },
        );
    if (compactCommand) {
      await this.#send(event.message.chat_id, compactCommand.message, { replyTo: event.message.message_id });
      return;
    }

    this.#logger.info?.(`[dsh-feishu] processing ${event.message.chat_type} message ${messageId}`);
    // 语音回合状态在进入正常问答路径前才登记:上方命令分支(/help、菜单、
    // 会话列表等)与空内容分支均提前返回,提前登记会让状态遗留到下一回合,
    // 导致后续普通文字消息的答案被合成为音频并回复到旧的语音消息。
    // 本路径的 finally 统一清理回合状态。状态以会话 key 登记——与消息队列
    // 同粒度:同群不同话题的 key 不同、可并行处理,共用 chat_id 槽位会让
    // 后登记的回合覆盖先登记的,先完成的回合合成到后一条语音消息上。
    if (voiceTurnReplyTo) {
      this.#voiceTurns.set(key, { replyTo: voiceTurnReplyTo });
    }
    const batchSubmission = event.batchSubmission ?? null;
    let batchAskCompleted = false;
    try {
      const {
        receipt,
        artifactSendErrors,
        textDeliveryErrors = 0,
      } = await this.#answerWithStream(event, key, message, {
        onAskComplete: batchSubmission
          ? () => {
              batchAskCompleted = this.#batchInputs.complete(
                key,
                batchSubmission.token,
              ).completed;
            }
          : undefined,
      });
      this.#status.messagesReplied += 1;
      this.#status.lastReplyAt = new Date().toISOString();
      this.#status.lastError = null;
      if (textDeliveryErrors === 0 && artifactSendErrors === 0) {
        clearLastMessageFailure(this.#status);
      }
      return receipt;
    } catch (error) {
      if (batchSubmission && !batchAskCompleted) {
        if (error?.code === 'turn-stopped') {
          this.#batchInputs.complete(key, batchSubmission.token);
          throw error;
        }
        const failed = this.#batchInputs.fail(key, batchSubmission.token);
        if (failed.retained) {
          const batchError = new Error(error?.message ?? String(error), { cause: error });
          batchError.code = error?.code;
          batchError.providerCode = error?.providerCode;
          batchError.method = error?.method;
          if (Number.isInteger(error?.status)) batchError.status = error.status;
          batchError.batchInputMessage = failed.message;
          throw batchError;
        }
      }
      throw error;
    } finally {
      // Synced questions (including DS Bot's ask_user) outlive the turn that
      // presented them. Only turn-owned questions belong to this cleanup;
      // their failed-delivery/error paths must still resolve by cancellation.
      if (this.#pendingInteractions.get(key)?.lifecycle !== 'session-sync') {
        await this.#cancelPendingInteraction(key);
      }
      await this.#approvals.closeRoute(key);
      this.#voiceTurns.delete(key);
    }
  }

  // ── Interactive cards: menus and session/workspace lists ────────────────

  // Existing-app callback repair. This path deliberately uses ordinary text
  // and number replies because callback buttons are the capability being fixed.
  async #handleRepairCommand(event, commandText) {
    if (event?.message?.chat_type !== 'p2p') {
      await this.#send(event.message.chat_id, t('为避免授权链接暴露，请私聊机器人发送 /repair。'));
      return;
    }
    const actorOpenId = strictSenderOpenId(event);
    if (!actorOpenId) {
      await this.#send(event.message.chat_id, t('无法识别当前发送者，未发起修复。'));
      return;
    }
    if (!this.#repair) {
      await this.#send(event.message.chat_id, t('当前 Host 版本暂不支持聊天内修复，请先更新插件。'));
      return;
    }

    const parsed = REPAIR_COMMAND.exec(commandText);
    if (!parsed) {
      await this.#send(event.message.chat_id, t('用法：/repair、/repair qr、/repair status、/repair cancel 或 /repair verify'));
      return;
    }
    const operation = parsed[1]?.toLowerCase() ?? 'start';
    const chatId = event.message.chat_id;
    if (operation === 'start') {
      await this.#startRepair({ actorOpenId, chatId });
      return;
    }

    const attempt = this.#repairAttempt;
    if (!attempt) {
      await this.#send(
        chatId,
        t('当前 Runtime 没有可恢复的修复任务记录（机器人可能刚完成密钥更新并重启）。本命令不会启动新的授权；请查看机器人发送的验证结果，确认上一次任务已结束后再发送 /repair。'),
      );
      return;
    }
    if (attempt.actorOpenId !== actorOpenId) {
      await this.#send(chatId, t('另一位用户正在修复该机器人，本次不会显示其授权信息。'));
      return;
    }
    if (operation === 'cancel') {
      let snapshot;
      try {
        const result = await this.#repair.cancel(this.#repairArgs(attempt));
        snapshot = repairSnapshot(result, { botId: this.#botId });
        attempt.snapshot = snapshot;
      } catch {
        await this.#send(chatId, t('暂时无法取消修复任务，请稍后重试。'));
        return;
      }
      if (snapshot.state === 'cancelled') {
        attempt.stopped = true;
        this.#repairMonitorVersion += 1;
      }
      await this.#send(chatId, this.#repairStatusText(snapshot));
      return;
    }

    let snapshot;
    try {
      snapshot = await this.#refreshRepairAttempt(attempt);
    } catch {
      await this.#send(chatId, t('暂时无法查询修复状态，请稍后重试。'));
      return;
    }
    if (operation === 'qr') {
      if (!REPAIR_ACTIVE_STATES.has(snapshot.state) || !attempt.verificationUrl) {
        await this.#send(chatId, this.#repairStatusText(snapshot, { verificationFocused: true }));
        return;
      }
      await this.#sendRepairQr(chatId, attempt.verificationUrl, snapshot);
      return;
    }
    await this.#send(chatId, this.#repairStatusText(snapshot, {
      verificationFocused: operation === 'verify',
    }));
  }

  #repairArgs(attempt) {
    return {
      botId: this.#botId,
      attemptId: attempt.attemptId,
      actorOpenId: attempt.actorOpenId,
      chatId: attempt.chatId,
    };
  }

  async #startRepair({ actorOpenId, chatId }) {
    const previous = this.#repairAttempt;
    let restarted = false;
    if (previous && REPAIR_ACTIVE_STATES.has(previous.snapshot.state)) {
      if (previous.actorOpenId !== actorOpenId) {
        await this.#send(chatId, t('另一位用户正在修复该机器人，本次不会显示其授权信息。'));
        return;
      }
      let current;
      try {
        current = await this.#refreshRepairAttempt(previous);
      } catch {
        await this.#send(chatId, t('暂时无法查询修复状态，请稍后重试。'));
        return;
      }
      // Once Feishu has accepted the update, starting another attempt could
      // race the credential swap and callback probe. Status commands remain
      // available while that non-cancellable convergence is in progress.
      if (current.state === 'saving') {
        await this.#send(chatId, this.#repairStatusText(current));
        return;
      }
      // Feishu launcher links carry one-time user codes. Opening one with the
      // wrong Open Platform account can consume it even though authorization
      // did not succeed, so a fresh bare /repair must replace a still-waiting
      // attempt instead of redisplaying the same unusable URL.
      if (REPAIR_AUTHORIZATION_STATES.has(current.state)) {
        let cancelled;
        try {
          cancelled = repairSnapshot(
            await this.#repair.cancel(this.#repairArgs(previous)),
            { botId: this.#botId },
          );
          previous.snapshot = cancelled;
        } catch {
          await this.#send(chatId, t('暂时无法取消旧修复任务，未生成新链接；请稍后重试。'));
          return;
        }
        if (!REPAIR_TERMINAL_STATES.has(cancelled.state)) {
          await this.#send(chatId, this.#repairStatusText(cancelled));
          return;
        }
        previous.stopped = true;
        this.#repairMonitorVersion += 1;
        restarted = cancelled.state === 'cancelled';
      } else if (REPAIR_TERMINAL_STATES.has(current.state)) {
        previous.stopped = true;
        this.#repairMonitorVersion += 1;
      }
    }

    let snapshot;
    try {
      snapshot = repairSnapshot(await this.#repair.start({
        botId: this.#botId,
        actorOpenId,
        chatId,
      }), { botId: this.#botId });
      snapshot = await this.#waitForRepairLink(snapshot, { actorOpenId, chatId });
    } catch {
      await this.#send(chatId, t('修复流程暂时失败，现有机器人连接不受影响；请稍后发送 /repair 重试。'));
      return;
    }
    const attempt = {
      attemptId: snapshot.attemptId,
      actorOpenId,
      chatId,
      snapshot,
      verificationUrl: null,
      stopped: false,
      announcedSaving: false,
      announcedTerminal: false,
    };
    this.#repairAttempt = attempt;

    if (snapshot.verificationUrl) {
      try {
        attempt.verificationUrl = safeRepairUrl(snapshot.verificationUrl, this.#appId);
      } catch {
        attempt.stopped = true;
        await this.#repair.cancel(this.#repairArgs(attempt)).catch(() => undefined);
        await this.#send(chatId, t('飞书返回了无法安全验证的授权链接，已中止本次修复。'));
        return;
      }
    }
    if (REPAIR_TERMINAL_STATES.has(snapshot.state)) {
      attempt.announcedTerminal = true;
      if (snapshot.state !== 'succeeded') {
        await this.#send(chatId, this.#repairStatusText(snapshot));
      }
      return;
    }
    if (!attempt.verificationUrl) {
      attempt.stopped = true;
      await this.#send(chatId, t('飞书未返回授权链接，已中止本次修复。'));
      return;
    }
    await this.#sendRepairLink(chatId, attempt.verificationUrl, snapshot, { restarted });
    this.#monitorRepair(attempt);
  }

  async #waitForRepairLink(initial, context) {
    let current = initial;
    const deadline = Date.now() + this.#repairLinkWaitMs;
    while (!current.verificationUrl && REPAIR_ACTIVE_STATES.has(current.state)) {
      if (Date.now() >= deadline) throw new Error('Feishu repair link timed out');
      await abortableDelay(Math.min(100, this.#repairPollIntervalMs), this.#signal);
      current = repairSnapshot(await this.#repair.status({
        botId: this.#botId,
        attemptId: current.attemptId,
        actorOpenId: context.actorOpenId,
        chatId: context.chatId,
      }), { botId: this.#botId });
    }
    return current;
  }

  async #refreshRepairAttempt(attempt) {
    const snapshot = repairSnapshot(
      await this.#repair.status(this.#repairArgs(attempt)),
      { botId: this.#botId },
    );
    if (snapshot.attemptId !== attempt.attemptId) {
      throw new Error('Feishu repair attempt changed unexpectedly');
    }
    attempt.snapshot = snapshot;
    if (snapshot.verificationUrl) {
      attempt.verificationUrl = safeRepairUrl(snapshot.verificationUrl, this.#appId);
    }
    return snapshot;
  }

  #monitorRepair(attempt) {
    const version = ++this.#repairMonitorVersion;
    void (async () => {
      while (!attempt.stopped && this.#repairAttempt === attempt
        && this.#repairMonitorVersion === version
        && !this.#signal?.aborted) {
        const delayMs = Math.max(
          250,
          Math.min(10_000, attempt.snapshot.pollIntervalMs ?? this.#repairPollIntervalMs),
        );
        await abortableDelay(delayMs, this.#signal);
        if (attempt.stopped || this.#repairAttempt !== attempt || this.#repairMonitorVersion !== version) return;
        const snapshot = await this.#refreshRepairAttempt(attempt);
        if (snapshot.state === 'saving' && !attempt.announcedSaving) {
          attempt.announcedSaving = true;
          await this.#send(
            attempt.chatId,
            t('授权已确认，正在发送并等待测试按钮回调；收到真实回调后才会完成。'),
          );
        }
        if (REPAIR_TERMINAL_STATES.has(snapshot.state)) {
          attempt.stopped = true;
          // Runtime sends the verified-success notice before resolving the
          // controller probe. Avoid duplicating it here; failure terminals
          // still need an explicit chat-side explanation.
          if (snapshot.state !== 'succeeded' && !attempt.announcedTerminal) {
            attempt.announcedTerminal = true;
            await this.#send(attempt.chatId, this.#repairStatusText(snapshot));
          }
          return;
        }
      }
    })().catch(async () => {
      if (this.#signal?.aborted || attempt.stopped || this.#repairAttempt !== attempt) return;
      attempt.stopped = true;
      this.#logger.warn?.('[dsh-feishu] callback repair status monitoring failed');
      await this.#send(
        attempt.chatId,
        t('修复状态查询中断，现有机器人连接不受影响；发送 /repair status 重试查询。'),
      ).catch(() => undefined);
    });
  }

  async #sendRepairLink(chatId, url, snapshot, { restarted = false } = {}) {
    const remaining = snapshot.remainingSeconds
      ?? (snapshot.expiresAt ? Math.max(0, Math.ceil((snapshot.expiresAt - Date.now()) / 1000)) : null);
    const expiry = remaining === null
      ? t('链接为短期有效')
      : t('链接约 {minutes} 分钟后过期', { minutes: Math.max(1, Math.ceil(remaining / 60)) });
    await this.#send(chatId, [
      restarted ? t('旧授权链接已作废，已生成新的修复链接。') : t('🔧 准备补全权限与回调。'),
      t('本次会增量添加当前缺少项：卡片回调 card.action.trigger；im:message.group_msg（用于接收未 @ 的群消息）；飞书显示为“获取单聊、群组消息”的租户权限 im:message:readonly（用于读取用户消息中的图片或文件）；im:resource（用于上传机器人发送的图片或文件）；im:message.group_at_msg.include_bot:readonly（用于接收群内其他机器人 @ 当前机器人的消息）；以及原生命令面板所需的 application:app_slash_command:read / write。群回复方式保持不变，实际收到的群消息和文件会自动保存。确认页只会显示当前缺少的项；若出现上述范围之外的配置，请取消。'),
      '',
      t('当前设备直接打开：'),
      url,
      '',
      t('若要用另一台设备扫码，发送 /repair qr。{expiry}。', { expiry }),
    ].join('\n'));
  }

  async #sendRepairQr(chatId, url, snapshot) {
    try {
      const image = await QRCode.toBuffer(url, {
        errorCorrectionLevel: 'M', margin: 1, width: 480, type: 'png',
      });
      const uploaded = await this.#client.im.v1.image.create({
        data: { image_type: 'message', image },
      });
      const imageKey = nonEmptyString(uploaded?.image_key) ?? nonEmptyString(uploaded?.data?.image_key);
      if (!imageKey) throw new Error('Feishu QR upload returned no image key');
      const remaining = snapshot.remainingSeconds
        ?? (snapshot.expiresAt ? Math.max(0, Math.ceil((snapshot.expiresAt - Date.now()) / 1000)) : null);
      const remainingText = remaining === null
        ? ''
        : t('（剩余约 {minutes} 分钟）', { minutes: Math.max(1, Math.ceil(remaining / 60)) });
      await this.#send(
        chatId,
        t('请用另一台设备扫码完成授权{remaining}。', { remaining: remainingText }),
      );
      const response = await this.#client.im.v1.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          msg_type: 'image',
          content: JSON.stringify({ image_key: imageKey }),
        },
      });
      if (response?.code && response.code !== 0) throw new Error('Feishu QR message send failed');
    } catch {
      await this.#send(chatId, t('二维码暂时无法发送，请直接打开授权链接：\n{url}', { url }));
    }
  }

  #repairStatusText(snapshot, { verificationFocused = false } = {}) {
    if (snapshot.state === 'succeeded') {
      return t('✅ 修复完成：已实测收到 card.action.trigger，菜单按钮现在可用。');
    }
    if (snapshot.state === 'expired' || snapshot.error?.code === 'expired_token') {
      return t('授权链接已过期；平台未返回成功结果，无法确认已修复。发送 /repair 生成新链接。');
    }
    if (snapshot.state === 'cancelled' || snapshot.error?.code === 'abort') {
      return t('已取消本次修复授权，未确认完成修复。');
    }
    if (snapshot.error?.code === 'access_denied') {
      return t('你已取消或拒绝授权，没有确认修复；发送 /repair 可重试。');
    }
    if (snapshot.error?.code === 'card_action_probe_timeout'
      || snapshot.error?.code === 'card-action-probe-timeout') {
      return t('授权已提交，但未收到测试按钮回调。可能尚未点击或配置仍在传播；稍后发送 /repair verify 查询，不要盲目重复授权。');
    }
    if (snapshot.state === 'error') {
      return t('修复流程暂时失败，现有机器人连接不受影响；发送 /repair 可重试。');
    }
    if (snapshot.state === 'saving') {
      return t('授权已确认，正在等待专用测试按钮的真实回调；回调到达前不会宣告成功。');
    }
    if (verificationFocused) {
      return t('授权尚未完成，暂时不能验证卡片按钮。请先打开授权链接并确认。');
    }
    const remaining = snapshot.remainingSeconds === null
      ? ''
      : t('，剩余约 {minutes} 分钟', { minutes: Math.max(1, Math.ceil(snapshot.remainingSeconds / 60)) });
    return t('修复任务正在等待授权{remaining}。发送 /repair qr 可获取二维码，/repair cancel 可取消。', { remaining });
  }

  /**
   * Card button callback (card.action.trigger). The operator must be an
   * allowed sender: group members outside the allowlist must never drive
   * session binding, workspace switches or other card actions.
   */
  onCardAction(event) {
    const operatorOpenId = nonEmptyString(event?.operator?.open_id)
      ?? nonEmptyString(event?.operator?.user_id)
      // Keep accepting the legacy nested shape while preferring the current
      // card.action.trigger v2 payload used by the official SDK.
      ?? nonEmptyString(event?.operator?.operator_id?.open_id)
      ?? nonEmptyString(event?.operator?.operator_id?.user_id)
      ?? nonEmptyString(event?.open_id)
      ?? nonEmptyString(event?.user_id);
    if (!operatorOpenId) return Promise.resolve();
    if (!this.#accessPolicy
      && !this.#allowedSenderOpenIds.has('*')
      && !this.#allowedSenderOpenIds.has(operatorOpenId)) {
      this.#logger.warn?.('[dsh-feishu] ignoring card action from an unallowed legacy sender');
      return Promise.resolve();
    }
    const actionValue = callbackObject(event?.action?.value);
    const formValue = callbackObject(event?.action?.form_value);
    const action = nonEmptyString(actionValue.action)
      ?? nonEmptyString(event?.action?.action);
    if (!action) return Promise.resolve();
    // select_static dropdown: resolve pickers to their target actions
    const option = callbackSingleOption(event?.action?.option)
      ?? (action.endsWith('_pick') ? callbackMultiOptionValues(event?.action?.options)[0] : null);
    // The official Card 2.0 callback currently uses a comma-separated string
    // for multi-select values; older SDKs emitted arrays or value objects.
    const multiValues = [...new Set([
      ...callbackMultiOptionValues(actionValue.options),
      ...callbackMultiOptionValues(event?.action?.options),
      ...callbackMultiOptionValues(formValue[action]),
      ...(action === 'watch_add' || action === 'watch_remove'
        ? callbackMultiOptionValues(event?.action?.option)
        : []),
    ])];
    const resolvedAction = action === 'workspace_pick' && typeof option === 'string'
      ? `workspace:${option}`
      : action === 'session_pick' && typeof option === 'string'
        ? `use:${option}`
        : action === 'preset_pick' && typeof option === 'string'
          ? `preset:select:${option}`
          : action === 'model_pick' && typeof option === 'string'
            ? `model:select:${option}`
            : action === 'reasoning_pick' && typeof option === 'string'
              ? `reasoning:select:${option}`
              : action === 'archive_pick' && typeof option === 'string'
              ? `archive:${option}`
              : action === 'steer_pick' && typeof option === 'string'
                ? `steer:${option}`
                : action;
    const messageId = nonEmptyString(event?.context?.open_message_id)
      ?? nonEmptyString(event?.open_message_id)
      ?? nonEmptyString(event?.message_id);
    const route = messageId ? this.#cardKeys.get(messageId) : null;
    const modelPage = route?.modelPage ?? 0;
    if (!route) {
      // A route is also the trusted direct/group scope for the unified policy.
      // Without it, fail closed instead of producing an unauthorised side effect.
      if (this.#accessPolicy) return Promise.resolve();
      // Legacy callers without a unified policy still receive the current
      // expired-card guidance introduced by the upstream thread-reply fix.
      // The card predates this process (the in-memory mapping resets on
      // restart) or never came from us: nudge instead of staying silent.
      const chatId = nonEmptyString(event?.context?.open_chat_id)
        ?? nonEmptyString(event?.open_chat_id)
        ?? nonEmptyString(event?.chat_id);
      if (chatId) {
        this.#send(chatId, t('这个菜单已过期，请回复 /m 重新打开。'), { replyTo: messageId }).catch(() => undefined);
      }
      return Promise.resolve();
    }
    const conversationType = route.key.startsWith('p2p:') ? 'direct'
      : route.key.startsWith('group:') ? 'group' : null;
    const isInteractionResponse = resolvedAction.startsWith('approve:')
      || resolvedAction.startsWith('reject:')
      || resolvedAction.startsWith('answer:');
    const access = evaluateInboundAccess(this.#accessPolicy, {
      conversationType,
      senderIds: operatorOpenId,
      // These buttons are the card equivalent of an ordinary approval or
      // question reply. Every other card action remains command-gated.
      isCommand: !isInteractionResponse,
    });
    if (!access.allowed) {
      this.#logAccessDenied(conversationType, access.reason);
      if (access.reason === 'command-not-allowed') {
        return this.#send(route.chatId, t(COMMAND_PERMISSION_DENIED_MESSAGE))
          .catch(() => undefined);
      }
      return Promise.resolve();
    }
    // A used card is recent even if it was first created long ago.
    this.#cardKeys.delete(messageId);
    this.#cardKeys.set(messageId, route);
    const newSessionActionId = nonEmptyString(actionValue.newSessionActionId);
    if (resolvedAction === 'new' && (!route.menuContext || !newSessionActionId)) return Promise.resolve();
    const entry = { ...route, messageId, selections: multiValues, operatorOpenId, newSessionActionId, modelPage };
    const source = nonEmptyString(actionValue.source);
    const formText = nonEmptyString(formValue.steer_text);
    const eventId = nonEmptyString(event?.event_id)
      ?? nonEmptyString(event?.header?.event_id)
      ?? nonEmptyString(event?.uuid)
      ?? nonEmptyString(event?.header?.uuid);
    const identity = JSON.stringify({
      messageId,
      newSessionActionId,
      resolvedAction,
      option,
      multiValues,
      source,
      formText,
    });
    const isStop = resolvedAction === 'stop';
    const rawSteer = resolvedAction.startsWith('steer:')
      ? resolvedAction.slice('steer:'.length)
      : null;
    const isCustomSteer = rawSteer === 'custom' || rawSteer === STEER_CUSTOM_SENTINEL;
    const isRealSteer = (action === 'steer'
      && source === 'quick'
      && option !== null
      && option !== STEER_CUSTOM_SENTINEL)
      || (action === 'steer' && source === 'form' && formText !== null)
      || (rawSteer !== null && rawSteer !== '' && !isCustomSteer);

    return this.#queueCardAction(entry, identity, async () => {
      // 补充指令卡片：快捷下拉(source=quick, option=指令) / 表单提交(source=form)
      if (action === 'steer') {
        if (source === 'quick' && option) {
          if (option === STEER_CUSTOM_SENTINEL) {
            await this.#sendCard(entry.chatId, customSteerCard(), {
              key: entry.key,
              updateMessageId: entry.messageId,
            });
            return;
          }
          await this.#sendSteer(entry, option);
          return;
        }
        if (source === 'form') {
          if (formText) {
            await this.#sendSteer(entry, formText);
            return;
          }
          await this.#send(entry.chatId, t('请输入补充指令后再提交。'), { replyTo: entry.messageId ?? null });
          return;
        }
      }
      await this.#handleCardAction(resolvedAction, { ...entry, actor: entry.operatorOpenId });
    }, {
      lane: isStop || isRealSteer ? 'control' : 'regular',
      coalesceStop: isStop,
      eventId,
      operatorOpenId,
    });
  }

  #pruneCompletedCardActions(now = Date.now()) {
    for (const [key, expiresAt] of this.#completedCardActions) {
      if (expiresAt <= now) this.#completedCardActions.delete(key);
    }
    while (this.#completedCardActions.size > MAX_COMPLETED_CARD_ACTIONS) {
      const oldest = this.#completedCardActions.keys().next().value;
      if (oldest === undefined) break;
      this.#completedCardActions.delete(oldest);
    }
  }

  #rememberCompletedCardAction(key, now = Date.now()) {
    if (!key) return;
    this.#completedCardActions.delete(key);
    this.#completedCardActions.set(key, now + CARD_ACTION_DEDUPE_TTL_MS);
    this.#pruneCompletedCardActions(now);
  }

  #notifyCardOverflow(entry) {
    const conversation = entry.key;
    const now = Date.now();
    const existing = this.#cardOverloadNoticeAt.get(conversation);
    if (existing?.task || (existing && now - existing.at < CARD_OVERLOAD_NOTICE_COOLDOWN_MS)) {
      return existing?.task ?? Promise.resolve();
    }
    this.#logger.warn?.('[dsh-feishu] card action queue is full; dropping callbacks');
    let tracked;
    tracked = this.#send(entry.chatId, t('操作过于频繁，请稍后再试。'), { replyTo: entry.messageId ?? null })
      .catch(() => undefined)
      .finally(() => {
        this.#cardActionTasks.delete(tracked);
        const current = this.#cardOverloadNoticeAt.get(conversation);
        if (current?.task === tracked) this.#cardOverloadNoticeAt.set(conversation, { at: current.at, task: null });
      });
    this.#cardOverloadNoticeAt.delete(conversation);
    this.#cardOverloadNoticeAt.set(conversation, { at: now, task: tracked });
    this.#cardActionTasks.add(tracked);
    while (this.#cardOverloadNoticeAt.size > 200) {
      const oldest = this.#cardOverloadNoticeAt.keys().next().value;
      if (oldest === undefined) break;
      this.#cardOverloadNoticeAt.delete(oldest);
    }
    return tracked;
  }

  #queueCardAction(entry, identity, task, {
    lane = 'regular',
    coalesceStop = false,
    eventId = null,
    operatorOpenId = null,
  } = {}) {
    const conversation = entry.key;
    const completedKey = eventId
      ? `${conversation}\0${operatorOpenId ?? ''}\0event:${eventId}`
      : null;
    const dedupeKey = completedKey
      ?? `${conversation}\0${operatorOpenId ?? ''}\0action:${identity}`;
    const now = Date.now();
    this.#pruneCompletedCardActions(now);
    if (completedKey && (this.#completedCardActions.get(completedKey) ?? 0) > now) {
      return Promise.resolve();
    }
    const duplicate = this.#cardActionInFlight.get(dedupeKey);
    if (duplicate) return duplicate;
    if (coalesceStop) {
      const pendingStop = this.#cardStopInFlight.get(conversation);
      if (pendingStop) {
        if (completedKey) {
          // Remember only a bounded LRU of provider ids while the shared stop
          // is unresolved. They become completed only after that stop settles.
          this.#cardStopFollowers.delete(completedKey);
          this.#cardStopFollowers.set(completedKey, pendingStop);
          while (this.#cardStopFollowers.size > MAX_COMPLETED_CARD_ACTIONS) {
            const oldest = this.#cardStopFollowers.keys().next().value;
            if (oldest === undefined) break;
            this.#cardStopFollowers.delete(oldest);
          }
        }
        return pendingStop;
      }
    }

    const control = lane === 'control';
    const tails = control ? this.#cardControlTails : this.#cardActionTails;
    const counts = control ? this.#cardControlCounts : this.#cardActionCounts;
    const limit = control ? MAX_PENDING_CARD_CONTROLS_PER_KEY : MAX_PENDING_CARD_ACTIONS_PER_KEY;
    const pending = counts.get(conversation) ?? 0;
    // Reserve one bounded control slot for stop. All further stop clicks join
    // that task, so a flood cannot grow the queue beyond limit + 1.
    const pendingLimit = coalesceStop ? limit + 1 : limit;
    if (pending >= pendingLimit) {
      return this.#notifyCardOverflow(entry);
    }

    const previous = tails.get(conversation) ?? Promise.resolve();
    counts.set(conversation, pending + 1);

    let tracked;
    let started = false;
    tracked = previous
      .catch(() => undefined)
      .then(async () => {
        this.#signal?.throwIfAborted();
        started = true;
        await task();
      })
      .catch(async (error) => {
        if (this.#signal?.aborted) return;
        await this.#sendFailure(entry.chatId, error, { logLabel: 'card action', replyTo: entry.messageId });
      })
      .finally(() => {
        if (this.#cardActionInFlight.get(dedupeKey) === tracked) {
          this.#cardActionInFlight.delete(dedupeKey);
        }
        if (started && completedKey) {
          this.#rememberCompletedCardAction(completedKey);
        }
        if (coalesceStop && this.#cardStopInFlight.get(conversation) === tracked) {
          this.#cardStopInFlight.delete(conversation);
        }
        if (coalesceStop) {
          const settledAt = Date.now();
          for (const [followerKey, pendingStop] of this.#cardStopFollowers) {
            if (pendingStop !== tracked) continue;
            this.#cardStopFollowers.delete(followerKey);
            this.#rememberCompletedCardAction(followerKey, settledAt);
          }
        }
        if (tails.get(conversation) === tracked) tails.delete(conversation);
        const remaining = (counts.get(conversation) ?? 1) - 1;
        if (remaining > 0) counts.set(conversation, remaining);
        else counts.delete(conversation);
        this.#cardActionTasks.delete(tracked);
      });
    this.#cardActionInFlight.set(dedupeKey, tracked);
    if (coalesceStop) this.#cardStopInFlight.set(conversation, tracked);
    this.#cardActionTasks.add(tracked);
    tails.set(conversation, tracked);
    return tracked;
  }

  async #handleCardAction(action, {
    chatId,
    key,
    messageId = null,
    conversationWorkspace,
    sessionWorkspace = null,
    sessionPage = 0,
    sessionLimit = null,
    modelPage = 0,
    selections = [],
    actor = null,
    menuContext = null,
    newSessionActionId = null,
    fromMessageQueue = false,
  }) {
    // Confirmations triggered by a card interaction stay anchored to the
    // card's message so they land inside the same Feishu topic.
    this.#rememberTopicReply(messageId, key);
    const reply = (text) => this.#send(chatId, text, { replyTo: messageId });
    // Approval card buttons: approve:<approvalId> / reject:<approvalId>
    if (action.startsWith('approve:') || action.startsWith('reject:')) {
      const sep = action.indexOf(':');
      const approvalId = action.slice(sep + 1);
      const outcome = action.startsWith('approve:') ? 'allowed-once' : 'rejected';
      // Bind the decision to the operator so another allowed group member
      // cannot decide someone else's approval.
      const submitted = await this.#approvals.submitByApprovalId(approvalId, outcome, { actor });
      if (!submitted) {
        await reply(t('该审批已处理或不存在，无需重复操作。')).catch(() => undefined);
      }
      return;
    }
    // Question option buttons: answer:<interactionId>:<index>:<optionLabel>
    if (action.startsWith('answer:')) {
      const rest = action.slice('answer:'.length);
      const firstSep = rest.indexOf(':');
      if (firstSep !== -1) {
        const interactionId = rest.slice(0, firstSep);
        const afterId = rest.slice(firstSep + 1);
        const indexSep = afterId.indexOf(':');
        const indexText = indexSep === -1 ? afterId : afterId.slice(0, indexSep);
        const optionLabel = indexSep === -1 ? '' : afterId.slice(indexSep + 1);
        const qKey = this.#interactionKeys.get(interactionId);
        const pending = qKey ? this.#pendingInteractions.get(qKey) : null;
        // Only the actor who started the interaction may answer it, and the
        // card must still target the current question (a stale card from an
        // earlier question in a multi-question interaction must not submit).
        if (pending && pending.kind === 'question' && !pending.submitting
          && pending.actor === actor
          && Number(indexText) === pending.index) {
          await this.#submitQuestionAnswer(pending, optionLabel, { chatId, questionMessageId: messageId });
        } else {
          // issue #162：pending 已清除时区分「已答过」与「其他客户端处理」，
          // 避免对同一张提问卡的重复点击弹出误导提示。
          const staleNotice = pending
            ? INTERACTION_RESOLVED_TEXT()
            : this.#isAnsweredInteraction(interactionId)
              ? t('这个问题已经回答过了。')
              : INTERACTION_RESOLVED_TEXT();
          await reply(staleNotice).catch(() => undefined);
        }
      }
      return;
    }
    // issue #162：自定义答案入口——与 answer: 同构校验；通过后引导用户直接
    // 发送文字消息（canClaimInteractionReply 语义：同 actor 的文本即答案）。
    if (action.startsWith('answerCustom:')) {
      const rest = action.slice('answerCustom:'.length);
      const sep = rest.indexOf(':');
      if (sep !== -1) {
        const interactionId = rest.slice(0, sep);
        const indexText = rest.slice(sep + 1);
        const qKey = this.#interactionKeys.get(interactionId);
        const pending = qKey ? this.#pendingInteractions.get(qKey) : null;
        if (pending && pending.kind === 'question' && !pending.submitting
          && pending.actor === actor && Number(indexText) === pending.index) {
          await reply(t('想自定义答案？直接发送文字消息即可，将作为本题答案提交。')).catch(() => undefined);
        } else if (!pending && this.#isAnsweredInteraction(interactionId)) {
          await reply(t('这个问题已经回答过了。')).catch(() => undefined);
        } else {
          await reply(INTERACTION_RESOLVED_TEXT()).catch(() => undefined);
        }
      }
      return;
    }
    if (action === 'sessions' || /^sessions:\d+$/.test(action)) {
      const page = action === 'sessions' ? 0 : Number(action.slice('sessions:'.length));
      await this.#showSessions(
        { chatId, key, replyTo: messageId },
        sessionWorkspace,
        page,
        { updateMessageId: messageId, limit: sessionLimit },
      );
      return;
    }
    if (action === 'workspaces') {
      await this.#showWorkspaces({ chatId, key, replyTo: messageId }, { updateMessageId: messageId });
      return;
    }
    if (action === 'watchlist') {
      await this.#showWatchList(key, chatId, { updateMessageId: messageId, replyTo: messageId });
      return;
    }
    // 多选关注下拉：action=watch_add / watch_remove，选中项在 selections 数组
    if (action === 'watch_add' || action === 'watch_remove') {
      if (selections.length === 0) {
        await reply(t('请先选择至少一个会话。'));
        return;
      }
      let changed = 0;
      let failed = 0;
      if (action === 'watch_add') {
        let freshTargets = new Map();
        try {
          freshTargets = await this.#freshWatchTargets(sessionWorkspace);
        } catch (error) {
          this.#logger.warn?.('[dsh-feishu] batch watch validation failed:', error.message);
        }
        for (const sessionId of selections) {
          const validatedTarget = freshTargets.get(sessionId);
          if (!validatedTarget) {
            failed += 1;
            continue;
          }
          const result = await this.#runWatch(key, chatId, sessionId, {
            notify: false,
            validatedTarget,
            replyTo: messageId,
          });
          if (result.changed) changed += 1;
          else if (!result.ok) failed += 1;
        }
      } else {
        for (const sessionId of selections) {
          const result = await this.#runUnwatch(key, chatId, sessionId, { notify: false });
          if (result.changed) changed += 1;
          else if (!result.ok) failed += 1;
        }
      }
      const summary = changed > 0 && failed > 0
        ? action === 'watch_add'
          ? t('已批量关注 {count} 个会话，另有 {failed} 个未成功。', { count: changed, failed })
          : t('已取消关注 {count} 个会话，另有 {failed} 个未成功。', { count: changed, failed })
        : changed > 0
          ? action === 'watch_add'
            ? t('已批量关注 {count} 个会话。', { count: changed })
            : t('已取消关注 {count} 个会话。', { count: changed })
          : failed > 0
            ? t('所选会话均未处理成功，请稍后重试。')
            : action === 'watch_add'
              ? t('所选会话已在关注列表中。')
              : t('所选会话已不在关注列表中。');
      try {
        await this.#showWatchList(key, chatId, { updateMessageId: messageId, replyTo: messageId });
      } catch (error) {
        this.#logger.warn?.('[dsh-feishu] watch list refresh failed:', error.message);
      }
      await reply(summary).catch((error) => {
        this.#logger.warn?.('[dsh-feishu] watch batch summary failed:', error.message);
      });
      return;
    }
    if (action === 'new') {
      if (menuContext || newSessionActionId) {
        await this.#handleNewSessionMenu({ key, chatId, messageId, menuContext, newSessionActionId });
        return;
      }
      // A queued menu pick runs after earlier messages; its own unfinished
      // queue (including later messages) must not prevent the reset.
      if ((!fromMessageQueue && this.#queues.has(key)) || this.#hasPendingInteraction(key)) {
        await reply(t('当前任务仍在运行，请先停止任务或等待任务完成后再开启新会话。'));
        return;
      }
      await reply(await startNewConversation({ state: this.#state, harness: this.#harness, key }));
      await this.#sendMenuCard(key, chatId, { updateMessageId: messageId, replyTo: messageId });
      return;
    }
    if (action === 'use:current') {
      const sessionId = this.#state.sessionFor(key);
      if (typeof sessionId !== 'string' || !sessionId) {
        await reply(t('当前没有绑定的会话，请先从会话列表选择。'));
        return;
      }
      await reply(t('已就绪，直接发消息即可继续当前会话。'));
      return;
    }
    if (action === 'archive_toggle' || action === 'archive:on' || action === 'archive:off') {
      const next = action === 'archive:on' ? true : action === 'archive:off' ? false : !(this.#state?.includesArchivedSessions?.() ?? false);
      await this.#state?.setIncludeArchivedSessions?.(next);
      await reply(
        next ? t('已开启：会话列表包含归档会话。') : t('已关闭：会话列表隐藏归档会话。'),
      );
      await this.#sendMenuCard(key, chatId, { updateMessageId: messageId, replyTo: messageId });
      return;
    }
    if (action === 'repair') {
      await reply(t('修复需在私聊中验证接入者身份，请直接发送 /repair 开始。'));
      return;
    }
    if (action === 'compact') {
      await this.#handleCompact(key, chatId, messageId);
      return;
    }
    if (action === 'clear') {
      await this.#handleClear(key, chatId, messageId);
      return;
    }
    if (action === 'stop') {
      await this.#handleStop(key, chatId, messageId);
      return;
    }
    if (action === 'steer') {
      await this.#showSteerCard(key, chatId, { updateMessageId: messageId });
      return;
    }
    // 主菜单「补充指令」下拉：option = steer:<指令> / steer:custom
    if (action.startsWith('steer:')) {
      const raw = action.slice('steer:'.length);
      if (raw === 'custom') {
        await this.#sendCard(chatId, customSteerCard(), { key, updateMessageId: messageId, replyTo: messageId });
        return;
      }
      await this.#sendSteer({ key, chatId, messageId, actor }, raw);
      return;
    }
    if (action === 'presets') {
      await this.#showPresetCard(key, chatId, { updateMessageId: messageId });
      return;
    }
    if (action === 'models' || /^models:\d+$/.test(action)) {
      const page = action === 'models' ? 0 : Number(action.slice('models:'.length));
      await this.#showModelCard(key, chatId, { updateMessageId: messageId, page: Math.max(0, page) });
      return;
    }
    if (action === 'status') {
      await this.#showStatusCard(key, chatId, { updateMessageId: messageId });
      return;
    }
    if (action === 'help') {
      await this.#showHelpCard(key, chatId, { updateMessageId: messageId });
      return;
    }
    if (action === 'back_to_menu') {
      await this.#sendMenuCard(key, chatId, { updateMessageId: messageId, replyTo: messageId });
      return;
    }
    if (action === 'preset_default') {
      await this.#handlePresetDefault(key, chatId, { updateMessageId: messageId });
      return;
    }
    if (action.startsWith('preset:select:')) {
      const presetId = action.slice('preset:select:'.length);
      // 哨兵值 = 用户在预设下拉里选了「跟随默认」
      if (presetId === PRESET_FOLLOW_DEFAULT_SENTINEL) {
        await this.#handlePresetDefault(key, chatId, { updateMessageId: messageId });
        return;
      }
      await this.#handlePresetSelect(key, chatId, presetId, { updateMessageId: messageId });
      return;
    }
    if (action.startsWith('model:select:')) {
      const modelId = action.slice('model:select:'.length);
      await this.#handleModelSelect(key, chatId, modelId, { updateMessageId: messageId, page: modelPage });
      return;
    }
    if (action.startsWith('reasoning:select:')) {
      const effort = action.slice('reasoning:select:'.length);
      await this.#handleReasoningSelect(key, chatId, effort, { updateMessageId: messageId, page: modelPage });
      return;
    }
    if (action.startsWith('use:')) {
      if (conversationWorkspace !== undefined && conversationWorkspace !== this.#conversationWorkspace(key)) {
        await reply(t('这个菜单已过期，请回复 /m 重新打开。'));
        return;
      }
      await this.#bindSession(key, chatId, action.slice('use:'.length), { updateMessageId: messageId, replyTo: messageId });
      return;
    }
    if (action.startsWith('workspace:')) {
      await this.#switchWorkspace(key, chatId, action.slice('workspace:'.length), { updateMessageId: messageId, replyTo: messageId });
      return;
    }
    if (action.startsWith('unwatch:')) {
      const result = await this.#runUnwatch(key, chatId, action.slice('unwatch:'.length), { replyTo: messageId });
      if (result.ok && messageId) {
        await this.#showSessions(
          { chatId, key, replyTo: messageId },
          sessionWorkspace,
          sessionPage,
          { updateMessageId: messageId, limit: sessionLimit },
        );
      }
      return;
    }
    if (action.startsWith('watch:')) {
      const sessionId = action.slice('watch:'.length);
      const result = await this.#runWatch(key, chatId, sessionId, {
        workspaceHint: sessionWorkspace,
        replyTo: messageId,
      });
      if (result.ok && messageId) {
        await this.#showSessions(
          { chatId, key, replyTo: messageId },
          sessionWorkspace,
          sessionPage,
          { updateMessageId: messageId, limit: sessionLimit },
        );
      }
    }
  }

  async #handleNewSessionMenu({ key, chatId, messageId, menuContext, newSessionActionId }) {
    // The generation belongs to this rendered menu, not the whole conversation.
    // Check inside the queue as well as consuming the action before any await:
    // distinct provider events and late callbacks must not clear a later session.
    const action = menuContext?.newSessionAction;
    if (!action || this.#cardKeys.get(messageId)?.menuContext !== menuContext
      || action.id !== newSessionActionId
      || !['idle', 'failed'].includes(action.status)) return;

    action.status = 'processing';
    delete action.message;
    await this.#patchCardMessage(chatId, messageId, menuCard(menuContext));

    const finish = async (status, message = null) => {
      if (menuContext.currentSession && !this.#state.sessionFor(key)) {
        menuContext.currentSession = null;
        // The old menu may show a session-specific model. After unbinding,
        // refresh the bot default just as opening a fresh menu would.
        try {
          menuContext.modelCatalog = await this.#harness.listModels({ signal: this.#cardDataSignal() });
        } catch {
          menuContext.modelCatalog = null;
        }
      }
      menuContext.newSessionAction = {
        id: status === 'failed' ? randomUUID() : action.id,
        status,
        message,
      };
      const patched = await this.#patchCardMessage(chatId, messageId, menuCard(menuContext));
      if (!patched) {
        await this.#send(chatId, t('新会话操作的卡片状态未能更新，请发送 /m 重新打开菜单。'), { replyTo: messageId })
          .catch((error) => this.#logger.warn?.('[dsh-feishu] menu state notice failed:', error?.message));
      }
    };
    // A task can start while Feishu is updating the processing card.
    if (this.#queues.has(key) || this.#hasPendingInteraction(key)) {
      const message = t('当前任务仍在运行，请先停止任务或等待任务完成后再开启新会话。');
      await finish('failed', message);
      await this.#send(chatId, message, { replyTo: messageId });
      return;
    }
    let receipt;
    try {
      receipt = await startNewConversation({ state: this.#state, harness: this.#harness, key });
    } catch (error) {
      // A persistence error can still leave the in-memory binding cleared.
      await finish('failed', safeErrorText(error));
      throw error;
    }
    await finish('success');
    // A receipt delivery failure must not turn a completed reset into a retry.
    await this.#send(chatId, receipt, { replyTo: messageId })
      .catch((error) => this.#logger.warn?.('[dsh-feishu] new session receipt failed:', error?.message));
  }

  #rememberMenu(key, menu) {
    if (this.#menus.size >= MAX_TRACKED_MENUS) {
      const oldest = this.#menus.keys().next().value;
      if (oldest !== undefined) this.#menus.delete(oldest);
    }
    this.#menus.delete(key);
    this.#menus.set(key, { ...menu, expiresAt: Date.now() + MENU_TTL_MS });
  }

  #takeMenu(key) {
    const menu = this.#menus.get(key);
    if (!menu) return null;
    if (menu.expiresAt < Date.now()) {
      this.#menus.delete(key);
      return null;
    }
    return menu;
  }

  async #handleMenuPick(menu, number, { chatId, key, event }) {
    const replyTo = event?.message?.message_id ?? null;
    const reply = (text) => this.#send(chatId, text, { replyTo });
    if (menu.kind === 'menu') {
      // Number fallback for the total menu:
      // 1=工作区列表 2=新会话 3=会话列表 4=状态 5=修复 6=帮助
      const actions = ['workspaces', 'new', 'sessions', 'status', 'repair', 'help'];
      const action = actions[number - 1];
      if (!action) {
        await reply(t('菜单没有这个编号，回复 /m 重新打开。'));
        return;
      }
      if (action === 'repair') {
        await this.#handleRepairCommand(event, '/repair');
        return;
      }
      await this.#handleCardAction(action, {
        chatId, key, messageId: replyTo, fromMessageQueue: action === 'new',
      });
      return;
    }
    if (menu.kind === 'sessions') {
      const session = menu.sessions[number - 1];
      if (!session?.sessionId) {
        await reply(t('本页只有 {count} 个会话，回复 /sessionlist 重新查看。', { count: menu.sessions.length }));
        return;
      }
      // The number label sits on the session (bind) button of the row.
      await this.#handleCardAction(`use:${session.sessionId}`, {
        chatId, key, messageId: replyTo, conversationWorkspace: menu.conversationWorkspace,
      });
      return;
    }
    if (menu.kind === 'workspaces') {
      const workspace = menu.paths[number - 1];
      if (!workspace) {
        await reply(t('只有 {count} 个工作区，回复 /workspacelist 重新查看。', { count: menu.paths.length }));
        return;
      }
      await this.#handleCardAction(`workspace:${workspace}`, { chatId, key, messageId: replyTo });
      return;
    }
    if (menu.kind === 'watches') {
      const entry = menu.entries[number - 1];
      if (!entry?.sessionId) {
        await reply(t('关注列表只有 {count} 个会话。', { count: menu.entries.length }));
        return;
      }
      await this.#handleCardAction(`unwatch:${entry.sessionId}`, { chatId, key, messageId: replyTo });
    }
  }

  /** The sessions visible under the bot's archived policy. */
  #visibleSessions(sessions) {
    if (this.#state?.includesArchivedSessions?.() === false) {
      return sessions.filter((session) => session.archived !== true);
    }
    return sessions;
  }

  #conversationWorkspace(key) {
    return typeof this.#harness.currentConversationWorkspace === 'function'
      ? this.#harness.currentConversationWorkspace(key)
      : this.#harness.currentWorkspace?.();
  }

  async #showSessions(
    { chatId, key, replyTo = null },
    selector,
    page = 0,
    { updateMessageId = null, limit = null } = {},
  ) {
    try {
      const conversationWorkspace = this.#conversationWorkspace(key);
      const signal = this.#cardDataSignal();
      const resolved = await resolveSessionListWorkspace(selector ?? '', this.#harness, {
        signal, conversationKey: key,
      });
      if (resolved.error) {
        await this.#send(chatId, resolved.error, { replyTo });
        return;
      }
      const listed = await this.#harness.listWorkspaceSessions(resolved.workspace, { signal });
      if (conversationWorkspace !== undefined && conversationWorkspace !== this.#conversationWorkspace(key)) {
        await this.#send(chatId, t('这个菜单已过期，请回复 /m 重新打开。'), { replyTo });
        return;
      }
      const visibleSessions = this.#visibleSessions(Array.isArray(listed?.sessions) ? listed.sessions : []);
      const sessionLimit = Number.isSafeInteger(limit) && limit > 0 ? limit : null;
      const sessions = sessionLimit === null
        ? visibleSessions
        : visibleSessions.slice(0, sessionLimit);
      const workspace = listed?.workspace ?? resolved.workspace;
      if (sessions.length === 0) {
        await this.#send(chatId, t('工作区：{workspace}\n该工作区暂无会话。', { workspace }), { replyTo });
        return;
      }
      const pageCount = Math.ceil(sessions.length / MENU_PAGE_SIZE);
      const safePage = Number.isSafeInteger(page) && page > 0 ? Math.min(page, pageCount - 1) : 0;
      const watchedSet = new Set(
        (this.#state.watchEntries?.(key) ?? []).map((entry) => entry.sessionId),
      );
      const pageSlice = sessions.slice(safePage * MENU_PAGE_SIZE, (safePage + 1) * MENU_PAGE_SIZE);
      this.#rememberMenu(key, {
        kind: 'sessions',
        conversationWorkspace,
        sessions: pageSlice.map((session) => ({ ...session, watched: watchedSet.has(session.sessionId) })),
      });
      await this.#sendCard(
        chatId,
        sessionListCard(workspace, sessions, safePage, sessions.length, watchedSet, boundSessionIdFor(this.#state, key)),
        {
          key,
          updateMessageId,
          replyTo,
          // The effective conversation workspace is separate from an explicit
          // list selector, which may intentionally point at another workspace.
          conversationWorkspace,
          // Keep the canonical selector result for later page callbacks. The
          // list response's workspace is display data and is not authoritative.
          sessionWorkspace: resolved.workspace,
          sessionPage: safePage,
          sessionLimit,
        },
      );
    } catch (error) {
      await this.#sendFailure(chatId, error, { logLabel: 'session list', replyTo });
    }
  }

  async #showWorkspaces({ chatId, key, replyTo = null }, { updateMessageId = null, includeConversationDirectories = false } = {}) {
    try {
      const { current, paths, titles } = await workspacePathSnapshot(
        this.#harness,
        { signal: this.#cardDataSignal(), includeTitles: true, includeConversationDirectories },
      );
      this.#rememberMenu(key, { kind: 'workspaces', paths });
      await this.#sendCard(
        chatId,
        workspaceListCard(paths, current, titles),
        { key, updateMessageId, replyTo },
      );
    } catch (error) {
      await this.#sendFailure(chatId, error, { logLabel: 'workspace list', replyTo });
    }
  }

  async #bindSession(key, chatId, sessionId, { updateMessageId = null, replyTo = null } = {}) {
    try {
      const bound = await this.#harness.bindWorkspaceSession(key, sessionId);
      const title = String(bound?.title ?? '').replace(/\s+/gu, ' ').trim() || t('暂无标题');
      await this.#send(chatId, [
        t('已绑定会话「{title}」\nID：{id}', { title, id: bound?.sessionId ?? sessionId }),
        t('发送 /history 查看最近对话。'),
      ].join('\n'), { replyTo });
      await this.#sendMenuCard(key, chatId, { updateMessageId, replyTo });
    } catch (error) {
      await this.#sendFailure(chatId, error, {
        logLabel: 'session binding',
        replyTo,
        userMessage: t('绑定失败：{message}', { message: safeErrorText(error) }),
      });
    }
  }

  async #switchWorkspace(key, chatId, workspace, { updateMessageId = null, replyTo = null } = {}) {
    try {
      const current = await this.#harness.switchWorkspace(workspace);
      await this.#send(chatId, t('工作区已切换为：{workspace}', { workspace: current }), { replyTo });
      await this.#sendMenuCard(key, chatId, { updateMessageId, replyTo });
    } catch (error) {
      await this.#sendFailure(chatId, error, {
        logLabel: 'workspace switch',
        replyTo,
        userMessage: t('切换失败：{message}', { message: safeErrorText(error) }),
      });
    }
  }

  #rememberCardRoute(messageId, chatId, options) {
    if (!options.key || !messageId) return;
    this.#cardKeys.delete(messageId);
    this.#cardKeys.set(messageId, {
      key: options.key,
      chatId,
      conversationWorkspace: options.conversationWorkspace,
      menuContext: options.menuContext ?? null,
      sessionWorkspace: typeof options.sessionWorkspace === 'string' && options.sessionWorkspace
        ? options.sessionWorkspace
        : null,
      sessionPage: Number.isSafeInteger(options.sessionPage) && options.sessionPage >= 0
        ? options.sessionPage
        : 0,
      modelPage: Number.isSafeInteger(options.modelPage) && options.modelPage >= 0
        ? options.modelPage
        : 0,
      sessionLimit: Number.isSafeInteger(options.sessionLimit) && options.sessionLimit > 0
        ? options.sessionLimit
        : null,
    });
    if (this.#cardKeys.size > 200) {
      const oldest = this.#cardKeys.keys().next().value;
      if (oldest !== undefined) this.#cardKeys.delete(oldest);
    }
  }

  /**
   * 已处理交互卡的原地替换。patch 失败仅记录警告并明确降级——
   * 回执缺失不应影响答案提交，也不得像 #sendCard 那样回退成发送新卡。
   */
  async #patchCardMessage(chatId, messageId, cardJson) {
    if (!messageId) return null;
    try {
      const response = await this.#client.im.v1.message.patch({
        path: { message_id: messageId },
        data: { content: cardJson },
      });
      if (response?.code && response.code !== 0) {
        throw new Error(`Feishu card update failed: ${response.msg || response.code}`);
      }
      return messageId;
    } catch (error) {
      this.#logger.warn?.('[dsh-feishu] resolved interaction card patch failed:', error?.message ?? error);
      return null;
    }
  }

  #cardRequest(stage, operation) {
    return waitForFeishuOperation(operation, {
      signal: this.#signal,
      timeoutMs: this.#requestTimeoutMs,
      stage: `${stage} (${this.#requestTimeoutMs}ms)`,
    });
  }

  async #sendCard(chatId, cardJson, options = {}) {
    const updateMessageId = nonEmptyString(options.updateMessageId);
    const replyTo = nonEmptyString(options.replyTo);

    // Session-sync cards target the user's openId (the synced DM is a user,
    // not a chat), delivered fresh without topic/thread handling.
    if (options.receiveIdType === 'open_id') {
      const response = await this.#cardRequest('card create', () => this.#client.im.v1.message.create({
        params: { receive_id_type: 'open_id' },
        data: {
          receive_id: chatId,
          msg_type: 'interactive',
          content: cardJson,
        },
      }));
      if (response?.code && response.code !== 0) {
        throw new Error(`Feishu card send failed: ${response.msg || response.code}`);
      }
      const sentId = nonEmptyString(response?.data?.message_id);
      if (!sentId) throw new Error('Feishu card send returned no message_id');
      this.#rememberCardRoute(sentId, response?.data?.chat_id ?? chatId, options);
      return sentId;
    }

    if (updateMessageId) {
      try {
        const response = await this.#cardRequest('card patch', () => this.#client.im.v1.message.patch({
          path: { message_id: updateMessageId },
          data: { content: cardJson },
        }));
        if (response?.code && response.code !== 0) {
          throw new Error(`Feishu card update failed: ${response.msg || response.code}`);
        }
        this.#rememberCardRoute(updateMessageId, chatId, options);
        return updateMessageId;
      } catch (error) {
        this.#logger.warn?.('[dsh-feishu] card update failed:', error?.code ?? error?.message ?? error, 'sending new');
      }
    }

    // A brand-new card triggered by an inbound message is delivered as a
    // threaded reply so it lands inside the same Feishu topic. Falls back to
    // a plain chat message when the referenced message is gone.
    const content = cardJson;
    if (replyTo) {
      try {
        const response = await this.#cardRequest('card reply', () => this.#client.im.v1.message.reply({
          path: { message_id: replyTo },
          data: {
            msg_type: 'interactive',
            content,
            ...(this.#replyInThreadFor(replyTo) ? { reply_in_thread: true } : {}),
          },
        }));
        if (response?.code && response.code !== 0) {
          throw new Error(`Feishu card reply failed: ${response.msg || response.code}`);
        }
        const repliedMessageId = nonEmptyString(response?.data?.message_id);
        await this.#registerTopicFromReply(replyTo, chatId, response);
        if (repliedMessageId) {
          this.#rememberCardRoute(repliedMessageId, chatId, options);
          return repliedMessageId;
        }
      } catch (error) {
        this.#logger.warn?.('[dsh-feishu] threaded card reply failed; sending a plain card:', error?.message ?? String(error));
        // The topic never opened; a managed root candidate must not linger.
        this.#forgetTopicRoot(replyTo);
      }
    }
    const response = await this.#cardRequest('card create', () => this.#client.im.v1.message.create({
      params: { receive_id_type: 'chat_id' },
      data: { receive_id: chatId, msg_type: 'interactive', content: cardJson },
    }));
    if (response?.code && response.code !== 0) {
      throw new Error(`Feishu card send failed: ${response.msg || response.code}`);
    }
    const messageId = nonEmptyString(response?.data?.message_id);
    this.#rememberCardRoute(messageId, chatId, options);
    return messageId;
  }

  async #sendMenuCard(key, chatId, { updateMessageId = null, replyTo = null } = {}) {
    await this.#state.markMenuIntroduction?.(key);
    const conversationWorkspace = this.#conversationWorkspace(key);
    let currentSessionId = null;
    let directSessionTitle = null;
    try {
      const sessionId = this.#state.sessionFor(key);
      if (typeof sessionId === 'string' && sessionId) {
        currentSessionId = sessionId;
        const session = this.#harness.workspaceSession?.(sessionId, key);
        directSessionTitle = nonEmptyString(session?.title)
          ?? nonEmptyString(session?.name)
          ?? nonEmptyString(session?.displayName);
      }
    } catch { /* render without a selected session */ }

    const dataSignal = this.#cardDataSignal();
    // Independent sections start together. Each one degrades on its own so a
    // slow preset/model RPC cannot force redundant session-list scans.
    const workspaceTask = workspacePathSnapshot(this.#harness, { signal: dataSignal, includeTitles: true })
      .catch(() => {
        const current = typeof this.#harness.currentWorkspace === 'function'
          ? this.#harness.currentWorkspace()
          : null;
        return { current, paths: current ? [current] : [] };
      });
    const sessionTask = (async () => {
      if (typeof this.#harness.listWorkspaceSessions !== 'function') return [];
      try {
        const resolved = await resolveSessionListWorkspace('', this.#harness, {
          signal: dataSignal, conversationKey: key,
        });
        if (resolved.error) return [];
        const listed = await this.#harness.listWorkspaceSessions(resolved.workspace, { signal: dataSignal });
        return this.#visibleSessions(Array.isArray(listed?.sessions) ? listed.sessions : []);
      } catch {
        return [];
      }
    })();
    const presetTask = (async () => {
      try {
        const settings = await this.#harness.agentPresetSettings({ signal: dataSignal });
        return { ...settings.agentPresetCatalog, _currentId: settings.agentPreset };
      } catch {
        return null;
      }
    })();
    const modelTask = (async () => {
      try {
        if (currentSessionId) {
          const session = this.#harness.workspaceSession?.(currentSessionId, key);
          if (typeof session?.models === 'function') {
            return await session.models({ signal: dataSignal });
          }
        }
        return await this.#harness.listModels({ signal: dataSignal });
      } catch {
        return null;
      }
    })();

    const [snapshot, listedSessions, presetCatalog, modelCatalog] = await Promise.all([
      workspaceTask,
      sessionTask,
      presetTask,
      modelTask,
    ]);
    if (conversationWorkspace !== undefined && conversationWorkspace !== this.#conversationWorkspace(key)) {
      await this.#send(chatId, t('这个菜单已过期，请回复 /m 重新打开。'), { replyTo });
      return;
    }
    const workspaces = Array.isArray(snapshot.paths) ? snapshot.paths : [];
    const currentWorkspace = snapshot.current ?? null;
    const currentMatch = listedSessions.find((session) => session.sessionId === currentSessionId);
    const currentSessionTitle = currentSessionId
      ? nonEmptyString(currentMatch?.title)
        ?? nonEmptyString(currentMatch?.name)
        ?? directSessionTitle
        ?? currentSessionId
      : null;
    let sessions = listedSessions
      .map((session) => ({
        id: session.sessionId,
        title: session.title ?? session.name ?? session.sessionId,
      }))
      .slice(0, 20);
    // 确保当前绑定会话始终出现在下拉最前（它可能不在最近列表里），
    // 否则 initial_index 找不到默认展示项，下拉会显示占位文本。
    if (currentSessionId) {
      sessions = sessions.filter((s) => s.id !== currentSessionId);
      sessions.unshift({ id: currentSessionId, title: currentSessionTitle ?? currentSessionId });
      sessions = sessions.slice(0, 20);
    }
    const archiveVisible = this.#state?.includesArchivedSessions?.() ?? false;
    this.#rememberMenu(key, { kind: 'menu', chatId });
    const menuContext = {
      workspaces, currentWorkspace, workspaceTitles: snapshot.titles,
      currentSession: currentSessionId ? { id: currentSessionId, title: currentSessionTitle } : null,
      sessions, archiveVisible, presetCatalog, modelCatalog,
      newSessionAction: { id: randomUUID(), status: 'idle' },
    };
    await this.#sendCard(
      chatId,
      menuCard(menuContext),
      { key, updateMessageId, replyTo, conversationWorkspace, menuContext },
    );
  }

  /**
   * Resolve a human-readable title for a bound session when available.
   * Attempts the workspace-session object first, then falls back to the
   * current workspace's session list. Returns null on any failure.
   */
  async #resolveSessionTitle(key, sessionId) {
    try {
      if (typeof this.#harness.workspaceSession === 'function') {
        const session = this.#harness.workspaceSession(sessionId, key);
        if (session && typeof session === 'object') {
          const direct = nonEmptyString(session.title)
            ?? nonEmptyString(session.name)
            ?? nonEmptyString(session.displayName);
          if (direct) return direct;
        }
      }
      // Fallback: scan the current workspace session list for this id
      const current = typeof this.#harness.currentWorkspace === 'function'
        ? this.#harness.currentWorkspace()
        : null;
      if (current && typeof this.#harness.listWorkspaceSessions === 'function') {
        const listed = await this.#harness.listWorkspaceSessions(current);
        const match = (Array.isArray(listed?.sessions) ? listed.sessions : [])
          .find((s) => s.sessionId === sessionId);
        if (match) {
          const title = nonEmptyString(match.title) ?? nonEmptyString(match.name);
          if (title) return title;
        }
      }
    } catch { /* best-effort */ }
    return null;
  }

  // ── Sub-card handlers: preset, model, status, help, compact ──────────────

  /**
   * Fetch the preset catalog and show the preset selection card.
   */
  async #showPresetCard(key, chatId, { updateMessageId = null } = {}) {
    try {
      const settings = await this.#harness.agentPresetSettings({ signal: this.#cardDataSignal() });
      const catalog = settings.agentPresetCatalog;
      // Inject the current preset id so the card can render the selection
      catalog._currentId = settings.agentPreset;
      await this.#sendCard(chatId, presetCard(catalog), { key, updateMessageId });
    } catch (error) {
      await this.#sendFailure(chatId, error, { logLabel: 'preset card', replyTo: updateMessageId });
    }
  }

  /**
   * Fetch the model catalog and show the model selection card.
   */
  async #showModelCard(key, chatId, { updateMessageId = null, page = 0 } = {}) {
    try {
      const signal = this.#cardDataSignal();
      await this.#harness.ensureRunning({ signal });
      // Try to get the session-bound catalog first, fall back to harness-level
      const sessionId = this.#state?.sessionFor?.(key);
      let catalog;
      if (typeof sessionId === 'string' && sessionId) {
        const session = this.#harness.workspaceSession(sessionId, key);
        if (session?.models) {
          catalog = await session.models({ signal });
        }
      }
      if (!catalog) {
        catalog = await this.#harness.listModels({ signal });
      }
      await this.#sendCard(chatId, modelCard(catalog, { page }), { key, updateMessageId, modelPage: page });
    } catch (error) {
      await this.#sendFailure(chatId, error, { logLabel: 'model card', replyTo: updateMessageId });
    }
  }

  /**
   * Gather system status and show the status card.
   */
  async #showStatusText(key, chatId, replyTo = null) {
    try {
      await this.#harness.ensureRunning({ signal: this.#signal });
      const lines = [t('连接正常')];
      const ws = typeof this.#harness.currentWorkspace === 'function'
        ? this.#harness.currentWorkspace()
        : null;
      if (ws) lines.push(t('工作区：{workspace}', { workspace: ws }));
      const settings = typeof this.#harness.agentPresetSettings === 'function'
        ? await this.#harness.agentPresetSettings({ signal: this.#signal }).catch(() => null)
        : null;
      if (settings) {
        const item = settings.agentPresetCatalog?.items?.find((i) => i.id === settings.agentPreset);
        lines.push(t('预设：{preset}', {
          preset: item
            ? `${item.label}（${item.id}）`
            : (settings.agentPreset || t('跟随默认')),
        }));
      }
      await this.#send(chatId, lines.join('\n'), { replyTo });
    } catch (error) {
      await this.#sendFailure(chatId, error, { logLabel: 'status text', replyTo });
    }
  }

  async #showStatusCard(key, chatId, { updateMessageId = null } = {}) {
    try {
      const signal = this.#cardDataSignal();
      await this.#harness.ensureRunning({ signal });
      const info = { connected: true, workspace: null, preset: null, model: null, sessionCount: 0 };

      // Current workspace
      try {
        const ws = typeof this.#harness.currentWorkspace === 'function'
          ? this.#harness.currentWorkspace()
          : null;
        info.workspace = ws || t('未知');
      } catch { /* ignore */ }

      // Preset
      try {
        const settings = await this.#harness.agentPresetSettings({ signal });
        const item = settings.agentPresetCatalog.items.find((i) => i.id === settings.agentPreset);
        info.preset = item
          ? `${item.label}（${item.id}）`
          : (settings.agentPreset || t('跟随默认'));
      } catch { /* ignore */ }

      // Model (from bound session or harness)
      try {
        const sessionId = this.#state?.sessionFor?.(key);
        if (typeof sessionId === 'string' && sessionId) {
          const session = this.#harness.workspaceSession(sessionId, key);
          if (session?.models) {
            const cat = await session.models({ signal });
            if (cat.current) info.model = `${cat.current.provider}/${cat.current.model}`;
          }
        }
      } catch { /* ignore */ }

      // Session count
      try {
        const ws = typeof this.#harness.currentWorkspace === 'function'
          ? this.#harness.currentWorkspace()
          : null;
        if (ws) {
          const listed = await this.#harness.listWorkspaceSessions(ws, { signal });
          if (Array.isArray(listed?.sessions)) info.sessionCount = listed.sessions.length;
        }
      } catch { /* ignore */ }

      await this.#sendCard(chatId, statusCard(info), { key, updateMessageId });
    } catch (error) {
      await this.#sendFailure(chatId, error, { logLabel: 'status card', replyTo: updateMessageId });
    }
  }

  /**
   * Show the help card with all command descriptions.
   */
  async #showHelpCard(key, chatId, { updateMessageId = null } = {}) {
    await this.#sendCard(
      chatId,
      helpCard(WORKSPACE_HELP_LINES.map((line) => t(line))),
      { key, updateMessageId },
    );
  }

  /**
   * Run the /compact command and show the result.
   */
  async #handleCompact(key, chatId, replyTo = null) {
    try {
      const result = await runCompactCommand(
        '/compact', this.#harness, this.#state, key, { signal: this.#signal },
      );
      await this.#send(chatId, result?.message || t('上下文压缩失败。'), { replyTo });
    } catch (error) {
      await this.#sendFailure(chatId, error, { logLabel: 'compact', replyTo });
    }
  }

  /** Run /clear while retaining the current Session binding. */
  async #handleClear(key, chatId, replyTo = null) {
    try {
      const result = await runClearCommand(
        '/clear', this.#harness, this.#state, key, {
          signal: this.#signal,
          pendingInteraction: this.#hasPendingInteraction(key),
          busy: this.#queues.has(key),
        },
      );
      await this.#send(chatId, result?.message || t('清空当前会话上下文失败，当前会话未修改，请稍后重试。'), { replyTo });
    } catch (error) {
      await this.#sendFailure(chatId, error, { logLabel: 'clear', replyTo });
    }
  }

  /**
   * Stop the running task in the bound session (mirrors `/stop`).
   */
  async #handleStop(key, chatId, replyTo = null) {
    try {
      let result = await runControlCommand(
        '/stop', this.#harness, this.#state, key, {
          signal: this.#signal,
          control: { owner: this, key },
        },
      );
      if (result?.stopped) {
        this.#markStepStopRequested(key);
        await Promise.allSettled([
          this.#cancelPendingInteraction(key),
          this.#approvals.closeRoute(key),
        ]);
      }
      await this.#send(chatId, result?.message || t('/stop 执行完成。'), { replyTo });
    } catch (error) {
      await this.#sendFailure(chatId, error, { logLabel: 'stop', replyTo });
    }
  }

  /**
   * Show the steer card (quick-select dropdown + free-text input).
   */
  async #showSteerCard(key, chatId, { updateMessageId = null } = {}) {
    const hasSession = Boolean(this.#state.sessionFor?.(key));
    this.#rememberMenu(key, { kind: 'steer' });
    await this.#sendCard(chatId, steerCard({ hasSession }), { key, updateMessageId });
  }

  /**
   * Send a steer instruction to the bound session (mirrors `/steer <text>`).
   */
  async #sendSteer(entry, text) {
    const { key, chatId } = entry;
    // Card routes carry the conversation key, not the raw event, so the topic
    // id is recovered from the key the channel itself minted.
    const threadId = typeof key === 'string'
      ? /(?:^|:)thread:(.+)$/u.exec(key)?.[1]
      : undefined;
    const result = await runControlCommand(
      `/steer ${text}`, this.#harness, this.#state, key, {
        signal: this.#signal,
        pendingInteraction: this.#hasPendingInteraction(key),
        control: { owner: this, key },
        enhancement: captureContextEnhancementSource(
          this.#contextEnhancement,
          typeof key === 'string' && key.startsWith('p2p:') ? 'direct' : 'group',
          () => ({
            channel: 'feishu',
            senderId: entry.actor ?? entry.operatorOpenId,
            chatId,
            threadId,
          }),
        ),
      },
    );
    await this.#send(chatId, result?.message || t('已提交补充指令。'), { replyTo: entry.messageId ?? null });
  }

  /**
   * Reset the preset to follow the Host default.
   */
  async #handlePresetDefault(key, chatId, { updateMessageId = null, replyTo = null } = {}) {
    try {
      const result = await runPresetCommand(
        '/preset --default', this.#harness, this.#state, key, { signal: this.#signal },
      );
      for (const reply of result?.messages ?? [result?.message]) {
        if (reply) await this.#send(chatId, reply, { replyTo });
      }
    } catch (error) {
      await this.#sendFailure(chatId, error, { logLabel: 'preset reset', replyTo: updateMessageId });
      return;
    }
    try {
      await this.#sendMenuCard(key, chatId, { updateMessageId, replyTo });
    } catch (error) {
      this.#logger.warn?.('[dsh-feishu] menu refresh failed after preset reset:', error.message);
    }
  }

  /**
   * Handle preset selection from the preset dropdown.
   */
  async #handlePresetSelect(key, chatId, presetId, { updateMessageId = null, replyTo = null } = {}) {
    try {
      const selector = /^\d+$/u.test(presetId) ? `id:${presetId}` : presetId;
      const result = await runPresetCommand(
        `/preset ${selector}`, this.#harness, this.#state, key, { signal: this.#signal },
      );
      for (const reply of result?.messages ?? [result?.message]) {
        if (reply) await this.#send(chatId, reply, { replyTo });
      }
    } catch (error) {
      await this.#sendFailure(chatId, error, { logLabel: 'preset selection', replyTo: updateMessageId });
      return;
    }
    try {
      await this.#sendMenuCard(key, chatId, { updateMessageId, replyTo });
    } catch (error) {
      this.#logger.warn?.('[dsh-feishu] menu refresh failed after preset select:', error.message);
    }
  }

  /**
   * Handle model selection from the model dropdown.
   *
   * Reuses `runModelCommand` (the same path as the `/model <id>` text
   * command) so model IDs containing `/` (e.g.
   * `openrouter/anthropic/claude-sonnet-4`) keep working, and all the
   * catalog validation, busy checks, pending-interaction checks and the
   * session binding lock stay in one place.
   */
  async #handleReasoningSelect(key, chatId, effort, { updateMessageId = null, replyTo = null, page = 0 } = {}) {
    try {
      const command = effort === REASONING_DEFAULT_SENTINEL ? '/reasoning --default' : `/reasoning ${effort}`;
      const result = await runModelCommand(command, this.#harness, this.#state, key, {
        signal: this.#signal,
        pendingInteraction: this.#hasPendingInteraction(key),
        control: { owner: this, key },
      });
      for (const reply of result?.messages ?? [result?.message]) {
        if (reply) await this.#send(chatId, reply, { replyTo });
      }
    } catch (error) {
      await this.#sendFailure(chatId, error, { logLabel: 'reasoning selection', replyTo: updateMessageId });
      return;
    }
    try {
      await this.#showModelCard(key, chatId, { updateMessageId, page });
    } catch (error) {
      this.#logger.warn?.('[dsh-feishu] model card refresh failed after reasoning select:', error.message);
    }
  }

  async #handleModelSelect(key, chatId, modelId, { updateMessageId = null, replyTo = null, page = 0 } = {}) {
    try {
      const result = await runModelCommand(
        `/model ${modelId}`, this.#harness, this.#state, key, {
          signal: this.#signal,
          pendingInteraction: this.#hasPendingInteraction(key),
          control: { owner: this, key },
        },
      );
      for (const reply of result?.messages ?? [result?.message]) {
        if (reply) await this.#send(chatId, reply, { replyTo });
      }
    } catch (error) {
      await this.#sendFailure(chatId, error, { logLabel: 'model selection', replyTo: updateMessageId });
      return;
    }
    try {
      await this.#showModelCard(key, chatId, { updateMessageId, page });
    } catch (error) {
      this.#logger.warn?.('[dsh-feishu] model card refresh failed after model select:', error.message);
    }
  }

  // ── Watches: read-only session tracking + completion pushes ─────────────

  // ── Deferred delivery (MODEL_REPLY_TIMEOUT → late result push) ──────────

  async #deliverDeferredOutcome(entry, outcome) {
    this.#rememberTopicReply(entry.replyToMessageId, entry.key);
    // A late answer still has to open the topic it was rooted at, so re-arm the
    // root candidate: the key alone says whether this route was a managed topic.
    if (managedTopicRoot(entry.key) === nonEmptyString(entry.replyToMessageId)) {
      this.#rememberTopicRoot(entry.replyToMessageId);
    }
    const text = deferredOutcomeText(outcome);
    if (outcome.found) {
      return this.#deliverDeferredText(entry.chatId, answerTextForDelivery(text, []), entry.replyToMessageId);
    }
    await this.#send(entry.chatId, text, { replyTo: entry.replyToMessageId });
    return true;
  }

  async #deliverDeferredText(chatId, markdownText, replyToMessageId) {
    if (this.#channel?.stream) {
      try {
        await this.#channel.stream(chatId, {
          markdown: async (controller) => {
            await controller.setContent(markdownText);
          },
        }, {
          ...(replyToMessageId ? { replyTo: replyToMessageId } : {}),
          ...(this.#replyInThreadFor(replyToMessageId) ? {
            replyInThread: true,
            onReplyThreadId: async (threadId) => this.#registerTopicReply(
              replyToMessageId,
              chatId,
              threadId,
            ),
          } : {}),
        });
        return true;
      } catch (error) {
        if (error?.deliveryOutcome === 'unknown') throw error;
        this.#logger.warn?.(
          '[dsh-feishu] deferred stream delivery failed; falling back to text:',
          error.message,
        );
      }
    }
    try {
      await this.#sendAnswerText(chatId, markdownText, {
        deliveryId: `deferred-${Date.now()}`,
        presentation: 'feishu-deferred-text',
        ...(replyToMessageId ? { replyTo: replyToMessageId } : {}),
      });
      return true;
    } catch (error) {
      this.#logger.warn?.('[dsh-feishu] deferred text delivery failed:', error.message);
      throw error;
    }
  }

  #ensureEventWatcher() {
    if (this.#eventWatcher) return;
    if (typeof this.#harness?.watchHarnessEvents !== 'function') {
      this.#logger.warn?.('[dsh-feishu] harness lacks watchHarnessEvents; session-sync mirror disabled');
      return;
    }
    if (this.#signal?.aborted) return;
    const signal = this.#signal ?? new AbortController().signal;
    try {
      this.#eventWatcher = this.#harness.watchHarnessEvents({
        signal,
        onSessionEvent: (payload) => {
          this.#onHarnessEvent(payload);
        },
        onReconnect: () => {
          void this.#compensateMissedEvents();
          void this.#deferred.resume();
          for (const mirror of this.#sessionSyncTurns.values()) {
            if (!mirror.finishedAt) void this.#checkMirror(mirror);
          }
        },
      });
      Promise.resolve(this.#eventWatcher).catch((error) => {
        if (!signal.aborted) {
          this.#logger.warn?.('[dsh-feishu] event watcher stopped:', error.message);
        }
      });
    } catch (error) {
      this.#eventWatcher = null;
      this.#logger.warn?.('[dsh-feishu] event watcher failed to start:', error.message);
    }
  }

  #queueEventTask(sessionId, task) {
    const previous = this.#eventTails.get(sessionId) ?? Promise.resolve();
    let next;
    next = previous.then(task, task).catch((error) => {
      if (!this.#signal?.aborted) {
        this.#logger.warn?.('[dsh-feishu] completion event failed:', error.message);
      }
    }).finally(() => {
      if (this.#eventTails.get(sessionId) === next) this.#eventTails.delete(sessionId);
    });
    this.#eventTails.set(sessionId, next);
    return next;
  }

  #pruneObservedCompletionEvents(now = Date.now()) {
    let total = 0;
    for (const [sessionId, observed] of this.#observedCompletionEvents) {
      for (const [seq, record] of observed) {
        if (!Number.isSafeInteger(record?.arrivalAt)
          || record.arrivalAt < 0
          || record.arrivalAt + COMPLETION_OBSERVATION_TTL_MS <= now) {
          observed.delete(seq);
        }
      }
      while (observed.size > MAX_OBSERVED_COMPLETIONS_PER_SESSION) {
        const oldest = observed.keys().next().value;
        if (oldest === undefined) break;
        observed.delete(oldest);
      }
      if (observed.size === 0) this.#observedCompletionEvents.delete(sessionId);
      else total += observed.size;
    }
    while (this.#observedCompletionEvents.size > MAX_OBSERVED_COMPLETION_SESSIONS) {
      const oldestSessionId = this.#observedCompletionEvents.keys().next().value;
      if (oldestSessionId === undefined) break;
      total -= this.#observedCompletionEvents.get(oldestSessionId)?.size ?? 0;
      this.#observedCompletionEvents.delete(oldestSessionId);
    }
    while (total > MAX_OBSERVED_COMPLETIONS) {
      const oldestSessionId = this.#observedCompletionEvents.keys().next().value;
      if (oldestSessionId === undefined) break;
      const observed = this.#observedCompletionEvents.get(oldestSessionId);
      const oldestSeq = observed?.keys().next().value;
      if (oldestSeq === undefined) {
        this.#observedCompletionEvents.delete(oldestSessionId);
        continue;
      }
      observed.delete(oldestSeq);
      total -= 1;
      if (observed.size === 0) this.#observedCompletionEvents.delete(oldestSessionId);
    }
  }

  #recordObservedCompletion(sessionId, event, now = Date.now()) {
    this.#pruneObservedCompletionEvents(now);
    let observed = this.#observedCompletionEvents.get(sessionId);
    if (!observed) observed = new Map();
    const rawReason = event?.data?.reason;
    const reason = typeof rawReason === 'string'
      ? rawReason
      : typeof rawReason?.kind === 'string'
        ? { kind: rawReason.kind }
        : null;
    observed.delete(event.seq);
    observed.set(event.seq, {
      arrivalAt: now,
      event: {
        type: 'turn/end',
        seq: event.seq,
        ...(Number.isSafeInteger(event.time) && event.time >= 0 ? { time: event.time } : {}),
        data: { reason },
      },
    });
    // Refresh the session as a unit so both session and entry eviction are LRU.
    this.#observedCompletionEvents.delete(sessionId);
    this.#observedCompletionEvents.set(sessionId, observed);
    this.#pruneObservedCompletionEvents(now);
  }

  /**
   * Resolve a /watch target READ-ONLY: a session id is validated against
   * the registered workspaces' listings, an index against the current
   * workspace. Nothing is bound and no workspace is switched.
   */
  async #resolveWatchTarget(target, { workspaceHint = null, signal = this.#signal } = {}) {
    if (typeof target !== 'string' || target === '') {
      return { error: t('用法：/watch <Session ID 或当前工作区序号>') };
    }
    const numeric = /^\d{1,4}$/.test(target) ? Number(target) : null;
    const currentPath = typeof this.#harness?.currentWorkspace === 'function'
      ? this.#harness.currentWorkspace()
      : null;
    const listSessions = async (workspace) => {
      const listed = await this.#harness.listWorkspaceSessions(workspace, { signal });
      return Array.isArray(listed?.sessions) ? listed.sessions : [];
    };
    if (numeric !== null) {
      if (!currentPath) return { error: t('当前机器人没有可用的工作区，无法按序号解析会话。') };
      const sessions = this.#visibleSessions(await listSessions(currentPath));
      const session = sessions[numeric - 1];
      if (!session?.sessionId) {
        return { error: t('当前工作区只有 {count} 个会话。', { count: sessions.length }) };
      }
      return {
        sessionId: session.sessionId,
        title: session.title ?? t('暂无标题'),
        workspace: currentPath,
        ...(validLastSeq(session.lastSeq) ? { lastSeq: session.lastSeq } : {}),
      };
    }
    let paths;
    if (nonEmptyString(workspaceHint)) {
      paths = [workspaceHint];
    } else {
      const extraPaths = typeof this.#harness?.listWorkspaces === 'function'
        ? (await this.#harness.listWorkspaces({ signal })).filter((path) => path !== currentPath)
        : [];
      paths = [currentPath, ...extraPaths].filter(Boolean);
    }
    for (const workspace of paths) {
      const sessions = await listSessions(workspace);
      const session = sessions.find((candidate) => candidate.sessionId === target);
      if (session) {
        return {
          sessionId: target,
          title: session.title ?? t('暂无标题'),
          workspace,
          ...(validLastSeq(session.lastSeq) ? { lastSeq: session.lastSeq } : {}),
        };
      }
    }
    return { error: t('没有找到这个会话，请用 /sessionlist 查看可用会话。') };
  }

  async #freshWatchTargets(workspace) {
    const selectedWorkspace = nonEmptyString(workspace)
      ?? (typeof this.#harness?.currentWorkspace === 'function'
        ? nonEmptyString(this.#harness.currentWorkspace())
        : null);
    if (!selectedWorkspace || typeof this.#harness?.listWorkspaceSessions !== 'function') {
      return new Map();
    }
    const listed = await this.#harness.listWorkspaceSessions(
      selectedWorkspace,
      { signal: this.#cardDataSignal() },
    );
    return new Map(this.#visibleSessions(Array.isArray(listed?.sessions) ? listed.sessions : [])
      .filter((session) => nonEmptyString(session?.sessionId))
      .map((session) => [session.sessionId, {
        sessionId: session.sessionId,
        title: session.title ?? session.name ?? t('暂无标题'),
        workspace: selectedWorkspace,
        ...(validLastSeq(session.lastSeq) ? { lastSeq: session.lastSeq } : {}),
      }]));
  }

  #scheduleCompensation(sessionId) {
    const pending = this.#pendingCompensations.get(sessionId);
    if (pending) {
      pending.requested = true;
      return pending.promise;
    }
    const state = { requested: true, promise: null };
    this.#pendingCompensations.set(sessionId, state);
    state.promise = Promise.resolve().then(async () => {
      try {
        // A watch can be persisted after an in-progress compensation already
        // snapshotted its keys. Remember that request and run one trailing pass.
        do {
          state.requested = false;
          await this.#queueEventTask(sessionId, () => this.#compensateSession(sessionId));
        } while (state.requested && !this.#signal?.aborted);
      } finally {
        if (this.#pendingCompensations.get(sessionId) === state) {
          this.#pendingCompensations.delete(sessionId);
        }
      }
    });
    return state.promise;
  }

  async #runWatch(key, chatId, target, {
    notify = true,
    validatedTarget = null,
    workspaceHint = null,
    replyTo = null,
  } = {}) {
    const watchRequestedAt = Date.now();
    const reply = async (message) => {
      if (!notify) return;
      await this.#send(chatId, message, { replyTo }).catch((error) => {
        this.#logger.warn?.('[dsh-feishu] watch notification failed:', error.message);
      });
    };
    this.#ensureEventWatcher();
    if (typeof this.#state?.setWatch !== 'function') {
      await reply(t('当前状态存储不支持关注。'));
      return { ok: false, changed: false, reason: 'unsupported' };
    }
    let resolved;
    try {
      resolved = validatedTarget?.sessionId === target
        ? validatedTarget
        : await this.#resolveWatchTarget(target, {
          workspaceHint,
          signal: workspaceHint ? this.#cardDataSignal() : this.#signal,
        });
    } catch (error) {
      await reply(t('无法解析会话：{message}', { message: safeErrorText(error) }));
      return { ok: false, changed: false, reason: 'resolve' };
    }
    if (resolved.error) {
      await reply(resolved.error);
      return { ok: false, changed: false, reason: 'not-found' };
    }
    const existing = this.#state.watchEntries?.(key) ?? [];
    const existingEntry = existing.find((entry) => entry.sessionId === resolved.sessionId);
    if (!existingEntry && existing.length >= MAX_WATCHES_PER_KEY) {
      await reply(t('每个聊天最多关注 {count} 个会话。', { count: MAX_WATCHES_PER_KEY }));
      return { ok: false, changed: false, reason: 'limit' };
    }
    const lastSeq = validLastSeq(existingEntry?.lastSeq)
      ? existingEntry.lastSeq
      : validLastSeq(resolved.lastSeq)
        ? resolved.lastSeq
        : null;
    // session.list's projection asOfSeq can be stale for a cold session. Every
    // new watch therefore keeps a durable wall-clock boundary; lastSeq is only
    // a lower bound for the history scan. Existing settled and legacy entries
    // keep their prior semantics when /watch is repeated.
    const existingBoundary = watchBoundary(existingEntry);
    const watchStartedAt = existingBoundary ?? (existingEntry ? null : watchRequestedAt);
    try {
      await this.#state.setWatch(key, {
        sessionId: resolved.sessionId,
        title: resolved.title,
        chatId,
        lastSeq,
        ...(watchStartedAt !== null ? { watchStartedAt } : {}),
        // Remember where the watch was created so completion pushes can be
        // delivered as replies inside the same Feishu topic.
        ...(replyTo
          ? { replyToMessageId: replyTo }
          : existingEntry?.replyToMessageId
            ? { replyToMessageId: existingEntry.replyToMessageId }
            : {}),
      });
    } catch (error) {
      await reply(t('关注失败：{message}', { message: safeErrorText(error) }));
      return { ok: false, changed: false, reason: 'persist' };
    }
    // Always compensate a newly created or still-unsettled watch. This closes
    // both target-list and durable-persistence windows.
    if (!existingEntry || watchStartedAt !== null || !validLastSeq(lastSeq)) {
      void this.#scheduleCompensation(resolved.sessionId);
    }
    await reply(t('已关注会话「{title}」，任务完成会推送结果。', { title: String(resolved.title).replace(/\s+/gu, ' ') }));
    return { ok: true, changed: !existingEntry, entry: this.#state.watchEntry?.(key, resolved.sessionId) };
  }

  async #runUnwatch(key, chatId, target, { notify = true, replyTo = null } = {}) {
    const reply = async (message) => {
      if (!notify) return;
      await this.#send(chatId, message, { replyTo }).catch((error) => {
        this.#logger.warn?.('[dsh-feishu] unwatch notification failed:', error.message);
      });
    };
    if (typeof this.#state?.removeWatch !== 'function') {
      return { ok: false, changed: false, reason: 'unsupported' };
    }
    const entries = this.#state.watchEntries?.(key) ?? [];
    const entry = typeof target === 'string' && /^\d{1,4}$/.test(target)
      ? entries[Number(target) - 1]
      : entries.find((candidate) => candidate.sessionId === target);
    if (!entry) {
      await reply(t('关注列表里没有这个会话，回复 /watchlist 查看。'));
      return { ok: true, changed: false, reason: 'absent' };
    }
    try {
      await this.#state.removeWatch(key, entry.sessionId);
      this.#failedWatchSeqs.delete(`${key}\0${entry.sessionId}`);
    } catch (error) {
      await reply(t('取消失败：{message}', { message: safeErrorText(error) }));
      return { ok: false, changed: false, reason: 'persist' };
    }
    await reply(t('已取消关注「{title}」。', { title: String(entry.title ?? '').replace(/\s+/gu, ' ') }));
    return { ok: true, changed: true, entry };
  }

  async #showWatchList(key, chatId, { updateMessageId = null, replyTo = null } = {}) {
    const entries = this.#state.watchEntries?.(key) ?? [];
    // 收集可选会话（用于「添加关注」多选下拉）；失败则传空数组 → 只渲染移除/列表。
    let availableSessions = [];
    let currentWorkspace = null;
    try {
      currentWorkspace = typeof this.#harness?.currentWorkspace === 'function'
        ? this.#harness.currentWorkspace()
        : null;
      if (currentWorkspace && typeof this.#harness?.listWorkspaceSessions === 'function') {
        const listed = await this.#harness.listWorkspaceSessions(
          currentWorkspace,
          { signal: this.#cardDataSignal() },
        );
        availableSessions = this.#visibleSessions(
          Array.isArray(listed?.sessions) ? listed.sessions : [],
        )
          .map((session) => ({
            sessionId: session.sessionId,
            title: session.title ?? session.name ?? session.sessionId,
          }));
      }
    } catch { /* add-select section degrades to remove-only */ }
    this.#rememberMenu(key, { kind: 'watches', entries });
    await this.#sendCard(
      chatId,
      watchListCard(entries, availableSessions),
      {
        key,
        updateMessageId,
        replyTo,
        sessionWorkspace: currentWorkspace,
      },
    );
  }

  /** True while this bridge owns the IM ask; capture before queuing events. */
  #isImTurn(sessionId) {
    for (const key of this.#imTurnKeys) {
      if (this.#state.sessionFor?.(key) === sessionId) return true;
    }
    return false;
  }

  #beginImTurn(key) { this.#imTurnKeys.add(key); }
  #endImTurn(key) { this.#imTurnKeys.delete(key); }

  #mirrorKey(sessionId, turn) { return `session-sync\0${sessionId}\0${turn}`; }

  #restoreMirrorCard(key, entry) {
    if (!Array.isArray(entry?.blocks) || !entry.cardIds?.length) return false;
    const card = this.#ensureStepCard(key, entry.chatId, null);
    Object.assign(card, {
      blocks: structuredClone(entry.blocks), cardIds: [...entry.cardIds],
      messageId: entry.cardIds.at(-1), chunkCount: entry.cardIds.length,
      activeCardStart: 0, renderedCardContents: new Map(),
      answerStart: entry.answerStart ?? null, answerEnd: entry.answerEnd ?? null,
      deliveryViaOpenId: true,
    });
    return true;
  }

  #scheduleMirrorCheck(key, task) {
    if (this.#signal?.aborted || this.#sessionSyncIdleTimers.has(key)) return;
    const timer = setTimeout(() => {
      this.#sessionSyncIdleTimers.delete(key);
      if (!this.#signal?.aborted) void task();
    }, MIRROR_CHECK_MS);
    timer.unref?.();
    this.#sessionSyncIdleTimers.set(key, timer);
  }

  async #mirrorHistory(sessionId, turn) {
    if (typeof this.#harness.rpc !== 'function') return null;
    const events = [];
    let beforeSeq;
    for (let page = 0; page < 10; page += 1) {
      const history = await this.#harness.rpc('session.history', {
        sessionId, maxMessages: 100,
        ...(beforeSeq === undefined ? {} : { beforeSeq }),
      }, 10_000, { signal: this.#signal });
      const batch = orderedHistoryEvents(history);
      events.unshift(...batch);
      if (!history?.hasMore || batch.some((event) => event.type === 'turn/start' && event.data?.turn === turn)) {
        return events;
      }
      const oldest = batch[0]?.seq;
      if (!validEventSeq(oldest) || oldest === beforeSeq) break;
      beforeSeq = oldest;
    }
    return null; // A truncated history cannot prove the final answer is complete.
  }

  #checkMirror(mirror) {
    return this.#queueEventTask(mirror.sessionId, async () => {
      if (mirror.finishedAt || this.#signal?.aborted) return;
      try {
        const events = await this.#mirrorHistory(mirror.sessionId, mirror.turn);
        const outcome = extractCompletedTurnAnswer(events, { turn: mirror.turn });
        if (outcome.endSeq >= 0) {
          await this.#finishSessionSyncMirror(mirror, outcome.text ?? mirror.assistant.text, outcome.reason);
        }
      } catch (error) {
        this.#logger.warn?.('[dsh-feishu] mirror history check failed:', error?.message ?? error);
      }
      if (!mirror.finishedAt) this.#scheduleMirrorCheck(mirror.key, () => this.#checkMirror(mirror));
    });
  }

  async #finishSessionSyncMirror(mirror, text, reason = 'completed') {
    if (mirror.finishedAt) return mirror.result?.ok === true && mirror.result.text === text;
    const recovering = mirror.recovered;
    if (mirror.recovered) {
      const events = await this.#mirrorHistory(mirror.sessionId, mirror.turn);
      const outcome = extractCompletedTurnAnswer(events, { turn: mirror.turn });
      if (outcome.endSeq < 0) return false;
      text = outcome.text ?? text;
      reason = outcome.reason;
      mirror.recovered = false;
    }
    clearTimeout(this.#sessionSyncIdleTimers.get(mirror.key));
    this.#sessionSyncIdleTimers.delete(mirror.key);
    const result = await this.#finishStepCard(mirror.key, {
      stopped: reason !== 'completed', answerText: text,
    });
    mirror.result = { ok: result?.ok === true, text };
    mirror.finishedAt = Date.now();
    // Keep the last successful snapshot on failure so recovery can preserve it.
    if (result?.ok) await this.#clearMirrorRecovery(mirror.key);
    else if (isExpiredMirrorError(result?.error)) {
      await this.#clearMirrorRecovery(mirror.key, 'message expired');
    } else if (recovering) {
      this.#sessionSyncTurns.delete(mirror.key);
      this.#scheduleMirrorCheck(`recovery\0${mirror.key}`, () => this.#sealOrphanMirrors(mirror.key));
    }
    return result?.ok === true;
  }

  async #deliverSessionSyncMirror({ target, sessionId, turn, text }) {
    if (this.#signal?.aborted) return false;
    return await this.#queueEventTask(sessionId, async () => {
      const mirror = this.#sessionSyncTurns.get(this.#mirrorKey(sessionId, turn));
      if (!mirror || mirror.target.targetId !== target.targetId) return false;
      return this.#finishSessionSyncMirror(mirror, text);
    }) === true;
  }

  async #feedSessionSyncTurn(sessionId, event, imOwned = false) {
    if (this.#signal?.aborted || imOwned) return;
    const type = event.type;
    // Retain recent receipts for coordinator callbacks that lag the event mux.
    for (const [key, prior] of this.#sessionSyncTurns) {
      if (prior.finishedAt && Date.now() - prior.finishedAt > 300_000) this.#sessionSyncTurns.delete(key);
    }
    let turn = event.data?.turn;
    if (!Number.isSafeInteger(turn)) turn = this.#sessionSyncCurrentTurns.get(sessionId);
    if (!Number.isSafeInteger(turn)) return;
    const key = this.#mirrorKey(sessionId, turn);
    let mirror = this.#sessionSyncTurns.get(key);
    if (!mirror) {
      if (!['turn/start', 'user/message', 'assistant/message', 'tool/call'].includes(type)) return;
      const targets = await this.#sessionSyncTargetsFor(sessionId);
      const target = (Array.isArray(targets) ? targets : []).find((item) => item.botId === this.#botId);
      if (!target?.openId || !target?.targetId || this.#signal?.aborted) return;
      mirror = { key, sessionId, turn, target, assistant: new AssistantTextAccumulator(), pendingStep: null, lastSeq: -1 };
      this.#sessionSyncTurns.set(key, mirror);
      this.#sessionSyncCurrentTurns.set(sessionId, turn);
      const saved = this.#state.mirrorEntries?.().find(([entryKey]) => entryKey === key)?.[1];
      if (saved?.targetId === target.targetId && saved.chatId === target.openId
        && this.#restoreMirrorCard(key, saved)) {
        mirror.recovered = true;
        mirror.lastSeq = saved.lastSeq ?? -1;
        mirror.pendingStep = saved.pendingStep ?? null;
      }
      const card = this.#ensureStepCard(key, target.openId, null);
      Object.assign(card, {
        deliveryViaOpenId: true, sessionSyncSessionId: sessionId,
        sessionSyncTargetId: target.targetId, sessionSyncTurn: turn, sessionSyncKey: key,
      });
    }
    if (mirror.finishedAt || event.seq <= mirror.lastSeq) return;
    mirror.lastSeq = event.seq;
    this.#scheduleMirrorCheck(key, () => this.#checkMirror(mirror));
    const openId = mirror.target.openId;
    if (type === 'user/message' && event.surfaceOp === 'append') {
      const source = event.data?.source;
      // Goal rounds carry a `<goal_round>` driver prompt: announce the round
      // instead of echoing that machine text into the chat.
      const text = source?.kind === 'goal'
        ? goalRoundLabel(source.round)
        : textFromHarnessContent(event.data?.content);
      if (text.trim()) {
        const excerpt = text.length > 400 ? `${text.slice(0, 399)}…` : text;
        await this.#appendStepCardUpdate(key, openId, null,
          { kind: 'message', text: `> 👤 **我问：**${excerpt.replaceAll('\n', '\n> ')}` }, { billable: false });
      }
    } else if (type === 'tool/call') {
      if (mirror.pendingStep) {
        this.#morphStepCardAnswerToNote(key, mirror.pendingStep);
        mirror.pendingStep = null;
      }
      await this.#appendStepCardUpdate(key, openId, null, this.#stepCardToolBlock({
        name: event.data?.name ?? '',
        arguments: typeof event.data?.arguments === 'string' ? event.data.arguments : '',
      }), { billable: false });
    } else if (type === 'assistant/message' && event.surfaceOp === 'append' && event.data?.interrupted !== true) {
      const text = textFromHarnessContent(event.data?.message?.content);
      if (text.trim()) {
        mirror.assistant.setCanonical(event.data?.step, text);
        mirror.pendingStep = text;
        this.#streamStepCardAnswer(key, openId, null, text);
      }
    } else if (type === 'turn/end') {
      const reason = typeof event.data?.reason === 'string' ? event.data.reason : event.data?.reason?.kind;
      await this.#finishSessionSyncMirror(mirror, mirror.assistant.text, reason);
    }
  }

  // ── Goal rounds opened outside the IM ───────────────────────────────────

  /** Any conversation route bound to this session (the goal-round target). */
  #hasConversationFor(sessionId) {
    for (const key of this.#conversationRoutes.keys()) {
      if (this.#state.sessionFor?.(key) === sessionId) return true;
    }
    return false;
  }

  /**
   * A goal round is injected by the Harness goal driver: no inbound message
   * opened it, so the step-card ladder of #answerWithStepPush never runs and
   * a conversation bound to that session stays silent for the whole round.
   * Announce the round and stream its tools/answer into the same live card
   * the IM turns use, so a long auto-run still shows progress and delivers
   * each round's result. IM-owned turns and sessions already mirrored into a
   * synced DM are skipped.
   */
  async #feedGoalRoundTurn(sessionId, event, imOwned = false) {
    if (this.#signal?.aborted) return;
    const type = event.type;
    if (type === 'turn/start') {
      const started = event.data?.turn;
      if (Number.isSafeInteger(started)) {
        this.#goalTurnStarts.set(sessionId, { turn: started, seq: event.seq });
      }
      return;
    }
    if (type === 'user/message') {
      const source = event.data?.source;
      if (source?.kind !== 'goal' || imOwned) return;
      const turn = this.#goalRoundTurn(sessionId, event);
      if (!Number.isSafeInteger(turn) || this.#goalRoundsFor(sessionId, turn).length > 0) return;
      await this.#openGoalRounds(sessionId, turn, source.round);
      return;
    }
    if (type !== 'tool/call' && type !== 'assistant/message' && type !== 'turn/end') return;
    const turn = event.data?.turn;
    // A later turn proves earlier rounds are over even when their turn/end was
    // lost, so close them instead of leaving a card open forever.
    if (Number.isSafeInteger(turn)) await this.#sealStaleGoalRounds(sessionId, turn);
    const rounds = Number.isSafeInteger(turn)
      ? this.#goalRoundsFor(sessionId, turn)
      : this.#goalRoundsFor(sessionId);
    if (!rounds.length) return;
    if (imOwned) {
      // The user took the conversation back with a real IM turn: that turn's
      // ask owns this key's card now, so sealing it here would truncate the
      // reply the user is waiting for. Hand the round over instead — whatever
      // streamed so far stays on the card the ask continues.
      for (const round of rounds) {
        round.finished = true;
        this.#goalRounds.delete(round.key);
      }
      return;
    }
    for (const round of rounds) {
      if (round.finished || event.seq <= round.lastSeq) continue;
      if (this.#state.sessionFor?.(round.key) !== sessionId) {
        // The conversation was rebound to another session: this session's
        // later output must not land in the card the user now sees there.
        await this.#sealGoalRound(round, 'completed');
        continue;
      }
      round.lastSeq = event.seq;
      if (type === 'tool/call') {
        if (round.pendingStep) {
          this.#morphStepCardAnswerToNote(round.key, round.pendingStep);
          round.pendingStep = null;
        }
        await this.#appendStepCardUpdate(round.key, round.chatId, round.replyToMessageId,
          this.#stepCardToolBlock({
            name: event.data?.name ?? '',
            arguments: typeof event.data?.arguments === 'string' ? event.data.arguments : '',
          }), { billable: false });
      } else if (type === 'assistant/message'
        && event.surfaceOp === 'append'
        && event.data?.interrupted !== true) {
        const text = textFromHarnessContent(event.data?.message?.content);
        if (!text.trim()) continue;
        round.assistant.setCanonical(event.data?.step, text);
        round.pendingStep = text;
        this.#streamStepCardAnswer(round.key, round.chatId, round.replyToMessageId, text);
      } else if (type === 'turn/end') {
        const reason = typeof event.data?.reason === 'string' ? event.data.reason : event.data?.reason?.kind;
        await this.#sealGoalRound(round, reason);
      }
    }
  }

  /**
   * The turn a goal round belongs to. Harness `user/message` events injected by
   * the goal driver omit `data.turn`, so fall back to the turn/start that
   * opened the turn immediately before it.
   */
  #goalRoundTurn(sessionId, event) {
    const declared = event.data?.turn;
    if (Number.isSafeInteger(declared)) return declared;
    const started = this.#goalTurnStarts.get(sessionId);
    if (!started || !validEventSeq(started.seq) || started.seq >= event.seq) return undefined;
    return started.turn;
  }

  #goalRoundsFor(sessionId, turn = null) {
    const rounds = [];
    for (const round of this.#goalRounds.values()) {
      if (round.sessionId !== sessionId) continue;
      if (turn !== null && round.turn !== turn) continue;
      rounds.push(round);
    }
    return rounds;
  }

  async #openGoalRounds(sessionId, turn, roundNumber) {
    const syncedOpenIds = await this.#sessionSyncOpenIds(sessionId);
    for (const [key, route] of this.#conversationRoutes) {
      // Only this session's own conversations take part. A key bound to some
      // other session is not "rebound" from here — it is another session's
      // card, and its round keeps running until that session says otherwise.
      if (this.#state.sessionFor?.(key) !== sessionId) continue;
      const existing = this.#goalRounds.get(key);
      if (existing && existing.turn !== turn) {
        // The previous round never reported turn/end (dropped event, crashed
        // Host): it cannot be updated any more, so close it instead of
        // letting it block this round.
        await this.#sealGoalRound(existing);
      }
      if (this.#isSyncedDmKey(key, syncedOpenIds)) continue;
      if (this.#goalRounds.has(key)) continue;
      // A card left open by an abnormal exit is sealed before the new round
      // reuses the conversation's card slot.
      if (this.#stepCards.has(key)) await this.#finishStepCard(key);
      this.#goalRounds.set(key, {
        key,
        sessionId,
        turn,
        chatId: route.chatId,
        replyToMessageId: route.replyToMessageId,
        assistant: new AssistantTextAccumulator(),
        pendingStep: null,
        lastSeq: -1,
        finished: false,
      });
      await this.#appendStepCardUpdate(key, route.chatId, route.replyToMessageId,
        { kind: 'message', text: goalRoundLabel(roundNumber) }, { billable: false });
    }
  }

  /**
   * Peers whose synced DM already mirrors this session with this bot. The
   * mirror owns exactly that direct chat, not every conversation bound to the
   * session, so a group topic keeps rendering alongside it.
   */
  async #sessionSyncOpenIds(sessionId) {
    if (!this.#sessionSyncTargetsFor) return new Set();
    try {
      const targets = await this.#sessionSyncTargetsFor(sessionId);
      const openIds = new Set();
      for (const target of Array.isArray(targets) ? targets : []) {
        if (target?.botId === this.#botId && nonEmptyString(target?.openId)) openIds.add(target.openId);
      }
      return openIds;
    } catch {
      return new Set();
    }
  }

  /** The plain peer DM key the session-sync mirror delivers into. */
  #isSyncedDmKey(key, openIds) {
    if (!(openIds instanceof Set) || openIds.size === 0) return false;
    if (!key.startsWith('p2p:')) return false;
    const peer = key.slice(4);
    // Managed topics inside a DM are separate surfaces the mirror does not
    // reach: only the plain direct chat is duplicated by it.
    return !peer.includes(':') && openIds.has(peer);
  }

  async #sealStaleGoalRounds(sessionId, turn) {
    const stale = this.#goalRoundsFor(sessionId).filter((round) => round.turn < turn);
    for (const round of stale) await this.#sealGoalRound(round, 'completed');
  }

  async #sealGoalRound(round, reason = 'completed') {
    if (round.finished) return;
    round.finished = true;
    this.#goalRounds.delete(round.key);
    const sealed = await this.#finishStepCard(round.key, {
      stopped: reason === 'stopped' || reason === 'aborted' || reason === 'cancelled',
      answerText: round.assistant.text,
    });
    // Unlike an IM turn, a continuation round has no second delivery path:
    // when the card cannot be sealed (broken render, lost message) the result
    // would vanish, so post it as a plain reply instead.
    if (sealed?.ok) return;
    const answer = stripLocalImageMarkdown(String(round.assistant.text ?? '')).trim();
    if (!answer) return;
    this.#logger.warn?.(
      '[dsh-feishu] goal round card seal failed; replying with the result:',
      mirrorErrorText(sealed?.error),
    );
    await this.#send(round.chatId, answer, { replyTo: round.replyToMessageId }).catch(() => undefined);
  }

  #onHarnessEvent({ sessionId, event }) {
    if (this.#signal?.aborted
      || !sessionId
      || !event
      || typeof event !== 'object'
      || !validEventSeq(event.seq)) return;

    // Session-sync mirror: turns opened OUTSIDE the IM (DSH Web / CLI) are
    // rendered into the synced DM with the same #stepCards ladder as IM
    // turns. The mirror consumes EVERY event type (turn/start opens the
    // card, tool/call and assistant/message feed it, turn/end seals it);
    // IM-opened turns are skipped — they already own their card via the ask
    // callbacks. turn/end ALSO continues below for watch completions.
    const imOwned = this.#isImTurn(sessionId);
    if (this.#sessionSyncTargetsFor) {
      void this.#queueEventTask(sessionId, () => this.#feedSessionSyncTurn(sessionId, event, imOwned));
    }
    // Goal auto-continuation: a round opened by the Harness goal driver has
    // no inbound message behind it, so it renders into the bound conversation
    // through this bridge instead of an ask callback. Same event ladder.
    if (this.#goalRounds.size > 0 || this.#hasConversationFor(sessionId)) {
      void this.#queueEventTask(sessionId, () => this.#feedGoalRoundTurn(sessionId, event, imOwned));
    }
    if (event.type !== 'turn/end') return;
    // Record before consulting state: /watch may still be resolving its target
    // or waiting for setWatch persistence and therefore have no visible entry.
    this.#recordObservedCompletion(sessionId, event);
    void this.#queueEventTask(sessionId, async () => {
      const keys = this.#state.keysWatching?.(sessionId) ?? [];
      const needsBaseline = keys.some((key) => (
        watchNeedsBaseline(this.#state.watchEntry?.(key, sessionId))
      ));
      const hasFailedDelivery = keys
        .some((key) => this.#failedWatchSeqs.has(`${key}\0${sessionId}`));
      if (needsBaseline || hasFailedDelivery) await this.#compensateSession(sessionId);
      await this.#deliverCompletion(sessionId, event);
      await this.#deferred.onEvent({ sessionId, event });
    });
  }

  async #deliverCompletion(sessionId, event, { keys: targetKeys = null } = {}) {
    if (this.#signal?.aborted || typeof this.#state?.keysWatching !== 'function') return;
    const reason = event?.data?.reason?.kind ?? event?.data?.reason ?? null;
    const keys = targetKeys ?? this.#state.keysWatching(sessionId);
    for (const key of keys) {
      if (this.#signal?.aborted) return;
      const entry = this.#state.watchEntry?.(key, sessionId);
      const deliveryKey = `${key}\0${sessionId}`;
      let failedSeq = this.#failedWatchSeqs.get(deliveryKey);
      if (validEventSeq(failedSeq)
        && validLastSeq(entry?.lastSeq)
        && entry.lastSeq >= failedSeq) {
        this.#failedWatchSeqs.delete(deliveryKey);
        failedSeq = undefined;
      }
      if (!entry?.chatId
        || watchNeedsBaseline(entry)
        || (validLastSeq(entry.lastSeq) && entry.lastSeq >= event.seq)
        || (validEventSeq(failedSeq) && event.seq > failedSeq)) continue;
      try {
        // Re-derive topic intent at delivery time: the push may outlive the
        // bounded in-memory anchor cache, but the conversation key still tells
        // us whether the completion belongs to a Feishu topic.
        this.#rememberTopicReply(entry.replyToMessageId ?? null, key);
        await this.#sendCard(
          entry.chatId,
          completionCard(sessionId, entry.title, reason),
          { key, replyTo: entry.replyToMessageId ?? null },
        );
        const current = this.#state.watchEntry?.(key, sessionId);
        if (!current
          || current.chatId !== entry.chatId
          || watchNeedsBaseline(current)
          || (validLastSeq(current.lastSeq) && current.lastSeq >= event.seq)) continue;
        await this.#state.setWatch(key, { ...current, lastSeq: event.seq });
        if (failedSeq === event.seq) this.#failedWatchSeqs.delete(deliveryKey);
      } catch (error) {
        this.#failedWatchSeqs.set(
          deliveryKey,
          validEventSeq(failedSeq) ? Math.min(failedSeq, event.seq) : event.seq,
        );
        this.#logger.warn?.('[dsh-feishu] completion push failed:', error.message);
      }
    }
  }

  async #compensateSession(sessionId) {
    if (this.#signal?.aborted || typeof this.#harness?.rpc !== 'function') return;
    try {
      const history = await this.#harness.rpc(
        'session.history',
        { sessionId, maxMessages: 20 },
        30_000,
        { signal: this.#signal },
      );
      const historicalEvents = orderedHistoryEvents(history);
      this.#pruneObservedCompletionEvents();
      const observed = this.#observedCompletionEvents.get(sessionId) ?? new Map();
      const eventsBySeq = new Map(historicalEvents.map((event) => [event.seq, event]));
      // The event mux can be ahead of the history projection. Retain a bounded,
      // minimal completion payload so a pre-persistence live frame is not lost.
      for (const [seq, record] of observed) {
        if (!eventsBySeq.has(seq)) eventsBySeq.set(seq, record.event);
      }
      const events = [...eventsBySeq.values()].sort((left, right) => left.seq - right.seq);
      const latestSeq = events.at(-1)?.seq ?? -1;
      const keys = typeof this.#state?.keysWatching === 'function'
        ? this.#state.keysWatching(sessionId)
        : [];

      // Establish independent baselines for every chat watching this Session.
      // New watches carry a durable wall-clock boundary; old persisted null
      // watches retain the legacy "baseline latest without replay" behavior.
      for (const key of keys) {
        const entry = this.#state.watchEntry?.(key, sessionId);
        if (!watchNeedsBaseline(entry)) continue;
        const watchStartedAt = watchBoundary(entry);
        const lowerBound = validLastSeq(entry.lastSeq) ? entry.lastSeq : -1;
        const firstKnownNew = watchStartedAt === null
          ? null
          : events.find((event) => {
            if (event.seq <= lowerBound) return false;
            const eventTime = Number.isSafeInteger(event.time) && event.time >= 0
              ? event.time
              : observed.get(event.seq)?.arrivalAt;
            return Number.isSafeInteger(eventTime) && eventTime >= watchStartedAt;
          });
        // Unknown events before the first event proven post-boundary are
        // conservatively part of the baseline. Sequence order proves all later
        // events are post-boundary. With no proof, replay nothing.
        const baselineSeq = firstKnownNew
          ? Math.max(lowerBound, firstKnownNew.seq - 1)
          : Math.max(lowerBound, latestSeq);
        const current = this.#state.watchEntry?.(key, sessionId);
        if (!current
          || current.chatId !== entry.chatId
          || current.lastSeq !== entry.lastSeq
          || watchBoundary(current) !== watchStartedAt) continue;
        const { watchStartedAt: _watchStartedAt, ...settled } = current;
        await this.#state.setWatch(key, { ...settled, lastSeq: baselineSeq });
      }

      for (const event of events) {
        if (event.type === 'turn/end') await this.#deliverCompletion(sessionId, event, { keys });
      }
    } catch (error) {
      if (!this.#signal?.aborted) {
        this.#logger.warn?.(`[dsh-feishu] watch compensation failed for ${sessionId}:`, error.message);
      }
    }
  }

  /** Replay recent turn completions missed while the mux was disconnected. */
  async #compensateMissedEvents() {
    const sessionIds = typeof this.#state?.watchedSessionIds === 'function'
      ? this.#state.watchedSessionIds()
      : [];
    if (this.#signal?.aborted) return;
    await Promise.allSettled(sessionIds.map((sessionId) => this.#scheduleCompensation(sessionId)));
  }

  #interactionAskOptions(event, key, files, images) {
    return {
      groupHistory: event.groupHistory,
      timeoutMs: this.#replyTimeoutMs,
      signal: this.#signal,
      control: { owner: this, key },
      onInteraction: (interaction) => this.#handleInteraction(interaction, {
        key,
        actor: senderOpenId(event),
        chatId: event.message.chat_id,
        requiresMention: event.message.chat_type !== 'p2p',
        replyToMessageId: event.message.message_id,
      }),
      onInteractionResolved: (resolution) => this.#handleInteractionResolved(resolution),
      files,
      images,
    };
  }

  async #sendAnswerText(chatId, answer, { deliveryId, presentation, replyTo = null }) {
    const providerMessageIds = [];
    for (const chunk of splitText(answer)) {
      this.#signal?.throwIfAborted();
      const messageId = await this.#send(chatId, chunk, { replyTo });
      if (messageId) providerMessageIds.push(messageId);
    }
    return createDeliveryReceipt({
      deliveryId,
      presentation,
      providerMessageIds,
    });
  }

  async #sendAnswerMarkdown(chatId, answer, { deliveryId, presentation, replyTo }) {
    const providerMessageIds = [];
    // 最终答案保留 Markdown；复用富文本投递的限流重试、话题路由与纯文本兜底。
    for (const chunk of splitStepPostMarkdown(answer)) {
      this.#signal?.throwIfAborted();
      const result = await this.#sendStepPost(chatId, replyTo, [[{ tag: 'md', text: chunk }]], chunk);
      if (!result.ok) throw result.error ?? new Error('Feishu final answer delivery failed');
      if (result.messageId) providerMessageIds.push(result.messageId);
    }
    return createDeliveryReceipt({ deliveryId, presentation, providerMessageIds });
  }

  // 语音回复(渠道能力):同回合转写过语音消息的会话,在完整答案投递后追加
  // 音频回复。回合按会话 key 登记并消费——同群不同话题各自只消费自己的
  // 回合;登记随消息处理结束(finally)清除,命令类回复(菜单、会话列表等)
  // 与延迟交付不触发语音;此处失败只告警,不影响文字投递。
  async #maybeSendVoiceReply(key, chatId, answer, replyTo = null) {
    const voiceTurn = this.#voiceTurns.get(key);
    if (!voiceTurn) return;
    this.#voiceTurns.delete(key);
    try {
      await this.#sendVoiceAnswer(chatId, answer, voiceTurn.replyTo ?? replyTo);
    } catch (error) {
      this.#logger.warn?.('[dsh-feishu-voice] 语音回复失败:', error?.message ?? String(error));
    }
  }

  // 文本 → qwen TTS → opus 上传 → 音频消息;优先回复原语音消息,
  // reply 不可用时明确降级为普通音频消息。
  async #sendVoiceAnswer(chatId, text, replyTo = null) {
    const opus = await this.#voice.synthesize(text);
    if (!opus) return null;
    const upload = await this.#client.im.v1.file.create({
      data: { file_type: 'opus', file_name: 'dsh-im-voice-reply.opus', file: opus },
    });
    const fileKey = upload?.file_key ?? upload?.data?.file_key;
    if (!fileKey) throw new Error('音频上传无 file_key');
    const content = JSON.stringify({ file_key: fileKey });
    if (replyTo) {
      try {
        const response = await this.#client.im.v1.message.reply({
          path: { message_id: replyTo },
          data: { msg_type: 'audio', content },
        });
        if (!response?.code || response.code === 0) return response?.data?.message_id ?? null;
      } catch (error) {
        this.#logger.warn?.('[dsh-feishu-voice] 音频回复失败,改发普通消息:', error?.message ?? String(error));
      }
    }
    const response = await this.#client.im.v1.message.create({
      params: { receive_id_type: 'chat_id' },
      data: { receive_id: chatId, msg_type: 'audio', content },
    });
    if (response?.code && response.code !== 0) {
      throw new Error(`Feishu audio send failed: ${response.msg || response.code}`);
    }
    return nonEmptyString(response?.data?.message_id);
  }

  async #deliverArtifacts(chatId, replyTo, artifacts = [], baseReceipt) {
    const delivery = await deliverOutboundArtifacts({
      artifacts,
      baseReceipt,
      deliveryId: baseReceipt?.deliveryId ?? artifacts[0]?.deliveryKey ?? replyTo,
      aggregatePresentation: baseReceipt ? 'feishu-text-and-files' : 'feishu-files',
      channelKey: 'feishu',
      signal: this.#signal,
      sendImage: typeof this.#channel?.sendImage === 'function'
        ? (file) => this.#channel.sendImage(chatId, file, {
            replyTo,
            signal: this.#signal,
            ...(this.#replyInThreadFor(replyTo)
              ? { replyInThread: true, onReplyThreadId: async (threadId) => this.#registerTopicReply(replyTo, chatId, threadId) }
              : {}),
          })
        : undefined,
      sendFile: typeof this.#channel?.sendFile === 'function'
        ? (file) => this.#channel.sendFile(chatId, file, {
            replyTo,
            signal: this.#signal,
            ...(this.#replyInThreadFor(replyTo)
              ? { replyInThread: true, onReplyThreadId: async (threadId) => this.#registerTopicReply(replyTo, chatId, threadId) }
              : {}),
          })
        : undefined,
      onFailure: (artifact, error) => setLastMessageFailure(this.#status, error, {
        userMessage: artifactFailureText(artifact?.fileName, error),
        reason: error?.code,
      }),
      sendFailureNotice: async (_artifact, _error, failure) => ({
        messageId: await this.#send(
          chatId,
          messageFailureText(failure),
        ),
      }),
      logger: this.#logger,
    });
    this.#status.artifactsSent = (this.#status.artifactsSent ?? 0)
      + delivery.artifactsSent;
    this.#status.artifactSendErrors = (this.#status.artifactSendErrors ?? 0)
      + delivery.artifactSendErrors;
    if (!delivery.receipt) {
      return {
        receipt: createDeliveryReceipt({
          deliveryId: replyTo,
          presentation: 'feishu-files',
        }),
        failureNoticeVisible: delivery.failureNoticeVisible,
        artifactSendErrors: delivery.artifactSendErrors,
      };
    }
    return {
      receipt: delivery.receipt,
      failureNoticeVisible: delivery.failureNoticeVisible,
      artifactSendErrors: delivery.artifactSendErrors,
    };
  }

  // ── Step push (分步直推) ──────────────────────────────────────────────────

  /** One-line intent summary built from a tool call's JSON arguments. */
  #stepIntentSummary(argumentsText) {
    if (typeof argumentsText !== 'string' || !argumentsText.trim()) return null;
    let source = null;
    try {
      const parsed = JSON.parse(argumentsText);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const field of STEP_PUSH_INTENT_FIELDS) {
          const value = parsed[field];
          if (typeof value === 'string' && value.trim()) {
            source = value;
            break;
          }
          if (typeof value === 'number' && Number.isFinite(value)) {
            source = String(value);
            break;
          }
        }
      }
    } catch {
      source = argumentsText;
    }
    if (source === null) return null;
    return stepPushLine(source).slice(0, STEP_PUSH_SUMMARY_MAX_CHARS) || null;
  }

  /** Render one tool call as a rich-text post: headline + folded code block. */
  #formatStepToolPost(update) {
    const summary = this.#stepIntentSummary(update.arguments);
    const name = stepPushLine(update.name) || t('工具');
    const headline = `✅ ${name}${summary ? ` — ${summary}` : ''}`;
    const detail = typeof update.arguments === 'string' && update.arguments
      ? update.arguments.slice(0, STEP_PUSH_ARGUMENTS_MAX_CHARS)
      : '';
    const paragraphs = [[{ tag: 'text', text: headline }]];
    if (detail) {
      const language = /^\s*[[{]/.test(detail) ? 'JSON' : undefined;
      paragraphs.push(language
        ? [{ tag: 'code_block', language, text: detail }]
        : [{ tag: 'code_block', text: detail }]);
    }
    return {
      paragraphs,
      fallbackText: detail ? `${headline}\n▸ ${detail}` : headline,
    };
  }

  /**
   * Push one step message through the conversation's serial step queue: the
   * 250ms minimum interval guards Feishu's 5 QPS per-chat limit, and a turn
   * past the message cap stays silent (circuit breaker) while the final
   * answer still follows. Send failures are logged, never thrown — a flaky
   * step message must never break the turn.
   */
  async #sendStepMessage(chatId, key, paragraphs, fallbackText, replyToMessageId = null, { billable = true } = {}) {
    const state = this.#stepPushSendState.get(key)
      ?? { lastSentAt: 0, count: 0, breakerLogged: false };
    this.#stepPushSendState.set(key, state);
    // 真实事件到达：先撤回思考中心跳再推真实消息。
    // pendingRecallIds 是唯一撤回清单（live 心跳创建时即入队），避免同一 id 双撤回；
    // 撤回失败的 id 留在队列里待下个边界重试，不能在这里无条件清空。
    await this.#recallPendingHeartbeats(state);
    if (billable && state.count >= STEP_PUSH_MAX_MESSAGES_PER_TURN) {
      if (!state.breakerLogged) {
        state.breakerLogged = true;
        this.#logger.warn?.(
          `[dsh-feishu] step push hit ${STEP_PUSH_MAX_MESSAGES_PER_TURN} messages for this turn; staying silent until it ends`,
        );
      }
      // 熔断静默期内同样刷新 silenceSince：用户仍在活动，静默窗口重新计时，
      // 避免看门狗在每个被拦截的事件后重建/撤回心跳。activitySeq 单调递增，
      // 供心跳创建返回后识别「创建在途期间出现了真实活动」（同毫秒事件也能识别）。
      state.silenceSince = this.#stepPushClock.now();
      state.activitySeq = (state.activitySeq ?? 0) + 1;
      return;
    }
    this.#signal?.throwIfAborted();
    const wait = state.lastSentAt + STEP_PUSH_MIN_INTERVAL_MS - this.#stepPushClock.now();
    if (wait > 0) await this.#stepPushClock.delay(wait);
    // /stop or shutdown during the wait window must not let the queued
    // message land after the teardown has begun.
    this.#signal?.throwIfAborted();
    state.lastSentAt = this.#stepPushClock.now();
    state.silenceSince = state.lastSentAt;
    state.activitySeq = (state.activitySeq ?? 0) + 1;
    if (billable) state.count += 1;
    this.#status.streamUpdates = (this.#status.streamUpdates ?? 0) + 1;
    await this.#sendStepPost(chatId, replyToMessageId, paragraphs, fallbackText);
  }

  // ── Streaming step card (流式过程卡片) ─────────────────────────────────────

  /** Ensure the per-turn card state exists without scheduling a render. */
  #ensureStepCard(key, chatId, replyToMessageId) {
    let card = this.#stepCards.get(key);
    if (!card) {
      card = {
        blocks: [],
        messageId: null,
        chatId,
        replyToMessageId,
        broken: false,
        lastRenderAt: 0,
        renderQueued: false,
        renderChain: null,
        chunkCount: 1,
        cardIds: [],
        activeCardStart: 0,
        renderedCardContents: new Map(),
        answerStart: null,
        answerEnd: null,
        // Answer-integrity tracking: the version bumps every time the draft
        // is rewritten in memory; `renderedAnswerVersion` records the version
        // covered by the last SUCCESSFUL render. The seal may only skip the
        // post fallback when both match (the final answer is provably
        // visible on a delivered card).
        answerVersion: 0,
        renderedAnswerVersion: 0,
      };
      this.#stepCards.set(key, card);
    }
    return card;
  }

  /**
   * Append one process block to the turn's live streaming card: the first
   * block of a turn opens a card in the request topic, later blocks re-render
   * the same message via im.v1.message.patch. Consecutive tool lines merge
   * into one collapsible panel. Renders are coalesced behind
   * STEP_STREAM_PATCH_MIN_INTERVAL_MS; failures permanently downgrade the
   * turn (card.broken) — the final answer still delivers through the normal
   * ladder, and a flaky card never breaks the ask.
   */
  async #appendStepCardUpdate(key, chatId, replyToMessageId, block, { billable = true } = {}) {
    const card = this.#ensureStepCard(key, chatId, replyToMessageId);
    if (card.broken) return;
    const last = card.blocks[card.blocks.length - 1];
    if ((block.kind === 'tools' || block.kind === 'notes') && last?.kind === block.kind) {
      for (const line of block.lines) this.#pushPanelLine(last, line);
    } else {
      card.blocks.push(block);
    }
    if (billable) {
      this.#status.streamUpdates = (this.#status.streamUpdates ?? 0) + 1;
    }
    this.#queueStepCardRender(key, chatId);
  }

  /** Append one line to a foldable panel, shedding oldest lines past budget. */
  #pushPanelLine(block, line) {
    if (!Array.isArray(block.lines)) block.lines = [];
    block.omitted = Number(block.omitted) || 0;
    let size = Buffer.byteLength(block.lines.join('\n'), 'utf8');
    const incoming = Buffer.byteLength(line, 'utf8');
    while (block.lines.length > 0 && size + incoming > STEP_STREAM_PANEL_MAX_BYTES) {
      const removed = block.lines.shift();
      block.omitted += 1;
      size -= Buffer.byteLength(`${removed}\n`, 'utf8');
    }
    block.lines.push(line);
  }

  /**
   * Stream one finalized assistant step into the card as the live answer
   * draft: the newest step rewrites the draft blocks, so the answer grows in
   * place like ZCode's streaming card. Long answers are pre-chunked at
   * paragraph bounds so the block splitter can always spill them across
   * sealed cards. When a later tool call proves the draft interim,
   * #morphStepCardAnswerToNote folds it into the thinking panel.
   */
  #streamStepCardAnswer(key, chatId, replyToMessageId, text) {
    const card = this.#ensureStepCard(key, chatId, replyToMessageId);
    if (card.broken) return;
    const body = String(text ?? '');
    if (!body.trim()) return;
    this.#writeStepCardAnswer(card, body);
    this.#queueStepCardRender(key, chatId);
  }

  /** Replace the draft interval with `text` chunked into splitter-safe blocks. */
  #writeStepCardAnswer(card, text) {
    // Feishu rejects the whole card update when a Markdown image points at a
    // local file (`![x](/tmp/x.png)` -> 230099 / 200570), which freezes the
    // card mid-turn. Images the reader must see are uploaded separately; the
    // text keeps their caption instead.
    const safeText = stripLocalImageMarkdown(text);
    // JSON can expand one UTF-16 unit to six bytes (for example a control
    // character). Leave room for the element wrapper, and let the existing
    // Markdown splitter reopen fences in each independently rendered block.
    const chunks = Buffer.byteLength(JSON.stringify(safeText), 'utf8') + 128 <= STEP_STREAM_ANSWER_CHUNK_MAX_BYTES
      ? [safeText]
      : chunkMarkdownText(safeText, Math.floor((STEP_STREAM_ANSWER_CHUNK_MAX_BYTES - 128) / 6));
    const blocks = chunks
      .map((chunk) => ({ kind: 'message', text: chunk }));
    if (card.answerStart !== null) {
      card.blocks.splice(card.answerStart, card.answerEnd - card.answerStart + 1, ...blocks);
    } else {
      card.blocks.push(...blocks);
    }
    card.answerStart = card.blocks.length - blocks.length;
    card.answerEnd = card.blocks.length - 1;
    // The in-memory draft changed; nothing rendered so far can prove the new
    // answer is visible. The next successful render re-aligns the versions.
    card.answerVersion = (card.answerVersion ?? 0) + 1;
  }

  /** Convert the live answer draft into a folded thinking note in place. */
  #morphStepCardAnswerToNote(key, text) {
    const card = this.#stepCards.get(key);
    if (!card || card.broken) return;
    const body = String(text ?? '');
    if (!body.trim()) return;
    if (card.answerStart !== null) {
      card.blocks.splice(card.answerStart, card.answerEnd - card.answerStart + 1);
      card.answerStart = null;
      card.answerEnd = null;
    }
    const excerpt = body.length > STEP_STREAM_NOTE_MAX_CHARS
      ? `${body.slice(0, STEP_STREAM_NOTE_MAX_CHARS)}…`
      : body;
    const last = card.blocks[card.blocks.length - 1];
    if (last?.kind === 'notes') {
      this.#pushPanelLine(last, excerpt);
    } else {
      card.blocks.push({ kind: 'notes', lines: [excerpt], omitted: 0 });
    }
    this.#queueStepCardRender(key, card.chatId);
  }

  #queueStepCardRender(key, chatId) {
    const card = this.#stepCards.get(key);
    if (!card || card.broken || card.renderQueued) return;
    card.renderQueued = true;
    // The coalescing delay lives inside the serial chain, so a finish that
    // awaits the chain can never race a pending first render.
    const wait = Math.max(
      0,
      card.lastRenderAt + STEP_STREAM_PATCH_MIN_INTERVAL_MS - this.#stepPushClock.now(),
    );
    const previous = card.renderChain ?? Promise.resolve();
    card.renderChain = previous
      .catch(() => {})
      .then(() => this.#stepPushClock.delay(wait))
      .then(() => this.#renderStepCardNow(chatId, card))
      .finally(() => {
        card.renderQueued = false;
      });
  }

  /**
   * Persist the mirror state for a session-sync card after a successful
   * render. Plain IM cards (no sessionSyncSessionId) are never recorded —
   * their lifecycle is owned by the ask path, not the mirror recovery.
   * lastContent keeps stepStreamCard's raw JSON string (single-encoded).
   */
  async #persistMirrorState(card, liveBlocks, status, stepCardPanels) {
    const sessionId = card.sessionSyncSessionId;
    if (!sessionId || typeof this.#state.setMirror !== 'function') return;
    await this.#state.setMirror(card.sessionSyncKey, {
      sessionId, turn: card.sessionSyncTurn, targetId: card.sessionSyncTargetId,
      chatId: card.chatId,
      cardIds: [...card.cardIds],
      claimedAt: Date.now(),
      lastContent: stepStreamCard(liveBlocks, { status, stepCardPanels }),
      blocks: structuredClone(card.blocks), answerStart: card.answerStart, answerEnd: card.answerEnd,
      lastSeq: this.#sessionSyncTurns.get(card.sessionSyncKey)?.lastSeq ?? -1,
      pendingStep: this.#sessionSyncTurns.get(card.sessionSyncKey)?.pendingStep ?? null,
    });
  }

  /** Sync only this interaction's cards; earlier interactions remain sealed. */
  async #syncStepCardChunks(card, chunks, status, stepCardPanels) {
    const answerVersion = card.answerVersion ?? 0;
    const activeIds = card.cardIds.slice(card.activeCardStart);
    const groups = chunks.length ? [...chunks] : [[]];
    // Retain the last message as the live card when a rewritten answer shrinks.
    // Clear stale prefixes without introducing a separate deletion/retry path.
    while (groups.length < activeIds.length) {
      groups.unshift([{ kind: 'message', text: t('内容已合并至后续消息。') }]);
    }
    // Serialize before the first await: a concurrent draft must not change the
    // payload halfway through this render or be marked as already delivered.
    const contents = groups.map((blocks, index) => stepStreamCard(blocks, {
      status: index === groups.length - 1 ? status : 'sealed',
      stepCardPanels,
    }));
    for (let index = 0; index < contents.length; index += 1) {
      let id = activeIds[index];
      const content = contents[index];
      if (id) {
        if (card.renderedCardContents.get(id) !== content) {
          await this.#patchStepCard(id, content);
        }
      } else {
        id = await this.#sendCard(card.chatId, content, card.deliveryViaOpenId
          ? { receiveIdType: 'open_id' }
          : { replyTo: card.replyToMessageId });
        card.cardIds.push(id);
        activeIds.push(id);
      }
      card.renderedCardContents.set(id, content);
    }
    card.messageId = activeIds.at(-1);
    card.chunkCount = activeIds.length;
    card.renderedAnswerVersion = answerVersion;
  }

  async #renderStepCardNow(chatId, card) {
    if (card.broken) return;
    const stepCardPanels = this.#stepCardPanels;
    const chunks = splitStepStreamCardBlocks(card.blocks, undefined, undefined, stepCardPanels);
    if (!chunks.length && card.messageId === null) return;
    const live = chunks[chunks.length - 1] ?? [];
    try {
      await this.#syncStepCardChunks(card, chunks, 'running', stepCardPanels);
      await this.#persistMirrorState(card, live, 'running', stepCardPanels);
      card.lastRenderAt = this.#stepPushClock.now();
    } catch (error) {
      card.broken = true;
      card.lastError = error;
      this.#logger.warn?.(
        '[dsh-feishu] step streaming card render failed; the turn continues without it:',
        mirrorErrorText(error),
      );
      if (card.deliveryViaOpenId) {
        this.#logger.warn?.('[dsh-feishu] session-sync mirror card render failed:',
          mirrorErrorText(error),
          { sessionId: card.sessionSyncSessionId, turn: card.sessionSyncTurn });
      }
    }
  }

  /**
   * Seal the turn's card with a terminal status and the final answer. The
   * streamed answer draft is rewritten in place with the delivery text; when
   * no draft exists the answer is appended. Returns `{ ok, cardIds }` when
   * the answer is visible, `{ ok: false, error }` on failure, or null when
   * no card exists. Callers fall back unless ok is true. Safe to call twice.
   */
  async #finishStepCard(key, { stopped = false, answerText = null } = {}) {
    const card = this.#stepCards.get(key);
    this.#stepCards.delete(key);
    if (!card) return null;
    try {
      await card.renderChain?.catch?.(() => {});
    } catch { /* the seal below decides what the user sees */ }
    if (card.broken) {
      // The card froze on an earlier failed render; callers must fall back.
      this.#logger.warn?.(
        '[dsh-feishu] step streaming card is broken; the seal was skipped:',
        mirrorErrorText(card.lastError),
      );
      return { ok: false, error: card.lastError };
    }
    const status = stopped ? 'stopped' : 'completed';
    const body = typeof answerText === 'string' ? answerText : '';
    // Whether the answer was already visible from a streamed draft render —
    // decided BEFORE the seal writes the final text.
    const streamedDraft = card.answerStart !== null;
    if (body.trim()) {
      this.#writeStepCardAnswer(card, body);
    }
    const stepCardPanels = this.#stepCardPanels;
    const chunks = splitStepStreamCardBlocks(card.blocks, undefined, undefined, stepCardPanels);
    try {
      await this.#syncStepCardChunks(card, chunks, status, stepCardPanels);
      return { ok: true, cardIds: card.cardIds };
    } catch (error) {
      // Only trust the streamed draft when the LAST SUCCESSFUL render actually
      // covered the current answer version. A draft sitting in memory while
      // its render failed (or never ran) does not prove the answer is visible.
      const answerVisible = card.messageId !== null
        && body.trim()
        && (card.renderedAnswerVersion ?? 0) === (card.answerVersion ?? 0)
        && streamedDraft;
      if (answerVisible) {
        this.#logger.warn?.(
          '[dsh-feishu] step streaming card seal failed; the delivered answer stays visible:',
          error?.message ?? String(error),
        );
        return { ok: true, cardIds: card.cardIds };
      }
      this.#logger.warn?.(
        '[dsh-feishu] step streaming card finish failed:',
        mirrorErrorText(error),
        { sessionId: card.sessionSyncSessionId, turn: card.sessionSyncTurn },
      );
      return { ok: false, error };
    }
  }

  #stepCardToolBlock(update) {
    const summary = this.#stepIntentSummary(update.arguments);
    const name = stepPushLine(update.name) || t('工具');
    return { kind: 'tools', lines: [`✅ ${name}${summary ? ` — ${summary}` : ''}`], omitted: 0 };
  }

  /** Flag the in-flight streaming-card turn as user-stopped (seals 已停止). */
  #markStepStopRequested(key) {
    const flag = this.#stepStopFlags.get(key);
    if (flag) flag.requested = true;
  }

  /**
   * Freeze the live process card before an approval/question card renders;
   * later steps stream into a fresh card below the interaction (mirrors the
   * main streaming path's rotate). A failed seal never blocks the
   * interaction — the old card keeps its last rendered state.
   */
  async #rotateStepCard(key) {
    const card = this.#stepCards.get(key);
    if (!card || card.broken) return;
    await card.renderChain?.catch?.(() => {});
    if (card.broken) return;
    if (card.messageId === null) return;
    try {
      const stepCardPanels = this.#stepCardPanels;
      const chunks = splitStepStreamCardBlocks(card.blocks, undefined, undefined, stepCardPanels);
      await this.#syncStepCardChunks(card, chunks, 'sealed', stepCardPanels);
    } catch (error) {
      this.#logger.warn?.(
        '[dsh-feishu] step streaming card rotate seal failed:',
        error?.message ?? String(error),
      );
    }
    // Restart the stream on a fresh card below the interaction message.
    card.activeCardStart = card.cardIds.length;
    card.renderedCardContents.clear();
    card.blocks = [];
    card.messageId = null;
    card.chunkCount = 1;
    card.answerStart = null;
    card.answerEnd = null;
    card.lastRenderAt = 0;
  }

  async #patchStepCard(messageId, cardJson) {
    const response = await this.#cardRequest('step card patch', () => this.#client.im.v1.message.patch({
      path: { message_id: messageId },
      data: { content: cardJson },
    }));
    if (response?.code && response.code !== 0) {
      const error = new Error(`Feishu step card patch failed: ${response.msg || response.code}`);
      error.code = response.code;
      error.feishuCode = response.code;
      throw error;
    }
  }

  /**
   * Rich-text (post) delivery for step messages. Degradation ladder:
   * post（限流重试 ×2）→ 同话题纯文本回复 → 主界面纯文本。Returns
   * `{ ok, messageId?, error? }` — callers decide whether a failure is
   * tolerable (process notes: log and continue) or fatal (final answer:
   * surface it).
   */
  async #sendStepPost(chatId, replyToMessageId, paragraphs, fallbackText) {
    const content = JSON.stringify({ zh_cn: { content: paragraphs } });
    if (!replyToMessageId) {
      const sentId = await this.#send(chatId, fallbackText);
      return { ok: true, messageId: typeof sentId === 'string' ? sentId : null };
    }
    const replyInThread = this.#replyInThreadFor(replyToMessageId);
    let lastError = null;
    // 1) 富文本 post；限流/瞬时失败重试两次（结构化 code 感知）。
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await this.#replyStepMessage(
          chatId, replyToMessageId, 'post', content, replyInThread,
        );
        return {
          ok: true,
          messageId: nonEmptyString(response?.data?.message_id) ?? null,
        };
      } catch (error) {
        lastError = error;
        if (attempt < 2 && this.#isRetriableSendError(error)) {
          await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
          continue;
        }
        break;
      }
    }
    // 2) 明确降级：仅富文本格式被拒时，话题内纯文本回复仍然可用——
    //    优先留在话题内，而不是直接漏到主界面。
    try {
      const response = await this.#replyStepMessage(
        chatId, replyToMessageId, 'text', JSON.stringify({ text: fallbackText }), replyInThread,
      );
      return {
        ok: true,
        messageId: nonEmptyString(response?.data?.message_id) ?? null,
      };
    } catch (error) {
      lastError = lastError ?? error;
    }
    // 3) 最后兜底：主界面纯文本。
    this.#logger.warn?.(
      '[dsh-feishu] step push post failed; falling back to main chat text:',
      lastError?.message ?? String(lastError),
    );
    try {
      const sentId = await this.#send(chatId, fallbackText);
      return { ok: true, messageId: typeof sentId === 'string' ? sentId : null };
    } catch (fallbackError) {
      this.#logger.warn?.(
        '[dsh-feishu] step push send failed:',
        fallbackError?.message ?? String(fallbackError),
      );
      return { ok: false, error: lastError ?? fallbackError };
    }
  }

  /** Reply with one msg_type; throws errors carrying the structured Feishu code. */
  async #replyStepMessage(chatId, messageId, msgType, contentString, replyInThread) {
    const response = await this.#client.im.v1.message.reply({
      path: { message_id: messageId },
      data: {
        msg_type: msgType,
        content: contentString,
        ...(replyInThread ? { reply_in_thread: true } : {}),
      },
    });
    if (response?.code && response.code !== 0) {
      const error = new Error(`Feishu reply failed: ${response.msg || response.code}`);
      // Preserve the structured code: rate-limit detection must not depend on
      // the human-readable message surviving.
      error.code = response.code;
      error.feishuCode = response.code;
      throw error;
    }
    // 与其他回复路径同一条登记逻辑：响应通常带 thread_id，没带就回读被回复的消息
    // （#registerTopicReply → #ensureTopicRegistered）。逐步消息以前只认响应，
    // 于是话题开出来了却没登记，话题内的追问会从托管键掉回聊天自己的会话。
    // 两个分支都以「该消息仍是待开话题的候选根」为前提，不是候选就是空操作。
    await this.#registerTopicReply(messageId, chatId, response?.data?.thread_id);
    return response;
  }

  /** Rate-limit / transient send errors are worth one more attempt. */
  #isRetriableSendError(error) {
    const structured = [error?.code, error?.feishuCode, error?.response?.data?.code]
      .map((value) => String(value ?? ''));
    return structured.some((code) => code === '230020' || code === '230006')
      || /230020|230006/.test(error?.message ?? '');
  }

  #formatElapsed(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
  }

  /**
   * 撤回待撤回心跳清单：撤回成功（recallMessage 返回 true）的 id 移出队列；
   * 失败的保留，待下个真实事件/回合结束边界重试，单条最多尝试
   * STEP_PUSH_HEARTBEAT_RECALL_ATTEMPTS 次后放弃并告警（消息可能已被手动
   * 删除或接口持续受限，避免队列无限增长）。live 心跳撤回失败且仍在队列时
   * 保留 heartbeatMessageId：消息仍在会话里，看门狗继续原地刷新同一条，
   * 而不是另建一条造成重复。
   */
  async #recallPendingHeartbeats(state) {
    const remaining = [];
    for (const entry of state.pendingRecallIds ?? []) {
      let recalled = false;
      try {
        recalled = (await this.#channel?.recallMessage?.(entry.id)) === true;
      } catch (error) {
        this.#logger.warn?.('[dsh-feishu] heartbeat recall failed:', error?.message ?? String(error));
      }
      if (recalled) continue;
      const attempts = (entry.attempts ?? 0) + 1;
      if (attempts >= STEP_PUSH_HEARTBEAT_RECALL_ATTEMPTS) {
        this.#logger.warn?.(`[dsh-feishu] heartbeat recall gave up after ${attempts} attempts: ${entry.id}`);
        continue;
      }
      remaining.push({ id: entry.id, attempts });
    }
    state.pendingRecallIds = remaining;
    const liveId = state.heartbeatMessageId;
    if (liveId && !remaining.some((entry) => entry.id === liveId)) state.heartbeatMessageId = null;
  }

  /**
   * 撤回一条刚创建、但创建返回时已过时（回合已结束或创建在途期间出现了
   * 真实活动）的心跳：成功即丢弃；失败则按失败保留策略入队，待下个边界重试。
   */
  async #recallLateHeartbeat(state, messageId) {
    let recalled = false;
    try {
      recalled = (await this.#channel?.recallMessage?.(messageId)) === true;
    } catch (error) {
      this.#logger.warn?.('[dsh-feishu] late heartbeat recall failed:', error?.message ?? String(error));
    }
    if (recalled) return;
    state.pendingRecallIds = [...(state.pendingRecallIds ?? []), { id: messageId, attempts: 1 }];
  }

  /**
   * 思考中状态看门狗：直推回合内静默满阈值时推送/原地刷新一条「⏳ 正在思考中…」
   * 心跳 post；真实事件或回合结束时撤回。轮询检查可注入 stepPushClock（测试
   * 手动推进时钟），生命周期归属当前回合（stop 后循环退出）。
   */
  #startThinkingStatusWatchdog(key, chatId, replyToMessageId) {
    const state = this.#stepPushSendState.get(key);
    if (!state) return { stop: async () => {} };
    state.heartbeatStopped = false;
    state.heartbeatMessageId = null;
    state.heartbeatNextAttemptAt = 0;
    const watchdog = { stopped: false };
    void (async () => {
      try {
        // 轮询式看门狗：每 10ms 检查一次（真实时间），静默判定读取可注入
        // 时钟——生产随真实时间自然触发；测试手动推进时钟即可确定性验证。
        while (!watchdog.stopped && !this.#signal?.aborted && !state.heartbeatStopped) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          if (watchdog.stopped || this.#signal?.aborted || state.heartbeatStopped) return;
          const now = this.#stepPushClock.now();
          // 静默基线 = silenceSince（回合开始播种，每次真实推送刷新）。
          const silentFor = now - (state.silenceSince ?? state.turnStartedAt ?? now);
          if (state.heartbeatMessageId) {
            if (now - (state.heartbeatUpdatedAt ?? 0) < STEP_PUSH_HEARTBEAT_REFRESH_MS) continue;
            const elapsed = this.#formatElapsed(now - (state.heartbeatShownAt ?? state.heartbeatUpdatedAt));
            state.heartbeatUpdatedAt = this.#stepPushClock.now();
            state.heartbeatUpdates = (state.heartbeatUpdates ?? 0) + 1;
            if (state.heartbeatUpdates > STEP_PUSH_HEARTBEAT_MAX_UPDATES) {
              state.heartbeatStopped = true;
              continue;
            }
            try {
              const response = await this.#client.im.v1.message.update({
                path: { message_id: state.heartbeatMessageId },
                data: {
                  msg_type: 'post',
                  content: JSON.stringify({
                    zh_cn: { content: [[{ tag: 'text', text: t('⏳ 正在思考中…（已运行 {elapsed}）', { elapsed }) }]] },
                  }),
                },
              });
              if (response?.code && response.code !== 0) {
                this.#logger.warn?.('[dsh-feishu] heartbeat update failed:', response.msg || response.code);
              }
            } catch (error) {
              // 更新失败：保留心跳（消息仍在会话中），留待真实事件/回合结束撤回。
              this.#logger.warn?.('[dsh-feishu] heartbeat update failed:', error.message);
            }
            continue;
          }
          if (now < (state.heartbeatNextAttemptAt ?? 0)) continue;
          if (silentFor < STEP_PUSH_HEARTBEAT_AFTER_MS) continue;
          // 记录发起创建时的活动序号：创建请求在途期间若出现真实活动
          // （真实推送或熔断分支都会推进 activitySeq），这条心跳返回时
          // 已过时，必须立即撤回而不是登记为当前状态。
          const activitySeqAtDispatch = state.activitySeq ?? 0;
          const shownAt = now;
          const result = await this.#sendStepPost(
            chatId, replyToMessageId,
            [[{ tag: 'text', text: t('⏳ 正在思考中…（已运行 {elapsed}）', { elapsed: this.#formatElapsed(0) }) }]],
            t('⏳ 正在思考中…'),
          );
          if (watchdog.stopped || this.#signal?.aborted) {
            // 创建期间回合已结束：立即撤回刚发出的心跳，避免残留。
            if (result.ok && result.messageId) await this.#recallLateHeartbeat(state, result.messageId);
            return;
          }
          if ((state.activitySeq ?? 0) !== activitySeqAtDispatch) {
            // 创建期间出现真实活动：这条「正在思考中」会排在真实步骤之后，
            // 立即撤回且不登记（不进入原地刷新，也不作为 live 心跳）。
            if (result.ok && result.messageId) await this.#recallLateHeartbeat(state, result.messageId);
            continue;
          }
          if (result.ok) {
            state.heartbeatMessageId = result.messageId ?? null;
            state.pendingRecallIds = [...(state.pendingRecallIds ?? []), { id: result.messageId, attempts: 0 }];
            state.heartbeatShownAt = shownAt;
            state.heartbeatUpdatedAt = shownAt;
          } else {
            // 发送失败：退避后再试，避免每个轮询都重试造成堆积。
            state.heartbeatNextAttemptAt = now + 5_000;
          }
        }
      } catch (error) {
        if (!this.#signal?.aborted) {
          this.#logger.warn?.('[dsh-feishu] thinking status watchdog failed:', error.message);
        }
      }
    })();
    return {
      stop: async () => {
        watchdog.stopped = true;
        // 回合结束撤回：失败项保留在队列里（跨回合携带），待下个边界重试。
        await this.#recallPendingHeartbeats(state);
      },
    };
  }

  async #preparePrompt(event, key, message) {
    const snapshot = this.#acceptedMessageIds.get(event.message.message_id);
    const originalFiles = Array.isArray(message.files) ? [...message.files] : [];
    const build = async (input) => {
      const rich = hasInboundImages(input) || hasReplyReference(input);
      const original = rich
        ? await promptContentForInboundMessage(input, {
          signal: this.#signal,
          deferImages: true,
          originalFiles,
        })
        : input.content;
      const enhanced = enhanceContextContent(original, snapshot, () => ({
        channel: 'feishu',
        senderId: senderOpenId(event),
        chatId: event.message.chat_id,
        threadId: event.message.thread_id,
      }));
      return {
        content: rich || enhanced !== original ? enhanced : undefined,
        contextEnhanced: enhanced !== original,
        sourceGuidance: snapshot?.config?.guidance,
      };
    };
    const rootId = nonEmptyString(event.message.root_id);
    const topicAnchor = event.message.chat_type === 'group'
      && nonEmptyString(event.message.thread_id)
      && rootId && message.replyTo?.messageId === rootId
      // A reference-only message must not become an empty prompt.
      && (nonEmptyString(message.content) || hasInboundImages(message) || hasInboundFiles(message));
    if (!topicAnchor) return build(message);

    // Keep the temporary topic-root copy connected to the final request's
    // attachment array. Reply resolution may append lazy files to it.
    const withoutAnchor = {
      ...message,
      files: Array.isArray(message.files) ? message.files : (message.files = []),
    };
    delete withoutAnchor.replyTo;
    const base = await build(withoutAnchor);
    let preparedSessionId;
    let anchorLoaded = false;
    return {
      ...base,
      prepareContent: async ({ sessionId }) => {
        preparedSessionId = sessionId;
        anchorLoaded = false;
        const previous = this.#topicAnchors.get(key);
        if (previous?.sessionId === sessionId && previous.rootMessageId === rootId) {
          return base.content ?? message.content;
        }
        const prepared = await build({
          ...message,
          files: message.files,
          replyTo: {
            ...message.replyTo,
            load: async (options) => {
              const reference = await message.replyTo.load(options);
              anchorLoaded = !reference?.unavailableReason && Boolean(
                nonEmptyString(reference?.content) || reference?.attachments?.length,
              );
              return reference;
            },
          },
        });
        return prepared.content;
      },
      onAskComplete: (sessionId) => {
        if (!anchorLoaded || sessionId !== preparedSessionId) return;
        if (!this.#topicAnchors.has(key) && this.#topicAnchors.size >= MAX_TOPIC_ANCHORS) {
          this.#topicAnchors.delete(this.#topicAnchors.keys().next().value);
        }
        this.#topicAnchors.set(key, { sessionId, rootMessageId: rootId });
      },
    };
  }

  /**
   * 分步直推：`#answerWithStream` 流式分支在开关开启时的完整替代路径。
   * 过程（工具调用、助手中间说明）与最终答案均以富文本 post 逐条直推
   * （工具参数折叠为代码块）；post 失败走既有纯文本降级。
   */
  async #answerWithStepPush(event, key, message, { onAskComplete } = {}) {
    this.#beginImTurn(key);
    const chatId = event.message.chat_id;
    const messageId = event.message.message_id;
    const text = message.content;
    let askCompleted = false;
    const markAskComplete = (sessionId) => {
      if (askCompleted) return;
      askCompleted = true;
      prompt.onAskComplete?.(sessionId);
      this.#endImTurn(key);
      onAskComplete?.();
    };
    // 与流式分支一致的提示内容构造：图片与回复引用展开为富提示内容，已接受
    // 的上下文增强按原样重放。直推分流发生在 `#answerWithStream` 构造之前，
    // 这里就是本回合唯一一次构造（无重复的 prompt 往返）。
    const prompt = await this.#preparePrompt(event, key, message);
    const { content, contextEnhanced } = prompt;
    // Every turn reopens the per-conversation circuit breaker.
    const priorState = this.#stepPushSendState.get(key);
    if (this.#stepPushSendState.size >= MAX_STEP_PUSH_SEND_STATES && !priorState) {
      const oldest = this.#stepPushSendState.keys().next().value;
      if (oldest !== undefined) this.#stepPushSendState.delete(oldest);
    }
    this.#stepPushSendState.set(key, {
      // 思考中状态的静默基线 = 回合开始时刻；lastSentAt 仅供真实推送刷新，
      // 不参与心跳判定（否则首个真实步骤的节流等待会被误判/误伤）。
      silenceSince: this.#stepPushClock.now(),
      turnStartedAt: this.#stepPushClock.now(),
      lastSentAt: priorState?.lastSentAt ?? 0,
      // 撤回失败的心跳跨回合携带：回合边界没撤掉的「正在思考中」在下个
      // 回合的真实事件/结束时继续重试，而不是被 reopen 静默丢弃。
      pendingRecallIds: priorState?.pendingRecallIds ?? [],
      activitySeq: 0,
      count: 0,
      breakerLogged: false,
    });
    // 流式卡片模式：每轮一张过程卡（原地 patch），过程与最终答案都进卡；
    // post 模式维持逐条直推。先预建卡片状态，纯问答回合也能在收尾时开卡。
    // 飞书原生思考过程按 chat_id 创建，不会落进话题（#244）；话题内的回合改用
    // 实时过程卡（以 reply_in_thread 回复留在话题内），避免过程出现在话题外。
    const liveCotInTopic = this.#stepPushMode === FEISHU_STEP_PUSH_MODES.LIVE_COT
      && this.#replyInThreadFor(messageId);
    const streamingCard = this.#stepPushMode === FEISHU_STEP_PUSH_MODES.STREAMING_CARD
      || liveCotInTopic;
    const liveCot = this.#stepPushMode === FEISHU_STEP_PUSH_MODES.LIVE_COT
      && !liveCotInTopic
      && typeof this.#channel?.createCot === 'function'
      && typeof this.#channel?.writeCotEvents === 'function';
    const cot = liveCot
      ? new FeishuLiveCot(this.#channel, chatId, {
          replyTo: messageId,
          hidden: false,
          onFailure: (error) => this.#logger.warn?.(
            '[dsh-feishu] native live process failed; final answer will continue:',
            error?.message ?? String(error),
          ),
        })
      : null;
    if (streamingCard) {
      if (this.#stepCards.has(key)) {
        // 上一轮异常退出留下的「运行中」卡片先收尾，避免与本轮混淆。
        await this.#finishStepCard(key);
      }
      this.#ensureStepCard(key, chatId, messageId);
    }
    // /stop 打标：回合进行中收到停止请求时，封存为「已停止」而非「已完成」。
    const stepStopFlag = streamingCard ? { requested: false } : null;
    if (streamingCard) this.#stepStopFlags.set(key, stepStopFlag);
    const baseAskOptions = this.#interactionAskOptions(event, key, message.files, message.images);

    // 上下文注入动作在详细级别下也体现为一条步骤（注入细节可忽略）。
    // 不计入工具/助手消息的熔断计数（规格口径：熔断只管「工具 + 助手」）。
    if (contextEnhanced || content) {
      if (streamingCard) {
        await this.#appendStepCardUpdate(
          key, chatId, messageId,
          { kind: 'message', text: t('📎 已注入会话上下文') },
          { billable: false },
        );
      } else {
        await this.#sendStepMessage(
          chatId, key,
          [[{ tag: 'text', text: t('📎 已注入会话上下文') }]],
          t('📎 已注入会话上下文'),
          messageId,
          { billable: false },
        );
      }
    }

    // 缓冲-确认策略：每步定稿的助手文本先进缓冲；工具调用或更大 step 的定稿
    // 证明它是过程说明时才 flush 为 💬 消息。turn 结束时缓冲内剩余的即最终步
    // ——不直推，改为最终答案的富文本 post 内容，避免同一句话重复出现。
    let pendingStep = null;
    const flushPendingStep = async () => {
      if (!pendingStep) return;
      const note = pendingStep;
      pendingStep = null;
      if (streamingCard) {
        // 答案草稿被后续工具证实为过程说明：原位收进折叠的思考面板。
        this.#morphStepCardAnswerToNote(key, note.text);
        return;
      }
      await this.#sendStepMessage(
        chatId, key,
        [[{ tag: 'md', text: `💬 ${note.text}` }]],
        `💬 ${note.text}`,
        messageId,
      );
    };
    const watchdog = streamingCard || liveCot
      ? null
      : this.#startThinkingStatusWatchdog(key, chatId, messageId);
    let completed;
    try {
      completed = await askInWorkspaceSession({
        onNotice: (notice) => this.#send(chatId, notice, { replyTo: messageId }),
      deferredDelivery: () => ({ coordinator: this.#deferred, chatId, replyToMessageId: messageId }),
      harness: this.#harness,
      state: this.#state,
      key,
      text,
      content,
      titleText: event.batchSubmission?.title,
      sourceGuidance: prompt.sourceGuidance,
      prepareContent: prompt.prepareContent,
      contextEnhanced,
      createOptions: { signal: this.#signal },
      existsOptions: { signal: this.#signal },
      askOptions: {
        ...baseAskOptions,
        progressMode: liveCot ? 'live' : 'all',
        // 提问/审批卡弹出前先定格当前过程卡，答案随之流到交互消息之后
        // 的新卡上（与主流式路径的 rotate 语义一致）。
        ...(streamingCard ? {
          onInteraction: async (interaction) => {
            if (interaction?.kind === 'question' || interaction?.kind === 'approval') {
              await this.#rotateStepCard(key);
            }
            await baseAskOptions.onInteraction?.(interaction);
          },
        } : {}),
        onUpdate: async (update) => {
          if (liveCot) {
            await cot.handle(update);
            if (update.type === 'assistant-message') {
              pendingStep = update;
            } else if (update.type === 'tool') {
              pendingStep = null;
            }
            return;
          }
          if (update.type === 'assistant-message') {
            if (pendingStep && Number(update.step) > Number(pendingStep.step)) {
              await flushPendingStep();
            }
            pendingStep = update;
            if (streamingCard) {
              this.#streamStepCardAnswer(key, chatId, messageId, update.text);
            }
            return;
          }
          if (update.type === 'tool') {
            await flushPendingStep();
            if (streamingCard) {
              await this.#appendStepCardUpdate(key, chatId, messageId, this.#stepCardToolBlock(update));
              return;
            }
            const { paragraphs, fallbackText } = this.#formatStepToolPost(update);
            await this.#sendStepMessage(chatId, key, paragraphs, fallbackText, messageId);
            return;
          }
          if (update.type === 'status' && update.error) {
            const name = stepPushLine(update.toolName) || t('工具');
            const excerpt = stepPushLine(update.error).slice(0, STEP_PUSH_ERROR_MAX_CHARS);
            if (streamingCard) {
              await this.#appendStepCardUpdate(
                key, chatId, messageId,
                { kind: 'message', text: `⚠️ **${name}** — ${excerpt}` },
              );
              return;
            }
            await this.#sendStepMessage(
              chatId, key,
              [[{ tag: 'md', text: `⚠️ **${name}** — ${excerpt}` }]],
              `⚠️ ${name} — ${excerpt}`,
              messageId,
            );
          }
          // text / status（无错误）保持静默：详细级直推完全取代简略级进度行。
        },
      },
      });
    } catch (error) {
      await cot?.finish(error);
      if (streamingCard) {
        this.#stepStopFlags.delete(key);
        await this.#finishStepCard(key, { stopped: true });
      }
      throw error;
    } finally {
      // 回合结束（成功/失败/中断）：停看门狗并撤回残留思考中心跳。
      await watchdog?.stop();
    }
    markAskComplete(completed.sessionId);
    await cot?.finish();
    const finalStepText = pendingStep ? pendingStep.text : null;
    pendingStep = null;
    const finalText = (typeof finalStepText === 'string' && finalStepText.trim())
      ? finalStepText
      : completed.answer;
    const deliveryText = answerTextForDelivery(finalText, completed.artifacts ?? []);
    // 流式卡模式：答案已随步骤流进过程卡，封存后直接以卡片作回执；
    // 无卡/坏卡/封存失败时才回退到下方 post 阶梯。
    if (streamingCard) {
      const seal = await this.#finishStepCard(key, {
        answerText: deliveryText,
        stopped: stepStopFlag?.requested === true,
      });
      this.#stepStopFlags.delete(key);
      if (seal?.ok) {
        const cardReceipt = createDeliveryReceipt({
          deliveryId: messageId,
          presentation: 'feishu-step-push-card',
          providerMessageIds: seal.cardIds,
        });
        this.#status.streamResponses = (this.#status.streamResponses ?? 0) + 1;
        // 流式卡封存成功也是完整答案投递:文本进了卡片,语音回合同样要
        // 在此消费并合成音频回复——否则语音消息只得到卡片、没有声音。
        await this.#maybeSendVoiceReply(key, chatId, deliveryText, messageId);
        const delivery = await this.#deliverArtifacts(
          chatId,
          messageId,
          completed.artifacts ?? [],
          cardReceipt,
        );
        return { ...delivery, textDeliveryErrors: 0 };
      }
    }
    let textReceipt;
    let postDeliveryError = null;
    try {
      // 分步直推模式下最终答案以富文本 post（md 标签，GFM 全语法）推送；
      // 超长答案按段落边界切分为多条 post（单条 content 上限 30KB）。
      // 任一分段失败都视为最终答案失败——进入 catch 阶梯上抛，
      // 决不允许「用户没收到答案、状态却记为已回复」。
      const providerMessageIds = [];
      const chunks = splitStepPostMarkdown(deliveryText);
      let failedChunkIndex = -1;
      for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index];
        const result = await this.#sendStepPost(
          chatId,
          messageId,
          [[{ tag: 'md', text: chunk }]],
          chunk,
        );
        if (!result.ok) {
          postDeliveryError ??= new Error(
            result.error?.message ?? 'step push post delivery failed',
            { cause: result.error },
          );
          failedChunkIndex = index;
          break;
        }
        if (result.messageId) providerMessageIds.push(result.messageId);
      }
      if (postDeliveryError) {
        postDeliveryError.failedChunkIndex = failedChunkIndex;
        postDeliveryError.providerMessageIds = providerMessageIds;
        postDeliveryError.remainingChunks = chunks.slice(failedChunkIndex);
        throw postDeliveryError;
      }
      textReceipt = createDeliveryReceipt({
        deliveryId: messageId,
        presentation: liveCot ? 'feishu-live-cot-answer' : 'feishu-step-push-post',
        providerMessageIds,
      });
      this.#status.streamResponses = (this.#status.streamResponses ?? 0) + 1;
      await this.#maybeSendVoiceReply(key, chatId, deliveryText, messageId);
    } catch (error) {
      this.#status.streamErrors = (this.#status.streamErrors ?? 0) + 1;
      this.#logger.warn?.('[dsh-feishu] step push post failed; sending final text:', error.message);
      let textSendError = null;
      const providerMessageIds = Array.isArray(error?.providerMessageIds)
        ? [...error.providerMessageIds]
        : [];
      const remainingChunks = Array.isArray(error?.remainingChunks)
        ? error.remainingChunks
        : [deliveryText];
      for (const chunk of remainingChunks) {
        try {
          const receipt = await this.#sendAnswerText(chatId, chunk, {
            deliveryId: messageId,
            presentation: 'feishu-step-push-text',
            replyTo: messageId,
          });
          providerMessageIds.push(...receipt.providerMessageIds);
        } catch (fallbackError) {
          textSendError = channelDeliveryFailure(fallbackError);
          this.#logger.warn?.(
            '[dsh-feishu] fallback text delivery failed; continuing with result files:',
            fallbackError,
          );
          break;
        }
      }
      textReceipt = providerMessageIds.length > 0
        ? createDeliveryReceipt({
            deliveryId: messageId,
            presentation: 'feishu-step-push-post-and-text',
            providerMessageIds,
          })
        : undefined;
      const delivery = await this.#deliverArtifacts(
        chatId,
        messageId,
        completed.artifacts ?? [],
        textReceipt,
      );
      const artifactDispatched = delivery.receipt.artifacts.some(
        ({ outcome }) => outcome === 'sent' || outcome === 'unknown',
      );
      if (textSendError && !artifactDispatched && !delivery.failureNoticeVisible) {
        throw textSendError;
      }
      if (textSendError && delivery.artifactSendErrors === 0) {
        setLastMessageFailure(this.#status, textSendError);
      }
      this.#status.streamFallbacks = (this.#status.streamFallbacks ?? 0) + 1;
      await this.#maybeSendVoiceReply(key, chatId, deliveryText, messageId);
      return { ...delivery, textDeliveryErrors: textSendError ? 1 : 0 };
    }
    await this.#maybeSendVoiceReply(key, chatId, deliveryText, messageId);
    const delivery = await this.#deliverArtifacts(
      chatId,
      messageId,
      completed.artifacts ?? [],
      textReceipt,
    );
    return { ...delivery, textDeliveryErrors: 0 };
  }

  async #answerWithStream(event, key, message, { onAskComplete } = {}) {
    this.#beginImTurn(key);
    const chatId = event.message.chat_id;
    const messageId = event.message.message_id;
    const text = message.content;
    let askCompleted = false;
    const markAskComplete = (sessionId) => {
      if (askCompleted) return;
      askCompleted = true;
      prompt.onAskComplete?.(sessionId);
      this.#endImTurn(key);
      onAskComplete?.();
    };
    // 分步直推：开关开启且通道支持流式卡时，在构造提示内容之前分流到完整替
    // 代路径（`#answerWithStepPush` 自行构造一次，回复引用回合不做第二次
    // promptContentForInboundMessage 往返）；关闭或无流式卡通道时与 main
    // 零差异（含下方 `!this.#channel?.stream` 纯文本路径）。
    if (this.#stepPush && this.#channel?.stream) {
      return this.#answerWithStepPush(event, key, message, { onAskComplete });
    }
    const prompt = await this.#preparePrompt(event, key, message);
    const { content, contextEnhanced } = prompt;
    if (!this.#channel?.stream) {
      const { sessionId, answer, artifacts = [] } = await askInWorkspaceSession({
        onNotice: (notice) => this.#send(chatId, notice, { replyTo: messageId }),
        deferredDelivery: () => ({ coordinator: this.#deferred, chatId, replyToMessageId: messageId }),
        harness: this.#harness,
        state: this.#state,
        key,
        text,
        content,
        titleText: event.batchSubmission?.title,
        sourceGuidance: prompt.sourceGuidance,
        prepareContent: prompt.prepareContent,
        contextEnhanced,
        createOptions: { signal: this.#signal },
        existsOptions: { signal: this.#signal },
        askOptions: this.#interactionAskOptions(event, key, message.files, message.images),
      });
      markAskComplete(sessionId);
      let textReceipt;
      let textSendError = null;
      try {
        textReceipt = await this.#sendAnswerMarkdown(
          chatId,
          answerTextForDelivery(answer, artifacts),
          {
            deliveryId: messageId,
            presentation: 'feishu-text',
            replyTo: messageId,
          },
        );
      } catch (error) {
        textSendError = channelDeliveryFailure(error);
        this.#logger.warn?.(
          '[dsh-feishu] final text delivery failed; continuing with result files:',
          error,
        );
      }
      await this.#maybeSendVoiceReply(key, chatId, answerTextForDelivery(answer, artifacts), messageId);
      const delivery = await this.#deliverArtifacts(chatId, messageId, artifacts, textReceipt);
      const artifactDispatched = delivery.receipt.artifacts.some(
        ({ outcome }) => outcome === 'sent' || outcome === 'unknown',
      );
      if (textSendError && !artifactDispatched && !delivery.failureNoticeVisible) {
        throw textSendError;
      }
      if (textSendError && delivery.artifactSendErrors === 0) {
        setLastMessageFailure(this.#status, textSendError);
      }
      this.#status.streamFallbacks = (this.#status.streamFallbacks ?? 0) + 1;
      return { ...delivery, textDeliveryErrors: textSendError ? 1 : 0 };
    }

    let promptStarted = false;
    let completedAnswer = '';
    let completedArtifacts = [];
    let stream;
    try {
      stream = await this.#channel.stream(chatId, {
        markdown: async (controller) => {
          promptStarted = true;
          const baseAskOptions = this.#interactionAskOptions(event, key, message.files, message.images);
          const askOptions = {
            ...baseAskOptions,
            // issue #86：独立交互消息（提问/审批）会落在占位卡下方，呈现前
            // 先换卡，让最终答案落在交互消息之后的新流式卡上。
            onInteraction: async (interaction) => {
              try {
                if ((interaction?.kind === 'question' || interaction?.kind === 'approval')
                  && typeof controller?.rotate === 'function') {
                  await controller.rotate();
                }
                await baseAskOptions.onInteraction(interaction);
              } finally {
                // issue #163：呈现完成（或失败）即解除换卡挂起，此后建的新卡
                // 必然位于交互消息下方；interactionPresented 不存在时静默跳过。
                controller?.interactionPresented?.();
              }
            },
            onUpdate: async (update) => {
              await controller.setContent(this.#progressText(update), {
                transient: update.type !== 'text',
              });
              this.#status.streamUpdates = (this.#status.streamUpdates ?? 0) + 1;
            },
          };
          const completed = await askInWorkspaceSession({
            onNotice: (notice) => this.#send(chatId, notice, { replyTo: messageId }),
            deferredDelivery: () => ({ coordinator: this.#deferred, chatId, replyToMessageId: messageId }),
            harness: this.#harness,
            state: this.#state,
            key,
            text,
            content,
            titleText: event.batchSubmission?.title,
            sourceGuidance: prompt.sourceGuidance,
            prepareContent: prompt.prepareContent,
            contextEnhanced,
            createOptions: { signal: this.#signal },
            existsOptions: { signal: this.#signal },
            askOptions,
          });
          markAskComplete(completed.sessionId);
          completedAnswer = completed.answer;
          completedArtifacts = completed.artifacts ?? [];
          await controller.setContent(answerTextForDelivery(completedAnswer, completedArtifacts));
          await this.#maybeSendVoiceReply(key, chatId, answerTextForDelivery(completedAnswer, completedArtifacts), messageId);
        },
      }, {
        replyTo: messageId,
        ...(this.#replyInThreadFor(messageId)
          ? { replyInThread: true, onReplyThreadId: async (threadId) => this.#registerTopicReply(messageId, chatId, threadId) }
          : {}),
      });
    } catch (error) {
      this.#status.streamErrors = (this.#status.streamErrors ?? 0) + 1;
      if (completedAnswer || completedArtifacts.length > 0) {
        this.#logger.warn?.(
          '[dsh-feishu] native stream failed after generation; sending final text:',
          error.message,
        );
        let textReceipt;
        let textSendError = null;
        try {
          textReceipt = await this.#sendAnswerMarkdown(
            chatId,
            answerTextForDelivery(completedAnswer, completedArtifacts),
            {
              deliveryId: messageId,
              presentation: 'feishu-text-fallback',
              replyTo: messageId,
            },
          );
        } catch (fallbackError) {
          textSendError = channelDeliveryFailure(fallbackError);
          this.#logger.warn?.(
            '[dsh-feishu] fallback text delivery failed; continuing with result files:',
            fallbackError,
          );
        }
        await this.#maybeSendVoiceReply(key, chatId, answerTextForDelivery(completedAnswer, completedArtifacts), messageId);
        const delivery = await this.#deliverArtifacts(
          chatId,
          messageId,
          completedArtifacts,
          textReceipt,
        );
        const artifactDispatched = delivery.receipt.artifacts.some(
          ({ outcome }) => outcome === 'sent' || outcome === 'unknown',
        );
        if (textSendError && !artifactDispatched && !delivery.failureNoticeVisible) {
          throw textSendError;
        }
        if (textSendError && delivery.artifactSendErrors === 0) {
          setLastMessageFailure(this.#status, textSendError);
        }
        this.#status.streamFallbacks = (this.#status.streamFallbacks ?? 0) + 1;
        return { ...delivery, textDeliveryErrors: textSendError ? 1 : 0 };
      }
      if (promptStarted) throw error;

      this.#logger.warn?.('[dsh-feishu] native stream unavailable; using text fallback:', error.message);
      const { sessionId, answer, artifacts = [] } = await askInWorkspaceSession({
        onNotice: (notice) => this.#send(chatId, notice, { replyTo: messageId }),
        deferredDelivery: () => ({ coordinator: this.#deferred, chatId, replyToMessageId: messageId }),
        harness: this.#harness,
        state: this.#state,
        key,
        text,
        content,
        titleText: event.batchSubmission?.title,
        sourceGuidance: prompt.sourceGuidance,
        prepareContent: prompt.prepareContent,
        contextEnhanced,
        createOptions: { signal: this.#signal },
        existsOptions: { signal: this.#signal },
        askOptions: this.#interactionAskOptions(event, key, message.files, message.images),
      });
      markAskComplete(sessionId);
      let textReceipt;
      let textSendError = null;
      try {
        textReceipt = await this.#sendAnswerMarkdown(
          chatId,
          answerTextForDelivery(answer, artifacts),
          {
            deliveryId: messageId,
            presentation: 'feishu-text-fallback',
            replyTo: messageId,
          },
        );
      } catch (fallbackError) {
        textSendError = channelDeliveryFailure(fallbackError);
        this.#logger.warn?.(
          '[dsh-feishu] fallback text delivery failed; continuing with result files:',
          fallbackError,
        );
      }
      await this.#maybeSendVoiceReply(key, chatId, answerTextForDelivery(answer, artifacts), messageId);
      const delivery = await this.#deliverArtifacts(chatId, messageId, artifacts, textReceipt);
      const artifactDispatched = delivery.receipt.artifacts.some(
        ({ outcome }) => outcome === 'sent' || outcome === 'unknown',
      );
      if (textSendError && !artifactDispatched && !delivery.failureNoticeVisible) {
        throw textSendError;
      }
      if (textSendError && delivery.artifactSendErrors === 0) {
        setLastMessageFailure(this.#status, textSendError);
      }
      this.#status.streamFallbacks = (this.#status.streamFallbacks ?? 0) + 1;
      return { ...delivery, textDeliveryErrors: textSendError ? 1 : 0 };
    }
    const delivery = await this.#deliverArtifacts(
      chatId,
      messageId,
      completedArtifacts,
      createDeliveryReceipt({
        deliveryId: messageId,
        presentation: 'feishu-cardkit',
        providerMessageIds: providerMessageIdsFor(stream),
      }),
    );
    this.#status.streamResponses = (this.#status.streamResponses ?? 0) + 1;
    return delivery;
  }

  async #processInteractionReply(event, messageId, key, expected, processingReaction) {
    this.#signal?.throwIfAborted();
    const current = this.#pendingInteractions.get(key);
    const claimed = expected.claimedReplyMessageId === messageId;
    if (!current || current !== expected || current.submitting) {
      if (this.#isResolvedQuestionReply(event, key)) {
        return this.#discardResolvedInteractionReply(event, messageId);
      }
      if (claimed && (!current || current !== expected)) {
        return this.#discardResolvedInteractionReply(event, messageId);
      }
      return this.#enqueueMessage(event, messageId, key, processingReaction, {
        releaseMessageId: false,
        finalize: false,
      });
    }
    if (this.#state.hasSeen(messageId)) return;
    await this.#state.markSeen(messageId);
    this.#status.lastMessageAt = new Date().toISOString();
    this.#status.messagesReceived += 1;

    const text = extractText(event);
    if (!text) {
      await this.#send(event.message.chat_id, t('请用文字回答当前问题。'));
      return;
    }

    const pending = this.#pendingInteractions.get(key);
    if (!pending || pending !== expected || pending.submitting) {
      if (this.#isResolvedQuestionReply(event, key)) {
        await this.#send(event.message.chat_id, INTERACTION_RESOLVED_TEXT(), { replyTo: event.message.message_id }).catch(() => undefined);
        return;
      }
      if (claimed && (!pending || pending !== expected)) {
        await this.#send(event.message.chat_id, INTERACTION_RESOLVED_TEXT(), { replyTo: event.message.message_id });
        return;
      }
      return this.#enqueueMessage(event, messageId, key, processingReaction, {
        releaseMessageId: false,
        alreadyRecorded: true,
        finalize: false,
      });
    }
    pending.chatId = event.message.chat_id;
    pending.receiveIdType = 'chat_id';
    if (pending.needsPresentation) {
      try {
        await this.#presentInteraction(pending);
      } catch {
        this.#status.lastError = '飞书交互问题发送失败。';
        this.#logger.error?.('[dsh-feishu] failed to retry an interaction question');
        pending.interaction.reconnect?.();
      }
      return;
    }
    const question = pending.questions[pending.index];
    if (!question) return;

    await this.#submitQuestionAnswer(pending, text, {
      chatId: event.message.chat_id,
      messageId,
      questionMessageId: pending.questionCardMessageId,
    });
  }

  async #interruptQuestionForImage(event, key, pending) {
    if (this.#signal?.aborted || this.#pendingInteractions.get(key) !== pending) return;
    const question = pending.questions[pending.index];
    const questionMessageId = pending.questionCardMessageId;
    const index = pending.index;
    const wasSubmitting = pending.submitting;
    pending.submitting = true;
    try {
      await runControlCommand('/stop', this.#harness, this.#state, key, {
        signal: this.#signal,
        control: { owner: this, key },
      });
    } catch (error) {
      if (this.#pendingInteractions.get(key) === pending) pending.submitting = wasSubmitting;
      this.#logger.warn?.('[dsh-feishu] could not stop the question turn for an image:', error.message);
      await this.#send(event.message.chat_id,
        t('图片已排队，但暂时无法结束当前提问。请先回答问题或发送 /stop，结束后会继续处理图片。'),
        { replyTo: event.message.message_id }).catch(() => undefined);
      return;
    }
    await this.#cancelPendingInteraction(key, pending.interactionId);
    const resolvedText = t('已结束本轮提问，将在当前会话中继续处理图片。');
    if (questionMessageId) {
      await this.#patchCardMessage(event.message.chat_id, questionMessageId, questionCard({
        ...question,
        interactionId: pending.interactionId,
        index,
        total: pending.questions.length,
        resolvedText,
      }));
    }
    await this.#send(event.message.chat_id, resolvedText, { replyTo: event.message.message_id }).catch(() => undefined);
  }

  async #submitQuestionAnswer(pending, answerText, { chatId, messageId, questionMessageId } = {}) {
    const expectedIndex = pending.index;
    try { if (pending.validate) await pending.validate(); }
    catch {
      if (chatId) await this.#send(chatId, INTERACTION_RESOLVED_TEXT(), { replyTo: messageId }).catch(() => undefined);
      return;
    }
    if (pending.inactive || pending.submitting || pending.index !== expectedIndex) return;
    const question = pending.questions[pending.index];
    if (!question) return;
    pending.chatId = chatId ?? pending.chatId;
    if (chatId) pending.receiveIdType = 'chat_id';

    // issue #162：已答状态卡以推进前的题号渲染，并整卡替换原提问卡。
    const answeredIndex = pending.index;
    const answeredCardJson = answeredQuestionCard({
      interactionId: pending.interactionId,
      // 评审补充（#162）：与呈现提问卡保持一致，传入原题的文本/标题/说明，
      // 否则回执会退化为「请输入你的回答。」。
      question: question.question,
      header: question.header,
      detail: question.detail,
      options: Array.isArray(question?.options) ? question.options : [],
      chosen: answerText,
      index: answeredIndex,
      total: pending.questions.length,
    });
    const patchAnsweredCard = () => this.#patchCardMessage(
      pending.chatId,
      questionMessageId ?? pending.questionCardMessageId,
      answeredCardJson,
    );

    pending.answers.push(harnessAnswerForQuestion(question, answerText));
    pending.index += 1;
    if (pending.index < pending.questions.length) {
      if (pending.claimedReplyMessageId === messageId) {
        pending.claimedReplyMessageId = null;
      }
      pending.needsPresentation = true;
      await patchAnsweredCard();
      try {
        await this.#presentInteraction(pending);
      } catch {
        this.#status.lastError = '飞书交互问题发送失败。';
        this.#logger.error?.('[dsh-feishu] failed to send the next interaction question');
        pending.interaction.reconnect?.();
      }
      return;
    }

    pending.submitting = true;
    const key = pending.key;
    try {
      await pending.interaction.respond({
        ok: true,
        value: {
          sessionId: pending.sessionId,
          answer: { answers: pending.answers },
        },
      });
      await patchAnsweredCard();
      this.#answeredInteractionIds.set(pending.interactionId, Date.now() + RESOLVED_REPLY_TTL_MS);
      this.#rememberResolvedInteraction(key, pending);
      this.#clearPendingInteraction(key, pending.interactionId);
      this.#status.lastError = null;
    } catch (error) {
      if (this.#signal?.aborted) return;
      if (this.#pendingInteractions.get(key) !== pending) return;
      if (error?.code === 'interaction-not-pending') {
        this.#rememberResolvedInteraction(key, pending);
        this.#clearPendingInteraction(key, pending.interactionId);
        if (chatId && messageId) {
          await this.#send(chatId, INTERACTION_RESOLVED_TEXT(), { replyTo: messageId }).catch(() => undefined);
        }
        return;
      }
      pending.submitting = false;
      pending.answers.pop();
      pending.index -= 1;
      this.#status.lastError = '回答提交失败。';
      this.#logger.error?.('[dsh-feishu] failed to answer a Harness interaction');
      if (chatId) {
        await this.#send(chatId, t('回答提交失败，请重新发送当前问题的答案。'))
          .catch(() => undefined);
      }
    }
  }

  #approvalContext({ key, actor, chatId, requiresMention, replyToMessageId, receiveIdType,
    validate, send = (text) => this.#send(chatId, text, { replyTo: replyToMessageId }) }) {
    let approvalCardMessageId = null;
    let approvalCardData = null;
    return {
      key,
      actor,
      requiresMention,
      send,
      validate,
      // Approvals render as interactive cards with approve/reject buttons by
      // default. Set the bridge `interactionCards` option (or
      // DSH_IM_INTERACTION_CARDS=0) to keep the plain-text reply flow.
      ...(this.#interactionCards
        ? {
            render: async (pending) => {
              // Keep the original card details and id with this approval's callbacks.
              approvalCardData = {
                toolName: pending.toolCall?.name ?? pending.interaction.payload.toolName,
                operation: operationArguments(pending.toolCall),
                reason: pending.interaction.payload.reason,
                approvalId: pending.approvalId,
              };
              approvalCardMessageId = await this.#sendCard(
                chatId,
                approvalCard(approvalCardData),
                { key, replyTo: replyToMessageId, receiveIdType },
              ).catch(async () => {
                // Fall back to the plain-text approval if the card cannot be
                // sent. If the text send also fails, let the error propagate so
                // the pending approval is not marked as presented and the
                // existing retry/reconnect logic can run.
                await send(pending.text);
                return null;
              });
            },
            onResolved: async (resolvedText) => {
              if (!approvalCardMessageId) return;
              const patched = await this.#patchCardMessage(
                chatId,
                approvalCardMessageId,
                approvalCard({ ...approvalCardData, resolvedText }),
              );
              if (!patched) throw new Error('Approval card update failed');
            },
          }
        : {}),
    };

  }

  async presentSessionSyncApproval(interaction, context, options = {}) {
    return this.#approvals.handleSessionSyncRequested(interaction, this.#approvalContext(context), {
      ...options, runtimeSignal: this.#signal, accessPolicy: this.#accessPolicy,
    });
  }

  /** Use the normal question/reply state machine without submitting a new IM prompt. */
  async presentSessionSyncQuestion(interaction, context, { signal, completion } = {}) {
    if (signal?.aborted || this.#signal?.aborted || this.#hasPendingInteraction(context.key)) return false;
    let finished = false;
    const cleanup = () => {
      finished = true;
      signal?.removeEventListener('abort', finish);
      this.#signal?.removeEventListener('abort', onStop);
    };
    const finish = () => {
      const pending = this.#pendingInteractions.get(context.key);
      if (pending?.interactionId === interaction.interactionId) {
        this.#rememberResolvedInteraction(context.key, pending);
        this.#clearPendingInteraction(context.key, pending.interactionId);
      }
      cleanup();
    };
    const withdraw = async () => {
      finish();
      await interaction.withdraw?.();
    };
    const onStop = () => {
      void withdraw().catch((error) => this.#logger.warn?.('[dsh-feishu] question withdrawal failed:', error?.code));
    };
    const validate = async () => {
      try {
        await context.validate?.();
        if (finished || signal?.aborted || this.#signal?.aborted
          || (!this.#accessPolicy && !this.#allowedSenderOpenIds.has('*')
            && !this.#allowedSenderOpenIds.has(context.actor))
          || !context.actor || !evaluateInboundAccess(this.#accessPolicy, {
            conversationType: 'direct', senderIds: [context.actor], text: 'yes',
          }).allowed) throw new Error('Question recipient is no longer available');
      } catch (cause) {
        await withdraw();
        throw Object.assign(new Error('Question is no longer answerable', { cause }), { code: 'interaction-not-pending' });
      }
    };
    signal?.addEventListener('abort', finish, { once: true });
    this.#signal?.addEventListener('abort', onStop, { once: true });
    Promise.resolve(completion).then(finish, finish);
    try {
      await validate();
      await this.#handleInteraction(interaction, {
        ...context, validate, onClear: cleanup, lifecycle: 'session-sync',
      });
      if (finished) finish(); // A completion during delivery must not leave a pending behind.
      const available = !finished && this.#pendingInteractions.get(context.key)?.interactionId === interaction.interactionId;
      if (!available) cleanup();
      return available;
    } catch (error) {
      await withdraw();
      throw error;
    }
  }

  async #handleInteraction(interaction, {
    key,
    actor,
    chatId,
    requiresMention,
    replyToMessageId,
    receiveIdType,
    validate,
    onClear,
    lifecycle = 'turn',
  }) {
    if (await this.#approvals.handleRequested(interaction, this.#approvalContext({
      key, actor, chatId, requiresMention, replyToMessageId,
    }))) return;

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
      this.#logger.warn?.('[dsh-feishu] ignored an invalid Harness question interaction');
      return;
    }

    if (interaction.recovered === true) {
      await interaction.respond({
        ok: false,
        error: {
          code: 'cancelled',
          message: 'Feishu safely cancelled an interaction left by an earlier client.',
          details: {},
        },
      });
      await this.#send(
        chatId,
        t('检测到这个 Session 中遗留的待回答问题，已安全取消并继续处理你刚才的消息。'),
        { replyTo: replyToMessageId },
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
      if (interaction.withdraw) {
        await interaction.withdraw();
        return;
      }
      await interaction.respond({
        ok: false,
        error: {
          code: 'cancelled',
          message: 'Feishu is already handling another user interaction.',
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
      key,
      actor,
      requiresMention,
      questions,
      answers: [],
      index: 0,
      chatId,
      replyToMessageId,
      receiveIdType,
      validate,
      onClear,
      lifecycle,
      queue: null,
      claimedReplyMessageId: null,
      submitting: false,
      needsPresentation: true,
      questionMessageIds: new Set(),
      questionCardMessageId: null,
      inactive: false,
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
    const pending = this.#pendingInteractions.get(key);
    if (pending) this.#rememberResolvedInteraction(key, pending);
    this.#clearPendingInteraction(key, interactionId);
  }

  async #presentInteraction(pending) {
    if (pending.validate) await pending.validate();
    if (pending.inactive) return;
    const question = pending.questions[pending.index];
    if (!question) return;
    const options = Array.isArray(question?.options) ? question.options : [];
    // Single-choice questions with options render as interactive cards by
    // default. Multi-select or free-text questions and the text reply flow
    // remain when `interactionCards` is disabled (or DSH_IM_INTERACTION_CARDS=0).
    const interactive = this.#interactionCards
      && options.length > 0
      && question.multiSelect !== true;
    let messageId;
    let presentedAsCard = false;
    // 评审补充（#162）：每次呈现先重置——本题走文本路径（或卡片回退到文本）
    // 时不得沿用上一题的卡消息 id，否则后一题的回执会覆盖前一张已答卡。
    pending.questionCardMessageId = null;
    if (interactive) {
      // Single-choice question with options: render each option as a button.
      messageId = await this.#sendCard(
        pending.chatId,
        questionCard({
          interactionId: pending.interactionId,
          header: question.header,
          question: question.question,
          detail: question.detail,
          options,
          index: pending.index,
          total: pending.questions.length,
        }),
        { key: pending.key, replyTo: pending.replyToMessageId, receiveIdType: pending.receiveIdType },
      ).then((sent) => {
        presentedAsCard = true;
        return sent;
      }).catch(async () => {
        // Fall back to the plain-text question if the card cannot be sent.
        // If the text send also fails, let the error propagate so the pending
        // question is not marked as presented and the existing retry logic runs.
        if (pending.inactive) return null;
        if (pending.validate) await pending.validate();
        return this.#send(
          pending.chatId,
          harnessQuestionText(question, pending.index, pending.questions.length, {
            requiresMention: pending.requiresMention,
          }),
          { replyTo: pending.replyToMessageId, receiveIdType: pending.receiveIdType },
        );
      });
    } else {
      // Multi-select or free-text questions keep the plain-text reply flow.
      messageId = await this.#send(
        pending.chatId,
        harnessQuestionText(
          question,
          pending.index,
          pending.questions.length,
          { requiresMention: pending.requiresMention },
        ),
        { replyTo: pending.replyToMessageId, receiveIdType: pending.receiveIdType },
      );
    }
    if (messageId) {
      pending.questionMessageIds.add(messageId);
      // issue #162：仅卡片路径成功时记录——文本回退产生的消息 id 不参与已答回写。
      if (presentedAsCard) pending.questionCardMessageId = messageId;
      if (pending.inactive) this.#rememberResolvedInteraction(pending.key, pending);
    }
    pending.needsPresentation = false;
  }

  #isAnsweredInteraction(interactionId) {
    const now = Date.now();
    for (const [id, expiresAt] of this.#answeredInteractionIds) {
      if (expiresAt <= now) this.#answeredInteractionIds.delete(id);
    }
    return this.#answeredInteractionIds.has(interactionId);
  }

  #rememberResolvedInteraction(key, pending) {
    const expiresAt = Date.now() + RESOLVED_REPLY_TTL_MS;
    for (const messageId of pending.questionMessageIds ?? []) {
      this.#resolvedQuestionReplies.set(messageId, { key, expiresAt });
    }
  }

  #isResolvedQuestionReply(event, key) {
    const now = Date.now();
    for (const [messageId, resolution] of this.#resolvedQuestionReplies) {
      if (resolution.expiresAt <= now) this.#resolvedQuestionReplies.delete(messageId);
    }
    for (const reference of [event?.message?.parent_id, event?.message?.root_id]) {
      const resolution = this.#resolvedQuestionReplies.get(reference);
      if (resolution?.key === key && resolution.expiresAt > now) return true;
    }
    return false;
  }

  async #discardResolvedInteractionReply(event, messageId) {
    if (this.#state.hasSeen(messageId)) return;
    await this.#state.markSeen(messageId);
    this.#status.lastMessageAt = new Date().toISOString();
    this.#status.messagesReceived += 1;
    await this.#send(event.message.chat_id, INTERACTION_RESOLVED_TEXT(), { replyTo: event.message.message_id }).catch(() => undefined);
  }

  #takePendingInteraction(key, interactionId) {
    const pending = this.#pendingInteractions.get(key);
    if (!pending
      || (interactionId !== undefined && pending.interactionId !== interactionId)) return null;
    this.#pendingInteractions.delete(key);
    this.#interactionKeys.delete(pending.interactionId);
    pending.inactive = true;
    pending.onClear?.();
    return pending;
  }

  #clearPendingInteraction(key, interactionId) {
    return this.#takePendingInteraction(key, interactionId) !== null;
  }

  async #cancelPendingInteraction(key, interactionId) {
    const pending = this.#takePendingInteraction(key, interactionId);
    if (!pending || pending.kind !== 'question') return;
    this.#rememberResolvedInteraction(key, pending);
    try {
      // A synced question is owned by its upstream provider, not this IM turn.
      // Withdraw the IM route so the provider also releases its delivery state;
      // DS Bot's answer endpoint does not accept a Harness cancellation answer.
      if (pending.lifecycle === 'session-sync' && pending.interaction.withdraw) {
        await pending.interaction.withdraw();
        return;
      }
      await pending.interaction.respond({
        ok: false,
        error: {
          code: 'cancelled',
          message: 'The Feishu interaction ended before the user answered.',
          details: {},
        },
      }, { signal: AbortSignal.timeout(5_000) });
    } catch (error) {
      if (error?.code !== 'interaction-not-pending') {
        this.#logger.warn?.('[dsh-feishu] failed to cancel a pending Harness interaction');
      }
    }
  }

  #progressText(update) {
    if (update.type === 'text' && update.text) return update.text;
    if (update.type === 'tool') {
      if (update.name === 'web_search') return t('_正在搜索网络并整理信息…_');
      return t('_正在使用 {name}…_', { name: update.name || t('工具') });
    }
    return t('_{text}_', { text: update.text || t('正在处理…') });
  }

  #beginReaction(messageId) {
    return beginStatusReaction({
      adapter: this.#channel,
      target: messageId,
      reactions: { processing: 'OnIt', success: 'DONE', error: 'ERROR' },
      status: this.#status,
      logger: this.#logger,
      label: 'feishu',
    });
  }

  #removeProcessingReaction(_messageId, processingReaction) {
    processingReaction.clear();
  }

  #finishReaction(_messageId, processingReaction, finalEmojiType) {
    if (finalEmojiType === 'ERROR') processingReaction.error();
    else processingReaction.success();
  }

  async #send(chatId, text, { replyTo, receiveIdType = 'chat_id' } = {}) {
    const content = JSON.stringify({ text });
    if (replyTo) {
      try {
        const response = await this.#client.im.v1.message.reply({
          path: { message_id: replyTo },
          data: {
            msg_type: 'text',
            content,
            ...(this.#replyInThreadFor(replyTo) ? { reply_in_thread: true } : {}),
          },
        });
        if (response?.code && response.code !== 0) {
          throw new Error(`Feishu reply failed: ${response.msg || response.code}`);
        }
        await this.#registerTopicFromReply(replyTo, chatId, response);
        return nonEmptyString(response?.data?.message_id);
      } catch (error) {
        // The referenced message may be gone (recalled/deleted); keep the
        // delivery promise by falling back to a plain chat message.
        this.#logger.warn?.(
          '[dsh-feishu] threaded reply failed; falling back to a plain message:',
          error?.message ?? String(error),
        );
        // The topic never opened; a managed root candidate must not linger.
        this.#forgetTopicRoot(replyTo);
      }
    }
    const response = await this.#client.im.v1.message.create({
      params: { receive_id_type: receiveIdType },
      data: {
        receive_id: chatId,
        msg_type: 'text',
        content,
      },
    });
    if (response?.code && response.code !== 0) {
      throw new Error(`Feishu send failed: ${response.msg || response.code}`);
    }
    return nonEmptyString(response?.data?.message_id);
  }
}
