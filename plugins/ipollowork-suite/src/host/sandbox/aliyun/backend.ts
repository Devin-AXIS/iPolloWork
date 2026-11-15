/** Adapt Alibaba's E2B-compatible API to the existing DSH sandbox tool provider. */
import { Sandbox, CommandExitError, type SandboxOpts, type CommandStartOpts, type CommandResult } from 'e2b';
import { SandboxFailure, type RemoteSandbox, type SandboxFactory } from '../runtime.ts';
import { brandString } from '@deepseek-ai/dsh-brand';
import type { Settings } from './config.ts';

/** The subset of E2B used here; excludes model and agent orchestration. */
export interface E2bSandbox {
  sandboxId: string;
  commands: { run(command: string, options: CommandStartOpts & {background?: false}): Promise<CommandResult> };
  files: {
    read(path: string, options: {format:'stream';signal:AbortSignal;requestTimeoutMs:number}): Promise<ReadableStream<Uint8Array>>;
    write(path: string, data: string | ArrayBuffer, options: {signal:AbortSignal;requestTimeoutMs:number}): Promise<unknown>;
  };
  kill(options: {requestTimeoutMs:number}): Promise<boolean>;
}
export type E2bFactory = (template: string, options: SandboxOpts) => Promise<E2bSandbox>;

/** Retain only the requested range and cancel the HTTP body when enough bytes arrive. */
export async function readRange(stream: ReadableStream<Uint8Array>, offset: number, limit: number): Promise<Uint8Array> {
  const reader=stream.getReader();
  const output=new Uint8Array(limit);
  let skipped=0, length=0;
  try {
    while(length<limit) {
      const item=await reader.read();
      if(item.done)break;
      const start=Math.min(item.value.length,Math.max(0,offset-skipped));
      skipped+=item.value.length;
      const part=item.value.subarray(start,start+limit-length);
      output.set(part,length);length+=part.length;
    }
  } finally { try { await reader.cancel(); } finally { reader.releaseLock(); } }
  return output.subarray(0,length);
}

/** Map authorized volume identity to a project-specific OSS prefix, never a model-supplied path. */
export function createBackend(settings: Settings, create:E2bFactory=(template,options)=>Sandbox.create(template,options)): SandboxFactory {
  return async options => {
    const metadata:Record<string,string>={...options.metadata};
    if (settings.project) {
      const volume=options.volumes?.[0];
      const claim=volume?.pvc?.claimName;
      if(!claim||!/^ipollo-project-[a-f0-9]{40}$/.test(claim)||!settings.storage)
        throw new SandboxFailure('PROJECT_STORAGE_FAILED','An authorized project volume is required.');
      metadata['fc.sandbox.auth.role']=settings.storage.roleArn;
      metadata['fc.sandbox.storage.oss']=JSON.stringify({mountPoints:[{
        bucketName:settings.storage.bucket, endpoint:settings.storage.endpoint,
        bucketPath:'/ipollowork/'+claim+'/', mountDir:'/mnt/project',readOnly:false,
      }]});
    }
    options.signal?.throwIfAborted();
    const sandbox=await create(settings.template,{
      apiKey:options.connectionConfig!.apiKey!, apiUrl:settings.apiUrl,domain:settings.domain,
      timeoutMs:settings.sandboxTtlSeconds*1000,requestTimeoutMs:settings.requestTimeoutSeconds*1000,
      metadata,...(options.signal?{signal:options.signal}:{}),secure:true,
    });
    if(settings.project) {
      try {
        const mount=await sandbox.commands.run('mountpoint -q /mnt/project',{timeoutMs:settings.commandTimeoutSeconds*1000,requestTimeoutMs:settings.requestTimeoutSeconds*1000,...(options.signal?{signal:options.signal}:{})});
        if(mount.exitCode!==0)throw new Error('Project mount unavailable');
      } catch (_mountError) {
        try { await sandbox.kill({requestTimeoutMs:settings.requestTimeoutSeconds*1000}); }
        catch (_releaseError) { throw new SandboxFailure('SANDBOX_RELEASE_FAILED','Project mount failed and sandbox release could not be confirmed.'); }
        throw new SandboxFailure('PROJECT_STORAGE_FAILED','The project storage mount is unavailable; the sandbox was released.');
      }
    }
    // File requests are cancelled when this adapter is closed.
    const lifetime=new AbortController();
    const remote:RemoteSandbox={
      id:brandString<RemoteSandbox['id']>(sandbox.sandboxId),
      commands:{async run(command,opts,handlers,signal){
        let exitCode:number;
        let bytes=0;
        const bounded=new AbortController();
        const capture=async (text:string, channel:'onStdout'|'onStderr')=>{
          bytes+=Buffer.byteLength(text);
          await handlers[channel]?.({text,timestamp:Date.now()});
          if(bytes>settings.maxOutputBytes){bounded.abort();throw new Error('Sandbox command output limit exceeded');}
        };
        const result=await sandbox.commands.run(command,{
          cwd:opts.workingDirectory,timeoutMs:opts.timeoutSeconds*1000,
          requestTimeoutMs:settings.requestTimeoutSeconds*1000,signal:AbortSignal.any([signal,bounded.signal]),
          onStdout:text=>capture(text,'onStdout'),
          onStderr:text=>capture(text,'onStderr'),
        }).catch(error=>{if(error instanceof CommandExitError)return error;throw error});
        exitCode=result.exitCode;
        return {logs:{stdout:[],stderr:[]},result:[],exitCode};
      }},
      files:{
        async readBytes(path,range){return readRange(await sandbox.files.read(path,{format:'stream',signal:lifetime.signal,requestTimeoutMs:settings.requestTimeoutSeconds*1000}),range.offset,range.limit)},
        async writeFiles(entries){for(const entry of entries){const data=typeof entry.data==='string'?entry.data:Uint8Array.from(entry.data).buffer;await sandbox.files.write(entry.path,data,{signal:lifetime.signal,requestTimeoutMs:settings.requestTimeoutSeconds*1000})}},
      },
      async kill(){await sandbox.kill({requestTimeoutMs:settings.requestTimeoutSeconds*1000})},
      async close(){lifetime.abort()},
    };
    return remote;
  };
}
