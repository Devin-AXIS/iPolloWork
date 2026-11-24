import type { DocxEditorChildren } from '../../docx-editor-children';
import type { ReactNode } from 'react';
// Shared insert-image wiring: hidden file input, preflight, and async dispatch.
//
// Toolbar and menu both trigger the same picker; Content attaches paste/drop to the same path.

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import {
  editorHostDocument,
  type EditorPointPosition,
  executeImageCommand,
  toolbarCommandState,
} from '@docx-editor.dev/core/editor';
import { localizeDisabledReason } from '@docx-editor.dev/i18n';
import { useTranslation } from '../../i18n';
import type { TranslationKey } from '../../i18n';
import { useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';
import { normalizeImageBytes } from './normalizeImageFile';
import { useToolbarLabel } from '../toolbar/toolbar-context';
import { chromeControlForSlot, chromeIcon, guardToolbarMousedown } from '../toolbar/ToolbarButton';
import { Slot } from '../toolbar/Slot';
import { PanelRowContent, triggerClassName, usePanelRow } from '../toolbar/panel-row';
import { usePopupConfig } from '../popup-config-context';
import { renderPopup } from '../popup-renderer';
import { DocxEditorImageInsertErrorDialog } from './ImageInsertErrorDialog';

const ACCEPT = 'image/png,image/jpeg,image/gif';

export interface ImageInsertContextValue {
  readonly openFilePicker: () => void;
  /** Pass the exact point result to retain a drop target during the file read. */
  readonly insertFromFileList: (
    files: FileList | File[] | null | undefined,
    at?: EditorPointPosition
  ) => Promise<void>;
  /** Pass the exact point result to retain a drop target during the file read. */
  readonly insertFromDataTransfer: (
    data: DataTransfer | null,
    at?: EditorPointPosition
  ) => Promise<void>;
  readonly isEnabled: boolean;
  readonly disabledReason: string | null;
  readonly inputRef: React.RefObject<HTMLInputElement | null>;
  readonly onInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

const ImageInsertContext = createContext<ImageInsertContextValue | null>(null);

export function useImageInsert(): ImageInsertContextValue {
  const context = useContext(ImageInsertContext);
  if (!context) {
    throw new Error('useImageInsert must be used within ImageInsertProvider');
  }
  return context;
}

/** Optional hook — returns null outside a provider (Content may mount without toolbar). */
export function useImageInsertOptional(): ImageInsertContextValue | null {
  return useContext(ImageInsertContext);
}

export interface ImageInsertProviderProps {
  children: ReactNode;
}

export function ImageInsertProvider({ children }: ImageInsertProviderProps) {
  const editor = useDocxEditor();
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const busyRef = useRef(false);
  const popups = usePopupConfig();
  // A refusal shows in an editor dialog. A browser alert would stop every script on the page.
  const [refusal, setRefusal] = useState<string | null>(null);
  /** A picker made in a pop-out window's document, until it reports a choice or a cancel. */
  const strayPickerRef = useRef<HTMLInputElement | null>(null);

  const selectInsertState = useCallback(
    () => toolbarCommandState(editor, 'image.insert'),
    [editor]
  );
  const insertState = useEditorState(
    selectInsertState,
    (a, b) => a.enabled === b.enabled && a.disabledReason === b.disabledReason
  );
  const isEnabled = insertState.enabled;
  const disabledReason = localizeDisabledReason(insertState.disabledReason, t);

  const insertBytes = useCallback(
    async (bytes: Uint8Array, at?: EditorPointPosition) => {
      if (!editor) return;
      if (busyRef.current) {
        setRefusal(t('imageInsert.errors.refused'));
        return;
      }
      const normalized = normalizeImageBytes(bytes);
      if (!normalized.ok) {
        setRefusal(t(normalized.reasonKey as TranslationKey));
        return;
      }
      const command = {
        type: 'insertImage' as const,
        data: normalized.bytes,
        mime: normalized.mime,
        widthPoints: normalized.widthPoints,
        heightPoints: normalized.heightPoints,
        ...(at ? { at } : {}),
      };
      // `executeImageCommand` applies the same checks and reports a refusal to diagnostics.
      busyRef.current = true;
      try {
        const result = await executeImageCommand(editor, command);
        if (!result.ok) {
          setRefusal(
            localizeDisabledReason(readableReason(result.reason) ?? null, t) ??
              t('imageInsert.errors.refused')
          );
        } else if (!at) {
          editor.focus();
        }
      } finally {
        busyRef.current = false;
      }
    },
    [editor, t]
  );

  const insertFromFileList = useCallback(
    async (files: FileList | File[] | null | undefined, at?: EditorPointPosition) => {
      const file = files?.[0];
      if (!file) return;
      let buffer: ArrayBuffer;
      try {
        buffer = await file.arrayBuffer();
      } catch {
        setRefusal(t('imageInsert.errors.refused'));
        return;
      }
      await insertBytes(new Uint8Array(buffer), at);
    },
    [insertBytes, t]
  );

  const insertFromDataTransfer = useCallback(
    async (data: DataTransfer | null, at?: EditorPointPosition) => {
      if (!data) return;
      const file = [...data.files].find((candidate) => candidate.type.startsWith('image/'));
      if (file) {
        await insertFromFileList([file], at);
        return;
      }
      for (const item of data.items) {
        if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
        const blob = item.getAsFile();
        if (!blob) continue;
        await insertFromFileList([blob], at);
        return;
      }
    },
    [insertBytes, insertFromFileList]
  );

  const openFilePicker = useCallback(() => {
    if (!isEnabled) return;
    const input = inputRef.current;
    const hostDocument = editor ? editorHostDocument(editor) : null;
    if (!hostDocument || !input || input.ownerDocument === hostDocument) {
      input?.click();
      return;
    }
    // The editor is in another window (a pop-out): a file picker opens only from an input in
    // the window the user clicked in, so this one is made there and removed once it answers.
    strayPickerRef.current?.remove();
    const picker = hostDocument.createElement('input');
    picker.type = 'file';
    picker.accept = ACCEPT;
    picker.hidden = true;
    picker.tabIndex = -1;
    picker.setAttribute('aria-hidden', 'true');
    const done = () => {
      picker.remove();
      if (strayPickerRef.current === picker) strayPickerRef.current = null;
    };
    picker.addEventListener('change', () => void insertFromFileList(picker.files).finally(done), {
      once: true,
    });
    picker.addEventListener('cancel', done, { once: true });
    hostDocument.body.append(picker);
    strayPickerRef.current = picker;
    picker.click();
  }, [editor, isEnabled, insertFromFileList]);

  const onInputChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const input = event.currentTarget;
      await insertFromFileList(input.files);
      input.value = '';
    },
    [insertFromFileList]
  );

  const value = useMemo(
    (): ImageInsertContextValue => ({
      openFilePicker,
      insertFromFileList,
      insertFromDataTransfer,
      isEnabled,
      disabledReason,
      inputRef,
      onInputChange,
    }),
    [
      openFilePicker,
      insertFromFileList,
      insertFromDataTransfer,
      isEnabled,
      disabledReason,
      onInputChange,
    ]
  );

  return (
    <ImageInsertContext.Provider value={value}>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="docx-image-insert__input"
        tabIndex={-1}
        aria-hidden="true"
        onChange={onInputChange}
        onMouseDown={(event) => event.stopPropagation()}
      />
      {children}
      {refusal !== null &&
        (popups?.imageInsertError !== undefined ? (
          renderPopup(popups.imageInsertError, {
            message: refusal,
            onClose: () => setRefusal(null),
          })
        ) : (
          <DocxEditorImageInsertErrorDialog message={refusal} onClose={() => setRefusal(null)} />
        ))}
    </ImageInsertContext.Provider>
  );
}

/** Props for the toolbar/menu insert trigger. @public */
export interface ImageInsertTriggerProps {
  className?: string;
  hidden?: boolean;
  asChild?: boolean;
  children?: DocxEditorChildren;
}

/** Toolbar insert-image control — opens the shared file picker. @public */
export function ImageInsertTrigger({
  className,
  hidden,
  asChild,
  children,
}: ImageInsertTriggerProps) {
  const { openFilePicker, isEnabled, disabledReason } = useImageInsert();
  const label = useToolbarLabel();
  const panelRow = usePanelRow(asChild, children);
  if (hidden) return null;
  const control = chromeControlForSlot('image.insert');
  const text = label(control?.labelKey ?? 'toolbar.image');
  const shared = {
    type: 'button' as const,
    className: `${triggerClassName(panelRow)}${className ? ` ${className}` : ''}`,
    'data-slot': 'image.insert',
    disabled: !isEnabled,
    ...(!isEnabled ? { 'data-disabled': '' } : {}),
    'aria-label': text,
    title: disabledReason ?? text,
    onMouseDown: guardToolbarMousedown,
    onClick: openFilePicker,
  };
  if (asChild) return <Slot {...shared}>{children}</Slot>;
  const icon = chromeIcon(control?.paths);
  return (
    <button {...shared}>
      {panelRow ? <PanelRowContent icon={icon} label={text} /> : (children ?? icon)}
    </button>
  );
}

ImageInsertTrigger.docxSlot = 'image.insert' as const;

export const ToolbarImageInsert = Object.assign(ImageInsertTrigger, {
  docxSlot: 'image.insert' as const,
});

/** A reason written for people, or undefined for a bare code such as `invalid-range`. */
function readableReason(reason: string | undefined): string | undefined {
  return reason && /\s/.test(reason) ? reason : undefined;
}
