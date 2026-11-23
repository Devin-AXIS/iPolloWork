export interface IntegrationScope {
  kind: 'project' | 'table'
  id: string
}
export interface IntegrationInfo {
  scope: IntegrationScope & { name: string }
  transport: 'streamable-http'
  mode: 'local'
  urls: { mcp: string; context: string; openapi: string; operations: string }
  mcpConfig: unknown
  instructions: string
  tools: Array<{ name: string; title: string; description: string; readOnly: boolean }>
}
