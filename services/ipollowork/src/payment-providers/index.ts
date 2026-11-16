/** Stage payment adapters connected to this service's encrypted settings and order ledger. */
import { createAlipayProvider } from './alipay.js';
import { createWechatProvider } from './wechat.js';
import type { Settings } from '../settings.js';
import type { Config } from '../config.js';
import type { PaymentOrder } from './types.js';
import type { Order } from '../domain.js';
import { ServiceError } from '../errors.js';

export async function paymentChannels(settings: Settings, config: Config) {
  const [stripe, alipay, wechat] = await Promise.all(['stripe', 'alipay', 'wechat'].map(key => settings.get(key)));
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.origin).hostname);
  return [
    { id: 'stripe', name: 'Stripe', configured: Boolean(stripe.secretKey && stripe.webhookSecret && (local || stripe.secretKey.startsWith('sk_live_'))) },
    { id: 'alipay', name: '支付宝', configured: Boolean(alipay.appId && alipay.sellerId && alipay.privateKey && alipay.publicKey && (local || alipay.sandbox !== '1')) },
    { id: 'wechat', name: '微信支付', configured: ['appId', 'merchantId', 'merchantSerial', 'privateKey', 'apiV3Key', 'platformKeyId', 'platformPublicKey'].every(key => Boolean(wechat[key])) && wechat.apiV3Key?.length === 32 },
  ];
}

export async function paymentProvider(id: 'alipay' | 'wechat', settings: Settings, config: Config) {
  if (!(await paymentChannels(settings, config)).find(channel => channel.id === id)?.configured)
    throw new ServiceError('PAYMENT_NOT_CONFIGURED', 503, '支付渠道尚未配置');
  const values = await settings.get(id);
  const env = id === 'alipay' ? {
    ALIPAY_APP_ID: values.appId, ALIPAY_SELLER_ID: values.sellerId, ALIPAY_PRIVATE_KEY: values.privateKey, ALIPAY_PUBLIC_KEY: values.publicKey, ALIPAY_SANDBOX: values.sandbox,
  } : { WECHAT_APP_ID: values.appId, WECHAT_MCH_ID: values.merchantId, WECHAT_MERCHANT_SERIAL: values.merchantSerial, WECHAT_PRIVATE_KEY: values.privateKey, WECHAT_API_V3_KEY: values.apiV3Key, WECHAT_PLATFORM_KEY_ID: values.platformKeyId, WECHAT_PLATFORM_PUBLIC_KEY: values.platformPublicKey };
  try {
    return (id === 'alipay' ? createAlipayProvider : createWechatProvider)({ baseUrl: config.origin, env });
  } catch (cause) { throw new ServiceError('PAYMENT_NOT_CONFIGURED', 503, '支付配置无效，请检查商户参数', { cause }); }
}

/** Convert internal order IDs to the provider's merchant reference without changing their owner. */
export function providerOrder(order: Order, live: boolean, description: string): PaymentOrder {
  if ((order.provider !== 'wechat' && order.provider !== 'alipay') || order.currency !== 'CNY') throw new ServiceError('PAYMENT_CURRENCY_UNAVAILABLE', 400);
  return { id: order.provider === 'wechat' ? order.id.replaceAll('-', '') : order.id, accountRef: order.user_id, provider: order.provider, currency: order.currency, amount: order.amount, description, live, status: 'pending', createdAt: new Date(Number(order.created_at)).toISOString(), updatedAt: '', checkoutUrl: null, qrCode: null, providerOrderId: null, providerPaymentId: order.provider_id, error: null, idempotencyKey: order.id };
}
