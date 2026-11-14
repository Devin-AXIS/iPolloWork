/** Stage adapter ports retain signed callbacks, exact amounts and account-owned settlement. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign, sign, verify } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createAlipayProvider } from '../src/payment-providers/alipay.js';
import { createWechatProvider } from '../src/payment-providers/wechat.js';
import type { PaymentOrder } from '../src/payment-providers/types.js';
import { createService } from '../src/app.js';
import { wallet } from '../src/domain.js';
import { testConfig } from './database.js';

const keys = () => generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
function signed(fields: Record<string, string>, key: string) {
  const content = Object.keys(fields).sort().map(name => `${name}=${fields[name]}`).join('&');
  return new URLSearchParams({ ...fields, sign: createSign('RSA-SHA256').update(content).sign(key, 'base64') }).toString();
}

test('Alipay signed checkout and duplicate callbacks credit and refund the same account once', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ipw-alipay-'));
  const config = await testConfig({ DATA_DIR: dir });
  const app = await createService(config);
  try {
    const pair = keys();
    const login = await app.auth.api.signUpEmail({ body: { email: 'alipay@example.test', name: 'Alipay', password: 'Provider-test-password' } });
    await app.settings.set('alipay', { appId: 'app_fixture', sellerId: 'seller_fixture', privateKey: pair.privateKey, publicKey: pair.publicKey, sandbox: '1' });
    await app.store.run("INSERT INTO plans VALUES('provider-plan','Member','','membership',9900,'CNY',1000,30,1,NULL,?,NULL,100,500)", Date.now());
    const headers = { Authorization: 'Bearer '+login.token, 'Content-Type': 'application/json', Origin: config.origin };
    const requestId = randomUUID();
    const response = await app.app.request(config.origin+'/api/v1/orders', { method: 'POST', headers, body: JSON.stringify({ planId: 'provider-plan', provider: 'alipay', requestId }) });
    assert.equal(response.status, 200);
    const checkout = await response.json() as { url: string };
    const url = new URL(checkout.url);
    assert.equal(url.origin, 'https://openapi-sandbox.dl.alipaydev.com');
    assert.equal(url.searchParams.get('notify_url'), config.origin+'/hooks/alipay');
    assert.equal(JSON.parse(url.searchParams.get('biz_content')!).total_amount, '99.00');
    const fields = { app_id: 'app_fixture', seller_id: 'seller_fixture', notify_id: 'notification', out_trade_no: requestId, trade_no: 'trade_fixture', total_amount: '99.00', trade_status: 'TRADE_SUCCESS', sign_type: 'RSA2' };
    const notify = (body: string) => app.app.request(config.origin+'/hooks/alipay', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    assert.equal((await notify(signed({ ...fields, total_amount: '0.01' }, pair.privateKey))).status, 409);
    assert.equal((await wallet(app.store, login.user.id)).balance, 0);
    assert.equal((await notify(signed(fields, pair.privateKey))).status, 200);
    assert.equal((await notify(signed(fields, pair.privateKey))).status, 200);
    assert.equal((await wallet(app.store, login.user.id)).balance, 1000);
    const refund = signed({ ...fields, trade_status: 'TRADE_CLOSED', refund_fee: '99.00' }, pair.privateKey);
    assert.equal((await notify(refund)).status, 200);
    assert.equal((await notify(refund)).status, 200);
    assert.equal((await wallet(app.store, login.user.id)).balance, 0);
    assert.equal((await notify(signed(fields, pair.privateKey).replace('99.00','98.00'))).status, 400);
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
});

test('WeChat signs checkout requests and rejects unverified QR responses', async () => {
  const merchant = keys(), platform = keys();
  const env = { WECHAT_APP_ID: 'wxfixture', WECHAT_MCH_ID: '1900000109', WECHAT_MERCHANT_SERIAL: 'AABBCC', WECHAT_PRIVATE_KEY: merchant.privateKey, WECHAT_API_V3_KEY: '0123456789abcdef0123456789abcdef', WECHAT_PLATFORM_KEY_ID: 'PUB_KEY_ID_fixture', WECHAT_PLATFORM_PUBLIC_KEY: platform.publicKey };
  const order: PaymentOrder = { id: randomUUID().replaceAll('-', ''), accountRef: 'member', provider: 'wechat', currency: 'CNY', amount: 9900, description: 'Member', live: true, status: 'pending', createdAt: '', updatedAt: '', checkoutUrl: null, qrCode: null, providerOrderId: null, providerPaymentId: null, error: null, idempotencyKey: 'fixture' };
  let valid = true;
  const provider = createWechatProvider({ baseUrl: 'https://work.example.test', env, fetch: async (url, init) => {
    assert.equal(String(url), 'https://api.mch.weixin.qq.com/v3/pay/transactions/native');
    assert.equal(init?.redirect, 'error');
    const auth = Object.fromEntries([...new Headers(init?.headers).get('Authorization')!.matchAll(/(\w+)="([^"]+)"/g)].map(match => [match[1], match[2]]));
    assert(verify('RSA-SHA256', Buffer.from(`POST\n/v3/pay/transactions/native\n${auth.timestamp}\n${auth.nonce_str}\n${init?.body}\n`), merchant.publicKey, Buffer.from(auth.signature!, 'base64')));
    assert.equal(JSON.parse(String(init?.body)).notify_url, 'https://work.example.test/hooks/wechat');
    const body = JSON.stringify({ code_url: 'weixin://wxpay/bizpayurl?pr=fixture' }), time = String(Math.floor(Date.now()/1000));
    return new Response(body, { headers: { 'wechatpay-timestamp': time, 'wechatpay-nonce': 'response_nonce', 'wechatpay-serial': env.WECHAT_PLATFORM_KEY_ID, 'wechatpay-signature': sign('RSA-SHA256', Buffer.from(`${time}\nresponse_nonce\n${valid ? body : 'tampered'}\n`), platform.privateKey).toString('base64') } });
  } });
  assert.equal((await provider.createCheckout(order)).qrCode, 'weixin://wxpay/bizpayurl?pr=fixture');
  valid = false;
  await assert.rejects(provider.createCheckout(order), /签名/);
});

test('Alipay rejects callbacks from a different seller even with a valid signature', async () => {
  const pair = keys();
  const provider = createAlipayProvider({ baseUrl: 'https://work.example.test', env: { ALIPAY_APP_ID: 'app', ALIPAY_SELLER_ID: 'seller', ALIPAY_PRIVATE_KEY: pair.privateKey, ALIPAY_PUBLIC_KEY: pair.publicKey } });
  const body = signed({ app_id: 'app', seller_id: 'other', sign_type: 'RSA2', notify_id: 'n', out_trade_no: 'order', trade_no: 'trade', total_amount: '99.00', trade_status: 'TRADE_SUCCESS' }, pair.privateKey);
  await assert.rejects(provider.verifyWebhook(body, new Headers({ 'content-type': 'application/x-www-form-urlencoded' })));
});
