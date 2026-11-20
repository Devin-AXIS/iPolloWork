/** Credential-free connection controls over DSH's native MCP manager. */
export interface McpConnection {
  id: string;
  title: string;
  serverName: string;
  source: 'organization' | 'configuration' | 'plugin' | 'cleanup';
  state: string;
  toolCount?: number;
  error?: string;
  canDisconnect: boolean;
  /** Omitted by earlier Hosts, whose configured entries all allowed native restart. */
  canReconnect?: boolean;
  canDelete: boolean;
  canEdit: boolean;
  revision?: number;
}
export type McpConnectionAction = 'disconnect' | 'restart' | 'delete';
export interface McpConnectionList { items: McpConnection[]; organizationError?: string }
