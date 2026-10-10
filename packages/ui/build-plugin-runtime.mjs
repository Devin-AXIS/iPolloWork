import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { compile } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';

// Both consumers build the same source; generated output belongs in build output only.
export async function buildPluginRuntime(mode = 'host') {
  if (!['host', 'bundled'].includes(mode)) throw new Error('Unknown UI runtime mode');
  const base = fileURLToPath(new URL('src/plugin/', import.meta.url));
  const dependencies = new Set([resolve(base, 'controls.css')]);
  const compiler = await compile(await readFile(new URL('src/plugin/controls.css', import.meta.url), 'utf8'), { base, onDependency(path) { dependencies.add(path); } });
  const scanner = new Scanner({ sources: compiler.sources });
  const css = compiler.build(scanner.scan());
  const result = await build({
    stdin: {
      contents: `import {installRuntime} from './runtime.ts';installRuntime(${JSON.stringify(css)}, ${JSON.stringify(mode)});`,
      resolveDir: base,
      sourcefile: 'plugin-runtime-entry.ts',
    },
    bundle: true, write: false, metafile: true, format: 'iife', platform: 'browser', target: 'es2022', minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  for (const path of [...scanner.files, ...Object.keys(result.metafile.inputs)]) if (!path.startsWith('<') && !path.endsWith('plugin-runtime-entry.ts')) dependencies.add(resolve(path));
  return { script: result.outputFiles[0].text, dependencies: [...dependencies] };
}
