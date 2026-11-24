import { useRef, useState } from 'react';
import {
  ChromeExportError,
  runChromeExport,
  type ChromeExportFormat,
  type ChromeExportHandlers,
} from '@docx-editor.dev/core/editor';
import type { Editor } from '@docx-editor.dev/core';
import { useTranslation } from '../../i18n';
import { download, downloadName } from './download';

export function useMenuExport(
  editor: Editor | null,
  exporters: ChromeExportHandlers | undefined,
  fileName: string | undefined
) {
  const { t } = useTranslation();
  const running = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [format, setFormat] = useState<ChromeExportFormat>('pdf');
  const [visible, setVisible] = useState(false);
  const [session, setSession] = useState<object>({});
  const execute = async (format: ChromeExportFormat) => {
    if (!editor || running.current) return;
    running.current = true;
    setSession({});
    setFormat(format);
    setVisible(true);
    setPending(true);
    setError('');
    try {
      const result = await runChromeExport(editor, format, exporters);
      download(
        result.bytes.slice().buffer,
        downloadName(fileName).replace(/\.docx$/, `.${result.extension}`),
        result.mimeType
      );
      setVisible(false);
    } catch (cause) {
      setVisible(true);
      setError(
        cause instanceof ChromeExportError
          ? t(
              cause.format === 'markdown'
                ? 'toolbar.exportMarkdownMissing'
                : 'toolbar.exportPdfMissing'
            )
          : t('toolbar.exportFailed', {
              message: cause instanceof Error ? cause.message : String(cause),
            })
      );
    } finally {
      running.current = false;
      setPending(false);
    }
  };
  return { pending, error, format, visible, session, dismiss: () => setVisible(false), execute };
}
