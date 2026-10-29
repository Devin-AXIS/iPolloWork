import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { compile } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';

// These workspaces are served locally. Keep the same executable chunk budget
// while separating reusable vendors and immutable translation/theme data.
export const WORKSPACE_CHUNK_LIMIT_KB = 4000;
export function workspaceUiChunk(id) {
  const path = id.replaceAll('\\', '/');
  const locale = path.match(/\/i18n\/locales\/([^/]+)\.ts$/);
  if (locale) return `locale-${locale[1]}`;
  const theme = path.match(/\/design-systems\/design-systems\/([^/]+)\/(manifest\.json|design-tokens\.json|tokens\.css\?raw)$/);
  if (theme) return `theme-tokens-${theme[1].charAt(0)}`;
  const dependency = path.split('/node_modules/').at(-1);
  if (dependency === path || !dependency) return;
  const packageName = dependency.startsWith('@') ? dependency.split('/').slice(0, 2).join('/') : dependency.split('/')[0];
  if (/^(react|react-dom|scheduler)$/.test(packageName)) return 'react';
  if (/^(@lexical\/|lexical$)/.test(packageName)) return 'lexical';
  if (/^(@codemirror\/|@lezer\/)/.test(packageName)) return 'code-editor';
  if (['motion-dom', 'motion-utils', 'framer-motion'].includes(packageName)) return 'motion';
  // Shiki already loads individual language grammars on demand.
  if (/^(shiki|@shikijs\/|@shiki\/)/.test(packageName)) return;
  if (['@base-ui/react', '@xterm/xterm', 'jspdf', 'xlsx', 'pdfjs-dist', 'lucide-react', 'ai', 'zod', 'html2canvas', 'html2canvas-pro', 'pptxgenjs'].includes(packageName)) {
    return `vendor-${packageName.replaceAll(/[@/]/g, '-')}`;
  }
}

/** Host renderers share the same virtual module, emitted payload and HMR rules. */
export function pluginUiRuntime() {
  const dependencies = new Set();
  const virtualId = '\0ipollowork-plugin-ui-runtime';
  return {
    name: 'ipollowork-plugin-ui-runtime',
    resolveId(id) { if (id === 'virtual:ipollowork-plugin-ui-runtime') return virtualId; },
    async load(id) {
      if (id !== virtualId) return;
      const runtime = await buildPluginRuntime('host');
      dependencies.clear();
      for (const path of runtime.dependencies) { this.addWatchFile(path); dependencies.add(path); }
      if (!this.meta.watchMode) {
        // Sandboxes need source text, not an executable renderer dependency.
        const asset = this.emitFile({ type: 'asset', name: 'plugin-ui-runtime.js', source: `export default ${JSON.stringify(runtime.script)};` });
        return `export default (await import(/* @vite-ignore */ import.meta.ROLLUP_FILE_URL_${asset})).default;`;
      }
      return `export default ${JSON.stringify(runtime.script)}`;
    },
    handleHotUpdate(context) {
      if (!dependencies.has(context.file)) return;
      const module = context.server.moduleGraph.getModuleById(virtualId);
      if (!module) return;
      context.server.moduleGraph.invalidateModule(module);
      return [...context.modules, module];
    },
  };
}

// Both consumers build the same source; generated output belongs in build output only.
export async function buildPluginStyles() {
  const base = fileURLToPath(new URL('src/plugin/', import.meta.url));
  const dependencies = new Set([resolve(base, 'controls.css')]);
  const compiler = await compile(await readFile(new URL('src/plugin/controls.css', import.meta.url), 'utf8'), { base, onDependency(path) { dependencies.add(path); } });
  const scanner = new Scanner({ sources: compiler.sources });
  const css = compiler.build(scanner.scan());
  for (const path of scanner.files) dependencies.add(resolve(path));
  return { css, dependencies: [...dependencies] };
}

export async function buildPluginRuntime(mode = 'host') {
  if (!['host', 'bundled'].includes(mode)) throw new Error('Unknown UI runtime mode');
  const base = fileURLToPath(new URL('src/plugin/', import.meta.url));
  const { css, dependencies: styleDependencies } = await buildPluginStyles();
  const dependencies = new Set(styleDependencies);
  const result = await build({
    stdin: {
      contents: `import {installRuntime} from './runtime.ts';installRuntime(${JSON.stringify(css)}, ${JSON.stringify(mode)});`,
      resolveDir: base,
      sourcefile: 'plugin-runtime-entry.ts',
    },
    bundle: true, write: false, metafile: true, format: 'iife', platform: 'browser', target: 'es2022', minify: true, jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  for (const path of Object.keys(result.metafile.inputs)) if (!path.startsWith('<') && !path.endsWith('plugin-runtime-entry.ts')) dependencies.add(resolve(path));
  return { script: result.outputFiles[0].text, dependencies: [...dependencies] };
}
