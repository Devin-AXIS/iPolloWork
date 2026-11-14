// Shared by Host and Client: only explicitly admitted diagnostic facts cross the UI boundary.
const OPERATIONS = new Set([
  'bot.bind-credentials', 'bot.bind-native', 'bot.bind-mailbox', 'bot.mailbox.update', 'bot.auth.start', 'bot.auth.poll',
  'permissions.status', 'bot.session-binding.get', 'bot.session-binding.set', 'bot.session.list', 'connection.test', 'message.receive', 'message.send',
  'connector.configure', 'connector.reconnect', 'connector.test', 'connector.remove', 'startup', 'connection.restore', 'connection.monitor', 'connection.close', 'connection.status',
  'provision.begin', 'provision.poll', 'provision.verify', 'provision.cancel', 'bot.reconnect', 'bot.delete',
  'bot.workspace.set', 'bot.model.set', 'bot.agent-preset.set', 'bot.context-enhancement.set', 'bot.access-policy.set', 'bot.alias.set',
]);
const STAGES = new Set([
  'session.prepare', 'prompt.prepare', 'interaction.open', 'prompt.submit', 'reply.wait',
  'credential.verify', 'permission.check', 'sdk.load', 'operation', 'message.receive', 'message.send', 'connection.test', 'startup.load', 'qr.begin', 'qr.encode', 'qr.poll', 'qr.verify', 'qr.cancel', 'credential.read', 'credential.save', 'credential.remove',
  'account.save', 'account.remove', 'state.load', 'state.write', 'state.cleanup', 'workspace.write', 'workspace.cleanup',
  'runtime.prepare', 'activation', 'harness.check', 'connection.start', 'connection.poll', 'connection.stop', 'status.read', 'rollback', 'management.request',
]);
const REASONS = new Set([
  'session-log-corrupt',
  'stream-closed-before-open', 'stream-failed-before-open', 'stream-failed',
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT', 'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET',
  'CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_TLS_CERT_ALTNAME_INVALID', 'ERR_SSL_WRONG_VERSION_NUMBER',
  'ENOENT', 'EACCES', 'EPERM', 'ENOSPC', 'EROFS', 'ENOTDIR', 'EISDIR', 'EBUSY', 'EIO', 'EXDEV', 'EMFILE', 'ENFILE', 'EEXIST',
  'ERR_INVALID_ARG_TYPE', 'ERR_INVALID_ARG_VALUE', 'ERR_OUT_OF_RANGE', 'ERR_BUFFER_OUT_OF_BOUNDS',
  'ERR_ZLIB_INITIALIZATION_FAILED', 'ERR_STREAM_DESTROYED', 'ERR_STREAM_PREMATURE_CLOSE',
  'Z_STREAM_ERROR', 'Z_DATA_ERROR', 'Z_MEM_ERROR', 'Z_BUF_ERROR', 'Z_VERSION_ERROR',
  'MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND',
  'unknown', 'multiple-causes', 'timeout', 'http-error', 'provider-rejected', 'invalid-response', 'ERR_PROXY_CONNECTION_FAILED', 'ERR_TLS_HANDSHAKE_TIMEOUT', 'ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR', 'ERR_NETWORK_ACCESS_DENIED', 'AUTHENTICATIONFAILED', 'EAUTH', 'invalid-json', 'invalid-config', 'read-only',
]);
const RESOURCES = new Set(['credential-store', 'account-config', 'account-state', 'workspace-config', 'workspace-directory']);
const RPC_METHODS = new Set([
  'host.describe', 'workspace.list', 'workspace.create', 'session.list', 'session.create', 'session.adopt',
  'session.history', 'session.prompt', 'session.rename', 'session.cancel', 'session.models',
  'session.permissions', 'session.selectModel', 'llm.models',
]);
const TRANSPORTS = new Set(['host-api', 'http', 'websocket']);
const SUBMISSION_STATES = new Set(['not-submitted', 'accepted', 'unknown']);
const CONFIG_FILES = new Set(['config.json', 'workspaces.json']);
export const DIAGNOSTIC_ERROR_TYPES = new Set([
  'Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'AggregateError',
  'DOMException', 'AxiosError', 'TimeoutError', 'AbortError',
]);
export const CONFIG_ISSUE_LABELS = Object.freeze({
  'expected-object': '应为 JSON 对象。',
  'expected-array': '应为 JSON 数组。',
  'unsupported-version': '配置版本缺失或不受当前插件支持。',
  'invalid-string': '字段缺失或不是非空字符串。',
  'invalid-identifier': '标识符格式不符合要求。',
  'identity-mismatch': '标识符与 accountId 派生结果不一致。',
  'duplicate-identity': '账号标识重复。',
  'invalid-api-url': '微信服务地址不是有效 URL。',
  'untrusted-api-url': '微信服务地址必须使用受信任的 HTTPS 域名和端口。',
  'invalid-workspace-path': '工作区路径必须是当前操作系统的绝对路径。',
  'invalid-agent-preset': 'Agent Preset 标识无效。',
  'invalid-model-selection': '模型设置须包含有效的 provider、model 和可选 reasoningEffort。',
  'invalid-delivery-target': '投递目标的标识、结构或路由不符合当前配置版本要求。',
  'unexpected-field': '当前配置版本不允许此字段。',
});
// Only schema-owned field names and numeric entry positions may leave the Host.
// Map keys are replaced with zero-based positions to avoid exposing identities.
const CONFIG_FIELD = /^(?:\$|version|accounts(?:\[\d{1,10}\](?:\.(?:accountId|ownerUserId|botId|tokenRef|baseUrl))?)?|(?:workspaces|agentPresets|models)(?:\[\d{1,10}\]\.(?:key|value))?|deliveryTargets(?:\[\d{1,10}\]\.(?:key|targets(?:\[\d{1,10}\])?))?)$/;

// A local-library failure is often only distinguishable by its message:
// `QRCode.toDataURL is not a function` and `String required as first argument`
// are different bugs with identical error types and reasons. Free-form text is
// never forwarded; only messages that already look like a known local-library
// diagnostic are admitted, so a service error carrying a URL, a credential or a
// piece of user content stays out of the report entirely.
const DIAGNOSTIC_MESSAGE_SHAPES = [
  // `QRCode.toDataURL is not a function`, `PNG.sync.write is not a constructor`
  /^(?:[A-Za-z_$][\w$]*\.)*[A-Za-z_$][\w$]* is not a (?:function|constructor)$/u,
  // node-qrcode validating its argument
  /^String required as first argument$/u,
  // property access on undefined inside the encoder
  /^Cannot read propert(?:y|ies) .{1,100}$/u,
  // zlib: `invalid stored block lengths`, `incorrect header check`, `Invalid data`
  /^(?:invalid|incorrect|unexpected|unknown|bad)\s+[A-Za-z][A-Za-z0-9 _-]{2,80}$/iu,
  // pngjs / buffer: `padding not multiple of block size`, `buffer write failed`
  /^[A-Za-z][A-Za-z0-9 _-]{2,60}(?: not multiple of block size| failed)$/u,
];
const DIAGNOSTIC_MESSAGE_DENY = /(?:token|secret|password|passwd|authorization|bearer|cookie)/iu;
const DIAGNOSTIC_MESSAGE_URL = /\b(?:[a-z][a-z0-9+.-]*:\/\/)\S*/iu;
const DIAGNOSTIC_MESSAGE_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/u;
const DIAGNOSTIC_MESSAGE_OPAQUE = /\b[A-Za-z0-9_\-+/=]{32,}\b/u;

export function safeDiagnosticMessage(value) {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (!/^[\x20-\x7e]+$/u.test(text)) return undefined;
  if (!DIAGNOSTIC_MESSAGE_SHAPES.some(shape => shape.test(text))) return undefined;
  if (DIAGNOSTIC_MESSAGE_DENY.test(text)) return undefined;
  if (DIAGNOSTIC_MESSAGE_URL.test(text) || DIAGNOSTIC_MESSAGE_EMAIL.test(text)) return undefined;
  if (DIAGNOSTIC_MESSAGE_OPAQUE.test(text)) return undefined;
  return text;
}

export function normalizeDiagnosticDetails(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  for (const [field, allowed] of [['operation', OPERATIONS], ['stage', STAGES], ['reason', REASONS], ['resource', RESOURCES], ['method', RPC_METHODS], ['transport', TRANSPORTS], ['submissionState', SUBMISSION_STATES], ['lastFailureReason', REASONS]]) {
    if (allowed.has(value[field])) result[field] = value[field];
  }
  if (DIAGNOSTIC_CHANNELS.includes(value.channel)) result.channel = value.channel;
  if (Array.isArray(value.errorTypes)) {
    const errorTypes = [...new Set(value.errorTypes.filter(type => DIAGNOSTIC_ERROR_TYPES.has(type)))];
    if (errorTypes.length) result.errorTypes = errorTypes;
  }
  if (value.qrEncoder === 'qrcode') result.qrEncoder = value.qrEncoder;
  if (value.qrRenderer === 'png') result.qrRenderer = value.qrRenderer;
  if (Array.isArray(value.reasons)) {
    const reasons = [...new Set(value.reasons.filter(v => REASONS.has(v) && !['unknown', 'multiple-causes'].includes(v)))].slice(0, 16);
    if (reasons.length) result.reasons = reasons;
  }
  for (const field of ['durationMs', 'timeoutMs']) if (Number.isFinite(value[field]) && value[field] >= 0) result[field] = Math.round(value[field]);
  if (Number.isSafeInteger(value.attempts) && value.attempts >= 0) result.attempts = value.attempts;
  for (const field of ['nodeVersion', 'dshVersion']) if (typeof value[field] === 'string' && /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(value[field]) && value[field].length < 80) result[field] = value[field];
  if (['darwin', 'linux', 'win32', 'freebsd'].includes(value.platform)) result.platform = value.platform;
  if (['ilinkai.weixin.qq.com', 'oapi.dingtalk.com', 'api.dingtalk.com', 'api.telegram.org', 'discord.com', 'slack.com', 'open.feishu.cn', 'qyapi.weixin.qq.com'].includes(value.host)) result.host = value.host;
  if (value.dependencies && typeof value.dependencies === 'object') {
    const dependencies = {};
    for (const name of ['dingtalkStream', 'axios', 'httpsProxyAgent', 'agentBase', 'qrcode', 'pngjs', 'zlib']) {
      const version = value.dependencies[name];
      if (typeof version === 'string' && /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(version) && version.length <= 80) dependencies[name] = version;
    }
    if (Object.keys(dependencies).length) result.dependencies = dependencies;
  }
  if (typeof value.proxyConfigured === 'boolean') result.proxyConfigured = value.proxyConfigured;
  if (value.truncated === true) result.truncated = true;
  if (CONFIG_FILES.has(value.file)) result.file = value.file;
  if (typeof value.field === 'string' && CONFIG_FIELD.test(value.field)) result.field = value.field;
  if (typeof value.issue === 'string' && Object.hasOwn(CONFIG_ISSUE_LABELS, value.issue)) result.issue = value.issue;
  if (/^(?:(?:WX|DT|IM)-CONN|MF)-[A-F0-9]{8}$/.test(value.referenceId ?? '')) result.referenceId = value.referenceId;
  if (typeof value.occurredAt === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.occurredAt)
    && Number.isFinite(Date.parse(value.occurredAt))) result.occurredAt = value.occurredAt;
  if (Number.isInteger(value.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599) result.httpStatus = value.httpStatus;
  const provider = typeof value.providerCode === 'number' && Number.isSafeInteger(value.providerCode)
    ? String(value.providerCode) : value.providerCode;
  if (typeof provider === 'string' && /^-?\d{1,12}$/.test(provider)) result.providerCode = provider;
  if (typeof value.pluginVersion === 'string' && /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(value.pluginVersion)
    && value.pluginVersion.length <= 64) result.pluginVersion = value.pluginVersion;
  if (['succeeded', 'failed', 'not-attempted', 'unknown'].includes(value.rollback)) result.rollback = value.rollback;
  if (typeof value.causeMessage === 'string') {
    const message = safeDiagnosticMessage(value.causeMessage);
    if (message) result.causeMessage = message;
  }
  if (typeof value.hint === 'string' && value.hint.trim()) result.hint = value.hint.trim().slice(0, 500);
  return result;
}

export const DIAGNOSTIC_CHANNELS = Object.freeze(['weixin', 'feishu', 'dingtalk', 'wecom', 'qq', 'slack', 'telegram', 'discord', 'whatsapp', 'wecom-app', 'imessage', 'email', 'office']);

export function diagnosticFields(value) {
  if (!value?.details) return {};
  const details = normalizeDiagnosticDetails({ ...value?.details,
    referenceId: value?.details?.referenceId ?? value?.referenceId,
    hint: value?.details?.hint ?? value?.hint,
  });
  return Object.keys(details).length ? { details } : {};
}
