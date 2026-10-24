import { applyWorkspaceTheme } from './workspace-theme.mjs';

export function createBridge(onContext, onTool) {
  let nextId = 0, initialized = false;
  const pending = new Map();
  function request(method, params = {}) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error('Work 响应超时，请检查工作台连接')); }, 120000);
      pending.set(id, { resolve, reject, timeout });
      parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
    });
  }
  function theme(context) { applyWorkspaceTheme(document.documentElement, context, matchMedia('(prefers-color-scheme: dark)').matches); onContext(context); }
  addEventListener('message', async event => {
    if (event.source !== parent || event.data?.jsonrpc !== '2.0') return;
    const message = event.data;
    if (message.id !== undefined && !message.method) {
      const handler = pending.get(message.id); if (!handler) return;
      pending.delete(message.id); clearTimeout(handler.timeout);
      message.error ? handler.reject(new Error(message.error.message)) : handler.resolve(message.result); return;
    }
    if (message.method === 'ui/notifications/host-context-changed') { theme(message.params); return; }
    if (message.id === undefined) return;
    try {
      const result = message.method === 'ui/resource-teardown' ? {} : await onTool(message.method, message.params);
      parent.postMessage({ jsonrpc: '2.0', id: message.id, result }, '*');
    } catch (error) { parent.postMessage({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: error.message } }, '*'); }
  });
  return {
    request,
    async start() {
      theme({});
      if (parent === window) throw new Error('请从 iPolloWork 插件详情打开；本地预览请运行开发服务');
      const result = await request('ui/initialize', { protocolVersion: '2025-11-21', appInfo: { name: 'iPolloWork 短片工作台', version: '0.1.0' }, appCapabilities: { tools: {}, availableDisplayModes: ['inline', 'fullscreen'] } });
      theme(result.hostContext || {}); initialized = true;
      parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} }, '*');
      return result;
    },
    async call(name, args = {}) {
      const result = await request('tools/call', { name, arguments: args });
      if (result.isError) throw new Error(result.content?.find(c => c.type === 'text')?.text || '操作未完成');
      if (result.structuredContent) return result.structuredContent;
      const text = result.content?.find(c => c.type === 'text')?.text;
      try { return JSON.parse(text); } catch { throw new Error(text || 'Work 返回格式无效'); }
    },
    context(project, selection) {
      if (!initialized) return;
      void request('ui/update-model-context', { content: [{ type: 'text', text: `短片工作台：${project.title}；版本 ${project.revision}；选中 ${selection || '无'}。使用 project_read 查看，再用 project_update 更新；生成素材使用 generate，需要用户授权。` }], structuredContent: { projectId: project.id, revision: project.revision, selection, nodeCount: project.nodes.length, shotCount: project.shots.length } }).catch(() => {});
    },
  };
}
