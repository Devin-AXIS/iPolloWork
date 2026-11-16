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
  tsconfig: import.meta.dirname + '/tsconfig.json',
})))
