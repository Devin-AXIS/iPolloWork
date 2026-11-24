import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

test('retained browser-path digests fit a bounded V8 heap', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'docx-sha256-memory-'));
  try {
    const outfile = join(directory, 'sha256.mjs');
    const build = await Bun.build({
      entrypoints: [fileURLToPath(new URL('../package/sha256.ts', import.meta.url))],
      target: 'node',
      format: 'esm',
    });
    expect(build.success).toBe(true);
    await Bun.write(outfile, build.outputs[0]!);
    // Exercise the browser's pure implementation on V8, with no browser installation needed.
    // The native Node hasher returns flat strings and cannot expose this retention defect.
    const script = `
      import { sha256FontBytesPure } from ${JSON.stringify(pathToFileURL(outfile).href)};
      const values = new Array(100_000);
      const input = new Uint8Array(8);
      const view = new DataView(input.buffer);
      globalThis.gc();
      const before = process.memoryUsage().heapUsed;
      for (let index = 0; index < values.length; index++) {
        view.setUint32(0, index);
        values[index] = sha256FontBytesPure(input);
      }
      globalThis.retainedDigests = values;
      globalThis.gc();
      console.log(JSON.stringify({
        retainedBytes: process.memoryUsage().heapUsed - before,
        count: values.length,
        first: values[0],
        last: values.at(-1),
      }));
    `;
    const { NODE_OPTIONS: _inheritedNodeOptions, ...env } = process.env;
    const child = spawnSync('node', ['--expose-gc', '--input-type=module', '--eval', script], {
      env,
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(child.status, child.stderr).toBe(0);
    const result = JSON.parse(child.stdout);
    expect(result.count).toBe(100_000);
    expect(result.first).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.last).not.toBe(result.first);
    // A flat 71-character digest needs roughly 10 MiB for this sample. Leave allocator
    // headroom, while refusing the much larger retained concatenation chains.
    expect(result.retainedBytes).toBeLessThan(24 * 1024 * 1024);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
