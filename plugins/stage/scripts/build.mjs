import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('lib', { recursive: true });
await build({ entryPoints: ['src/host.ts'], outfile: 'lib/host.js', bundle: true, platform: 'node', format: 'esm', target: 'node24', external: ['@deepseek-ai/*'] });
await copyFile('src/client.js', 'lib/client.js');
