import { z } from 'zod'

export const actionSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]+$/), title: z.string().optional(), description: z.string().optional(),
  effect: z.enum(['read', 'write', 'destructive']).default('write').transform(value => value === 'read' ? 'read' as const : 'write' as const), inputSchema: z.record(z.string(), z.unknown()).default({ type: 'object' }),
}).passthrough()
export const manifestSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]+$/), name: z.string(), description: z.string(),
  package: z.object({ version: z.string() }).passthrough(),
  resources: z.array(z.object({
    id: z.string(), type: z.string(), path: z.string(), label: z.string().optional(), description: z.string().optional(),
    actions: z.array(actionSchema).optional(),
  }).passthrough()).default([]),
  authorization: z.object({ methods: z.array(z.object({
    id: z.string(), label: z.string().optional(), fields: z.array(z.object({
      id: z.string(), label: z.string().optional(), secret: z.boolean().optional(), required: z.boolean().optional(),
    }).passthrough()).default([]),
  }).passthrough()).default([]) }).passthrough().optional(),
  localization: z.object({ translations: z.record(z.string(), z.object({ name: z.string().optional(), description: z.string().optional() }).passthrough()).optional() }).passthrough().optional(),
}).passthrough()
export type Manifest = z.infer<typeof manifestSchema>
export type Action = z.infer<typeof actionSchema>
export interface ActionContext { directory: string; workspaceId: string; sessionId?: string; signal: AbortSignal; trusted?: boolean }
export interface BusinessRuntime {
  plugin: { id: string; version: string }; workspace: { root: string }; storage: { dataDir: string };
  authorization: {
    getCredential(method: string, account?: string): Promise<Record<string, string> | null>;
    readCredential(account: string, method: string): Promise<Record<string, string> | null>;
    listConnections(): Promise<{ accountId: string; methodId: string; status: string; active: boolean }[]>;
    saveCredential(method: string, account: string, values: Record<string, string>): Promise<void>;
    revokeAccount(account: string): Promise<boolean>;
    setActiveAccount(method: string, account: string): Promise<boolean>;
  };
  host: { callAction(name: string, input: Record<string, unknown>, context?: ActionContext): Promise<{ ok: boolean; result?: unknown; message?: string }> };
}
export interface BusinessService {
  actions: Record<string, (input: Record<string, unknown>, context: ActionContext) => Promise<unknown> | unknown>;
  dispose?: () => void | Promise<void>;
}
export interface BundleState {
  id: string; title: string; description: string;
  workspaces: { id: string; title: string }[];
  actions: { id: string; resource: string; title: string; effect: 'read' | 'write'; inputSchema: Record<string, unknown> }[];
  views: { id: string; title: string }[];
  methods: { id: string; label: string; fields: { id: string; label: string; secret: boolean; required: boolean }[] }[];
  connections: { accountId: string; methodId: string; status: string; active: boolean }[];
  skills: { id: string; title: string }[];
}
