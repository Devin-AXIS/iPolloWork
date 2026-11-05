import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyWorkspaceTheme, workspaceThemeTokens } from '../src/workspace-theme.mjs';

function root() {
  return { dataset: {}, style: { colorScheme: '', setProperty(name, value) { this[name] = value; } } };
}
test('host light wins over dark OS settings', () => {
  const element = root();
  assert.equal(applyWorkspaceTheme(element, { theme: 'light' }, true), 'light');
  assert.equal(element.style['--sv-canvas'], workspaceThemeTokens.light.canvas);
  assert.equal(element.style.colorScheme, 'light');
});
test('live host changes recolor all tokens without reopening', () => {
  const element = root();
  for (const theme of ['dark', 'light', 'dark']) {
    applyWorkspaceTheme(element, { theme });
    assert.equal(element.dataset.theme, theme);
    for (const [name, value] of Object.entries(workspaceThemeTokens[theme])) {
      assert.equal(element.style[`--sv-${name}`], value);
    }
  }
});
test('unrelated host-context patches do not revert the selected theme', () => {
  const element = root();
  applyWorkspaceTheme(element, { theme: 'dark' });
  assert.equal(applyWorkspaceTheme(element, { displayMode: 'fullscreen' }, false), 'dark');
});
test('system preference is used only before a host-selected theme exists', () => {
  assert.equal(applyWorkspaceTheme(root(), undefined, true), 'dark');
  assert.equal(applyWorkspaceTheme(root(), undefined, false), 'light');
});
test('every surface token has both light and dark values', () => {
  assert.deepEqual(Object.keys(workspaceThemeTokens.light), Object.keys(workspaceThemeTokens.dark));
  for (const name of Object.keys(workspaceThemeTokens.light)) {
    assert.match(workspaceThemeTokens.light[name], /^var\(--[a-z-]+\)$/);
    assert.equal(workspaceThemeTokens.dark[name], workspaceThemeTokens.light[name]);
  }
});
