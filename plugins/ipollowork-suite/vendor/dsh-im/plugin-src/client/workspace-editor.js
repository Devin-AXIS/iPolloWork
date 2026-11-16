import * as React from 'react';

import { h } from './i18n.js';
import { WorkspaceDirectoryPicker } from './workspace-directory-picker.js';

export const WorkspaceDirectoryPickerContext = React.createContext(null);

export function WorkspaceEditor({ workspace, directoryPicker, disabled = false, locked = false, onSave }) {
  const sharedDirectoryPicker = React.useContext(WorkspaceDirectoryPickerContext);
  const activeDirectoryPicker = directoryPicker ?? sharedDirectoryPicker;
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState(null);
  const editButtonRef = React.useRef(null);
  const savingRef = React.useRef(false);

  const close = React.useCallback(() => {
    setOpen(false);
    setError(null);
    queueMicrotask(() => editButtonRef.current?.focus?.());
  }, []);

  const pick = React.useCallback(async (value) => {
    if (!value || savingRef.current || disabled || locked) return;
    if (value === workspace) {
      close();
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await onSave?.(value);
      close();
    } catch (cause) {
      setError(cause?.message ?? '工作区修改失败，请重试。');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [close, disabled, locked, onSave, workspace]);

  return h('div', { className: 'dim-workspace' },
    h('div', { className: 'dim-workspaceHeader' },
      h('span', null, '当前工作区'),
      h('button', {
        type: 'button',
        ref: editButtonRef,
        className: 'dim-workspaceEdit',
        onClick: () => { setOpen(true); setError(null); },
        disabled: disabled || locked || !activeDirectoryPicker,
        title: locked ? '会话目录隔离已开启，工作区由对话自动分配。' : undefined,
      }, '选择目录')),
    workspace
      ? React.createElement('code', {
          className: 'dim-workspacePath',
          title: workspace,
        }, workspace)
      : h('code', { className: 'dim-workspacePath' }, '未设置'),
    open ? h(WorkspaceDirectoryPicker, {
      open,
      startPath: workspace,
      picker: activeDirectoryPicker,
      busy: saving || disabled || locked,
      saveError: error,
      onPicked: pick,
      onCancel: close,
    }) : null,
  );
}
