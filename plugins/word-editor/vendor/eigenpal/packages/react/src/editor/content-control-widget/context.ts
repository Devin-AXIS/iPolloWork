import { DEFAULT_IMAGE_RESOURCE_LIMITS } from '@docx-editor.dev/core/store';
import { useId, createContext, useCallback, useContext, useMemo, useState } from 'react';
import {
  CONTENT_CONTROL_PICTURE_ACCEPT,
  calendarMonth,
  calendarDateText,
  calendarDateFromText,
  createContentControlListNavigation,
  type ContentControlListNavigation,
  isoDateOf,
  parseIsoDate,
  shiftMonth,
  type CalendarMonth,
  type ContentControlWidgetSession,
} from '@docx-editor.dev/core/editor';
import { useEditorState } from '../useEditorState';

/** One selectable entry of a dropdown or combo-box control. @public */
export interface ContentControlWidgetEntry {
  readonly displayText: string;
  readonly value: string;
}

/**
 * The draft state a content-control value pop-up renders over.
 *
 * Read it from `useContentControlWidget()` inside `DocxEditorContentControlWidget`, or from a
 * fully custom `popups.contentControlWidget` renderer that mounts the provider through the
 * packaged root. `value` is the draft; `apply()` commits it through the session, which the
 * engine validates. The calendar members drive the date picker: `calendar` is the month in
 * view, built for the session's locale.
 * @public
 */
export interface UseContentControlWidgetResult {
  readonly session: ContentControlWidgetSession;
  readonly kind: ContentControlWidgetSession['kind'];
  readonly items: readonly ContentControlWidgetEntry[];
  readonly value: string;
  setValue(value: string): void;
  /** The engine still accepts a write for this control. */
  readonly isEnabled: boolean;
  /** The last `apply()` was refused by the engine. */
  readonly refused: boolean;
  /** Commit `value`, or an explicit one; false when the engine refused it. */
  apply(value?: string): boolean;
  cancel(): void;
  readonly calendar: CalendarMonth;
  previousMonth(): void;
  nextMonth(): void;
  /** Commit one calendar day (`YYYY-MM-DD`). */
  selectDay(iso: string): boolean;
  /** Commit the current local date. */
  selectToday(): boolean;
  /** The day keyboard focus should land on after the grid renders, if any. */
  readonly focusIso: string | null;
  /** Move keyboard focus to a day, turning the month if it lies outside the view. */
  focusDay(iso: string): void;
  /** Numeric regional date entry, separate from the ISO value. */
  readonly dateText: string;
  setDateText(text: string): void;
  applyDateText(): boolean;
  /** Jump to a month without committing. Month is zero-based; year is 100–9999. */
  showMonth(year: number, month: number): void;
  /** ID shared by the combo input and listbox. */
  readonly listId: string;
  /** Shared typeahead and roving-focus behavior for replacement lists. */
  readonly listNavigation: ContentControlListNavigation;
  /** Picture sessions: the image types `replaceImage` takes, as a file input `accept` list. */
  readonly accept: string;
  /**
   * Picture sessions: replace the control's image from a file or its bytes. The engine
   * checks the format and size; false (and `refused`) when it declines or the session is
   * not a picture session.
   */
  replaceImage(source: Blob | Uint8Array): Promise<boolean>;
}

const Context = createContext<UseContentControlWidgetResult | null>(null);

/** Provider for the parts; the packaged root mounts it. @internal */
export const ContentControlWidgetProvider = Context.Provider;

/** Draft state of the enclosing content-control value pop-up. @public */
export function useContentControlWidget(): UseContentControlWidgetResult {
  const context = useContext(Context);
  if (!context) {
    throw new globalThis.Error(
      'useContentControlWidget must be rendered inside DocxEditorContentControlWidget.'
    );
  }
  return context;
}

function initialValue(session: ContentControlWidgetSession): string {
  return session.kind === 'date'
    ? parseIsoDate(session.value)
      ? session.value.slice(0, 10)
      : ''
    : session.value;
}

/** Build the draft state for one session; remounted per session by the root. @internal */
export function useContentControlWidgetState(
  session: ContentControlWidgetSession
): UseContentControlWidgetResult {
  const listId = `docx-cc-list-${useId()}`;
  const [value, setValue] = useState(() => initialValue(session));
  const [dateText, setDateTextDraft] = useState(() =>
    calendarDateText(session.value, session.locale)
  );
  const listNavigation = useMemo(
    () => createContentControlListNavigation(session.locale),
    [session]
  );
  const [refused, setRefused] = useState(false);
  const setDateText = useCallback((text: string) => {
    setDateTextDraft(text);
    setRefused(false);
  }, []);
  const isEnabled = useEditorState(() => session.canApply());
  const selected = session.kind === 'date' ? parseIsoDate(session.value) : null;
  const [view, setView] = useState(() => {
    const start = selected ?? new Date();
    return { year: start.getFullYear(), month: start.getMonth() };
  });
  const apply = useCallback(
    (next?: string) => {
      const accepted = session.apply(next ?? value);
      setRefused(!accepted);
      return accepted;
    },
    [session, value]
  );
  const cancel = useCallback(() => session.cancel(), [session]);
  const replaceImage = useCallback(
    async (source: Blob | Uint8Array) => {
      if (!session.replaceImage) {
        setRefused(true);
        return false;
      }
      try {
        const size = source instanceof Uint8Array ? source.byteLength : source.size;
        if (!session.canApply() || size > DEFAULT_IMAGE_RESOURCE_LIMITS.maxEncodedBytes) {
          setRefused(true);
          return false;
        }
        const bytes =
          source instanceof Uint8Array ? source : new Uint8Array(await source.arrayBuffer());
        const accepted = await session.replaceImage(bytes);
        setRefused(!accepted);
        return accepted;
      } catch {
        setRefused(true);
        return false;
      }
    },
    [session]
  );
  const calendar = useMemo(
    () =>
      calendarMonth(view.year, view.month, {
        locale: session.locale,
        selected: session.kind === 'date' ? session.value : null,
      }),
    [view, session]
  );
  const previousMonth = useCallback(() => {
    setView((current) => shiftMonth(current.year, current.month, -1));
    setFocusIso(null);
  }, []);
  const nextMonth = useCallback(() => {
    setView((current) => shiftMonth(current.year, current.month, 1));
    setFocusIso(null);
  }, []);
  const selectDay = useCallback((iso: string) => apply(iso), [apply]);
  const selectToday = useCallback(() => apply(isoDateOf(new Date())), [apply]);
  const [focusIso, setFocusIso] = useState<string | null>(null);
  const focusDay = useCallback((iso: string) => {
    const date = parseIsoDate(iso);
    if (!date) return;
    setView({ year: date.getFullYear(), month: date.getMonth() });
    setFocusIso(isoDateOf(date));
  }, []);
  const applyDateText = useCallback(() => {
    const iso = calendarDateFromText(dateText, session.locale);
    if (!iso) {
      setRefused(true);
      return false;
    }
    return apply(iso);
  }, [dateText, session.locale, apply]);
  const showMonth = useCallback((year: number, month: number) => {
    if (
      !Number.isInteger(year) ||
      year < 100 ||
      year > 9999 ||
      !Number.isInteger(month) ||
      month < 0 ||
      month > 11
    )
      return;
    setView({ year, month });
    setFocusIso(null);
  }, []);
  return useMemo(
    () => ({
      session,
      kind: session.kind,
      items: session.items,
      value,
      setValue,
      isEnabled,
      refused,
      apply,
      cancel,
      calendar,
      previousMonth,
      nextMonth,
      selectDay,
      selectToday,
      focusIso,
      focusDay,
      dateText,
      setDateText,
      applyDateText,
      showMonth,
      listNavigation,
      listId,
      accept: CONTENT_CONTROL_PICTURE_ACCEPT,
      replaceImage,
    }),
    [
      session,
      replaceImage,
      value,
      isEnabled,
      refused,
      apply,
      cancel,
      calendar,
      previousMonth,
      nextMonth,
      selectDay,
      selectToday,
      focusIso,
      focusDay,
      dateText,
      setDateText,
      applyDateText,
      showMonth,
      listNavigation,
      listId,
    ]
  );
}
