import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const name = '@ipollo/dsh-project-files';
await mkdir('lib', { recursive: true });
await build({
  entryPoints: ['src/host.ts'], outfile: 'lib/host.js', bundle: true,
  platform: 'node', format: 'esm', target: 'node24', external: ['zod'],
});
const browser = await build({
  nodePaths: ['node_modules'],
  entryPoints: ['src/client.tsx'], outfile: 'lib/client.js', bundle: true,
  platform: 'browser', format: 'cjs', target: 'es2022', write: false,
  external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'],
  alias: { '@deepseek-ai/dsh-util-workspace-path': resolve('../../.upstream/dsh/packages/util/workspace-path/src/index.ts') },
  loader: { '.css': 'text' }, legalComments: 'eof',
});
await writeFile('lib/client.js', `window.__ModuleLoader__.load({id:${JSON.stringify(name)},factory(require){
const module={exports:{}};const exports=module.exports;
${browser.outputFiles[0].text}
return module.exports;}});\n`);
