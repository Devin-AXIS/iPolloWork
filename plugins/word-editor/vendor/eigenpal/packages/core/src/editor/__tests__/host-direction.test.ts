import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, expect, test } from 'bun:test';
import { hostDirectionOf, observeHostDirection } from '../host-direction.ts';

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.removeAttribute('dir');
});

function nested(...dirs: Array<string | null>): HTMLElement {
  let parent: HTMLElement = document.body;
  for (const dir of dirs) {
    const element = document.createElement('div');
    if (dir !== null) element.setAttribute('dir', dir);
    parent.append(element);
    parent = element;
  }
  return parent;
}

test('the nearest dir attribute decides, case-insensitively', () => {
  expect(hostDirectionOf(nested('rtl', null))).toBe('rtl');
  expect(hostDirectionOf(nested('RTL', null))).toBe('rtl');
  expect(hostDirectionOf(nested('rtl', 'ltr', null))).toBe('ltr');
  expect(hostDirectionOf(nested(null, null))).toBe('ltr');
});

test('auto and unknown values defer to the next ancestor', () => {
  expect(hostDirectionOf(nested('rtl', 'auto', null))).toBe('rtl');
  expect(hostDirectionOf(nested('rtl', 'sideways', null))).toBe('rtl');
});

test('the search crosses a shadow root to its host', () => {
  const host = nested('rtl');
  const shadow = host.attachShadow({ mode: 'open' });
  const inner = document.createElement('div');
  shadow.append(inner);
  expect(hostDirectionOf(inner)).toBe('rtl');
});

test('a dir change on the page is reported', async () => {
  const element = nested(null, null);
  let changes = 0;
  const stop = observeHostDirection(element, () => {
    changes += 1;
  });
  document.documentElement.setAttribute('dir', 'rtl');
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(changes).toBeGreaterThan(0);
  expect(hostDirectionOf(element)).toBe('rtl');
  stop();
});

test('a dir change inside the element is not a host change', async () => {
  const element = nested(null, null);
  const inner = document.createElement('span');
  element.append(inner);
  let changes = 0;
  const stop = observeHostDirection(element, () => {
    changes += 1;
  });
  inner.setAttribute('dir', 'rtl');
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(changes).toBe(0);
  stop();
});

test('a dir change in an outer shadow tree is reported', async () => {
  const outerHost = nested(null);
  const outer = outerHost.attachShadow({ mode: 'open' });
  const wrapper = document.createElement('div');
  outer.append(wrapper);
  const innerHost = document.createElement('div');
  wrapper.append(innerHost);
  const inner = innerHost.attachShadow({ mode: 'open' });
  const element = document.createElement('div');
  inner.append(element);
  let changes = 0;
  const stop = observeHostDirection(element, () => {
    changes += 1;
  });
  wrapper.setAttribute('dir', 'rtl');
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(changes).toBeGreaterThan(0);
  expect(hostDirectionOf(element)).toBe('rtl');
  stop();
});
