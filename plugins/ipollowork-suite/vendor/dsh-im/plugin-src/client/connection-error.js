import * as React from 'react';
import { h, localizeText } from './i18n.js';
import { normalizeDiagnosticDetails } from '../../src/channels/shared/diagnostic-details.mjs';
import { CONFIG_ISSUE_LABELS } from '../../src/channels/shared/diagnostic-details.mjs';

const STAGE_LABELS = {
  'session.prepare': '准备会话', 'prompt.prepare': '准备消息', 'interaction.open': '建立交互通道',
  'prompt.submit': '提交消息', 'reply.wait': '等待处理结果',
  'credential.verify': '验证凭据', 'permission.check': '检查权限', 'sdk.load': '加载渠道组件',
  operation: '执行渠道操作', 'message.receive': '接收消息', 'message.send': '发送消息', 'connection.test': '发送测试消息',
  'startup.load': '加载渠道配置', 'qr.begin': '申请二维码', 'qr.encode': '生成二维码图片', 'qr.poll': '查询扫码状态',
  'qr.verify': '提交配对码', 'qr.cancel': '取消绑定', 'credential.read': '读取登录凭据', 'credential.save': '保存登录凭据',
  'credential.remove': '移除登录凭据', 'account.save': '保存账号配置', 'account.remove': '移除账号配置',
  'state.load': '读取账号状态', 'state.write': '保存账号状态', 'state.cleanup': '清理账号状态',
  'workspace.write': '保存工作区设置', 'workspace.cleanup': '清理工作区设置', 'runtime.prepare': '准备消息连接',
  activation: '激活账号', 'harness.check': '检查 DSH 宿主', 'connection.start': '启动连接',
  'connection.poll': '监测连接与消息', 'connection.stop': '停止连接', 'status.read': '读取连接状态',
  rollback: '恢复原账号状态', 'management.request': '访问 DSH 管理接口',
};
const SUBMISSION_LABELS = { 'not-submitted': '未提交', accepted: '已确认接收', unknown: '提交结果未知' };
const STREAM_REASON_LABELS = {
  'stream-closed-before-open': '打开前关闭', 'stream-failed-before-open': '打开前失败',
  'stream-failed': '通道连接失败', unknown: '暂未识别',
};

export function provisioningErrorTitle(error) {
  const stage = error?.details?.stage;
  if (stage === 'qr.begin' || stage === 'qr.encode') return '无法生成微信二维码';
  if (stage === 'qr.poll') return '查询微信扫码状态失败';
  if (stage === 'management.request') return '无法完成微信管理请求';
  return '微信没有绑定完成';
}

export function formatConnectionDiagnostic(value) {
  const error = normalizeConnectionError(value);
  const details = error.details ?? {};
  return [
    localizeText(error.message), details.hint ? localizeText(details.hint) : null,
    localizeText('错误码') + ': ' + error.code,
    ...['channel', 'operation', 'stage', 'method', 'transport', 'submissionState', 'attempts', 'lastFailureReason', 'reason', 'reasons', 'errorTypes', 'causeMessage', 'qrEncoder', 'qrRenderer', 'host', 'durationMs', 'timeoutMs', 'nodeVersion', 'dshVersion', 'platform', 'dependencies', 'proxyConfigured', 'truncated', 'httpStatus', 'providerCode', 'resource', 'file', 'field', 'issue', 'referenceId', 'occurredAt', 'rollback', 'pluginVersion']
      .filter(field => details[field] !== undefined)
      .map(field => `${field}: ${typeof details[field] === 'object' ? JSON.stringify(details[field]) : details[field]}`),
  ].filter(Boolean).join('\n');
}

export function ConnectionError({ error: value, warning = false, showMessage = true }) {
  const error = normalizeConnectionError(value);
  const details = error.details ?? {};
  const isWarning = warning || error.code.endsWith('cleanup-failed');
  const [copyState, setCopyState] = React.useState(null);
  React.useEffect(() => setCopyState(null), [details.referenceId, error.code, error.message]);
  const copy = async () => {
    try {
      if (typeof globalThis.navigator?.clipboard?.writeText !== 'function') throw new Error('clipboard unavailable');
      await globalThis.navigator.clipboard.writeText(formatConnectionDiagnostic(error));
      setCopyState('copied');
    } catch { setCopyState('manual'); }
  };
  const fields = [
    ['错误码', error.code], ['失败阶段', localizeText(STAGE_LABELS[details.stage] ?? details.stage ?? '')],
    ['RPC 方法', details.method], ['调用方式', details.transport === 'host-api' ? localizeText('宿主 API（进程内）') : details.transport === 'http' ? 'HTTP' : details.transport === 'websocket' ? 'WebSocket' : undefined],
    ['消息提交状态', localizeText(SUBMISSION_LABELS[details.submissionState] ?? '')],
    ['连接尝试次数', details.attempts],
    ['异常类型', details.errorTypes?.join(', ')], ['二维码编码器', details.qrEncoder], ['二维码图片格式', details.qrRenderer],
    ['最近一次连接失败', localizeText(STREAM_REASON_LABELS[details.lastFailureReason] ?? details.lastFailureReason ?? '')],
    ['底层原因', details.reason === 'unknown' ? localizeText('暂未识别') : details.reason], ['多个原因', details.reasons?.join(', ')], ['服务域名', details.host], ['请求耗时（毫秒）', details.durationMs], ['超时阈值（毫秒）', details.timeoutMs], ['Node 版本', details.nodeVersion], ['DSH 版本', details.dshVersion], ['依赖版本', details.dependencies ? Object.entries(details.dependencies).map(([name, version]) => `${name}: ${version}`).join(', ') : undefined], ['代理已配置', details.proxyConfigured], ['原因链已截断', details.truncated], ['运行平台', details.platform], ['HTTP 状态', details.httpStatus], ['服务返回码', details.providerCode],
    ['配置文件', details.file], ['配置字段', details.field],
    ['校验原因', details.issue ? localizeText(CONFIG_ISSUE_LABELS[details.issue]) : undefined],
    ['参考号', details.referenceId], ['发生时间', details.occurredAt], ['插件版本', details.pluginVersion],
  ].filter(([, text]) => text !== undefined && text !== '');
  return h('div', { className: 'dim-connectionDiagnostic', 'data-connection-diagnostic': true, 'data-weixin-diagnostic': details.channel === 'weixin' || /^WX-CONN/.test(details.referenceId ?? '') || undefined, role: isWarning ? 'status' : undefined, 'data-warning': isWarning || undefined },
    showMessage ? h('p', null, error.message) : null,
    details.hint ? h('p', null, details.hint) : null,
    h('details', { style: { marginTop: 8 } },
      h('summary', { style: { cursor: 'pointer' } }, '诊断详情'),
      h('dl', { style: { display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: '4px 12px', margin: '10px 0' } },
        ...fields.flatMap(([label, text]) => [h('dt', { key: `${label}-label` }, label),
          React.createElement('dd', { key: label, style: { margin: 0, overflowWrap: 'anywhere' } }, String(text))])),
      !details.referenceId ? h('p', null, '未取得 Host 诊断参考号。') : null,
      h('div', { className: 'dim-viewActions' },
        h('button', { type: 'button', className: 'dxw-button', onClick: copy }, copyState === 'copied' ? '诊断信息已复制' : '复制诊断信息')),
      copyState === 'manual' ? h('div', null,
        h('p', null, '无法访问剪贴板，请选择并复制以下诊断信息。'),
        React.createElement('textarea', { readOnly: true, value: formatConnectionDiagnostic(error), rows: 7,
          'aria-label': localizeText('诊断信息'), style: { width: '100%', boxSizing: 'border-box', marginTop: 8 } })) : null));
}

export function normalizeConnectionError(value, fallbackCode = 'operation-failed', fallbackMessage = '操作失败，请查看原因和诊断详情。') {
  const source = value && typeof value === 'object' ? value : {};
  const text = (v, fallback, n) => typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : fallback;
  const details = normalizeDiagnosticDetails({ ...source.details,
    referenceId: source.details?.referenceId ?? source.referenceId,
    hint: source.details?.hint ?? source.hint,
  });
  return { code: text(source.code, fallbackCode, 100), message: text(source.message, fallbackMessage, 500),
    ...(Object.keys(details).length ? { details } : {}),
    ...(source.hint ? { hint: details.hint } : {}), ...(source.referenceId ? { referenceId: details.referenceId } : {}),
  };
}
