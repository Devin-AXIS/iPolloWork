import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('lib', { recursive: true });
await build({
  entryPoints: ['src/host.ts'], outfile: 'lib/host.js', bundle: true,
  platform: 'node', format: 'esm', target: 'node24', external: ['@deepseek-ai/*'],
});
const browser = await build({
  entryPoints: ['src/client.tsx'], outfile: 'lib/client.js', bundle: true,
  platform: 'browser', format: 'cjs', target: 'es2022',
  external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'],
  loader: { '.css': 'text' }, write: false,
});
await writeFile('lib/client.js', `window.__ModuleLoader__.load({id:'@ipollo/dsh-notification-center',factory(require){
const module={exports:{}};const exports=module.exports;
${browser.outputFiles[0].text}
return module.exports;}});
`);
