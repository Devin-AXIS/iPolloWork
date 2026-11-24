import type { DocxEditorChildren } from '../docx-editor-children';
import type { ReactNode } from 'react';
// `DocxEditor.ContentControl` — the control inspector and remove-keeping-content action.
//
// Reports alias, tag, type, lock, placeholder, and bound state for the control at the
// caret. Typed widgets (dropdown / combo / date / checkbox) stay in the engine when list
// and date payloads are not public on the summary — this panel does not invent them.
//
// CUSTOMIZATION LADDER, matching `DocxEditor.HyperLink`:
//
//   1. `className` / `data-*`      restyle with CSS
//   2. `asChild`                   merge wiring onto a consumer element
//   3. in-place part override      `<ContentControl.Remove>` replaces that part;
//                                  `hidden` removes; `preset={false}` drops defaults
//   4. `useContentControl()`       the raw hook
//
// Every string is an i18n key. Test ids are stable and unlocalized.

import { useEffect, useId, useRef } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from '../i18n';
import { useContentControl, type ContentControlInspectorState } from './useContentControl';
import { Slot } from './toolbar/Slot';
import { hostDocumentOf, listenForOutsidePress } from '@docx-editor.dev/core/editor';

/** Keeps the caret: a mousedown that bubbles to the editor moves it. Inputs are exempt. */
function guardMousedown(event: React.MouseEvent): void {
  const tag = (event.target as HTMLElement | null)?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  event.preventDefault();
}

/** Shared props for every part. @public */
export interface ContentControlPartProps {
  className?: string;
  asChild?: boolean;
  hidden?: boolean;
  children?: DocxEditorChildren;
}

/** Props for action parts that also take an icon. @public */
export interface ContentControlActionProps extends ContentControlPartProps {
  icon?: DocxEditorChildren;
}

/** Props for `DocxEditor.ContentControl`. @public */
export interface ContentControlProps extends ContentControlPartProps {
  /**
   * Render the packaged arrangement. `false` mounts only the shell and whatever parts
   * you pass as children.
   */
  preset?: boolean;
}

const icon = (path: string): ReactNode => (
  <svg viewBox="0 -960 960 960" width={16} height={16} aria-hidden="true" focusable="false">
    <path d={path} fill="currentColor" />
  </svg>
);

const CLOSE_ICON =
  'm256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z';
const REMOVE_ICON =
  'M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z';

const panelStyle: CSSProperties = {
  position: 'absolute',
  zIndex: 20,
  minWidth: 240,
  maxWidth: 320,
  top: 12,
  right: 12,
  padding: 12,
  borderRadius: 8,
  border: '1px solid var(--doc-border)',
  backgroundColor: 'var(--doc-surface)',
  boxShadow: '0 4px 16px var(--doc-shadow)',
  color: 'var(--doc-text)',
  fontSize: 13,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const rowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  alignItems: 'baseline',
};

const labelStyle: CSSProperties = {
  color: 'var(--doc-text-muted)',
  flexShrink: 0,
};

const valueStyle: CSSProperties = {
  textAlign: 'right',
  wordBreak: 'break-word',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  fontWeight: 600,
};

const actionsStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  marginTop: 4,
};

const buttonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 10px',
  borderRadius: 4,
  border: '1px solid var(--doc-border)',
  backgroundColor: 'var(--doc-bg)',
  color: 'var(--doc-text)',
  font: 'inherit',
  cursor: 'pointer',
};

function typeLabelKey(type: ContentControlInspectorState['controlType']): string {
  switch (type) {
    case 'plainText':
      return 'contentControl.types.plainText';
    case 'checkbox':
      return 'contentControl.types.checkbox';
    case 'dropdown':
      return 'contentControl.types.dropdown';
    case 'comboBox':
      return 'contentControl.types.comboBox';
    case 'date':
      return 'contentControl.types.date';
    case 'picture':
      return 'contentControl.types.picture';
    case 'buildingBlockGallery':
      return 'contentControl.types.buildingBlockGallery';
    case 'repeatingSection':
      return 'contentControl.types.repeatingSection';
    case 'richText':
    default:
      return 'contentControl.types.richText';
  }
}

function lockLabelKey(control: ContentControlInspectorState): string {
  if (control.effectiveLock === 'sdtContentLocked') {
    return 'contentControl.lock.sdtContentLocked';
  }
  if (control.effectiveLock === 'contentLocked' || control.locked) {
    return 'contentControl.lock.contentLocked';
  }
  if (control.effectiveLock === 'sdtLocked' || control.removalLocked) {
    return 'contentControl.lock.sdtLocked';
  }
  return 'contentControl.lock.unlocked';
}

function Field({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div style={rowStyle} data-testid={testId}>
      <span style={labelStyle}>{label}</span>
      <span style={valueStyle}>{value}</span>
    </div>
  );
}

function ContentControlRoot({
  className,
  asChild,
  hidden,
  children,
  preset = true,
}: ContentControlProps) {
  const chrome = useContentControl();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const { t } = useTranslation();
  const { control, inspectorOpen, closeInspector } = chrome;

  useEffect(() => {
    if (!inspectorOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeInspector();
    };
    const doc = hostDocumentOf(panelRef.current);
    doc.addEventListener('keydown', onKeyDown);
    // Membership reads the ref at press time, like the panel's other handlers.
    const stopPress = listenForOutsidePress({
      popup: doc,
      contains: (node) => panelRef.current?.contains(node) === true,
      close: closeInspector,
    });
    return () => {
      doc.removeEventListener('keydown', onKeyDown);
      stopPress();
    };
  }, [inspectorOpen, closeInspector]);

  // Close when the caret leaves every control — the panel has nothing to report.
  useEffect(() => {
    if (inspectorOpen && !control) closeInspector();
  }, [inspectorOpen, control, closeInspector]);

  if (hidden || !inspectorOpen || !control) return null;

  const body = preset ? (
    <>
      <ContentControlHeader />
      <ContentControlFields />
      <div style={actionsStyle}>
        <ContentControlRemove />
      </div>
      {children}
    </>
  ) : (
    children
  );

  const shared = {
    ref: panelRef,
    role: 'dialog' as const,
    'aria-modal': false as const,
    'aria-labelledby': titleId,
    'data-testid': 'content-control-inspector',
    'data-control-id': control.id,
    'data-control-type': control.controlType,
    ...(control.locked ? { 'data-locked': '' } : {}),
    ...(control.bound ? { 'data-bound': '' } : {}),
    ...(control.placeholder ? { 'data-placeholder': '' } : {}),
    className: `docx-content-control-inspector${className ? ` ${className}` : ''}`,
    style: panelStyle,
    onMouseDown: (event: React.MouseEvent) => {
      guardMousedown(event);
      event.stopPropagation();
    },
  };

  const titled = (
    <>
      <span id={titleId} className="docx-editor-sr-only">
        {t('contentControl.inspectorPanel.title')}
      </span>
      {body}
    </>
  );

  if (asChild) return <Slot {...shared}>{titled}</Slot>;
  return <div {...shared}>{titled}</div>;
}

function ContentControlHeader({ className, asChild, hidden, children }: ContentControlPartProps) {
  const { closeInspector } = useContentControl();
  const { t } = useTranslation();
  if (hidden) return null;
  const shared = {
    style: headerStyle,
    className: className ?? undefined,
    'data-testid': 'content-control-inspector-header',
  };
  const content = (
    <>
      <span>{children ?? t('contentControl.inspectorPanel.title')}</span>
      <button
        type="button"
        data-testid="content-control-inspector-close"
        aria-label={t('common.close')}
        title={t('common.close')}
        style={{
          ...buttonStyle,
          padding: 4,
          border: 'none',
          background: 'transparent',
        }}
        onMouseDown={guardMousedown}
        onClick={() => closeInspector()}
      >
        {icon(CLOSE_ICON)}
      </button>
    </>
  );
  if (asChild) return <Slot {...shared}>{content}</Slot>;
  return <div {...shared}>{content}</div>;
}

function ContentControlFields({ className, asChild, hidden, children }: ContentControlPartProps) {
  const { control } = useContentControl();
  const { t } = useTranslation();
  if (hidden || !control) return null;

  const empty = t('contentControl.inspectorPanel.empty');
  const yes = t('contentControl.inspectorPanel.yes');
  const no = t('contentControl.inspectorPanel.no');

  const fields = children ?? (
    <>
      <Field
        label={t('contentControl.inspectorPanel.alias')}
        value={control.alias ?? empty}
        testId="content-control-inspector-alias"
      />
      <Field
        label={t('contentControl.inspectorPanel.tag')}
        value={control.tag ?? empty}
        testId="content-control-inspector-tag"
      />
      <Field
        label={t('contentControl.inspectorPanel.type')}
        value={t(typeLabelKey(control.controlType) as 'contentControl.types.richText')}
        testId="content-control-inspector-type"
      />
      <Field
        label={t('contentControl.inspectorPanel.lock')}
        value={t(lockLabelKey(control) as 'contentControl.lock.unlocked')}
        testId="content-control-inspector-lock"
      />
      <Field
        label={t('contentControl.inspectorPanel.placeholder')}
        value={control.placeholder ? yes : no}
        testId="content-control-inspector-placeholder"
      />
      <Field
        label={t('contentControl.inspectorPanel.bound')}
        value={control.bound ? yes : no}
        testId="content-control-inspector-bound"
      />
      {control.bound ? (
        <p
          data-testid="content-control-inspector-bound-note"
          style={{ margin: 0, color: 'var(--doc-text-muted)', fontSize: 12 }}
        >
          {t('contentControl.inspectorPanel.boundNote')}
        </p>
      ) : null}
      {control.locked ? (
        <p
          data-testid="content-control-inspector-locked-note"
          style={{ margin: 0, color: 'var(--doc-text-muted)', fontSize: 12 }}
          aria-live="polite"
        >
          {t('contentControl.inspectorPanel.lockedNote')}
        </p>
      ) : null}
    </>
  );

  const shared = {
    className: className ?? undefined,
    'data-testid': 'content-control-inspector-fields',
    style: { display: 'flex', flexDirection: 'column' as const, gap: 8 },
  };
  if (asChild) return <Slot {...shared}>{fields}</Slot>;
  return <div {...shared}>{fields}</div>;
}

function ContentControlRemove({
  className,
  asChild,
  hidden,
  icon: iconOverride,
  children,
}: ContentControlActionProps) {
  const { canRemove, removeDisabledReason, remove, closeInspector } = useContentControl();
  const { t } = useTranslation();
  if (hidden) return null;

  const label = t('contentControl.remove');
  const shared = {
    type: 'button' as const,
    className: `docx-content-control-inspector__remove${className ? ` ${className}` : ''}`,
    'data-testid': 'content-control-inspector-remove',
    'data-slot': 'contentControl.remove',
    disabled: !canRemove,
    ...(!canRemove ? { 'data-disabled': '' } : {}),
    'aria-label': label,
    title: removeDisabledReason ?? label,
    style: buttonStyle,
    onMouseDown: guardMousedown,
    onClick: () => {
      const result = remove();
      if (result.ok) closeInspector();
    },
  };

  const content = (
    <>
      {iconOverride ?? children ?? icon(REMOVE_ICON)}
      <span>{label}</span>
    </>
  );

  if (asChild) return <Slot {...shared}>{content}</Slot>;
  return <button {...shared}>{content}</button>;
}

/**
 * The content-control inspector compound. Parts live on the namespace statics.
 *
 * @public
 */
export interface DocxEditorContentControlNamespace {
  (props: ContentControlProps): ReturnType<typeof ContentControlRoot>;
  readonly Header: typeof ContentControlHeader;
  readonly Fields: typeof ContentControlFields;
  readonly Remove: typeof ContentControlRemove;
}

export const DocxEditorContentControl: DocxEditorContentControlNamespace = Object.assign(
  ContentControlRoot,
  {
    Header: ContentControlHeader,
    Fields: ContentControlFields,
    Remove: ContentControlRemove,
  }
);
