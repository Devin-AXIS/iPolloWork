import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  ChromeExportError,
  ChromePrintError,
  hostDocumentOf,
  runChromePrint,
  type ChromeExportHandlers,
  type ChromePrintJob,
  type ChromePrintSettings,
  type ResolvedChromePrintSettings,
  initialChromePrintSettings,
} from '@docx-editor.dev/core/editor';
import type { Editor } from '@docx-editor.dev/core';
import { useTranslation } from '../../i18n';

/**
 * File > Print state: converts through the PDF handler, then opens the browser print
 * dialog. With `settingsStep` on, the popup first shows the print settings form, and
 * conversion starts when the user confirms. Otherwise the popup shows only while the PDF
 * is prepared and after a failure.
 *
 * The popup stays up while the PDF loads and closes BEFORE printing starts. It is modal, and a modal dialog makes the rest
 * of the page, including the print frame, inert.
 *
 * `feedback` is false when the host suppresses the popup. A failure then ends the session
 * at once, because no popup remains to close it.
 *
 * The PDF stays loaded until the next print or unmount: removing a frame while the browser
 * still prints from it can cancel the printout, and an Open PDF tab can still be reading
 * its URL.
 */
export function useMenuPrint(
  editor: Editor | null,
  exporters: ChromeExportHandlers | undefined,
  feedback: boolean,
  settingsStep = false
) {
  const { t } = useTranslation();
  // The latest inputs, read when an action runs, so the actions keep one identity.
  const inputs = useRef({ editor, exporters, feedback, t, settingsStep });
  inputs.current = { editor, exporters, feedback, t, settingsStep };
  // The current print session. Closing the dialog clears it, so a conversion that
  // finishes afterward sees a stale session and discards its PDF instead of printing.
  const current = useRef<object | null>(null);
  const job = useRef<ChromePrintJob | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [url, setUrl] = useState('');
  const [visible, setVisible] = useState(false);
  // True from File > Print until the session ends, including while the popup is hidden.
  const [active, setActive] = useState(false);
  const [session, setSession] = useState<object>({});
  // True while the settings form shows, before conversion starts.
  const [choosing, setChoosing] = useState(false);
  const [settings, setSettings] = useState<ResolvedChromePrintSettings>(() =>
    initialChromePrintSettings(null)
  );
  const settingsRef = useRef(settings);
  const container = useRef<Element | Document | undefined>(undefined);
  // The session whose conversion has started. A double click on Print, or Print and the
  // shortcut together, reach `confirm` twice before React re-renders; one session converts once.
  const converting = useRef<object | null>(null);

  const failure = useCallback((cause: unknown) => {
    const { t } = inputs.current;
    if (cause instanceof ChromeExportError) return t('toolbar.printPdfMissing');
    if (cause instanceof ChromePrintError) {
      if (cause.code === 'pdf-viewer-unavailable') return t('toolbar.printNoViewer');
      if (cause.code === 'pdf-load-failed') return t('toolbar.printLoadFailed');
      if (cause.code === 'print-refused') return t('toolbar.printRefused');
    }
    return t('toolbar.printFailedMessage', {
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }, []);

  const end = useCallback(() => {
    current.current = null;
    setActive(false);
    setVisible(false);
    setPending(false);
    setChoosing(false);
  }, []);

  const convert = useCallback(
    async (token: object, chosen: ChromePrintSettings) => {
      const { editor, exporters } = inputs.current;
      if (!editor || current.current !== token || converting.current === token) return;
      converting.current = token;
      setChoosing(false);
      setPending(true);
      try {
        const prepared = await runChromePrint(
          editor,
          exporters,
          container.current ?? hostDocumentOf(null),
          chosen
        );
        if (current.current !== token) {
          prepared.dispose();
          return;
        }
        job.current = prepared;
        await prepared.print({
          // Commit the closed popup now, so its modal state is gone when printing starts.
          beforePrint: () => {
            // Cancel while the PDF loaded: stop before the print dialog opens.
            if (current.current !== token) throw new ChromePrintError('print-ended');
            flushSync(() => setVisible(false));
          },
        });
        if (current.current === token) end();
      } catch (cause) {
        if (current.current !== token) return;
        if (!inputs.current.feedback) {
          // No popup reports it, so the failure goes where a failed save goes.
          console.error('[docx-editor] print failed', cause);
          end();
          return;
        }
        setPending(false);
        setUrl(job.current?.url ?? '');
        setError(failure(cause));
        setVisible(true);
      }
    },
    [end, failure]
  );

  const execute = useCallback(
    async (target?: Element | Document) => {
      const { editor, exporters, feedback, settingsStep } = inputs.current;
      if (!editor || current.current) return;
      const token = {};
      current.current = token;
      container.current = target;
      job.current?.dispose();
      job.current = null;
      setSession(token);
      setActive(true);
      setVisible(true);
      setError('');
      setUrl('');
      // Without a popup there is no form, so printing starts with the current view. Without
      // a PDF handler, the setup error shows at once instead of after the form.
      if (!settingsStep || !feedback || !exporters?.pdf) {
        await convert(token, {});
        return;
      }
      const initial = initialChromePrintSettings(editor.snapshot());
      settingsRef.current = initial;
      setSettings(initial);
      setPending(false);
      setChoosing(true);
    },
    [convert]
  );

  const changeSettings = useCallback((change: ChromePrintSettings) => {
    const next = { ...settingsRef.current, ...change };
    settingsRef.current = next;
    setSettings(next);
  }, []);

  /** Starts conversion with the settings the form shows. */
  const confirm = useCallback(() => {
    const token = current.current;
    if (token) void convert(token, settingsRef.current);
  }, [convert]);

  // Unmounting the menu ends the session and the job, which removes its frame and revokes
  // its URL. A conversion that finishes afterward sees no session and discards its PDF.
  useEffect(
    () => () => {
      current.current = null;
      job.current?.dispose();
      job.current = null;
    },
    []
  );

  return {
    pending,
    error,
    url,
    visible,
    active,
    session,
    choosing,
    settings,
    execute,
    changeSettings,
    confirm,
    close: end,
  };
}
