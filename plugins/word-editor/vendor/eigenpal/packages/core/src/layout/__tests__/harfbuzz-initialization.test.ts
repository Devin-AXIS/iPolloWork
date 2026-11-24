import { expect, test } from 'bun:test';
import {
  createHarfBuzzTextShaper,
  initializeHarfBuzz,
  isHarfBuzzInitialized,
} from '../harfbuzz-shaper.ts';

test('HarfBuzz is loaded only through explicit async initialization', async () => {
  const moduleUrl = new URL('../harfbuzz-shaper.ts', import.meta.url).href;
  const probe = Bun.spawn([
    process.execPath,
    '--eval',
    `import(${JSON.stringify(moduleUrl)}).then((m) => process.stdout.write(String(m.isHarfBuzzInitialized())))`,
  ]);
  expect(await new Response(probe.stdout).text()).toBe('false');
  expect(await probe.exited).toBe(0);

  if (!isHarfBuzzInitialized()) {
    expect(() => createHarfBuzzTextShaper()).toThrow(/notInitialized/);
  }

  await initializeHarfBuzz();

  expect(isHarfBuzzInitialized()).toBe(true);
  expect(createHarfBuzzTextShaper()).toBeDefined();
});
