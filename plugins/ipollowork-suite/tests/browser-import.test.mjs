/** Desktop-only exports must not prevent an ordinary Web profile from loading the suite. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';
const require = createRequire(import.meta.url);

test('the Web entry imports without materializing the desktop account module', async () => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost' });
  let factory;
  dom.window.__ModuleLoader__ = { load: entry => { factory = entry.factory; } };
  try {
    runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), {
      window: dom.window, document: dom.window.document, URL, TextEncoder, TextDecoder, AbortController,
    });
    assert.equal(typeof factory, 'function');
    const entry = factory(id => {
      if (id === '@deepseek-ai/dsh-client-ui-primitives') return {};
      assert(!id.includes('ui-settings-account'), 'Web must not load the desktop-only module');
      return require(id);
    });
    assert.equal(typeof entry.apply, 'function');
  } finally { dom.window.close(); }
});
