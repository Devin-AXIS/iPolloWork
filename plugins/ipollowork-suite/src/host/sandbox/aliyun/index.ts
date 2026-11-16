/** Alibaba Cloud Agent Sandbox plugin; all model tools and the agent loop remain DSH-owned. */
import type { Context } from '@deepseek-ai/cordis';
import { applyWithFactory } from '../tools.ts';
import type { Config as SandboxConfig } from '../common-config.ts';
import { createBackend } from './backend.ts';
import { settingsSchema, type Config } from './config.ts';
export { Config } from './config.ts';
export const name='ipollo-aliyun-sandbox';
export const inject=['tools','agents','sandboxPolicy'];
/** Mount the cloud tools against Alibaba Cloud's execution API. */
export function apply(ctx:Context, input:Config):void {

  const settings=settingsSchema.parse(input);
  const config:SandboxConfig={
    endpoint:settings.apiUrl,image:settings.template,apiKeyEnv:settings.apiKeyEnv,
    workspace:settings.workspace,secureAccess:true,releaseAfterTurn:settings.releaseAfterTurn,
    sandboxTtlSeconds:settings.sandboxTtlSeconds,requestTimeoutSeconds:settings.requestTimeoutSeconds,
    commandTimeoutSeconds:settings.commandTimeoutSeconds,maxOutputBytes:settings.maxOutputBytes,
    maxFileBytes:settings.maxFileBytes,maxSandboxes:settings.maxSandboxes,
    ...(settings.project?{project:settings.project}:{}),
  };
  applyWithFactory(ctx,config,createBackend(settings),'/mnt/project');
}
