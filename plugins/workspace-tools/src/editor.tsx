import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Button, Input, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives';
import { Modal } from '../../_shared/ui/modal.tsx';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import type { Cell, CellChange, Document, Sheet } from './api.ts';
import { errorText, label, request, type Language } from './browser.ts';

interface EditorProps {
  session: string;
  path: string;
  language: Language;
  close(): void;
}

const rowsPerPage = 24;
const columnsPerPage = 9;

function letters(number: number) {
  let result = '';
  for (let column = number; column > 0; column = Math.floor((column - 1) / 26))
    result = String.fromCharCode(65 + (column - 1) % 26) + result;
  return result;
}

function MarkdownEditor({ value, language, change }: {
  value: string; language: Language; change(value: string): void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const initial = useRef(value);
  const update = useRef(change);
  update.current = change;
  const [view, setView] = useState<'edit' | 'preview'>('edit');
  const t = (zh: string, en: string) => label(language, zh, en);

  useEffect(() => {
    if (!root.current) return;
    const instance = new EditorView({
      parent: root.current,
      state: EditorState.create({ doc: initial.current, extensions: [
        history(), markdown(), keymap.of([...defaultKeymap, ...historyKeymap]), EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': 'Markdown', 'aria-multiline': 'true' }),
        EditorView.updateListener.of(event => {
          if (event.docChanged) update.current(event.state.doc.toString());
        }),
      ] }),
    });
    editor.current = instance;
    return () => { instance.destroy(); editor.current = null; };
  }, []);

  function surround(before: string, after = '') {
    const cm = editor.current;
    if (!cm) return;
    const { from, to } = cm.state.selection.main;
    cm.dispatch({ changes: { from, to, insert: before + cm.state.sliceDoc(from, to) + after },
      selection: { anchor: from + before.length, head: to + before.length }, scrollIntoView: true });
    cm.focus();
  }

  const tools = [
    [t('标题', 'Heading'), '## ', ''], [t('粗体', 'Bold'), '**', '**'], [t('斜体', 'Italic'), '*', '*'],
    [t('列表', 'List'), '- ', ''], [t('引用', 'Quote'), '> ', ''],
    [t('代码', 'Code'), '`', '`'], [t('链接', 'Link'), '[', '](https://)'],
  ] as const;

  return <>
    <div className="ipw-wt-bar">
      <Button size="sm" aria-pressed={view === 'edit'} onClick={() => setView('edit')}>{t('编辑', 'Edit')}</Button>
      <Button size="sm" aria-pressed={view === 'preview'} onClick={() => setView('preview')}>{t('预览', 'Preview')}</Button>
      {view === 'edit' && <div className="ipw-wt-format" role="group" aria-label={t('格式', 'Formatting')}>
        {tools.map(([name, before, after]) => <Button key={name} size="sm" onClick={() => surround(before, after)}>{name}</Button>)}
      </div>}
    </div>
    <div ref={root} className="ipw-wt-markdown" hidden={view !== 'edit'} />
    {view === 'preview' && <div className="ipw-wt-markdown ipw-wt-rendered"><MarkdownText text={value} omitHtml
      labels={{ code: { copyLabel: t('复制', 'Copy'), copiedLabel: t('已复制', 'Copied') }, footnotes: t('脚注', 'Footnotes') }} /></div>}
  </>;
}

function WorkbookEditor({ sheets, changes, change, language }: {
  sheets: Sheet[]; changes: Record<string, CellChange>; change(edit: CellChange | null, key: string): void; language: Language;
}) {
  const t = (zh: string, en: string) => label(language, zh, en);
  const [name, setName] = useState(sheets[0]?.name ?? '');
  const [row, setRow] = useState(1);
  const [column, setColumn] = useState(1);
  const [selected, select] = useState('A1');
  const [entry, setEntry] = useState('');
  const [kind, setKind] = useState<CellChange['kind']>('text');
  const sheet = sheets.find(candidate => candidate.name === name);
  const values = useMemo(() => new Map(sheet?.cells.map(cell => [cell.address, cell]) ?? []), [sheet]);
  const key = (address: string) => JSON.stringify([name, address]);
  const valueAt = (address: string): Cell | CellChange | undefined => changes[key(address)] ?? values.get(address);
  const active = valueAt(selected);
  const locked = active?.kind === 'formula' || active?.kind === 'locked';
  useEffect(() => {
    setEntry(active?.value ?? '');
    setKind(active?.kind === 'number' || active?.kind === 'boolean' ? active.kind : 'text');
  }, [selected, name, active]);
  if (!sheet) return null;

  const width = Math.min(columnsPerPage, 16_385 - column);
  const height = Math.min(rowsPerPage, 1_048_577 - row);
  const columns = Array.from({ length: width }, (_, i) => letters(column + i));
  function apply(event: FormEvent) {
    event.preventDefault();
    if (locked) return;
    const original = values.get(selected);
    const next = entry ? kind : 'empty';
    const same = entry === (original?.value ?? '') && (next === 'empty' || next === original?.kind);
    change(same ? null : { sheet: name, address: selected, value: entry, kind: next }, key(selected));
  }

  return <>
    <div className="ipw-wt-bar">
      <label>{t('工作表', 'Sheet')} <select value={name} onChange={event => {
        setName(event.target.value); select('A1'); setRow(1); setColumn(1);
      }}>{sheets.map(item => <option key={item.name}>{item.name}</option>)}</select></label>
      <span className="ipw-wt-muted">{sheet.rows} × {sheet.columns}</span>
      <Button size="sm" onClick={() => setRow(Math.max(1, row - rowsPerPage))} disabled={row === 1}>{t('上一组行', 'Previous rows')}</Button>
      <Button size="sm" onClick={() => setRow(Math.min(1_048_576, row + rowsPerPage))} disabled={row + height > 1_048_576}>{t('下一组行', 'Next rows')}</Button>
      <Button size="sm" onClick={() => setColumn(Math.max(1, column - columnsPerPage))} disabled={column === 1}>{t('上一组列', 'Previous columns')}</Button>
      <Button size="sm" onClick={() => setColumn(Math.min(16_384, column + columnsPerPage))} disabled={column + width > 16_384}>{t('下一组列', 'Next columns')}</Button>
    </div>
    <form className="ipw-wt-bar ipw-wt-cell-form" onSubmit={apply}>
      <label htmlFor="ipw-wt-cell-value">{selected}</label>
      <Input id="ipw-wt-cell-value" aria-label={t('单元格值', 'Cell value')} value={entry} readOnly={locked}
        onChange={event => setEntry(event.target.value)} maxLength={32767} />
      <select aria-label={t('值类型', 'Value type')} value={kind} disabled={locked}
        onChange={event => setKind(event.target.value as CellChange['kind'])}>
        <option value="text">{t('文本', 'Text')}</option><option value="number">{t('数字', 'Number')}</option>
        <option value="boolean">{t('布尔值', 'Boolean')}</option>
      </select>
      <Button type="submit" size="sm" variant="outline" disabled={locked}>{t('应用到单元格', 'Apply to cell')}</Button>
    </form>
    <div className="ipw-wt-grid" tabIndex={0} aria-label={t('工作表网格', 'Worksheet grid')}>
      <table><thead><tr><th aria-label={t('行号', 'Row number')} />{columns.map(letter => <th scope="col" key={letter}>{letter}</th>)}</tr></thead>
        <tbody>{Array.from({ length: height }, (_, i) => {
          const number = row + i;
          return <tr key={number}><th scope="row">{number}</th>{columns.map(letter => {
            const address = letter + number;
            const cell = valueAt(address);
            return <td key={address}><button type="button" aria-label={address} title={cell?.value ?? ''}
              aria-pressed={selected === address} data-edited={changes[key(address)] ? '' : undefined}
              onClick={() => select(address)}>{cell?.value ?? ''}</button></td>;
          })}</tr>;
        })}</tbody>
      </table>
    </div>
    <p className="ipw-wt-muted ipw-wt-caption">{t('公式保持原样。单元格样式与其他工作表保留。', 'Formulas, cell styles and other worksheets are preserved.')}</p>
  </>;
}

export function Editor({ session, path, language, close }: EditorProps) {
  const t = (zh: string, en: string) => label(language, zh, en);
  const [document, setDocument] = useState<Document>();
  const [text, setText] = useState('');
  const [changes, setChanges] = useState<Record<string, CellChange>>({});
  const [version, setVersion] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [attempt, reload] = useState(0);
  const query = useMemo(() => ({ session, path }), [session, path]);
  const workbook = document?.kind === 'workbook';
  const dirty = document?.kind === 'markdown' ? document.text !== text : Object.keys(changes).length > 0;
  const saveLock = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    void request<Document>('document', { query, signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      setDocument(value); setVersion(value.version);
      setText(value.kind === 'markdown' ? value.text : '');
    }).catch(cause => { if (!controller.signal.aborted) setError(errorText(cause, language)); });
    return () => controller.abort();
  }, [query, attempt, language]);

  const closeEditor = () => {
    if (saveLock.current) return;
    if (dirty) setDiscard(true); else close();
  };

  async function save() {
    if (!document || !dirty || saveLock.current) return;
    saveLock.current = true;
    setSaving(true); setError(''); setStatus('');
    const data = document.kind === 'markdown'
      ? { kind: document.kind, version, text }
      : { kind: document.kind, version, changes: Object.values(changes) };
    try {
      const result = await request<{ version: string }>('document', { query, data });
      setVersion(result.version);
      if (document.kind === 'markdown') setDocument({ ...document, version: result.version, text });
      else {
        setChanges({});
        setDocument(await request<Document>('document', { query }));
      }
      setStatus(t('已保存', 'Saved'));
    } catch (cause) { setError(errorText(cause, language)); }
    finally { saveLock.current = false; setSaving(false); }
  }

  return <Modal open title={(workbook ? t('编辑 Excel', 'Edit Excel') : t('编辑文件', 'Edit file'))}
    className="ipw-wt-editor-modal" contentClassName="ipw-wt-editor-content" closeLabel={t('关闭', 'Close')} onClose={closeEditor}
    onKeyDownCapture={event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault(); event.stopPropagation(); void save();
      }
    }} footer={<>
      <div className="ipw-wt-status" role="status">{saving ? t('正在保存…', 'Saving…') : dirty ? t('有未保存的修改', 'Unsaved changes') : status}</div>
      {discard ? <>
        <Button onClick={() => setDiscard(false)}>{t('继续编辑', 'Keep editing')}</Button>
        <Button variant="outline" onClick={close}>{t('放弃修改', 'Discard changes')}</Button>
      </> : <>
        <Button onClick={closeEditor} disabled={saving}>{t('关闭', 'Close')}</Button>
        <Button variant="primary" onClick={() => void save()} disabled={!dirty || saving}>{t('保存', 'Save')}</Button>
      </>}
    </>}>
    <p className="ipw-wt-path" title={path}>{path}</p>
    {error && <p role="alert" className="ipw-wt-error">{error}</p>}
    {discard && <p role="alert">{t('关闭将丢弃当前未保存的修改。', 'Closing will discard the unsaved changes.')}</p>}
    {!document && !error && <p role="status">{t('正在打开文件…', 'Opening file…')}</p>}
    {!document && error && <Button onClick={() => { setError(''); reload(attempt + 1); }}>{t('重试', 'Retry')}</Button>}
    {document?.kind === 'markdown' && <MarkdownEditor value={text} language={language} change={value => { setText(value); setStatus(''); }} />}
    {document?.kind === 'workbook' && <fieldset className="ipw-wt-fieldset" disabled={saving}>
      <WorkbookEditor sheets={document.sheets} changes={changes} language={language} change={(entry, key) => {
        setChanges(current => {
          const next = { ...current };
          if (entry) next[key] = entry; else delete next[key];
          return next;
        });
        setStatus('');
      }} />
    </fieldset>}
  </Modal>;
}
