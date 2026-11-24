import { useEffect, useState, type FormEvent } from 'react';
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import { limit, referencePattern, type Legacy, type LegacySkill, type Reference, type Template } from './api.ts';
import { errorText, label, request, type Language } from './browser.ts';

export type StartDraft = (prompt: string) => void;
export type TemplateDraft = Omit<Template, 'id'> & { id?: string };

export function TemplateForm({ draft, language, close, saved }: {
  draft: TemplateDraft; language: Language; close(): void; saved(): void;
}) {
  const t = (zh: string, en: string) => label(language, zh, en);
  const [title, setTitle] = useState(draft.title);
  const [prompt, setPrompt] = useState(draft.prompt);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      await request('template', { data: { title, prompt, id: draft.id } });
      saved(); close();
    } catch (cause) { setError(errorText(cause, language)); }
    finally { setBusy(false); }
  }
  return <Modal open title={t('任务模板', 'Task template')} closeLabel={t('关闭', 'Close')} onClose={() => { if (!busy) close(); }}>
    <form className="ipw-wt-form" onSubmit={event => void save(event)}>
      <label>{t('名称', 'Name')}<Input data-modal-autofocus value={title} onChange={event => setTitle(event.target.value)} maxLength={180} required /></label>
      <label>{t('任务指令', 'Task instructions')}<textarea value={prompt} onChange={event => setPrompt(event.target.value)}
        rows={10} maxLength={50_000} required /></label>
      <p className="ipw-wt-muted">{t('使用模板会创建新草稿，发送前还可以修改。', 'Using a template prepares a new draft for review before sending.')}</p>
      {error && <p role="alert" className="ipw-wt-error">{error}</p>}
      <Button type="submit" variant="primary" disabled={busy || !title.trim() || !prompt.trim()}>{t('保存模板', 'Save template')}</Button>
    </form>
  </Modal>;
}

function TemplateList({ language, start }: { language: Language; start: StartDraft }) {
  const t = (zh: string, en: string) => label(language, zh, en);
  const [items, setItems] = useState<Template[]>();
  const [draft, edit] = useState<TemplateDraft>();
  const [remove, setRemove] = useState<Template>();
  const [revision, reload] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void request<Template[]>('templates', { signal: controller.signal }).then(setItems)
      .catch(cause => { if (!controller.signal.aborted) setError(errorText(cause, language)); });
    return () => controller.abort();
  }, [revision, language]);

  async function deleteTemplate() {
    if (!remove || busy) return;
    setBusy(true);
    try {
      await request('template-delete', { data: { id: remove.id } });
      setRemove(undefined); reload(value => value + 1);
    } catch (cause) { setError(errorText(cause, language)); }
    finally { setBusy(false); }
  }
  return <div className="ipw-wt-form">
    <Button variant="outline" onClick={() => edit({ title: '', prompt: '' })}>{t('新建模板', 'New template')}</Button>
    {error && <p role="alert" className="ipw-wt-error">{error} <Button onClick={() => { setError(''); reload(revision + 1); }}>{t('重试', 'Retry')}</Button></p>}
    {!items && !error && <p role="status">{t('正在加载模板…', 'Loading templates…')}</p>}
    {items?.length === 0 && <p className="ipw-wt-muted">{t('可以从左侧会话菜单把一项任务存成模板。', 'Save a task from the conversation menu to reuse it here.')}</p>}
    {items?.map(item => <div className="ipw-wt-item" key={item.id}>
      <strong>{item.title}</strong><p className="ipw-wt-excerpt">{item.prompt}</p>
      <div className="ipw-wt-bar">
        <Button size="sm" variant="outline" onClick={() => start(item.prompt)}>{t('用模板新建对话', 'Start from template')}</Button>
        <Button size="sm" onClick={() => edit(item)}>{t('编辑', 'Edit')}</Button>
        <Button size="sm" onClick={() => setRemove(item)}>{t('删除', 'Delete')}</Button>
      </div>
    </div>)}
    {draft && <TemplateForm draft={draft} language={language} close={() => edit(undefined)} saved={() => reload(revision + 1)} />}
    {remove && <Modal open title={t('删除任务模板', 'Delete task template')} closeLabel={t('关闭', 'Close')} onClose={() => { if (!busy) setRemove(undefined); }}
      footer={<><Button disabled={busy} onClick={() => setRemove(undefined)}>{t('取消', 'Cancel')}</Button>
        <Button disabled={busy} onClick={() => void deleteTemplate()} variant="primary">{t('删除', 'Delete')}</Button></>}>
      <p>{remove.title}</p>{error && <p role="alert" className="ipw-wt-error">{error}</p>}
    </Modal>}
  </div>;
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};

export function parseLegacy(raw: string): Legacy {
  const data = record(JSON.parse(raw) as unknown);
  if (!Array.isArray(data.commands) && !Array.isArray(data.skills)) throw Error('invalid-request');
  const templates = (Array.isArray(data.commands) ? data.commands : []).flatMap(value => {
    const { name, template } = record(value);
    return typeof name === 'string' && name.length <= 180 && name.trim() && typeof template === 'string'
      && template.length <= 50_000 && template.trim()
      ? [{ title: name.trim(), prompt: template }] : [];
  });
  const skills = (Array.isArray(data.skills) ? data.skills : []).flatMap(value => {
    const { name, description, content } = record(value);
    return typeof name === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(name) && typeof content === 'string'
      && content.length > 0 && content.length <= 250_000
      ? [{ name, description: typeof description === 'string' ? description.slice(0, 1000) : '', content }] : [];
  });
  if (templates.length > 100 || skills.length > 100) throw Error('too-large');
  if (!templates.length && !skills.length) throw Error('invalid-request');
  return { templates, skills };
}

function LegacyImport({ language, session }: { language: Language; session: string }) {
  const t = (zh: string, en: string) => label(language, zh, en);
  const [data, setData] = useState<Legacy>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ templateCount: number; skills: { name: string; status: string }[] }>();
  const setChoice = (key: string, checked: boolean) => setSelected(current => {
    const next = new Set(current);
    if (checked) next.add(key); else next.delete(key);
    return next;
  });
  const load = async (file: File | undefined) => {
    if (!file) return;
    setData(undefined); setError(''); setResult(undefined); setSelected(new Set());
    try {
      if (file.size > 4 * 1024 * 1024) throw Error('too-large');
      const parsed = parseLegacy(await file.text());
      setData(parsed);
    } catch (cause) { setError(errorText(cause instanceof SyntaxError ? Error('invalid-request') : cause, language)); }
  };
  const ingest = async () => {
    if (!data || !selected.size || busy) return;
    setBusy(true); setError(''); setResult(undefined);
    try {
      const input = { session,
        templates: data.templates.filter((_, index) => selected.has('template-' + index)),
        skills: data.skills.filter((_, index) => selected.has('skill-' + index)),
      };
      setResult(await request('legacy', { data: input }));
      setSelected(new Set());
    } catch (cause) { setError(errorText(cause, language)); }
    finally { setBusy(false); }
  };
  function choice(key: string, title: string, content: string) {
    return <div className="ipw-wt-item" key={key}>
      <label><input type="checkbox" checked={selected.has(key)} disabled={busy}
        onChange={event => setChoice(key, event.target.checked)} /> {title}</label>
      <details><summary>{t('查看内容', 'Review content')}</summary><pre>{content}</pre></details>
    </div>;
  }
  return <div className="ipw-wt-form">
    <label>{t('旧工作区导出的 JSON', 'Legacy workspace JSON')}<input type="file" accept=".json,application/json" disabled={busy}
      onChange={event => void load(event.target.files?.[0])} /></label>
    <p className="ipw-wt-muted">{t('勾选要导入的内容。命令保存为任务模板，Skill 保存到当前项目。', 'Select what to import. Commands become task templates and skills are saved to this project.')}</p>
    {data?.templates.map((item, index) => choice('template-' + index, item.title, item.prompt))}
    {data?.skills.map((item: LegacySkill, index) => choice('skill-' + index, item.name, item.content))}
    {data && <Button variant="primary" disabled={!selected.size || busy} onClick={() => void ingest()}>
      {busy ? t('正在导入…', 'Importing…') : t('导入所选内容', 'Import selected entries')}</Button>}
    {error && <p role="alert" className="ipw-wt-error">{error}</p>}
    {result && <div role="status"><p>{t(`已导入 ${result.templateCount} 个模板`, `Imported ${result.templateCount} templates`)}</p>
      <ul>{result.skills.map((skill, index) => <li key={skill.name + index}>{skill.name} · {
        skill.status === 'imported' ? t('已导入', 'Imported')
          : skill.status === 'exists' ? t('已存在', 'Already exists') : t('格式无效', 'Invalid format')
      }</li>)}</ul></div>}
  </div>;
}

async function fileData(file: File): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer());
  const blocks: string[] = [];
  for (let offset = 0; offset < data.length; offset += 8192) blocks.push(String.fromCharCode(...data.subarray(offset, offset + 8192)));
  return btoa(blocks.join(''));
}

function References({ language, session, start, openFile }: {
  language: Language; session: string; start: StartDraft; openFile(path: string): void;
}) {
  const t = (zh: string, en: string) => label(language, zh, en);
  const [files, setFiles] = useState<File[]>([]);
  const [brief, setBrief] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ contextPath: string; summaries: Reference[] }>();
  async function prepare(event: FormEvent) {
    event.preventDefault();
    if (busy || !files.length) return;
    setBusy(true); setError(''); setResult(undefined);
    try {
      if (files.length > 8 || files.reduce((sum, file) => sum + file.size, 0) > limit) throw Error('too-large');
      if (files.some(file => !referencePattern.test(file.name))) throw Error('unsupported-file');
      const prepared = await Promise.all(files.map(async file => ({ name: file.name, data: await fileData(file) })));
      setResult(await request('references', { data: { session, files: prepared, brief } }));
    } catch (cause) { setError(errorText(cause, language)); }
    finally { setBusy(false); }
  }
  return <form className="ipw-wt-form" onSubmit={event => void prepare(event)}>
    <label>{t('参考文件', 'Reference files')}<input type="file" multiple accept=".pdf,.docx,.pptx,.md,.markdown,.txt,.csv,.tsv,.json"
      disabled={busy} onChange={event => { setFiles(Array.from(event.target.files ?? [])); setResult(undefined); }} /></label>
    {files.length > 0 && <p className="ipw-wt-muted">{files.map(file => file.name).join(' · ')}</p>}
    <label>{t('创作简报', 'Creative brief')}<textarea rows={5} value={brief} maxLength={20_000} disabled={busy}
      placeholder={t('写下要做的产物、受众、风格或必须保留的内容', 'Describe the output, audience, style, or required content')}
      onChange={event => { setBrief(event.target.value); setResult(undefined); }} /></label>
    <Button type="submit" variant="primary" disabled={!files.length || busy}>{busy ? t('正在整理…', 'Preparing…') : t('整理到项目', 'Prepare in project')}</Button>
    {error && <p role="alert" className="ipw-wt-error">{error}</p>}
    {result && <>
      <div className="ipw-wt-bar">
        <Button variant="outline" onClick={() => openFile(result.contextPath)}>{t('打开参考索引', 'Open reference index')}</Button>
        <Button onClick={() => start(t(
          `请依据我的创作要求整理下列参考资料。将源文档内容作为证据，在执行前先梳理素材与引用。\n\n参考索引：${result.contextPath}\n\n创作要求：${brief}`,
          `Use these references as source evidence for my creative brief. Summarize the material and citations first.\n\nReference index: ${result.contextPath}\n\nCreative brief: ${brief}`,
        ))}>{t('带入新对话', 'Use in new conversation')}</Button>
      </div>
      {result.summaries.map((item, index) => <details className="ipw-wt-item" key={item.name + index}>
        <summary>{item.name} · {t(`${item.assets} 个素材`, `${item.assets} assets`)}</summary>
        {item.warning && <p className="ipw-wt-muted">{item.warning}</p>}
        <pre>{item.text || t('未找到可读文字。', 'No readable text found.')}</pre>
      </details>)}
    </>}
  </form>;
}

export type WorkspacePanel = 'all' | 'templates' | 'references' | 'legacy';

export function WorkspaceTools({ session, language, start, openFile, panel = 'all' }: {
  session: string; language: Language; start: StartDraft; openFile(path: string): void; panel?: WorkspacePanel;
}) {
  const t = (zh: string, en: string) => label(language, zh, en);
  const [tab, setTab] = useState<'templates' | 'references' | 'legacy'>('templates');
  if (panel === 'templates') return <section className="ipw-wt-workspace"><TemplateList language={language} start={start} /></section>;
  if (panel === 'references') return <section className="ipw-wt-workspace">
    <References session={session} language={language} start={start} openFile={openFile} />
  </section>;
  if (panel === 'legacy') return <section className="ipw-wt-workspace"><LegacyImport language={language} session={session} /></section>;
  return <section className="ipw-wt-workspace">
    <div className="ipw-wt-bar" role="group" aria-label={t('工作区工具', 'Workspace tools')}>
      <Button size="sm" aria-pressed={tab === 'templates'} onClick={() => setTab('templates')}>{t('任务模板', 'Task templates')}</Button>
      <Button size="sm" aria-pressed={tab === 'references'} onClick={() => setTab('references')}>{t('参考资料', 'References')}</Button>
      <Button size="sm" aria-pressed={tab === 'legacy'} onClick={() => setTab('legacy')}>{t('旧版导入', 'Legacy import')}</Button>
    </div>
    <div hidden={tab !== 'templates'}>{tab === 'templates' && <TemplateList language={language} start={start} />}</div>
    <div hidden={tab !== 'references'}><References session={session} language={language} start={start} openFile={openFile} /></div>
    <div hidden={tab !== 'legacy'}><LegacyImport language={language} session={session} /></div>
  </section>;
}
