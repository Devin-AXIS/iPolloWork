import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives';
import type { FileActions } from '@deepseek-ai/dsh-client-ui-file-actions/types';
import { downloadBlob } from '../../_shared/download-blob.ts';
import { endpoint } from './api.ts';
import { errorText, label, request, type Language } from './browser.ts';
import type { FileDocument } from './file-contract.ts';
import { RichMarkdown } from './rich-markdown/editor.tsx';
import { SheetEditor } from './sheet-editor.tsx';
import { noChanges, type Changes } from './sheet-model.ts';

type NativeContent = { kind: 'renderer'; revision: number; loaded(version: string): void; failed(): void; reload(): void };
type Draft = { version: string; kind: 'markdown'; text: string }
  | { version: string; kind: 'workbook'; changes: Changes };
const emptyHistory: { undo: Changes[]; redo: Changes[] } = { undo: [], redo: [] };

export function FileEditor({ session, path, language, native, observedVersion, drafts, fileActions }: {
  session: string; path: string; language: Language; native: NativeContent;
  observedVersion: string | undefined; drafts: Map<string, Draft>; fileActions: FileActions | undefined;
}) {
  const t = (zh: string, en: string) => label(language, zh, en);
  const key = `${session}\0${path}`;
  const [document, setDocument] = useState<FileDocument>();
  const [draft, setDraft] = useState(() => drafts.get(key));
  const [editing, setEditing] = useState(() => drafts.has(key));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [history, setHistory] = useState(emptyHistory);
  const [cellTyping, setCellTyping] = useState(false);
  const pending = useRef(false);
  const nativeRef = useRef(native);
  const versionRef = useRef(observedVersion);
  nativeRef.current = native;
  versionRef.current = observedVersion;
  const query = useMemo(() => ({ session, path }), [session, path]);
  const resolveImage = useCallback((destination: string) => {
    let image: string;
    try { image = decodeURIComponent(destination.split(/[?#]/, 1)[0] ?? ''); }
    catch { return undefined; }
    if (!/\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(image) || /^(?![a-z]:[/\\])[a-z][\w+.-]*:/i.test(image)
      || /^[/\\]{2}/.test(image)) return undefined;
    const url = new URL('api/' + endpoint, window.document.baseURI);
    url.search = new URLSearchParams({ action: 'image', ...query, image }).toString();
    return url.href;
  }, [query]);
  const stale = Boolean(draft && document && draft.version !== document.version);
  const displayedError = stale ? 'conflict' : error;

  const changeDraft = useCallback((next?: Draft) => {
    if (next) drafts.set(key, next); else drafts.delete(key);
    setDraft(next); setSaved(false);
  }, [drafts, key]);

  useEffect(() => {
    const controller = new AbortController();
    const content = nativeRef.current;
    setError('');
    void request<FileDocument>('document', { query, signal: controller.signal }).then(file => {
      if (controller.signal.aborted) return;
      setDocument(file);
      content.loaded(versionRef.current ?? file.version);
    }).catch(cause => {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : 'failed');
      content.failed();
    });
    return () => controller.abort();
  }, [query, native.revision]);
  useEffect(() => { setHistory(emptyHistory); }, [document?.version]);

  const save = useCallback(async () => {
    const snapshot = drafts.get(key);
    if (!document || (snapshot && snapshot.version !== document.version) || pending.current
      || (document.legacy ? !fileActions : !document.writable || !snapshot)) return false;
    pending.current = true; setSaving(true); setError('');
    try {
      if (document.legacy && fileActions) {
        const changes = snapshot?.kind === 'workbook' ? Object.values(snapshot.changes) : [];
        const blob = await request<Blob>('convert', { query, blob: true,
          data: { kind: 'workbook', version: document.version, changes } });
        const name = (path.split(/[/\\]/).at(-1) ?? 'workbook').replace(/\.[^.]+$/, '');
        const result = await downloadBlob(fileActions, blob, name + '.xlsx');
        if (result.status !== 'cancelled') setSaved(true);
        return result.status !== 'cancelled';
      }
      if (!snapshot) return false;
      const data = snapshot.kind === 'markdown' ? snapshot : { ...snapshot, changes: Object.values(snapshot.changes) };
      const updated = await request<FileDocument>('document', { query, data });
      setDocument(updated);
      const live = drafts.get(key);
      if (live === snapshot) changeDraft();
      else if (live?.version === snapshot.version) changeDraft({ ...live, version: updated.version });
      if (snapshot.kind === 'workbook') setHistory(emptyHistory);
      setSaved(!drafts.has(key));
      nativeRef.current.loaded(versionRef.current ?? updated.version);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'failed');
      return false;
    } finally { pending.current = false; setSaving(false); }
  }, [document, drafts, key, query, changeDraft, fileActions, path]);

  useEffect(() => {
    if (draft?.kind !== 'markdown' || !document?.writable || stale || error || saving) return;
    const timer = setTimeout(() => void save(), 950);
    return () => clearTimeout(timer);
  }, [draft, document?.writable, stale, error, saving, save]);

  function workbookDraft() {
    const current = drafts.get(key);
    return current?.kind === 'workbook' ? current.changes : noChanges;
  }

  function setWorkbookDraft(changes: Changes) {
    if (!document) return;
    const current = drafts.get(key);
    changeDraft(Object.keys(changes).length ? { kind: 'workbook', version: current?.version ?? document.version, changes } : undefined);
  }

  function stage(changes: Changes) {
    const previous = workbookDraft();
    setHistory(state => ({ undo: [...state.undo, previous].slice(-50), redo: [] }));
    setWorkbookDraft(changes);
  }

  function step(direction: 'undo' | 'redo') {
    const next = history[direction].at(-1);
    if (!next) return;
    const reverse = direction === 'undo' ? 'redo' : 'undo';
    setHistory({ ...history, [direction]: history[direction].slice(0, -1), [reverse]: [...history[reverse], workbookDraft()] });
    setWorkbookDraft(next);
  }

  function discard() {
    changeDraft(); setError(''); setConfirmDiscard(false); setHistory(emptyHistory);
    if (displayedError === 'conflict') native.reload();
  }

  const status = saving ? t('正在保存…', 'Saving…') : saved && document?.legacy ? t('已另存 XLSX 副本', 'Saved an XLSX copy')
    : draft || cellTyping ? t('有未保存的修改', 'Unsaved changes') : saved ? t('已保存到原文件', 'Saved to file')
    : document?.writable === false ? t('只读', 'Read only') : '';
  const markdown = document?.kind === 'markdown' ? document : undefined;
  const text = draft?.kind === 'markdown' ? draft.text : markdown?.text ?? '';
  return <section className="ipw-file-editor" aria-label={t('右侧文件编辑区', 'File editor')} onKeyDown={event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault(); event.stopPropagation(); void save();
    }
  }}>
    <header className="ipw-file-actions ipw-file-header">
      {document && <>
        <Button size="sm" aria-pressed={!editing} onClick={() => setEditing(false)}>{t('预览', 'Preview')}</Button>
        <Button size="sm" aria-pressed={editing} disabled={!document.writable} onClick={() => setEditing(true)}>{t('编辑', 'Edit')}</Button>
        <span className="ipw-file-status" role="status">{status}</span>
        {draft && <Button size="sm" disabled={saving} onClick={() => setConfirmDiscard(true)}>{t('放弃修改', 'Discard')}</Button>}
        <Button size="sm" variant="primary" disabled={stale || saving || (document.legacy ? !fileActions : (!draft && !cellTyping) || !document.writable)}
          onClick={() => void save()}>{document.legacy ? t('另存为 XLSX', 'Save as XLSX') : t('保存', 'Save')}</Button>
      </>}
    </header>
    {displayedError && <div className="ipw-file-notice" role="alert">
      {errorText(Error(displayedError), language)}
      {!document && <Button size="sm" onClick={native.reload}>{t('重试', 'Retry')}</Button>}
    </div>}
    {confirmDiscard && <div className="ipw-file-notice ipw-file-actions" role="group" aria-label={t('确认放弃修改', 'Confirm discard')}>
      <span>{t('放弃这个文件的未保存修改？', 'Discard unsaved edits to this file?')}</span>
      <Button size="sm" onClick={() => setConfirmDiscard(false)}>{t('继续编辑', 'Keep editing')}</Button>
      <Button size="sm" variant="outline" disabled={saving} onClick={discard}>{t('确认放弃', 'Discard edits')}</Button>
    </div>}
    {!document && !displayedError && <p className="ipw-file-notice" role="status">{t('正在打开文件…', 'Opening file…')}</p>}
    {document?.legacy && <p className="ipw-file-notice ipw-file-legacy">{t(
      '修改可另存为 XLSX 副本，原文件保留。部分旧格式的图表或样式可能无法转换。',
      'Save edits to an XLSX copy. The source stays intact. Some charts or styles may not carry over.')}</p>}
    {markdown && (editing && markdown.writable ? <RichMarkdown value={text} language={language} resolveImage={resolveImage} change={value => {
        changeDraft(value === markdown.text && !pending.current ? undefined : {
          kind: 'markdown', version: drafts.get(key)?.version ?? markdown.version, text: value,
        });
      }} /> : <div className="ipw-file-markdown-preview"><MarkdownText text={text} omitHtml pathImages={{ resolve: resolveImage }}
        labels={{ code: { copyLabel: t('复制', 'Copy'), copiedLabel: t('已复制', 'Copied') }, footnotes: t('脚注', 'Footnotes') }} /></div>)}
    {document?.kind === 'workbook' && <fieldset className="ipw-file-fieldset" disabled={saving}>
      <SheetEditor sheets={document.sheets} changes={draft?.kind === 'workbook' ? draft.changes : noChanges}
        stage={stage} editing={editing && document.writable} delimited={document.delimited === true} language={language}
        canUndo={Boolean(history.undo.length)} canRedo={Boolean(history.redo.length)} undo={() => step('undo')} redo={() => step('redo')}
        setCellTyping={setCellTyping} />
    </fieldset>}
  </section>;
}
