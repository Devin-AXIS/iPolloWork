import { connectionErrorChain, connectionStageError } from '../shared/connection-error.mjs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

import { t } from '../shared/i18n.mjs';

const require = createRequire(import.meta.url);
const STAGE_CODES = new Set([
  'dingtalk-harness-connect-failed',
  'dingtalk-runtime-prepare-failed',
  'dingtalk-stream-client-load-failed',
  'dingtalk-stream-listener-failed',
  'dingtalk-stream-connect-failed',
]);
const PROXY_VARIABLES = Object.freeze([
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'ALL_PROXY',
  'all_proxy',
]);
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;
const PUBLIC_REFERENCE_PATTERN = /^DT-CONN-[A-F0-9]{8}$/;
let installedDependencyVersions;

function nonEmptyString(value, maxLength = 500) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text.slice(0, maxLength) : null;
}

function safeVersion(value) {
  const version = nonEmptyString(value, 80);
  return version && VERSION_PATTERN.test(version) ? version : null;
}

function resolvedPackage(name, from = require) {
  try {
    const packagePath = from.resolve(`${name}/package.json`);
    return {
      version: safeVersion(from(packagePath)?.version),
      require: createRequire(packagePath),
    };
  } catch {
    return null;
  }
}

/** Returns only non-sensitive versions involved in the external DingTalk Stream dependency chain. */
export function installedDingtalkConnectionDependencies() {
  if (installedDependencyVersions) return installedDependencyVersions;
  const dingtalkStream = resolvedPackage('dingtalk-stream');
  const axios = dingtalkStream ? resolvedPackage('axios', dingtalkStream.require) : null;
  const httpsProxyAgent = axios ? resolvedPackage('https-proxy-agent', axios.require) : null;
  const agentBase = httpsProxyAgent ? resolvedPackage('agent-base', httpsProxyAgent.require) : null;
  installedDependencyVersions = Object.freeze({
    dingtalkStream: dingtalkStream?.version ?? null,
    axios: axios?.version ?? null,
    httpsProxyAgent: httpsProxyAgent?.version ?? null,
    agentBase: agentBase?.version ?? null,
  });
  return installedDependencyVersions;
}

function errorChain(error) { return connectionErrorChain(error).chain; }

function statusFrom(error) {
  if (Number.isInteger(error?.status)) return error.status;
  if (Number.isInteger(error?.statusCode)) return error.statusCode;
  if (Number.isInteger(error?.response?.status)) return error.response.status;
  return null;
}

function providerCodeFrom(error) {
  const value = nonEmptyString(
    error?.providerCode
      ?? error?.response?.data?.code
      ?? error?.response?.data?.errorCode
      ?? error?.response?.data?.errcode,
    100,
  );
  return value && /^[A-Za-z0-9_.:-]+$/.test(value) ? value : null;
}

function redactMessage(value, sensitiveValues) {
  let message = nonEmptyString(value);
  if (!message) return null;
  for (const sensitive of sensitiveValues) {
    const text = nonEmptyString(sensitive, 2_048);
    if (text && text.length >= 4) message = message.replaceAll(text, '••••');
  }
  return message
    .replace(/(https?:\/\/)[^/\s@]+@/giu, '$1••••@')
    .replace(/([?&](?:appsecret|client_secret|clientsecret|access_token|token|password)=)[^&\s]*/giu, '$1••••')
    .replace(/((?:app|client|access)[_-]?secret|authorization|password|token)\s*[=:]\s*[^\s,;，。]+/giu, '$1=••••')
    .replace(/\b[A-Za-z0-9_.-]*secret[A-Za-z0-9_.-]*\b/giu, '••••')
    .slice(0, 500);
}

function safeDependencyVersions(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    dingtalkStream: safeVersion(source.dingtalkStream),
    axios: safeVersion(source.axios),
    httpsProxyAgent: safeVersion(source.httpsProxyAgent),
    agentBase: safeVersion(source.agentBase),
  };
}

function diagnosticErrors(chain, sensitiveValues) {
  return chain.map((error) => {
    const name = nonEmptyString(error?.name, 80);
    const code = nonEmptyString(error?.code, 100);
    const status = statusFrom(error);
    const providerCode = providerCodeFrom(error);
    const message = redactMessage(error?.message, sensitiveValues);
    return {
      ...(name ? { name } : {}),
      ...(code ? { code } : {}),
      ...(status !== null ? { status } : {}),
      ...(providerCode ? { providerCode } : {}),
      ...(message ? { message } : {}),
    };
  });
}

function publicReference(value) {
  return PUBLIC_REFERENCE_PATTERN.test(value ?? '')
    ? value
    : `DT-CONN-${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`;
}

function fixedPublicError(code, message, hint, referenceId) {
  return Object.freeze({ code, message: t(message), hint: t(hint), referenceId });
}

/** Adds a stable startup stage without discarding the original exception as `cause`. */
export function dingtalkRuntimeStartError(code, cause) {
  if (cause?.name === 'AbortError' || STAGE_CODES.has(cause?.code)) return cause;
  const error = new Error(
    nonEmptyString(cause?.message) ?? 'DingTalk runtime startup failed',
    { cause },
  );
  error.name = 'DingtalkRuntimeStartError';
  error.code = STAGE_CODES.has(code) ? code : 'dingtalk-runtime-prepare-failed';
  return connectionStageError(error, ({ 'dingtalk-harness-connect-failed': 'harness.check',
    'dingtalk-runtime-prepare-failed': 'runtime.prepare', 'dingtalk-stream-client-load-failed': 'sdk.load',
    'dingtalk-stream-listener-failed': 'runtime.prepare', 'dingtalk-stream-connect-failed': 'connection.start' })[error.code]);
}

/** Creates browser-safe guidance plus a redacted Host-log diagnostic for one connection failure. */
export function describeDingtalkConnectionFailure(error, {
  fallbackMessage = '钉钉连接未就绪，请稍后重试。',
  clientId,
  clientSecret,
  environment = process.env,
  dependencies = installedDingtalkConnectionDependencies(),
  nodeVersion = process.versions.node,
  referenceId: suppliedReferenceId,
} = {}) {
  const referenceId = publicReference(suppliedReferenceId);
  const chain = errorChain(error);
  const codes = new Set(chain
    .map((entry) => nonEmptyString(entry?.code, 100)?.toUpperCase())
    .filter(Boolean));
  const messages = chain
    .map((entry) => nonEmptyString(entry?.message)?.toLowerCase())
    .filter(Boolean);
  const statuses = chain.map(statusFrom).filter((status) => status !== null);
  const stage = chain.map((entry) => entry?.code).find((code) => STAGE_CODES.has(code)) ?? null;
  const proxyVariables = PROXY_VARIABLES.filter((name) => nonEmptyString(environment?.[name], 4_096));
  const proxyConfigured = proxyVariables.length > 0;
  const versions = safeDependencyVersions(dependencies);
  const messageContains = (pattern) => messages.some((message) => pattern.test(message));
  const codeContains = (pattern) => [...codes].some((code) => pattern.test(code));
  const proxyFailureSignal = statuses.includes(407)
    || codeContains(/(?:PROXY|ERR_INVALID_PROTOCOL)/u)
    || messageContains(/proxy|tunneling socket/u);

  let publicError;
  if (stage === 'dingtalk-stream-connect-failed'
    && proxyConfigured
    && versions.agentBase === '6.0.0') {
    publicError = fixedPublicError(
      'stream-proxy-dependency-incompatible',
      '钉钉 Stream 连接失败：检测到代理依赖 agent-base 6.0.0。',
      '请将 DSH profile 中的 agent-base@6 固定为 6.0.2 后重新安装依赖，或升级 pnpm 后重新解析 lockfile。',
      referenceId,
    );
  } else if (stage === 'dingtalk-harness-connect-failed') {
    publicError = fixedPublicError(
      'harness-unavailable',
      '插件无法连接本机 Harness。',
      '请确认 dsh web 正常运行，并查看 dsh web 日志中相同参考号对应的诊断信息。',
      referenceId,
    );
  } else if (stage === 'dingtalk-stream-client-load-failed') {
    publicError = fixedPublicError(
      'stream-sdk-load-failed',
      '钉钉 Stream SDK 加载失败。',
      '请重新安装当前 DSH profile 的插件依赖，并查看 dsh web 日志中相同参考号对应的诊断信息。',
      referenceId,
    );
  } else if (statuses.some((status) => status === 401 || status === 403)) {
    publicError = fixedPublicError(
      'stream-credentials-rejected',
      '钉钉拒绝了当前应用凭据。',
      '请核对 Client ID、Client Secret 和机器人权限后重试。',
      referenceId,
    );
  } else if (codeContains(/(?:TIMEOUT|ETIMEDOUT)/u) || messageContains(/timed? out|timeout/u)) {
    publicError = fixedPublicError(
      'stream-handshake-timeout',
      '连接钉钉 Stream 超时。',
      '请检查网络、代理和防火墙后重试；详细原因可在 dsh web 日志中按参考号查找。',
      referenceId,
    );
  } else if (codeContains(/^(?:ENOTFOUND|EAI_AGAIN)$/u)) {
    publicError = fixedPublicError(
      'stream-dns-failed',
      '无法解析钉钉服务地址。',
      '请检查 DNS、网络和代理设置；详细原因可在 dsh web 日志中按参考号查找。',
      referenceId,
    );
  } else if (codeContains(/(?:CERT|TLS|SSL|UNABLE_TO_VERIFY)/u)) {
    publicError = fixedPublicError(
      'stream-tls-failed',
      '钉钉 Stream 的 TLS 连接校验失败。',
      '请检查系统证书、代理证书或 HTTPS 中间代理；详细原因可在 dsh web 日志中按参考号查找。',
      referenceId,
    );
  } else if (stage === 'dingtalk-stream-connect-failed'
    && proxyFailureSignal) {
    publicError = fixedPublicError(
      'stream-proxy-failed',
      '钉钉 Stream 无法通过当前代理建立连接。',
      '请检查 HTTP_PROXY、HTTPS_PROXY、NO_PROXY 和代理连通性；详细原因可在 dsh web 日志中按参考号查找。',
      referenceId,
    );
  } else if (stage === 'dingtalk-stream-connect-failed') {
    publicError = fixedPublicError(
      'stream-connect-failed',
      '钉钉 Stream 消息连接建立失败。',
      '请检查网络和机器人配置；详细原因可在 dsh web 日志中按参考号查找。',
      referenceId,
    );
  } else if (stage === 'dingtalk-stream-listener-failed') {
    publicError = fixedPublicError(
      'stream-listener-failed',
      '钉钉 Stream 消息监听初始化失败。',
      '请确认 dsh-im 与 dingtalk-stream 版本兼容，并按参考号查看 dsh web 日志。',
      referenceId,
    );
  } else if (stage === 'dingtalk-runtime-prepare-failed') {
    publicError = fixedPublicError(
      'runtime-prepare-failed',
      '钉钉机器人运行环境初始化失败。',
      '请检查 DSH 数据目录、工作区和插件依赖，并按参考号查看 dsh web 日志。',
      referenceId,
    );
  } else {
    publicError = fixedPublicError(
      'connection-failed',
      fallbackMessage,
      '请在 dsh web 日志中查找相同参考号，以获取已脱敏的具体错误。',
      referenceId,
    );
  }

  return Object.freeze({
    publicError,
    diagnostic: Object.freeze({
      referenceId,
      category: publicError.code,
      stage,
      runtime: { node: safeVersion(nodeVersion) },
      proxy: { configured: proxyConfigured, variables: proxyVariables },
      dependencies: versions,
      errors: diagnosticErrors(chain, [clientId, clientSecret]),
    }),
  });
}

/** Carries only a pre-built public projection across the Host RPC boundary. */
export function dingtalkPublicConnectionError(publicError, cause) {
  const error = new Error(publicError.message, { cause });
  error.name = 'DingtalkPublicConnectionError';
  error.code = publicError.code;
  error.publicError = structuredClone(publicError);
  return error;
}
