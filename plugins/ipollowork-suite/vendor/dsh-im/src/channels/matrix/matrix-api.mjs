import { t } from '../shared/i18n.mjs';

const DEFAULT_TIMEOUT_MS = 15_000;
const UPLOAD_TIMEOUT_MS = 120_000;
const SYNC_TIMEOUT_MS = 45_000;
const MEDIA_TIMEOUT_MS = 60_000;
const MATRIX_FILE_HOST_MAX_REDIRECTS = 20;

const MATRIX_CLIENT_PREFIX = '/_matrix/client/v3';
const MATRIX_MEDIA_PREFIX = '/_matrix/media/v1';

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

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, Math.min(Math.max(ms, 0), 60_000));
    timer.unref?.();
    const rejectAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    if (signal?.aborted) rejectAbort();
    else signal?.addEventListener?.('abort', rejectAbort, { once: true });
  });
}

export function validateMatrixHomeserver(value) {
  const raw = cleanString(value);
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.hash) return null;
  return url.href.replace(/\/+$/, '');
}

export function isMatrixUserId(value) {
  return typeof value === 'string'
    && /^@[-.=_+/A-Za-z0-9]+:[-.A-Za-z0-9]+(?::\d{1,5})?$/u.test(value);
}

export function isMatrixRoomId(value) {
  return typeof value === 'string'
    && /^[!#][^:\s]+:[A-Za-z0-9.-]+(?::\d{1,5})?$/u.test(value);
}

export function isMatrixEventId(value) {
  return typeof value === 'string' && /^\$[^:\s]+(?::[^\s]+)?$/u.test(value) && value.length <= 512;
}

export function mxcToMatrixMediaUrl(homeserver, contentUri) {
  const base = validateMatrixHomeserver(homeserver);
  const match = /^mxc:\/\/([^/:]+)\/([^/?]+)$/.exec(cleanString(contentUri) ?? '');
  if (!base || !match) return null;
  const [, host, path] = match;
  if (!/^[A-Za-z0-9.-]+(?::\d{1,5})?$/u.test(host)) return null;
  const url = new URL(base);
  url.pathname = `${MATRIX_MEDIA_PREFIX}/download/${encodeURIComponent(host)}/${encodeURIComponent(path)}`;
  url.search = '';
  return url;
}

export class MatrixApiError extends Error {
  constructor(message, { code = 'matrix-api', status, providerCode, retryAfterMs, permanent = false } = {}) {
    super(message);
    this.name = 'MatrixApiError';
    this.code = code;
    this.status = status;
    this.providerCode = providerCode;
    this.retryAfterMs = retryAfterMs;
    this.permanent = permanent;
  }
}

const PERMANENT_PROVIDER_CODES = new Set([
  'm.unknown_token', 'm.missing_token', 'm.unauthorized', 'm.forbidden',
  'm.unknown', 'm.bad_json', 'm.invalid_json',
]);

function classifyMatrixError(status, providerCode, retryAfterMs) {
  if (status === 401) return { code: 'matrix-auth', permanent: true };
  if (status === 403) return { code: 'matrix-forbidden', permanent: true };
  if (status === 404) return { code: 'matrix-not-found', permanent: false };
  if (status === 429 || providerCode === 'm.limit_exceeded' || providerCode === 'm.too_many_requests') {
    return { code: 'matrix-rate-limited', permanent: false, retryAfterMs };
  }
  if (status >= 400 && status < 500 && PERMANENT_PROVIDER_CODES.has(providerCode ?? '')) {
    return { code: 'matrix-permanent', permanent: true };
  }
  if (status >= 400 && status < 500) return { code: 'matrix-rejected', permanent: false };
  return { code: 'matrix-service', permanent: false };
}

function parsedRetryAfterMs(retryAfterHeader, providerBody) {
  const numeric = Number(providerBody?.retry_after_ms);
  if (Number.isFinite(numeric) && numeric >= 0) return Math.min(numeric, 60_000);
  const seconds = Number(retryAfterHeader);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 60_000);
  return 1_000;
}

function newTransactionId() {
  return globalThis.crypto?.randomUUID?.() ?? `dsh-${Date.now()}-${Math.floor(Math.random() * 1e12)}`;
}

/**
 * Password login without an existing token; returns the minted session. The
 * runtime keeps the server-assigned device id so a stable `deviceId` can be
 * pinned afterwards for E2EE identity persistence.
 */
export async function performMatrixPasswordLogin(
  { homeserver, userId, password, deviceId, fetchImpl = globalThis.fetch } = {},
  options = {},
) {
  const base = validateMatrixHomeserver(homeserver);
  if (!base || !isMatrixUserId(cleanString(userId) ?? '') || !cleanString(password)) {
    throw new TypeError('Matrix password login requires a valid identity and password');
  }
  const url = new URL(`${base}${MATRIX_CLIENT_PREFIX}/login`);
  const signal = requestSignal(options.signal, DEFAULT_TIMEOUT_MS);
  const response = await fetchImpl(url.href, {
    method: 'POST',
    redirect: 'error',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: userId },
      password,
      ...(cleanString(deviceId) ? { device_id: deviceId } : {}),
      initial_device_display_name: 'DeepSeek Harness',
    }),
    signal,
  }).catch((cause) => {
    throw new MatrixApiError('Matrix password login is unreachable', {
      code: cause?.name === 'AbortError' || cause?.name === 'TimeoutError' ? 'timeout' : 'network',
    });
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new MatrixApiError(`Matrix password login failed with HTTP ${response.status}`,
      classifyMatrixError(response.status, cleanString(body?.errcode), 1_000));
  }
  const body = await response.json().catch(() => ({}));
  const accessToken = cleanString(body?.access_token);
  const resolvedUserId = cleanString(body?.user_id);
  if (!accessToken || !resolvedUserId) {
    throw new MatrixApiError('Matrix password login returned no session', { code: 'matrix-invalid' });
  }
  return { accessToken, userId: resolvedUserId, deviceId: cleanString(body?.device_id) };
}

export class MatrixApi {
  #homeserver;
  #accessToken;
  #fetchImpl;
  #userId;
  #userAgent = 'dsh-im/1.0';

  constructor({ homeserver, accessToken, userId, fetchImpl = globalThis.fetch, userAgent } = {}) {
    const base = validateMatrixHomeserver(homeserver);
    const token = cleanString(accessToken);
    if (!base) throw new TypeError('Matrix homeserver URL is invalid');
    if (!token) throw new TypeError('Matrix access token is required');
    if (typeof fetchImpl !== 'function') throw new TypeError('Matrix API requires a fetch implementation');
    this.#homeserver = base;
    this.#accessToken = token;
    this.#fetchImpl = fetchImpl;
    this.#userId = isMatrixUserId(cleanString(userId) ?? '') ? cleanString(userId) : null;
    if (userAgent) this.#userAgent = String(userAgent);
  }

  get homeserver() {
    return this.#homeserver;
  }

  #matrixUrl(path, query) {
    const url = new URL(`${this.#homeserver}${MATRIX_CLIENT_PREFIX}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    return url;
  }

  async #request(label, {
    path, method = 'GET', query, body, timeoutMs = DEFAULT_TIMEOUT_MS, signal, retry = true,
  }) {
    const url = this.#matrixUrl(path, query);
    const requestSignalValue = requestSignal(signal, timeoutMs);
    const attempt = async () => {
      const response = await this.#fetchImpl(url.href, {
        method,
        redirect: 'error',
        headers: {
          authorization: `Bearer ${this.#accessToken}`,
          'content-type': 'application/json',
          accept: 'application/json',
          'user-agent': this.#userAgent,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: requestSignalValue,
      });
      if (!response.ok) {
        const providerBody = await response.json().catch(() => ({}));
        const providerCode = cleanString(providerBody?.errcode);
        const providerMessage = cleanString(providerBody?.error);
        const classified = classifyMatrixError(
          response.status,
          providerCode,
          parsedRetryAfterMs(response.headers?.get?.('retry-after'), providerBody),
        );
        const detail = [providerCode, providerMessage].filter(Boolean).join(': ');
        throw new MatrixApiError(
          `Matrix ${label} failed with HTTP ${response.status}${detail ? ` (${detail})` : ''}`,
          { ...classified, status: response.status, providerCode },
        );
      }
      return await response.json().catch(() => ({}));
    };
    try {
      if (requestSignalValue?.aborted) throw abortReason(requestSignalValue);
      return await attempt();
    } catch (error) {
      if (!retry || !(error instanceof MatrixApiError) || error.code !== 'matrix-rate-limited') throw error;
      if (requestSignalValue?.aborted) throw abortReason(requestSignalValue);
      await delay(error.retryAfterMs ?? 1_000, requestSignalValue);
      return await attempt();
    } finally {
      requestSignalValue?.throwIfAborted?.();
    }
  }

  async whoami(options = {}) {
    return await this.#request('whoami', { path: '/account/whoami', signal: options.signal });
  }

  /**
   * Reads one member's display name from the room state. The Matrix profile
   * field is optional, so a homeserver without the member or without a name
   * reads as null rather than an error.
   * @param roomId - the room whose state to read.
   * @param userId - the member's fully-qualified Matrix user id.
   * @param options - `{ signal }` forwarding options.
   * @returns {Promise<string|null>} the trimmed display name, or null when absent.
   */
  async getRoomMemberDisplayName(roomId, userId, options = {}) {
    const event = await this.#request(`room member ${userId}`, {
      path: `/rooms/${encodeURIComponent(roomId)}/state/members/${encodeURIComponent(userId)}`,
      signal: options.signal,
    }).catch(() => null);
    const name = cleanString(event?.content?.displayname);
    return name && name.length <= 256 ? name : null;
  }

  async login({ identifier, password, deviceId, displayName }, options = {}) {
    const body = {
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: identifier },
      password: String(password ?? ''),
      ...(cleanString(deviceId) ? { device_id: deviceId } : {}),
      initial_device_display_name: cleanString(displayName) ?? 'DeepSeek Harness',
    };
    return await this.#request('login', {
      path: '/login', method: 'POST', body, signal: options.signal,
    });
  }

  async sync({ since, timeout = 0, signal } = {}) {
    return await this.#request('sync', {
      path: '/sync',
      query: { timeout, ...(cleanString(since) ? { since } : {}) },
      timeoutMs: timeout > 0 ? SYNC_TIMEOUT_MS : DEFAULT_TIMEOUT_MS,
      signal,
    });
  }

  async joinRoom(roomId, options = {}) {
    if (!isMatrixRoomId(roomId)) throw new TypeError('Matrix room id is invalid');
    return await this.#request('join', {
      path: `/join/${encodeURIComponent(roomId)}`, method: 'POST', signal: options.signal,
    });
  }

  async leaveRoom(roomId, options = {}) {
    if (!isMatrixRoomId(roomId)) throw new TypeError('Matrix room id is invalid');
    return await this.#request('leave', {
      path: `/leave/${encodeURIComponent(roomId)}`, method: 'POST', signal: options.signal,
    });
  }

  async createRoom(body, options = {}) {
    return await this.#request('create-room', {
      path: '/create_room', method: 'POST', body, timeoutMs: 30_000, signal: options.signal,
    });
  }

  async sendEvent(roomId, eventType, content, options = {}) {
    if (!isMatrixRoomId(roomId)) throw new TypeError('Matrix room id is invalid');
    if (typeof eventType !== 'string' || !eventType) throw new TypeError('Matrix event type is invalid');
    const transactionId = cleanString(options.transactionId) ?? newTransactionId();
    return await this.#request('send', {
      path: `/rooms/${encodeURIComponent(roomId)}/send/${encodeURIComponent(eventType)}/${encodeURIComponent(transactionId)}`,
      method: 'PUT',
      body: content ?? {},
      timeoutMs: 30_000,
      signal: options.signal,
    });
  }

  async redactEvent(roomId, eventId, reason, options = {}) {
    if (!isMatrixRoomId(roomId) || !isMatrixEventId(eventId)) throw new TypeError('Matrix redact target is invalid');
    return await this.#request('redact', {
      path: `/rooms/${encodeURIComponent(roomId)}/redact/${encodeURIComponent(eventId)}/${encodeURIComponent(newTransactionId())}`,
      method: 'PUT',
      body: cleanString(reason) ? { reason } : {},
      signal: options.signal,
    });
  }

  async setTyping(roomId, { typing = true, timeoutMs = 20_000 } = {}, options = {}) {
    if (!isMatrixRoomId(roomId)) throw new TypeError('Matrix room id is invalid');
    if (!this.#userId) return null;
    return await this.#request('typing', {
      path: `/rooms/${encodeURIComponent(roomId)}/typing/${encodeURIComponent(this.#userId)}`,
      method: 'PUT',
      body: { typing, ...(typing ? { timeout: timeoutMs } : {}) },
      signal: options.signal,
    });
  }

  async sendReceipt(roomId, eventId, options = {}) {
    if (!isMatrixRoomId(roomId) || !isMatrixEventId(eventId)) throw new TypeError('Matrix receipt target is invalid');
    return await this.#request('receipt', {
      path: `/rooms/${encodeURIComponent(roomId)}/receipts/m.read/${encodeURIComponent(eventId)}`,
      method: 'POST',
      body: {},
      signal: options.signal,
    });
  }

  /**
   * Single-event lookup used by the conversation context collectors to resolve a
   * reply or thread root outside the retained sync window. The homeserver answers
   * 404 for an unknown event, so a miss travels as null instead of an exception;
   * an E2EE room returns the still-encrypted event and the caller decrypts it.
   */
  async getEvent(roomId, eventId, options = {}) {
    if (!isMatrixRoomId(roomId) || !isMatrixEventId(eventId)) throw new TypeError('Matrix event lookup target is invalid');
    return await this.#request('event', {
      path: `/rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(eventId)}`,
      timeoutMs: 10_000,
      signal: options.signal,
    }).catch(() => null);
  }


  async listRelations(roomId, eventId, relationType, options = {}) {
    if (!isMatrixRoomId(roomId) || !isMatrixEventId(eventId)) throw new TypeError('Matrix relation query target is invalid');
    if (!/^[m]?[A-Za-z0-9._-]{1,128}$/.test(String(relationType ?? ''))) throw new TypeError('Matrix relation type is invalid');
    return await this.#request('relations', {
      path: `/rooms/${encodeURIComponent(roomId)}/relations/${encodeURIComponent(eventId)}/${encodeURIComponent(relationType)}`,
      query: { dir: 'b', limit: 50 },
      timeoutMs: 10_000,
      signal: options.signal,
    }).catch(() => ({ events: [] }));
  }

  async getAccountData(type, options = {}) {
    return await this.#request('account-data', {
      path: `/account_data/${encodeURIComponent(type)}`,
      signal: options.signal,
    });
  }

  async setAccountData(type, body, options = {}) {
    return await this.#request('set-account-data', {
      path: `/account_data/${encodeURIComponent(type)}`,
      method: 'PUT',
      body: body ?? {},
      signal: options.signal,
    });
  }

  async getRoomStateEvent(roomId, type, stateKey = '', options = {}) {
    return await this.#request('room-state', {
      path: `/rooms/${encodeURIComponent(roomId)}/state/${encodeURIComponent(type)}/${encodeURIComponent(stateKey)}`,
      signal: options.signal,
    }).catch((error) => {
      if (error instanceof MatrixApiError && error.status === 404) return null;
      throw error;
    });
  }

  async getJoinedMemberCount(roomId, options = {}) {
    const members = await this.#joinedMembers(roomId, options);
    return members === null ? null : members.length;
  }

  async getJoinedMembers(roomId, options = {}) {
    return await this.#joinedMembers(roomId, options);
  }

  async #joinedMembers(roomId, options) {
    if (!isMatrixRoomId(roomId)) throw new TypeError('Matrix room id is invalid');
    const body = await this.#request('members', {
      path: `/rooms/${encodeURIComponent(roomId)}/joined_members`,
      timeoutMs: 10_000,
      signal: options.signal,
    }).catch(() => null);
    const joined = body?.joined;
    // The CS API answers joined members as a user-id keyed map; tolerate arrays as well.
    if (joined && typeof joined === 'object') return Object.freeze(Object.keys(joined));
    return null;
  }

  async queryKeys(userIds, options = {}) {
    const ids = Array.isArray(userIds)
      ? [...new Set(userIds.filter((entry) => isMatrixUserId(entry)))].slice(0, 250)
      : [];
    if (ids.length === 0) return { device_keys: {} };
    return await this.#request('keys-query', {
      path: '/keys/query',
      method: 'POST',
      body: { user_ids: ids, timeout: options.timeoutMs ?? 10_000 },
      timeoutMs: (options.timeoutMs ?? 10_000) + 5_000,
      signal: options.signal,
    });
  }

  async claimKeys(oneTimeKeys, options = {}) {
    const claim = {};
    for (const [userId, devices] of Object.entries(oneTimeKeys ?? {})) {
      if (!isMatrixUserId(userId) || !devices || typeof devices !== 'object' || Array.isArray(devices)) continue;
      const perUser = {};
      for (const [deviceId, count] of Object.entries(devices)) {
        if (!deviceId.trim()) continue;
        const amount = Number.isSafeInteger(Number(count)) && Number(count) > 0 ? Math.min(Number(count), 10) : 1;
        perUser[deviceId] = amount;
      }
      if (Object.keys(perUser).length > 0) claim[userId] = perUser;
    }
    if (Object.keys(claim).length === 0) return { one_time_keys: {} };
    return await this.#request('keys-claim', {
      path: '/keys/claim',
      method: 'POST',
      body: { one_time_keys: claim },
      timeoutMs: 20_000,
      signal: options.signal,
    });
  }

  async uploadKeys(payload, options = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new TypeError('Matrix key upload payload is invalid');
    }
    return await this.#request('keys-upload', {
      // POST per the Matrix CS API (POST /keys/upload). A PUT here is rejected by
      // some homeservers as 405 M_UNRECOGNIZED, which aborts crypto bootstrap.
      path: '/keys/upload',
      method: 'POST',
      body: payload,
      timeoutMs: 20_000,
      signal: options.signal,
    });
  }

  async listKeyChanges(from, options = {}) {
    return await this.#request('keys-changes', {
      path: '/keys/changes',
      query: { ...(cleanString(from) ? { from } : {}), timeout: options.timeoutMs ?? 10_000 },
      timeoutMs: (options.timeoutMs ?? 10_000) + 5_000,
      signal: options.signal,
    });
  }

  async sendToDevice(eventType, messages, options = {}) {
    if (!/^[A-Za-z][A-Za-z0-9._-]{0,127}$/.test(String(eventType ?? ''))) {
      throw new TypeError('Matrix to-device event type is invalid');
    }
    if (!messages || typeof messages !== 'object' || Array.isArray(messages)) {
      throw new TypeError('Matrix to-device messages are invalid');
    }
    const transactionId = cleanString(options.transactionId) ?? newTransactionId();
    return await this.#request('send-to-device', {
      path: '/sendToDevice',
      method: 'PUT',
      query: { type: eventType, txn: transactionId },
      body: { messages },
      timeoutMs: 30_000,
      signal: options.signal,
    });
  }

  async uploadMedia(bytes, { filename, mediaType } = {}, options = {}) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new TypeError('Matrix media upload requires a non-empty Uint8Array');
    const type = cleanString(mediaType) ?? 'application/octet-stream';
    const name = cleanString(filename);
    if (!/^[A-Za-z0-9._/-]{1,512}$/.test(type)) throw new TypeError('Matrix media type is invalid');
    const query = { filename: name ?? undefined };
    const url = new URL(`${this.#homeserver}${MATRIX_MEDIA_PREFIX}/upload`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const signal = requestSignal(options.signal, UPLOAD_TIMEOUT_MS);
    const response = await this.#fetchImpl(url.href, {
      method: 'POST',
      redirect: 'error',
      headers: {
        authorization: `Bearer ${this.#accessToken}`,
        'content-type': type,
        accept: 'application/json',
        'user-agent': this.#userAgent,
      },
      body: bytes,
      signal,
    }).catch((error) => {
      throw new MatrixApiError('Matrix media upload is unreachable', {
        code: error?.name === 'AbortError' || error?.name === 'TimeoutError' ? 'timeout' : 'network',
      });
    });
    if (!response.ok) {
      const providerBody = await response.json().catch(() => ({}));
      const classified = classifyMatrixError(
        response.status,
        cleanString(providerBody?.errcode),
        parsedRetryAfterMs(response.headers?.get?.('retry-after'), providerBody),
      );
      throw new MatrixApiError(`Matrix media upload failed with HTTP ${response.status}`, {
        ...classified, status: response.status, providerCode: cleanString(providerBody?.errcode),
      });
    }
    const body = await response.json().catch(() => ({}));
    const contentUri = cleanString(body?.content_uri);
    if (!contentUri) throw new MatrixApiError('Matrix media upload returned no content URI', { code: 'matrix-invalid' });
    return contentUri;
  }

  /**
   * Bounded MXC content download against the configured homeserver only. The
   * media path derives from the `mxc://` server/path pair; foreign servers in
   * the URI are rejected by the allowlist below, redirects are followed
   * manually up to a fixed hop budget, and the byte cap is enforced while
   * streaming so a lying `content-length` cannot inflate memory.
   */
  async downloadContent(contentUri, { signal, maxBytes = 104_857_600 } = {}) {
    const base = validateMatrixHomeserver(this.#homeserver);
    const allowHost = base ? new URL(base).host : '';
    let target = mxcToMatrixMediaUrl(this.#homeserver, contentUri);
    if (!target || target.host !== allowHost) {
      throw new MatrixApiError('Matrix media content URI is invalid or hosted by a foreign server',
        { code: 'matrix-invalid', permanent: true });
    }
    target.searchParams.set('access_token', this.#accessToken);
    const requestSignalValue = requestSignal(signal, MEDIA_TIMEOUT_MS);
    let hops = 0;
    for (;;) {
      const response = await this.#fetchImpl(target.href, {
        method: 'GET',
        redirect: 'error',
        headers: {
          authorization: `Bearer ${this.#accessToken}`,
          accept: '*/*',
          'user-agent': this.#userAgent,
        },
        signal: requestSignalValue,
      }).catch((cause) => {
        throw new MatrixApiError('Matrix media download is unreachable', {
          code: cause?.name === 'AbortError' || cause?.name === 'TimeoutError' ? 'timeout' : 'network',
        });
      });
      if (response.status >= 300 && response.status < 400 && hops < MATRIX_FILE_HOST_MAX_REDIRECTS) {
        const location = response.headers?.get?.('location');
        await response.body?.cancel?.().catch(() => undefined);
        if (!location) throw new MatrixApiError('Matrix media redirect without a location', { code: 'matrix-invalid' });
        const next = new URL(location, target);
        if (next.host !== allowHost) {
          throw new MatrixApiError('Matrix media redirect leaves the configured homeserver',
            { code: 'matrix-invalid', permanent: true });
        }
        target = next;
        hops += 1;
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel?.().catch(() => undefined);
        throw new MatrixApiError(`Matrix media download failed with HTTP ${response.status}`,
          classifyMatrixError(response.status, undefined, 1_000));
      }
      const declared = Number(response.headers?.get?.('content-length'));
      if (Number.isFinite(declared) && declared > maxBytes) {
        await response.body?.cancel?.().catch(() => undefined);
        throw new MatrixApiError(`Matrix media exceeds the ${maxBytes} byte cap`, { code: 'too-large' });
      }
      const chunks = [];
      let total = 0;
      if (response.body?.[Symbol.asyncIterator]) {
        for await (const chunk of response.body) {
          const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
          total += bytes.byteLength;
          if (total > maxBytes) {
            await response.body.cancel?.().catch(() => undefined);
            throw new MatrixApiError(`Matrix media exceeds the ${maxBytes} byte cap`, { code: 'too-large' });
          }
          chunks.push(bytes);
        }
      } else {
        const buffer = await response.arrayBuffer();
        total = buffer.byteLength;
        if (total > maxBytes) throw new MatrixApiError(`Matrix media exceeds the ${maxBytes} byte cap`, { code: 'too-large' });
        if (total) chunks.push(new Uint8Array(buffer));
      }
      if (!total) return null;
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return merged;
    }
  }
}

/**
 * Resolve one credential pair into the stable Matrix bot identity that the
 * config store hashes into `botId` and credential references. Token logins are
 * validated through `whoami`; password logins rotate a device session and keep
 * the server-reported device id for E2EE stability.
 */
export async function inspectMatrixCredentials(
  { homeserver, accessToken, userId, password } = {},
  { fetchImpl } = {},
) {
  const base = validateMatrixHomeserver(homeserver);
  const token = cleanString(accessToken);
  const identifier = cleanString(userId);
  const secret = cleanString(password);
  if (!base) {
    const error = new Error(t('Matrix homeserver 地址无效，请填写 https:// 或 http:// 开头的完整地址。'));
    error.code = 'invalid-config';
    throw error;
  }
  if (!token && !(identifier && secret)) {
    const error = new Error(t('Matrix 凭据不完整：请提供访问令牌，或用户 ID 与密码的组合。'));
    error.code = 'invalid-config';
    throw error;
  }
  if (identifier && !isMatrixUserId(identifier)) {
    const error = new Error(t('Matrix 用户 ID 无效，请使用 @user:server 形式。'));
    error.code = 'invalid-config';
    throw error;
  }
  let resolvedUserId = identifier;
  let resolvedDeviceId = null;
  if (token) {
    const api = new MatrixApi({ homeserver: base, accessToken: token, ...(fetchImpl ? { fetchImpl } : {}) });
    let identity;
    try {
      identity = await api.whoami();
    } catch (cause) {
      if (cause instanceof MatrixApiError && cause.permanent) {
        const error = new Error(t('Matrix 访问令牌无效或已失效，请在 homeserver 重新签发后重试。'));
        error.code = 'auth-failed';
        throw error;
      }
      const error = new Error(t('Matrix homeserver 暂时无法访问，请确认网络与地址后重试。'));
      error.code = 'network';
      throw error;
    }
    resolvedUserId = cleanString(identity?.user_id) ?? identifier;
    resolvedDeviceId = cleanString(identity?.device_id);
    if (!resolvedUserId) {
      const error = new Error(t('Matrix whoami 未返回用户身份，请改用用户 ID 与密码接入。'));
      error.code = 'auth-failed';
      throw error;
    }
  } else {
    const url = new URL(`${base}${MATRIX_CLIENT_PREFIX}/login`);
    const response = await (fetchImpl ?? globalThis.fetch)(url.href, {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        type: 'm.login.password',
        identifier: { type: 'm.id.user', user: identifier },
        password: secret,
        initial_device_display_name: 'DeepSeek Harness',
      }),
    }).catch(() => null);
    if (!response?.ok) {
      if (response && (response.status === 403 || response.status === 401)) {
        const error = new Error(t('Matrix 用户名或密码不正确，请核对后重试。'));
        error.code = 'auth-failed';
        throw error;
      }
      const error = new Error(t('Matrix homeserver 暂不支持密码登录，请改用访问令牌接入。'));
      error.code = 'login-failed';
      throw error;
    }
    const body = await response.json().catch(() => ({}));
    resolvedUserId = cleanString(body?.user_id) ?? identifier;
    resolvedDeviceId = cleanString(body?.device_id);
  }
  const host = new URL(base).host.toLowerCase();
  const localpart = resolvedUserId.slice(1, Math.max(1, resolvedUserId.indexOf(':')));
  return {
    platformId: `${host}|${resolvedUserId.toLowerCase()}`,
    homeserver: base,
    userId: resolvedUserId,
    deviceId: resolvedDeviceId,
    name: localpart || resolvedUserId,
    username: localpart || null,
  };
}
