// Author and validate every component before publishing the five standard packs.
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
await import('./tools/author.mjs');
if (process.exitCode) throw Error('Component layout validation failed; packages were not published.');
await import('./hyperframes/export-pack.mjs');
const engine = name => readFileSync(new URL(`./engine/${name}.js`, import.meta.url), 'utf8');
mkdirSync(new URL('./skill/assets/', import.meta.url), { recursive: true });
writeFileSync(new URL('./skill/assets/stage-diagrams.js', import.meta.url), ['core', 'essentials', 'hero', 'systems', 'frameworks'].map(engine).join(''));
copyFileSync(new URL('./hyperframes/ai-adapter.mjs', import.meta.url), new URL('./dist/hyperframes/stage-diagrams-ai-adapter.mjs', import.meta.url));
// The gallery uses the same GSAP dependency as Studio, without another vendored runtime.
const requireStudio = createRequire(new URL('../../vendor/hyperframes/packages/studio/package.json', import.meta.url));
mkdirSync(new URL('./vendor/', import.meta.url), { recursive: true });
copyFileSync(requireStudio.resolve('gsap/dist/gsap.min.js'), new URL('./vendor/gsap.min.js', import.meta.url));
console.log('35 components validated; five packs, AI adapter and gallery ready.');
