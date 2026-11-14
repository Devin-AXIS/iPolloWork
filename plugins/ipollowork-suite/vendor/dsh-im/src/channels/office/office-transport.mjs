import { OFFICE_HOOK_PATHS, OFFICE_PROTOCOL_VERSION, officeHookUrls } from './protocol.mjs';

function safeTransportError(operation, response) {
  const error = new Error(`AI Office ${operation} failed: HTTP ${response.status}`);
  error.status = response.status;
  error.code = response.status === 401 ? 'invalid-device-token'
    : response.status === 404 ? 'office-hook-unavailable'
      : response.status === 409 ? 'office-job-conflict' : 'office-transport-failed';
  return error;
}

function transportFailure(message, code = 'office-transport-failed', cause) {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  error.code = code;
  return error;
}

function isAbort(error, signal) {
  return signal?.aborted || error?.name === 'AbortError';
}

function parseFrame(frame) {
  let type = 'message';
  let id;
  const data = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith('event:')) type = line.slice(6).trim() || 'message';
    else if (line.startsWith('id:')) id = line.slice(3).trim() || undefined;
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  if (data.length === 0) return null;
  let value;
  try { value = JSON.parse(data.join('\n')); } catch { throw new Error('AI Office SSE returned invalid JSON'); }
  return { id, type: typeof value?.type === 'string' ? value.type : type, data: value };
}

export class OfficeTransport {
  #baseUrl;
  #deviceId;
  #token;
  #fetch;

  constructor({ baseUrl, deviceId, token, fetchImpl = fetch }) {
    this.#baseUrl = baseUrl;
    this.#deviceId = deviceId;
    this.#token = token;
    this.#fetch = fetchImpl;
  }

  hooks() { return officeHookUrls(this.#baseUrl); }

  #headers(extra = {}) {
    return {
      authorization: `Bearer ${this.#token}`,
      'x-harness-device-id': this.#deviceId,
      ...extra,
    };
  }

  async heartbeat(payload, { signal } = {}) {
    let response;
    try {
      response = await this.#fetch(new URL(OFFICE_HOOK_PATHS.heartbeat, this.#baseUrl), {
        method: 'POST',
        headers: this.#headers({ accept: 'application/json', 'content-type': 'application/json' }),
        body: JSON.stringify(payload),
        signal,
        redirect: 'error',
      });
    } catch (error) {
      if (isAbort(error, signal)) throw error;
      throw transportFailure('AI Office heartbeat request could not be completed', undefined, error);
    }
    if (!response.ok) throw safeTransportError('heartbeat', response);
    let value;
    try { value = await response.json(); }
    catch (error) { throw transportFailure('AI Office heartbeat returned invalid JSON', 'office-protocol-mismatch', error); }
    if (!value || typeof value !== 'object' || value.ok !== true
      || value.protocolVersion !== OFFICE_PROTOCOL_VERSION) {
      throw transportFailure('AI Office heartbeat protocol does not match', 'office-protocol-mismatch');
    }
    return value;
  }

  async #jobRequest(path, { method = 'POST', body, leaseToken, signal } = {}) {
    const headers = this.#headers({ accept: 'application/json' });
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (leaseToken) headers['x-harness-lease-token'] = leaseToken;
    let response;
    try {
      response = await this.#fetch(new URL(path, this.#baseUrl), {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal,
        redirect: 'error',
        cache: 'no-store',
      });
    } catch (error) {
      if (isAbort(error, signal)) throw error;
      throw transportFailure('AI Office Job request could not be completed', undefined, error);
    }
    if (!response.ok) throw safeTransportError('Job request', response);
    try { return await response.json(); }
    catch (error) { throw transportFailure('AI Office Job returned invalid JSON', 'office-protocol-mismatch', error); }
  }

  async getJob(jobId, options = {}) {
    return this.#jobRequest(OFFICE_HOOK_PATHS.job.replace(':id', jobId), { ...options, method: 'GET' });
  }

  async acceptJob(jobId, options = {}) {
    return this.#jobRequest(OFFICE_HOOK_PATHS.accept.replace(':id', jobId), options);
  }

  async renewJob(jobId, leaseToken, options = {}) {
    return this.#jobRequest(OFFICE_HOOK_PATHS.renew.replace(':id', jobId), { ...options, leaseToken });
  }

  async progressJob(jobId, leaseToken, body, options = {}) {
    return this.#jobRequest(OFFICE_HOOK_PATHS.progress.replace(':id', jobId), { ...options, leaseToken, body });
  }

  async requestApproval(jobId, leaseToken, body, options = {}) {
    return this.#jobRequest(OFFICE_HOOK_PATHS.approval.replace(':id', jobId), { ...options, leaseToken, body });
  }

  async completeJob(jobId, leaseToken, body, options = {}) {
    return this.#jobRequest(OFFICE_HOOK_PATHS.result.replace(':id', jobId), { ...options, leaseToken, body });
  }

  async failJob(jobId, leaseToken, body, options = {}) {
    return this.#jobRequest(OFFICE_HOOK_PATHS.fail.replace(':id', jobId), { ...options, leaseToken, body });
  }

  async stream({ signal, lastEventId, onOpen, onEvent }) {
    const headers = this.#headers({ accept: 'text/event-stream' });
    if (lastEventId) headers['last-event-id'] = lastEventId;
    let response;
    try {
      response = await this.#fetch(new URL(OFFICE_HOOK_PATHS.stream, this.#baseUrl), {
        method: 'GET', headers, signal, redirect: 'error', cache: 'no-store',
      });
    } catch (error) {
      if (isAbort(error, signal)) throw error;
      throw transportFailure('AI Office SSE request could not be completed', undefined, error);
    }
    if (!response.ok) throw safeTransportError('stream', response);
    if (!response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) {
      throw new Error('AI Office stream did not return text/event-stream');
    }
    if (!response.body) throw new Error('AI Office stream returned no body');
    onOpen?.();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer = `${buffer}${decoder.decode(value, { stream: true })}`.replaceAll('\r\n', '\n');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = parseFrame(raw);
        if (event) await onEvent?.(event);
      }
    }
    throw new Error('AI Office SSE stream ended');
  }
}
