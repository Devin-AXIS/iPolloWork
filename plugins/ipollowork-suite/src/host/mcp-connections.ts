import type { SettingsDescriptor, SettingsForms } from '@deepseek-ai/dsh-settings';
import type { McpConnection, McpConnectionAction, McpConnectionList } from '../shared/mcp-connections.ts';
import type { EnterpriseMcpRefresh, EnterpriseMcpScope } from './enterprise-mcp.ts';
import { SuiteError } from './errors.ts';

/** The native web-app composition's Settings namespace; writes stay in Settings/ConfigEditor. */
const NS = 'mcp-manager';
export interface McpManagementScope {
  settings: Pick<SettingsForms, 'describe' | 'mutate' | 'writable'>;
  mcpManager: Pick<EnterpriseMcpScope['mcpManager'], 'list' | 'restart'>;
}
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
const servers = (value: unknown) => object(object(value).servers);
const message = (cause: unknown) => cause instanceof SuiteError ? cause.code : 'IPW_MCP_SYNC_FAILED';

/** A management projection; never mutates entries registered by another plugin. */
export function createMcpConnections(ctx: McpManagementScope, organization: () => EnterpriseMcpRefresh | undefined) {
  const descriptor = (): SettingsDescriptor | undefined => ctx.settings.describe({ redactSecrets: true }).find(item => item.ns === NS);
  function configured(): McpConnection[] {
    const settings = descriptor(), configured = servers(settings?.value), inherited = servers(settings?.base), user = servers(settings?.user);
    return ctx.mcpManager.list().map<McpConnection>(({ name, status, configured: present }) => {
      if (present === false) return { id: 'native-' + name, title: name, serverName: name, source: 'cleanup',
        state: status.state === 'failed' ? 'failed' : 'removing',
        ...(status.result?.cleanupError ? { error: status.result.cleanupError.slice(0, 2000) } : {}),
        canDisconnect: false, canReconnect: false, canDelete: false, canEdit: false };
      const local = Object.hasOwn(configured, name), writable = local && ctx.settings.writable;
      return { id: 'native-' + name, title: name, serverName: name,
        source: local ? 'configuration' : 'plugin', state: status.state === 'disabled' ? 'disconnected' : status.state,
        ...(status.toolCount === undefined ? {} : { toolCount: status.toolCount }),
        ...(status.lastError ? { error: status.lastError.slice(0, 2000) } : {}),
        canDisconnect: writable, canReconnect: writable || status.state !== 'disabled', canEdit: writable,
        canDelete: writable && !Object.hasOwn(inherited, name) && Object.hasOwn(user, name),
        ...(local && settings ? { revision: settings.revision } : {}) };
    });
  }
  return {
    async list(): Promise<McpConnectionList> {
      const bridge = organization();
      let organizationError: string | undefined;
      if (bridge) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          // The organization gateway may be offline; local native connections must remain manageable.
          await Promise.race([bridge(), new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new SuiteError('IPW_MCP_SYNC_TIMEOUT', 503)), 7000);
          })]);
        } catch (cause) { organizationError = message(cause); }
        finally { clearTimeout(timer); }
      }
      const team = bridge?.connections() ?? [], names = new Set(team.map(item => item.serverName));
      return { items: [...configured().filter(item => !names.has(item.serverName)), ...team],
        ...(organizationError ? { organizationError } : {}) };
    },
    async action(id: string, action: McpConnectionAction, revision?: number): Promise<void> {
      if (!id.startsWith('native-')) {
        const bridge = organization();
        if (!bridge) throw new SuiteError('IPW_MCP_MANAGER_UNAVAILABLE', 503);
        if (action === 'delete') throw new SuiteError('IPW_MCP_SOURCE_MANAGED', 403);
        if (revision === undefined) throw new SuiteError('IPW_MCP_SETTINGS_CONFLICT', 409);
        await bridge[action](id, revision);
        return;
      }
      const item = configured().find(item => item.id === id);
      if (!item) throw new SuiteError('IPW_MCP_NOT_FOUND', 404);
      if (action === 'restart' && item.canReconnect && item.state !== 'disconnected') { await ctx.mcpManager.restart(item.serverName); return; }
      if (!item.canDisconnect || action === 'delete' && !item.canDelete) throw new SuiteError('IPW_MCP_SOURCE_MANAGED', 403);
      if (revision === undefined || revision !== item.revision) throw new SuiteError('IPW_MCP_SETTINGS_CONFLICT', 409);
      try {
        if (action === 'delete') await ctx.settings.mutate(NS, [{ op: 'unset', path: ['servers', item.serverName] }], revision);
        else if (action === 'disconnect' || item.state === 'disconnected')
          await ctx.settings.mutate(NS, [{ op: 'set', path: ['servers', item.serverName, 'enabled'], value: action === 'restart' }], revision);
        else await ctx.mcpManager.restart(item.serverName);
      } catch (cause) {
        if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'SETTINGS_CONFLICT')
          throw new SuiteError('IPW_MCP_SETTINGS_CONFLICT', 409, { cause });
        throw new SuiteError('IPW_MCP_UPDATE_FAILED', 503, { cause });
      }
    },
  };
}
