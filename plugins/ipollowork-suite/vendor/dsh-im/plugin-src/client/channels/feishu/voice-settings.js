import * as React from 'react';

import { h } from '../../i18n.js';
import { FEISHU_ENDPOINTS, normalizeBotsSnapshot, unwrapRpcResult } from './api.js';
import { VoiceEditor } from './voice-editor.js';

export function FeishuVoiceSettingsPage({ account, rpcCall }) {
  const [voice, setVoice] = React.useState(null);
  const [phase, setPhase] = React.useState('loading');
  const [error, setError] = React.useState(null);
  const mounted = React.useRef(true);

  const invoke = React.useCallback(async (endpoint, payload, signal) => {
    if (typeof rpcCall !== 'function') throw new Error('飞书语音设置暂不可用。');
    return unwrapRpcResult(await rpcCall(endpoint, payload, signal));
  }, [rpcCall]);

  const applySnapshot = React.useCallback((value) => {
    const bot = normalizeBotsSnapshot(value).bots.find((entry) => entry.botId === account.botId);
    if (!bot) throw new Error('未找到当前飞书机器人，请返回列表后重试。');
    if (mounted.current) setVoice(bot.voice);
  }, [account.botId]);

  const loadSettings = React.useCallback(async (signal) => {
    setPhase('loading');
    setError(null);
    try {
      const value = await invoke(FEISHU_ENDPOINTS.status, {}, signal);
      if (signal?.aborted || !mounted.current) return;
      applySnapshot(value);
      setPhase('ready');
    } catch (cause) {
      if (signal?.aborted || !mounted.current) return;
      setError(cause?.message ?? '飞书语音设置暂不可用。');
      setPhase('error');
    }
  }, [applySnapshot, invoke]);

  React.useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void loadSettings(controller.signal);
    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, [loadSettings]);

  const saveVoice = async (settings) => {
    const value = await invoke(FEISHU_ENDPOINTS.setVoice, {
      botId: account.botId,
      voice: settings === null ? null : { ...voice, ...settings },
    });
    if (mounted.current) applySnapshot(value);
  };

  if (phase === 'loading') {
    return h('div', { className: 'dim-deliveryState', role: 'status', 'aria-busy': 'true' },
      '正在读取语音设置…');
  }
  if (phase === 'error') {
    return h('div', { className: 'dim-deliveryState', role: 'alert' },
      h('p', null, error),
      h('button', {
        type: 'button',
        className: 'dim-deliveryButton',
        onClick: () => void loadSettings(),
      }, '重新读取'));
  }
  return h(VoiceEditor, { value: voice, onSave: saveVoice });
}
