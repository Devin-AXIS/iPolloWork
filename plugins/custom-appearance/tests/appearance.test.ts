import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appearanceIndex, titled } from '../src/brand.ts';
import { pngBuffer } from '../src/host.ts';
import { buttonInk, makeTheme, presets } from '../src/model.ts';

test('an appearance defines both modes with explicit semantic colors', () => {
  const tokens = makeTheme(presets.forest);
  assert.deepEqual(tokens['--dsw-alias-button-primary-fill'], { light: '#295f4a', dark: '#a6d9bc' });
  assert.deepEqual(tokens['--dsw-alias-label-primary'], { light: '#20332b', dark: '#e3f0e7' });
  assert.deepEqual(tokens['--dsw-alias-bg-base'], { light: '#f8faf8', dark: '#14201a' });
  assert.notEqual(tokens['--dsw-specific-sidebar-fill']?.light, '#f8faf8');
  assert.equal(buttonInk('#111111'), '#ffffff');
  assert.equal(buttonInk('#eeeeee'), '#000000');
});

test('boot name is escaped in HTML and CSS, and session titles retain their prefix', () => {
  const input = '<html lang="en"><head><title>DeepSeek Harness</title><link rel="icon" href="/favicon.svg"></head></html>';
  const html = appearanceIndex(input, 'A "</style><script>&', true, 3);
  assert(html.includes('<title>A &quot;&lt;/style&gt;&lt;script&gt;&amp;</title>'));
  assert(!html.includes('</style><script>'));
  assert(html.includes('rel="icon" type="image/png" href="/ipollo-appearance/logo.png?v=3"'));
  assert(!html.includes('/favicon.svg'));
  assert.equal(appearanceIndex(input, '', false, 0), input);
  assert.equal(titled('Website — DeepSeek Harness', '', 'North'), 'Website — North');
  assert.equal(titled('Website — North — Lab', 'North — Lab', 'iPolloWork'), 'Website — iPolloWork');
});

test('logo validation bounds storage to structurally valid PNGs with bounded dimensions', () => {
  const valid = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+f2lUAAAAASUVORK5CYII=';
  const bytes = pngBuffer(valid);
  assert(bytes);
  assert.equal(pngBuffer('PHN2Zz48L3N2Zz4='), undefined);
  assert.equal(pngBuffer(bytes.subarray(0, -12).toString('base64')), undefined);
  bytes.writeUInt32BE(10000, 16);
  assert.equal(pngBuffer(bytes.toString('base64')), undefined);
});
