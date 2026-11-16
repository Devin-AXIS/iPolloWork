import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_SLASH_PANEL_CONFIG,
  MAX_SLASH_PANEL_COMMANDS,
  SLASH_COMMAND_MANIFEST,
  SLASH_PANEL_MODES,
  feishuSlashManifest,
  isCustomSlashPanel,
  isSlashPanelConfig,
  normalizeSlashPanelConfig,
  resolveSlashPanelManifest,
} from '../../../src/channels/feishu/slash-command-panel.mjs';

test('normalizeSlashPanelConfig falls back to the shipped manifest', () => {
  for (const damaged of [undefined, null, 'custom', 7, [], { mode: 'unknown' }, { order: ['new'] }]) {
    assert.deepEqual(normalizeSlashPanelConfig(damaged), DEFAULT_SLASH_PANEL_CONFIG);
  }
  // A default panel carries no list of its own: the manifest is the list.
  assert.deepEqual(
    normalizeSlashPanelConfig({ mode: SLASH_PANEL_MODES.DEFAULT, order: ['new'] }),
    DEFAULT_SLASH_PANEL_CONFIG,
  );
  assert.equal(isCustomSlashPanel(undefined), false);
  assert.equal(isCustomSlashPanel({ mode: SLASH_PANEL_MODES.CUSTOM, order: [] }), true);
});

test('normalizeSlashPanelConfig keeps a custom order and drops what the code cannot serve', () => {
  const normalized = normalizeSlashPanelConfig({
    mode: SLASH_PANEL_MODES.CUSTOM,
    // Leading slashes, duplicates, unknown names and non-strings must not reach
    // the panel: an unknown command would be a dead entry, a duplicate would
    // register twice.
    order: ['/new', 'stop', 'new', 'not_a_command', '', null, 7, 'MENU'],
  });
  assert.deepEqual(normalized.order, ['new', 'stop', 'menu']);
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(normalized.mode, SLASH_PANEL_MODES.CUSTOM);
});

test('normalizeSlashPanelConfig caps how many commands a panel may pin', () => {
  const order = SLASH_COMMAND_MANIFEST.map((entry) => entry.command);
  const normalized = normalizeSlashPanelConfig({ mode: SLASH_PANEL_MODES.CUSTOM, order });
  assert.equal(normalized.order.length, order.length);
  assert.ok(MAX_SLASH_PANEL_COMMANDS >= order.length);
  assert.deepEqual(
    normalizeSlashPanelConfig({
      mode: SLASH_PANEL_MODES.CUSTOM,
      order: [...order, ...order],
    }).order,
    order,
  );
});

test('isSlashPanelConfig accepts exactly the two shapes and rejects damaged input', () => {
  assert.equal(isSlashPanelConfig({ mode: SLASH_PANEL_MODES.DEFAULT, order: [] }), true);
  assert.equal(isSlashPanelConfig({ mode: SLASH_PANEL_MODES.CUSTOM, order: ['new', 'stop'] }), true);
  // A default panel must not smuggle in an order.
  assert.equal(isSlashPanelConfig({ mode: SLASH_PANEL_MODES.DEFAULT, order: ['new'] }), false);
  assert.equal(isSlashPanelConfig({ mode: SLASH_PANEL_MODES.CUSTOM, order: ['/new'] }), false);
  assert.equal(isSlashPanelConfig({ mode: SLASH_PANEL_MODES.CUSTOM, order: ['new', 'new'] }), false);
  assert.equal(isSlashPanelConfig({ mode: SLASH_PANEL_MODES.CUSTOM, order: ['nope'] }), false);
  assert.equal(isSlashPanelConfig({ mode: SLASH_PANEL_MODES.CUSTOM }), false);
  assert.equal(isSlashPanelConfig({ mode: SLASH_PANEL_MODES.CUSTOM, order: [], extra: 1 }), false);
  assert.equal(isSlashPanelConfig(null), false);
});

test('resolveSlashPanelManifest follows the manifest or the configured order', () => {
  assert.deepEqual(
    resolveSlashPanelManifest(undefined).map((entry) => entry.command),
    SLASH_COMMAND_MANIFEST.map((entry) => entry.command),
  );
  const custom = resolveSlashPanelManifest({ mode: SLASH_PANEL_MODES.CUSTOM, order: ['stop', 'new'] });
  assert.deepEqual(custom.map((entry) => entry.command), ['stop', 'new']);
  // Entries keep the shipped icon and descriptions; only the selection changes.
  assert.equal(custom[0].default, '停止当前任务');
  assert.equal(custom[1].icon, 'ai-deepthink_outlined');
  assert.deepEqual(
    resolveSlashPanelManifest({ mode: SLASH_PANEL_MODES.CUSTOM, order: [] }),
    [],
  );
});

test('feishuSlashManifest gates /fork by the fork capability', () => {
  const withFork = feishuSlashManifest({ supportsFork: true });
  const withoutFork = feishuSlashManifest({ supportsFork: false });
  assert.ok(withFork.some((entry) => entry.command === 'fork'));
  assert.ok(!withoutFork.some((entry) => entry.command === 'fork'));
  assert.ok(withoutFork.some((entry) => entry.command === 'ls'));
  assert.ok(withoutFork.some((entry) => entry.command === 'go'));
  assert.ok(withoutFork.some((entry) => entry.command === 'title'));
});

test('feishuSlashManifest describes /tail honestly per fileSend', () => {
  const noFiles = feishuSlashManifest({ fileSend: false }).find((entry) => entry.command === 'tail');
  const withFiles = feishuSlashManifest({ fileSend: true }).find((entry) => entry.command === 'tail');
  assert.equal(noFiles.default, '预览会话内容');
  assert.match(withFiles.default, /导出/);
});
