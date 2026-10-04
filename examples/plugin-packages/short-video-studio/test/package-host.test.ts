import { test, expect } from 'bun:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import JSZip from 'jszip';

const root = process.env.IPOLLOWORK_SOURCE_ROOT;
if (!root) throw new Error('Set IPOLLOWORK_SOURCE_ROOT for real host compatibility tests');
const load = (path: string) => import(pathToFileURL(resolve(root, path)).href);

test('bundled short video forwards its declared provider status actions through the real host', async () => {
  const sandbox = await mkdtemp(join(tmpdir(), 'short-video-bundled-host-'));
  const previous = process.env.IPOLLOWORK_RUNTIME_DB;
  process.env.IPOLLOWORK_RUNTIME_DB = join(sandbox, 'runtime.sqlite');
  const config = { configPath: join(sandbox, 'server.json'), workspaces: [{ id: 'verify', path: sandbox, name: 'Verify', preset: 'starter', workspaceType: 'local', engineId: 'opencode' }], readOnly: false };
  const lifecycle = await load('apps/server/src/plugin-package-lifecycle.ts');
  try {
    const runtime = await load('apps/server/src/plugin-service-runtime.ts');
    const packageRoot = resolve(import.meta.dir, '../dist/package');
    const manifest = JSON.parse(await readFile(join(packageRoot, 'ipollowork.plugin.json'), 'utf8'));
    expect(manifest.source).toMatchObject({ origin: 'builtin', trusted: true });
    await lifecycle.installPluginPackage({ serverConfig: config, packageRoot });
    const calls: string[] = [];
    const result = await runtime.callPluginServiceAction({ config, workspaceId: 'verify', pluginId: 'short-video-studio', action: 'capabilities', args: {}, context: {},
      callHostAction: async (reference: string) => {
        calls.push(reference);
        return { ok: true, result: { models: ['local-fixture'], output: { configured: true } } };
      },
    });
    expect(calls.sort()).toEqual(['action:media/status', 'action:openai-image-generation/status', 'action:video-generation/status']);
    expect(result.result).toMatchObject({ images: { models: ['local-fixture'] }, videos: { models: ['local-fixture'] }, audio: { configured: true } });
    await lifecycle.uninstallPluginPackage({ serverConfig: config, pluginId: 'short-video-studio' });
  } finally {
    if (previous === undefined) delete process.env.IPOLLOWORK_RUNTIME_DB; else process.env.IPOLLOWORK_RUNTIME_DB = previous;
    await rm(sandbox, { recursive: true, force: true });
  }
});

test('signed package passes real host upload and lifecycle, preserving user projects', async () => {
  const sandbox = await mkdtemp(join(tmpdir(), 'short-video-host-'));
  const previous = process.env.IPOLLOWORK_RUNTIME_DB;
  process.env.IPOLLOWORK_RUNTIME_DB = join(sandbox, 'runtime.sqlite');
  const config = { configPath: join(sandbox,'server.json'), workspaces: [{ id:'verify', path:sandbox, name:'Verify', preset:'starter', workspaceType:'local', engineId:'opencode' }], readOnly:false };
  try {
    const lifecycle = await load('apps/server/src/plugin-package-lifecycle.ts');
    const runtime = await load('apps/server/src/plugin-service-runtime.ts');
    const { withMaterializedPluginPackageUpload } = await load('apps/server/src/plugin-package-upload.ts');
    const archive = await JSZip.loadAsync(await readFile(new URL('../dist/short-video-studio-0.1.0.ipollowork-plugin', import.meta.url)));
    const files=[];for(const [path,entry] of Object.entries(archive.files))if(!entry.dir)files.push({path,contentBase64:await entry.async('base64')});
    await withMaterializedPluginPackageUpload({archiveName:'short-video-studio-0.1.0.ipollowork-plugin',files}, 'install', async ({packageRoot}: {packageRoot:string})=>{
      const preview=await lifecycle.previewPluginPackage({packageRoot});
      const safety=await lifecycle.assertPluginPackageSafeForImport({packageRoot,preview,purpose:'install'});
      expect(safety.signature.status).toBe('verified');
      const result=await lifecycle.installPluginPackage({serverConfig:config,packageRoot});
      expect(result.status).toBe('installed');
    });
    const installed=await lifecycle.listInstalledPluginPackages({serverConfig:config});
    expect(installed.some((p:any)=>p.id==='short-video-studio'||p.pluginId==='short-video-studio')).toBe(true);
    const call = await runtime.callPluginServiceAction({config,workspaceId:'verify',pluginId:'short-video-studio',action:'project-create',args:{title:'卸载保留验证'},context:{sessionId:'verify'}});
    expect(call.ok).toBe(true);
    const projectPath=join(sandbox,'short-video',call.result.project.id,'project.json');
    expect((await stat(projectPath)).isFile()).toBe(true);
    const ui=await lifecycle.readInstalledPluginUiResource({serverConfig:config,pluginId:'short-video-studio',resourceId:'studio'});
    expect(ui.html).toContain('短片创作工作台');
    await lifecycle.uninstallPluginPackage({serverConfig:config,pluginId:'short-video-studio'});
    expect((await lifecycle.listInstalledPluginPackages({serverConfig:config})).length).toBe(0);
    expect((await stat(projectPath)).isFile()).toBe(true);
  } finally { if(previous===undefined)delete process.env.IPOLLOWORK_RUNTIME_DB;else process.env.IPOLLOWORK_RUNTIME_DB=previous;await rm(sandbox,{recursive:true,force:true}); }
}, 30000);
