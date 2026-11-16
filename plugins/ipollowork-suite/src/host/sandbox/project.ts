/** Resolve an authorized persistent project volume without exposing credentials to the model. */
import { z } from 'zod';
import { readJson } from '../account.ts';
import type { Volume } from './runtime.ts';
import type { Settings } from './common-config.ts';
import { SandboxFailure } from './runtime.ts';

const bindingSchema = z.object({
  projectId: z.string().min(1),
  volume: z.object({
    name: z.literal('project'), mountPath: z.literal('/workspace'),
    pvc: z.object({ claimName: z.string().regex(/^ipollo-project-[a-f0-9]{40}$/), createIfNotExists: z.literal(true), deleteOnSandboxTermination: z.literal(false), storage: z.string().regex(/^[1-9][0-9]*$/), accessModes: z.tuple([z.literal('ReadWriteOnce')]) }).strict(),
  }).strict(),
}).strict();

/** One trusted project binding. The account service authorizes every operation. */
export class ProjectStorage {
  private readonly url: string;
  private readonly token: string;
  constructor(private readonly settings: Settings) {
    const project = settings.project;
    if (!project) throw new SandboxFailure('SANDBOX_INPUT_INVALID', 'Project configuration is required.');
    const base = new URL(project.serviceUrl);
    if ((base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) || base.username || base.password || base.search || base.hash || base.pathname !== '/')
      throw new SandboxFailure('SANDBOX_INPUT_INVALID', 'Project service must use HTTPS or loopback HTTP without URL credentials.');
    this.url = project.serviceUrl.replace(/\/$/, '') + '/api/v1/projects/' + encodeURIComponent(project.projectId) + '/runtime';
    this.token = process.env[project.tokenEnv] ?? '';
    if (!this.token) throw new SandboxFailure('SANDBOX_INPUT_INVALID', 'Configure the Host project token before loading the plugin.');
  }
  /** Resolve only the account-authorized project volume; a failure never falls back to temporary storage. */
  async volume(signal: AbortSignal): Promise<Volume> {
    let response: Response;
    try { response = await fetch(this.url, { headers: { Authorization: 'Bearer ' + this.token }, signal: AbortSignal.any([signal, AbortSignal.timeout(this.settings.requestTimeoutSeconds * 1000)]), redirect: 'error' }); }
    catch (_error) {
      signal.throwIfAborted();
      throw new SandboxFailure('PROJECT_STORAGE_FAILED', 'Project authorization service is unavailable.');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new SandboxFailure('PROJECT_STORAGE_FAILED', `Project access rejected (HTTP ${response.status}).`);
    }
    let data: unknown;
    try { data = await readJson(response, 16384); }
    catch (_error) { throw new SandboxFailure('PROJECT_STORAGE_FAILED', 'Project volume binding is invalid.'); }
    const binding = bindingSchema.safeParse(data);
    if (!binding.success || binding.data.projectId !== this.settings.project!.projectId)
      throw new SandboxFailure('PROJECT_STORAGE_FAILED', 'Project volume binding is invalid.');
    return binding.data.volume;
  }
}
