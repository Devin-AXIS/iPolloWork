import { defineConfig } from 'tsdown'

export default defineConfig(['index', 'cli'].map(name => ({
  entry: [import.meta.dirname + '/lib/types/' + name + '.js'],
  outDir: import.meta.dirname + '/lib',
  format: ['esm'] as const,
  outputOptions: { codeSplitting: false },
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  // tsc -b already resolves and checks the source. Bundle its emitted Node JS
  // through package exports, without re-reading the project-reference graph.
  tsconfig: false,
})))
