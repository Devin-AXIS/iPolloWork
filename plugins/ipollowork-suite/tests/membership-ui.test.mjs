/** Membership actions use the account service and never treat a browser return as payment. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
const require = createRequire(import.meta.url);

test('membership shows period usage and starts one recoverable checkout', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const globals = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true };
  const saved = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const calls = [];
  const fixture = {
    points: { balance: 1000 }, memberships: [{ id: 'member', name: 'Standard', expiresAt: Date.now() + 86400000 }],
    usage: { daily: { used: 40, reserved: 10, limit: 200, resetsAt: Date.now() + 3600000 }, weekly: { used: 150, reserved: 10, limit: 1000, resetsAt: Date.now() + 86400000 } },
    history: Array.from({ length: 7 }, (_, index) => ({ date: `2026-11-${String(index + 1).padStart(2, '0')}`, used: index * 10 })),
    plans: [{ id: 'standard', name: 'Standard', amount: 9900, currency: 'CNY', points: 40000, days: 30, dailyPoints: 200, weeklyPoints: 1000, pointsCost: null }],
    channels: [{ id: 'stripe', name: 'Stripe', configured: true }, { id: 'alipay', name: 'Alipay', configured: false }],
    checkoutAvailable: true, pendingOrder: null,
  };
  const bundle = await build({ entryPoints: ['src/client/membership.tsx'], bundle: true, platform: 'node', format: 'cjs', write: false,
    loader: { '.css': 'empty' }, external: ['react', 'react-dom', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'] });
  const module = { exports: {} };
  let pay;
  runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports, window: dom.window, AbortController, Intl, Date, crypto: globalThis.crypto,
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith('/membership/checkout')) return new Promise(resolve => { pay = () => resolve(Response.json({ orderId: 'order', url: 'https://checkout.stripe.com/c/pay/fixture' })); });
      assert.equal(url, '/ipollowork-suite/membership');
      return Response.json(fixture);
    },
    require: name => name === '@deepseek-ai/dsh-client-ui-primitives'
      ? { Modal: ({ children, title }) => React.createElement('section', { role: 'dialog', 'aria-label': title }, children) } : require(name),
  });
  const labels = new Proxy({ locale: 'en-US' }, { get: (target, key) => target[key] ?? key });
  let refreshed = 0;
  const refreshAccount = async () => { refreshed++; };
  let root;
  const button = text => [...dom.window.document.querySelectorAll('button')].find(node => node.textContent === text);
  Object.assign(globalThis, globals);
  try {
    root = createRoot(dom.window.document.getElementById('root'));
    await act(async () => root.render(React.createElement(module.exports.MembershipPanel, {
      account: { status: 'signed-in', user: { id: 'member', name: 'Member', email: 'member@example.test' }, points: 1000 },
      t: labels, refreshAccount, signOut: async () => {},
    })));
    assert.equal(dom.window.document.querySelectorAll('[role="progressbar"]').length, 2);
    assert.equal(dom.window.document.querySelectorAll('.consumer-weekly li').length, 7);
    await act(async () => button('renewMembership').click());
    assert(dom.window.document.querySelector('[role="dialog"]'));
    assert.equal(button('buyMembership').disabled, false);
    await act(async () => { button('buyMembership').click(); button('buyMembership').click(); });
    assert.equal(calls.filter(call => call.url.endsWith('/membership/checkout')).length, 1);
    await act(async () => pay());
    assert.equal(dom.window.document.querySelector('.consumer-checkout a').href, 'https://checkout.stripe.com/c/pay/fixture');
    assert.equal(refreshed, 0);
    const request = JSON.parse(calls.find(call => call.url.endsWith('/membership/checkout')).init.body);
    assert.equal(request.planId, 'standard');
    assert.equal(request.provider, 'stripe');
    assert.match(request.requestId, /^[a-f0-9-]{36}$/);
  } finally {
    try { if (root) await act(async () => root.unmount()); }
    finally {
      dom.window.close();
      for (const [key, descriptor] of Object.entries(saved)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    }
  }
});
