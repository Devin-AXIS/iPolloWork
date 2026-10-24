import assert from 'node:assert/strict';
import test from 'node:test';
import { Recording, keyboardOperation } from '../native/recorder.mjs';
import { collectContext, relativePosition } from '../native/accessibility.mjs';

const snapshot = { app: '示例后台', window: '项目列表', page: { title: '项目列表' }, target: { role: 'Button', name: '新建项目', ancestors: [{ role: 'ToolBar', name: '项目操作' }], position: '右上方' } };

function fixture() {
  const events = [];
  let now = 1000;
  const recorder = new Recording(event => events.push(event), () => recorder.close(), () => now);
  const observe = (action, options = {}) => recorder.observe({ action, observedAt: now, snapshot, ...options });
  return { recorder, events, observe, time: value => { now = value; }, steps: () => events.filter(event => event.type === 'step').map(event => event.step) };
}

test('pause epochs retain earlier clicks and never merge a double click across private work', () => {
  const { recorder, observe, steps, time } = fixture();
  time(1100); recorder.command('pause');
  observe('click', { observedAt: 1050, clicks: 1 });
  observe('click', { observedAt: 1150, clicks: 2 });
  time(1200); recorder.command('resume');
  observe('click', { clicks: 2 });
  recorder.close();
  assert.equal(steps().length, 2);
  assert.ok(steps().every(step => step.key !== 'DOUBLE_CLICK'));
});

test('double clicks become one operation and pending clicks flush on stop without coordinates', () => {
  const { recorder, observe, steps, time } = fixture();
  observe('click', { clicks: 1, point: { x: 987, y: 123 } });
  time(1100); observe('click', { clicks: 2, point: { x: 987, y: 123 } });
  time(1800); observe('click', { clicks: 1 });
  recorder.close();
  assert.deepEqual(steps().map(step => step.key), ['DOUBLE_CLICK', undefined]);
  assert.ok(!JSON.stringify(steps()).includes('987'));
  assert.equal(steps()[0].page.title, '项目列表');
});

test('input keys, AltGr and paste never become captured text or printable shortcut metadata', () => {
  const keys = { A: 30, V: 47, Enter: 28, AltRight: 3640 };
  const event = { keycode: 30, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false };
  assert.deepEqual(keyboardOperation(event, keys), { action: 'input' });
  assert.deepEqual(keyboardOperation({ ...event, ctrlKey: true, altKey: true }, keys), { action: 'input' });
  assert.deepEqual(keyboardOperation({ ...event, altKey: true }, keys, true), { action: 'input' });
  assert.deepEqual(keyboardOperation({ ...event, keycode: 47, ctrlKey: true }, keys), { action: 'input', paste: true });
  assert.deepEqual(keyboardOperation({ ...event, ctrlKey: true }, keys), { action: 'key', key: 'CTRL+A' });
  const { recorder, observe, steps } = fixture();
  const field = { ...snapshot, writable: true, secret: true, target: { role: 'TextField', name: '受保护的输入框' } };
  observe('input', { snapshot: field }); observe('input', { snapshot: field });
  observe('input', { snapshot: field, paste: true });
  observe('key', { snapshot: field, key: 'CTRL+A' });
  recorder.close();
  assert.equal(steps().length, 2);
  assert.ok(steps().every(step => step.secret && step.key === undefined && step.text === undefined));
});

test('scroll direction and application changes survive bounded noise filtering', () => {
  const { recorder, observe, steps, time } = fixture();
  observe('focus'); observe('focus');
  observe('focus', { snapshot: { ...snapshot, page: undefined, target: { role: 'unknown' } } });
  observe('scroll', { direction: 'down' });
  time(1100); observe('scroll', { direction: 'down' });
  observe('scroll', { direction: 'up' });
  recorder.close();
  assert.deepEqual(steps().map(step => [step.action, step.direction]), [['focus', undefined], ['scroll', 'down'], ['scroll', 'up']]);
});

test('recordings stop at 500 semantic steps', () => {
  const { recorder, observe, steps, events } = fixture();
  for (let index = 0; index < 502; index++) observe('key', { key: 'TAB' });
  assert.equal(steps().length, 500);
  assert.equal(events.filter(event => event.type === 'limit').length, 1);
  assert.equal(recorder.stopped, true);
});

test('context includes owning page, named region and relative position and releases every parent', () => {
  const nodes = [
    { role: 'Button', name: '新建项目', rect: { x: 780, y: 60, width: 100, height: 30 } },
    { role: 'ToolBar', name: '项目操作' },
    { role: 'Document', name: '项目列表' },
    { role: 'Window', name: '项目列表 - 浏览器', rect: { x: 0, y: 0, width: 1000, height: 800 } },
  ];
  const released = [];
  const api = { metadata: node => node, bounds: node => node.rect, parent: node => nodes[nodes.indexOf(node) + 1], release: node => released.push(node) };
  const captured = collectContext(api, nodes[0], { app: 'Browser' });
  assert.equal(captured.page.title, '项目列表');
  assert.equal(captured.window, '项目列表 - 浏览器');
  assert.equal(captured.target.position, '右上方');
  assert.deepEqual(captured.target.ancestors, [{ role: 'ToolBar', name: '项目操作' }]);
  assert.deepEqual(released, nodes.slice(1));
  assert.equal(relativePosition(nodes[0].rect, { x: 0, y: 0, width: 0, height: 0 }), undefined);
});
