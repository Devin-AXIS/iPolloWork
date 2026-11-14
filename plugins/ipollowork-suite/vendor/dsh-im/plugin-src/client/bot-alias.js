import * as React from 'react';
import { createPortal } from 'react-dom';
import { MAX_BOT_ALIAS_LENGTH, validateBotAlias } from '../../src/channels/shared/bot-alias.mjs';
import { h } from './i18n.js';

function AliasDialog({ bot, onSave, onClose }) {
  const id = React.useId();
  const dialogRef = React.useRef(null);
  const inputRef = React.useRef(null);
  const savingRef = React.useRef(false);
  const [draft, setDraft] = React.useState(bot.alias ?? '');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState(null);
  React.useEffect(() => {
    const previous = globalThis.document?.activeElement;
    dialogRef.current?.showModal?.();
    inputRef.current?.focus?.();
    inputRef.current?.select?.();
    return () => { if (previous?.isConnected) previous.focus?.(); };
  }, []);
  const close = () => { if (!savingRef.current) onClose(); };
  const save = async (value) => {
    if (savingRef.current) return;
    setError(null);
    try {
      const alias = validateBotAlias(value);
      if (alias === (bot.alias ?? '')) { onClose(); return; }
      savingRef.current = true;
      setSaving(true);
      await onSave(alias);
      onClose();
    } catch (cause) {
      setError(cause?.message ?? '别名保存失败，请重试。');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const content = h('dialog', {
    ref: dialogRef, className: 'dim-aliasDialog', 'aria-labelledby': `${id}-title`,
    'aria-busy': saving,
    onCancel: (event) => { event.preventDefault(); close(); },
    onClick: (event) => event.stopPropagation(),
    onKeyDown: (event) => event.stopPropagation(),
  },
  h('div', { className: 'dim-aliasHeader' },
    h('h3', { id: `${id}-title` }, '修改别名'),
    h('button', { type: 'button', className: 'dim-aliasClose', disabled: saving,
      'aria-label': '关闭修改别名', onClick: close }, '×')),
  h('div', { className: 'dim-aliasOriginal' }, h('span', null, '原名称'),
    h('span', null, bot.originalName ?? bot.name)),
  h('label', { htmlFor: `${id}-input` }, '别名'),
  h('input', { id: `${id}-input`, ref: inputRef, value: draft, disabled: saving,
    maxLength: MAX_BOT_ALIAS_LENGTH, placeholder: '例如：客服助手',
    'aria-describedby': `${id}-help`,
    onChange: (event) => setDraft(event.target.value),
    onKeyDown: (event) => {
      if (event.key === 'Enter' && !event.nativeEvent?.isComposing) {
        event.preventDefault(); void save(draft);
      }
    },
  }),
  h('p', { id: `${id}-help`, className: 'dim-aliasHelp' }, '仅更改显示名称，留空则显示原名称。'),
  error ? h('p', { className: 'dim-aliasError', role: 'alert' }, error) : null,
  h('div', { className: 'dim-aliasFooter' },
    h('button', { type: 'button', className: 'dim-aliasRestore',
      disabled: saving || !bot.alias, onClick: () => void save('') }, '恢复原名称'),
    h('div', { className: 'dim-aliasActions' },
      h('button', { type: 'button', disabled: saving, onClick: close }, '取消'),
      h('button', { type: 'button', className: 'dim-aliasSave', disabled: saving,
        onClick: () => void save(draft) }, saving ? '保存中…' : '保存'))));
  return globalThis.document?.body ? createPortal(content, document.body) : content;
}

function BotNameTooltip({ anchorRef, id, name, onDismiss }) {
  const tooltipRef = React.useRef(null);
  const [position, setPosition] = React.useState(null);
  React.useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const tooltip = tooltipRef.current;
    if (!anchor || !tooltip) return undefined;
    const document = anchor.ownerDocument;
    const view = document.defaultView;
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const { width, height } = tooltip.getBoundingClientRect();
      const viewport = document.documentElement;
      const margin = 8;
      const below = rect.bottom + 6;
      setPosition({
        left: Math.max(margin, Math.min(rect.left, viewport.clientWidth - width - margin)),
        top: Math.max(margin, Math.min(
          below + height <= viewport.clientHeight - margin ? below : rect.top - height - 6,
          viewport.clientHeight - height - margin,
        )),
      });
    };
    const dismiss = (event) => {
      if (event.key === 'Escape') { event.stopPropagation(); onDismiss(); }
    };
    place();
    view.addEventListener('resize', place);
    // Capture nested scrolling containers as well as page scrolling.
    document.addEventListener('scroll', onDismiss, true);
    document.addEventListener('keydown', dismiss, true);
    return () => {
      view.removeEventListener('resize', place);
      document.removeEventListener('scroll', onDismiss, true);
      document.removeEventListener('keydown', dismiss, true);
    };
  }, [anchorRef, name, onDismiss]);
  const body = anchorRef.current?.ownerDocument.body;
  return body ? createPortal(h('span', {
    ref: tooltipRef, id, role: 'tooltip', className: 'dim-botNameTooltip',
    style: position ?? { visibility: 'hidden' },
  }, name), body) : null;
}

export function BotName({ bot, id, disabled = false, onSave }) {
  const [open, setOpen] = React.useState(false);
  const nameRef = React.useRef(null);
  const tooltipId = React.useId();
  const [truncated, setTruncated] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(false);
  const dismissTooltip = React.useCallback(() => setDismissed(true), []);
  const measure = React.useCallback(() => {
    const node = nameRef.current;
    setTruncated(Boolean(node && node.scrollWidth > node.clientWidth));
  }, []);
  React.useEffect(() => {
    const node = nameRef.current;
    if (!node) return undefined;
    measure();
    const view = node.ownerDocument.defaultView;
    const observer = view.ResizeObserver ? new view.ResizeObserver(measure) : null;
    observer?.observe(node);
    view.addEventListener('resize', measure);
    return () => { observer?.disconnect(); view.removeEventListener('resize', measure); };
  }, [bot.name, measure]);
  const showTooltip = truncated && !dismissed && !open && (hovered || focused);
  return h('div', { className: 'dim-aliasName' },
    h('h3', {
      id, ref: nameRef, tabIndex: truncated ? 0 : undefined,
      'aria-describedby': showTooltip ? tooltipId : undefined,
      onMouseEnter: () => { measure(); setHovered(true); setDismissed(false); },
      onMouseLeave: () => setHovered(false),
      onFocus: () => { measure(); setFocused(true); setDismissed(false); },
      onBlur: () => setFocused(false),
      onClick: dismissTooltip,
    }, bot.name),
    showTooltip ? h(BotNameTooltip, {
      anchorRef: nameRef, id: tooltipId, name: bot.name, onDismiss: dismissTooltip,
    }) : null,
    h('span', {
      className: 'dim-aliasEntry',
      onClick: (event) => event.stopPropagation(),
      onKeyDown: (event) => event.stopPropagation(),
    },
    h('button', { type: 'button', className: 'dim-aliasEdit',
      'aria-label': '修改别名', title: '修改别名', 'aria-haspopup': 'dialog',
      disabled: disabled || typeof onSave !== 'function', onClick: () => setOpen(true) },
    h('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none',
      stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
      'aria-hidden': true },
    h('path', { d: 'm16 3 5 5M3 21l5-1L21 7a2.1 2.1 0 0 0-5-5L3 15Z' }))),
    open ? h(AliasDialog, { bot, onSave, onClose: () => setOpen(false) }) : null));
}
