import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  contentControlPopupOpener,
  observeContentControlPopup,
  contentControlPopupKeyDown,
  type ContentControlWidgetSession,
} from '@docx-editor.dev/core/editor';
import type { DocxEditorChildren } from '../docx-editor-children';
import { useFormControlTranslate } from './form-control-translate';
import {
  ContentControlWidgetProvider,
  useContentControlWidgetState,
  type UseContentControlWidgetResult,
} from './content-control-widget/context';
import {
  ContentControlWidgetNavigation,
  ContentControlWidgetMonth,
  ContentControlWidgetYear,
  ContentControlWidgetApply,
  ContentControlWidgetCalendar,
  ContentControlWidgetCancel,
  ContentControlWidgetDay,
  ContentControlWidgetError,
  ContentControlWidgetFooter,
  ContentControlWidgetGrid,
  ContentControlWidgetHeader,
  ContentControlWidgetInput,
  ContentControlWidgetItem,
  ContentControlWidgetList,
  ContentControlWidgetNextMonth,
  ContentControlWidgetPicture,
  ContentControlWidgetPreviousMonth,
  ContentControlWidgetTitle,
  ContentControlWidgetToday,
  ContentControlWidgetWeekdays,
} from './content-control-widget/parts';

/** Value-widget session and optional replacement controls. @public */
export interface DocxEditorContentControlWidgetProps {
  session: ContentControlWidgetSession;
  className?: string;
  style?: CSSProperties;
  /**
   * Replaces the packaged arrangement. Compose it from the compound's parts
   * (`DocxEditorContentControlWidget.Calendar`, `.List`, …) or from `useContentControlWidget()`.
   */
  children?: DocxEditorChildren;
}

/**
 * The packaged value pop-up for a dropdown, combo-box, date, building block gallery,
 * checkbox or picture content control.
 *
 * Anchored below the control inside the editor's scroll container. Without `children` it
 * renders the same arrangement the engine paints on its own — a list, a list with free-text
 * entry, or a month calendar with a Today button — from the same stylesheet classes, so one
 * theme covers both. A checkbox session applies its toggle at once and shows nothing; a
 * picture session opens the browser's file dialog and retains a retry input and Cancel action.
 * @public
 */
function ContentControlWidgetRoot(props: DocxEditorContentControlWidgetProps) {
  const [session, setSession] = useState(props.session);
  const [generation, setGeneration] = useState(0);
  if (session !== props.session) {
    setSession(props.session);
    setGeneration(generation + 1);
  }
  return <WidgetPanel key={generation} {...props} />;
}

function WidgetPanel({ session, className, style, children }: DocxEditorContentControlWidgetProps) {
  const t = useFormControlTranslate();
  const widget = useContentControlWidgetState(session);
  const [closed, setClosed] = useState(session.signal.aborted);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [opener] = useState(() => contentControlPopupOpener(session.anchor));

  // A checkbox has no pop-up: the packaged arrangement IS the toggle, so configuring this
  // popup for a restyled dropdown never makes checkboxes stop working. A host that renders
  // its own children owns the decision instead.
  const immediate = session.kind === 'checkbox' && children === undefined;
  useEffect(() => {
    const abort = () => setClosed(true);
    session.signal.addEventListener('abort', abort, { once: true });
    if (session.signal.aborted) abort();
    return () => session.signal.removeEventListener('abort', abort);
  }, [session]);
  useEffect(() => {
    if (!immediate || session.signal.aborted) return;
    session.apply(session.value === 'true' ? 'false' : 'true');
  }, [immediate, session]);
  useLayoutEffect(() => {
    if (closed || immediate) return;
    const panel = panelRef.current;
    const owner = panel?.ownerDocument;
    const stopPosition =
      panel && session.anchor ? observeContentControlPopup(panel, session.anchor) : undefined;
    // The calendar grid places its own roving focus; everything else takes the first control.
    if (!panel?.querySelector('[data-docx-part="grid"]')) {
      (
        panel?.querySelector<HTMLElement>('input') ??
        panel?.querySelector<HTMLElement>('[role=option][tabindex="0"]') ??
        panel?.querySelector<HTMLElement>('select,button,[data-docx-part=empty]')
      )?.focus({ preventScroll: true });
    }
    return () => {
      stopPosition?.();
      const active = owner?.activeElement;
      if (opener?.isConnected && (active === owner?.body || (active && panel?.contains(active)))) {
        opener.focus({ preventScroll: true });
      }
    };
  }, [session, closed, immediate, opener]);
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || closed || immediate) return;
    const dismiss = (event: PointerEvent) => {
      if (!panel.contains(event.target as Node)) session.cancel();
    };
    panel.ownerDocument.addEventListener('pointerdown', dismiss, true);
    return () => panel.ownerDocument.removeEventListener('pointerdown', dismiss, true);
  }, [session, closed, immediate]);
  if (closed || immediate) return null;
  const label = t(`contentControl.types.${session.kind}`);
  return (
    <ContentControlWidgetProvider value={widget}>
      <div
        ref={panelRef}
        role="dialog"
        aria-label={label}
        className={`docx-content-control-widget-popup${className ? ` ${className}` : ''}`}
        style={style}
        data-docx-popup="contentControlWidget"
        data-docx-part="popup"
        data-kind={session.kind}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          contentControlPopupKeyDown(event.currentTarget, event.nativeEvent, session.cancel);
          widget.listNavigation.keyDown(event.nativeEvent, event.currentTarget);
        }}
      >
        {children ?? defaultArrangement(widget)}
      </div>
    </ContentControlWidgetProvider>
  );
}

function defaultArrangement(widget: UseContentControlWidgetResult): ReactNode {
  if (widget.kind === 'date') return <ContentControlWidgetCalendar />;
  if (widget.kind === 'picture')
    return (
      <>
        <ContentControlWidgetPicture />
        <ContentControlWidgetError />
        <ContentControlWidgetCancel />
      </>
    );
  if (widget.kind === 'comboBox') {
    return (
      <>
        <ContentControlWidgetInput />
        <ContentControlWidgetList />
        <ContentControlWidgetError />
        <ContentControlWidgetFooter />
      </>
    );
  }
  return (
    <>
      <ContentControlWidgetList />
      <ContentControlWidgetError />
    </>
  );
}

/** The compound pop-up with its parts attached as statics. @public */
export interface DocxEditorContentControlWidgetNamespace {
  (props: DocxEditorContentControlWidgetProps): ReactNode;
  readonly Navigation: typeof ContentControlWidgetNavigation;
  readonly Month: typeof ContentControlWidgetMonth;
  readonly Year: typeof ContentControlWidgetYear;
  readonly Calendar: typeof ContentControlWidgetCalendar;
  readonly Header: typeof ContentControlWidgetHeader;
  readonly PreviousMonth: typeof ContentControlWidgetPreviousMonth;
  readonly Title: typeof ContentControlWidgetTitle;
  readonly NextMonth: typeof ContentControlWidgetNextMonth;
  readonly Weekdays: typeof ContentControlWidgetWeekdays;
  readonly Grid: typeof ContentControlWidgetGrid;
  readonly Day: typeof ContentControlWidgetDay;
  readonly Today: typeof ContentControlWidgetToday;
  readonly List: typeof ContentControlWidgetList;
  readonly Item: typeof ContentControlWidgetItem;
  readonly Input: typeof ContentControlWidgetInput;
  readonly Picture: typeof ContentControlWidgetPicture;
  readonly Error: typeof ContentControlWidgetError;
  readonly Footer: typeof ContentControlWidgetFooter;
  readonly Apply: typeof ContentControlWidgetApply;
  readonly Cancel: typeof ContentControlWidgetCancel;
}

/** Compact value editor for a configured content-control popup. @public */
export const DocxEditorContentControlWidget: DocxEditorContentControlWidgetNamespace =
  Object.assign(ContentControlWidgetRoot, {
    Navigation: ContentControlWidgetNavigation,
    Month: ContentControlWidgetMonth,
    Year: ContentControlWidgetYear,
    Calendar: ContentControlWidgetCalendar,
    Header: ContentControlWidgetHeader,
    PreviousMonth: ContentControlWidgetPreviousMonth,
    Title: ContentControlWidgetTitle,
    NextMonth: ContentControlWidgetNextMonth,
    Weekdays: ContentControlWidgetWeekdays,
    Grid: ContentControlWidgetGrid,
    Day: ContentControlWidgetDay,
    Today: ContentControlWidgetToday,
    List: ContentControlWidgetList,
    Item: ContentControlWidgetItem,
    Input: ContentControlWidgetInput,
    Picture: ContentControlWidgetPicture,
    Error: ContentControlWidgetError,
    Footer: ContentControlWidgetFooter,
    Apply: ContentControlWidgetApply,
    Cancel: ContentControlWidgetCancel,
  });
