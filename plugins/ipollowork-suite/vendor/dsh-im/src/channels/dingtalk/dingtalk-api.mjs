import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';

import { fetchImageBuffer, ImagePromptError } from '../shared/image-prompt.mjs';
import { t } from '../shared/i18n.mjs';
import { chunkMarkdownParts } from '../shared/markdown-chunks.mjs';
import { DINGTALK_MENU_TEMPLATE_ID, dingtalkMenuCardData } from './dingtalk-menu.mjs';

export const DINGTALK_REGISTRATION_BASE_URL = 'https://oapi.dingtalk.com/';
export const DINGTALK_API_BASE_URL = 'https://api.dingtalk.com/';
export const DINGTALK_REGISTRATION_SOURCE = 'DING_DWS_CLAW';
export const DINGTALK_AI_CARD_TEMPLATE_ID = '02fcf2f4-5e02-4a85-b672-46d1f715543e.schema';
export const DINGTALK_THINKING_REACTION_NAME = '🤔思考中';
export const DINGTALK_DONE_REACTION_NAME = '✅已完成';
export const DINGTALK_ERROR_REACTION_NAME = '❌处理失败';

const DEFAULT_TIMEOUT_MS = 15_000;
const REACTION_TIMEOUT_MS = 5_000;
const TEXT_REACTION_ID = '2659900';
const TEXT_REACTION_BACKGROUND_ID = 'im_bg_1';
const REGISTRATION_STATUSES = new Set(['WAITING', 'SUCCESS', 'FAIL', 'EXPIRED']);

export class DingtalkApiError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'DingtalkApiError';
    this.code = code;
    this.status = options.status;
    this.providerCode = options.providerCode;
  }
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeProviderCode(value) {
  const code = value === undefined || value === null ? null : String(value).trim();
  return code && /^-?[A-Za-z0-9_.:-]{1,160}$/.test(code) ? code : undefined;
}

function preserveArtifactMetadata(target, source) {
  if (Number.isInteger(source?.status)) target.status = source.status;
  if (source?.providerCode !== undefined) target.providerCode = source.providerCode;
  return target;
}

function dingtalkArtifactError(cause, { fallback = 'artifact-provider-rejected' } = {}) {
  if (cause?.code?.startsWith?.('artifact-')) return cause;
  const status = Number(cause?.status);
  const providerCode = safeProviderCode(cause?.providerCode);
  const providerText = providerCode ?? '';
  let code = fallback;
  let message = 'DingTalk could not prepare the file for delivery.';
  if (status === 401 || status === 403 || providerCode === '401' || providerCode === '403'
    || /(?:permission|forbidden|unauthor|access.?denied|\.auth(?:\.|$))/i.test(providerText)) {
    code = 'artifact-permission-required';
    message = 'DingTalk denied permission to send the file.';
  } else if (status === 413 || providerCode === '413'
    || /(?:too.?large|size.?limit)/i.test(providerText)) {
    code = 'artifact-too-large';
    message = 'The file exceeds DingTalk\'s size limit.';
  } else if (status === 429 || providerCode === '429'
    || /(?:rate.?limit|too.?many|throttl)/i.test(providerText)) {
    code = 'artifact-rate-limited';
    message = 'DingTalk rate-limited file delivery.';
  } else if (fallback === 'artifact-provider-rejected') {
    message = 'DingTalk rejected the file message.';
  }
  const error = new Error(message, { cause });
  error.code = code;
  return preserveArtifactMetadata(error, cause);
}

function uncertainDingtalkDelivery(cause) {
  const error = new Error('DingTalk file delivery result is uncertain', { cause });
  error.code = 'artifact-delivery-uncertain';
  return preserveArtifactMetadata(error, cause);
}

function rejectedProviderResponse(value) {
  if (!value || typeof value !== 'object') return null;
  for (const field of ['errcode', 'code']) {
    if (value[field] !== undefined && value[field] !== 0 && value[field] !== '0') {
      return safeProviderCode(value[field]) ?? 'rejected';
    }
  }
  return null;
}

function classifyDingtalkFinalDeliveryError(error, signal) {
  if (signal?.aborted) throw abortError(signal);
  const status = Number(error?.status);
  if (error?.code === 'network-error' || error?.code === 'timeout'
    || error?.code === 'invalid-response' || (status >= 500 && status < 600)) {
    return uncertainDingtalkDelivery(error);
  }
  return dingtalkArtifactError(error);
}

function secureDingtalkDownloadUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new DingtalkApiError('invalid-image-download', '钉钉服务返回了无效的图片下载地址。', { cause: error });
  }
  if (url.protocol === 'http:' && (!url.port || url.port === '80')) {
    url.protocol = 'https:';
    url.port = '';
  }
  return url;
}

function isDingtalkHost(hostname) {
  const normalized = hostname.toLowerCase().replace(/\.$/, '');
  return normalized === 'dingtalk.com' || normalized.endsWith('.dingtalk.com');
}

function normalizeTrustedUrl(value, { label, requireSubdomain = true } = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new DingtalkApiError('invalid-url', `${label ?? '钉钉服务'}返回了无效地址。`);
  }
  const normalizedHost = url.hostname.toLowerCase().replace(/\.$/, '');
  const trustedHost = requireSubdomain
    ? normalizedHost !== 'dingtalk.com' && isDingtalkHost(normalizedHost)
    : isDingtalkHost(normalizedHost);
  if (url.protocol !== 'https:' || !trustedHost || (url.port && url.port !== '443')) {
    throw new DingtalkApiError('untrusted-url', `${label ?? '钉钉服务'}地址不受信任。`);
  }
  if (url.username || url.password) {
    throw new DingtalkApiError('untrusted-url', `${label ?? '钉钉服务'}地址不受信任。`);
  }
  return url;
}

export function normalizeDingtalkSessionWebhook(value) {
  const text = nonEmptyString(value);
  if (!text) throw new DingtalkApiError('invalid-session-webhook', '钉钉消息没有可用的回复地址。');
  const url = normalizeTrustedUrl(text, { label: '钉钉回复', requireSubdomain: false });
  url.hash = '';
  return url.toString();
}

export function splitDingtalkText(value, maxChars = 4_000) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return [];
  if (!Number.isInteger(maxChars) || maxChars < 1) throw new TypeError('maxChars must be a positive integer');
  if (text.length <= maxChars) return [text];

  const chunks = [];
  let remaining = text;
  while (remaining.length > maxChars) {
    let splitAt = remaining.lastIndexOf('\n', maxChars);
    if (splitAt < Math.floor(maxChars * 0.6)) splitAt = maxChars;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n+/, '');
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function abortError(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  return new DOMException('The operation was aborted', 'AbortError');
}

function abortableDelay(ms, signal) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function requestJson(fetchImpl, url, {
  body,
  signal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  headers = {},
  method = 'POST',
  action = 'request',
} = {}) {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) throw abortError(signal);
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = timeoutMs > 0 ? setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs) : null;

  try {
    const response = await fetchImpl(url, {
      method,
      redirect: 'error',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });
    if (!response.ok) {
      let providerCode;
      try {
        const errorBody = await response.json();
        providerCode = safeProviderCode(errorBody?.code ?? errorBody?.errcode);
      } catch {
        // DingTalk occasionally returns an empty or non-JSON error body.
      }
      throw new DingtalkApiError(
        'http-error',
        `钉钉服务请求失败（HTTP ${response.status}）。`,
        { status: response.status, providerCode },
      );
    }
    try {
      return await response.json();
    } catch (error) {
      throw new DingtalkApiError('invalid-response', '钉钉服务返回了无法解析的响应。', { cause: error });
    }
  } catch (error) {
    if (signal?.aborted) throw abortError(signal);
    if (timedOut) throw new DingtalkApiError('timeout', '钉钉服务请求超时。', { cause: error });
    if (error instanceof DingtalkApiError) throw error;
    throw new DingtalkApiError('network-error', `暂时无法完成钉钉${action}请求。`, { cause: error });
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

async function requestMultipart(fetchImpl, url, { body, signal, timeoutMs = 60_000 } = {}) {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) throw abortError(signal);
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      body,
      signal: controller.signal,
      redirect: 'error',
    });
    let value;
    let parseError;
    try {
      value = await response.json();
    } catch (error) {
      parseError = error;
    }
    if (!response.ok) {
      throw new DingtalkApiError(
        'http-error',
        `钉钉服务请求失败（HTTP ${response.status}）。`,
        { status: response.status, providerCode: safeProviderCode(value?.code ?? value?.errcode) },
      );
    }
    if (parseError) {
      throw new DingtalkApiError(
        'invalid-response',
        '钉钉服务返回了无法解析的响应。',
        { cause: parseError },
      );
    }
    return value;
  } catch (error) {
    if (signal?.aborted) throw abortError(signal);
    if (timedOut) throw new DingtalkApiError('timeout', '钉钉服务请求超时。', { cause: error });
    if (error instanceof DingtalkApiError) throw error;
    throw new DingtalkApiError('network-error', '暂时无法完成钉钉文件上传请求。', { cause: error });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function normalizeFileTarget(target) {
  const robotCode = nonEmptyString(target?.robotCode);
  if (!robotCode) throw new TypeError('DingTalk robotCode is required');
  if (target?.type === 'group') {
    const openConversationId = nonEmptyString(target.openConversationId);
    if (openConversationId) return { type: 'group', robotCode, openConversationId };
  }
  if (target?.type === 'user') {
    const userId = nonEmptyString(target.userId);
    if (userId) return { type: 'user', robotCode, userId };
  }
  throw new TypeError('DingTalk file target is invalid');
}

function dingtalkFileType(fileName) {
  return extname(fileName).slice(1).toLowerCase();
}

function normalizeCardTarget(target) {
  if (target?.type === 'user') {
    const userId = nonEmptyString(target.userId);
    if (userId) return { type: 'user', userId };
  }
  if (target?.type === 'group') {
    const openConversationId = nonEmptyString(target.openConversationId);
    if (openConversationId) {
      return { type: 'group', openConversationId, atUserIds: target.atUserIds };
    }
  }
  throw new TypeError('DingTalk AI Card target is invalid');
}

function cardMarkdown(text, target) {
  const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
  const mentions = target?.type === 'group'
    ? Object.entries(target.atUserIds ?? {}).map(([userId, name]) => (
        `<a atId="${escape(userId)}">${escape(name)}</a>`
      )).join(' ')
    : '';
  return normalizeDingtalkCardMarkdown(mentions ? `${mentions}\n\n${text}` : text);
}

function cardData(text, flowStatus, target) {
  const markdown = cardMarkdown(text, target);
  // The shared template uses msgContent for processing, finished, and
  // failed cards. Switching its order to staticMsgContent hides the reply.
  return {
    cardParamMap: {
      flowStatus,
      msgContent: markdown,
      staticMsgContent: '',
      sys_full_json_obj: JSON.stringify({ order: ['msgContent'] }),
      config: JSON.stringify({ autoLayout: true }),
    },
  };
}

function cardDeliverBody(cardInstanceId, target, robotCode) {
  const base = { outTrackId: cardInstanceId, userIdType: 1 };
  if (target.type === 'group') {
    return {
      ...base,
      openSpaceId: `dtv1.card//IM_GROUP.${target.openConversationId}`,
      imGroupOpenDeliverModel: { robotCode, atUserIds: target.atUserIds },
    };
  }
  return {
    ...base,
    openSpaceId: `dtv1.card//IM_ROBOT.${target.userId}`,
    imRobotOpenDeliverModel: {
      spaceType: 'IM_ROBOT',
      robotCode,
      extension: { dynamicSummary: 'true' },
    },
  };
}

export function normalizeDingtalkCardMarkdown(value) {
  const text = typeof value === 'string' ? value.replace(/\r\n?/g, '\n') : '';
  const lines = text.split('\n');
  let inCodeBlock = false;
  return lines.map((line, index) => {
    const fenced = /^\s{0,3}```/.test(line);
    const currentInCodeBlock = inCodeBlock;
    if (fenced) inCodeBlock = !inCodeBlock;
    if (index === lines.length - 1) return line;
    if (currentInCodeBlock || fenced || inCodeBlock || !line || !lines[index + 1]) return `${line}\n`;
    if (/^\s{0,3}(?:[-*+] |\d+[.)] |#{1,6} |\||> )/.test(lines[index + 1])) return `${line}\n`;
    return `${line}<br>`;
  }).join('');
}

function assertRegistrationOk(value, action) {
  if (!value || typeof value !== 'object' || value.errcode !== 0) {
    throw new DingtalkApiError(
      'registration-rejected',
      `钉钉扫码${action}失败。`,
    );
  }
  return value;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function createDingtalkApi({
  logger = console,
  fetchImpl = fetch,
  registrationBaseUrl = process.env.DINGTALK_REGISTRATION_BASE_URL
    || DINGTALK_REGISTRATION_BASE_URL,
  registrationSource = process.env.DINGTALK_REGISTRATION_SOURCE
    || DINGTALK_REGISTRATION_SOURCE,
  now = () => Date.now(),
  cardMinIntervalMs = 50,
  cardBackoffMs = 1_000,
  delay = abortableDelay,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  if (!Number.isFinite(cardMinIntervalMs) || cardMinIntervalMs < 0) {
    throw new TypeError('cardMinIntervalMs must be a non-negative number');
  }
  if (!Number.isFinite(cardBackoffMs) || cardBackoffMs < 0) {
    throw new TypeError('cardBackoffMs must be a non-negative number');
  }
  if (typeof delay !== 'function') throw new TypeError('delay must be a function');
  const registrationBase = normalizeTrustedUrl(registrationBaseUrl, {
    label: '钉钉注册服务',
    requireSubdomain: false,
  });
  const apiBase = new URL(DINGTALK_API_BASE_URL);
  const source = nonEmptyString(registrationSource);
  if (!source) throw new TypeError('registrationSource is required');
  const tokenCache = new Map();
  const tokenRequests = new Map();
  const reactionTokenRequests = new Map();
  let cardSlotTail = Promise.resolve();
  let nextCardRequestAt = 0;

  const endpoint = (base, pathname) => new URL(pathname.replace(/^\//, ''), base);

  async function accessToken({ clientId, clientSecret, signal, requestKind = 'normal' }) {
    const appKey = nonEmptyString(clientId);
    const appSecret = nonEmptyString(clientSecret);
    if (!appKey || !appSecret) throw new TypeError('clientId and clientSecret are required');
    const cached = tokenCache.get(appKey);
    if (cached && cached.expiresAt > now()) return cached.token;
    const requests = requestKind === 'reaction' ? reactionTokenRequests : tokenRequests;
    if (requests.has(appKey)) return requests.get(appKey);

    const request = (async () => {
      const value = await requestJson(fetchImpl, endpoint(apiBase, 'v1.0/oauth2/accessToken'), {
        body: { appKey, appSecret },
        signal,
        action: '鉴权',
      });
      const token = nonEmptyString(value?.accessToken);
      if (!token) throw new DingtalkApiError('invalid-access-token', '钉钉服务没有返回访问令牌。');
      const expiresInSeconds = positiveNumber(value?.expireIn ?? value?.expiresIn, 7_200);
      const refreshAfterMs = Math.max(1_000, (expiresInSeconds - 60) * 1_000);
      tokenCache.set(appKey, { token, expiresAt: now() + refreshAfterMs });
      return token;
    })();
    const shared = request.finally(() => requests.delete(appKey));
    requests.set(appKey, shared);
    return shared;
  }

  async function changeReaction({
    clientId,
    clientSecret,
    robotCode,
    messageId,
    conversationId,
    reactionName = DINGTALK_THINKING_REACTION_NAME,
    signal,
  }, action) {
    const appKey = nonEmptyString(clientId);
    const appSecret = nonEmptyString(clientSecret);
    const botCode = nonEmptyString(robotCode) ?? appKey;
    const openMsgId = nonEmptyString(messageId);
    const openConversationId = nonEmptyString(conversationId);
    const emotionName = nonEmptyString(reactionName);
    if (!appKey || !appSecret) throw new TypeError('clientId and clientSecret are required');
    if (!botCode) throw new TypeError('robotCode is required');
    if (!openMsgId || !openConversationId) {
      throw new TypeError('messageId and conversationId are required');
    }
    if (!emotionName) throw new TypeError('reactionName is required');
    // Reactions deduplicate with each other but never own the normal reply's
    // in-flight token request. Both paths may still reuse a cached token.
    const token = await accessToken({
      clientId: appKey,
      clientSecret: appSecret,
      signal,
      requestKind: 'reaction',
    });
    const response = await requestJson(
      fetchImpl,
      endpoint(apiBase, `v1.0/robot/emotion/${action}`),
      {
        body: {
          robotCode: botCode,
          openMsgId,
          openConversationId,
          emotionType: 2,
          emotionName,
          textEmotion: {
            emotionId: TEXT_REACTION_ID,
            emotionName,
            text: emotionName,
            backgroundId: TEXT_REACTION_BACKGROUND_ID,
          },
        },
        headers: { 'x-acs-dingtalk-access-token': token },
        signal,
        timeoutMs: REACTION_TIMEOUT_MS,
        action: action === 'reply' ? '消息状态添加' : '消息状态撤回',
      },
    );
    const rejection = response?.success === false
      ? safeProviderCode(response?.code ?? response?.errcode) ?? 'rejected'
      : rejectedProviderResponse(response);
    if (rejection) {
      throw new DingtalkApiError(
        'reaction-rejected',
        '钉钉服务拒绝了消息状态请求。',
        { providerCode: rejection },
      );
    }
    return true;
  }

  async function messageFileDownloadUrl({
    clientId,
    clientSecret,
    robotCode,
    downloadCode,
    signal,
    kind,
  }) {
    const botCode = nonEmptyString(robotCode);
    const fileCode = nonEmptyString(downloadCode);
    if (!botCode || !fileCode) throw new TypeError('robotCode and downloadCode are required');
    const token = await accessToken({ clientId, clientSecret, signal });
    let response;
    try {
      response = await requestJson(
        fetchImpl,
        endpoint(apiBase, 'v1.0/robot/messageFiles/download'),
        {
          body: { downloadCode: fileCode, robotCode: botCode },
          headers: { 'x-acs-dingtalk-access-token': token },
          signal,
          action: `${kind === 'image' ? '图片' : '文件'}下载地址`,
        },
      );
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new DingtalkApiError(
        `${kind}-download-address-failed`,
        `钉钉${kind === 'image' ? '图片' : '文件'}下载地址获取失败。`,
        { cause: error, status: error?.status, providerCode: error?.providerCode },
      );
    }
    const downloadUrl = nonEmptyString(response?.downloadUrl ?? response?.download_url);
    if (!downloadUrl) {
      throw new DingtalkApiError(
        `invalid-${kind}-download`,
        `钉钉服务没有返回${kind === 'image' ? '图片' : '文件'}下载地址。`,
      );
    }
    return secureDingtalkDownloadUrl(downloadUrl);
  }

  function acquireCardRequestSlot(signal) {
    const acquire = async () => {
      const waitMs = Math.max(0, nextCardRequestAt - now());
      if (waitMs > 0) await delay(waitMs, signal);
      nextCardRequestAt = Math.max(nextCardRequestAt, now()) + cardMinIntervalMs;
    };
    const slot = cardSlotTail.then(acquire, acquire);
    cardSlotTail = slot.catch(() => undefined);
    return slot;
  }

  async function cardRequest(pathname, options) {
    await acquireCardRequestSlot(options.signal);
    try {
      return await requestJson(fetchImpl, endpoint(apiBase, pathname), options);
    } catch (error) {
      if (!(error instanceof DingtalkApiError) || error.status !== 403) throw error;
      await delay(cardBackoffMs, options.signal);
      await acquireCardRequestSlot(options.signal);
      return requestJson(fetchImpl, endpoint(apiBase, pathname), options);
    }
  }

  async function failCard({ clientId, clientSecret, cardInstanceId, text, target, signal }) {
    const instanceId = nonEmptyString(cardInstanceId);
    const content = nonEmptyString(text);
    if (!instanceId) throw new TypeError('cardInstanceId is required');
    if (!content) throw new TypeError('text is required');
    const token = await accessToken({ clientId, clientSecret, signal });
    const headers = { 'x-acs-dingtalk-access-token': token };
    const requests = [
      cardRequest('v1.0/card/streaming', {
        method: 'PUT',
        body: {
          outTrackId: instanceId,
          guid: randomUUID(),
          key: 'msgContent',
          content: cardMarkdown(content, target),
          isFull: true,
          isFinalize: false,
          isError: true,
        },
        headers,
        signal,
        action: 'AI Card 失败收口',
      }),
      cardRequest('v1.0/card/instances', {
        method: 'PUT',
        body: {
          outTrackId: instanceId,
          cardData: cardData(content, '5', target),
          cardUpdateOptions: { updateCardDataByKey: true },
        },
        headers,
        signal,
        action: 'AI Card 失败状态',
      }),
    ];
    const results = await Promise.allSettled(requests);
    if (results.every(({ status }) => status === 'rejected')) throw results[0].reason;
    return true;
  }

  async function sendArtifact({
    clientId,
    clientSecret,
    target,
    file,
    signal,
  }, { uploadType, messageKey, createMessageParams }) {
    if (!file || typeof file !== 'object'
      || typeof file.fileName !== 'string' || !file.fileName
      || !Buffer.isBuffer(file.bytes)) {
      throw new TypeError('A DingTalk file is required');
    }
    const normalizedTarget = normalizeFileTarget(target);
    let token;
    try {
      token = await accessToken({ clientId, clientSecret, signal });
    } catch (error) {
      if (signal?.aborted) throw abortError(signal);
      const status = Number(error?.status);
      const fallback = error?.code === 'http-error' && status >= 400 && status < 500
        ? 'artifact-provider-rejected'
        : 'artifact-provider-failed';
      throw dingtalkArtifactError(error, { fallback });
    }
    const uploadUrl = new URL('media/upload', DINGTALK_REGISTRATION_BASE_URL);
    uploadUrl.searchParams.set('access_token', token);
    uploadUrl.searchParams.set('type', uploadType);
    const form = new FormData();
    form.append(
      'media',
      new Blob([file.bytes], { type: file.mediaType ?? 'application/octet-stream' }),
      file.fileName,
    );
    let uploaded;
    try {
      uploaded = await requestMultipart(fetchImpl, uploadUrl, { body: form, signal });
    } catch (error) {
      if (signal?.aborted) throw abortError(signal);
      const status = Number(error?.status);
      const fallback = error?.code === 'http-error' && status >= 400 && status < 500
        ? 'artifact-provider-rejected'
        : 'artifact-provider-failed';
      throw dingtalkArtifactError(error, { fallback });
    }
    const uploadRejection = rejectedProviderResponse(uploaded);
    const mediaId = nonEmptyString(uploaded?.media_id);
    if (uploadRejection || !mediaId) {
      throw dingtalkArtifactError(new DingtalkApiError(
        'upload-rejected',
        '钉钉服务拒绝了文件上传。',
        { providerCode: uploadRejection ?? 'missing-media-id' },
      ));
    }
    signal?.throwIfAborted();
    const messageBody = {
      robotCode: normalizedTarget.robotCode,
      msgKey: messageKey,
      msgParam: JSON.stringify(createMessageParams(mediaId, file)),
      ...(normalizedTarget.type === 'group'
        ? { openConversationId: normalizedTarget.openConversationId }
        : { userIds: [normalizedTarget.userId] }),
    };
    const pathname = normalizedTarget.type === 'group'
      ? 'v1.0/robot/groupMessages/send'
      : 'v1.0/robot/oToMessages/batchSend';
    let response;
    try {
      response = await requestJson(fetchImpl, endpoint(apiBase, pathname), {
        body: messageBody,
        headers: { 'x-acs-dingtalk-access-token': token },
        signal,
        action: '文件消息发送',
      });
    } catch (error) {
      throw classifyDingtalkFinalDeliveryError(error, signal);
    }
    const sendRejection = rejectedProviderResponse(response);
    if (sendRejection) {
      throw dingtalkArtifactError(new DingtalkApiError(
        'send-rejected',
        '钉钉服务拒绝了文件消息。',
        { providerCode: sendRejection },
      ));
    }
    return response;
  }

  return Object.freeze({
    async beginRegistration({ signal } = {}) {
      const initialized = assertRegistrationOk(await requestJson(
        fetchImpl,
        endpoint(registrationBase, 'app/registration/init'),
        { body: { source }, signal, action: '初始化' },
      ), '初始化');
      const nonce = nonEmptyString(initialized.nonce);
      if (!nonce) throw new DingtalkApiError('invalid-registration', '钉钉扫码初始化缺少 nonce。');

      const begun = assertRegistrationOk(await requestJson(
        fetchImpl,
        endpoint(registrationBase, 'app/registration/begin'),
        { body: { nonce }, signal, action: '创建' },
      ), '创建');
      const deviceCode = nonEmptyString(begun.device_code);
      const verificationUriComplete = nonEmptyString(begun.verification_uri_complete);
      if (!deviceCode || !verificationUriComplete) {
        throw new DingtalkApiError('invalid-registration', '钉钉扫码服务返回的信息不完整。');
      }
      const verificationUrl = normalizeTrustedUrl(verificationUriComplete, {
        label: '钉钉扫码',
        requireSubdomain: false,
      }).toString();
      return {
        deviceCode,
        userCode: nonEmptyString(begun.user_code) ?? undefined,
        verificationUri: nonEmptyString(begun.verification_uri) ?? undefined,
        verificationUriComplete: verificationUrl,
        expiresInSeconds: positiveNumber(begun.expires_in, 7_200),
        intervalSeconds: positiveNumber(begun.interval, 5),
      };
    },

    async pollRegistration({ deviceCode, signal } = {}) {
      const code = nonEmptyString(deviceCode);
      if (!code) throw new TypeError('deviceCode is required');
      const polled = assertRegistrationOk(await requestJson(
        fetchImpl,
        endpoint(registrationBase, 'app/registration/poll'),
        { body: { device_code: code }, signal, action: '状态查询' },
      ), '状态查询');
      const status = nonEmptyString(polled.status)?.toUpperCase();
      if (!status || !REGISTRATION_STATUSES.has(status)) {
        throw new DingtalkApiError('invalid-registration-status', '钉钉扫码服务返回了无法识别的状态。');
      }
      const result = {
        status,
        failReason: nonEmptyString(polled.fail_reason) ?? undefined,
      };
      if (status === 'SUCCESS') {
        result.clientId = nonEmptyString(polled.client_id) ?? undefined;
        result.clientSecret = nonEmptyString(polled.client_secret) ?? undefined;
        if (!result.clientId || !result.clientSecret) {
          throw new DingtalkApiError('missing-credentials', '钉钉扫码已确认，但没有返回机器人凭据。');
        }
      }
      return result;
    },

    accessToken,

    async addReaction(request) {
      return changeReaction(request, 'reply');
    },

    async recallReaction(request) {
      return changeReaction(request, 'recall');
    },

    async addThinkingReaction(request) {
      return changeReaction({
        ...request,
        reactionName: DINGTALK_THINKING_REACTION_NAME,
      }, 'reply');
    },

    async recallThinkingReaction(request) {
      return changeReaction({
        ...request,
        reactionName: DINGTALK_THINKING_REACTION_NAME,
      }, 'recall');
    },

    async downloadImage({
      clientId,
      clientSecret,
      robotCode,
      downloadCode,
      signal,
      maxBytes,
    }) {
      const downloadUrl = await messageFileDownloadUrl({
        clientId,
        clientSecret,
        robotCode,
        downloadCode,
        signal,
        kind: 'image',
      });
      try {
        return await fetchImageBuffer(downloadUrl, {
          fetchImpl,
          signal,
          maxBytes,
        });
      } catch (error) {
        if (signal?.aborted || error instanceof ImagePromptError) throw error;
        throw new DingtalkApiError(
          'image-content-download-failed',
          '钉钉图片内容下载失败。',
          { cause: error },
        );
      }
    },

    async downloadFile({
      clientId,
      clientSecret,
      robotCode,
      downloadCode,
      signal,
    }) {
      const downloadUrl = await messageFileDownloadUrl({
        clientId,
        clientSecret,
        robotCode,
        downloadCode,
        signal,
        kind: 'file',
      });
      if (downloadUrl.protocol !== 'https:') {
        throw new DingtalkApiError('invalid-file-download', '钉钉服务返回了无效的文件下载地址。');
      }
      try {
        const response = await fetchImpl(downloadUrl, {
          method: 'GET',
          redirect: 'follow',
          signal,
        });
        if (!response?.ok) {
          await response?.body?.cancel?.().catch?.(() => undefined);
          throw new DingtalkApiError(
            'file-content-download-failed',
            `钉钉文件内容下载失败（HTTP ${response?.status ?? 'unknown'}）。`,
            { status: response?.status },
          );
        }
        return Buffer.from(await response.arrayBuffer());
      } catch (error) {
        if (signal?.aborted) throw abortError(signal);
        if (error instanceof DingtalkApiError) throw error;
        throw new DingtalkApiError(
          'file-content-download-failed',
          '钉钉文件内容下载失败。',
          { cause: error },
        );
      }
    },

    async createMenuCard({ clientId, clientSecret, target, data, signal }) {
      const normalizedTarget = normalizeCardTarget(target);
      const token = await accessToken({ clientId, clientSecret, signal });
      const cardInstanceId = `dsh_menu_${randomUUID()}`;
      const headers = { 'x-acs-dingtalk-access-token': token };
      await cardRequest('v1.0/card/instances/createAndDeliver', {
        body: {
          ...cardDeliverBody(cardInstanceId, normalizedTarget, clientId),
          cardTemplateId: DINGTALK_MENU_TEMPLATE_ID,
          outTrackId: cardInstanceId,
          cardData: dingtalkMenuCardData(data),
          callbackType: 'STREAM',
          imGroupOpenSpaceModel: { supportForward: false },
          imRobotOpenSpaceModel: { supportForward: false },
        },
        headers, signal, action: '菜单卡片创建',
      });
      return { cardInstanceId };
    },

    async updateMenuCard({ clientId, clientSecret, cardInstanceId, data, signal }) {
      if (!nonEmptyString(cardInstanceId)) throw new TypeError('cardInstanceId is required');
      const token = await accessToken({ clientId, clientSecret, signal });
      await cardRequest('v1.0/card/instances', {
        method: 'PUT',
        body: { outTrackId: cardInstanceId, cardData: dingtalkMenuCardData(data),
          cardUpdateOptions: { updateCardDataByKey: true } },
        headers: { 'x-acs-dingtalk-access-token': token }, signal, action: '菜单卡片更新',
      });
      return true;
    },

    async createAiCard({ clientId, clientSecret, target, initialText, signal }) {
      const appKey = nonEmptyString(clientId);
      const appSecret = nonEmptyString(clientSecret);
      const content = nonEmptyString(initialText);
      if (!appKey || !appSecret) throw new TypeError('clientId and clientSecret are required');
      if (!content) throw new TypeError('initialText is required');
      const normalizedTarget = normalizeCardTarget(target);
      const token = await accessToken({ clientId: appKey, clientSecret: appSecret, signal });
      const cardInstanceId = `dsh_${randomUUID()}`;
      const headers = { 'x-acs-dingtalk-access-token': token };

      let delivered = false;
      try {
        // Deliver the thinking copy in the same request that first shows the
        // card. Creating an empty instance and filling it after deliver (the
        // previous three-request sequence) leaves a blank bubble visible in
        // DingTalk for the time between deliver and the follow-up PUT, and
        // leaves a permanently blank card if that PUT ever fails.
        await cardRequest('v1.0/card/instances/createAndDeliver', {
          body: {
            ...cardDeliverBody(cardInstanceId, normalizedTarget, appKey),
            cardTemplateId: DINGTALK_AI_CARD_TEMPLATE_ID,
            outTrackId: cardInstanceId,
            cardData: cardData(content, '2', normalizedTarget),
            callbackType: 'STREAM',
            cardAtUserIds: normalizedTarget.atUserIds
              ? Object.keys(normalizedTarget.atUserIds)
              : undefined,
            imGroupOpenSpaceModel: { supportForward: true },
            imRobotOpenSpaceModel: { supportForward: true },
          },
          headers,
          signal,
          action: 'AI Card 创建并投放',
        });
        delivered = true;
        try {
          await cardRequest('v1.0/card/streaming', {
            method: 'PUT',
            body: {
              outTrackId: cardInstanceId,
              guid: randomUUID(),
              key: 'msgContent',
              content: cardMarkdown(content, normalizedTarget).replace(/\n+$/, ''),
              isFull: true,
              isFinalize: false,
              isError: false,
            },
            headers,
            signal,
            action: 'AI Card 启动',
          });
        } catch (error) {
          if (signal?.aborted) throw error;
          // The card is already visible with the thinking copy from
          // createAndDeliver above. Keep the instance so finishAiCard can
          // still replace it in place instead of sending a second message.
        }
      } catch (error) {
        if (delivered) {
          const cleanupSignal = AbortSignal.timeout(5_000);
          await failCard({
            clientId: appKey,
            clientSecret: appSecret,
            cardInstanceId,
            text: t('卡片已结束，请查看后续消息。'),
            target: normalizedTarget,
            signal: cleanupSignal,
          }).catch(() => undefined);
        }
        throw error;
      }
      return { cardInstanceId };
    },

    async updateAiCard({ clientId, clientSecret, cardInstanceId, text, target, signal }) {
      const instanceId = nonEmptyString(cardInstanceId);
      const content = nonEmptyString(text);
      if (!instanceId) throw new TypeError('cardInstanceId is required');
      if (!content) throw new TypeError('text is required');
      const token = await accessToken({ clientId, clientSecret, signal });
      await cardRequest('v1.0/card/streaming', {
        method: 'PUT',
        body: {
          outTrackId: instanceId,
          guid: randomUUID(),
          key: 'msgContent',
          content: cardMarkdown(content, target).replace(/\n+$/, ''),
          isFull: true,
          isFinalize: false,
          isError: false,
        },
        headers: { 'x-acs-dingtalk-access-token': token },
        signal,
        action: 'AI Card 更新',
      });
      return true;
    },

    async finishAiCard({ clientId, clientSecret, cardInstanceId, text, target, signal }) {
      const instanceId = nonEmptyString(cardInstanceId);
      const content = nonEmptyString(text);
      if (!instanceId) throw new TypeError('cardInstanceId is required');
      if (!content) throw new TypeError('text is required');
      const token = await accessToken({ clientId, clientSecret, signal });
      const headers = { 'x-acs-dingtalk-access-token': token };
      const normalizedContent = cardMarkdown(content, target);
      // Close the streaming widget before persisting the template's
      // finished state and full answer in msgContent.
      await cardRequest('v1.0/card/streaming', {
        method: 'PUT',
        body: {
          outTrackId: instanceId,
          guid: randomUUID(),
          key: 'msgContent',
          content: normalizedContent,
          isFull: true,
          isFinalize: true,
          isError: false,
        },
        headers,
        signal,
        action: 'AI Card 完成',
      });
      await cardRequest('v1.0/card/instances', {
        method: 'PUT',
        body: {
          outTrackId: instanceId,
          cardData: cardData(content, '3', target),
          cardUpdateOptions: { updateCardDataByKey: true },
        },
        headers,
        signal,
        action: 'AI Card 完成状态',
      });
      return { delivered: true, completed: true };
    },

    failAiCard: failCard,

    async sendText({ clientId, clientSecret, sessionWebhook, text, at, signal }) {
      const content = nonEmptyString(text);
      if (!content) throw new TypeError('text is required');
      const webhook = normalizeDingtalkSessionWebhook(sessionWebhook);
      const token = await accessToken({ clientId, clientSecret, signal });
      const replyAt = at && typeof at === 'object'
      && ((Array.isArray(at.atUserIds) && at.atUserIds.length > 0)
          || (Array.isArray(at.atMobiles) && at.atMobiles.length > 0)
          || at.isAtAll === true)
          ? { at } : {};
      const response = await requestJson(fetchImpl, webhook, {
        body: { msgtype: 'text', text: { content }, ...replyAt },
        headers: { 'x-acs-dingtalk-access-token': token },
        signal,
        action: '消息回复',
      });
      if ((response?.errcode !== undefined && response.errcode !== 0)
        || (response?.code !== undefined && response.code !== 0)) {
        throw new DingtalkApiError('send-rejected', '钉钉服务拒绝了回复消息。');
      }
      return true;
    },

    async sendRobotText({ clientId, clientSecret, target, text, signal, format = 'plain' }) {
      if (typeof text !== 'string' || !text.trim()) throw new TypeError('text is required');
      const normalizedTarget = normalizeFileTarget(target);
      const token = await accessToken({ clientId, clientSecret, signal });
      const pathname = normalizedTarget.type === 'group'
        ? 'v1.0/robot/groupMessages/send'
        : 'v1.0/robot/oToMessages/batchSend';
      const send = async (content, markdown) => {
        const response = await requestJson(fetchImpl, endpoint(apiBase, pathname), {
          body: {
            robotCode: normalizedTarget.robotCode,
            msgKey: markdown ? 'sampleMarkdown' : 'sampleText',
            msgParam: JSON.stringify(markdown ? { title: 'DSH', text: content } : { content }),
            ...(normalizedTarget.type === 'group'
              ? { openConversationId: normalizedTarget.openConversationId }
              : { userIds: [normalizedTarget.userId] }),
          },
          headers: { 'x-acs-dingtalk-access-token': token },
          signal,
          action: '主动文字消息发送',
        });
        const rejection = rejectedProviderResponse(response);
        if (rejection) {
          throw new DingtalkApiError('send-rejected', '钉钉服务拒绝了主动文字消息。', {
            providerCode: rejection,
          });
        }
        return response;
      };
      if (format !== 'markdown') return send(text, false);
      // Conservative Unicode payload size; reuse QQ's fence/table-aware split.
      const chunks = chunkMarkdownParts(text, 1_000);
      let result;
      for (const chunk of chunks) {
        try {
          result = await send(chunk.markdown, true);
        } catch (error) {
          // A missing message model is a definite format rejection. Do not
          // retry auth/target failures, rate limits or ambiguous transport errors.
          if (signal?.aborted || error?.providerCode !== 'sendMessage.model.notMatch'
            || !(error.code === 'send-rejected' || error.status === 400)) throw error;
          logger.warn?.('[dsh-im:dingtalk] Markdown rejected; sending this chunk as text');
          if (chunk.plain) result = await send(chunk.plain, false);
        }
      }
      return result;
    },

    async sendFile(request) {
      return sendArtifact(request, {
        uploadType: 'file',
        messageKey: 'sampleFile',
        createMessageParams: (mediaId, file) => ({
          mediaId,
          fileName: file.fileName,
          fileType: dingtalkFileType(file.fileName),
        }),
      });
    },

    async sendImage(request) {
      return sendArtifact(request, {
        uploadType: 'image',
        messageKey: 'sampleImageMsg',
        createMessageParams: (mediaId) => ({ photoURL: mediaId }),
      });
    },

    clearAccessToken(clientId) {
      const appKey = nonEmptyString(clientId);
      if (appKey) tokenCache.delete(appKey);
    },
  });
}

export const createDingTalkApi = createDingtalkApi;
export const normalizeDingTalkSessionWebhook = normalizeDingtalkSessionWebhook;
export const splitDingTalkText = splitDingtalkText;
