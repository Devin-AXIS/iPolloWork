import { build } from 'esbuild';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workspaceFeatures } from './features.mjs';

const base = fileURLToPath(new URL('..', import.meta.url));
const feature = process.argv[2] ?? 'workspace-tools';
if (feature !== 'workspace-tools' && !workspaceFeatures.includes(feature)) throw Error(`Unknown workspace plugin ${feature}`);
const name = `@ipollo/dsh-${feature}`;
const output = resolve(base, '..', feature, 'lib');
const fileEditor = feature === 'markdown-editor' || feature === 'excel-editor';
const hostEntry = feature === 'excel-editor' ? 'src/excel-host.ts' : fileEditor ? 'src/file-host.ts' : 'src/host.ts';
const define = {
  __IPOLLO_WORKSPACE_FEATURE__: JSON.stringify(feature),
};
await mkdir(output, { recursive: true });

await build({
  absWorkingDir: base, entryPoints: [hostEntry], outfile: join(output, 'host.js'), bundle: true, define,
  platform: 'node', format: 'esm', target: 'node22', legalComments: 'eof',
});
const browser = await build({
  absWorkingDir: base, entryPoints: [fileEditor ? 'src/file-client.tsx' : 'src/client.tsx'], outfile: join(output, 'client.js'), bundle: true, define,
  platform: 'browser', format: 'cjs', target: 'es2022', write: false,
  external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'],
  alias: { '@deepseek-ai/dsh-util-workspace-path': resolve(base, '../../.upstream/dsh/packages/util/workspace-path/src/index.ts') },
  loader: { '.css': 'text' }, legalComments: 'eof',
});
await writeFile(join(output, 'client.js'), `window.__ModuleLoader__.load({id:${JSON.stringify(name)},factory(require){
const module={exports:{}};const exports=module.exports;
${browser.outputFiles[0].text}
return module.exports;}});\n`);

if (feature !== 'workspace-tools') {
  await Promise.all([
    copyFile(join(base, 'LICENSE'), join(output, 'LICENSE')),
    copyFile(join(base, 'THIRD_PARTY_NOTICES.md'), join(output, 'THIRD_PARTY_NOTICES.md')),
    copyFile(resolve(base, '../ipollowork-suite/LICENSES/ISC-lucide.txt'), join(output, 'ISC-lucide.txt')),
  ]);
}
if (feature === 'excel-editor') {
  await copyFile(join(base, 'node_modules/xlsx/LICENSE'), join(output, 'Apache-2.0-SheetJS.txt'));
}
