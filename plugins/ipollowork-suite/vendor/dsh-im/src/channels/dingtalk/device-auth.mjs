const DEFAULT_REGISTRATION_BASE_URL = 'https://oapi.dingtalk.com';
const REGISTRATION_SOURCE = 'DING_DWS_CLAW';

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeBaseUrl(value) {
  let url;
  try {
    url = new URL(cleanString(value) ?? DEFAULT_REGISTRATION_BASE_URL);
  } catch {
    throw new TypeError('DingTalk registration base URL must be a valid HTTPS URL');
  }
  const isDingtalkHost = url.hostname === 'dingtalk.com' || url.hostname.endsWith('.dingtalk.com');
  if (url.protocol !== 'https:'
    || url.port
    || !isDingtalkHost
    || url.username
    || url.password
    || url.search
    || url.hash) {
    throw new TypeError('DingTalk registration base URL must be a valid HTTPS URL');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.href.replace(/\/$/, '');
}

function readNow(clock) {
  const value = typeof clock?.now === 'function' ? clock.now() : clock();
  if (!Number.isFinite(value)) throw new TypeError('clock must return a finite timestamp');
  return value;
}

function assertRecord(value, action) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DingtalkDeviceAuthError(
      'invalid-response',
      `DingTalk ${action} returned an invalid response`,
      action,
    );
  }
  if (Number(value.errcode) !== 0) {
    throw new DingtalkDeviceAuthError(
      'api-error',
      `DingTalk ${action} request was rejected`,
      action,
    );
  }
  return value;
}

/** A sanitized DingTalk device-registration failure. */
export class DingtalkDeviceAuthError extends Error {
  /**
   * @param {string} code Stable failure code.
   * @param {string} message Safe diagnostic that does not include response credentials.
   * @param {string} action Registration stage that failed.
   * @param {{cause?: unknown}} [options] Optional underlying error.
   */
  constructor(code, message, action, options = {}) {
    super(message, options);
    this.name = 'DingtalkDeviceAuthError';
    this.code = code;
    this.action = action;
    if (Number.isInteger(options.status)) this.status = options.status;
    if (Number.isFinite(options.timeoutMs)) this.timeoutMs = options.timeoutMs;
  }
}

/** Host-only client for DingTalk's QR device-registration flow. */
export class DingtalkDeviceAuth {
  #fetch;
  #clock;
  #baseUrl;
  #timeoutMs;

  /**
   * @param {{fetch?: typeof globalThis.fetch, clock?: {now(): number}|(()=>number), baseUrl?: string, timeoutMs?: number}} [options]
   * Device-registration dependencies.
   */
  constructor({
    fetch = globalThis.fetch,
    clock = Date,
    baseUrl = DEFAULT_REGISTRATION_BASE_URL,
    timeoutMs = 15_000,
  } = {}) {
    if (typeof fetch !== 'function') throw new TypeError('fetch is required');
    if (typeof clock !== 'function' && typeof clock?.now !== 'function') {
      throw new TypeError('clock must be a function or expose now()');
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new TypeError('timeoutMs must be a positive number');
    }
    this.#fetch = fetch;
    this.#clock = clock;
    this.#baseUrl = normalizeBaseUrl(baseUrl);
    this.#timeoutMs = timeoutMs;
  }

  /**
   * Starts a QR registration and returns the host-only device code with QR metadata.
   * @param {{signal?: AbortSignal}} [options] Optional cancellation signal.
   * @returns {Promise<object>} Device registration details.
   */
  async start({ signal } = {}) {
    const initialized = await this.#post(
      '/app/registration/init',
      { source: REGISTRATION_SOURCE },
      'initialization',
      signal,
    );
    const nonce = cleanString(initialized.nonce);
    if (!nonce) {
      throw new DingtalkDeviceAuthError(
        'missing-nonce',
        'DingTalk registration initialization did not return a nonce',
        'initialization',
      );
    }

    const begun = await this.#post(
      '/app/registration/begin',
      { nonce },
      'begin',
      signal,
    );
    const deviceCode = cleanString(begun.device_code);
    const verificationUrl = cleanString(begun.verification_uri_complete);
    if (!deviceCode || !verificationUrl) {
      throw new DingtalkDeviceAuthError(
        'incomplete-registration',
        'DingTalk registration did not return complete QR metadata',
        'begin',
      );
    }

    const expiresInSeconds = positiveNumber(begun.expires_in, 7_200);
    const pollIntervalMs = positiveNumber(begun.interval, 5) * 1_000;
    return Object.freeze({
      deviceCode,
      verificationUrl,
      verificationUri: cleanString(begun.verification_uri),
      userCode: cleanString(begun.user_code),
      expiresAt: readNow(this.#clock) + expiresInSeconds * 1_000,
      pollIntervalMs,
    });
  }

  /**
   * Polls one registration attempt.
   * @param {{deviceCode: string, signal?: AbortSignal}|string} request Host-only device code.
   * @returns {Promise<object>} Normalized registration state and credentials on success.
   */
  async poll(request) {
    const deviceCode = cleanString(typeof request === 'string' ? request : request?.deviceCode);
    const signal = typeof request === 'object' ? request?.signal : undefined;
    if (!deviceCode) throw new TypeError('deviceCode is required');
    const response = await this.#post(
      '/app/registration/poll',
      { device_code: deviceCode },
      'poll',
      signal,
    );
    const rawStatus = cleanString(response.status)?.toUpperCase();
    const status = ['WAITING', 'SUCCESS', 'FAIL', 'EXPIRED'].includes(rawStatus)
      ? rawStatus
      : 'UNKNOWN';
    return Object.freeze({
      status,
      clientId: cleanString(response.client_id),
      clientSecret: cleanString(response.client_secret),
      failReason: cleanString(response.fail_reason),
    });
  }

  async #post(path, body, action, signal) {
    let response;
    const timeoutSignal = AbortSignal.timeout(this.#timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: requestSignal,
      });
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      if (timeoutSignal.aborted) {
        throw new DingtalkDeviceAuthError(
          'timeout',
          `DingTalk ${action} request timed out`,
          action,
          { cause: error, timeoutMs: this.#timeoutMs },
        );
      }
      if (error?.name === 'AbortError') throw error;
      throw new DingtalkDeviceAuthError(
        'network-error',
        `DingTalk ${action} request could not be completed`,
        action,
        { cause: error },
      );
    }
    if (!response || response.ok === false || typeof response.json !== 'function') {
      throw new DingtalkDeviceAuthError(
        'http-error',
        `DingTalk ${action} request failed`,
        action,
        { status: response?.status },
      );
    }
    let value;
    try {
      value = await response.json();
    } catch (error) {
      throw new DingtalkDeviceAuthError(
        'invalid-json',
        `DingTalk ${action} returned invalid JSON`,
        action,
        { cause: error },
      );
    }
    return assertRecord(value, action);
  }
}

export { DEFAULT_REGISTRATION_BASE_URL, REGISTRATION_SOURCE };
export { DingtalkDeviceAuth as DingTalkDeviceAuth };
export { DingtalkDeviceAuthError as DingTalkDeviceAuthError };
