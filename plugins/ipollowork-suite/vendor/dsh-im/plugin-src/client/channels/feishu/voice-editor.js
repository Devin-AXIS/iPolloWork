import * as React from 'react';

import { h } from '../../i18n.js';

// 语音交互编辑器:开关 + 凭据引用 + 模型/音色参数。
// 凭据值由插件凭据库管理,这里只保存 secretRef 名称——密钥本身不进入配置,
// 也不经本表单传输。开启后:收到语音消息时转写为文字走正常流水线,并用
// 语音回复同回合答案(需 DashScope qwen3 系列密钥与可用 ffmpeg)。
export function VoiceEditor({ value = null, disabled = false, onSave }) {
  const [enabled, setEnabled] = React.useState(value != null);
  const [secretRef, setSecretRef] = React.useState(value?.secretRef ?? 'DASHSCOPE_API_KEY');
  const [asrModel, setAsrModel] = React.useState(value?.asrModel ?? 'qwen3-asr-flash');
  const [ttsModel, setTtsModel] = React.useState(value?.ttsModel ?? 'qwen3-tts-flash');
  const [ttsVoice, setTtsVoice] = React.useState(value?.ttsVoice ?? 'Momo');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState(null);
  const titleId = React.useId();
  const helpId = `${titleId}-help`;

  React.useEffect(() => {
    setEnabled(value != null);
    if (value) {
      setSecretRef(value.secretRef ?? 'DASHSCOPE_API_KEY');
      setAsrModel(value.asrModel ?? 'qwen3-asr-flash');
      setTtsModel(value.ttsModel ?? 'qwen3-tts-flash');
      setTtsVoice(value.ttsVoice ?? 'Momo');
    }
  }, [value]);

  const persist = async (payload) => {
    if (saving || disabled) return;
    setSaving(true);
    setError(null);
    try {
      await onSave?.(payload);
    } catch (cause) {
      setError(cause?.message ?? '语音设置保存失败，请重试。');
    } finally {
      setSaving(false);
    }
  };

  const save = () => persist(enabled ? { enabled: true, secretRef, asrModel, ttsModel, ttsVoice } : null);

  // 切到“关闭”立即持久化 null:关闭态没有保存按钮,若不在这里落盘,
  // 后台会一直保持原配置,用户以为语音已停而实际仍在处理语音。
  const toggle = (next) => {
    setEnabled(next);
    if (!next) void persist(null);
  };

  const input = (label, state, setState, placeholder) => h('label', { className: 'dim-feishuVoiceField' },
    h('span', { className: 'dim-feishuVoiceLabel' }, label),
    h('input', {
      type: 'text',
      className: 'dim-feishuVoiceInput',
      value: state,
      placeholder,
      disabled: disabled || saving,
      onChange: (event) => setState(event.target.value),
    }),
  );

  return h('section', {
    className: 'dim-feishuGroupControl',
    "aria-labelledby": titleId,
  },
  h('div', { className: 'dim-feishuGroupControlHeader' },
    h('div', { className: 'dim-presetTitle' },
      h('h3', { id: titleId }, '语音交互'),
      h('span', { className: 'dim-presetHelp' },
        h('button', {
          type: 'button',
          className: 'dim-presetHelpButton',
          "aria-label": '查看语音交互说明',
          "aria-describedby": helpId,
        }, h('span', { "aria-hidden": 'true' }, '?')),
        h('span', {
          id: helpId,
          className: 'dim-presetTooltip',
          role: 'tooltip',
        }, '收到语音消息时转写为文字并按文字流水线处理,答案同时以语音回复;转写失败时降级为仅支持文字/图片/文件的提示。凭据值在插件凭据库里管理,这里只引用环境变量名。'))),
    saving
      ? h('span', { className: 'dim-feishuGroupControlStatus', role: 'status' }, '保存中…')
      : null),
  h('select', {
    className: 'dim-feishuGroupSelect',
    value: enabled ? 'on' : 'off',
    disabled: disabled || saving,
    "aria-label": '语音交互开关',
    onChange: (event) => toggle(event.target.value === 'on'),
  },
  h('option', { value: 'off' }, '关闭'),
  h('option', { value: 'on' }, '开启(语音提问与语音回复)')),
  enabled
    ? h('div', { className: 'dim-feishuVoiceForm' },
        input('凭据引用(环境变量名)', secretRef, setSecretRef, 'DASHSCOPE_API_KEY'),
        input('转写模型(ASR)', asrModel, setAsrModel, 'qwen3-asr-flash'),
        input('合成模型(TTS)', ttsModel, setTtsModel, 'qwen3-tts-flash'),
        input('回复音色', ttsVoice, setTtsVoice, 'Momo'),
        h('p', { className: 'dim-feishuGroupHelp' },
          '需要 DashScope 密钥(凭据库中以"凭据引用"为名的环境变量)与可用 ffmpeg;音色支持 Cherry/Serena/Bella/Chelsie/Momo/Katerina 等 qwen3-tts-flash 官方音色。'),
        h('div', { className: 'dim-feishuVoiceActions' },
          h('button', {
            type: 'button',
            className: 'dim-feishuVoiceSave',
            onClick: () => void save(),
            disabled: disabled || saving || !secretRef.trim(),
          }, '保存语音设置')))
    : h('p', { className: 'dim-feishuGroupHelp' }, '默认关闭;开启后机器人可听懂语音消息并以语音回复。'),
  error ? h('p', {
    className: 'dim-feishuGroupError',
    role: 'alert',
  }, error) : null);
}
