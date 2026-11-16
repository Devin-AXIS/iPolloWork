import { captureGroupHistory, groupHistoryEntry } from '../shared/group-history.mjs';
import { extractConnectionEvidence, createConnectionDiagnostics, atConnectionStage } from '../shared/connection-error.mjs';
import { splitMessageText } from '../shared/editable-message-stream.mjs';
import { chunkMarkdownParts } from '../shared/markdown-chunks.mjs';
import { createTextDeliveryBlock } from '../shared/semantic/delivery.mjs';
import { t } from '../shared/i18n.mjs';
import { SlackApi } from './slack-api.mjs';
import { createSlackBridgeStatus, SlackHarnessBridge } from './slack-bridge.mjs';

const RECONNECT_DELAYS_MS = Object.freeze([1_000, 3_000, 5_000, 10_000, 30_000]);
const SLACK_MESSAGE_LIMIT = 38_000;
const SLACK_STREAM_CHUNK_LIMIT = 11_000;
const SLACK_MARKDOWN_BLOCK_REJECTION = Object.freeze(['invalid_blocks', 'invalid_blocks_format']);
const SLACK_MARKDOWN_REJECTION = Object.freeze([...SLACK_MARKDOWN_BLOCK_REJECTION, 'invalid_markdown']);
const IMAGE_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function addSocketListener(socket, event, listener) {
  if (typeof socket.addEventListener === 'function') socket.addEventListener(event, listener);
  else if (typeof socket.on === 'function') socket.on(event, listener);
  else throw new TypeError('Slack WebSocket does not support events');
}

function eventData(event) {
  const value = event?.data ?? event;
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  if (value instanceof ArrayBuffer) return Buffer.from(value).toString('utf8');
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('utf8');
  }
  return null;
}

function socketUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'wss:') throw new Error('Slack returned an insecure Socket Mode URL');
  return url.href;
}

function decodeSlackText(value) {
  return typeof value === 'string' ? value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>') : '';
}

function stripBotMention(value, botUserId) {
  return decodeSlackText(value)
    .split(`<@${botUserId}>`).join('')
    .split(`<@${String(botUserId).toLowerCase()}>`).join('')
    .split(`<@${String(botUserId).toUpperCase()}>`).join('')
    .trim();
}

function slackFileUrl(file) {
  return typeof file?.url_private_download === 'string' && file.url_private_download
    ? file.url_private_download : file?.url_private;
}

function slackReplyAttachment(file) {
  if (!file || typeof file !== 'object') return null;
  const mediaType = typeof file.mimetype === 'string' ? file.mimetype.toLowerCase() : '';
  const kind = mediaType.startsWith('image/') ? 'image'
    : mediaType.startsWith('audio/') ? 'audio'
      : mediaType.startsWith('video/') ? 'video' : 'file';
  const name = typeof file.name === 'string' && file.name
    ? file.name : typeof file.title === 'string' && file.title ? file.title : undefined;
  return { kind, ...(name ? { name } : {}) };
}

function slackReplySnapshot(message, messageTs) {
  if (!message || String(message.ts ?? '') !== messageTs) return null;
  const authorId = typeof message.user === 'string' && message.user
    ? message.user : typeof message.bot_id === 'string' && message.bot_id
      ? message.bot_id : undefined;
  const authorName = typeof message.username === 'string' && message.username
    ? message.username : undefined;
  return {
    messageId: messageTs,
    ...(authorId ? { authorId } : {}),
    ...(authorName ? { authorName } : {}),
    content: decodeSlackText(message.text ?? ''),
    attachments: Array.isArray(message.files)
      ? message.files.map(slackReplyAttachment).filter(Boolean)
      : [],
  };
}

function slackThreadReplyReference(event, loadReply) {
  const messageTs = typeof event?.thread_ts === 'string' ? event.thread_ts : '';
  if (!messageTs || messageTs === String(event?.ts ?? '')) return undefined;
  return {
    messageId: messageTs,
    load: async ({ signal } = {}) => {
      try {
        const message = await loadReply({
          channelId: String(event.channel),
          messageTs,
          signal,
        });
        return slackReplySnapshot(message, messageTs);
      } catch (error) {
        if (error?.code === 'slack-missing-scope') {
          return { messageId: messageTs, unavailableReason: 'permission-denied' };
        }
        throw error;
      }
    },
  };
}

function slackImageSource(file, loadFile) {
  const mediaType = typeof file?.mimetype === 'string' ? file.mimetype.toLowerCase() : '';
  const url = slackFileUrl(file);
  if (!IMAGE_MEDIA_TYPES.has(mediaType) || typeof url !== 'string' || !url) return null;
  return {
    name: typeof file.name === 'string' ? file.name : undefined,
    mediaType,
    size: Number.isSafeInteger(file.size) && file.size >= 0 ? file.size : undefined,
    load: (options) => loadFile(url, options),
  };
}

function slackFileSource(file, loadFile, loadFileInfo) {
  const mediaType = typeof file?.mimetype === 'string' && file.mimetype
    ? file.mimetype.toLowerCase() : undefined;
  const url = slackFileUrl(file);
  if (IMAGE_MEDIA_TYPES.has(mediaType)) return null;
  const requiresInfo = file?.file_access === 'check_file_info'
    && typeof file?.id === 'string' && file.id;
  if ((typeof url !== 'string' || !url) && !requiresInfo) return null;
  return {
    name: typeof file?.name === 'string' && file.name
      ? file.name : typeof file?.title === 'string' && file.title
        ? file.title : requiresInfo ? file.id : 'slack-file',
    ...(mediaType ? { mediaType } : {}),
    size: Number.isSafeInteger(file?.size) && file.size >= 0 ? file.size : undefined,
    load: async ({ signal } = {}) => {
      if (!requiresInfo) return loadFile(url, { signal });
      const resolved = await loadFileInfo(file.id, { signal });
      const resolvedUrl = slackFileUrl(resolved);
      if (typeof resolvedUrl !== 'string' || !resolvedUrl) {
        throw new Error('Slack files.info returned no downloadable URL');
      }
      const loaded = await loadFile(resolvedUrl, { signal });
      const name = typeof resolved?.name === 'string' && resolved.name
        ? resolved.name : typeof resolved?.title === 'string' && resolved.title
          ? resolved.title : file.id;
      const resolvedMediaType = typeof resolved?.mimetype === 'string' && resolved.mimetype
        ? resolved.mimetype.toLowerCase() : undefined;
      if (Buffer.isBuffer(loaded) || loaded instanceof Uint8Array) {
        return { data: loaded, name, ...(resolvedMediaType ? { mediaType: resolvedMediaType } : {}) };
      }
      return {
        ...loaded,
        name,
        ...(resolvedMediaType ? { mediaType: resolvedMediaType } : {}),
      };
    },
  };
}

export function normalizeSlackEvent(payload, botUserId, {
  loadFile = async () => { throw new Error('Slack file downloader is unavailable'); },
  loadFileStream = loadFile,
  loadFileInfo = async () => { throw new Error('Slack file metadata loader is unavailable'); },
  loadReply = async () => { throw new Error('Slack reply loader is unavailable'); },
} = {}) {
  const event = payload?.event;
  if (!event || !payload?.event_id || !event.channel || !event.user || !event.ts) return null;
  const direct = event.type === 'message' && event.channel_type === 'im';
  const mentioned = event.type === 'app_mention';
  const group = event.type === 'message' && ['channel', 'group'].includes(event.channel_type);
  if (!direct && !mentioned && !group) return null;
  if ((event.subtype && event.subtype !== 'file_share') || event.bot_id || event.app_id) return null;
  const threadTs = String(event.thread_ts ?? event.ts);
  const replyTo = slackThreadReplyReference(event, loadReply);
  return {
    messageId: String(payload.event_id),
    senderId: String(event.user),
    senderIsBot: String(event.user) === String(botUserId),
    kind: direct ? 'direct' : 'group',
    conversationId: direct ? String(event.channel) : `${event.channel}:${threadTs}`,
    contextSource: () => ({
      chatId: String(event.channel),
      threadId: event.thread_ts ? String(event.thread_ts) : undefined,
    }),
    content: stripBotMention(event.text ?? '', botUserId),
    plainText: !Array.isArray(event.files) || event.files.length === 0,
    images: Array.isArray(event.files)
      ? event.files.map((file) => slackImageSource(file, loadFile)).filter(Boolean)
      : [],
    files: Array.isArray(event.files)
      ? event.files.map((file) => slackFileSource(file, loadFileStream, loadFileInfo)).filter(Boolean)
      : [],
    ...(replyTo ? { replyTo } : {}),
    addressed: direct || mentioned,
    reactionTarget: {
      channelId: String(event.channel),
      messageTs: String(event.ts),
    },
    replyTarget: {
      channelId: String(event.channel),
      threadTs,
      recipientUserId: String(event.user),
      recipientTeamId: String(event.user_team ?? payload.team_id ?? ''),
    },
    connectionTestTarget: { channelId: String(event.channel) },
  };
}

export function isSlackToolProgress(text) {
  if (typeof text !== 'string') return false;
  const marker = '__DSH_IM_TOOL_NAME__';
  const template = t('正在使用{name}…', { name: marker });
  const markerIndex = template.indexOf(marker);
  if (markerIndex < 0) return false;
  const prefix = template.slice(0, markerIndex);
  const suffix = template.slice(markerIndex + marker.length);
  const source = text.trim();
  return source.startsWith(prefix)
    && source.endsWith(suffix)
    && source.length > prefix.length + suffix.length;
}

async function appendInChunks(api, target, ts, text, signal) {
  if (!text) return;
  for (let offset = 0; offset < text.length; offset += SLACK_STREAM_CHUNK_LIMIT) {
    await api.appendStream({
      channelId: target.channelId,
      ts,
      markdownText: text.slice(offset, offset + SLACK_STREAM_CHUNK_LIMIT),
      signal,
    });
  }
}

async function createSlackMessageStream({ api, target, signal, logger }) {
  const started = await api.startStream({
    channelId: target.channelId,
    threadTs: target.threadTs,
    recipientTeamId: target.recipientTeamId || undefined,
    recipientUserId: target.recipientUserId || undefined,
    signal,
  });
  const ts = typeof started?.ts === 'string' ? started.ts : null;
  if (!ts) throw new Error('Slack did not return a streaming message timestamp');

  let appended = '';
  let pending = '';
  let timer = null;
  let inFlight = null;
  let broken = false;
  let closed = false;
  const providerMessageIds = [ts];

  const appendLatest = async (text) => {
    const next = splitMessageText(text, SLACK_MESSAGE_LIMIT)[0] ?? '';
    if (!next || !next.startsWith(appended)) return;
    const delta = next.slice(appended.length);
    if (!delta) return;
    await appendInChunks(api, target, ts, delta, signal);
    appended = next;
  };

  const schedule = () => {
    if (closed || broken || timer !== null || inFlight || !pending) return;
    timer = setTimeout(() => {
      timer = null;
      const text = pending;
      pending = '';
      inFlight = appendLatest(text)
        .catch((error) => {
          broken = true;
          logger.warn?.('[dsh-im:slack] streaming append failed:', error);
        })
        .finally(() => {
          inFlight = null;
          schedule();
        });
    }, 350);
    timer?.unref?.();
  };

  return {
    messageId: ts,
    get providerMessageIds() {
      return [...providerMessageIds];
    },
    update(text) {
      if (closed || broken || typeof text !== 'string' || !text.trim()
        || isSlackToolProgress(text)) return;
      pending = text;
      schedule();
    },
    async finish(text) {
      if (closed) throw new Error('Slack message stream is already closed');
      closed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = '';
      await inFlight?.catch(() => undefined);

      const chunks = splitMessageText(text, SLACK_MESSAGE_LIMIT);
      const first = chunks[0] ?? t('处理完成。');
      if (!broken && first.startsWith(appended)) {
        await appendInChunks(api, target, ts, first.slice(appended.length), signal);
        await api.stopStream({ channelId: target.channelId, ts, signal });
        for (const chunk of chunks.slice(1)) {
          const result = await api.postMessage({
            channelId: target.channelId,
            threadTs: target.threadTs,
            text: chunk,
            signal,
          });
          if (typeof result?.ts === 'string' && result.ts) providerMessageIds.push(result.ts);
        }
      } else {
        const reason = broken ? 'broken' : 'prefix-mismatch';
        await api.stopStream({ channelId: target.channelId, ts, signal }).catch(() => undefined);
        const source = typeof text === 'string' && text.trim() ? text.trim() : t('处理完成。');
        const parts = chunkMarkdownParts(source, SLACK_STREAM_CHUNK_LIMIT);
        const markdownParts = parts.length > 0 ? parts : [{ markdown: source }];
        logger?.warn?.(
          `[dsh-im:slack] stream finalize fell back to chat.update (${reason}, length ${markdownParts[0].markdown.length})`,
        );
        await api.updateMessage({
          channelId: target.channelId,
          ts,
          text: markdownParts[0].markdown,
          signal,
        });
        for (const chunk of markdownParts.slice(1)) {
          const result = await api.postMessage({
            channelId: target.channelId,
            threadTs: target.threadTs,
            text: chunk.markdown,
            format: 'markdown_text',
            signal,
          });
          if (typeof result?.ts === 'string' && result.ts) providerMessageIds.push(result.ts);
        }
      }
    },
    cancel() {
      closed = true;
      pending = '';
      if (timer !== null) clearTimeout(timer);
      timer = null;
      void api.stopStream({ channelId: target.channelId, ts, signal }).catch(() => undefined);
    },
  };
}

export class SlackBotClient {
  #api;
  #signal;
  #logger;

  constructor({ api, signal, logger }) {
    this.#api = api;
    this.#signal = signal;
    this.#logger = logger;
  }

  #postMarkdown(target, text, format) {
    return this.#api.postMessage({
      channelId: target.channelId,
      threadTs: target.threadTs,
      text,
      format,
      signal: this.#signal,
    });
  }

  async #recoverRejectedMarkdown(target, chunk, error) {
    // Retry only a definite formatting rejection, never an ambiguous send.
    if (this.#signal?.aborted || Number(error?.status) >= 500
      || !SLACK_MARKDOWN_REJECTION.includes(error?.providerCode)) throw error;
    if (SLACK_MARKDOWN_BLOCK_REJECTION.includes(error.providerCode)) {
      this.#logger?.warn?.(
        `[dsh-im:slack] Markdown block rejected (${error.providerCode}); retrying markdown_text, length ${chunk.markdown.length}`,
      );
      try {
        const result = await this.#postMarkdown(target, chunk.markdown, 'markdown_text');
        return typeof result?.ts === 'string' && result.ts ? [result.ts] : [];
      } catch (retryError) {
        if (this.#signal?.aborted || Number(retryError?.status) >= 500
          || retryError?.providerCode !== 'invalid_markdown') throw retryError;
        error = retryError;
      }
    }
    this.#logger?.warn?.(
      `[dsh-im:slack] Markdown rejected (${error.providerCode}); sending this chunk as literal text, length ${chunk.plain?.length ?? 0}`,
    );
    if (!chunk.plain) return [];
    const result = await this.#postMarkdown(target, chunk.plain, 'literal');
    return typeof result?.ts === 'string' && result.ts ? [result.ts] : [];
  }

  async sendText(target, text) {
    const chunks = splitMessageText(text, SLACK_MESSAGE_LIMIT);
    const providerMessageIds = [];
    for (const chunk of chunks) {
      const result = await this.#api.postMessage({
        channelId: target.channelId,
        threadTs: target.threadTs,
        text: chunk,
        signal: this.#signal,
      });
      if (typeof result?.ts === 'string' && result.ts) providerMessageIds.push(result.ts);
    }
    return { providerMessageIds };
  }

  async sendDelivery(target, value) {
    const block = createTextDeliveryBlock(value);
    if (block.format === 'plain') return this.sendText(target, block.text);
    const providerMessageIds = [];
    // Standard Markdown blocks have a 12,000-character payload limit.
    for (const chunk of chunkMarkdownParts(block.text, SLACK_STREAM_CHUNK_LIMIT)) {
      this.#signal?.throwIfAborted();
      try {
        const result = await this.#postMarkdown(target, chunk.markdown, 'markdown');
        if (typeof result?.ts === 'string' && result.ts) providerMessageIds.push(result.ts);
      } catch (error) {
        const delivered = await this.#recoverRejectedMarkdown(target, chunk, error);
        providerMessageIds.push(...delivered);
      }
    }
    return { providerMessageIds };
  }

  async addReaction(target, emoji, { signal } = {}) {
    const reactionKey = String(emoji ?? '').trim();
    await this.#api.addReaction({
      channelId: target.channelId,
      messageTs: target.messageTs,
      emojiName: reactionKey,
      signal: signal ?? this.#signal,
    });
    return reactionKey;
  }

  removeReaction(target, reactionKey, { signal } = {}) {
    return this.#api.removeReaction({
      channelId: target.channelId,
      messageTs: target.messageTs,
      emojiName: reactionKey,
      signal: signal ?? this.#signal,
    });
  }

  openStream(target) {
    return createSlackMessageStream({
      api: this.#api,
      target,
      signal: this.#signal,
      logger: this.#logger,
    });
  }

  sendFile(target, file) {
    return this.#api.uploadFile({
      channelId: target.channelId,
      threadTs: target.threadTs,
      file,
      signal: this.#signal,
    });
  }
}

export function createSlackRuntimeStatus() {
  return {
    startedAt: null,
    ready: false,
    connectionState: 'idle',
    harnessReachable: false,
    lastCheckedAt: null,
    lastConnectedAt: null,
    lastError: null,
    ...createSlackBridgeStatus(),
  };
}

export class SlackRuntime {
  #config;
  #botToken;
  #appToken;
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
  #status = createSlackRuntimeStatus();
  #api = null;
  #bridge = null;
  #abortController = null;
  #socket = null;
  #appId = null;
  #reconnectTimer = null;
  #reconnectAttempt = 0;
  #generation = 0;
  #stopped = true;
  #starting = null;

  constructor({
    config,
    botToken,
    appToken,
    harness,
    state,
    contextEnhancement,
    groupHistory,
    accessPolicy,
    logger = console,
    replyTimeoutMs = 600_000,
    connectTimeoutMs = 20_000,
    createApi = (options) => new SlackApi(options),
    createWebSocket = (url) => new WebSocket(url),
  }) {
    if (!config || !botToken || !appToken || !harness || !state) {
      throw new TypeError('SlackRuntime requires config, both tokens, Harness, and state');
    }
    if (typeof createWebSocket !== 'function') throw new TypeError('SlackRuntime requires WebSocket');
    this.#config = config;
    this.#botToken = botToken;
    this.#appToken = appToken;
    this.#harness = harness;
    this.#state = state;
    this.#contextEnhancement = contextEnhancement;
    this.#groupHistory = groupHistory;
    this.#accessPolicy = accessPolicy;
    this.#logger = logger; this.#diagnostics = createConnectionDiagnostics({ channel: 'slack', logger });
    this.#replyTimeoutMs = replyTimeoutMs;
    this.#connectTimeoutMs = connectTimeoutMs;
    this.#createApi = createApi;
    this.#createWebSocket = createWebSocket;
  }

  get status() {
    return structuredClone(this.#status);
  }

  async sendConnectionTest(text) {
    if (!this.#status.ready || !this.#bridge) {
      const error = new Error('Slack bot is not connected');
      error.code = 'test-target-unavailable';
      throw error;
    }
    return this.#bridge.sendConnectionTest(text);
  }

  async presentSessionSyncApproval(target, interaction, options = {}) {
    if (!this.#status.ready || !this.#bridge) return false;
    const channelId = target?.route?.channelId;
    const channel = await this.#api.conversationInfo({ channelId, signal: options.signal });
    const actor = channel?.is_im === true && typeof channel.user === 'string' ? channel.user : '';
    if (!actor) return false;
    return this.#bridge.presentSessionSyncApproval(interaction, {
      key: options.key, actor, validate: options.validate,
      send: (text) => this.sendProactiveText(target, text),
    }, options);
  }

  async sendProactiveText(target, text, options = {}) {
    if (!this.#status.ready || !this.#bridge) {
      const error = new Error('Slack bot is not connected');
      error.code = 'bot-not-connected';
      throw error;
    }
    const channelId = typeof target?.route?.channelId === 'string'
      ? target.route.channelId.trim() : '';
    const threadTs = typeof target?.route?.threadTs === 'string'
      ? target.route.threadTs.trim() : '';
    if (!channelId
      || (target?.kind !== 'conversation' && target?.kind !== 'thread')
      || (target.kind === 'thread' && !threadTs)
      || (target.kind === 'conversation' && threadTs)) {
      const error = new TypeError('Invalid Slack proactive delivery target');
      error.code = 'invalid-target';
      throw error;
    }
    return this.#bridge.sendProactiveText({
      channelId,
      ...(threadTs ? { threadTs } : {}),
    }, text, options);
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
    this.#reconnectAttempt = 0;
    this.#status.startedAt = new Date().toISOString();
    this.#status.connectionState = 'connecting';
    this.#status.lastError = null; this.#status.error = null; this.#diagnostics.clear();
    await atConnectionStage('harness.check', () => this.#harness.ensureRunning());
    this.#status.harnessReachable = true;
    const controller = new AbortController();
    this.#abortController = controller;
    const api = this.#createApi({ botToken: this.#botToken, appToken: this.#appToken });
    this.#api = api;
    try {
      const identity = await api.authTest({ signal: controller.signal });
      if (`${identity?.team_id}:${identity?.user_id}` !== this.#config.platformId) {
        throw new Error('Slack Bot Token identity does not match the saved bot');
      }
      const client = new SlackBotClient({ api, signal: controller.signal, logger: this.#logger });
      this.#bridge = new SlackHarnessBridge({
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
          this.#connect(),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(Object.assign(new Error('Slack Socket Mode did not become ready in time'), { code: 'ETIMEDOUT', timeoutMs: this.#connectTimeoutMs })),
              this.#connectTimeoutMs,
            );
            timer?.unref?.();
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

  async #connect() {
    if (this.#stopped) throw new Error('Slack runtime is stopped');
    const connection = await this.#api.openConnection({ signal: this.#abortController?.signal });
    return this.#openSocket(connection?.url);
  }

  #openSocket(value) {
    if (this.#stopped) return Promise.reject(new Error('Slack runtime is stopped'));
    const generation = ++this.#generation;
    const socket = this.#createWebSocket(socketUrl(value));
    this.#socket = socket;
    let settled = false;
    return new Promise((resolve, reject) => {
      const markReady = (packet) => {
        if (settled || generation !== this.#generation) return;
        settled = true;
        this.#appId = packet?.connection_info?.app_id ?? null;
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
          this.#logger.warn?.('[dsh-im:slack] ignored malformed Socket Mode JSON');
          return;
        }
        if (packet.type === 'hello') {
          markReady(packet);
          return;
        }
        if (packet.envelope_id && socket.readyState === 1) {
          socket.send(JSON.stringify({ envelope_id: packet.envelope_id }));
          this.#status.lastCheckedAt = Date.now();
        }
        if (packet.type === 'disconnect') {
          socket.close(4000, 'Slack requested reconnect');
          return;
        }
        if (packet.type !== 'events_api' || packet.payload?.type !== 'event_callback') return;
        if (this.#appId && packet.payload.api_app_id
          && packet.payload.api_app_id !== this.#appId) return;
        const message = normalizeSlackEvent(packet.payload, this.#config.platformId.split(':')[1], {
          loadFile: (url, options) => this.#api.downloadFile({ url, ...options }),
          loadFileStream: (url, options) => this.#api.downloadFileStream({ url, ...options }),
          loadFileInfo: (fileId, options) => this.#api.fileInfo({ fileId, ...options }),
          loadReply: (options) => this.#api.getMessage(options),
        });
        const bridge = this.#bridge;
        if (message && bridge) {
          void captureGroupHistory(this.#groupHistory, message, groupHistoryEntry('slack', packet.payload, message, {
            scope: this.#config.platformId.split(':')[0],
          }), { logger: this.#logger })
            .then(() => bridge.accept(message)).catch((error) => {
            if (generation !== this.#generation || this.#stopped) return;
            this.#logger.error?.(
              `[dsh-im:slack] bot ${this.#config.botId} message handling failed:`,
              extractConnectionEvidence(error).details,
            );
          });
        }
      });

      addSocketListener(socket, 'close', (event = {}) => {
        if (generation !== this.#generation) return;
        if (this.#socket === socket) this.#socket = null;
        if (this.#stopped) {
          if (!settled) reject(new DOMException('Stopped', 'AbortError'));
          return;
        }
        const code = Number(event.code) || 0;
        const error = new Error(`Slack Socket Mode closed (${code || 'unknown'})`);
        this.#status.ready = false;
        this.#status.connectionState = 'connecting';
        this.#status.error = this.#diagnostics.report(error, { operation: 'connection.monitor', botId: this.#config?.botId, automatic: true }).publicError;
        this.#status.lastError = this.#status.error.message;
        if (!settled) {
          settled = true;
          reject(error);
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

  #scheduleReconnect() {
    if (this.#stopped || this.#reconnectTimer !== null) return;
    const delay = RECONNECT_DELAYS_MS[Math.min(this.#reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
    this.#reconnectAttempt += 1;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      void this.#connect().catch((error) => {
        if (this.#stopped) return;
        this.#logger.warn?.('[dsh-im:slack] Socket Mode reconnect failed:', extractConnectionEvidence(error).details);
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
    const socket = this.#socket;
    const bridge = this.#bridge;
    this.#socket = null;
    this.#bridge = null;
    this.#api = null;
    this.#appId = null;
    try {
      if (socket && socket.readyState < 2) socket.close(1000, 'Plugin stopped');
    } catch (error) {
      this.#logger.warn?.(`[dsh-im:slack] bot ${this.#config.botId} failed to close Socket Mode:`, extractConnectionEvidence(error).details);
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
