import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

import {
  WECOM_APP_STREAM_PLACEHOLDER,
  buildEncryptedReply,
  createUserCrypto,
  isXmlFormat,
  parseWecomAppPlainMessage,
  parseWecomAppXmlBody,
} from './wecom-app-api.mjs';

const DEFAULT_STREAM_TTL_MS = 15 * 60_000;
const DEFAULT_MAX_STREAMS = 256;
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

function safeEqualHex(expected, provided) {
  const a = Buffer.from(String(expected ?? ''), 'utf8');
  const b = Buffer.from(String(provided ?? ''), 'utf8');
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function writeBody(res, status, body, headers = {}) {
  if (res.writableEnded || res.destroyed) return;
  res.writeHead(status, {
    'content-length': String(Buffer.byteLength(body)),
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function writeText(res, status, text, headers = {}) {
  writeBody(res, status, text, { 'content-type': 'text/plain; charset=utf-8', ...headers });
}

function writeEmpty(res) {
  if (res.writableEnded || res.destroyed) return;
  res.statusCode = 200;
  res.end();
}

// One shared HTTP listener for every wecom-app bot. Each bot registers a route
// keyed by its full callback path; the per-bot random path segment doubles as
// the first gate before the WeCom signature check.
export class WecomAppCallbackServer {
  #host;
  #port;
  #logger;
  #streamTtlMs;
  #maxStreams;
  #maxBodyBytes;
  #server = null;
  #routes = new Map();
  #streams = new Map();
  #streamByMsgId = new Map();

  constructor({
    host = '127.0.0.1',
    port = 30987,
    logger = console,
    streamTtlMs = DEFAULT_STREAM_TTL_MS,
    maxStreams = DEFAULT_MAX_STREAMS,
    maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
  } = {}) {
    this.#host = String(host ?? '127.0.0.1');
    this.#port = Number(port);
    if (!Number.isInteger(this.#port) || this.#port < 0 || this.#port > 65_535) {
      throw new TypeError('WecomAppCallbackServer requires an integer port between 0 and 65535');
    }
    this.#logger = logger;
    this.#streamTtlMs = streamTtlMs;
    this.#maxStreams = maxStreams;
    this.#maxBodyBytes = maxBodyBytes;
  }

  get listening() {
    return this.#server !== null && this.#server.listening === true;
  }

  get address() {
    return { host: this.#host, port: this.#port };
  }

  // The OS-assigned port after listen(0); falls back to the configured port.
  get actualPort() {
    const bound = this.#server?.address?.();
    return typeof bound?.port === 'number' ? bound.port : this.#port;
  }

  routePath({ botId, callbackSecret }) {
    // Keep the callback prefix distinct from the GUI RPC channel path
    // (/wecom-app/...): the reverse-proxy location must forward ONLY the
    // callback prefix to this listener and leave RPC traffic to dsh web.
    return `/wecom-app-callback/${botId}/${callbackSecret}`;
  }

  registerRoute(route) {
    if (!route?.botId || !route.callbackSecret || typeof route.cryptoFor !== 'function' || typeof route.onInbound !== 'function') {
      throw new TypeError('A wecom-app route requires botId, callbackSecret, cryptoFor, and onInbound');
    }
    // Keyed by the full callback path: WeCom requests are dispatched on it.
    this.#routes.set(this.routePath(route), Object.freeze({ ...route }));
    return this;
  }

  unregisterRoute(botId) {
    for (const [path, route] of this.#routes.entries()) {
      if (route.botId === botId) this.#routes.delete(path);
    }
    for (const [streamId, stream] of this.#streams.entries()) {
      if (stream.botId === botId) {
        this.#streams.delete(streamId);
        if (stream.msgid) this.#streamByMsgId.delete(this.#msgKey(stream.botId, stream.msgid));
      }
    }
    return this;
  }

  async start() {
    if (this.#server) return this.address;
    const server = createServer((request, response) => {
      this.#handleRequest(request, response).catch((error) => {
        this.#logger.warn?.('[dsh-im:wecom-app] callback request failed:', error);
        writeText(response, 500, 'internal error');
      });
    });
    server.on('clientError', (_error, socket) => {
      if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    });
    await new Promise((resolve, reject) => {
      const onceError = (error) => {
        server.removeListener('listening', onceListening);
        reject(error);
      };
      const onceListening = () => {
        server.removeListener('error', onceError);
        resolve();
      };
      server.once('error', onceError);
      server.once('listening', onceListening);
      server.listen(this.#port, this.#host);
    });
    this.#server = server;
    return this.address;
  }

  async stop() {
    const server = this.#server;
    this.#server = null;
    this.#routes.clear();
    this.#streams.clear();
    this.#streamByMsgId.clear();
    if (!server) return;
    await new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
  }

  routeCount() {
    return this.#routes.size;
  }

  // Stream dedup and lookup are scoped per bot: two self-built apps can share
  // a MsgId, and a refresh signed by app B must never read app A's stream.
  #msgKey(botId, msgid) {
    return botId + ':' + msgid;
  }

  createStream({ botId, msgid }) {
    this.#pruneStreams();
    if (this.#streams.size >= this.#maxStreams) {
      const oldest = this.#streams.keys().next().value;
      const evicted = this.#streams.get(oldest);
      this.#streams.delete(oldest);
      if (evicted?.msgid) this.#streamByMsgId.delete(this.#msgKey(evicted.botId, evicted.msgid));
    }
    const streamId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    const state = {
      botId,
      streamId,
      msgid: msgid ?? null,
      content: '',
      finished: false,
      error: null,
      refreshes: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.#streams.set(streamId, state);
    if (msgid) this.#streamByMsgId.set(this.#msgKey(botId, msgid), streamId);
    return state;
  }

  getStream(streamId) {
    return this.#streams.get(streamId) ?? null;
  }

  appendStream(streamId, chunk, { replace = false } = {}) {
    const stream = this.#streams.get(streamId);
    if (!stream || stream.finished) return false;
    stream.content = replace ? String(chunk ?? '') : stream.content + String(chunk ?? '');
    stream.updatedAt = Date.now();
    return true;
  }

  finishStream(streamId, { error } = {}) {
    const stream = this.#streams.get(streamId);
    if (!stream) return false;
    if (error) stream.error = String(error);
    stream.finished = true;
    stream.updatedAt = Date.now();
    return true;
  }

  streamSnapshot(streamId) {
    const stream = this.#streams.get(streamId);
    if (!stream) return null;
    return {
      id: stream.streamId,
      finish: stream.finished,
      content: stream.content,
    };
  }

  async #handleRequest(request, response) {
    if (request.method !== 'GET' && request.method !== 'POST') {
      writeText(response, 405, 'method not allowed', { allow: 'GET, POST' });
      return;
    }
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    const route = this.#routes.get(url.pathname) ?? null;
    if (!route) {
      writeText(response, 404, 'not found');
      return;
    }
    const query = url.searchParams;
    if (request.method === 'GET') {
      this.#verifyUrl(route, query, response);
      return;
    }
    await this.#handlePost(route, query, request, response);
  }

  #verifyUrl(route, query, response) {
    const timestamp = query.get('timestamp') ?? '';
    const nonce = query.get('nonce') ?? '';
    const echostr = query.get('echostr') ?? '';
    const signature = query.get('msg_signature') ?? query.get('msgsignature') ?? query.get('signature') ?? '';
    this.#logger.info?.('[dsh-im:wecom-app] URL verification attempt', route.botId, { timestamp, nonce });
    if (!timestamp || !nonce || !echostr || !signature) {
      this.#logger.warn?.('[dsh-im:wecom-app] URL verification rejected: missing query params', route.botId);
      writeText(response, 400, 'missing query params');
      return;
    }
    let crypto;
    try {
      crypto = route.cryptoFor();
    } catch (error) {
      this.#logger.warn?.('[dsh-im:wecom-app] route credentials are incomplete:', error);
      writeText(response, 503, 'route not ready');
      return;
    }
    try {
      if (!safeEqualHex(crypto.computeSignature(timestamp, nonce, echostr), signature)) {
        this.#logger.warn?.('[dsh-im:wecom-app] URL verification signature mismatch', route.botId);
        writeText(response, 401, 'unauthorized');
        return;
      }
      const plaintext = crypto.decrypt(echostr);
      this.#logger.info?.('[dsh-im:wecom-app] URL verification succeeded', route.botId);
      writeText(response, 200, plaintext);
    } catch (error) {
      this.#logger.warn?.('[dsh-im:wecom-app] URL verification failed:', error);
      writeText(response, 400, 'verification failed');
    }
  }

  async #handlePost(route, query, request, response) {
    const body = await this.#readBody(request, response);
    if (body === null) return;
    let envelope = {};
    if (isXmlFormat(body.raw)) {
      const xml = parseWecomAppXmlBody(body.raw);
      envelope = {
        encrypt: xml.Encrypt ?? '',
        signature: xml.MsgSignature ?? query.get('msg_signature') ?? query.get('msgsignature') ?? '',
        timestamp: xml.TimeStamp ?? query.get('timestamp') ?? '',
        nonce: xml.Nonce ?? query.get('nonce') ?? '',
        format: 'xml',
      };
    } else {
      let parsed = {};
      try {
        parsed = JSON.parse(body.raw);
      } catch {
        writeText(response, 400, 'invalid payload');
        return;
      }
      envelope = {
        encrypt: parsed.encrypt ?? '',
        signature: parsed.msgsignature ?? parsed.MsgSignature ?? query.get('msg_signature') ?? '',
        timestamp: String(parsed.timestamp ?? parsed.TimeStamp ?? query.get('timestamp') ?? ''),
        nonce: String(parsed.nonce ?? parsed.Nonce ?? query.get('nonce') ?? ''),
        format: 'json',
      };
    }
    if (!envelope.encrypt || !envelope.signature || !envelope.timestamp || !envelope.nonce) {
      writeText(response, 400, 'missing encrypted payload');
      return;
    }
    this.#logger.info?.('[dsh-im:wecom-app] callback POST received', route.botId, { format: envelope.format, bytes: body.raw.length });
    let crypto;
    try {
      crypto = route.cryptoFor();
    } catch (error) {
      this.#logger.warn?.('[dsh-im:wecom-app] route credentials are incomplete:', error);
      writeText(response, 503, 'route not ready');
      return;
    }
    let plaintext;
    try {
      if (!safeEqualHex(crypto.computeSignature(envelope.timestamp, envelope.nonce, envelope.encrypt), envelope.signature)) {
        this.#logger.warn?.('[dsh-im:wecom-app] callback signature mismatch', route.botId);
        writeText(response, 401, 'unauthorized');
        return;
      }
      plaintext = crypto.decrypt(envelope.encrypt);
    } catch (error) {
      this.#logger.warn?.('[dsh-im:wecom-app] callback signature or decryption failed:', error);
      writeText(response, 401, 'unauthorized');
      return;
    }
    const message = parseWecomAppPlainMessage(plaintext);
    if (!message) {
      writeText(response, 400, 'invalid message');
      return;
    }
    this.#logger.info?.('[dsh-im:wecom-app] callback message accepted', route.botId, { msgtype: message.msgtype ?? null, msgid: message.msgid ?? null });
    this.#dispatch(route, message, envelope, response);
  }

  #readBody(request, response) {
    return new Promise((resolve) => {
      const chunks = [];
      let length = 0;
      request.on('data', (chunk) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        length += buffer.length;
        if (length > this.#maxBodyBytes) {
          writeText(response, 413, 'payload too large');
          request.destroy();
          resolve(null);
          return;
        }
        chunks.push(buffer);
      });
      request.on('end', () => {
        const raw = Buffer.concat(chunks, length).toString('utf8');
        if (!raw.trim()) {
          writeText(response, 400, 'empty payload');
          resolve(null);
          return;
        }
        resolve({ raw });
      });
      request.on('error', () => {
        resolve(null);
      });
    });
  }

  #dispatch(route, message, envelope, response) {
    const msgid = typeof message.msgid === 'string' ? message.msgid : null;
    const isStreamRefresh = message.msgtype === 'stream' || message.event === 'stream_refresh';
    if (isStreamRefresh) {
      const streamId = message.stream?.id ?? null;
      const stream = streamId ? this.#streams.get(streamId) : null;
      const snapshot = stream && stream.botId === route.botId ? this.streamSnapshot(streamId) : null;
      if (!snapshot) {
        writeEmpty(response);
        return;
      }
      stream.refreshes += 1;
      stream.updatedAt = Date.now();
      this.#replyEncrypted(route, envelope, response, {
        msgtype: 'stream',
        stream: snapshot,
      });
      return;
    }
    // WeCom retries an unanswered POST with the same MsgId; reply with the
    // current stream snapshot (including the final frame) so a client that
    // lost an earlier response can still settle on the finished content.
    const retryStreamId = msgid ? this.#streamByMsgId.get(this.#msgKey(route.botId, msgid)) : null;
    if (retryStreamId) {
      const snapshot = this.streamSnapshot(retryStreamId);
      if (snapshot) {
        this.#replyEncrypted(route, envelope, response, { msgtype: 'stream', stream: snapshot });
        return;
      }
      writeEmpty(response);
      return;
    }
    if (message.msgtype === 'event') {
      writeEmpty(response);
      route.onInbound({ kind: 'event', message }).catch((error) => {
        this.#logger.warn?.('[dsh-im:wecom-app] event handling failed:', error);
      });
      return;
    }
    let streamState = null;
    let streamEnabled = false;
    try {
      streamEnabled = route.streamEnabled?.() === true;
    } catch {
      streamEnabled = false;
    }
    if (streamEnabled && msgid && (message.msgtype === 'text' || message.msgtype === 'image')) {
      streamState = this.createStream({ botId: route.botId, msgid });
      this.#replyEncrypted(route, envelope, response, {
        msgtype: 'stream',
        stream: {
          id: streamState.streamId,
          finish: false,
          content: WECOM_APP_STREAM_PLACEHOLDER(),
        },
      });
    } else {
      writeEmpty(response);
    }
    route.onInbound({ kind: 'message', message, stream: streamState }).catch((error) => {
      this.#logger.warn?.('[dsh-im:wecom-app] message handling failed:', error);
      if (streamState) this.finishStream(streamState.streamId, { error: error?.message ?? String(error) });
    });
  }

  #replyEncrypted(route, envelope, response, payload) {
    let body;
    try {
      body = buildEncryptedReply({
        format: envelope.format,
        crypto: route.cryptoFor(),
        plaintext: payload,
        timestamp: envelope.timestamp,
        nonce: envelope.nonce,
      });
    } catch (error) {
      this.#logger.warn?.('[dsh-im:wecom-app] failed to encrypt the passive reply:', error);
      writeEmpty(response);
      return;
    }
    writeBody(response, 200, body, {
      'content-type': envelope.format === 'json'
        ? 'application/json; charset=utf-8'
        : 'application/xml; charset=utf-8',
    });
  }

  #pruneStreams() {
    const cutoff = Date.now() - this.#streamTtlMs;
    for (const [streamId, stream] of this.#streams.entries()) {
      if (stream.updatedAt < cutoff) {
        this.#streams.delete(streamId);
        if (stream.msgid) this.#streamByMsgId.delete(this.#msgKey(stream.botId, stream.msgid));
      }
    }
  }
}
