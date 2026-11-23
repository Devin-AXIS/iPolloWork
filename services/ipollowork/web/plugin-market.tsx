import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { MarketEntry } from '../src/market.js';
import { api } from './api.js';
import { ActionForm, Field, Modal, Status, Table, useData, value } from './components.js';

const catalogPath = '/api/market/catalog';
const pluginPath = '/api/v1/market/plugins';
const categories = { productivity: '生产力', communication: '沟通协作', creative: '创意制作' };

function PluginEditor({ existing, close, saved }: { existing?: MarketEntry; close: () => void; saved: () => void }) {
  const [draft, setDraft] = useState(existing);
  return <Modal title={existing ? '编辑插件' : '添加插件'} close={close}>
    {!draft ? <ActionForm label="读取插件资料" submit={async data => {
      setDraft(await api<MarketEntry>('/api/v1/market/discover', { source: value(data, 'source').trim() }));
    }}>
      <Field label="npm 包名或 GitHub 地址"><input name="source" required autoFocus maxLength={2048} placeholder="@组织/插件 或 https://github.com/组织/仓库" /></Field>
      <p>如果插件位于仓库子目录，请粘贴该目录的 GitHub 页面地址。</p>
    </ActionForm> : <ActionForm label={existing ? '保存修改' : '确认上架'} submit={async data => {
      const entry = { ...draft, title: value(data, 'title').trim(), description: value(data, 'description').trim() || undefined,
        author: value(data, 'author').trim() || undefined, homepage: value(data, 'homepage').trim() || undefined,
        metadata: { category: value(data, 'category') as MarketEntry['metadata']['category'] } };
      await api(pluginPath, existing ? { expected: existing, entry } : entry, existing ? 'PATCH' : 'POST');
      saved();
    }}>
      <p><strong>{draft.name}</strong> · v{draft.versions[0].version} · {draft.versions[0].source.type === 'git' ? 'GitHub' : 'npm'}</p>
      <Field label="展示名称"><input name="title" required maxLength={100} defaultValue={draft.title} /></Field>
      <Field label="插件介绍"><textarea name="description" rows={4} maxLength={2000} defaultValue={draft.description} placeholder="说明适用场景和主要功能" /></Field>
      <Field label="发布者"><input name="author" maxLength={100} defaultValue={draft.author} /></Field>
      <Field label="主页"><input name="homepage" type="url" maxLength={2048} defaultValue={draft.homepage} /></Field>
      <Field label="分类"><select name="category" defaultValue={draft.metadata.category}>{Object.entries(categories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
      {!existing && <button type="button" onClick={() => setDraft(undefined)}>重新选择来源</button>}
    </ActionForm>}
  </Modal>;
}

export function PluginMarket() {
  const catalog = useData<{ plugins: MarketEntry[] }>(catalogPath);
  const [editor, setEditor] = useState<MarketEntry | 'new'>();
  const [notice, setNotice] = useState('');
  const plugins = catalog.data?.plugins ?? [];
  return <section className="panel">
    <div className="modal-head"><h2>在线插件目录</h2><button className="primary" onClick={() => { setNotice(''); setEditor('new'); }}><Plus size={16}/>添加插件</button></div>
    <p>上架后，用户刷新 iPolloWork 插件市场即可看到。预置插件也可以通过同名包加入在线目录管理。</p>
    {notice && <p role="status">{notice}</p>}
    <Status error={catalog.error} loading={!catalog.data && !catalog.error} />
    {catalog.data && <Table rows={plugins.map(p => ({ id: p.name, title: p.title, version: p.versions[0].version, category: categories[p.metadata.category] }))} columns={[
      { label: '插件', cell: row => <><strong>{row.title}</strong><br/><small>{row.id}</small></> },
      { label: '版本', cell: row => row.version }, { label: '分类', cell: row => row.category },
      { label: '操作', cell: row => <button onClick={() => { setNotice(''); setEditor(plugins.find(p => p.name === row.id)); }}>编辑</button> },
    ]}/>}
    {editor && <PluginEditor existing={editor === 'new' ? undefined : editor} close={() => setEditor(undefined)} saved={() => {
      setNotice(editor === 'new' ? '插件已上架。' : '插件资料已更新。'); setEditor(undefined); catalog.reload();
    }}/>}
  </section>;
}
