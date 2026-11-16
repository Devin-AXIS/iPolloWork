import { captureGroupHistory, groupHistoryEntry } from '../shared/group-history.mjs';
import { extractConnectionEvidence, createConnectionDiagnostics, atConnectionStage } from '../shared/connection-error.mjs';
import { createEditableMessageStream, splitMessageText } from '../shared/editable-message-stream.mjs';
import { chunkMarkdownText } from '../shared/markdown-chunks.mjs';
import { createTextDeliveryBlock } from '../shared/semantic/delivery.mjs';
import { fetchFileStream } from '../shared/file-download.mjs';
import { fetchImageBuffer } from '../shared/image-prompt.mjs';
import { t } from '../shared/i18n.mjs';
import { captureContextEnhancement } from '../shared/context-enhancement.mjs';
import { evaluateInboundAccess } from '../shared/inbound-access.mjs';
import { DiscordApi } from './discord-api.mjs';
import { createDiscordBridgeStatus, DiscordHarnessBridge } from './discord-bridge.mjs';

const DISCORD_GATEWAY_INTENTS = (1 << 0) | (1 << 9) | (1 << 12) | (1 << 15);
const THREAD_RECOVERY_TIMEOUT_MS = 5_000;
const RECONNECT_DELAYS_MS = Object.freeze([1_000, 3_000, 5_000, 10_000, 30_000]);
const GUILD_TEXT = 0;
const GUILD_ANNOUNCEMENT = 5;
const ANNOUNCEMENT_THREAD = 10;
const PUBLIC_THREAD = 11;
const PRIVATE_THREAD = 12;
const THREAD_TYPES = new Set([ANNOUNCEMENT_THREAD, PUBLIC_THREAD, PRIVATE_THREAD]);
const IMAGE_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const IMAGE_FILE_TYPES = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
]);
const DISCORD_IMAGE_HOSTS = Object.freeze(['cdn.discordapp.com']);

function socketUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'wss:') throw new Error('Discord returned an insecure Gateway URL');
  url.searchParams.set('v', '10');
  url.searchParams.set('encoding', 'json');
  return url.href;
}

function addSocketListener(socket, event, listener) {
  if (typeof socket.addEventListener === 'function') socket.addEventListener(event, listener);
  else if (typeof socket.on === 'function') socket.on(event, listener);
  else throw new TypeError('Discord WebSocket does not support events');
}

function eventData(event) {
  if (typeof event === 'string') return event;
  if (typeof event?.data === 'string') return event.data;
  if (Buffer.isBuffer(event)) return event.toString('utf8');
  if (Buffer.isBuffer(event?.data)) return event.data.toString('utf8');
  return null;
}

function gatewayCloseError(code) {
  if (code === 4004) {
    const error = new Error(t('Discord Bot Token 无效，请重新填写。'));
    error.code = 'discord-401';
    return error;
  }
  if (code === 4013 || code === 4014) {
    const error = new Error(t('Discord Gateway Intents 配置不正确，请检查 Developer Portal 的 Bot 设置。'));
    error.code = 'discord-intents';
    return error;
  }
  const error = new Error(`Discord Gateway closed (${code || 'unknown'})`);
  error.code = 'discord-gateway-closed';
  return error;
}

function stripBotMention(text, botId) {
  if (typeof text !== 'string') return '';
  return text
    .split(`<@${botId}>`).join('')
    .split(`<@!${botId}>`).join('')
    .trim();
}

function cleanThreadName(message, botId) {
  const name = stripBotMention(message?.content ?? '', botId).replace(/\s+/g, ' ').trim()
    || 'DeepSeek Harness';
  return [...name].slice(0, 100).join('');
}

function isThreadChannel(channel) {
  return THREAD_TYPES.has(Number(channel?.type));
}

function isThreadFromMessage(channel, message) {
  return isThreadChannel(channel)
    && String(channel?.id ?? '') === String(message?.id ?? '')
    && String(channel?.parent_id ?? '') === String(message?.channel_id ?? '');
}

function rememberChannel(channel, callback) {
  if (channel?.id) callback?.(channel);
  return channel;
}

function withConversationRoute(normalized, channel, botId, {
  fromSourceMessage = false,
  fallback = null,
  notice = null,
} = {}) {
  const channelId = String(channel?.id ?? normalized.conversationId);
  const thread = isThreadChannel(channel);
  const managed = thread && String(channel?.owner_id ?? '') === String(botId);
  const parentId = thread && channel?.parent_id ? String(channel.parent_id) : channelId;
  return {
    ...normalized,
    conversationId: channelId,
    addressed: normalized.addressed || managed,
    requiresMention: thread ? !managed : normalized.kind === 'group',
    replyTarget: {
      channelId,
      ...(!fromSourceMessage && normalized.replyTarget?.replyToMessageId
        ? { replyToMessageId: normalized.replyTarget.replyToMessageId }
        : {}),
      ...(notice ? { notice } : {}),
    },
    connectionTestTarget: { channelId },
    conversationRoute: {
      peerId: parentId,
      ...(thread ? { threadId: channelId, managed } : {}),
      ...(fallback ? { fallback } : {}),
    },
  };
}

function uncertainThreadCreate(error) {
  const status = Number(error?.status);
  return !Number.isInteger(status) || status >= 500;
}

function threadCreateUncertain(cause) {
  const error = new Error('Discord Thread creation result is uncertain', { cause });
  error.code = 'discord-thread-create-uncertain';
  return error;
}

async function findCreatedThread(api, message, { signal, onChannel } = {}) {
  try {
    const channel = rememberChannel(await api.getChannel({
      channelId: String(message.id),
      signal,
    }), onChannel);
    return isThreadFromMessage(channel, message) ? channel : null;
  } catch (error) {
    if (error?.status === 404) return null;
    throw error;
  }
}

async function sendThreadUncertainNotice(api, normalized, signal) {
  try {
    await api.createMessage({
      channelId: normalized.replyTarget.channelId,
      replyToMessageId: normalized.replyTarget.replyToMessageId,
      content: t('Thread 创建结果暂时无法确认。若已创建，请在对应 Thread 中重试；若未创建，请稍后重新 @机器人。'),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
  }
}

function attachmentMediaType(attachment) {
  const value = typeof attachment?.content_type === 'string'
    ? attachment.content_type.split(';', 1)[0].trim().toLowerCase() : '';
  if (IMAGE_MEDIA_TYPES.has(value)) return value;
  const filename = typeof attachment?.filename === 'string' ? attachment.filename.toLowerCase() : '';
  for (const [extension, mediaType] of IMAGE_FILE_TYPES) {
    if (filename.endsWith(extension)) return mediaType;
  }
  return null;
}

function attachmentSize(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function discordImageSource(attachment, fetchImpl) {
  const mediaType = attachmentMediaType(attachment);
  if (!mediaType || typeof attachment?.url !== 'string') return null;
  return {
    name: typeof attachment.filename === 'string' ? attachment.filename : undefined,
    mediaType,
    size: attachmentSize(attachment.size),
    load: (options) => fetchImageBuffer(attachment.url, {
      ...options,
      fetchImpl,
      allowedHosts: DISCORD_IMAGE_HOSTS,
    }),
  };
}

function discordFileSource(attachment, fetchImpl) {
  if (attachmentMediaType(attachment) || typeof attachment?.url !== 'string' || !attachment.url) {
    return null;
  }
  const mediaType = typeof attachment.content_type === 'string' && attachment.content_type
    ? attachment.content_type.split(';', 1)[0].trim().toLowerCase() : undefined;
  return {
    name: typeof attachment.filename === 'string' && attachment.filename
      ? attachment.filename : String(attachment.id ?? 'discord-file'),
    ...(mediaType ? { mediaType } : {}),
    size: attachmentSize(attachment.size),
    load: ({ signal } = {}) => fetchFileStream(attachment.url, {
      fetchImpl,
      signal,
      allowedHosts: DISCORD_IMAGE_HOSTS,
    }),
  };
}

function discordReplyAttachment(attachment) {
  if (!attachment || typeof attachment !== 'object') return null;
  const mediaType = typeof attachment.content_type === 'string'
    ? attachment.content_type.split(';', 1)[0].trim().toLowerCase() : '';
  const kind = mediaType.startsWith('image/') ? 'image'
    : mediaType.startsWith('audio/') ? 'audio'
      : mediaType.startsWith('video/') ? 'video' : 'file';
  const name = typeof attachment.filename === 'string' && attachment.filename
    ? attachment.filename : undefined;
  return { kind, ...(name ? { name } : {}) };
}

function discordReplySnapshot(message, fallbackMessageId) {
  if (!message || typeof message !== 'object') return null;
  const messageId = typeof message.id === 'string' && message.id
    ? message.id : fallbackMessageId;
  const authorId = typeof message.author?.id === 'string' && message.author.id
    ? message.author.id : undefined;
  const authorName = [message.member?.nick, message.author?.global_name, message.author?.username]
    .find((value) => typeof value === 'string' && value.trim());
  const attachments = Array.isArray(message.attachments)
    ? message.attachments.map(discordReplyAttachment).filter(Boolean)
    : [];
  if (Array.isArray(message.sticker_items)) {
    attachments.push(...message.sticker_items.map((sticker) => ({
      kind: 'image',
      ...(typeof sticker?.name === 'string' && sticker.name ? { name: sticker.name } : {}),
    })));
  }
  return {
    ...(messageId ? { messageId: String(messageId) } : {}),
    ...(authorId ? { authorId } : {}),
    ...(authorName ? { authorName } : {}),
    content: typeof message.content === 'string' ? message.content : '',
    attachments,
  };
}

function discordReplyReference(message, loadReply) {
  const channelId = String(message?.channel_id ?? '');
  const referenceId = typeof message?.message_reference?.message_id === 'string'
    && message.message_reference.message_id
    ? message.message_reference.message_id : undefined;
  const referenceChannelId = message?.message_reference?.channel_id;
  if (referenceChannelId !== undefined && String(referenceChannelId) !== channelId) {
    return {
      ...(referenceId ? { messageId: referenceId } : {}),
      unavailableReason: 'not-found',
    };
  }
  if (Object.hasOwn(message ?? {}, 'referenced_message')) {
    if (message.referenced_message === null) {
      return {
        ...(referenceId ? { messageId: referenceId } : {}),
        unavailableReason: 'deleted',
      };
    }
    if (message.referenced_message && typeof message.referenced_message === 'object') {
      const snapshotId = typeof message.referenced_message.id === 'string'
        && message.referenced_message.id ? message.referenced_message.id : undefined;
      if (String(message.referenced_message.channel_id ?? '') !== channelId
        || !snapshotId || (referenceId && snapshotId !== referenceId)) {
        return {
          ...(referenceId ? { messageId: referenceId } : {}),
          unavailableReason: 'not-found',
        };
      }
      return discordReplySnapshot(message.referenced_message, referenceId) ?? undefined;
    }
  }
  if (!referenceId) return undefined;
  if (typeof loadReply !== 'function') {
    return { messageId: referenceId, unavailableReason: 'not-delivered' };
  }
  return {
    messageId: referenceId,
    load: async ({ signal } = {}) => {
      const referenced = await loadReply({ channelId, messageId: referenceId, signal });
      if (!referenced || String(referenced.id ?? '') !== referenceId
        || String(referenced.channel_id ?? '') !== channelId) return null;
      return discordReplySnapshot(referenced, referenceId);
    },
  };
}

export function normalizeDiscordMessage(message, botId, {
  fetchImpl = fetch,
  loadReply,
} = {}) {
  if (!message?.id || !message?.channel_id || !message?.author?.id
    || Number(message.type) === 21) return null;
  const direct = !message.guild_id;
  const addressed = direct
    || message.mentions?.some((mention) => String(mention?.id) === String(botId));
  const replyTo = discordReplyReference(message, loadReply);
  return {
    messageId: String(message.id),
    senderId: String(message.author.id),
    contextSource: () => ({
      senderName: [message.member?.nick, message.author.global_name, message.author.username]
        .find((value) => typeof value === 'string' && value.trim()),
    }),
    senderIsBot: message.author.bot === true,
    kind: direct ? 'direct' : 'group',
    conversationId: String(message.channel_id),
    content: stripBotMention(message.content ?? '', botId),
    plainText: (!Array.isArray(message.attachments) || message.attachments.length === 0)
      && (!Array.isArray(message.sticker_items) || message.sticker_items.length === 0)
      && !message.poll,
    images: Array.isArray(message.attachments)
      ? message.attachments.map((attachment) => discordImageSource(attachment, fetchImpl)).filter(Boolean)
      : [],
    files: Array.isArray(message.attachments)
      ? message.attachments.map((attachment) => discordFileSource(attachment, fetchImpl)).filter(Boolean)
      : [],
    ...(replyTo ? { replyTo } : {}),
    addressed,
    replyTarget: {
      channelId: String(message.channel_id),
      replyToMessageId: String(message.id),
    },
    reactionTarget: {
      channelId: String(message.channel_id),
      messageId: String(message.id),
    },
    connectionTestTarget: { channelId: String(message.channel_id) },
  };
}

export async function resolveDiscordMessageRoute(message, botId, {
  api,
  channel,
  fetchImpl = fetch,
  signal,
  onChannel,
} = {}) {
  const normalized = normalizeDiscordMessage(message, botId, {
    fetchImpl,
    loadReply: typeof api?.getMessage === 'function'
      ? (options) => api.getMessage(options)
      : undefined,
  });
  if (!normalized || normalized.senderIsBot) return normalized;
  signal?.throwIfAborted();
  if (normalized.kind === 'direct') {
    return withConversationRoute(normalized, { id: normalized.conversationId, type: 1 }, botId);
  }
  if (!api || typeof api.getChannel !== 'function') {
    throw new TypeError('Discord route resolution requires the Discord API');
  }

  const sourceChannel = rememberChannel(channel ?? await api.getChannel({
    channelId: normalized.conversationId,
    signal,
  }), onChannel);
  if (isThreadChannel(sourceChannel)) {
    return withConversationRoute(normalized, sourceChannel, botId);
  }
  if (!normalized.addressed) return withConversationRoute(normalized, sourceChannel, botId);

  const sourceType = Number(sourceChannel?.type);
  if (sourceType !== GUILD_TEXT && sourceType !== GUILD_ANNOUNCEMENT) {
    return withConversationRoute(normalized, sourceChannel, botId, {
      fallback: 'unsupported-channel',
      notice: '当前频道不支持自动创建 Thread，已直接在当前频道回复。',
    });
  }

  signal?.throwIfAborted();
  let created;
  try {
    created = rememberChannel(await api.startThreadFromMessage({
      channelId: normalized.conversationId,
      messageId: normalized.messageId,
      name: cleanThreadName(message, botId),
      signal,
    }), onChannel);
    if (!isThreadFromMessage(created, message)) {
      throw new Error('Discord returned an invalid thread for the source message');
    }
  } catch (error) {
    let recovered;
    try {
      recovered = await findCreatedThread(api, message, {
        signal: AbortSignal.timeout(THREAD_RECOVERY_TIMEOUT_MS),
        onChannel,
      });
    } catch (recoveryError) {
      if (signal?.aborted) throw signal.reason ?? error;
      await sendThreadUncertainNotice(api, normalized, signal);
      throw threadCreateUncertain(recoveryError);
    }
    if (recovered) {
      return withConversationRoute(normalized, recovered, botId, { fromSourceMessage: true });
    }
    if (signal?.aborted) throw signal.reason ?? error;
    if (uncertainThreadCreate(error)) {
      await sendThreadUncertainNotice(api, normalized, signal);
      throw threadCreateUncertain(error);
    }
    return withConversationRoute(normalized, sourceChannel, botId, {
      fallback: 'thread-create-failed',
      notice: '无法创建 Thread，已直接在当前频道回复。',
    });
  }
  return withConversationRoute(normalized, created, botId, { fromSourceMessage: true });
}

export class DiscordBotClient {
  #api;
  #signal;
  #deliveredNotices = new WeakSet();

  constructor({ api, signal }) {
    this.#api = api;
    this.#signal = signal;
  }

  sendText(target, text) {
    return this.#sendText(target, text, false);
  }

  sendDelivery(target, value) {
    const block = createTextDeliveryBlock(value);
    return this.#sendText(target, block.text, block.format === 'markdown');
  }

  async #sendText(target, text, markdown) {
    const notice = !this.#deliveredNotices.has(target) && target?.notice
      ? String(target.notice) : null;
    const chunks = (markdown ? chunkMarkdownText : splitMessageText)(notice ? `${notice}\n\n${text}` : text, 1_900);
    const providerMessageIds = [];
    for (const [index, chunk] of chunks.entries()) {
      const result = await this.#api.createMessage({
        channelId: target.channelId,
        content: chunk,
        replyToMessageId: index === 0 ? target.replyToMessageId : undefined,
        signal: this.#signal,
      });
      if (notice && index === 0) this.#deliveredNotices.add(target);
      if (typeof result?.id === 'string' && result.id) providerMessageIds.push(result.id);
    }
    return { providerMessageIds };
  }

  sendTyping(target) {
    return this.#api.sendTyping({ channelId: target.channelId, signal: this.#signal });
  }

  sendFile(target, file) {
    return this.#api.createFileMessage({
      channelId: target.channelId,
      file,
      replyToMessageId: target.replyToMessageId,
      signal: this.#signal,
    });
  }

  addReaction(target, emoji, { signal } = {}) {
    return this.#api.addOwnReaction({
      channelId: target.channelId,
      messageId: target.messageId,
      emoji,
      signal: this.#operationSignal(signal),
    });
  }

  removeReaction(target, reactionKey, { signal } = {}) {
    return this.#api.removeOwnReaction({
      channelId: target.channelId,
      messageId: target.messageId,
      emoji: reactionKey,
      signal: this.#operationSignal(signal),
    });
  }

  async openStream(target) {
    const notice = !this.#deliveredNotices.has(target) && target?.notice
      ? String(target.notice) : null;
    const decorate = (content) => notice ? `${notice}\n\n${content}` : content;
    const stream = createEditableMessageStream({
      limit: notice ? 1_800 : 1_900,
      create: async (content) => {
        const message = await this.#api.createMessage({
          channelId: target.channelId,
          content: decorate(content),
          replyToMessageId: target.replyToMessageId,
          signal: this.#signal,
        });
        if (notice) this.#deliveredNotices.add(target);
        return message.id;
      },
      edit: (messageId, content) => this.#api.editMessage({
        channelId: target.channelId,
        messageId,
        content: decorate(content),
        signal: this.#signal,
      }),
      sendRemainder: (content) => this.#api.createMessage({
        channelId: target.channelId,
        content,
        signal: this.#signal,
      }),
      messageIdForResult: (message) => message?.id,
    });
    return stream.start();
  }

  #operationSignal(signal) {
    return signal ?? this.#signal;
  }
}

export function createDiscordRuntimeStatus() {
  return {
    startedAt: null,
    ready: false,
    connectionState: 'idle',
    harnessReachable: false,
    lastCheckedAt: null,
    lastConnectedAt: null,
    lastError: null,
    ...createDiscordBridgeStatus(),
  };
}

export class DiscordRuntime {
  #config;
  #token;
  #harness;
  #state;
  #contextEnhancement;
  #groupHistory;
  #accessPolicy;
  #logger;
  #diagnostics;
  #replyTimeoutMs;
  #connectTimeoutMs;
  #createApi;
  #createWebSocket;
  #random;
  #status = createDiscordRuntimeStatus();
  #api = null;
  #bridge = null;
  #abortController = null;
  #socket = null;
  #gatewayUrl = null;
  #resumeUrl = null;
  #sessionId = null;
  #sequence = null;
  #heartbeatTimer = null;
  #heartbeatAcked = true;
  #reconnectTimer = null;
  #reconnectAttempt = 0;
  #generation = 0;
  #stopped = true;
  #starting = null;
  #channels = new Map();
  #routing = new Map();

  constructor({
    config,
    token,
    harness,
    state,
    contextEnhancement,
    groupHistory,
    accessPolicy,
    logger = console,
    replyTimeoutMs = 600_000,
    connectTimeoutMs = 20_000,
    createApi = (options) => new DiscordApi(options),
    createWebSocket = (url) => new WebSocket(url),
    random = Math.random,
  }) {
    if (!config || !token || !harness || !state) {
      throw new TypeError('DiscordRuntime requires config, token, Harness, and state');
    }
    if (typeof createWebSocket !== 'function') throw new TypeError('DiscordRuntime requires WebSocket');
    this.#config = config;
    this.#token = token;
    this.#harness = harness;
    this.#state = state;
    this.#contextEnhancement = contextEnhancement;
    this.#groupHistory = groupHistory;
    this.#accessPolicy = accessPolicy;
    this.#logger = logger; this.#diagnostics = createConnectionDiagnostics({ channel: 'discord', logger });
    this.#replyTimeoutMs = replyTimeoutMs;
    this.#connectTimeoutMs = connectTimeoutMs;
    this.#createApi = createApi;
    this.#createWebSocket = createWebSocket;
    this.#random = random;
  }

  get status() {
    return structuredClone(this.#status);
  }

  async sendConnectionTest(text) {
    if (!this.#status.ready || !this.#bridge) {
      const error = new Error('Discord bot is not connected');
      error.code = 'test-target-unavailable';
      throw error;
    }
    return this.#bridge.sendConnectionTest(text);
  }

  async presentSessionSyncApproval(target, interaction, options = {}) {
    if (!this.#status.ready || !this.#bridge) return false;
    const channelId = target?.route?.channelId;
    const channel = await this.#api.getChannel({ channelId, signal: options.signal });
    const actor = channel?.type === 1 && channel.recipients?.length === 1
      ? channel.recipients[0]?.id : '';
    if (!actor) return false;
    return this.#bridge.presentSessionSyncApproval(interaction, {
      key: options.key, actor, validate: options.validate,
      send: (text) => this.sendProactiveText(target, text),
    }, options);
  }

  async sendProactiveText(target, text, options = {}) {
    if (!this.#status.ready || !this.#bridge) {
      const error = new Error('Discord bot is not connected');
      error.code = 'bot-not-connected';
      throw error;
    }
    const channelId = typeof target?.route?.channelId === 'string'
      ? target.route.channelId.trim() : '';
    if (target?.kind !== 'channel' || !channelId) {
      const error = new TypeError('Invalid Discord proactive delivery target');
      error.code = 'invalid-target';
      throw error;
    }
    return this.#bridge.sendProactiveText({ channelId }, text, options);
  }

  async start() {
    if (this.#status.ready && this.#socket) return this.status;
    if (this.#starting) return this.#starting;
    this.#starting = this.#start().finally(() => {
      this.#starting = null;
    });
    return this.#starting;
  }

  async #start() {
    await this.stop();
    this.#stopped = false;
    this.#sessionId = null;
    this.#resumeUrl = null;
    this.#sequence = null;
    this.#reconnectAttempt = 0;
    this.#channels.clear();
    this.#routing.clear();
    this.#status.startedAt = new Date().toISOString();
    this.#status.connectionState = 'connecting';
    this.#status.lastError = null; this.#status.error = null; this.#diagnostics.clear();
    await atConnectionStage('harness.check', () => this.#harness.ensureRunning());
    this.#status.harnessReachable = true;
    const controller = new AbortController();
    this.#abortController = controller;
    const api = this.#createApi({ token: this.#token });
    this.#api = api;
    try {
      const [bot, gateway] = await Promise.all([
        api.getCurrentUser({ signal: controller.signal }),
        api.getGatewayBot({ signal: controller.signal }),
      ]);
      if (String(bot?.id ?? '') !== this.#config.platformId || bot?.bot !== true) {
        throw new Error('Discord token identity does not match the saved bot');
      }
      this.#gatewayUrl = gateway?.url;
      const client = new DiscordBotClient({ api, signal: controller.signal });
      this.#bridge = new DiscordHarnessBridge({
        bot: client,
        harness: this.#harness,
        state: this.#state,
        contextEnhancement: this.#contextEnhancement,
        accessPolicy: this.#accessPolicy,
        status: this.#status,
        logger: this.#logger,
        replyTimeoutMs: this.#replyTimeoutMs,
        signal: controller.signal,
      });
      let timer;
      try {
        await Promise.race([
          this.#openSocket(false),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(Object.assign(new Error('Discord Gateway did not become ready in time'), { code: 'ETIMEDOUT', timeoutMs: this.#connectTimeoutMs })), this.#connectTimeoutMs);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      return this.status;
    } catch (error) {
      this.#status.ready = false;
      this.#status.connectionState = 'failed';
      this.#status.error = this.#diagnostics.report(error, { operation: 'connection.restore', reuse: true, botId: this.#config?.botId, automatic: true }).publicError;
      this.#status.lastError = this.#status.error.message;
      await this.stop();
      throw error;
    }
  }

  #openSocket(resume) {
    if (this.#stopped) return Promise.reject(new Error('Discord runtime is stopped'));
    const generation = ++this.#generation;
    const url = socketUrl(resume && this.#resumeUrl ? this.#resumeUrl : this.#gatewayUrl);
    const socket = this.#createWebSocket(url);
    this.#socket = socket;
    let settled = false;
    return new Promise((resolve, reject) => {
      const markReady = () => {
        if (settled || generation !== this.#generation) return;
        settled = true;
        this.#reconnectAttempt = 0;
        const now = Date.now();
        this.#status.ready = true;
        this.#status.connectionState = 'connected';
        this.#status.lastCheckedAt = now;
        this.#status.lastConnectedAt = now;
        this.#status.lastError = null; this.#status.error = null; this.#diagnostics.clear();
        resolve();
      };
      addSocketListener(socket, 'message', (event) => {
        if (generation !== this.#generation || this.#stopped) return;
        const raw = eventData(event);
        if (!raw) return;
        let packet;
        try {
          packet = JSON.parse(raw);
        } catch {
          this.#logger.warn?.('[dsh-im:discord] ignored malformed Gateway JSON');
          return;
        }
        if (Number.isSafeInteger(packet.s)) this.#sequence = packet.s;
        if (packet.op === 10) {
          this.#startHeartbeat(packet.d?.heartbeat_interval, socket, generation);
          if (resume && this.#sessionId) {
            this.#sendGateway(socket, {
              op: 6,
              d: { token: this.#token, session_id: this.#sessionId, seq: this.#sequence },
            });
          } else {
            this.#sendGateway(socket, {
              op: 2,
              d: {
                token: this.#token,
                intents: DISCORD_GATEWAY_INTENTS,
                properties: {
                  os: process.platform,
                  browser: 'dsh-im',
                  device: 'dsh-im',
                },
              },
            });
          }
          return;
        }
        if (packet.op === 11) {
          this.#heartbeatAcked = true;
          this.#status.lastCheckedAt = Date.now();
          return;
        }
        if (packet.op === 1) {
          this.#heartbeat(socket);
          return;
        }
        if (packet.op === 7) {
          socket.close(4000, 'Reconnect requested');
          return;
        }
        if (packet.op === 9) {
          if (packet.d !== true) {
            this.#sessionId = null;
            this.#resumeUrl = null;
            this.#sequence = null;
          }
          socket.close(4000, 'Invalid session');
          return;
        }
        if (packet.op !== 0) return;
        if (packet.t === 'READY') {
          this.#sessionId = packet.d?.session_id ?? null;
          this.#resumeUrl = packet.d?.resume_gateway_url ?? null;
          markReady();
        } else if (packet.t === 'RESUMED') {
          markReady();
        } else if (packet.t === 'GUILD_CREATE') {
          for (const channel of [...(packet.d?.channels ?? []), ...(packet.d?.threads ?? [])]) {
            this.#rememberChannel(channel);
          }
        } else if (packet.t === 'CHANNEL_CREATE' || packet.t === 'CHANNEL_UPDATE'
          || packet.t === 'THREAD_CREATE' || packet.t === 'THREAD_UPDATE') {
          this.#rememberChannel(packet.d);
        } else if (packet.t === 'CHANNEL_DELETE' || packet.t === 'THREAD_DELETE') {
          if (packet.d?.id) this.#channels.delete(String(packet.d.id));
        } else if (packet.t === 'THREAD_LIST_SYNC') {
          for (const channel of packet.d?.threads ?? []) this.#rememberChannel(channel);
        } else if (packet.t === 'MESSAGE_CREATE') {
          const bridge = this.#bridge;
          if (packet.d && bridge) {
            void this.#acceptMessage(packet.d, bridge).catch((error) => {
              if (generation !== this.#generation || this.#stopped) return;
              this.#logger.error?.(
                `[dsh-im:discord] bot ${this.#config.botId} message handling failed:`,
                extractConnectionEvidence(error).details,
              );
            });
          }
        }
      });
      addSocketListener(socket, 'close', (event = {}) => {
        if (generation !== this.#generation) return;
        this.#clearHeartbeat();
        if (this.#socket === socket) this.#socket = null;
        if (this.#stopped) {
          if (!settled) reject(new DOMException('Stopped', 'AbortError'));
          return;
        }
        const error = gatewayCloseError(Number(event.code) || 0);
        this.#status.ready = false;
        this.#status.connectionState = 'connecting';
        this.#status.error = this.#diagnostics.report(error, { operation: 'connection.monitor', botId: this.#config?.botId, automatic: true }).publicError;
        this.#status.lastError = this.#status.error.message;
        if (!settled) {
          settled = true;
          reject(error);
        }
        if (error.code === 'discord-401' || error.code === 'discord-intents') {
          this.#status.connectionState = 'failed';
          return;
        }
        this.#scheduleReconnect();
      });
      addSocketListener(socket, 'error', (event) => {
        const error = event?.error ?? new Error('WebSocket error');
        if (generation !== this.#generation || this.#stopped) return;
        this.#status.error = this.#diagnostics.report(error, { operation: 'connection.monitor', botId: this.#config?.botId, automatic: true }).publicError;
        this.#status.lastError = this.#status.error.message;
      });
    });
  }

  #rememberChannel(channel) {
    if (!channel?.id) return;
    this.#channels.set(String(channel.id), channel);
  }

  async #acceptMessage(message, bridge) {
    const messageId = String(message?.id ?? '');
    if (!messageId || this.#state.hasSeen(messageId)) return;
    const preflight = normalizeDiscordMessage(message, this.#config.platformId);
    if (preflight) await captureGroupHistory(this.#groupHistory, preflight, groupHistoryEntry('discord', message, preflight, {
      groupName: this.#channels.get(String(message.channel_id))?.name,
    }), { logger: this.#logger });
    let accessDecision;
    if (preflight?.kind === 'group' && preflight.addressed === true
      && preflight.senderIsBot !== true) {
      accessDecision = evaluateInboundAccess(this.#accessPolicy, {
        conversationType: 'group',
        senderIds: [preflight.senderId],
        text: preflight.content,
        hasImages: preflight.images.length > 0,
        hasFiles: preflight.files.length > 0,
      });
      if (!accessDecision.allowed) {
        // Let the shared bridge apply its normal silent/command-denial behavior,
        // but do so against the source channel before creating a Thread.
        await bridge.accept(preflight, { accessDecision });
        return;
      }
    }
    let route = this.#routing.get(messageId);
    if (!route) {
      const contextSnapshot = captureContextEnhancement(
        this.#contextEnhancement,
        message.guild_id ? 'group' : 'direct',
      );
      const busyMessageMode = this.#harness.currentBusyMessageMode?.() ?? 'queue';
      const pendingRoute = resolveDiscordMessageRoute(message, this.#config.platformId, {
        api: this.#api,
        channel: this.#channels.get(String(message.channel_id)),
        signal: this.#abortController?.signal,
        onChannel: (resolved) => this.#rememberChannel(resolved),
      });
      route = { pendingRoute, contextSnapshot, busyMessageMode };
      this.#routing.set(messageId, route);
      void pendingRoute.finally(() => {
        if (this.#routing.get(messageId) === route) this.#routing.delete(messageId);
      }).catch(() => undefined);
    }
    try {
      const normalized = await route.pendingRoute;
      if (normalized) {
        normalized.groupHistory = preflight?.groupHistory;
        await bridge.accept(normalized, {
          contextSnapshot: route.contextSnapshot,
          busyMessageMode: route.busyMessageMode,
          ...(accessDecision ? { accessDecision } : {}),
        });
      }
    } catch (error) {
      if (error?.code === 'discord-thread-create-uncertain') {
        await this.#state.markSeen(messageId);
      }
      throw error;
    }
  }

  #sendGateway(socket, payload) {
    if (socket.readyState !== 1) return;
    socket.send(JSON.stringify(payload));
  }

  #startHeartbeat(interval, socket, generation) {
    this.#clearHeartbeat();
    if (!Number.isFinite(interval) || interval < 1_000) {
      socket.close(4000, 'Invalid heartbeat interval');
      return;
    }
    this.#heartbeatAcked = true;
    const schedule = (delay) => {
      this.#heartbeatTimer = setTimeout(() => {
        if (this.#stopped || generation !== this.#generation || this.#socket !== socket) return;
        if (!this.#heartbeatAcked) {
          socket.close(4000, 'Heartbeat was not acknowledged');
          return;
        }
        this.#heartbeat(socket);
        schedule(interval);
      }, delay);
      this.#heartbeatTimer?.unref?.();
    };
    schedule(Math.floor(interval * this.#random()));
  }

  #heartbeat(socket) {
    this.#heartbeatAcked = false;
    this.#sendGateway(socket, { op: 1, d: this.#sequence });
  }

  #clearHeartbeat() {
    if (this.#heartbeatTimer !== null) clearTimeout(this.#heartbeatTimer);
    this.#heartbeatTimer = null;
    this.#heartbeatAcked = true;
  }

  #scheduleReconnect() {
    if (this.#stopped || this.#reconnectTimer !== null) return;
    const delay = RECONNECT_DELAYS_MS[Math.min(this.#reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
    this.#reconnectAttempt += 1;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      void this.#openSocket(Boolean(this.#sessionId)).catch((error) => {
        if (this.#stopped) return;
        this.#logger.warn?.('[dsh-im:discord] Gateway reconnect failed:', extractConnectionEvidence(error).details);
        this.#scheduleReconnect();
      });
    }, delay);
    this.#reconnectTimer?.unref?.();
  }

  async stop() {
    this.#stopped = true;
    this.#generation += 1;
    this.#abortController?.abort();
    this.#abortController = null;
    if (this.#reconnectTimer !== null) clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
    this.#clearHeartbeat();
    const socket = this.#socket;
    const bridge = this.#bridge;
    this.#socket = null;
    this.#bridge = null;
    this.#api = null;
    this.#routing.clear();
    try {
      if (socket && socket.readyState < 2) socket.close(1000, 'Plugin stopped');
    } catch (error) {
      this.#logger.warn?.(`[dsh-im:discord] bot ${this.#config.botId} failed to close Gateway:`, extractConnectionEvidence(error).details);
    }
    await Promise.race([
      bridge?.waitForIdle() ?? Promise.resolve(),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
    this.#status.ready = false;
    this.#status.connectionState = 'idle';
    return this.status;
  }
}
