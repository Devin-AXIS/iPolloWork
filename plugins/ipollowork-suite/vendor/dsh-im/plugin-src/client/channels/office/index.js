import { ConnectionError } from '../../connection-error.js';
import * as React from 'react';

import { h } from '../../i18n.js';
import {
  OFFICE_PROTOCOL_VERSION,
  OFFICE_RPC_ENDPOINTS,
  normalizeOfficeStatus,
  officeHookUrls,
  unwrapOfficeRpc,
} from './api.js';

function Button({ children, kind = 'secondary', ...props }) {
  return h('button', { ...props, type: 'button', className: 'ddt-button', 'data-kind': kind }, children);
}

function mapText(value) {
  return Object.entries(value ?? {}).map(([key, item]) => `${key}=${item}`).join('\n');
}

function parseMap(value, label) {
  const output = {};
  for (const raw of value.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const index = line.indexOf('=');
    if (index < 1 || !line.slice(index + 1).trim()) {
      throw new Error(label === 'Workspace 映射'
        ? 'Workspace 映射每行必须使用 alias=value'
        : 'Instruction Preset 映射每行必须使用 alias=value');
    }
    output[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return output;
}

function stateLabel(model) {
  if (model.connected) return '已连接 Office';
  if (!model.configured) return '尚未配置';
  if (model.state === 'connecting') return '正在连接';
  if (model.state === 'reconnecting') return '等待重连';
  if (model.state === 'missing-token') return '凭据缺失';
  return '已配置';
}

export function OfficeSettingsTab({ rpcCall, initialStatus }) {
  const [model, setModel] = React.useState(normalizeOfficeStatus(initialStatus));
  const [phase, setPhase] = React.useState(initialStatus === undefined ? 'loading' : 'ready');
  const [busy, setBusy] = React.useState('');
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [form, setForm] = React.useState({
    baseUrl: '', deviceId: 'local-harness', deviceToken: '',
    maxConcurrency: '1', heartbeatSeconds: '30', workspaces: '', instructionPresets: '',
  });

  const invoke = React.useCallback(async (endpoint, payload = {}) => {
    if (typeof rpcCall !== 'function') throw new Error('AI Office 设置页缺少 RPC 连接');
    return unwrapOfficeRpc(await rpcCall(endpoint, payload));
  }, [rpcCall]);

  const adopt = React.useCallback((value) => {
    const next = normalizeOfficeStatus(value?.snapshot ?? value);
    setModel(next);
    if (next.config) setForm((current) => ({
      ...current,
      baseUrl: next.config.baseUrl,
      deviceId: next.config.deviceId,
      maxConcurrency: String(next.config.maxConcurrency),
      heartbeatSeconds: String(next.config.heartbeatSeconds),
      workspaces: mapText(next.config.workspaces),
      instructionPresets: mapText(next.config.instructionPresets),
      deviceToken: '',
    }));
    return next;
  }, []);

  const load = React.useCallback(async () => {
    try { adopt(await invoke(OFFICE_RPC_ENDPOINTS.status)); setPhase('ready'); setError(''); }
    catch (caught) { setPhase('error'); setError(caught); }
  }, [adopt, invoke]);

  React.useEffect(() => { void load(); }, [load]);

  const run = async (name, operation) => {
    setBusy(name); setError(''); setNotice('');
    try { const value = await operation(); adopt(value); if (value?.warnings?.length) setError(value.warnings[0]); setNotice(name === 'test' ? '连接测试通过。' : '配置已保存。'); }
    catch (caught) { setError(caught); }
    finally { setBusy(''); }
  };

  const hooks = React.useMemo(() => {
    try { return officeHookUrls(form.baseUrl); } catch { return {}; }
  }, [form.baseUrl]);
  const health = model.health ?? {};

  if (phase === 'loading') return h('div', { className: 'ddt-card ddt-loading', 'aria-busy': 'true' }, '正在读取 AI Office Connector…');

  return h('section', { className: 'dof-page', 'aria-label': 'AI Office 设置' },
    h('div', { className: 'dof-hero' },
      h('div', { className: 'dof-heroCopy' },
        h('h3', null, 'AI Office Connector'),
        h('p', null, '本机主动连接公网 Office；Harness 不开放端口。协议 Hook 固定为 ', OFFICE_PROTOCOL_VERSION, '。')),
      h('span', { className: 'dof-status', 'data-connected': String(model.connected) },
        h('span', { className: 'dof-dot' }), stateLabel(model))),
    model.configured ? h('div', { className: 'dof-metrics' },
      h('div', { className: 'dof-metric' }, h('span', null, '最近心跳'), h('strong', null, health.lastHeartbeatAt ?? '尚无')),
      h('div', { className: 'dof-metric' }, h('span', null, '最近事件'), h('strong', null, health.lastEventType ?? '尚无')),
      h('div', { className: 'dof-metric' }, h('span', null, '重连次数'), h('strong', null, String(health.reconnects ?? 0))),
      h('div', { className: 'dof-metric' }, h('span', null, 'Job Offer'), h('strong', null, String(health.jobsOffered ?? 0))),
      h('div', { className: 'dof-metric' }, h('span', null, '运行 Job'), h('strong', null, String(health.jobs?.running ?? 0))),
      h('div', { className: 'dof-metric' }, h('span', null, '完成 Job'), h('strong', null, String(health.jobs?.completed ?? 0)))) : null,
    h('div', { className: 'dof-card' },
      h('div', { className: 'dof-cardTitle' }, h('h4', null, '设备连接'), h('span', null, 'Token 只写入本机凭据存储')),
      h('div', { className: 'dof-grid' },
        h('label', { className: 'dof-field', 'data-wide': 'true' }, 'Office Base URL',
          h('input', { value: form.baseUrl, placeholder: 'https://office.example.com', onChange: (event) => setForm({ ...form, baseUrl: event.target.value }) })),
        h('label', { className: 'dof-field' }, 'Device ID',
          h('input', { value: form.deviceId, placeholder: 'local-harness', onChange: (event) => setForm({ ...form, deviceId: event.target.value }) })),
        h('label', { className: 'dof-field' }, 'Device Token',
          h('input', { type: 'password', value: form.deviceToken, placeholder: model.tokenConfigured ? '已安全保存；留空保持不变' : '粘贴 Office 一次性凭据', autoComplete: 'new-password', onChange: (event) => setForm({ ...form, deviceToken: event.target.value }) })),
        h('label', { className: 'dof-field' }, '最大并发',
          h('input', { type: 'number', min: 1, max: 4, value: form.maxConcurrency, onChange: (event) => setForm({ ...form, maxConcurrency: event.target.value }) })),
        h('label', { className: 'dof-field' }, 'Heartbeat 秒数',
          h('input', { type: 'number', min: 10, max: 300, value: form.heartbeatSeconds, onChange: (event) => setForm({ ...form, heartbeatSeconds: event.target.value }) })),
        h('label', { className: 'dof-field', 'data-wide': 'true' }, 'Workspace 映射',
          h('textarea', { value: form.workspaces, placeholder: 'office-project=/Users/you/projects/ai-office', onChange: (event) => setForm({ ...form, workspaces: event.target.value }) }),
          h('small', null, '每行 alias=/本机/绝对路径；Office 只能看到 alias。')),
        h('label', { className: 'dof-field', 'data-wide': 'true' }, 'Instruction Preset 映射',
          h('textarea', { value: form.instructionPresets, placeholder: 'action-items=转换为负责人、截止和验收明确的工单', onChange: (event) => setForm({ ...form, instructionPresets: event.target.value }) }),
          h('small', null, '每行 alias=指令；新增 preset 不需要改 Office 代码。'))),
      error ? h(ConnectionError, { error }) : null,
      notice ? h('p', { className: 'dof-notice', role: 'status' }, notice) : null,
      health.error?.message ? h(ConnectionError, { error: health.error }) : null,
      h('div', { className: 'dof-actions' },
        h(Button, { kind: 'primary', disabled: Boolean(busy), onClick: () => void run('save', () => invoke(OFFICE_RPC_ENDPOINTS.configure, {
          baseUrl: form.baseUrl,
          deviceId: form.deviceId,
          ...(form.deviceToken ? { deviceToken: form.deviceToken } : {}),
          maxConcurrency: Number(form.maxConcurrency),
          heartbeatSeconds: Number(form.heartbeatSeconds),
          workspaces: parseMap(form.workspaces, 'Workspace 映射'),
          instructionPresets: parseMap(form.instructionPresets, 'Instruction Preset 映射'),
        })) }, busy === 'save' ? '保存中…' : '保存并连接'),
        h(Button, { disabled: !model.configured || Boolean(busy), onClick: () => void run('test', () => invoke(OFFICE_RPC_ENDPOINTS.test)) }, busy === 'test' ? '测试中…' : '测试连接'),
        h(Button, { disabled: !model.configured || Boolean(busy), onClick: () => void run('reconnect', () => invoke(OFFICE_RPC_ENDPOINTS.reconnect)) }, '重新连接'),
        h(Button, { kind: 'danger', disabled: !model.configured || Boolean(busy), onClick: () => void run('remove', () => invoke(OFFICE_RPC_ENDPOINTS.remove, { confirm: true })) }, '移除连接'))),
    h('div', { className: 'dof-card' },
      h('div', { className: 'dof-cardTitle' }, h('h4', null, '协议 Hook 预览'), h('span', null, '由 Base URL 自动派生，不单独填写')),
      h('div', { className: 'dof-hooks' },
        [['SSE', hooks.stream], ['Heartbeat', hooks.heartbeat], ['Job', hooks.job], ['Result', hooks.result]].map(([label, url]) => h('div', { className: 'dof-hook', key: label }, h('strong', null, label), h('code', null, url ?? 'Base URL 无效'))))),
    h('p', { className: 'dof-notice' }, 'Office Hook 尚未部署时，配置会安全保存并自动重试；出现 HTTP 404 代表协议端点待上线，不代表 Harness 故障。'));
}
