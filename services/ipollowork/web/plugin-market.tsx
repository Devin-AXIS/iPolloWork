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

export function PluginMarket({ canManage }: { canManage: boolean }) {
  const catalog = useData<{ plugins: MarketEntry[] }>(catalogPath);
  const [editor, setEditor] = useState<MarketEntry | 'new'>();
  const [notice, setNotice] = useState('');
  const plugins = catalog.data?.plugins ?? [];
  return <section className="panel market-directory">
    <div className="market-heading">
      <div><h2>在线插件目录</h2>
        <p>{canManage ? '粘贴 npm 包名或 GitHub 地址，核对插件介绍后即可上架。' : '可浏览已上架插件。添加插件和编辑介绍需要平台管理员账号。'}</p>
      </div>
      {canManage && <button className="primary" onClick={() => { setNotice(''); setEditor('new'); }}><Plus size={16}/>添加插件</button>}
    </div>
    {notice && <p className="market-notice" role="status">{notice}</p>}
    <Status error={catalog.error} loading={!catalog.data && !catalog.error} />
    {catalog.data && (plugins.length ? <Table rows={plugins.map(p => ({ id: p.name, title: p.title, description: p.description ?? p.name, version: p.versions[0].version, category: categories[p.metadata.category] }))} columns={[
      { label: '插件', cell: row => <><strong>{row.title}</strong><small>{row.description}</small></> },
      { label: '版本', cell: row => row.version }, { label: '分类', cell: row => row.category },
      ...(canManage ? [{ label: '操作', cell: (row: { id?: unknown }) => <button onClick={() => { setNotice(''); setEditor(plugins.find(p => p.name === row.id)); }}>编辑</button> }] : []),
    ]}/> : <div className="empty">在线目录暂未上架插件</div>)}
    {canManage && editor && <PluginEditor existing={editor === 'new' ? undefined : editor} close={() => setEditor(undefined)} saved={() => {
      setNotice(editor === 'new' ? '插件已上架。' : '插件资料已更新。'); setEditor(undefined); catalog.reload();
    }}/>}
  </section>;
}
