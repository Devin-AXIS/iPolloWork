import { useState } from 'react';
import { Plus } from 'lucide-react';
import gt from 'semver/functions/gt.js';
import type { MarketEntry } from '../src/market.js';
import { api } from './api.js';
import { ActionForm, Field, Modal, Status, Table, useData, value } from './components.js';

const catalogPath = '/api/market/catalog';
const pluginPath = '/api/v1/market/plugins';
const categories = { productivity: '生产力', communication: '沟通协作', creative: '创意制作' };

function PluginEditor({ existing, release, close, saved }: { existing?: MarketEntry; release?: boolean; close: () => void; saved: () => void }) {
  const [draft, setDraft] = useState(release ? undefined : existing);
  const previous = existing?.versions[0];
  const source = previous?.source;
  const defaultSource = source?.type === 'git'
    ? source.url + (source.path ? '/tree/HEAD/' + source.path : '') : existing?.name;
  return <Modal title={release ? '发布插件新版' : existing ? '编辑插件' : '添加插件'} close={close}>
    {!draft ? <ActionForm label="读取插件资料" submit={async data => {
      const next = await api<MarketEntry>('/api/v1/market/discover', { source: value(data, 'source').trim() });
      if (release && existing && previous) {
        if (next.name !== existing.name) throw new Error('来源中的包名与当前插件不一致。');
        if (!gt(next.versions[0].version, previous.version)) throw new Error('该来源尚未发布高于当前目录版本的插件。');
        setDraft({ ...existing, versions: next.versions });
      } else setDraft(next);
    }}>
      {release && existing && <p>{existing.name} · 当前版本 {previous?.version}</p>}
      <Field label="npm 包名或 GitHub 地址"><input name="source" defaultValue={defaultSource} required autoFocus maxLength={2048} placeholder="@组织/插件 或 https://github.com/组织/仓库" /></Field>
      <p>如果插件位于仓库子目录，请粘贴该目录的 GitHub 页面地址。</p>
    </ActionForm> : <ActionForm label={release ? '确认发布新版' : existing ? '保存修改' : '确认上架'} submit={async data => {
      const entry = { ...draft, title: value(data, 'title').trim(), description: value(data, 'description').trim() || undefined,
        author: value(data, 'author').trim() || undefined, homepage: value(data, 'homepage').trim() || undefined,
        metadata: { category: value(data, 'category') as MarketEntry['metadata']['category'] } };
      await api(pluginPath, existing ? { expected: existing, entry } : entry, existing ? 'PATCH' : 'POST');
      saved();
    }}>
      <p><strong>{draft.name}</strong> · {release && previous && <>v{previous.version} → </>}v{draft.versions[0].version} · {draft.versions[0].source.type === 'git' ? 'GitHub' : 'npm'}</p>
      {release && <p>{draft.versions[0].source.type === 'git' ? draft.versions[0].source.url + ' @ ' + draft.versions[0].source.commit.slice(0, 12) : draft.versions[0].source.registry ?? 'https://registry.npmjs.org'}</p>}
      <Field label="展示名称"><input name="title" required maxLength={100} defaultValue={draft.title} /></Field>
      <Field label="插件介绍"><textarea name="description" rows={4} maxLength={2000} defaultValue={draft.description} placeholder="说明适用场景和主要功能" /></Field>
      <Field label="发布者"><input name="author" maxLength={100} defaultValue={draft.author} /></Field>
      <Field label="主页"><input name="homepage" type="url" maxLength={2048} defaultValue={draft.homepage} /></Field>
      <Field label="分类"><select name="category" defaultValue={draft.metadata.category}>{Object.entries(categories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
      {(!existing || release) && <button type="button" onClick={() => setDraft(undefined)}>重新选择来源</button>}
    </ActionForm>}
  </Modal>;
}

export function PluginMarket({ canManage }: { canManage: boolean }) {
  const catalog = useData<{ plugins: MarketEntry[] }>(catalogPath);
  const [editor, setEditor] = useState<{ existing?: MarketEntry; release?: boolean }>();
  const [notice, setNotice] = useState('');
  const plugins = catalog.data?.plugins ?? [];
  return <section className="panel">
    <div className="modal-head"><h2>在线插件目录</h2>{canManage && <button className="primary" onClick={() => { setNotice(''); setEditor({}); }}><Plus size={16}/>添加插件</button>}</div>
    <p>{canManage ? '粘贴 npm 包名或 GitHub 地址，核对插件介绍后即可上架。' : '可浏览已上架插件。添加插件和编辑介绍需要平台管理员账号。'}</p>
    {notice && <p role="status">{notice}</p>}
    <Status error={catalog.error} loading={!catalog.data && !catalog.error} />
    {catalog.data && (plugins.length ? <Table rows={plugins.map(p => ({ id: p.name, title: p.title, description: p.description ?? p.name, version: p.versions[0].version, category: categories[p.metadata.category] }))} columns={[
      { label: '插件', cell: row => <><strong>{row.title}</strong><small>{row.description}</small></> },
      { label: '版本', cell: row => row.version }, { label: '分类', cell: row => row.category },
      ...(canManage ? [{ label: '操作', cell: (row: { id?: unknown }) => {
        const existing = plugins.find(p => p.name === row.id)!;
        return <div className="form-actions">
          <button onClick={() => { setNotice(''); setEditor({ existing }); }}>编辑</button>
          <button onClick={() => { setNotice(''); setEditor({ existing, release: true }); }}>发布新版</button>
        </div>;
      } }] : []),
    ]}/> : <div className="empty">在线目录暂未上架插件</div>)}
    {canManage && editor && <PluginEditor {...editor} close={() => setEditor(undefined)} saved={() => {
      setNotice(editor.release ? '插件新版已发布。' : editor.existing ? '插件资料已更新。' : '插件已上架。'); setEditor(undefined); catalog.reload();
    }}/>}
  </section>;
}
