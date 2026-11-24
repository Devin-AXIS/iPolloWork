import { build } from 'esbuild';
import { copyFile, cp, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const name = '@ipollo/dsh-word-editor';
const require = createRequire(import.meta.url);
const runtime = ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'];

const sharedRuntime = {
  name: 'iPolloWork browser runtime',
  setup(build) {
    build.onResolve({ filter: /^(react(?:\/jsx-runtime)?|react-dom|@deepseek-ai\/dsh-client-ui-primitives)$/ },
      args => ({ path: args.path, namespace: 'ipollo-runtime' }));
    build.onLoad({ filter: /.*/, namespace: 'ipollo-runtime' }, args => {
      const names = args.path.startsWith('@deepseek-ai/') ? ['Button', 'Modal'] : Object.keys(require(args.path));
      const exports = names.filter(key => /^[A-Za-z_$][\w$]*$/.test(key) && key !== 'default')
        .map(key => `export const ${key} = library[${JSON.stringify(key)}];`);
      return { contents: `const library = globalThis.__ipolloWordRuntime[${JSON.stringify(args.path)}];
export default library;
${exports.join('\n')}`, loader: 'js' };
    });
  },
};
await build({
  entryPoints: ['src/host.ts'], outfile: 'lib/host.js', bundle: true,
  platform: 'node', format: 'esm', target: 'node22', legalComments: 'eof',
});
const browser = await build({
  entryPoints: ['src/client.tsx'], outfile: 'lib/client.js', bundle: true,
  platform: 'browser', format: 'cjs', target: 'es2022', write: false, minify: true,
  external: ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
  alias: { '@deepseek-ai/dsh-util-workspace-path': resolve('../../.upstream/dsh/packages/util/workspace-path/src/index.ts') },
  loader: { '.css': 'text', '.woff2': 'dataurl', '.woff': 'dataurl', '.wasm': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'eof',
});
await writeFile('lib/client.js', `window.__ModuleLoader__.load({id:${JSON.stringify(name)},factory(require){
globalThis.__ipolloWordRuntime = Object.fromEntries(${JSON.stringify(runtime)}.map(name => [name,require(name)]));
const module={exports:{}};const exports=module.exports;
${browser.outputFiles[0].text}
return module.exports;}});\n`);

const vendor = 'vendor/eigenpal';
const core = vendor + '/packages/core';
const source = createRequire(resolve(core, 'package.json'));
await build({
  entryPoints: ['src/editor.tsx'], outfile: 'lib/assets/engine.mjs', bundle: true,
  platform: 'browser', format: 'esm', target: 'es2022', minify: true,
  external: ['module'], loader: { '.css': 'text', '.woff2': 'dataurl', '.woff': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'eof',
  plugins: [sharedRuntime, {
    name: 'vendored EigenPal packages',
    setup(build) {
      build.onResolve({ filter: /^@docx-editor\.dev\/(core|react|i18n)(\/.*)?$/ }, args => {
        const subpath = args.path.slice('@docx-editor.dev/'.length);
        const separator = subpath.indexOf('/');
        const pkg = separator === -1 ? subpath : subpath.slice(0, separator);
        const exportKey = separator === -1 ? '.' : '.' + subpath.slice(separator);
        const directory = resolve(vendor, 'packages', pkg);
        const entry = require(directory + '/package.json').exports[exportKey];
        const entryPath = typeof entry === 'string' ? entry : entry?.import;
        if (typeof entryPath !== 'string') throw Error('Unknown vendored editor export ' + args.path);
        return { path: resolve(directory, entryPath) };
      });
    },
  }],
});
const shaper = resolve(source.resolve('harfbuzzjs'), '..');
for (const file of ['harfbuzz.wasm', 'harfbuzz-subset.wasm'])
  await copyFile(resolve(shaper, file), 'lib/assets/' + file);
await mkdir('lib/notices', { recursive: true });
await copyFile(core + '/LICENSE', 'lib/notices/EigenPal-LICENSE');
await copyFile(core + '/THIRD_PARTY_NOTICES.md', 'lib/notices/EigenPal-THIRD_PARTY_NOTICES.md');
await cp(core + '/licenses', 'lib/notices/licenses', { recursive: true });
