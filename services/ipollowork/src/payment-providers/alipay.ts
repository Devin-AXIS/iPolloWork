import { AlipaySdk } from 'alipay-sdk';
import { majorAmount, minorAmount, pem, type PaymentEvent, type PaymentOrder, type PaymentProvider, type PaymentRefund, type ProviderContext } from './types.js';

const providerError = () => new Error('支付宝请求失败，请检查渠道配置或稍后重试');
const verificationError = () => new Error('支付宝支付数据验证失败');
type AlipayResult = Record<string, unknown>;

/** Alipay PC web checkout, RSA2 signatures and signed server-side reconciliation. */
export function createAlipayProvider(context: ProviderContext): PaymentProvider {
  const appId = context.env.ALIPAY_APP_ID?.trim();
  const sellerId = context.env.ALIPAY_SELLER_ID?.trim();
  const privateKey = context.env.ALIPAY_PRIVATE_KEY && pem(context.env.ALIPAY_PRIVATE_KEY).trim();
  const publicKey = context.env.ALIPAY_PUBLIC_KEY && pem(context.env.ALIPAY_PUBLIC_KEY).trim();
  if (!appId || !sellerId || !privateKey || !publicKey) throw new Error('支付宝配置不完整');
  const live = context.env.ALIPAY_SANDBOX !== '1';
  const gateway = live ? 'https://openapi.alipay.com/gateway.do' : 'https://openapi-sandbox.dl.alipaydev.com/gateway.do';
  let sdk: AlipaySdk;
  try {
    sdk = new AlipaySdk({
      appId, privateKey, alipayPublicKey: publicKey, gateway, signType: 'RSA2', timeout: 15_000, camelcase: false,
      keyType: privateKey.includes('BEGIN PRIVATE KEY') ? 'PKCS8' : 'PKCS1',
    });
  } catch { throw new Error('支付宝配置无效'); }
  const baseUrl = context.baseUrl.replace(/\/$/, '');

  function assertOrder(order: PaymentOrder) {
    majorAmount(order.amount);
    if (order.provider !== 'alipay' || order.live !== live || order.currency !== 'CNY') throw verificationError();
  }

  function assertResult(result: AlipayResult, order: PaymentOrder) {
    if (result.out_trade_no !== order.id || typeof result.trade_no !== 'string' || !result.trade_no) throw verificationError();
    if (order.providerPaymentId && result.trade_no !== order.providerPaymentId) throw verificationError();
    if (result.seller_id !== undefined && result.seller_id !== sellerId) throw verificationError();
    if (result.seller_user_id !== undefined && result.seller_user_id !== sellerId) throw verificationError();
  }

  async function exec(method: string, bizContent: Record<string, unknown>): Promise<AlipayResult | null> {
    try {
      // The official SDK verifies the raw response signature before parsing fields.
      const result = await sdk.exec(method, { bizContent }, { validateSign: true });
      if (result.code !== '10000') {
        if (result.sub_code === 'ACQ.TRADE_NOT_EXIST' || result.sub_code === 'ACQ.REFUND_NOT_EXIST') return null;
        throw providerError();
      }
      return result;
    } catch { throw providerError(); }
  }

  function refundEvent(result: AlipayResult, order: PaymentOrder, refund: PaymentRefund, succeeded: boolean): PaymentEvent {
    assertResult(result, order);
    if (result.out_request_no !== undefined && result.out_request_no !== refund.id) throw verificationError();
    const total = minorAmount(result.refund_amount ?? result.refund_fee);
    if (total !== refund.amount || total !== order.amount) throw verificationError();
    return {
      id: `alipay:refund:${refund.id}:${succeeded ? 'succeeded' : 'pending'}`,
      type: succeeded ? 'refund_succeeded' : 'refund_pending',
      orderId: order.id, refundId: refund.id, providerRefundId: refund.id,
      paymentId: result.trade_no as string, amount: total, currency: 'CNY', live,
    };
  }

  return {
    id: 'alipay', live,
    async createCheckout(order) {
      assertOrder(order);
      try {
        const checkoutUrl = sdk.pageExecute('alipay.trade.page.pay', 'GET', {
          notifyUrl: `${baseUrl}/hooks/alipay`,
          returnUrl: `${baseUrl}/?payment=return`,
          bizContent: {
            out_trade_no: order.id, product_code: 'FAST_INSTANT_TRADE_PAY',
            total_amount: majorAmount(order.amount), subject: order.description,
            seller_id: sellerId, timeout_express: '30m',
          },
        });
        if (!checkoutUrl.startsWith(`${gateway}?`)) throw verificationError();
        return { providerOrderId: order.id, checkoutUrl };
      } catch { throw providerError(); }
    },
    async queryPayment(order) {
      assertOrder(order);
      const result = await exec('alipay.trade.query', { out_trade_no: order.id });
      if (!result) return null;
      assertResult(result, order);
      const total = minorAmount(result.total_amount);
      if (total !== order.amount) throw verificationError();
      const type = ['TRADE_SUCCESS', 'TRADE_FINISHED'].includes(String(result.trade_status)) ? 'paid' : result.trade_status === 'TRADE_CLOSED' ? 'expired' : null;
      return type ? { id: `alipay:query:${order.id}:${type}`, type, orderId: order.id, live, amount: total, currency: 'CNY', paymentId: result.trade_no as string } : null;
    },
    async createRefund(order, refund) {
      assertOrder(order);
      if (refund.orderId !== order.id || refund.amount !== order.amount) throw verificationError();
      const result = await exec('alipay.trade.refund', {
        out_trade_no: order.id, out_request_no: refund.id, refund_amount: majorAmount(refund.amount), refund_reason: refund.reason,
      });
      if (!result) throw providerError();
      // fund_change=N is not evidence of successful settlement; reconcile it separately.
      return refundEvent(result, order, refund, result.fund_change === 'Y');
    },
    async queryRefund(order, refund) {
      assertOrder(order);
      if (refund.orderId !== order.id || refund.amount !== order.amount) throw verificationError();
      const result = await exec('alipay.trade.fastpay.refund.query', { out_trade_no: order.id, out_request_no: refund.id });
      if (!result) return null;
      // code=10000 only means the query succeeded, not that the refund did.
      if (result.refund_status !== 'REFUND_SUCCESS') return null;
      return refundEvent(result, order, refund, true);
    },
    async verifyWebhook(rawBody, headers) {
      try {
        const contentType = headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
        if (contentType !== 'application/x-www-form-urlencoded') throw verificationError();
        const params = new URLSearchParams(rawBody);
        const fields: Record<string, string> = {};
        for (const [key, value] of params) {
          if (Object.hasOwn(fields, key)) throw verificationError();
          fields[key] = value;
        }
        if (fields.sign_type !== 'RSA2' || fields.app_id !== appId || fields.seller_id !== sellerId || !sdk.checkNotifySignV2(fields)) throw verificationError();
        if (!fields.notify_id || !fields.out_trade_no || !fields.trade_no) throw verificationError();
        const total = minorAmount(fields.total_amount);
        if (fields.trade_status === 'TRADE_CLOSED' && fields.refund_fee !== undefined) {
          // TRADE_CLOSED also means a paid transaction was fully refunded. Its signed
          // refund_fee is the cumulative refunded amount, not a merchant refund ID.
          if (minorAmount(fields.refund_fee) !== total) throw verificationError();
          return { id: `alipay:${fields.notify_id}`, type: 'refund_succeeded', orderId: fields.out_trade_no, live, amount: total, currency: 'CNY', paymentId: fields.trade_no };
        }
        const type = ['TRADE_SUCCESS', 'TRADE_FINISHED'].includes(fields.trade_status) ? 'paid' : fields.trade_status === 'TRADE_CLOSED' ? 'expired' : null;
        return type ? { id: `alipay:${fields.notify_id}`, type, orderId: fields.out_trade_no, live, amount: total, currency: 'CNY', paymentId: fields.trade_no } : null;
      } catch { throw verificationError(); }
    },
  };
}
