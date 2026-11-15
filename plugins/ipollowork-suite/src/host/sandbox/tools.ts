/** Cloud tools registered into DSH's existing execution and Session pipeline. */
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-agent';
import type {} from '@deepseek-ai/dsh-sandbox-policy';
import { defineTool, ToolContextUnavailableError, type ToolRunContext, type ToolDefinition } from '@deepseek-ai/dsh-tools';
import { z } from 'zod';
import { ProjectStorage } from './project.ts';
import { Config, settingsSchema } from './common-config.ts';
import { SandboxRuntime, SandboxFailure, executeCommand, type SandboxFactory } from './runtime.ts';
function owner(exec: ToolRunContext): string {
  if (!exec.agent) throw new ToolContextUnavailableError('Cloud execution requires an owning DSH session.');
  return exec.agent.session.id;
}
function absolutePath(path: string): string {
  if (!path.startsWith('/') || path.includes('\0')) throw new SandboxFailure('SANDBOX_INPUT_INVALID', 'Use an absolute sandbox path without null characters.');
  return path;
}

/** Register the shared tools and lifecycle with a trusted execution backend.
 * @param ctx - Official DSH plugin context.
 * @param config - Validated common limits and project authorization settings.
 * @param create - Alibaba execution factory.
 * @param projectWorkspace - Backend mount directory in project mode.
 */
export function applyWithFactory(ctx: Context, config: Config, create: SandboxFactory, projectWorkspace = "/workspace"): void {
  const settings = settingsSchema.parse(config);
  if (settings.project) settings.workspace = projectWorkspace;
  const apiKey = process.env[settings.apiKeyEnv];
  if (!apiKey) throw new SandboxFailure('SANDBOX_INPUT_INVALID', `Configure the Host environment variable ${settings.apiKeyEnv} before loading cloud execution.`);
  const project = settings.project ? new ProjectStorage(settings) : undefined;
  const runtime = new SandboxRuntime(settings, apiKey, create, undefined, project ? signal => project.volume(signal) : undefined);
  ctx.effect(() => () => runtime.dispose());
  const register = (tool: ToolDefinition) => ctx.effect(() => ctx.tools.register(tool));
  const writable = (exec: ToolRunContext): void => {
    owner(exec);
    if (ctx.sandboxPolicy.resolve({ session: exec.agent!.session }).mode === 'read-only')
      throw new SandboxFailure('SANDBOX_INPUT_INVALID', 'Cloud execution is unavailable in read-only mode.');
  };
  if (settings.releaseAfterTurn) {
    ctx.on('agent/turn-stopping', async ({ agent }) => { await runtime.release(agent.session.id); });
  }
  register(defineTool({
    name: 'sandbox_exec',
    description: project ? `Run a shell command in this project’s cloud sandbox. Files under ${settings.workspace} persist across execution environments.` : 'Run a shell command in this session’s isolated cloud sandbox. Files persist until release or server expiry.',
    parameters: { command: { type: 'string', required: true, description: 'Shell command. Use sandbox paths; the configured working directory applies to each call.' } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        stdout: { type: 'string', required: true }, stderr: { type: 'string', required: true },
        exitCode: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true }, truncated: { type: 'boolean', required: true },
      } },
      render: (_args, value) => [{ type: 'text', text: `Exit: ${value.exitCode}\n${value.stdout}${value.stderr}${value.truncated ? '\n[Output truncated; write large output to a sandbox file and read ranges.]' : ''}` }],
      presentationMeta: (_args, value) => value,
    },
    presentCall: args => ({ card: 'terminal', title: args.command, cwd: settings.workspace }),
    presentResult: (_args, result) => {
      const parsed = z.object({ stdout: z.string(), stderr: z.string(), exitCode: z.number().int().nullable(), truncated: z.boolean() }).safeParse(result.meta);
      if (!parsed.success) return undefined;
      return { card: 'terminal', output: parsed.data.stdout + parsed.data.stderr, ...(parsed.data.exitCode === null ? {} : { exitCode: parsed.data.exitCode }) };
    },
    async execute(args, exec) {
      writable(exec);
      if (!args.command.trim()) throw new SandboxFailure('SANDBOX_INPUT_INVALID', 'Command must not be empty.');
      return runtime.run(owner(exec), exec.signal, (remote, signal) => executeCommand(remote, args.command, settings, signal));
    },
  }));
  register(defineTool({
    name: 'sandbox_read_file', description: 'Read a bounded UTF-8 range from a file inside this session’s cloud sandbox.',
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute sandbox file path.' },
      offset: { type: 'integer', description: 'Zero-based byte offset; defaults to 0.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        path: { type: 'string', required: true }, text: { type: 'string', required: true },
        offset: { type: 'integer', required: true }, nextOffset: { type: 'integer', required: true }, truncated: { type: 'boolean', required: true },
      } },
      render: (_args, value) => [{ type: 'text', text: `${value.path} (bytes ${value.offset}–${value.nextOffset})\n${value.text}${value.truncated ? '\n[More bytes available; continue at nextOffset.]' : ''}` }],
    },
    presentCall: args => ({ card: 'generic', title: 'Read sandbox file', kind: 'read', locations: [{ path: args.path }] }),
    async execute(args, exec) {
      writable(exec);
      const path = absolutePath(args.path);
      const offset = args.offset ?? 0;
      if (offset < 0 || !Number.isSafeInteger(offset)) throw new SandboxFailure('SANDBOX_INPUT_INVALID', 'Offset must be a nonnegative safe integer.');
      return runtime.run(owner(exec), exec.signal, async (remote, signal) => {
        const data = await remote.files.readBytes(path, { offset, limit: settings.maxFileBytes + 1 });
        signal.throwIfAborted();
        const bytes = data.subarray(0, settings.maxFileBytes);
        return { path, offset, nextOffset: offset + bytes.length, text: Buffer.from(bytes).toString('utf8'), truncated: data.length > settings.maxFileBytes };
      });
    },
  }));
  register(defineTool({
    name: 'sandbox_write_file', description: 'Create or overwrite a UTF-8 file inside this session’s cloud sandbox. Parent directories must exist.',
    parameters: { path: { type: 'string', required: true, description: 'Absolute sandbox file path.' }, text: { type: 'string', required: true, description: 'Complete new UTF-8 contents.' } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { path: { type: 'string', required: true }, bytes: { type: 'integer', required: true } } },
      render: (_args, value) => [{ type: 'text', text: `Wrote ${value.bytes} bytes to ${value.path}.` }],
    },
    presentCall: args => ({ card: 'generic', title: 'Write sandbox file', kind: 'edit', locations: [{ path: args.path }] }),
    async execute(args, exec) {
      writable(exec);
      const path = absolutePath(args.path);
      const bytes = Buffer.byteLength(args.text);
      if (bytes > settings.maxFileBytes) throw new SandboxFailure('SANDBOX_INPUT_INVALID', `File exceeds the ${settings.maxFileBytes}-byte write limit.`);
      return runtime.run(owner(exec), exec.signal, async (remote, signal) => {
        await remote.files.writeFiles([{ path, data: args.text }]);
        signal.throwIfAborted();
        return { path, bytes };
      });
    },
  }));
  register(defineTool({
    name: 'sandbox_release', description: project ? 'Release the execution sandbox. Project files remain on persistent storage and are available next time.' : 'Delete this session’s temporary sandbox and its files.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    presentCall: () => ({ card: 'generic', title: 'Release cloud sandbox', kind: 'delete' }),
    async execute(_args, exec) {
      writable(exec);
      exec.signal.throwIfAborted();
      await runtime.release(owner(exec));
      return 'Sandbox deletion accepted (or no sandbox was allocated); server cleanup may still be completing.';
    },
  }));
}
