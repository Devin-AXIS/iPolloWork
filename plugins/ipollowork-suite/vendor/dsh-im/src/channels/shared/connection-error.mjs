import { randomUUID } from 'node:crypto';
import packageInfo from '../../../package.json' with { type: 'json' };
import { DIAGNOSTIC_ERROR_TYPES, normalizeDiagnosticDetails } from './diagnostic-details.mjs';
import { t } from './i18n.mjs';

const reported = new WeakMap();
const lastReport = new WeakMap();
const stages = new WeakMap();
const OWNED_REASONS = { 'harness-interaction-timeout': 'timeout', 'harness-response-invalid': 'invalid-response', 'connect-timeout': 'timeout', 'telegram-timeout': 'timeout', 'cli-timeout': 'timeout', 'provider-timeout': 'timeout', 'telegram-response-invalid': 'invalid-response', 'office-protocol-mismatch': 'invalid-response' };
const KNOWN_MESSAGES = {
  'discord-401': 'Discord Bot Token 无效，请重新填写。',
  'discord-intents': 'Discord Gateway Intents 配置不正确，请检查 Developer Portal 的 Bot 设置。',
  'webhook-configured': '该 Telegram 机器人已配置 Webhook，请先在原服务中移除 Webhook 后重试。',
  'invalid-device-token': 'AI Office Device Token 无效。',
  'office-hook-unavailable': 'AI Office Hook 尚未上线或地址不正确。',
  'messages-database-permission-required': '请在 macOS 系统设置中授予 DSH 完全磁盘访问权限，以读取 Messages 数据库。',
  'messages-automation-permission-required': '请在 macOS 系统设置中允许 DSH 自动控制 Messages。',
  'messages-permission-required': '先在 macOS 系统设置中授予 Messages 权限。',
};

/** Inspect a bounded error graph, including SDK aggregate failures. Never copy exception text. */
export function connectionErrorChain(error) {
  const queue = [error], seen = new Set(), chain = [];
  while (queue.length && chain.length < 16) {
    const entry = queue.shift();
    if (!entry || typeof entry !== 'object' || seen.has(entry)) continue;
    seen.add(entry);
    chain.push(entry);
    if (entry.cause && typeof entry.cause === 'object') queue.push(entry.cause);
    if (Array.isArray(entry.errors)) queue.push(...entry.errors.slice(0, 16));
  }
  return { chain, truncated: queue.some(e => e && typeof e === 'object' && !seen.has(e)) || chain.some(e => Array.isArray(e.errors) && e.errors.length > 16) };
}

export function extractConnectionEvidence(error) {
  const { chain, truncated } = connectionErrorChain(error);
  const errors = chain.map(e => ({
    type: DIAGNOSTIC_ERROR_TYPES.has(e.name) ? e.name : 'Error',
    // Host RPC adapters carry safe diagnostic facts without the original Error graph.
    ...normalizeDiagnosticDetails({
      reason: e.details?.reason, reasons: e.details?.reasons,
      httpStatus: e.details?.httpStatus, providerCode: e.details?.providerCode,
    }),
    ...normalizeDiagnosticDetails({
      // DOMException TimeoutError has a numeric legacy code; its name is authoritative.
      reason: OWNED_REASONS[e.code] ?? (e.name === 'TimeoutError' ? 'timeout' : e.code ?? (e instanceof SyntaxError ? 'invalid-json' : undefined)),
      httpStatus: e.status ?? e.statusCode ?? e.response?.status,
      providerCode: e.providerCode,
    }),
    hasCause: Boolean(e.cause && typeof e.cause === 'object'),
    hasErrors: Array.isArray(e.errors),
  }));
  const allReasons = [...new Set(errors.flatMap(e => e.reason === 'multiple-causes' ? e.reasons ?? [] : [e.reason]).filter(r => r && !['unknown', 'multiple-causes'].includes(r)))];
  const precise = allReasons.filter(r => !['timeout', 'http-error', 'provider-rejected', 'invalid-response'].includes(r));
  const reasons = precise.length ? precise : allReasons;
  const first = field => chain.map(e => normalizeDiagnosticDetails({ [field]: stages.get(e)?.[field] ?? e[field] ?? e.details?.[field] })[field]).find(v => v !== undefined);
  const correlation = {};
  for (const field of ['sessionId', 'promptRpcId']) {
    // Only locally attached identifiers belong in logs, never arbitrary RPC details.
    const value = chain.map(e => stages.get(e)?.[field]).find(v => v !== undefined);
    if (typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/u.test(value)) correlation[field] = value;
  }
  return {
    chain, errors, correlation,
    details: normalizeDiagnosticDetails({
      reason: reasons.length > 1 ? 'multiple-causes' : reasons[0] ?? 'unknown',
      ...(reasons.length > 1 ? { reasons } : {}),
      httpStatus: errors.find(e => e.httpStatus !== undefined)?.httpStatus,
      providerCode: errors.find(e => e.providerCode !== undefined)?.providerCode,
      method: first('method'), transport: first('transport'),
      stage: first('stage'), submissionState: first('submissionState'),
      attempts: first('attempts'), lastFailureReason: first('lastFailureReason'),
      durationMs: first('durationMs'), timeoutMs: first('timeoutMs'), host: first('host'), truncated,
    }),
  };
}

/** Keep request context off shared errors (for example a rejected model-catalog promise).
 * Preserve the original prototype, properties and cause for existing business handlers. */
export function messageDiagnosticError(cause, context) {
  if (cause?.name === 'AbortError') return cause;
  const source = cause && typeof cause === 'object' ? cause : new Error('Message processing failed');
  const error = source instanceof DOMException
    ? Object.defineProperties(new DOMException(source.message, source.name), Object.getOwnPropertyDescriptors(source))
    : Object.defineProperties(Object.setPrototypeOf(source instanceof Error ? new Error() : {}, Object.getPrototypeOf(source)),
      Object.getOwnPropertyDescriptors(source));
  stages.set(error, { ...context, ...stages.get(source) });
  return error;
}

export function runtimeDiagnosticDetails() {
  return { pluginVersion: packageInfo.version, nodeVersion: process.versions.node, platform: process.platform };
}

export async function atConnectionStage(stage, operation, resource) {
  try { return await operation(); }
  catch (error) { throw connectionStageError(error, stage, resource); }
}

export function connectionStageError(cause, stage, resource, details = {}) {
  if (!cause || typeof cause !== 'object') cause = new Error('Operation failed');
  if (!stages.has(cause)) stages.set(cause, normalizeDiagnosticDetails({ ...details, stage, resource }));
  return cause;
}

/** Reuse the Controller's report when the same exception reaches RPC. */
export function reportedConnectionError(error) {
  return connectionErrorChain(error).chain.map(e => reported.get(e) ?? lastReport.get(e)).find(Boolean);
}

export function diagnosticRpcResult(diagnostics, cause, result, context) {
  if (cause?.name === 'AbortError') return { ok: false, error: { code: 'cancelled', message: t('操作已取消。'), details: {} } };
  if (result?.ok !== false || ['cancelled', 'bad-request'].includes(result.error?.code)) return result;
  const error = reportedConnectionError(cause) ?? diagnostics.report(cause, { ...context, publicError: result.error });
  return { ...result, error: context?.untrustedPublicError ? error.publicError : { ...error.publicError, ...result.error, details: error.publicError.details } };
}

export function connectionHint(details) {
  if (details.stage === 'qr.encode') return t('本机二维码图片生成失败，请重试；若持续失败，请复制诊断信息并检查 DSH 运行环境。');
  const r = details.reason;
  if (r === 'multiple-causes') return t('检测到多个底层原因，请展开诊断详情逐项检查。');
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(r)) return t('服务域名解析失败，请检查运行 DSH 的机器的 DNS 和网络设置。');
  if (r === 'ECONNREFUSED') return t('目标拒绝连接，请检查服务地址、端口和访问限制。');
  if (['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET'].includes(r)) return t('连接已中断，请检查网络和目标服务状态。');
  if (['ENETUNREACH', 'EHOSTUNREACH', 'ERR_NETWORK_ACCESS_DENIED'].includes(r)) return t('目标网络不可达，请检查运行 DSH 的机器的网络出口和访问限制。');
  if (/CERT|TLS|SSL|ISSUER|SIGNATURE/.test(r ?? '')) return t('TLS 或证书校验失败，请检查系统时间、证书链和网络设置。');
  if (/TIMEOUT/.test(r ?? '') || r === 'ETIMEDOUT' || r === 'timeout') return t('请求超时，请检查目标服务和网络；诊断详情中可查看已知的耗时。');
  if (r === 'ERR_PROXY_CONNECTION_FAILED' || details.httpStatus === 407) return t('代理连接或认证失败，请检查 DSH 进程使用的代理配置。');
  if (['EAUTH', 'AUTHENTICATIONFAILED'].includes(r)) return t('服务认证失败，请检查账号和授权信息。');
  if (['EACCES', 'EPERM', 'EROFS'].includes(r)) return t('操作权限不足，请检查对应资源的访问权限。');
  if (r === 'ENOSPC') return t('磁盘空间不足，请释放空间后重试。');
  if (r === 'ENOENT') return t('所需文件或本地工具不存在，请检查安装和配置。');
  if (r === 'invalid-json' || r === 'invalid-response') return t('数据格式无效，请按失败阶段检查服务响应或本地配置。');
  if (details.httpStatus === 429) return t('服务正在限流，请稍后重试。');
  if ([401, 403].includes(details.httpStatus)) return t('服务拒绝了请求，请检查凭据、权限或访问限制；HTTP 状态本身不能确认登录失效。');
  if (details.httpStatus >= 500) return t('目标服务暂时异常，请稍后重试。');
  if (details.httpStatus) return t('目标服务返回了 HTTP 错误，请查看诊断详情。');
  return t('暂未识别具体原因，请复制诊断信息，并查看相同参考号的 DSH 日志。');
}

export function operationStage(operation) {
  return ({ 'connector.test': 'connection.test', 'connector.configure': 'credential.verify', 'connector.reconnect': 'connection.start', 'connector.remove': 'account.remove', startup: 'startup.load', 'connection.restore': 'connection.start', 'connection.monitor': 'connection.poll',
    'connection.status': 'status.read', 'connection.close': 'connection.stop', 'provision.begin': 'qr.begin',
    'provision.poll': 'qr.poll', 'provision.verify': 'qr.verify', 'bot.auth.start': 'qr.begin', 'bot.auth.poll': 'qr.poll',
    'bot.reconnect': 'connection.start', 'bot.delete': 'account.remove', 'permissions.status': 'permission.check',
    'bot.bind-credentials': 'credential.verify', 'bot.bind-mailbox': 'credential.verify', 'bot.bind-native': 'permission.check',
    'connection.test': 'connection.test', 'message.send': 'message.send', 'message.receive': 'message.receive',
  })[operation] ?? 'operation';
}

/** One reporter per channel owner. Existing safe business guidance can be supplied as publicError. */
export function createConnectionDiagnostics({ channel, logger = console, now = Date.now, prefix = 'IM-CONN', describe } = {}) {
  const recent = new Map();
  const write = (level, record) => { try { logger[level]?.(`[dsh-${channel}] ${JSON.stringify(record)}`); } catch { /* Logging cannot break an operation. */ } };
  function report(cause, context = {}) {
    if (reported.has(cause)) return cause;
    if (context.reuse && reportedConnectionError(cause)) return reportedConnectionError(cause);
    const evidence = extractConnectionEvidence(cause);
    const prior = evidence.chain.map(e => reported.get(e)).find(Boolean);
    if (prior) return prior;
    const described = describe?.(cause, context, evidence) ?? {};
    const known = evidence.chain.find(e => Object.hasOwn(KNOWN_MESSAGES, e.code ?? ''));
    let safe = described.publicError ?? context.publicError ?? {};
    if (known && !safe.code?.startsWith('stream-')) safe = { ...safe, code: known.code, message: t(KNOWN_MESSAGES[known.code]) };
    // These legacy handlers used exception messages as their public error. Keep only owned guidance.
    if (['email', 'imessage', 'office'].includes(channel) && !known && context.untrustedPublicError) {
      safe = { code: `${channel}-operation-failed`, message: t('操作失败，请查看原因和诊断详情。') };
    }
    const owned = evidence.chain.map(e => stages.get(e)).find(Boolean) ?? {};
    const details = normalizeDiagnosticDetails({
      ...evidence.details, ...context, ...safe.details, ...described.details, ...owned,
      channel, stage: owned.stage ?? described.details?.stage ?? safe.details?.stage ?? context.stage ?? operationStage(context.operation),
      ...runtimeDiagnosticDetails(),
    });
    const code = safe.code ?? context.code ?? `${channel}-operation-failed`;
    const hint = described.hint ?? safe.hint ?? safe.details?.hint ?? connectionHint(details);
    const message = t(safe.message) ?? t('操作失败，请查看原因和诊断详情。');
    const key = JSON.stringify([context.botId, context.attemptId, details.operation, details.stage, code, details.reason, details.reasons, details.httpStatus, details.providerCode, details.resource, details.file, details.field, details.issue]);
    const previous = recent.get(key), time = now();
    const wrap = publicError => {
      const error = new Error(publicError.message, { cause });
      error.code = publicError.code;
      error.publicError = structuredClone(publicError);
      reported.set(error, error);
      if (cause && typeof cause === 'object') lastReport.set(cause, error);
      return error;
    };
    if (context.automatic && previous && time - previous.time < 60_000) {
      previous.retries += 1;
      return wrap(previous.publicError);
    }
    if (previous?.retries) write('warn', { event: 'connection-retries', referenceId: previous.publicError.details.referenceId, retries: previous.retries });
    details.referenceId = normalizeDiagnosticDetails({ referenceId: safe.referenceId }).referenceId ?? `${prefix}-${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`;
    details.occurredAt = new Date(time).toISOString();
    details.hint = hint;
    const publicError = { code, message, details };
    if (context.automatic) {
      if (recent.size >= 128) recent.delete(recent.keys().next().value);
      recent.set(key, { time, publicError, retries: 0, botId: context.botId });
    }
    write(context.warning ? 'warn' : 'error', {
      event: context.warning ? 'connection-warning' : 'connection-failure', code, ...details,
      errors: evidence.errors,
      ...(normalizeDiagnosticDetails({ referenceId: context.parentReferenceId }).referenceId ? { parentReferenceId: context.parentReferenceId } : {}),
    });
    return wrap(publicError);
  }
  function clear(botId) {
    for (const [key, entry] of recent) {
      if (botId !== undefined && entry.botId !== botId) continue;
      if (entry.retries) write('info', { event: 'connection-retries', referenceId: entry.publicError.details.referenceId, retries: entry.retries });
      recent.delete(key);
    }
  }
  function outcome(error, rollback) {
    if (!reported.has(error)) return;
    if (!normalizeDiagnosticDetails({ rollback }).rollback) return;
    error.publicError.details.rollback = rollback;
    error.publicError.details.hint = rollback === 'succeeded' ? t('操作未完成，已恢复之前的本机状态。请处理上述问题后重试。') : t('原账号状态尚未确认，请重新读取状态，并反馈诊断信息。');
    write('info', { event: 'connection-outcome', referenceId: error.publicError.details.referenceId, rollback });
  }
  return { report, clear, outcome };
}
