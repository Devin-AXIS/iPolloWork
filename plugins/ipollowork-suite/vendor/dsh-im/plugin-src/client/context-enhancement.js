import * as React from 'react';
import { createPortal } from 'react-dom';

import {
  CONTEXT_DIRECT_GUIDANCE_EXAMPLE,
  CONTEXT_ENHANCEMENT_FIELDS,
  CONTEXT_ENHANCEMENT_GUIDANCE_MAX_LENGTH,
  CONTEXT_GROUP_GUIDANCE_EXAMPLE,
  normalizeContextEnhancementConfig,
  validateContextEnhancementConfig,
} from '../../src/channels/shared/context-enhancement.mjs';
import { h, localizeText } from './i18n.js';

const FIELD_LABELS = Object.freeze({
  channel: '渠道',
  conversationType: '会话类型',
  senderId: '发送者标识',
  senderName: '发送者昵称',
  conversationTitle: '会话标题',
  chatId: '会话标识',
  threadId: '话题标识',
  botId: '机器人标识',
  sentAt: '发送时间',
});

const FIELD_HELP = Object.freeze({
  senderName: Object.freeze({
    labelKey: 'senderNameHelpLabel',
    text: '该字段不是每个渠道都能提供。当前消息没有发送者昵称时，即使已选择该字段，<dsh_im_source> 中也会省略 senderName。',
  }),
  conversationTitle: Object.freeze({
    labelKey: 'conversationTitleHelpLabel',
    text: '该字段不是每个渠道都能提供。钉钉群聊会带上群名。当前消息没有会话标题时，即使已选择该字段，<dsh_im_source> 中也会省略 conversationTitle。',
  }),
  chatId: Object.freeze({
    labelKey: 'chatIdHelpLabel',
    text: '该字段不是每个渠道都能提供。会话标识用于区分不同的群组或私聊，飞书群聊会带上群 ID。当前消息没有会话标识时，即使已选择该字段，<dsh_im_source> 中也会省略 chatId。',
  }),
  threadId: Object.freeze({
    labelKey: 'threadIdHelpLabel',
    text: '该字段不是每个渠道都能提供。飞书话题群的消息会带上话题 ID，用于区分同一群组内的不同话题；当前消息不在话题中时，即使已选择该字段，<dsh_im_source> 中也会省略 threadId。',
  }),
  sentAt: Object.freeze({
    labelKey: 'sentAtHelpLabel',
    text: '当前消息的发送时间，格式为 YYYY-MM-DD HH:mm:ss（本机时区）。优先使用平台给出的发送时间；平台未提供时，从微信消息 ID 中解析出发送时间；两者都不可用时，即使已选择该字段，<dsh_im_source> 中也会省略 sentAt。目前仅微信渠道提供；把本机时区写进增强提示词，模型判断先后顺序时更准确。',
  }),
});

const SCOPE_COPY = Object.freeze({
  group: Object.freeze({
    title: '群聊',
    enable: '启用',
    fieldsHelpLabel: '查看群聊来源字段说明',
    senderNameHelpLabel: '查看群聊发送者昵称字段说明',
    conversationTitleHelpLabel: '查看群聊会话标题字段说明',
    chatIdHelpLabel: '查看群聊会话标识字段说明',
    threadIdHelpLabel: '查看群聊话题标识字段说明',
    sentAtHelpLabel: '查看群聊发送时间字段说明',
    guidanceLabel: '增强提示词',
    guidanceHelpLabel: '查看群聊增强提示词使用说明',
    guidanceUsage: '用于告诉模型如何使用当前群聊消息的 <dsh_im_source> 来源字段。只填写正文，插件会自动添加 <dsh_im_source_guidance> 成对标签。',
    guidanceBehavior: '仅在群聊开关开启时使用。清空并保存后不再附加群聊增强提示词；所选来源字段仍按当前场景设置发送。',
  }),
  direct: Object.freeze({
    title: '私聊',
    enable: '启用',
    fieldsHelpLabel: '查看私聊来源字段说明',
    senderNameHelpLabel: '查看私聊发送者昵称字段说明',
    conversationTitleHelpLabel: '查看私聊会话标题字段说明',
    chatIdHelpLabel: '查看私聊会话标识字段说明',
    threadIdHelpLabel: '查看私聊话题标识字段说明',
    sentAtHelpLabel: '查看私聊发送时间字段说明',
    guidanceLabel: '增强提示词',
    guidanceHelpLabel: '查看私聊增强提示词使用说明',
    guidanceUsage: '用于告诉模型如何使用当前私聊消息的 <dsh_im_source> 来源字段。只填写正文，插件会自动添加 <dsh_im_source_guidance> 成对标签。',
    guidanceBehavior: '仅在私聊开关开启时使用。清空并保存后不再附加私聊增强提示词；所选来源字段仍按当前场景设置发送。',
  }),
});

export function contextEnhancementLabel(config) {
  const { group, direct } = normalizeContextEnhancementConfig(config);
  if (group.enabled && direct.enabled) return '群聊和私聊';
  if (group.enabled) return '仅群聊';
  if (direct.enabled) return '仅私聊';
  return '未开启';
}

function ContextIcon({ kind = 'sliders' }) {
  const path = kind === 'close' ? 'M6 6l12 12M6 18 18 6'
    : kind === 'chevron' ? 'm9 5 7 7-7 7'
      : 'M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-3M14 20H3M14 2v4M8 10v4M18 18v4';
  return h('svg', {
    width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
    'aria-hidden': 'true', focusable: 'false',
  }, h('path', { d: path }));
}

function ContextEnhancementScopeEditor({
  kind,
  scope,
  example,
  supported,
  busy,
  idPrefix,
  onChange,
}) {
  const copy = SCOPE_COPY[kind];
  const unavailableId = `${idPrefix}-${kind}-unavailable`;
  const fieldsHelpId = `${idPrefix}-${kind}-fields-help`;
  const guidanceId = `${idPrefix}-${kind}-guidance`;
  const guidanceHelpId = `${idPrefix}-${kind}-guidance-help`;
  const disabled = busy || !supported;

  return h('fieldset', {
    className: 'dim-contextSection dim-contextScope',
    'data-context-kind': kind,
    'aria-label': copy.title,
    disabled,
  },
  h('label', { className: 'dim-contextSwitchRow' },
    h('span', { className: 'dim-contextSwitchLabel' },
      h('span', null, copy.enable),
      !supported ? h('span', {
        id: unavailableId, className: 'dim-contextUnavailable',
      }, '（当前渠道不支持群聊）') : null),
    h('input', {
      type: 'checkbox', role: 'switch', className: 'dim-contextSwitch',
      checked: supported && scope.enabled,
      disabled,
      'aria-describedby': !supported ? unavailableId : undefined,
      onChange: (event) => { if (supported) onChange('enabled', event.target.checked); },
    })),
  h('div', { className: 'dim-contextScopeBlock' },
    h('div', { className: 'dim-contextLegend' },
      h('span', null, '来源字段'),
      h('span', { className: 'dim-contextHelp dim-contextLegendHelp' },
        h('button', {
          type: 'button', className: 'dim-contextHelpButton', disabled,
          'aria-label': copy.fieldsHelpLabel, 'aria-describedby': fieldsHelpId,
        }, h('span', { 'aria-hidden': 'true' }, '?')),
        h('span', { id: fieldsHelpId, className: 'dim-contextTooltip dim-contextLegendTooltip', role: 'tooltip' },
          '增强提示词中请使用字段名（如 senderId、conversationType）引用这些信息。只发送当前会话中勾选且可用的字段，不会额外查询或补全。'))),
    h('div', { className: 'dim-contextFields' }, CONTEXT_ENHANCEMENT_FIELDS.map((field) => {
      const fieldId = `${idPrefix}-${kind}-field-${field}`;
      return h('div', { key: field, className: 'dim-contextField' },
        h('input', {
          id: fieldId, type: 'checkbox', name: `${kind}-${field}`,
          checked: scope.fields.includes(field), disabled,
          onChange: (event) => onChange('fields', event.target.checked
            ? [...scope.fields, field] : scope.fields.filter((value) => value !== field)),
        }),
        h('span', { className: 'dim-contextFieldText' },
          h('label', { className: 'dim-contextFieldName', htmlFor: fieldId }, FIELD_LABELS[field]),
          FIELD_HELP[field] ? h('span', { className: 'dim-contextHelp dim-contextFieldHelp' },
            h('button', {
              type: 'button', className: 'dim-contextHelpButton dim-contextFieldHelpButton', disabled,
              'aria-label': copy[FIELD_HELP[field].labelKey],
              'aria-describedby': `${idPrefix}-${kind}-${field}-help`,
            }, h('span', { 'aria-hidden': 'true' }, '?')),
            h('span', {
              id: `${idPrefix}-${kind}-${field}-help`,
              className: 'dim-contextTooltip dim-contextFieldTooltip',
              role: 'tooltip',
            }, FIELD_HELP[field].text)) : null,
          h('label', { className: 'dim-contextFieldKey', htmlFor: fieldId }, field)));
    }))),
  h('div', { className: 'dim-contextGuidance dim-contextScopeBlock' },
    h('div', { className: 'dim-contextEditorHeader' },
      h('span', { className: 'dim-contextEditorTitle' },
        h('label', { htmlFor: guidanceId }, copy.guidanceLabel),
        h('span', { className: 'dim-contextHelp' },
          h('button', {
            type: 'button', className: 'dim-contextHelpButton', disabled,
            'aria-label': copy.guidanceHelpLabel, 'aria-describedby': guidanceHelpId,
          }, h('span', { 'aria-hidden': 'true' }, '?')),
          h('span', { id: guidanceHelpId, className: 'dim-contextTooltip dim-contextGuidanceTooltip', role: 'tooltip' },
            h('strong', null, '使用说明'),
            h('span', null, copy.guidanceUsage),
            h('strong', null, '生效规则'),
            h('span', null, copy.guidanceBehavior),
            h('strong', null, '隐私提示'),
            h('span', null, '发送者标识可能包含平台用户 ID 或电话号码形式的标识。关闭开关不会删除已经写入会话历史的信息。'),
            h('strong', null, '使用示例'),
            h('span', { className: 'dim-contextTooltipExample' }, example)))),
      h('div', { className: 'dim-contextTextActions' },
        h('button', { type: 'button', disabled, onClick: () => onChange('guidance', example) }, '填入示例'),
        h('button', { type: 'button', disabled, onClick: () => onChange('guidance', '') }, '清空'))),
    h('textarea', {
      id: guidanceId, value: scope.guidance, placeholder: example, rows: 4, disabled,
      'data-context-kind': kind,
      maxLength: CONTEXT_ENHANCEMENT_GUIDANCE_MAX_LENGTH,
      'aria-describedby': guidanceHelpId,
      onChange: (event) => onChange('guidance', event.target.value),
    })));
}

function ContextEnhancementDialog({ config, groupSupported, disabled, onSave, onClose, returnFocusRef, id }) {
  // A mounted dialog owns its draft; status refreshes must not replace unsaved edits.
  const [draft, setDraft] = React.useState(() => {
    const normalized = normalizeContextEnhancementConfig(config);
    return {
      ...normalized,
      ...(!groupSupported ? {
        group: { ...normalized.group, enabled: false },
      } : {}),
    };
  });
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [activeScope, setActiveScope] = React.useState('direct');
  const savingRef = React.useRef(false);
  const dialogRef = React.useRef(null);
  const mountedRef = React.useRef(true);
  const groupTabRef = React.useRef(null);
  const directTabRef = React.useRef(null);
  const titleId = React.useId();
  const descriptionId = React.useId();
  const scopeIdPrefix = React.useId();
  const groupGuidanceExample = localizeText(CONTEXT_GROUP_GUIDANCE_EXAMPLE);
  const directGuidanceExample = localizeText(CONTEXT_DIRECT_GUIDANCE_EXAMPLE);
  const busy = disabled || saving;
  const scopeKinds = ['direct', 'group'];
  const tabRefs = { group: groupTabRef, direct: directTabRef };

  React.useEffect(() => {
    mountedRef.current = true;
    dialogRef.current?.focus?.();
    const keepFocus = (event) => {
      if (dialogRef.current && !dialogRef.current.contains(event.target)) dialogRef.current.focus();
    };
    globalThis.document?.addEventListener?.('focusin', keepFocus);
    return () => {
      mountedRef.current = false;
      globalThis.document?.removeEventListener?.('focusin', keepFocus);
      queueMicrotask(() => returnFocusRef.current?.focus?.());
    };
  }, [returnFocusRef]);

  const changeScope = (kind, key, value) => {
    if (busy || savingRef.current) return;
    setDraft((current) => ({
      ...current,
      [kind]: { ...current[kind], [key]: value },
    }));
    setError(null);
  };

  const cancel = () => {
    if (!savingRef.current) onClose();
  };

  const activateScope = (kind, focus = false) => {
    if (busy || !scopeKinds.includes(kind)) return;
    setActiveScope(kind);
    if (focus) tabRefs[kind].current?.focus?.();
  };

  const handleTabKeyDown = (event, kind) => {
    let next;
    if (event.key === 'Home') next = scopeKinds[0];
    else if (event.key === 'End') next = scopeKinds.at(-1);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const offset = event.key === 'ArrowRight' ? 1 : -1;
      next = scopeKinds[(scopeKinds.indexOf(kind) + offset + scopeKinds.length) % scopeKinds.length];
    }
    if (!next) return;
    event.preventDefault();
    activateScope(next, true);
  };

  const save = async () => {
    if (busy || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    dialogRef.current?.focus?.();
    try {
      const next = validateContextEnhancementConfig(draft);
      await onSave(next);
      if (mountedRef.current) onClose();
    } catch (cause) {
      if (mountedRef.current) setError(cause?.message ?? '上下文增强保存失败，请重试。');
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  };

  const content = h('div', {
    className: 'dim-contextBackdrop',
    onMouseDown: (event) => { if (event.target === event.currentTarget) cancel(); },
  }, h('section', {
    id,
    ref: dialogRef,
    className: 'dim-contextDialog',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': titleId,
    'aria-describedby': descriptionId,
    'aria-busy': saving,
    tabIndex: -1,
    onKeyDown: (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }
      if (event.key !== 'Tab') return;
      const controls = dialogRef.current?.querySelectorAll?.(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled)',
      );
      if (!controls?.length) {
        event.preventDefault();
        dialogRef.current?.focus?.();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      const active = globalThis.document?.activeElement;
      if (event.shiftKey && (active === first || active === dialogRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || active === dialogRef.current)) {
        event.preventDefault();
        first.focus();
      }
    },
  },
  h('header', { className: 'dim-contextHeader' },
    h('div', { className: 'dim-contextHeaderTitle' },
      h('h3', { id: titleId }, '上下文增强'),
      h('span', { className: 'dim-contextHelp dim-contextHeaderHelp' },
        h('button', {
          type: 'button', className: 'dim-contextHelpButton', disabled: busy,
          'aria-label': '查看上下文增强说明', 'aria-describedby': descriptionId,
        }, h('span', { 'aria-hidden': 'true' }, '?')),
        h('span', { id: descriptionId, className: 'dim-contextTooltip dim-contextHeaderTooltip', role: 'tooltip' },
          '选择在哪些会话中启用、提供哪些来源字段，以及如何使用这些信息。仅使用已有消息元数据，不查询平台 API。'))),
    h('button', {
      type: 'button', className: 'dim-contextClose', 'aria-label': '关闭弹窗',
      disabled: saving, onClick: cancel,
    }, h(ContextIcon, { kind: 'close' }))),
  h('div', { className: 'dim-contextTabs', role: 'tablist', 'aria-label': '上下文增强范围' },
    scopeKinds.map((kind) => {
      const selected = activeScope === kind;
      return h('button', {
        key: kind,
        id: `${scopeIdPrefix}-${kind}-tab`,
        ref: tabRefs[kind],
        type: 'button',
        role: 'tab',
        className: 'dim-contextTab',
        'data-context-kind': kind,
        'aria-selected': selected,
        'aria-controls': `${scopeIdPrefix}-${kind}-panel`,
        tabIndex: selected ? 0 : -1,
        disabled: busy,
        onClick: () => activateScope(kind),
        onKeyDown: (event) => handleTabKeyDown(event, kind),
      }, SCOPE_COPY[kind].title);
    })),
  scopeKinds.map((kind) => h('div', {
    key: kind,
    id: `${scopeIdPrefix}-${kind}-panel`,
    className: 'dim-contextTabPanel',
    role: 'tabpanel',
    'data-context-kind': kind,
    'aria-labelledby': `${scopeIdPrefix}-${kind}-tab`,
    hidden: activeScope !== kind,
  }, h(ContextEnhancementScopeEditor, {
    kind,
    scope: draft[kind],
    example: kind === 'group' ? groupGuidanceExample : directGuidanceExample,
    supported: kind === 'group' ? groupSupported : true,
    busy,
    idPrefix: scopeIdPrefix,
    onChange: (key, value) => changeScope(kind, key, value),
  }))),
  error ? h('p', { className: 'dim-contextError', role: 'alert' }, error) : null,
  h('footer', { className: 'dim-contextFooter' },
    h('button', { type: 'button', disabled: saving, onClick: cancel }, '取消'),
    h('button', {
      type: 'button', className: 'dim-contextSave', disabled: busy,
      onClick: () => { void save(); },
    }, saving ? '保存中…' : '保存'))));

  return globalThis.document?.body ? createPortal(content, document.body) : content;
}

export function ContextEnhancementEditor({ config, groupSupported = true, disabled = false, onSave }) {
  const [open, setOpen] = React.useState(false);
  const entryRef = React.useRef(null);
  const dialogId = React.useId();
  const statusId = React.useId();
  const saved = normalizeContextEnhancementConfig(config);
  const label = contextEnhancementLabel(groupSupported ? saved : {
    ...saved, group: { ...saved.group, enabled: false },
  });

  return h(React.Fragment, null,
    h('button', {
      type: 'button', ref: entryRef, className: 'dim-contextEntry', disabled,
      'aria-label': '上下文增强', 'aria-describedby': statusId,
      'aria-haspopup': 'dialog', 'aria-expanded': open, 'aria-controls': open ? dialogId : undefined,
      onClick: () => setOpen(true),
    }, h(ContextIcon),
    h('span', { className: 'dim-contextLabel' }, '上下文增强'),
    h('span', { id: statusId, className: 'dim-contextStatus', 'data-active': label !== '未开启', 'aria-live': 'polite' }, label),
    h(ContextIcon, { kind: 'chevron' })),
    open ? h(ContextEnhancementDialog, {
      id: dialogId, config, groupSupported, disabled, onSave,
      onClose: () => setOpen(false), returnFocusRef: entryRef,
    }) : null);
}
