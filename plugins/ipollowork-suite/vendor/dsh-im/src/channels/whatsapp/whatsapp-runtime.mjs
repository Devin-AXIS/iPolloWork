import { captureGroupHistory, groupHistoryEntry } from '../shared/group-history.mjs';
import { createConnectionDiagnostics, atConnectionStage } from '../shared/connection-error.mjs';
import { createHash, randomBytes } from 'node:crypto';

import {
  areJidsSameUser,
  downloadMediaMessage,
  jidDecode,
  jidNormalizedUser,
  normalizeMessageContent,
} from '@whiskeysockets/baileys';

import { createEditableMessageStream, splitMessageText } from '../shared/editable-message-stream.mjs';
import { t } from '../shared/i18n.mjs';
import { ImagePromptError } from '../shared/image-prompt.mjs';
import { trackOutboundArtifactProviderPromise } from '../shared/semantic/artifact.mjs';
import { createWhatsappBridgeStatus, WhatsappHarnessBridge } from './whatsapp-bridge.mjs';
import { createTextDeliveryBlock } from '../shared/semantic/delivery.mjs';
import { chunkMarkdownText } from '../shared/markdown-chunks.mjs';
import { markdownToWhatsapp } from './whatsapp-markdown.mjs';
import {
  WHATSAPP_ACCESS_MODES,
  normalizeWhatsappAccountJid,
} from './config-store.mjs';
import { createWhatsappWebSession } from './whatsapp-web-session.mjs';

const IMAGE_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const DEFAULT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_DOWNLOAD_TIMEOUT_MS = 15_000;
const WHATSAPP_MEDIA_UPLOAD_TIMEOUT_MS = 120_000;
const WHATSAPP_TEXT_LIMIT = 4_000;
const MESSAGE_WRAPPER_KEYS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'documentWithCaptionMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'editedMessage',
  'associatedChildMessage',
  'groupStatusMessage',
  'groupStatusMessageV2',
];
const VIEW_ONCE_WRAPPER_KEYS = new Set([
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
]);
const WHATSAPP_ACCESS_POLICY_USER_SERVERS = new Set([
  's.whatsapp.net',
  'c.us',
  'lid',
  'hosted',
  'hosted.lid',
]);

function normalizeWhatsappAccessPolicyId(value) {
  if (typeof value !== 'string') return null;
  const candidate = value.trim();
  if (/^\+?\d+$/.test(candidate)) {
    return `${candidate.replace(/^\+/, '')}@s.whatsapp.net`;
  }
  const decoded = jidDecode(candidate);
  if (!decoded || !/^\d+$/.test(decoded.user)
    || !WHATSAPP_ACCESS_POLICY_USER_SERVERS.has(decoded.server)) return null;
  return candidate;
}

export function whatsappAccessPolicyIdsEqual(left, right) {
  const normalizedLeft = normalizeWhatsappAccessPolicyId(left);
  const normalizedRight = normalizeWhatsappAccessPolicyId(right);
  if (!normalizedLeft || !normalizedRight) return false;
  try {
    return areJidsSameUser(normalizedLeft, normalizedRight) === true;
  } catch {
    return false;
  }
}

function hasViewOnceWrapper(content) {
  let current = content;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth += 1) {
    const wrapperKey = MESSAGE_WRAPPER_KEYS.find((key) => current[key]?.message);
    if (!wrapperKey) return false;
    if (VIEW_ONCE_WRAPPER_KEYS.has(wrapperKey)) return true;
    current = current[wrapperKey].message;
  }
  return false;
}

function messageContext(content) {
  return content?.extendedTextMessage?.contextInfo
    ?? content?.imageMessage?.contextInfo
    ?? content?.videoMessage?.contextInfo
    ?? content?.documentMessage?.contextInfo
    ?? null;
}

function messageText(content) {
  return content?.conversation
    ?? content?.extendedTextMessage?.text
    ?? content?.imageMessage?.caption
    ?? content?.videoMessage?.caption
    ?? content?.documentMessage?.caption
    ?? '';
}

function whatsappReplyAttachment(kind, media, fallbackName) {
  if (!media || typeof media !== 'object') return null;
  const name = typeof media.fileName === 'string' && media.fileName
    ? media.fileName : typeof fallbackName === 'string' && fallbackName
      ? fallbackName : undefined;
  return { kind, ...(name ? { name } : {}) };
}

function whatsappReplyAttachments(content) {
  const attachments = [];
  if (content?.imageMessage) {
    attachments.push(whatsappReplyAttachment('image', content.imageMessage));
  }
  if (content?.documentMessage) {
    const mediaType = typeof content.documentMessage.mimetype === 'string'
      ? content.documentMessage.mimetype.toLowerCase() : '';
    attachments.push(whatsappReplyAttachment(
      mediaType.startsWith('image/') ? 'image' : 'file',
      content.documentMessage,
    ));
  }
  if (content?.audioMessage) {
    attachments.push(whatsappReplyAttachment('audio', content.audioMessage));
  }
  if (content?.videoMessage) {
    attachments.push(whatsappReplyAttachment('video', content.videoMessage));
  }
  if (content?.stickerMessage) {
    const mediaType = typeof content.stickerMessage.mimetype === 'string'
      ? content.stickerMessage.mimetype.toLowerCase() : '';
    attachments.push(whatsappReplyAttachment(
      mediaType.startsWith('video/') || content.stickerMessage.isAnimated === true
        ? 'video' : 'image',
      content.stickerMessage,
    ));
  }
  return attachments.filter(Boolean);
}

function whatsappReplyReference(context) {
  if (!context?.quotedMessage || typeof context.quotedMessage !== 'object') return undefined;
  const content = normalizeMessageContent(context.quotedMessage);
  const messageId = typeof context.stanzaId === 'string' && context.stanzaId
    ? context.stanzaId : undefined;
  const authorId = typeof context.participant === 'string' && context.participant
    ? context.participant : undefined;
  return {
    ...(messageId ? { messageId } : {}),
    ...(authorId ? { authorId } : {}),
    content: messageText(content),
    attachments: whatsappReplyAttachments(content),
  };
}

function mediaSize(value) {
  if (Number.isSafeInteger(value) && value >= 0) return value;
  let converted;
  try {
    converted = Number(value?.toString?.());
  } catch {
    return undefined;
  }
  return Number.isSafeInteger(converted) && converted >= 0 ? converted : undefined;
}

async function downloadWhatsappImage(message, download, {
  signal,
  maxBytes = DEFAULT_MAX_IMAGE_BYTES,
} = {}) {
  signal?.throwIfAborted();
  const timeout = AbortSignal.timeout(IMAGE_DOWNLOAD_TIMEOUT_MS);
  const downloadSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const pendingStream = Promise.resolve().then(() => (
    download(message, 'stream', { options: { signal: downloadSignal } })
  ));
  const stream = await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return false;
      settled = true;
      downloadSignal.removeEventListener('abort', onAbort);
      callback(value);
      return true;
    };
    const onAbort = () => finish(reject, downloadSignal.reason);
    downloadSignal.addEventListener('abort', onAbort, { once: true });
    pendingStream.then((value) => {
      if (!finish(resolve, value)) value?.destroy?.();
    }, (error) => finish(reject, error));
    if (downloadSignal.aborted) onAbort();
  }).catch((error) => {
    if (signal?.aborted) throw signal.reason ?? error;
    if (timeout.aborted) {
      throw new ImagePromptError(
        'image-download-failed',
        `WhatsApp image download timed out after ${IMAGE_DOWNLOAD_TIMEOUT_MS} ms`,
        t('图片下载失败，请重新发送后再试。'),
      );
    }
    throw error;
  });
  const chunks = [];
  let size = 0;
  const abortStream = () => stream?.destroy?.(downloadSignal.reason);
  downloadSignal.addEventListener('abort', abortStream, { once: true });
  try {
    for await (const chunk of stream) {
      downloadSignal.throwIfAborted();
      const data = Buffer.from(chunk);
      size += data.length;
      if (size > maxBytes) {
        stream.destroy?.();
        throw new ImagePromptError(
          'image-too-large',
          `WhatsApp image exceeded ${maxBytes} bytes`,
          t('图片超过 5 MB，请压缩后重试。'),
        );
      }
      chunks.push(data);
    }
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    if (timeout.aborted) {
      throw new ImagePromptError(
        'image-download-failed',
        `WhatsApp image stream timed out after ${IMAGE_DOWNLOAD_TIMEOUT_MS} ms`,
        t('图片下载失败，请重新发送后再试。'),
      );
    }
    throw error;
  } finally {
    downloadSignal.removeEventListener('abort', abortStream);
  }
  return Buffer.concat(chunks, size);
}

function whatsappImageSource(message, content, download, { viewOnce = false } = {}) {
  let media;
  let name;
  if (!viewOnce && content?.imageMessage && content.imageMessage.viewOnce !== true) {
    media = content.imageMessage;
  } else if (content?.documentMessage) {
    const type = typeof content.documentMessage.mimetype === 'string'
      ? content.documentMessage.mimetype.toLowerCase() : '';
    if (!IMAGE_MEDIA_TYPES.has(type)) return null;
    media = content.documentMessage;
    name = typeof media.fileName === 'string' ? media.fileName : undefined;
  }
  if (!media) return null;
  const mediaType = typeof media.mimetype === 'string' ? media.mimetype.toLowerCase() : '';
  if (!IMAGE_MEDIA_TYPES.has(mediaType)) return null;
  return {
    name,
    mediaType,
    size: mediaSize(media.fileLength),
    load: (options) => downloadWhatsappImage(message, download, options),
  };
}

function whatsappFileSource(message, content, download) {
  const media = content?.documentMessage;
  if (!media) return null;
  const mediaType = typeof media.mimetype === 'string' && media.mimetype
    ? media.mimetype.toLowerCase() : undefined;
  if (IMAGE_MEDIA_TYPES.has(mediaType)) return null;
  return {
    name: typeof media.fileName === 'string' && media.fileName
      ? media.fileName : 'whatsapp-file',
    ...(mediaType ? { mediaType } : {}),
    size: mediaSize(media.fileLength),
    async load({ signal } = {}) {
      signal?.throwIfAborted();
      const stream = await download(message, 'stream', { options: { signal } });
      signal?.throwIfAborted();
      return { stream };
    },
  };
}

export function createWhatsappMediaDownloader({
  socket,
  logger = console,
  download = downloadMediaMessage,
} = {}) {
  if (typeof download !== 'function') throw new TypeError('WhatsApp media downloader is required');
  if (typeof socket?.updateMediaMessage !== 'function') return download;
  return (message, type, options) => download(message, type, options, {
    logger,
    reuploadRequest: (candidate) => socket.updateMediaMessage(candidate),
  });
}

function whatsappAccountMatcher(accountJid, aliases) {
  // PN and LID are separate identities unless the linked account supplies both.
  const accountJids = new Set(
    [accountJid, ...(Array.isArray(aliases) ? aliases : [])]
      .map((jid) => normalizeWhatsappAccountJid(jidNormalizedUser(jid)))
      .filter(Boolean),
  );
  return (jid) => {
    const normalized = normalizeWhatsappAccountJid(jidNormalizedUser(jid));
    return normalized !== null && accountJids.has(normalized);
  };
}

export function normalizeWhatsappMessage(message, accountJid, {
  download = downloadMediaMessage,
  accountAliases = [],
  isBotMessage = () => false,
} = {}) {
  const remoteJid = typeof message?.key?.remoteJid === 'string' ? message.key.remoteJid : '';
  const alternateRemoteJid = typeof message?.key?.remoteJidAlt === 'string'
    ? message.key.remoteJidAlt : '';
  const messageId = typeof message?.key?.id === 'string' ? message.key.id : '';
  if (!remoteJid || !messageId || remoteJid === 'status@broadcast'
    || remoteJid.endsWith('@newsletter')) return null;
  const group = remoteJid.endsWith('@g.us');
  const fromMe = message.key.fromMe === true;
  const matchesAccount = whatsappAccountMatcher(accountJid, accountAliases);
  const selfChat = fromMe && !group
    && [remoteJid, alternateRemoteJid].some(matchesAccount);
  if (fromMe && !selfChat && !group) return null;
  const senderJid = fromMe ? accountJid : group ? message.key.participant : remoteJid;
  const senderAlternateJid = group && !fromMe ? message.key.participantAlt : alternateRemoteJid;
  if (typeof senderJid !== 'string' || !senderJid) return null;
  const viewOnce = hasViewOnceWrapper(message.message);
  const content = normalizeMessageContent(message.message);
  const context = messageContext(content);
  const mentioned = Array.isArray(context?.mentionedJid)
    && context.mentionedJid.some(matchesAccount);
  // The linked account also sends human messages. Only a known bot message
  // in this chat counts as a reply trigger, not every reply to the account.
  const replyToBot = typeof context?.participant === 'string'
    && matchesAccount(context.participant)
    && isBotMessage(remoteJid, context.stanzaId) === true;
  const image = whatsappImageSource(message, content, download, { viewOnce });
  const file = whatsappFileSource(message, content, download);
  const replyTo = whatsappReplyReference(context);
  return {
    messageId: `${remoteJid}:${messageId}`,
    providerMessageId: messageId,
    senderId: senderJid,
    contextSource: () => ({ senderName: message.pushName }),
    senderAlternateId: typeof senderAlternateJid === 'string' ? senderAlternateJid : '',
    senderIsBot: false,
    kind: group ? 'group' : 'direct',
    conversationId: remoteJid,
    content: messageText(content),
    plainText: typeof content?.conversation === 'string'
      || typeof content?.extendedTextMessage?.text === 'string',
    images: image ? [image] : [],
    files: file ? [file] : [],
    ...(replyTo ? { replyTo } : {}),
    addressed: !group || mentioned || replyToBot,
    selfChat,
    replyTarget: { jid: remoteJid, quoted: message, selfChat },
    reactionTarget: { jid: remoteJid, key: message.key },
  };
}

export function whatsappInboundAllowed(message, {
  accessMode = WHATSAPP_ACCESS_MODES.selfOnly,
  allowedNumbers = new Set(),
} = {}) {
  if (accessMode === WHATSAPP_ACCESS_MODES.open) return true;
  if (message?.kind !== 'direct') return false;
  if (message.selfChat === true) return true;
  if (accessMode !== WHATSAPP_ACCESS_MODES.privateAllowlist
    || !(allowedNumbers instanceof Set)) return false;
  const senderJids = [message.senderId, message.senderAlternateId]
    .filter((jid) => typeof jid === 'string' && jid.endsWith('@s.whatsapp.net'));
  return [...allowedNumbers].some((number) => senderJids.some((jid) => (
    areJidsSameUser(jid, `${number}@s.whatsapp.net`)
  )));
}

class RecentWhatsappOutboundIds {
  #ids = new Map();

  has(id) {
    this.#purge();
    return this.#ids.has(id);
  }

  remember(id) {
    this.#store(id);
  }

  reserve(id) {
    this.#store(id);
  }

  #store(id) {
    if (typeof id !== 'string' || !id) return;
    this.#purge();
    this.#ids.set(id, Date.now() + 5 * 60_000);
    while (this.#ids.size > 256) this.#ids.delete(this.#ids.keys().next().value);
  }

  #purge() {
    const now = Date.now();
    for (const [id, expiresAt] of this.#ids) {
      if (expiresAt > now) continue;
      this.#ids.delete(id);
    }
  }
}

function abortReason(signal) {
  return signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError');
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

function uncertainArtifactDelivery(error) {
  if (error?.code === 'artifact-delivery-uncertain') return error;
  const uncertain = new Error('WhatsApp could not confirm artifact delivery.');
  uncertain.code = 'artifact-delivery-uncertain';
  uncertain.cause = error;
  return uncertain;
}

function whatsappArtifactError(error) {
  if (error?.code?.startsWith?.('artifact-')) return error;
  const status = error?.output?.statusCode
    ?? error?.data?.statusCode
    ?? error?.statusCode;
  let code;
  if (status === 401 || status === 403) code = 'artifact-permission-required';
  else if (status === 413) code = 'artifact-too-large';
  else if (status === 429) code = 'artifact-rate-limited';
  else if ([400, 404, 405, 406, 410, 415, 422].includes(status)) {
    code = 'artifact-provider-rejected';
  }
  if (!code) return uncertainArtifactDelivery(error);
  const wrapped = new Error('WhatsApp rejected artifact delivery.');
  wrapped.code = code;
  wrapped.cause = error;
  return wrapped;
}

export class WhatsappBotClient {
  #socket;
  #outboundIds;
  #rememberBotMessage;
  #signal;
  #abortController = new AbortController();
  #mediaUploadTimeoutMs;
  #logger;
  #typingTimers = new Map();
  #streams = new Set();

  constructor(socket, outboundIds, {
    signal,
    mediaUploadTimeoutMs = WHATSAPP_MEDIA_UPLOAD_TIMEOUT_MS,
    logger = console,
    rememberBotMessage = async () => {},
  } = {}) {
    this.#socket = socket;
    this.#outboundIds = outboundIds;
    this.#rememberBotMessage = rememberBotMessage;
    this.#signal = signal
      ? AbortSignal.any([signal, this.#abortController.signal])
      : this.#abortController.signal;
    this.#mediaUploadTimeoutMs = mediaUploadTimeoutMs;
    this.#logger = logger;
  }

  async sendText(target, text) {
    await this.#stopTyping(target.jid);
    const providerMessageIds = [];
    for (const [index, chunk] of splitMessageText(text, WHATSAPP_TEXT_LIMIT).entries()) {
      const result = await this.#sendTextMessage(target, chunk, { quote: index === 0 });
      providerMessageIds.push(result.key.id);
    }
    return { providerMessageIds };
  }

  async sendDelivery(target, value) {
    const block = createTextDeliveryBlock(value);
    if (block.format === 'plain') return this.sendText(target, block.text);
    let chunks;
    try {
      chunks = chunkMarkdownText(markdownToWhatsapp(block.text), WHATSAPP_TEXT_LIMIT);
    } catch {
      this.#logger.warn?.('[dsh-im:whatsapp] Markdown could not be prepared; sending plain text');
      return this.sendText(target, block.text);
    }
    await this.#stopTyping(target.jid);
    const providerMessageIds = [];
    for (const [index, chunk] of chunks.entries()) {
      const result = await this.#sendTextMessage(target, chunk, { quote: index === 0 });
      providerMessageIds.push(result.key.id);
    }
    return { providerMessageIds };
  }

  async #sendTextMessage(target, text, { edit, quote = true } = {}) {
    this.#signal?.throwIfAborted();
    const messageId = randomBytes(10).toString('hex').toUpperCase();
    // Reserve both the outgoing envelope and the edited message before dispatch:
    // linked-account group and self-chat echoes can arrive before send settles.
    const reserve = (id) => {
      if (typeof this.#outboundIds.reserve === 'function') this.#outboundIds.reserve(id);
      else this.#outboundIds.remember(id);
    };
    reserve(messageId);
    if (edit) reserve(edit.id);
    const pending = this.#socket.sendMessage(
      target.jid,
      { text, ...(edit ? { edit } : {}) },
      { ...(quote && !edit && target.quoted ? { quoted: target.quoted } : {}), messageId },
    );
    const result = await waitWithSignal(pending, this.#signal);
    this.#outboundIds.remember(result?.key?.id);
    await this.#rememberBotMessage(target.jid, edit?.id ?? result?.key?.id ?? messageId);
    return {
      ...result,
      key: { remoteJid: target.jid, fromMe: true, id: messageId, ...result?.key },
    };
  }

  async openStream(target) {
    let messageKey;
    const stream = createEditableMessageStream({
      limit: WHATSAPP_TEXT_LIMIT,
      updateIntervalMs: 1_000,
      create: async (text) => {
        const message = await this.#sendTextMessage(target, text);
        messageKey = message.key;
        return messageKey.id;
      },
      // Baileys edits need the original full message key, not an edit envelope id.
      edit: async (_messageId, text) => this.#sendTextMessage(target, text, { edit: messageKey }),
      sendRemainder: (text) => this.#sendTextMessage(target, text, { quote: false }),
      messageIdForResult: (message) => message?.key?.id,
      logger: this.#logger,
    });
    const finish = stream.finish.bind(stream);
    const cancel = stream.cancel.bind(stream);
    stream.finish = async (text) => {
      try {
        return await finish(text);
      } finally {
        this.#streams.delete(stream);
        await this.#stopTyping(target.jid);
      }
    };
    stream.cancel = () => {
      cancel();
      this.#streams.delete(stream);
      return this.#stopTyping(target.jid);
    };
    await stream.start();
    this.#signal.throwIfAborted();
    this.#streams.add(stream);
    return stream;
  }

  async sendFile(target, file) {
    return this.#sendArtifact(target, file, {
      document: file.bytes,
      mimetype: file.mediaType ?? 'application/octet-stream',
      fileName: file.fileName,
    }, 'file');
  }

  async sendImage(target, file) {
    return this.#sendArtifact(target, file, {
      image: file.bytes,
      mimetype: file.mediaType ?? 'image/jpeg',
    }, 'image');
  }

  async addReaction(target, emoji, { signal } = {}) {
    if (typeof emoji !== 'string' || !emoji.trim()) {
      throw new TypeError('A WhatsApp reaction emoji is required');
    }
    const reactionKey = emoji.trim();
    await this.#sendReaction(target, reactionKey, signal);
    return reactionKey;
  }

  removeReaction(target, _reactionKey, { signal } = {}) {
    return this.#sendReaction(target, '', signal);
  }

  async #sendReaction(target, text, signal) {
    if (typeof target?.jid !== 'string' || !target.jid || !target.key?.id) {
      throw new TypeError('A WhatsApp reaction target is required');
    }
    const operationSignal = signal ?? this.#signal;
    operationSignal?.throwIfAborted();
    const messageId = randomBytes(10).toString('hex').toUpperCase();
    if (typeof this.#outboundIds.reserve === 'function') {
      this.#outboundIds.reserve(messageId);
    } else {
      this.#outboundIds.remember(messageId);
    }
    const pending = this.#socket.sendMessage(
      target.jid,
      { react: { text, key: target.key } },
      { messageId },
    );
    const result = await waitWithSignal(pending, operationSignal);
    this.#outboundIds.remember(result?.key?.id);
    return result;
  }

  async #sendArtifact(target, file, content, presentation) {
    this.#signal?.throwIfAborted();
    await this.#stopTyping(target.jid);
    this.#signal?.throwIfAborted();
    const deliverySeed = typeof file.deliveryKey === 'string' && file.deliveryKey
      ? file.deliveryKey
      : file.artifactId;
    const messageIdSeed = presentation === 'image'
      ? `${deliverySeed}:image`
      : deliverySeed;
    const messageId = typeof messageIdSeed === 'string' && messageIdSeed
      ? createHash('sha256').update(messageIdSeed).digest('hex').slice(0, 20).toUpperCase()
      : undefined;
    const options = {
      ...(target.quoted ? { quoted: target.quoted } : {}),
      ...(messageId ? { messageId } : {}),
      mediaUploadTimeoutMs: this.#mediaUploadTimeoutMs,
    };
    // Baileys can emit a self-chat echo before sendMessage settles. Reserve the
    // deterministic id before dispatch so that echo cannot re-enter the bridge.
    this.#outboundIds.remember(messageId);
    let result;
    try {
      const pending = this.#socket.sendMessage(
        target.jid,
        content,
        options,
      );
      trackOutboundArtifactProviderPromise(file, pending);
      const timeout = AbortSignal.timeout(this.#mediaUploadTimeoutMs);
      const waitSignal = this.#signal
        ? AbortSignal.any([this.#signal, timeout])
        : timeout;
      result = await waitWithSignal(pending, waitSignal);
    } catch (error) {
      if (this.#signal?.aborted) throw abortReason(this.#signal);
      throw whatsappArtifactError(error);
    }
    this.#signal?.throwIfAborted();
    this.#outboundIds.remember(result?.key?.id);
    await this.#rememberBotMessage(target.jid, result?.key?.id ?? messageId);
    return result;
  }

  async sendTyping(target) {
    if (!target.selfChat && target.quoted?.key) {
      await this.#socket.readMessages([target.quoted.key]).catch(() => undefined);
    }
    await this.#socket.sendPresenceUpdate('composing', target.jid);
    await this.#stopTyping(target.jid, false);
    const timer = setInterval(() => {
      void this.#socket.sendPresenceUpdate('composing', target.jid).catch(() => {
        void this.#stopTyping(target.jid);
      });
    }, 20_000);
    timer.unref?.();
    this.#typingTimers.set(target.jid, timer);
  }

  async close() {
    this.#abortController.abort();
    const stoppingStreams = [...this.#streams].map((stream) => stream.cancel());
    const jids = [...this.#typingTimers.keys()];
    await Promise.allSettled([...stoppingStreams, ...jids.map((jid) => this.#stopTyping(jid))]);
  }

  async #stopTyping(jid, sendPaused = true) {
    const timer = this.#typingTimers.get(jid);
    if (timer) clearInterval(timer);
    this.#typingTimers.delete(jid);
    if (sendPaused) await this.#socket.sendPresenceUpdate('paused', jid).catch(() => undefined);
  }
}

export function createWhatsappRuntimeStatus() {
  return {
    startedAt: null,
    ready: false,
    connectionState: 'idle',
    harnessReachable: false,
    lastCheckedAt: null,
    lastConnectedAt: null,
    lastError: null,
    ...createWhatsappBridgeStatus(),
  };
}

export class WhatsappRuntime {
  #config;
  #authDir;
  #harness;
  #state;
  #contextEnhancement;
  #groupHistory;
  #accessPolicy;
  #logger;
  #diagnostics;
  #replyTimeoutMs;
  #connectTimeoutMs;
  #mediaUploadTimeoutMs;
  #createSession;
  #status = createWhatsappRuntimeStatus();
  #abortController = null;
  #session = null;
  #client = null;
  #bridge = null;
  #starting = null;

  constructor({
    config,
    authDir,
    harness,
    state,
    contextEnhancement,
    groupHistory,
    accessPolicy,
    logger = console,
    replyTimeoutMs = 600_000,
    connectTimeoutMs = 30_000,
    mediaUploadTimeoutMs = WHATSAPP_MEDIA_UPLOAD_TIMEOUT_MS,
    createSession = createWhatsappWebSession,
  }) {
    if (!config || !authDir || !harness || !state || typeof createSession !== 'function') {
      throw new TypeError('WhatsappRuntime requires config, auth directory, Harness, state, and session factory');
    }
    this.#config = config;
    this.#authDir = authDir;
    this.#harness = harness;
    this.#state = state;
    this.#contextEnhancement = contextEnhancement;
    this.#groupHistory = groupHistory;
    this.#accessPolicy = accessPolicy;
    this.#logger = logger; this.#diagnostics = createConnectionDiagnostics({ channel: 'whatsapp', logger });
    this.#replyTimeoutMs = replyTimeoutMs;
    this.#connectTimeoutMs = connectTimeoutMs;
    if (!Number.isSafeInteger(mediaUploadTimeoutMs) || mediaUploadTimeoutMs <= 0) {
      throw new TypeError('mediaUploadTimeoutMs must be a positive safe integer');
    }
    this.#mediaUploadTimeoutMs = Math.min(
      mediaUploadTimeoutMs,
      WHATSAPP_MEDIA_UPLOAD_TIMEOUT_MS,
    );
    this.#createSession = createSession;
  }

  get status() {
    return structuredClone(this.#status);
  }

  async start() {
    if (this.#status.ready && this.#session) return this.status;
    if (this.#starting) return this.#starting;
    this.#starting = this.#start().finally(() => { this.#starting = null; });
    return this.#starting;
  }

  async #start() {
    await this.stop();
    this.#status.startedAt = new Date().toISOString();
    this.#status.connectionState = 'connecting';
    this.#status.lastError = null; this.#status.error = null; this.#diagnostics.clear();
    await atConnectionStage('harness.check', () => this.#harness.ensureRunning());
    this.#status.harnessReachable = true;
    const controller = new AbortController();
    this.#abortController = controller;
    const outboundIds = new RecentWhatsappOutboundIds();
    let rejectRelink;
    const relinkRequired = new Promise((_, reject) => { rejectRelink = reject; });
    void relinkRequired.catch(() => undefined);
    try {
      const session = await this.#createSession({
        authDir: this.#authDir,
        signal: controller.signal,
        logger: this.#logger,
        onQr: () => rejectRelink(Object.assign(
          new Error('WhatsApp linked-device session must be scanned again'),
          { code: 'relink-required' },
        )),
        onMessage: async (raw, context) => {
          const linkedAccount = context?.socket?.user;
          const message = normalizeWhatsappMessage(raw, this.#config.accountJid, {
            isBotMessage: (jid, id) => this.#state.isBotMessage?.(jid, id) === true,
            accountAliases: [
              linkedAccount?.id,
              linkedAccount?.lid,
              linkedAccount?.phoneNumber,
            ],
            download: createWhatsappMediaDownloader({
              socket: context?.socket,
              logger: this.#logger,
            }),
          });
          if (!message || outboundIds.has(message.providerMessageId) || !this.#bridge) return;
          let groupName;
          if (this.#groupHistory && message.kind === 'group' && message.addressed) {
            let timeout;
            try {
              groupName = (await Promise.race([
                context?.socket?.groupMetadata?.(message.conversationId),
                new Promise((resolve) => { timeout = setTimeout(resolve, 2500); timeout.unref?.(); }),
              ]))?.subject;
            } catch { /* optional metadata must not block normal replies */ }
            finally { clearTimeout(timeout); }
          }
          if (!hasViewOnceWrapper(raw.message)) {
            await captureGroupHistory(this.#groupHistory, message, groupHistoryEntry('whatsapp', raw, message, { groupName }), {
              logger: this.#logger,
            });
          }
          this.#status.lastCheckedAt = Date.now();
          await this.#bridge.accept(message);
        },
        onDisconnect: ({ error }) => {
          if (controller.signal.aborted) return;
          this.#status.ready = false;
          this.#status.connectionState = 'failed';
          this.#status.error = this.#diagnostics.report(error, { operation: 'connection.monitor', botId: this.#config?.botId, automatic: true }).publicError;
          this.#status.lastError = this.#status.error.message;
        },
      });
      this.#session = session;
      let timer;
      const identity = await Promise.race([
        session.ready,
        relinkRequired,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('WhatsApp Web did not connect in time')),
            this.#connectTimeoutMs,
          );
        }),
      ]).finally(() => clearTimeout(timer));
      if (!areJidsSameUser(identity.accountJid, this.#config.accountJid)) {
        throw new Error('WhatsApp linked account does not match the saved bot');
      }
      const client = new WhatsappBotClient(session.socket, outboundIds, {
        rememberBotMessage: async (jid, id) => {
          try {
            await this.#state.rememberBotMessage?.(jid, id);
          } catch (error) {
            // Delivery already succeeded; a bookkeeping failure must not turn
            // it into a failed send that can be retried and duplicated.
            this.#logger.warn?.('[dsh-im:whatsapp] failed to persist bot message identity:', error);
          }
        },
        signal: controller.signal,
        mediaUploadTimeoutMs: this.#mediaUploadTimeoutMs,
        logger: this.#logger,
      });
      this.#client = client;
      this.#bridge = new WhatsappHarnessBridge({
        bot: client,
        harness: this.#harness,
        state: this.#state,
        contextEnhancement: this.#contextEnhancement,
        accessPolicy: this.#accessPolicy ? {
          botId: this.#accessPolicy.botId,
          getSettings: (...args) => this.#accessPolicy.getSettings(...args),
          ...(typeof this.#accessPolicy.isPrivileged === 'function' ? {
            isPrivileged: (...args) => this.#accessPolicy.isPrivileged(...args),
          } : {}),
          equals: whatsappAccessPolicyIdsEqual,
        } : undefined,
        status: this.#status,
        logger: this.#logger,
        replyTimeoutMs: this.#replyTimeoutMs,
        signal: controller.signal,
      });
      const now = Date.now();
      this.#status.ready = true;
      this.#status.connectionState = 'connected';
      this.#status.lastCheckedAt = now;
      this.#status.lastConnectedAt = now;
      return this.status;
    } catch (error) {
      this.#status.ready = false;
      this.#status.connectionState = 'failed';
      this.#status.error = this.#diagnostics.report(error, { operation: 'connection.monitor', botId: this.#config?.botId, automatic: true }).publicError;
      this.#status.lastError = this.#status.error.message;
      await this.stop();
      throw error;
    }
  }

  async logout() {
    await this.#session?.logout().catch(() => undefined);
    return this.stop();
  }

  async sendConnectionTest(text) {
    if (!this.#status.ready || !this.#client) {
      const error = new Error(t('WhatsApp机器人尚未连接'));
      error.code = 'test-target-unavailable';
      throw error;
    }
    if (typeof text !== 'string' || !text.trim()) {
      throw new TypeError('WhatsApp connection test text is required');
    }
    await this.#client.sendText({
      jid: this.#config.accountJid,
      selfChat: true,
    }, text);
    return { sent: true };
  }

  async presentSessionSyncApproval(target, interaction, options = {}) {
    if (!this.#status.ready || !this.#bridge) return false;
    const actor = typeof target?.route?.jid === 'string' ? target.route.jid.trim() : '';
    if (!actor) return false;
    return this.#bridge.presentSessionSyncApproval(interaction, {
      key: options.key, actor, validate: options.validate,
      send: (text) => this.sendProactiveText(target, text),
    }, options);
  }

  async sendProactiveText(target, text, { signal, format = 'plain' } = {}) {
    const jid = typeof target?.route?.jid === 'string' ? target.route.jid.trim() : '';
    const validUser = target?.kind === 'user'
      && /^[^@\s]+@(s\.whatsapp\.net|lid)$/.test(jid);
    const validGroup = target?.kind === 'group' && /^[^@\s]+@g\.us$/.test(jid);
    if (!validUser && !validGroup) {
      const error = new TypeError('Invalid WhatsApp proactive delivery target');
      error.code = 'invalid-target';
      throw error;
    }
    if (!this.#status.ready || !this.#client) {
      const error = new Error(t('WhatsApp机器人尚未连接'));
      error.code = 'bot-not-connected';
      throw error;
    }
    signal?.throwIfAborted();
    if (format === 'markdown') {
      return this.#client.sendDelivery({ jid }, createTextDeliveryBlock(text, format));
    }
    return this.#client.sendText({ jid }, text);
  }

  async stop() {
    const session = this.#session;
    const client = this.#client;
    const bridge = this.#bridge;
    this.#abortController?.abort();
    this.#abortController = null;
    this.#session = null;
    this.#client = null;
    this.#bridge = null;
    await client?.close().catch(() => undefined);
    await session?.close().catch(() => undefined);
    await Promise.race([
      bridge?.waitForIdle() ?? Promise.resolve(),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
    this.#status.ready = false;
    this.#status.connectionState = 'idle';
    return this.status;
  }
}
