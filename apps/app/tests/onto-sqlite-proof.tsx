/** @jsxImportSource react */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import '../src/app/index.css';
import { createiPolloWorkServerClient } from '../src/app/lib/ipollowork-server';
import { WorkspaceAppFrame } from '../src/react-app/plugin-ui/workspace-app-frame';
import { PlatformProvider, createDefaultPlatform } from '../src/react-app/kernel/platform';
import { Button } from '../src/components/ui/button';
import type { PluginUiSurface } from '../src/react-app/plugin-ui/plugin-ui-contributions';

const client = createiPolloWorkServerClient({ baseUrl: 'http://127.0.0.1:5398', token: 'onto-proof' });
const surface: PluginUiSurface = { id: 'ipollo-onto:workspace-app:workbench', pluginId: 'ipollo-onto',
  pluginName: 'iPollo Onto', label: 'iPollo Onto', description: 'SQLite 安装即用验证', iconSrc: null, action: null,
  resource: { type: 'ui', id: 'workbench', path: 'ui/workbench.html', ui: { uri: 'ui://ipollo-onto/workbench', mimeType: 'text/html;profile=mcp-app' } } };
function Proof() {
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState('隔离验证：真实宿主安装、工作台桥接与 SQLite。旧版本号为测试夹具。');
  const [busy, setBusy] = useState(false);
  async function change(kind: string) {
    setBusy(true);
    try {
      const response = await fetch('http://127.0.0.1:5399/' + kind, { method: 'POST' });
      if (!response.ok) throw new Error('验证操作失败');
      setStatus(kind === 'update' ? '已通过宿主更新，检查项目和数据仍在。' : '已重启插件服务，检查项目和数据仍在。');
      setRevision(value => value + 1);
    } catch (error) { setStatus(error instanceof Error ? error.message : '验证操作失败'); }
    finally { setBusy(false); }
  }
  return <main className="h-screen flex flex-col bg-background text-foreground">
    <header className="flex items-center gap-3 border-b px-4 py-2 text-xs"><span className="flex-1">{status}</span>
      <Button variant="outline" disabled={busy} onClick={() => void change('restart')}>重启插件</Button>
      <Button variant="outline" disabled={busy} onClick={() => void change('update')}>安装正式更新</Button></header>
    <div className="flex-1 min-h-0"><WorkspaceAppFrame key={revision} surface={surface} client={client}
      workspaceId="onto-proof" workspaceRoot="" sessionId="onto-demo-session" placement="workspace" active className="h-full" /></div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<HashRouter><PlatformProvider value={createDefaultPlatform()}><Proof /></PlatformProvider></HashRouter>);
