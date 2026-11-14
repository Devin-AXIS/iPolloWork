/** Public native DSH capabilities consumed by the agent module. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type * as SubagentTool from '@deepseek-ai/dsh-tool-subagent'
import type { z } from 'zod'
import type { AgentGlobal, AgentSkill, AgentStore } from './agent-store.ts'
import type { AgentModelChoice } from '../shared/agents.ts'

export interface Project { id: string; title: string; path: string; sessionIds: readonly string[] }
export interface AgentRef { session: { header: { cwd?: string } } }
export interface ModelAgentRef extends AgentRef { model: { select(selection: AgentModelChoice): void } }
export interface AgentRuntime { store: AgentStore; coordinatorPreset: string; projectFor(agent: AgentRef | undefined): Project }
export interface NativeFiber { dispose(): Promise<void> }
export interface NativeEntry { name: string; id?: string | undefined; [key: string]: unknown }
export interface PresetDefinition { id: string; name: string; description: string; plugins: NativeEntry[] }
export interface AgentContext {
  on(event: 'tools/change', listener: () => void): () => void;
  on(event: 'agent/created', listener: (event: { agent: ModelAgentRef; source: 'startup' | 'resume' | 'clear' | 'compact'; signal?: AbortSignal }) => Promise<void>): () => void;
  effect(setup: () => void | (() => void | Promise<void>), label?: string): unknown;
  provide(name: string, value: AgentRuntime): void;
  plugin(plugin: typeof SubagentTool, config: { provider: string; toolName: string; agentPreset?: string; allowedAgentPresets?: string[] }): NativeFiber;
  logger: { warn(message: string, error: unknown): void };
  webServer: { register(route: { kind: 'prefix'; path: string; handler(request: IncomingMessage, response: ServerResponse): Promise<void> }): () => void };
  connection: { requestRejection(request: { headers: IncomingMessage['headers'] }): number | undefined };
  storageDomain: { open(spec: { name: string; version: number; global: { schema: z.ZodType; initial: unknown }; tables: Record<string, never> }): Promise<{ global: AgentGlobal; close(): Promise<void> }> };
  credentials: { describe(ref: string): Promise<{ configured: boolean }>; set(ref: string, value: string): Promise<void> };
  workspaceRegistry: { list(): Project[]; get(id: string): Project | undefined; create(path: string, title?: string): Promise<Project>; archivedSessionIds: readonly string[] };
  agentPresets: {
    readDocument(id: string): Promise<{ content: string }>;
    register(definition: PresetDefinition): Promise<() => Promise<void>>;
    resolve(id: string): Promise<{ broken?: string }>;
    acquireScope(id: string): Promise<{ key: object; [Symbol.asyncDispose](): Promise<void> }>;
  };
  skills: { list(options: { cwd?: string; scope: object }): Promise<AgentSkill[]>; get(name: string, options: { cwd?: string; scope: object }): Promise<AgentSkill | undefined>; register(skill: AgentSkill): unknown };
  tools: { register(tool: ToolDefinition): unknown; schemas(): { name: string }[]; restrict(filter: { deny: string[] }): () => void };
  mcpManager: { list(): { name: string; configured: boolean; status: { state: string; toolCount?: number } }[] };
  systemPrompt: {
    getSectionOrder(name: string): number; getContextOrder(name: string): number;
    section(value: { name: string; order: number; interpolate: false; text: string | (() => string) }): unknown;
    context(value: { name: string; order: number; interpolate: false; text(context: { agent?: AgentRef }): string }): unknown;
  };
  subagents: { rootOf(agent: AgentRef): AgentRef };
  llm: { resolveCallConfig(selection: AgentModelChoice, signal?: AbortSignal): Promise<unknown> };
  sessionController: {
    list(request: Record<string, never>, signal: AbortSignal): Promise<{ items: { sessionId: string; parentSessionId?: string; projections?: { values: { agentPreset?: string | null } } }[] }>;
    create(request: { workspaceId: string; agentPreset: string }): Promise<{ sessionId: string; agentPreset?: string }>;
    modelCatalog(): Promise<{ default: AgentModelChoice; groups: { id: string; name: string; models: { id: string; name: string }[] }[]; failures: { id: string }[] }>;
  };
  ipolloAgents: AgentRuntime;
}
