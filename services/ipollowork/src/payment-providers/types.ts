export type PaymentProviderId = 'stripe' | 'alipay' | 'wechat';
export type Currency = 'CNY' | 'USD';
export type OrderStatus = 'created' | 'pending' | 'paid' | 'expired' | 'failed' | 'refunded';
export type RefundStatus = 'pending' | 'succeeded' | 'failed';

export interface PaymentOrder {
  id: string; accountRef: string; provider: PaymentProviderId; currency: Currency; amount: number;
  description: string; live: boolean; status: OrderStatus; createdAt: string; updatedAt: string;
  checkoutUrl: string | null; qrCode: string | null; providerOrderId: string | null; providerPaymentId: string | null;
  error: string | null; idempotencyKey: string;
}
export interface PaymentRefund {
  id: string; orderId: string; amount: number; status: RefundStatus; reason: string;
  providerRefundId: string | null; error: string | null; createdAt: string; updatedAt: string;
}
export interface CheckoutResult { providerOrderId: string; checkoutUrl?: string; qrCode?: string }
export interface PaymentEvent {
  id: string; type: 'paid' | 'expired' | 'failed' | 'refund_pending' | 'refund_succeeded' | 'refund_failed';
  orderId: string; live: boolean; amount?: number; currency?: Currency;
  paymentId?: string; refundId?: string; providerRefundId?: string;
}
export interface ProviderContext {
  baseUrl: string;
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
}
/** All amounts are integer minor units; callbacks must be verified before returning an event. */
export interface PaymentProvider {
  id: PaymentProviderId;
  live: boolean;
  createCheckout(order: PaymentOrder): Promise<CheckoutResult>;
  queryPayment(order: PaymentOrder): Promise<PaymentEvent | null>;
  createRefund(order: PaymentOrder, refund: PaymentRefund): Promise<PaymentEvent | null>;
  queryRefund(order: PaymentOrder, refund: PaymentRefund): Promise<PaymentEvent | null>;
  verifyWebhook(rawBody: string, headers: Headers): Promise<PaymentEvent | null>;
}

export function majorAmount(minor: number): string {
  if (!Number.isSafeInteger(minor) || minor <= 0) throw new Error('金额必须为正整数分');
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;
}
export function minorAmount(major: unknown): number {
  if (typeof major !== 'string' || !/^\d+(\.\d{1,2})?$/.test(major)) throw new Error('支付渠道返回了无效金额');
  const [whole, fraction = ''] = major.split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('支付渠道返回了无效金额');
  return amount;
}
export function pem(value: string): string { return value.replace(/\\n/g, '\n'); }
