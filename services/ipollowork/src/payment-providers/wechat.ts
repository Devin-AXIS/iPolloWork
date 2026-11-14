import { createDecipheriv, createPrivateKey, createPublicKey, randomBytes, sign, verify } from 'node:crypto';
import { pem, type PaymentEvent, type PaymentOrder, type PaymentProvider, type PaymentRefund, type ProviderContext } from './types.js';

const API_ORIGIN = 'https://api.mch.weixin.qq.com';
const SIGNATURE_TYPE = 'WECHATPAY2-SHA256-RSA2048';
const SIGNATURE_MAX_AGE_SECONDS = 300;
type Json = Record<string, unknown>;

function object(value: unknown, label: string): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`微信支付返回的${label}无效`);
  return value as Json;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`微信支付返回的${label}无效`);
  return value;
}

function amount(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error(`微信支付${label}必须是正整数分`);
  return value;
}

function parseJson(raw: string): Json {
  try { return object(JSON.parse(raw), '报文'); }
  catch { throw new Error('微信支付返回了无效 JSON'); }
}

function merchantOrderId(value: string): string {
  if (!/^[A-Za-z0-9_|*-]{6,32}$/.test(value)) throw new Error('微信支付订单号必须为 6–32 位字母、数字或 _-|*');
  return value;
}

function merchantRefundId(value: string): string {
  if (!/^[A-Za-z0-9_|*@-]{1,64}$/.test(value)) throw new Error('微信支付退款单号格式无效');
  return value;
}

/** Native APIv3, with pinned platform-key verification before any payment state is trusted. */
export function createWechatProvider(context: ProviderContext): PaymentProvider {
  const required = (name: string): string => {
    const value = context.env[name]?.trim();
    if (!value) throw new Error(`微信支付缺少 ${name}`);
    return value;
  };
  const appid = required('WECHAT_APP_ID');
  const mchid = required('WECHAT_MCH_ID');
  const serial = required('WECHAT_MERCHANT_SERIAL');
  const platformKeyId = required('WECHAT_PLATFORM_KEY_ID');
  if (!/^[A-Za-z0-9_]+$/.test(appid) || !/^\d{6,32}$/.test(mchid)
    || !/^[A-Za-z0-9]+$/.test(serial) || !/^[A-Za-z0-9_]+$/.test(platformKeyId)) {
    throw new Error('微信支付商户标识或证书序列号格式无效');
  }
  const apiKey = Buffer.from(required('WECHAT_API_V3_KEY'), 'utf8');
  if (apiKey.length !== 32) throw new Error('WECHAT_API_V3_KEY 必须为 32 字节');
  const privateKey = createPrivateKey(pem(required('WECHAT_PRIVATE_KEY')));
  const platformKey = createPublicKey(pem(required('WECHAT_PLATFORM_PUBLIC_KEY')));
  for (const key of [privateKey, platformKey]) {
    if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails?.modulusLength !== 2048) {
      throw new Error('微信支付需要 RSA 2048 位密钥');
    }
  }
  const baseUrl = new URL(context.baseUrl);
  if (baseUrl.protocol !== 'https:' || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    throw new Error('微信支付回调地址必须使用 HTTPS 且不能包含认证信息或参数');
  }
  const notifyUrl = `${baseUrl.href.replace(/\/$/, '')}/hooks/wechat`;
  const fetcher = context.fetch ?? fetch;

  function verifySignature(rawBody: string, headers: Headers): void {
    const timestamp = headers.get('wechatpay-timestamp');
    const nonce = headers.get('wechatpay-nonce');
    const signature = headers.get('wechatpay-signature');
    const keyId = headers.get('wechatpay-serial');
    const signatureType = headers.get('wechatpay-signature-type');
    if (!timestamp || !/^\d{10}$/.test(timestamp) || !nonce || !signature || keyId !== platformKeyId
      || (signatureType && signatureType !== SIGNATURE_TYPE)) throw new Error('微信支付签名头缺失或公钥不匹配');
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > SIGNATURE_MAX_AGE_SECONDS) throw new Error('微信支付签名已过期');
    // SIGNTEST probes are deliberately invalid and must never bypass verification.
    if (signature.startsWith('WECHATPAY/SIGNTEST/') || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) {
      throw new Error('微信支付签名验证失败');
    }
    const valid = verify('RSA-SHA256', Buffer.from(`${timestamp}\n${nonce}\n${rawBody}\n`), platformKey, Buffer.from(signature, 'base64'));
    if (!valid) throw new Error('微信支付签名验证失败');
  }

  async function request(method: 'GET' | 'POST', path: string, payload?: Json): Promise<Json> {
    const body = payload ? JSON.stringify(payload) : '';
    const nonce = randomBytes(16).toString('hex');
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign('RSA-SHA256', Buffer.from(`${method}\n${path}\n${timestamp}\n${nonce}\n${body}\n`), privateKey).toString('base64');
    const response = await fetcher(`${API_ORIGIN}${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: {
        Accept: 'application/json', 'Content-Type': 'application/json',
        'Wechatpay-Serial': platformKeyId,
        Authorization: `${SIGNATURE_TYPE} mchid="${mchid}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${serial}",signature="${signature}"`,
      },
      ...(payload ? { body } : {}),
    });
    const rawBody = await response.text();
    if (!response.ok) {
      // Error bodies are not payment evidence and may be unsigned. Never echo their contents or credentials.
      throw new Error(`微信支付请求失败（HTTP ${response.status}），请查单确认结果后重试`);
    }
    verifySignature(rawBody, response.headers);
    return parseJson(rawBody);
  }

  function validateOrder(order: PaymentOrder): void {
    merchantOrderId(order.id);
    if (order.provider !== 'wechat' || !order.live || order.currency !== 'CNY') throw new Error('微信支付仅支持正式环境人民币订单');
    amount(order.amount, '订单金额');
  }

  function validateRefund(order: PaymentOrder, refund: PaymentRefund): void {
    validateOrder(order);
    merchantRefundId(refund.id);
    if (refund.orderId !== order.id || amount(refund.amount, '退款金额') !== order.amount) throw new Error('目前仅支持原订单全额退款');
  }

  function paymentEvent(data: Json, eventId?: string, expected?: PaymentOrder): PaymentEvent | null {
    if (data.mchid !== mchid || data.appid !== appid) throw new Error('微信支付商户或应用不匹配');
    const orderId = merchantOrderId(string(data.out_trade_no, '订单号'));
    if (expected && expected.id !== orderId) throw new Error('微信支付订单号不匹配');
    const state = string(data.trade_state, '交易状态');
    const eventType = state === 'SUCCESS' ? 'paid' : state === 'CLOSED' ? 'expired'
      : state === 'PAYERROR' || state === 'REVOKED' ? 'failed' : null;
    if (!eventType) return null;
    let total: number | undefined;
    if (data.amount !== undefined || state === 'SUCCESS') {
      const info = object(data.amount, '金额');
      if (info.currency !== 'CNY') throw new Error('微信支付币种不匹配');
      total = amount(info.total, '订单金额');
      if (expected && total !== expected.amount) throw new Error('微信支付订单金额不匹配');
    }
    const paymentId = state === 'SUCCESS' ? string(data.transaction_id, '交易单号') : undefined;
    if (expected?.providerPaymentId && paymentId && expected.providerPaymentId !== paymentId) throw new Error('微信支付交易单号不匹配');
    return { id: eventId ?? `wechat:payment:${orderId}:${state}`, type: eventType, orderId, live: true,
      ...(total === undefined ? {} : { amount: total, currency: 'CNY' }), ...(paymentId ? { paymentId } : {}) };
  }

  function refundEvent(data: Json, eventId?: string, expectedOrder?: PaymentOrder, expectedRefund?: PaymentRefund, callback = false): PaymentEvent {
    // The refund query/creation response has no mchid/appid; its signed response is bound to the authenticated request.
    if ((callback || data.mchid !== undefined) && data.mchid !== mchid) throw new Error('微信退款商户不匹配');
    if (data.appid !== undefined && data.appid !== appid) throw new Error('微信退款应用不匹配');
    const orderId = merchantOrderId(string(data.out_trade_no, '订单号'));
    const refundId = merchantRefundId(string(data.out_refund_no, '退款单号'));
    const providerRefundId = string(data.refund_id, '微信退款单号');
    const paymentId = string(data.transaction_id, '交易单号');
    const info = object(data.amount, '退款金额');
    // Official refund callbacks omit currency; domestic refunds are CNY only.
    if ((!callback || info.currency !== undefined) && info.currency !== 'CNY') throw new Error('微信退款币种不匹配');
    const total = amount(info.total, '订单金额');
    const refunded = amount(info.refund, '退款金额');
    if (refunded !== total) throw new Error('目前仅支持原订单全额退款');
    if (expectedOrder && (expectedOrder.id !== orderId || expectedOrder.amount !== total
      || (expectedOrder.providerPaymentId && expectedOrder.providerPaymentId !== paymentId))) throw new Error('微信退款与订单不匹配');
    if (expectedRefund && (expectedRefund.id !== refundId || expectedRefund.amount !== refunded
      || (expectedRefund.providerRefundId && expectedRefund.providerRefundId !== providerRefundId))) throw new Error('微信退款单不匹配');
    const state = string(callback ? data.refund_status : data.status, '退款状态');
    const type = state === 'SUCCESS' ? 'refund_succeeded' : state === 'PROCESSING' ? 'refund_pending'
      : state === 'CLOSED' || state === 'ABNORMAL' ? 'refund_failed' : null;
    if (!type) throw new Error('微信支付返回了未知退款状态');
    return { id: eventId ?? `wechat:refund:${providerRefundId}:${state}`, type, orderId, live: true,
      amount: refunded, currency: 'CNY', paymentId, refundId, providerRefundId };
  }

  function decryptResource(value: unknown): Json {
    const resource = object(value, '加密资源');
    if (resource.algorithm !== 'AEAD_AES_256_GCM') throw new Error('微信支付回调加密算法不受支持');
    const nonce = string(resource.nonce, '解密随机串');
    if (Buffer.byteLength(nonce) !== 12) throw new Error('微信支付解密随机串无效');
    const encoded = string(resource.ciphertext, '密文');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('微信支付密文格式无效');
    const ciphertext = Buffer.from(encoded, 'base64');
    if (ciphertext.length <= 16) throw new Error('微信支付密文无效');
    if (resource.associated_data !== undefined && typeof resource.associated_data !== 'string') throw new Error('微信支付附加数据无效');
    const decipher = createDecipheriv('aes-256-gcm', apiKey, Buffer.from(nonce));
    decipher.setAuthTag(ciphertext.subarray(-16));
    decipher.setAAD(Buffer.from((resource.associated_data as string | undefined) ?? ''));
    try {
      return parseJson(Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]).toString('utf8'));
    } catch { throw new Error('微信支付回调解密失败'); }
  }

  return {
    id: 'wechat', live: true,
    async createCheckout(order) {
      validateOrder(order);
      if (!order.description || [...order.description].length > 127) throw new Error('微信支付商品描述必须为 1–127 个字符');
      const data = await request('POST', '/v3/pay/transactions/native', {
        appid, mchid, description: order.description, out_trade_no: order.id, notify_url: notifyUrl,
        amount: { total: order.amount, currency: 'CNY' },
      });
      const qrCode = string(data.code_url, '支付二维码');
      if (!qrCode.startsWith('weixin://wxpay/')) throw new Error('微信支付返回了无效二维码链接');
      return { providerOrderId: order.id, qrCode };
    },
    async queryPayment(order) {
      validateOrder(order);
      const data = await request('GET', `/v3/pay/transactions/out-trade-no/${encodeURIComponent(order.id)}?mchid=${encodeURIComponent(mchid)}`);
      return paymentEvent(data, undefined, order);
    },
    async createRefund(order, refund) {
      validateRefund(order, refund);
      if (Buffer.byteLength(refund.reason, 'utf8') > 80) throw new Error('微信退款原因不能超过 80 字节');
      const data = await request('POST', '/v3/refund/domestic/refunds', {
        out_trade_no: order.id, out_refund_no: refund.id, ...(refund.reason ? { reason: refund.reason } : {}),
        notify_url: notifyUrl, amount: { total: order.amount, refund: refund.amount, currency: 'CNY' },
      });
      return refundEvent(data, undefined, order, refund);
    },
    async queryRefund(order, refund) {
      validateRefund(order, refund);
      return refundEvent(await request('GET', `/v3/refund/domestic/refunds/${encodeURIComponent(refund.id)}`), undefined, order, refund);
    },
    async verifyWebhook(rawBody, headers) {
      verifySignature(rawBody, headers);
      const notification = parseJson(rawBody);
      const kind = string(notification.event_type, '通知类型');
      if (kind !== 'TRANSACTION.SUCCESS' && !['REFUND.SUCCESS', 'REFUND.PROCESSING', 'REFUND.CLOSED', 'REFUND.ABNORMAL'].includes(kind)) return null;
      if (notification.resource_type !== 'encrypt-resource') throw new Error('微信支付通知资源类型无效');
      const eventId = `wechat:webhook:${string(notification.id, '通知 ID')}`;
      const data = decryptResource(notification.resource);
      if (kind === 'TRANSACTION.SUCCESS') {
        if (data.trade_state !== 'SUCCESS') throw new Error('微信支付通知与交易状态不匹配');
        return paymentEvent(data, eventId);
      }
      if (data.refund_status !== kind.slice('REFUND.'.length)) throw new Error('微信退款通知与退款状态不匹配');
      return refundEvent(data, eventId, undefined, undefined, true);
    },
  };
}
