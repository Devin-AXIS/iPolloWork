/** Credential-free browser records for the agent module in the existing suite. */
export interface AgentMcp {
  serverName: string; transport: 'streamable-http' | 'stdio'; url: string; command: string;
  args: string[]; accountId: string; authField: string;
}
export interface AgentItem {
  id: string; revision: number; name: string; description: string; prompt: string; enabled: boolean;
  skills: { name: string; description: string }[]; mcp: AgentMcp[]; broken?: string;
  serviceNames?: string[];
  avatar?: string;
  model?: AgentModelChoice | null;
}
export interface AgentModelChoice { provider: string; model: string }
export interface AgentModelOption extends AgentModelChoice { name: string; providerName: string }
export interface AgentModelCatalog { models: AgentModelOption[]; default: AgentModelChoice; unavailable: boolean }
export interface AgentService { name: string; state: string; toolCount: number }
export interface AgentCatalog {
  agents: AgentItem[]; accounts: { id: string; name: string; configured: boolean }[];
  projects: { id: string; title: string; path: string }[];
  services: AgentService[];
}
export interface AgentMemory { projectId: string; agentId: string; revision: number; text: string }
