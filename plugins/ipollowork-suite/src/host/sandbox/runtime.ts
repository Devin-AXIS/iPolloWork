/** Session-owned sandbox resources. DSH remains the only agent and tool dispatcher. */
import type { Branded } from '@deepseek-ai/dsh-brand';
import { HarnessError } from '@deepseek-ai/dsh-error';
import type { Settings } from './common-config.ts';

/** Adapter failures whose codes are safe to expose in DSH tool results. */
export type SandboxFailureCode = 'SANDBOX_UNAVAILABLE' | 'SANDBOX_LIMIT' | 'SANDBOX_CLOSED' | 'SANDBOX_RELEASE_FAILED' | 'SANDBOX_INPUT_INVALID' | 'PROJECT_STORAGE_FAILED';
/** Redacted failure; SDK causes may contain credentials and are not retained. */
export class SandboxFailure extends HarnessError {
  constructor(code: SandboxFailureCode, message: string) { super(message, code); }
}
/** SDK subset owned by the adapter; test doubles implement the same operations. */
export interface RemoteSandbox {
  readonly id: SandboxId;
  readonly commands: { run(command: string, options: { workingDirectory: string; timeoutSeconds: number }, handlers: ExecutionHandlers, signal: AbortSignal): Promise<Execution> };
  readonly files: {
    readBytes(path: string, options: { offset: number; limit: number }): Promise<Uint8Array>;
    writeFiles(entries: { path: string; data: string | Uint8Array }[]): Promise<void>;
    createDirectories?(entries: { path: string; mode: number }[]): Promise<void>;
  };
  kill(): Promise<void>;
  close(): Promise<void>;
}
/** Factory for the official SDK, injectable only by trusted composition/tests. */
export type SandboxId = Branded<'ipollo.sandbox.id'>;
/** Stable project-volume identity from the authorization service. */
export interface Volume {
  name: 'project'; mountPath: '/workspace';
  pvc: { claimName: string; createIfNotExists?: boolean; deleteOnSandboxTermination?: boolean; storage?: string; accessModes?: string[] };
}
/** Host-owned connection and project binding passed to the execution provider. */
export interface SandboxCreateOptions {
  image: string; connectionConfig: { apiKey: string; domain?: string; requestTimeoutSeconds?: number; disableMetrics?: boolean };
  metadata?: Record<string, string>; signal?: AbortSignal; volumes?: Volume[];
  timeoutSeconds?: number; resource?: { cpu: string; memory: string }; secureAccess?: boolean;
}
/** Streamed process output consumed by the native DSH tool. */
export interface ExecutionHandlers {
  skipAccumulation?: boolean;
  onStdout?(value: { text: string; timestamp: number }): void | Promise<void>;
  onStderr?(value: { text: string; timestamp: number }): void | Promise<void>;
}
/** Settled process status; stdout and stderr are delivered through callbacks. */
export interface Execution { logs: { stdout: never[]; stderr: never[] }; result: never[]; exitCode?: number; error?: unknown }

export type SandboxFactory = (options: SandboxCreateOptions) => Promise<RemoteSandbox>;
interface Entry { remote: RemoteSandbox; unusable: boolean }
/** Bounded command result, also persisted as DSH presentation metadata. */
export interface CommandResult { stdout: string; stderr: string; exitCode: number | null; truncated: boolean }

/** Per-instance owner; serializes each session and drains accepted work before unload. */
export class SandboxRuntime {
  private readonly entries = new Map<string, Entry>();
  private readonly tails = new Map<string, Promise<unknown>>();
  private readonly shutdown = new AbortController();
  private stopping = false;
  private pendingCreates = 0;
  constructor(private readonly settings: Settings, private readonly apiKey: string, private readonly create: SandboxFactory, private readonly initialize?: (remote: RemoteSandbox, signal: AbortSignal) => Promise<void>, private readonly resolveVolume?: (signal: AbortSignal) => Promise<Volume>) {}

  /** Serialize one session's operation, including create/release, while allowing other sessions to proceed. */
  run<T>(owner: string, signal: AbortSignal, operation: (remote: RemoteSandbox, signal: AbortSignal) => Promise<T>): Promise<T> {
    owner = this.resolveVolume ? 'project' : owner;
    return this.enqueue(owner, async () => {
      const combined = AbortSignal.any([signal, this.shutdown.signal]);
      combined.throwIfAborted();
      // Reauthorize retained environments as well as new allocations.
      let volume: Volume | undefined;
      try { volume = await this.resolveVolume?.(combined); }
      catch (error) {
        const retained = this.entries.get(owner);
        if (retained) await this.destroy(owner, retained);
        throw error;
      }
      const entry = await this.acquire(this.resolveVolume ? 'project' : owner, combined, volume);
      combined.throwIfAborted();
      const aborted = Promise.withResolvers<never>();
      const cancel = () => aborted.reject(combined.reason);
      combined.addEventListener('abort', cancel, { once: true });
      const pending = Promise.resolve().then(() => operation(entry.remote, combined));
      try { return await Promise.race([pending, aborted.promise]); }
      catch (error) {
        // A lost command response may leave remote work running. Quarantine before returning.
        entry.unusable = true;
        try { await this.destroy(this.resolveVolume ? 'project' : owner, entry); }
        catch (_cleanupError) { throw new SandboxFailure('SANDBOX_RELEASE_FAILED', 'Sandbox outcome is unknown and release failed. Check the server before retrying.'); }
        if (combined.aborted) combined.throwIfAborted();
        throw new SandboxFailure('SANDBOX_UNAVAILABLE', 'Sandbox operation failed; its environment was released. Check the service before retrying.');
      } finally {
        combined.removeEventListener('abort', cancel);
        await Promise.allSettled([pending]);
      }
    });
  }

  /** Request deletion for only this session; accepted deletion may still be completing remotely. */
  release(owner: string): Promise<void> {
    owner = this.resolveVolume ? 'project' : owner;
    return this.enqueue(owner, async () => {
      const entry = this.entries.get(owner);
      if (entry) await this.destroy(owner, entry);
    });
  }

  /** Stop admission, cancel accepted commands, drain queues, then release all owned SDK clients. */
  async dispose(): Promise<void> {
    this.stopping = true;
    this.shutdown.abort(new DOMException('Plugin unloaded', 'AbortError'));
    await Promise.allSettled([...this.tails.values()]);
    const results = await Promise.allSettled([...this.entries].map(([owner, entry]) => this.destroy(owner, entry)));
    if (results.some(result => result.status === 'rejected')) throw new SandboxFailure('SANDBOX_RELEASE_FAILED', 'Some sandbox deletions could not be confirmed. Server TTL remains active; inspect the service.');
  }

  private enqueue<T>(owner: string, work: () => Promise<T>): Promise<T> {
    if (this.stopping) return Promise.reject(new SandboxFailure('SANDBOX_CLOSED', 'Sandbox plugin is unloading.'));
    const result = (this.tails.get(owner) ?? Promise.resolve()).then(work, work);
    const settled = result.then(() => {}, () => {});
    this.tails.set(owner, settled);
    void settled.then(() => { if (this.tails.get(owner) === settled) this.tails.delete(owner); });
    return result;
  }

  private async acquire(owner: string, signal: AbortSignal, volume?: Volume): Promise<Entry> {
    const existing = this.entries.get(owner);
    if (existing) {
      if (existing.unusable) throw new SandboxFailure('SANDBOX_RELEASE_FAILED', 'This session has an unconfirmed sandbox release. Release it before continuing.');
      return existing;
    }
    if (this.entries.size + this.pendingCreates >= this.settings.maxSandboxes) throw new SandboxFailure('SANDBOX_LIMIT', 'Sandbox capacity is full. Release an unused session environment.');
    this.pendingCreates++;
    try {
      const remote = await this.create({
        connectionConfig: { domain: this.settings.endpoint, apiKey: this.apiKey, requestTimeoutSeconds: this.settings.requestTimeoutSeconds, disableMetrics: true },
        ...(volume ? { volumes: [volume] } : {}),
        image: this.settings.image, timeoutSeconds: this.settings.sandboxTtlSeconds,
        resource: { cpu: this.settings.cpu, memory: this.settings.memory },
        metadata: { application: 'ipollowork', session: owner }, secureAccess: this.settings.secureAccess, signal,
      });
      const entry = { remote, unusable: false };
      this.entries.set(owner, entry);
      if (signal.aborted) { await this.destroy(owner, entry); signal.throwIfAborted(); }
      try { await this.initialize?.(remote, signal); }
      catch (error) { await this.destroy(owner, entry); throw error; }
      return entry;
    } catch (error) {
      if (error instanceof SandboxFailure) throw error;
      if (signal.aborted) signal.throwIfAborted();
      throw new SandboxFailure('SANDBOX_UNAVAILABLE', 'Sandbox creation failed. An unconfirmed remote allocation may remain until its TTL; inspect the service before retrying.');
    } finally { this.pendingCreates--; }
  }

  private async destroy(owner: string, entry: Entry): Promise<void> {
    entry.unusable = true;
    try {
      try { await entry.remote.kill(); }
      finally { await entry.remote.close(); }
      this.entries.delete(owner);
    } catch (_error) {
      throw new SandboxFailure('SANDBOX_RELEASE_FAILED', 'Sandbox deletion or transport cleanup failed. Its state is unconfirmed; inspect the service.');
    }
  }
}

/** Capture UTF-8 output with one shared byte budget, without SDK log accumulation. */
export async function executeCommand(remote: RemoteSandbox, command: string, settings: Settings, signal: AbortSignal): Promise<CommandResult> {
  let remaining = settings.maxOutputBytes;
  const output: CommandResult = { stdout: '', stderr: '', exitCode: null, truncated: false };
  const append = (stream: 'stdout' | 'stderr', text: string): void => {
    const bytes = Buffer.from(text);
    const retained = bytes.subarray(0, remaining);
    output[stream] += retained.toString('utf8');
    remaining -= retained.length;
    if (retained.length < bytes.length) output.truncated = true;
  };
  const result = await remote.commands.run(command, { workingDirectory: settings.workspace, timeoutSeconds: settings.commandTimeoutSeconds }, {
    skipAccumulation: true,
    onStdout: message => append('stdout', message.text),
    onStderr: message => append('stderr', message.text),
  }, signal);
  signal.throwIfAborted();
  if (result.error) throw new SandboxFailure('SANDBOX_UNAVAILABLE', 'Remote command reported an execution error. Check the environment before continuing.');
  if (typeof result.exitCode !== 'number') throw new Error('Remote command did not report an exit status');
  output.exitCode = result.exitCode;
  return output;
}
