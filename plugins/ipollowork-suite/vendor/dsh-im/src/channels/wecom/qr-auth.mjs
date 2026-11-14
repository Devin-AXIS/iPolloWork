const GENERATE_URL = 'https://work.weixin.qq.com/ai/qc/generate';
const POLL_URL = 'https://work.weixin.qq.com/ai/qc/query_result';
const QR_TTL_MS = 5 * 60_000;
const POLL_INTERVAL_MS = 3_000;

function defaultPlatform() {
  if (process.platform === 'win32') return 2;
  if (process.platform === 'linux') return 3;
  return 1;
}

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeVerificationUrl(value) {
  const raw = cleanString(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.hostname === 'work.weixin.qq.com' && (!url.port || url.port === '443')
      ? url.href : null;
  } catch {
    return null;
  }
}

function combinedSignal(signal, timeoutMs) {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
}

async function requestJson(fetchImpl, url, signal) {
  const response = await fetchImpl(url, {
    method: 'GET',
    redirect: 'error',
    signal: combinedSignal(signal, 10_000),
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Enterprise WeChat QR service returned HTTP ${response.status}`);
  return response.json();
}

export class WecomQrAuth {
  #fetch;
  #clock;
  #source;
  #platform;

  constructor({
    fetch: fetchImpl = globalThis.fetch,
    clock = () => Date.now(),
    source = 'deepseek-harness',
    platform = defaultPlatform(),
  } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required');
    this.#fetch = fetchImpl;
    this.#clock = clock;
    this.#source = source;
    this.#platform = [1, 2, 3].includes(platform) ? platform : defaultPlatform();
  }

  async start({ signal } = {}) {
    const url = new URL(GENERATE_URL);
    url.searchParams.set('source', this.#source);
    url.searchParams.set('plat', String(this.#platform));
    const body = await requestJson(this.#fetch, url, signal);
    const scode = cleanString(body?.data?.scode);
    const verificationUrl = safeVerificationUrl(body?.data?.auth_url);
    if (!scode || !verificationUrl) throw new Error('Enterprise WeChat QR service returned invalid data');
    return {
      scode,
      verificationUrl,
      expiresAt: this.#clock() + QR_TTL_MS,
      pollIntervalMs: POLL_INTERVAL_MS,
    };
  }

  async poll({ scode, signal } = {}) {
    const code = cleanString(scode);
    if (!code) throw new TypeError('Enterprise WeChat QR poll code is required');
    const url = new URL(POLL_URL);
    url.searchParams.set('scode', code);
    const body = await requestJson(this.#fetch, url, signal);
    const state = cleanString(body?.data?.status)?.toLowerCase();
    if (state === 'success') {
      const remoteBotId = cleanString(body?.data?.bot_info?.botid);
      const secret = cleanString(body?.data?.bot_info?.secret);
      if (!remoteBotId || !secret) throw new Error('Enterprise WeChat QR result omitted bot credentials');
      return { status: 'success', remoteBotId, secret };
    }
    if (['expired', 'timeout'].includes(state)) return { status: 'expired' };
    if (['fail', 'failed', 'error'].includes(state)) return { status: 'failed' };
    return { status: 'waiting' };
  }
}
