import { setTimeout as delay } from 'node:timers/promises';

export const MODEL = 'jev-latest';
const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const REQUEST_BYTES = 256 * 1024;
const RESPONSE_BYTES = 1024 * 1024;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const content = value => typeof value === 'string' ? value.trim().length > 0 : record(value) || Array.isArray(value);
const probability = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };

/** Validate once at the shared boundary; neither adapter may weaken the contract. */
export function requestBody(input) {
  requireValue(record(input) && Object.keys(input).every(key => ['state', 'questions'].includes(key)), '只接受 state 和 questions。');
  requireValue(content(input.state), 'state 必须是非空文本、对象或数组。');
  requireValue(record(input.questions), 'questions 必须是问题 ID 到问题对象的映射。');
  const questions = Object.entries(input.questions);
  requireValue(questions.length >= 1 && questions.length <= 64, '每次评估需要 1–64 个问题。');
  for (const [id, question] of questions) {
    requireValue(id.trim().length > 0 && id.length <= 160, '问题 ID 需要 1–160 个字符。');
    requireValue(record(question) && Object.keys(question).every(key => ['type', 'instructions', 'criteria'].includes(key)), '问题只接受 type、instructions 和 criteria。');
    requireValue(content(question.instructions), '每个问题需要完整的 instructions。');
    const criteria = question.criteria;
    if (question.type === 'choice') {
      requireValue(record(criteria), 'choice.criteria 必须是候选项映射。');
      const options = Object.entries(criteria);
      requireValue(options.length >= 2 && options.length <= 255, 'choice 需要 2–255 个候选项。');
      requireValue(options.every(([key, value]) => key.trim() && (value === null || content(value))), 'choice 候选需要有效 ID 和描述。');
    } else if (question.type === 'score') {
      requireValue(Array.isArray(criteria) && criteria.length >= 2 && criteria.length <= 10 && criteria.every(content), 'score.criteria 需要 2–10 个从低到高的等级描述。');
    } else if (question.type === 'noul') {
      requireValue(criteria === undefined || (record(criteria) && Object.entries(criteria).every(([key, value]) => ['true', 'false'].includes(key) && content(value))), 'noul.criteria 只能包含 true 和 false 的描述。');
    } else {
      throw new Error('问题类型必须是 choice、score 或 noul。');
    }
  }
  let body;
  try {
    body = JSON.stringify({ state: input.state, questions: input.questions, model: MODEL }, (_key, value) => {
      if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || (typeof value === 'number' && !Number.isFinite(value))) throw new Error();
      return value;
    });
  } catch {
    throw new Error('评估内容必须是可序列化的 JSON。');
  }
  requireValue(Buffer.byteLength(body) <= REQUEST_BYTES, '评估请求超过 256 KiB，请只保留与判断相关的上下文。');
  return body;
}

function responseValue(value, questions) {
  const invalid = 'Jev 返回了不完整或无效的结构化结果，请重试。';
  requireValue(record(value) && typeof value.model === 'string' && record(value.answers), invalid);
  const answers = Object.fromEntries(Object.entries(questions).map(([id, question]) => {
    const answer = Object.hasOwn(value.answers, id) ? value.answers[id] : null;
    requireValue(record(answer) && answer.type === question.type, invalid);
    if (answer.type === 'noul') {
      requireValue(probability(answer.noul), invalid);
      return [id, { type: 'noul', noul: answer.noul }];
    }
    const levels = question.type === 'choice' ? Object.keys(question.criteria) : question.criteria.map((_item, index) => String(index));
    requireValue(probability(answer.confidence) && record(answer.probabilities), invalid);
    requireValue(Object.keys(answer.probabilities).length === levels.length && levels.every(key => Object.hasOwn(answer.probabilities, key) && probability(answer.probabilities[key])), invalid);
    requireValue(Math.abs(Object.values(answer.probabilities).reduce((sum, item) => sum + item, 0) - 1) < 0.02, invalid);
    const shared = { type: answer.type, confidence: answer.confidence, probabilities: answer.probabilities };
    if (answer.type === 'choice') {
      requireValue(typeof answer.choice === 'string' && levels.includes(answer.choice), invalid);
      return [id, { ...shared, choice: answer.choice }];
    }
    requireValue(Number.isFinite(answer.score) && answer.score >= 0 && answer.score <= levels.length - 1, invalid);
    requireValue(record(answer.legend) && Object.keys(answer.legend).length === levels.length && levels.every(key => Object.hasOwn(answer.legend, key) && content(answer.legend[key])), invalid);
    return [id, { ...shared, score: answer.score, legend: answer.legend }];
  }));
  requireValue(record(value.usage) && ['input_tokens', 'output_tokens'].every(key => Number.isSafeInteger(value.usage[key]) && value.usage[key] >= 0), invalid);
  return { provider: 'TypeSafe AI', model: value.model, answers, usage: { input_tokens: value.usage.input_tokens, output_tokens: value.usage.output_tokens } };
}

async function readResponse(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Jev 返回了空响应。');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      requireValue(size <= RESPONSE_BYTES, 'Jev 响应过大，请减少评估问题。');
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Jev 返回了无法解析的响应。'); }
}

/** Host-owned key lookup is performed for every call; keys and payloads are never logged. */
export function createJevActions({ getApiKey, fetcher = globalThis.fetch, timeoutMs = 20_000 }) {
  requireValue(Number.isFinite(timeoutMs) && timeoutMs > 0, 'timeoutMs 必须大于 0。');
  const lifetime = new AbortController();
  const apiKey = async () => {
    const value = await getApiKey();
    requireValue(typeof value === 'string' && value.trim() && !/[\r\n]/.test(value), '请先在插件授权中配置 TypeSafe API Key；DSH 使用 TYPESAFE_API_KEY 凭据。');
    return value.trim();
  };
  const evaluate = async (input, options = {}) => {
    const body = requestBody(input);
    const key = await apiKey();
    const deadline = AbortSignal.timeout(timeoutMs);
    const signal = AbortSignal.any([lifetime.signal, deadline, ...(options.signal ? [options.signal] : [])]);
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        signal.throwIfAborted();
        const response = await fetcher(ENDPOINT, {
          method: 'POST', redirect: 'error', signal,
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body,
        });
        if (response.ok) return responseValue(await readResponse(response), JSON.parse(body).questions);
        await response.body?.cancel();
        if ([429, 529].includes(response.status) && attempt < 2) {
          const retry = response.headers.get('retry-after');
          const seconds = retry === null ? NaN : Number(retry);
          const backoff = Number.isFinite(seconds) ? seconds * 1000 : retry ? Date.parse(retry) - Date.now() : 250 * (2 ** attempt);
          if (backoff > timeoutMs) throw new Error('Jev 暂时繁忙，请稍后重试。');
          await delay(Math.max(250 * (2 ** attempt), Number.isFinite(backoff) ? backoff : 0), undefined, { signal });
          continue;
        }
        if (response.status === 401) throw new Error('Jev API Key 无效，请重新连接。');
        if (response.status === 422) throw new Error('Jev 不接受此评估请求，请检查问题和判断标准。');
        if ([429, 529].includes(response.status)) throw new Error('Jev 暂时繁忙，请稍后重试。');
        throw new Error(`Jev 请求失败（HTTP ${response.status}）。`);
      }
    } catch (error) {
      if (lifetime.signal.aborted || options.signal?.aborted) throw new Error('Jev 评估已取消。');
      if (deadline.aborted) throw new Error('Jev 评估超时，请稍后重试。');
      // Never forward arbitrary network errors or upstream response bodies: they may contain credentials.
      if (error instanceof Error && error.message.startsWith('Jev ') && !error.message.includes(key)) throw error;
      throw new Error('Jev 网络请求失败，请检查网络连接。');
    }
  };
  return {
    dispose: () => lifetime.abort(),
    actions: {
      status: async () => ({ provider: 'TypeSafe AI', model: MODEL, configured: Boolean((await getApiKey())?.trim()), remoteVerified: false, primitives: ['choice', 'score', 'noul'] }),
      'check-connection': async (_input = {}, options = {}) => {
        const result = await evaluate({ state: 'Connection check.', questions: { connected: { type: 'noul', instructions: 'Does this text describe a connection check?' } } }, options);
        return { connected: true, provider: result.provider, model: result.model, usage: result.usage };
      },
      evaluate,
    },
  };
}
