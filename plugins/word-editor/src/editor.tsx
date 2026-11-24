import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import type { FileActions } from '@deepseek-ai/dsh-client-ui-file-actions/types';
import { DocxEditor, type DocxEditorRef } from '@docx-editor.dev/react';
import { zhCN } from '@docx-editor.dev/i18n';
import { downloadBlob } from '../../_shared/download-blob.ts';
import { endpoint, mediaType } from './shared.ts';
import type { Draft, OpenFile, RendererContent, SaveState } from './view-contract.ts';
export { default as engineCss } from '@docx-editor.dev/core/styles/editor.css';

async function checked(response: Response) {
  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as { error?: string };
    throw Error(result.error ?? 'failed');
  }
  const version = response.headers.get('x-ipollo-file-version');
  if (!version || !/^[0-9a-f]{64}$/.test(version)) throw Error('failed');
  return version;
}

function useTheme() {
  const root = document.documentElement;
  const read = (): 'dark' | 'light' | 'system' => root.dataset.dsThemeSource === 'dark' ? 'dark'
    : root.dataset.dsThemeSource === 'light' ? 'light' : 'system';
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(read()));
    observer.observe(root, { attributes: true, attributeFilter: ['data-ds-theme-source'] });
    return () => observer.disconnect();
  }, [root]);
  return theme;
}

export function Editor({ session, path, native, resourceVersion, zh, drafts, fileActions }: {
  session: string; path: string; native: RendererContent; resourceVersion: string | undefined;
  zh: boolean; drafts: Map<string, Draft>; fileActions: FileActions;
}) {
  const t = (chinese: string, english: string) => zh ? chinese : english;
  const key = session + '\0' + path;
  const basename = path.split(/[\\/]/).pop() || 'document.docx';
  const url = useMemo(() => {
    const target = new URL('api/' + endpoint, document.baseURI);
    target.search = new URLSearchParams({ session, path }).toString();
    return target;
  }, [session, path]);
  const saveUrl = useMemo(() => {
    const target = new URL(url);
    target.pathname += '/save';
    return target;
  }, [url]);
  const theme = useTheme();
  const nativeRef = useRef(native);
  nativeRef.current = native;
  const versionHint = useRef(resourceVersion);
  versionHint.current = resourceVersion;
  const editor = useRef<DocxEditorRef>(null);
  const [file, setFile] = useState<OpenFile>();
  const [state, setState] = useState<SaveState>('idle');
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [reloadConfirm, confirmReload] = useState(false);
  const [recover, setRecover] = useState(false);
  const [opened, setOpened] = useState(false);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const version = useRef('');
  const desired = useRef(0);
  const persisted = useRef(0);
  const available = useRef(true);
  const saving = useRef(false);
  const paused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const cache = useCallback((bytes: ArrayBuffer, base: string) => {
    drafts.delete(key);
    drafts.set(key, { bytes, version: base, savedAt: Date.now() });
    let total = [...drafts.values()].reduce((sum, draft) => sum + draft.bytes.byteLength, 0);
    for (const [oldKey, draft] of drafts) {
      if (drafts.size <= 5 && total <= 32 * 1024 * 1024) break;
      drafts.delete(oldKey);
      total -= draft.bytes.byteLength;
    }
  }, [drafts, key]);

  useEffect(() => {
    available.current = true;
    return () => {
      available.current = false;
      clearTimeout(timer.current);
      if (desired.current > persisted.current) {
        const copy = editor.current?.save();
        void copy?.then(bytes => { if (bytes) cache(bytes, version.current); }).catch(() => undefined);
      }
    };
  }, [cache]);

  useEffect(() => {
    const controller = new AbortController();
    const current = nativeRef.current;
    setLoading(true);
    void fetch(url, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal }).then(async response => {
      const stamp = await checked(response);
      const bytes = await response.arrayBuffer();
      if (controller.signal.aborted) return;
      current.loaded(versionHint.current ?? stamp);
      if (version.current === stamp && desired.current !== 0) return;
      if (desired.current !== persisted.current) {
        if (saving.current) return;
        paused.current = true;
        setError('conflict');
        return;
      }
      const draft = drafts.get(key);
      const usable = draft && Date.now() - draft.savedAt < 30 * 60 * 1000;
      const restored = usable && draft.version === stamp;
      version.current = stamp;
      setOpened(false);
      setFile({ version: stamp, bytes: restored ? draft.bytes : bytes });
      setRecover(Boolean(usable && !restored));
      desired.current = restored ? 1 : 0;
      persisted.current = 0;
      setDirty(Boolean(restored));
      setState('idle');
      setError('');
    }).catch(cause => {
      if (controller.signal.aborted) return;
      current.failed();
      setError(cause instanceof Error ? cause.message : 'failed');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [drafts, key, native.revision, url]);

  const save = useCallback(async () => {
    if (saving.current || desired.current === persisted.current || !version.current) return;
    const controller = editor.current;
    if (!controller) return;
    saving.current = true;
    clearTimeout(timer.current);
    setState('pending');
    setError('');
    const edit = desired.current;
    const base = version.current;
    try {
      const bytes = await controller.save();
      if (!bytes) throw Error('failed');
      cache(bytes, base);
      const response = await fetch(saveUrl, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': mediaType, 'X-IPollo-File-Version': base }, body: bytes });
      version.current = await checked(response);
      persisted.current = edit;
      const changed = desired.current !== edit;
      if (!changed) drafts.delete(key);
      if (available.current) {
        paused.current = false;
        setState('saved');
        setDirty(changed);
      }
    } catch (cause) {
      paused.current = true;
      if (available.current) {
        setState('idle');
        setError(cause instanceof Error ? cause.message : 'failed');
      }
    } finally {
      saving.current = false;
    }
  }, [cache, drafts, key, saveUrl]);

  useEffect(() => {
    if (!dirty || state === 'pending' || error || paused.current) return;
    timer.current = setTimeout(() => void save(), 1000);
    return () => clearTimeout(timer.current);
  }, [dirty, state, error, save]);

  const editDocument = useCallback((change: { source?: string }) => {
    if (change.source) return;
    desired.current++;
    setDirty(true);
    if (!saving.current && !paused.current) {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(), 1000);
    }
  }, [save]);

  async function download(recovered = false) {
    if (downloading) return;
    setDownloading(true);
    setError(current => current === 'download-failed' ? '' : current);
    try {
      const bytes = recovered ? drafts.get(key)?.bytes : await editor.current?.save() ?? file?.bytes;
      if (!bytes) throw Error('failed');
      const name = basename.replace(/\.docx$/i, '') + (recovered ? '-draft' : '-copy') + '.docx';
      await downloadBlob(fileActions, new Blob([bytes], { type: mediaType }), name);
    } catch {
      setError('download-failed');
    } finally {
      setDownloading(false);
    }
  }

  function reload() {
    if (dirty) { confirmReload(true); return; }
    setError('');
    native.reload();
  }

  const errors: Record<string, string> = {
    'download-failed': t('下载失败，请重试。', 'The download failed. Try again.'),
    conflict: t('原文件已在别处修改。可下载当前草稿，或重新打开磁盘版本。', 'The file changed elsewhere. Download your draft or reopen the disk version.'),
    'outside-project': t('文件不在当前项目目录。请切换到系统预览。', 'This file is outside the project. Switch to the built-in preview.'),
    'unsupported-project': t('请在本地可写的工作区使用 Word 编辑。', 'Use the Word editor in a writable local workspace.'),
    'read-only': t('当前会话是只读的，可以下载副本。', 'This conversation is read-only. You can download a copy.'),
    'file-busy': t('文件正被其他软件使用。关闭后可重试保存。', 'Another application is using the file. Close it there and retry.'),
    'unsupported-file': t('此文件无法在编辑器中打开。请用系统预览或桌面 Word 查看。', 'This file could not be opened. Use the built-in preview or desktop Word.'),
    'too-large': t('文件超出编辑器的大小上限。', 'The file exceeds the editor size limit.'),
  };
  const report = errors[error] ?? t('操作失败，请重试。', 'The operation failed. Try again.');

  return <section className="ipw-word-surface" onKeyDownCapture={event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault(); event.stopPropagation(); void save();
    }
  }}>
    <div className="ipw-word-actions">
      <Button size="sm" variant="primary" disabled={!opened || !dirty || state === 'pending'}
        onClick={() => void save()}>{t('保存原文件', 'Save to file')}</Button>
      <Button size="sm" disabled={!file || state === 'pending' || downloading} onClick={() => void download()}>{t('下载副本', 'Download copy')}</Button>
      <Button size="sm" disabled={loading || state === 'pending'} onClick={reload}>{t('重新打开', 'Reopen')}</Button>
      <span role="status">{state === 'pending' ? t('正在保存…', 'Saving…')
        : downloading ? t('正在下载…', 'Downloading…') : dirty ? t('有未保存的修改', 'Unsaved changes')
          : state === 'saved' ? t('已保存到原文件', 'Saved to file') : ''}</span>
    </div>
    {recover && <p className="ipw-word-error">{t('同一文件有一个先前的草稿。', 'A previous draft is available.')}
      <Button size="sm" disabled={downloading} onClick={() => void download(true)}>{t('下载草稿', 'Download draft')}</Button></p>}
    {error && <p className="ipw-word-error" role="alert">{report}</p>}
    {loading && !file && <p role="status" className="ipw-word-error">{t('正在打开 Word 文件…', 'Opening Word document…')}</p>}
    {file && <div className="ipw-word-document">
      <DocxEditor ref={editor} document={file.bytes} title={basename} mode="edit" locale={zh ? 'zh-CN' : 'en-US'}
        {...(zh ? { i18n: zhCN } : {})} colorMode={theme} onReady={() => setOpened(true)} onChange={editDocument}
        onSave={() => void save()} onOpen={() => setError('unsupported-project')} menu={{ reportIssue: false }} />
    </div>}
    {reloadConfirm && <Modal open title={t('重新打开磁盘文件', 'Reopen the file from disk')} closeLabel={t('关闭', 'Close')}
      onClose={() => confirmReload(false)} footer={<>
        <Button onClick={() => confirmReload(false)}>{t('继续编辑', 'Keep editing')}</Button>
        <Button variant="primary" onClick={() => {
          clearTimeout(timer.current); drafts.delete(key); desired.current = 0; persisted.current = 0;
          version.current = ''; paused.current = false; setDirty(false); setError(''); confirmReload(false); native.reload();
        }}>{t('放弃草稿并重新打开', 'Discard draft and reopen')}</Button>
      </>}><p>{t('磁盘版本将替换编辑器里的未保存内容。', 'The disk version will replace the unsaved editor content.')}</p></Modal>}
  </section>;
}
