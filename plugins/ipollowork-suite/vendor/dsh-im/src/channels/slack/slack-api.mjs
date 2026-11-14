import { fetchFileStream } from '../shared/file-download.mjs';
import { fetchImageBuffer, ImagePromptError } from '../shared/image-prompt.mjs';
import { t } from '../shared/i18n.mjs';

const DEFAULT_BASE_URL = 'https://slack.com/api/';
const SLACK_FILE_HOST = 'files.slack.com';
const LEGACY_SLACK_FILE_HOST = 'slack.com';
const SLACK_FILE_PATH_PREFIX = '/files-pri/';
const SLACK_FILE_HOSTS = Object.freeze([SLACK_FILE_HOST]);
const SLACK_UPLOAD_PATH_PREFIX = '/upload/';
const DEFAULT_FILE_UPLOAD_TIMEOUT_MS = 120_000;

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requestSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function abortReason(signal) {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted', 'AbortError');
}

function positiveTimeout(value, name) {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${name} must be a positive integer`);
  return value;
}

function preserveProviderMetadata(target, source) {
  if (source?.providerCode !== undefined) target.providerCode = source.providerCode;
  if (Number.isInteger(source?.status)) target.status = source.status;
  return target;
}

function slackArtifactPreparationError(cause) {
  let code = 'artifact-provider-failed';
  let message = 'Slack file upload preparation failed';
  if (cause?.code === 'slack-file_upload_size_restricted') {
    code = 'artifact-too-large';
    message = 'Slack rejected the result file because it is too large';
  } else if (cause?.code === 'slack-missing-scope') {
    code = 'artifact-permission-required';
    message = 'Slack file delivery requires the files:write scope';
  } else if (cause?.code?.startsWith?.('slack-')) {
    code = 'artifact-provider-rejected';
    message = 'Slack rejected file upload preparation';
  }
  const error = new Error(message, { cause });
  error.code = code;
  return preserveProviderMetadata(error, cause);
}

function uncertainSlackDelivery(cause) {
  const error = new Error('Slack file completion result is uncertain', { cause });
  error.code = 'artifact-delivery-uncertain';
  return preserveProviderMetadata(error, cause);
}

function isRedirectStatus(status) {
  return Number.isInteger(status) && status >= 300 && status < 400;
}

async function cancelResponseBody(response) {
  try {
    await response?.body?.cancel?.();
  } catch {
    // Preserve the download failure when response cleanup also fails.
  }
}

function secureSlackFileUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error('Image download URL must use HTTPS');
  if (url.username || url.password || (url.port && url.port !== '443')) {
    throw new Error('Image download URL is not hosted by the messaging platform');
  }
  if (url.hostname === LEGACY_SLACK_FILE_HOST && url.pathname.startsWith(SLACK_FILE_PATH_PREFIX)) {
    url.hostname = SLACK_FILE_HOST;
  }
  if (url.hostname !== SLACK_FILE_HOST || !url.pathname.startsWith(SLACK_FILE_PATH_PREFIX)) {
    throw new Error('Image download URL is not hosted by the messaging platform');
  }
  url.hash = '';
  return url;
}

function secureSlackUploadUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password
    || (url.port && url.port !== '443') || url.hostname !== SLACK_FILE_HOST
    || !url.pathname.startsWith(SLACK_UPLOAD_PATH_PREFIX)) {
    throw new Error('Slack returned an unsafe file upload URL');
  }
  url.hash = '';
  return url;
}

function redirectUrl(response, source) {
  const location = response?.headers?.get?.('location');
  if (!location) return null;
  try {
    return new URL(location, source);
  } catch {
    return null;
  }
}

function responseOAuthScopes(response) {
  const raw = response?.headers?.get?.('x-oauth-scopes');
  if (raw === null || raw === undefined) return null;
  return new Set(raw.split(',').map((scope) => scope.trim()).filter(Boolean));
}

function isSlackWorkspaceRedirect(target) {
  return target?.protocol === 'https:'
    && !target.username
    && !target.password
    && (!target.port || target.port === '443')
    && target.hostname.endsWith('.slack.com')
    && target.hostname !== SLACK_FILE_HOST
    && target.pathname === '/'
    && target.searchParams.has('redir');
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    timer?.unref?.();
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

function slackId(value, name) {
  const result = cleanString(value);
  if (!result || !/^[A-Z][A-Z0-9]{4,30}$/i.test(result)) {
    throw new TypeError(`Invalid Slack ${name}`);
  }
  return result;
}

function requiredString(value, name) {
  const result = cleanString(value);
  if (!result) throw new TypeError(`Slack ${name} is required`);
  return result;
}

const SLACK_MARKDOWN_TEXT_LIMIT = 12_000;

function safeOutgoingText(value, { trim = true } = {}) {
  const raw = typeof value === 'string' ? value : '';
  const text = trim ? raw.trim() : raw;
  if (!text) throw new TypeError('Slack message text is required');
  return text
    .replace(/<@([A-Z0-9]+)>/gi, '@$1')
    .replace(/<!(channel|here|everyone)(?:\^[^>]*)?>/gi, '@$1');
}

function markdownTextField(value) {
  const text = safeOutgoingText(value);
  if (text.length > SLACK_MARKDOWN_TEXT_LIMIT) {
    throw new TypeError(`Slack markdown_text exceeds ${SLACK_MARKDOWN_TEXT_LIMIT} characters`);
  }
  return text;
}

function apiFailure(method, payload, tokenKind) {
  const reason = cleanString(payload?.error) ?? 'unknown_error';
  const error = new Error(`Slack ${method} failed: ${reason.replaceAll('_', ' ')}`);
  error.providerCode = reason;
  if (['invalid_auth', 'not_authed', 'token_revoked', 'account_inactive'].includes(reason)) {
    error.code = tokenKind === 'app' ? 'slack-invalid-app-token' : 'slack-invalid-bot-token';
  } else if (reason === 'missing_scope') {
    error.code = 'slack-missing-scope';
  } else if (reason === 'method_not_supported_for_channel_type'
    || reason === 'channel_type_not_supported'
    || reason === 'deprecated_endpoint') {
    error.code = 'slack-stream-unavailable';
  } else {
    error.code = `slack-${reason}`;
  }
  return error;
}

export function validSlackBotToken(value) {
  return typeof value === 'string'
    && /^xoxb-[A-Za-z0-9-]{16,}$/.test(value.trim());
}

export function validSlackAppToken(value) {
  return typeof value === 'string'
    && /^xapp-[A-Za-z0-9-]{16,}$/.test(value.trim());
}

export class SlackApi {
  #botToken;
  #appToken;
  #fetch;
  #baseUrl;
  #botScopes = null;
  #fileUploadTimeoutMs;

  constructor({
    botToken,
    appToken,
    fetchImpl = fetch,
    baseUrl = DEFAULT_BASE_URL,
    fileUploadTimeoutMs = DEFAULT_FILE_UPLOAD_TIMEOUT_MS,
  }) {
    if (botToken !== undefined && !validSlackBotToken(botToken)) {
      throw new TypeError('Slack Bot Token is invalid');
    }
    if (appToken !== undefined && !validSlackAppToken(appToken)) {
      throw new TypeError('Slack App Token is invalid');
    }
    if (!botToken && !appToken) throw new TypeError('SlackApi requires a token');
    if (typeof fetchImpl !== 'function') throw new TypeError('SlackApi requires fetch');
    this.#botToken = botToken?.trim();
    this.#appToken = appToken?.trim();
    this.#fetch = fetchImpl;
    this.#baseUrl = new URL(baseUrl);
    this.#fileUploadTimeoutMs = positiveTimeout(fileUploadTimeoutMs, 'fileUploadTimeoutMs');
  }

  authTest(options = {}) {
    return this.#request('auth.test', { ...options, tokenKind: 'bot' });
  }

  openConnection(options = {}) {
    return this.#request('apps.connections.open', {
      ...options,
      tokenKind: 'app',
      body: undefined,
    });
  }

  async conversationInfo({ channelId, signal } = {}) {
    const value = await this.#request('conversations.info', {
      tokenKind: 'bot', signal, body: { channel: slackId(channelId, 'channel id') },
    });
    return value.channel;
  }

  async fileInfo({ fileId, signal } = {}) {
    const value = await this.#request('files.info', {
      tokenKind: 'bot',
      signal,
      body: { file: slackId(fileId, 'file id') },
    });
    if (!value?.file || typeof value.file !== 'object' || Array.isArray(value.file)) {
      throw new Error('Slack files.info returned no file object');
    }
    return value.file;
  }

  async getMessage({ channelId, messageTs, signal } = {}) {
    const timestamp = requiredString(messageTs, 'message timestamp');
    const value = await this.#request('conversations.history', {
      tokenKind: 'bot',
      signal,
      body: {
        channel: slackId(channelId, 'channel id'),
        oldest: timestamp,
        latest: timestamp,
        inclusive: true,
        limit: 1,
      },
    });
    return Array.isArray(value?.messages)
      ? value.messages.find((message) => String(message?.ts ?? '') === timestamp) ?? null
      : null;
  }

  postMessage({ channelId, text, threadTs, signal, format = 'plain' }) {
    const outgoing = format === 'markdown_text' ? markdownTextField(text) : safeOutgoingText(text);
    const markdownText = format === 'markdown_text';
    return this.#request('chat.postMessage', {
      tokenKind: 'bot',
      signal,
      body: {
        channel: slackId(channelId, 'channel id'),
        // markdown_text cannot be combined with text or blocks.
        ...(markdownText
          ? { markdown_text: outgoing }
          : {
              text: outgoing,
              ...(format === 'markdown' ? { blocks: [{ type: 'markdown', text: outgoing }] } : {}),
              mrkdwn: format !== 'literal',
            }),
        ...(threadTs ? { thread_ts: cleanString(threadTs) } : {}),
        link_names: false,
        unfurl_links: false,
        unfurl_media: false,
      },
    });
  }

  updateMessage({ channelId, ts, text, signal }) {
    return this.#request('chat.update', {
      tokenKind: 'bot',
      signal,
      body: {
        channel: slackId(channelId, 'channel id'),
        ts: requiredString(ts, 'message timestamp'),
        markdown_text: markdownTextField(text),
        link_names: false,
      },
    });
  }

  addReaction({ channelId, messageTs, emojiName, signal, timeoutMs }) {
    return this.#request('reactions.add', {
      tokenKind: 'bot',
      signal,
      timeoutMs,
      retry: false,
      body: {
        channel: slackId(channelId, 'channel id'),
        timestamp: requiredString(messageTs, 'message timestamp'),
        name: requiredString(emojiName, 'reaction name'),
      },
    });
  }

  removeReaction({ channelId, messageTs, emojiName, signal, timeoutMs }) {
    return this.#request('reactions.remove', {
      tokenKind: 'bot',
      signal,
      timeoutMs,
      retry: false,
      body: {
        channel: slackId(channelId, 'channel id'),
        timestamp: requiredString(messageTs, 'message timestamp'),
        name: requiredString(emojiName, 'reaction name'),
      },
    });
  }

  startStream({ channelId, threadTs, recipientTeamId, recipientUserId, markdownText, signal }) {
    return this.#request('chat.startStream', {
      tokenKind: 'bot',
      signal,
      body: {
        channel: slackId(channelId, 'channel id'),
        thread_ts: requiredString(threadTs, 'thread timestamp'),
        ...(recipientTeamId ? { recipient_team_id: slackId(recipientTeamId, 'team id') } : {}),
        ...(recipientUserId ? { recipient_user_id: slackId(recipientUserId, 'user id') } : {}),
        ...(cleanString(markdownText) ? { markdown_text: safeOutgoingText(markdownText) } : {}),
      },
    });
  }

  appendStream({ channelId, ts, markdownText, signal }) {
    return this.#request('chat.appendStream', {
      tokenKind: 'bot',
      signal,
      body: {
        channel: slackId(channelId, 'channel id'),
        ts: requiredString(ts, 'stream timestamp'),
        markdown_text: safeOutgoingText(markdownText, { trim: false }),
      },
    });
  }

  stopStream({ channelId, ts, markdownText, signal }) {
    return this.#request('chat.stopStream', {
      tokenKind: 'bot',
      signal,
      body: {
        channel: slackId(channelId, 'channel id'),
        ts: requiredString(ts, 'stream timestamp'),
        ...(cleanString(markdownText) ? {
          markdown_text: safeOutgoingText(markdownText, { trim: false }),
        } : {}),
      },
    });
  }

  async uploadFile({ channelId, threadTs, file, signal }) {
    if (!file || typeof file !== 'object'
      || typeof file.fileName !== 'string' || !file.fileName
      || !Buffer.isBuffer(file.bytes)) {
      throw new TypeError('A Slack file is required');
    }
    if (signal?.aborted) throw abortReason(signal);
    const uploadSignal = requestSignal(signal, this.#fileUploadTimeoutMs);
    let ticket;
    try {
      ticket = await this.#request('files.getUploadURLExternal', {
        tokenKind: 'bot',
        signal: uploadSignal,
        timeoutMs: this.#fileUploadTimeoutMs,
        body: { filename: file.fileName, length: file.bytes.byteLength },
      });
    } catch (error) {
      if (signal?.aborted) throw abortReason(signal);
      throw slackArtifactPreparationError(error);
    }
    let fileId;
    let uploadUrl;
    try {
      fileId = requiredString(ticket?.file_id, 'file id');
      uploadUrl = secureSlackUploadUrl(ticket?.upload_url);
    } catch (error) {
      throw slackArtifactPreparationError(error);
    }
    let uploaded;
    try {
      uploaded = await this.#fetch(uploadUrl, {
        method: 'POST',
        headers: { 'content-type': file.mediaType ?? 'application/octet-stream' },
        body: file.bytes,
        signal: uploadSignal,
        redirect: 'error',
      });
    } catch (error) {
      if (signal?.aborted) throw abortReason(signal);
      throw slackArtifactPreparationError(error);
    }
    if (!Number.isInteger(uploaded?.status)) {
      throw slackArtifactPreparationError(new Error('Slack file upload returned an invalid response'));
    }
    if (uploaded.status !== 200) {
      await cancelResponseBody(uploaded);
      const error = new Error(`Slack file upload failed with HTTP ${uploaded.status}`);
      error.status = uploaded.status;
      if (uploaded.status === 413) {
        error.code = 'artifact-too-large';
      } else if (uploaded.status === 429) {
        error.code = 'artifact-rate-limited';
      } else {
        error.code = 'artifact-provider-rejected';
      }
      throw error;
    }
    await cancelResponseBody(uploaded);

    let completionBody;
    try {
      completionBody = {
        files: [{ id: fileId, title: file.fileName }],
        channel_id: slackId(channelId, 'channel id'),
        ...(threadTs ? { thread_ts: requiredString(threadTs, 'thread timestamp') } : {}),
      };
    } catch (error) {
      throw slackArtifactPreparationError(error);
    }
    if (uploadSignal.aborted) {
      if (signal?.aborted) throw abortReason(signal);
      throw slackArtifactPreparationError(uploadSignal.reason);
    }
    try {
      const completed = await this.#request('files.completeUploadExternal', {
        tokenKind: 'bot',
        signal: uploadSignal,
        timeoutMs: this.#fileUploadTimeoutMs,
        retry: false,
        body: completionBody,
      });
      if (!Array.isArray(completed?.files)
        || !completed.files.some((entry) => cleanString(entry?.id) === fileId)) {
        throw new Error('Slack file completion did not confirm the uploaded file');
      }
      return completed;
    } catch (error) {
      if (signal?.aborted) throw abortReason(signal);
      if (error?.code === 'slack-missing-scope') throw slackArtifactPreparationError(error);
      throw uncertainSlackDelivery(error);
    }
  }

  async downloadFile({ url, signal, maxBytes }) {
    return this.#downloadFile({ url, signal, maxBytes, stream: false });
  }

  async downloadFileStream({ url, signal }) {
    return this.#downloadFile({ url, signal, stream: true });
  }

  async #downloadFile({ url, signal, maxBytes, stream }) {
    if (!this.#botToken) throw new TypeError('Slack bot token is required for file download');
    const target = secureSlackFileUrl(url);
    const fetchSlackFile = async (requestUrl, options) => {
      const response = await this.#fetch(requestUrl, options);
      if (!isRedirectStatus(response?.status)) return response;

      const next = redirectUrl(response, requestUrl);
      if ((this.#botScopes && !this.#botScopes.has('files:read'))
        || isSlackWorkspaceRedirect(next)) {
        await cancelResponseBody(response);
        throw new ImagePromptError(
          'slack-file-access-required',
          'Slack redirected a private file request to the workspace because file access was not granted',
          t('Slack 未授权机器人读取该文件。请为应用添加 files:read 后重新安装，再重新发送图片。'),
        );
      }
      return response;
    };
    const options = {
      fetchImpl: fetchSlackFile,
      headers: { authorization: `Bearer ${this.#botToken}` },
      signal,
      allowedHosts: SLACK_FILE_HOSTS,
    };
    return stream
      ? fetchFileStream(target, options)
      : fetchImageBuffer(target, { ...options, maxBytes });
  }

  async #request(method, {
    tokenKind,
    body,
    signal,
    timeoutMs = 15_000,
    retry = true,
  }) {
    const token = tokenKind === 'app' ? this.#appToken : this.#botToken;
    if (!token) throw new TypeError(`Slack ${tokenKind} token is required for ${method}`);
    const formEncoded = method === 'files.getUploadURLExternal' || method === 'files.info';
    let response;
    try {
      response = await this.#fetch(new URL(method, this.#baseUrl), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': body === undefined || formEncoded
            ? 'application/x-www-form-urlencoded;charset=utf-8'
            : 'application/json;charset=utf-8',
          'user-agent': 'DeepSeek-Harness-dsh-im (https://github.com/xmanrui/dsh-im, 0.2.2)',
        },
        ...(body === undefined ? {} : {
          body: formEncoded ? new URLSearchParams(body).toString() : JSON.stringify(body),
        }),
        signal: requestSignal(signal, timeoutMs),
        redirect: 'error',
      });
    } catch (error) {
      if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw error;
      throw new Error(`Slack ${method} transport failed`, { cause: error });
    }

    if (tokenKind === 'bot') {
      const scopes = responseOAuthScopes(response);
      if (scopes) this.#botScopes = scopes;
    }

    let payload;
    try {
      payload = await response.json();
    } catch (cause) {
      throw Object.assign(new Error(`Slack ${method} returned invalid JSON`, { cause }), { status: response?.status });
    }
    if (response.status === 429 && retry) {
      const seconds = Number(response.headers.get('retry-after')) || 1;
      await delay(Math.min(10_000, Math.max(100, seconds * 1_000)), signal);
      return this.#request(method, { tokenKind, body, signal, timeoutMs, retry: false });
    }
    if (!response.ok || payload?.ok !== true) {
      const error = apiFailure(method, payload, tokenKind);
      error.status = response.status;
      throw error;
    }
    return payload;
  }
}

export async function inspectSlackCredentials({ botToken, appToken }, options = {}) {
  if (!validSlackBotToken(botToken)) {
    const error = new TypeError(t('Slack Bot Token 必须以 xoxb- 开头。'));
    error.code = 'slack-invalid-bot-token';
    throw error;
  }
  if (!validSlackAppToken(appToken)) {
    const error = new TypeError(t('Slack App Token 必须以 xapp- 开头。'));
    error.code = 'slack-invalid-app-token';
    throw error;
  }
  const api = new SlackApi({ botToken, appToken, ...options });
  const [identity, connection] = await Promise.all([api.authTest(), api.openConnection()]);
  if (!identity?.team_id || !identity?.user_id || !identity?.bot_id) {
    throw new Error(t('Slack Bot Token 没有返回完整的机器人身份。'));
  }
  let socketUrl;
  try {
    socketUrl = new URL(connection?.url);
  } catch {
    socketUrl = null;
  }
  if (!socketUrl || socketUrl.protocol !== 'wss:') {
    const error = new Error(t('Slack App Token 无法创建 Socket Mode 连接，请确认已启用 Socket Mode 和 connections:write。'));
    error.code = 'slack-socket-mode';
    throw error;
  }
  return {
    platformId: `${identity.team_id}:${identity.user_id}`,
    name: cleanString(identity.user) ?? 'DeepSeek Harness',
    username: cleanString(identity.user),
    teamId: String(identity.team_id),
    teamName: cleanString(identity.team),
  };
}
