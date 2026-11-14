import { createConnectionDiagnostics, connectionHint } from '../shared/connection-error.mjs';
import { t } from '../shared/i18n.mjs';
import { CONFIG_ISSUE_LABELS, normalizeWeixinDiagnosticDetails } from './diagnostic-details.mjs';
import { configReadErrorDetails } from '../shared/config-read-error.mjs';

const MESSAGES = Object.freeze({
  'credential-read-failed': '无法读取现有登录凭据。请检查 DSH 凭据存储。',
  'credential-save-failed': '登录凭据无法写入 DSH 凭据存储。请检查凭据存储是否可写。',
  'account-config-save-failed': '账号配置无法写入本机。请检查 DSH_HOME 目录权限。',
  'runtime-prepare-failed': '无法初始化账号状态或工作区。请检查 DSH_HOME 和工作区目录。',
  'harness-connect-failed': '插件无法连接当前 Harness，请检查宿主是否已就绪。',
  'harness-timeout': 'Harness 健康检查超时。请确认 dsh web 未阻塞。',
  'harness-auth-required': 'Harness 健康检查需要身份认证。请检查代理、网关或自定义鉴权配置。',
  'harness-proxy-auth-required': '本机 Harness 请求被代理要求认证。请让回环地址绕过代理，并检查 NO_PROXY 配置。',
  'harness-loopback-forbidden': 'Harness 异常拒绝了回环地址的健康检查。请检查 HTTP 代理、Harness 源码版本和构建产物。',
  'harness-host-untrusted': 'Harness 的 Host 信任检查拒绝了非回环地址请求。请检查 harnessBaseUrl 与 trustedHosts 配置。',
  'harness-request-forbidden': '健康检查收到了非 Harness 标准的 403 拒绝响应。请检查代理或网关配置。',
  'harness-api-not-found': '找不到 Harness 健康检查接口。请确认 Harness 与插件版本兼容。',
  'harness-http-failed': 'Harness 健康检查返回服务错误。请查看 DSH 日志。',
  'harness-response-invalid': 'Harness 返回了无法识别的响应。请确认 Harness 与插件版本兼容。',
  'harness-rpc-rejected': 'Harness 拒绝了健康检查请求。请查看 DSH 日志。',
  'harness-check-unknown-failed': 'Harness 健康检查发生未知错误。请查看 DSH 日志。',
  'connection-start-failed': '消息连接初始化失败。请查看 DSH 日志后重试。',

  'network-error': '暂时无法访问微信服务。',
  'timeout': '微信服务请求超时。',
  'http-error': '微信服务请求失败（HTTP {status}）。',
  'invalid-response': '微信服务返回了无法解析的响应。',
  'invalid-qr': '微信服务没有返回有效二维码。',
  'untrusted-qr': '微信服务返回了不受信任的扫码地址。',
  'invalid-base-url': '微信服务返回了无效的连接地址。',
  'untrusted-base-url': '微信服务返回了不受信任的连接地址。',
  'untrusted-endpoint': '拒绝访问不受信任的微信服务地址。',
  'invalid-login-status': '微信服务返回了无法识别的扫码状态。',
  'incomplete-login': '微信授权成功，但返回的账号凭据不完整。',
  'qr-request-rejected': '微信服务拒绝了二维码申请。',
  'qr-encode-failed': '已取得扫码地址，但本机二维码图片生成失败。',
  'qr-start-failed': '无法生成微信二维码。',
  'provision-attempt-not-found': '这次微信绑定任务已不存在，请重新读取状态或生成二维码。',
  'provision-state-invalid': '这次微信绑定任务当前不能提交配对码，请重新读取状态。',
  'missing-token': '登录凭据缺失，请移除账号后重新扫码。',
  'stale-token': '微信登录凭据已失效，请移除账号后重新扫码。',
  'credential-remove-failed': '无法从 DSH 凭据存储移除微信登录凭据。',
  'account-config-remove-failed': '微信账号配置移除失败。',
  'account-state-read-failed': '无法读取微信账号状态文件。',
  'account-state-write-failed': '无法保存微信账号状态文件。',
  'account-state-cleanup-failed': '微信账号已移除，但本机状态文件清理失败。',
  'workspace-save-failed': '无法保存微信工作区设置。',
  'workspace-cleanup-failed': '微信账号已移除，但工作区设置清理失败。',
  'start-rejected': '微信账号连接启动失败。',
  'updates-rejected': '微信消息同步请求被拒绝。',
  'stop-rejected': '微信服务未确认停止通知。',
  'connection-stop-failed': '微信消息连接停止时发生错误。',
  'status-read-failed': '无法读取微信连接状态，请重新读取；之前的操作可能已完成。',
  'activation-unknown-failed': '微信激活过程中发生未知错误。',
  'weixin-operation-failed': '微信操作发生未知错误。',
  'weixin-startup-config-invalid': '微信配置格式错误，请检查 config.json 和 workspaces.json 后重启 DSH。',
  'weixin-startup-permission-denied': '微信配置访问权限不足，请检查数据目录权限后重启 DSH。',
  'weixin-startup-failed': '微信初始化失败，请查看 DSH 启动日志。',
  'connection-failed': '微信连接未就绪。',
  'rollback-failed': '微信操作失败后，原账号状态恢复失败。',
  'workspace-not-absolute': '请输入工作区绝对路径。',
  'workspace-not-found': '工作区目录不存在。',
  'workspace-not-directory': '工作区路径不是目录。',
  'workspace-bot-not-found': '找不到要修改的机器人。',
  'agent-preset-invalid': 'Agent Preset 无效。',
  'agent-preset-unavailable': 'Agent Preset 不存在或不可用。',
  'model-selection-invalid': '模型无效。',
  'model-selection-unavailable': '模型不存在或不可用。',
  'model-reasoning-unavailable': '当前模型不支持所选思考强度，请重新选择。',
  'context-enhancement-invalid': '上下文增强设置无效。',
});

const ownedStages = new WeakMap();

const CODE_STAGES = {
  'credential-read-failed': ['credential.read', 'credential-store'],
  'credential-save-failed': ['credential.save', 'credential-store'],
  'credential-remove-failed': ['credential.remove', 'credential-store'],
  'missing-token': ['credential.read', 'credential-store'],
  'account-config-save-failed': ['account.save', 'account-config'],
  'account-config-remove-failed': ['account.remove', 'account-config'],
  'account-state-read-failed': ['state.load', 'account-state'],
  'account-state-write-failed': ['state.write', 'account-state'],
  'account-state-cleanup-failed': ['state.cleanup', 'account-state'],
  'workspace-save-failed': ['workspace.write', 'workspace-config'],
  'workspace-cleanup-failed': ['workspace.cleanup', 'workspace-config'],
  'qr-encode-failed': ['qr.encode'], 'qr-request-rejected': ['qr.begin'],
  'start-rejected': ['connection.start'], 'updates-rejected': ['connection.poll'],
  'stop-rejected': ['connection.stop'], 'rollback-failed': ['rollback'],
  'runtime-prepare-failed': ['runtime.prepare'], 'connection-start-failed': ['connection.start'],
  'status-read-failed': ['status.read'],
};

export function knownWeixinErrorCode(code) { return Object.hasOwn(MESSAGES, code ?? ''); }

/** Annotate at the operation that knows the failing resource; do not inspect exception prose. */
export function weixinStageError(code, cause, stage) {
  if (cause?.publicError) return cause;
  const error = new Error('Weixin operation failed', { cause });
  error.code = knownWeixinErrorCode(code) ? code : 'weixin-operation-failed';
  const defaults = CODE_STAGES[error.code] ?? [];
  ownedStages.set(error, { stage: stage ?? defaults[0], resource: defaults[1] });
  return error;
}

function hintFor(code, details) {
  if (code === 'qr-encode-failed') return connectionHint(details);
  if (details.rollback === 'failed' || details.rollback === 'unknown') return t('原账号状态尚未确认，请重新读取状态，并反馈诊断信息。');
  if (details.rollback === 'succeeded') return t('操作未完成，已恢复之前的本机状态。请处理上述问题后重试。');
  if (code.startsWith('harness-')) return t('请确认当前 DSH 宿主已就绪，并检查 Harness 与插件实际运行版本及宿主日志。');
  if (details.reason === 'read-only') return t('凭据由只读来源提供，请在启动 DSH 的配置中检查该来源。');
  if (details.reason === 'ENOTFOUND' || details.reason === 'EAI_AGAIN') return t('微信服务域名解析失败，请检查运行 DSH 的机器的网络和 DNS 设置后重试。');
  if (['EACCES', 'EPERM', 'EROFS'].includes(details.reason)) return t('请检查 DSH 数据目录和对应文件的读写权限。');
  if (details.reason === 'ENOSPC') return t('磁盘空间不足，请释放空间后重试。');
  if (code.startsWith('weixin-startup-') && details.file) {
    const explanation = details.reason === 'invalid-json' ? t('JSON 语法无效。')
      : details.issue ? t(CONFIG_ISSUE_LABELS[details.issue]) : '';
    return [explanation, t('请检查微信渠道数据目录中的 {file}，修复后重启 DSH；“重新读取”不会重新加载配置。', { file: details.file }),
      details.field ? t('字段位置中的序号从 0 开始，按文件中的条目顺序计数，不包含真实账号标识。') : '',
    ].filter(Boolean).join(' ');
  }
  if (details.reason === 'invalid-json' && details.resource) return t('本机文件格式无效，请检查对应配置或状态文件；不要清空登录凭据。');
  if (/CERT|TLS|SSL/.test(details.reason ?? '')) return t('请检查运行 DSH 的机器的系统时间、证书和网络设置。');
  if (code === 'stale-token' || code === 'missing-token') return t('请移除失效接入并重新扫码绑定。');
  if (details.httpStatus === 429) return t('微信服务限流，请稍后重试。');
  if (details.httpStatus === 401 || details.httpStatus === 403) return t('访问被拒绝，请检查服务访问限制；HTTP 状态本身不能确认登录凭据已失效。');
  if (code === 'network-error' || code === 'timeout' || details.reason === 'multiple-causes') return connectionHint(details);
  return t('请按参考号查看 DSH 日志，并复制诊断信息反馈。');
}

export function createWeixinDiagnostics(options = {}) {
  return createConnectionDiagnostics({ ...options, channel: 'weixin', prefix: 'WX-CONN',
    describe(cause, context, evidence) {
      const chain = evidence.chain;
      const selected = chain.find(error => knownWeixinErrorCode(error.code));
      const code = selected?.code ?? (knownWeixinErrorCode(context.code) ? context.code : 'weixin-operation-failed');
      const staged = chain.map(error => ownedStages.get(error)).find(Boolean) ?? {};
      const configDetails = chain.map(configReadErrorDetails).find(Boolean) ?? {};
      const defaults = CODE_STAGES[code] ?? [];
      const details = normalizeWeixinDiagnosticDetails({
        ...context, ...evidence.details, ...configDetails,
        file: { 'account-config': 'config.json', 'workspace-config': 'workspaces.json' }[configDetails.resource],
        stage: staged.stage ?? defaults[0] ?? (code.startsWith('harness-') ? 'harness.check' : context.stage),
        resource: staged.resource ?? defaults[1] ?? configDetails.resource ?? context.resource,
        reason: evidence.details.reason === 'unknown' ? configDetails.reason ?? context.reason ?? 'unknown' : evidence.details.reason,
      });
      const message = code === 'weixin-startup-config-invalid' && details.file
        ? t('微信配置格式错误：{file}。请查看诊断详情，修复后重启 DSH。', { file: details.file })
        : t(MESSAGES[code], { status: details.httpStatus ?? '?' });
      return { publicError: { code, message }, details, hint: hintFor(code, details) };
    },
  });
}
