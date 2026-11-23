import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod'
import type { IntegrationScope } from '../core/integration'
import { integration, integrationInstructions } from './integration'
import { DataError } from './errors'

// One stateless request per transport. Business logic and storage stay in the existing service.
export async function handleMcp(scope: IntegrationScope, request: Request) {
  if (request.method !== 'POST') {
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32000, message: '此无状态 MCP 端点只接受 POST' },
      }),
      { status: 405, headers: { 'Content-Type': 'application/json', Allow: 'POST' } },
    )
  }
  const service = await integration(scope)
  const server = new McpServer(
    { name: 'ipollo-data', version: '0.1.0' },
    { instructions: integrationInstructions },
  )
  for (const op of service.operations) {
    server.registerTool(
      op.name,
      {
        title: op.title,
        description: op.description,
        inputSchema: op.schema,
        outputSchema: z.object({
          result: z.unknown().optional(),
          error: z
            .object({
              status: z.number().int(),
              error: z.string(),
              issues: z.array(z.unknown()).optional(),
            })
            .optional(),
        }),
        annotations: {
          readOnlyHint: op.readOnly,
          destructiveHint: !op.readOnly,
          idempotentHint: op.idempotent,
          openWorldHint: op.name === 'records_refresh',
        },
      },
      async (input) => {
        try {
          const result = await service.execute(op.name, input)
          return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
            structuredContent: { result },
          }
        } catch (error) {
          const failure =
            error instanceof z.ZodError
              ? {
                  status: 400,
                  error: '参数不符合结构',
                  issues: error.issues.map(({ path, message }) => ({ path, message })),
                }
              : error instanceof DataError
                ? { status: error.status, error: error.message }
                : error &&
                    typeof error === 'object' &&
                    'code' in error &&
                    ['23505', '23503'].includes(String(error.code))
                  ? { status: 409, error: '名称、关联约束或引用发生冲突，请重新读取后处理' }
                  : { status: 500, error: '操作未完成，请重新读取当前状态后处理' }
          return {
            isError: true,
            content: [{ type: 'text', text: JSON.stringify(failure) }],
            structuredContent: { error: failure },
          }
        }
      },
    )
  }
  const uri = `ipollo-data://${scope.kind}/${scope.id}/schema`
  server.registerResource(
    'data-schema',
    uri,
    {
      title: `${service.name} · 数据结构`,
      mimeType: 'application/json',
      description: '当前接入范围的表、字段、关联及版本，不包含记录正文。',
    },
    async () => ({
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(service.context) }],
    }),
  )
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true })
  await server.connect(transport)
  try {
    return await transport.handleRequest(request)
  } finally {
    await server.close()
  }
}
