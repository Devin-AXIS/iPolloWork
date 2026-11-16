/** Credential-free membership and credit usage returned by the account service. */
import { z } from 'zod'

const credits = z.number().int().nonnegative()
const window = z.object({ used: credits, reserved: credits, limit: credits.nullable(), remaining: credits.nullable(), resetsAt: z.number().int().positive() })
const checkoutUrl = z.url().refine(value => { const url = new URL(value); return url.protocol === 'https:' && ['checkout.stripe.com', 'openapi.alipay.com', 'openapi-sandbox.dl.alipaydev.com'].includes(url.hostname) })
export const membershipCheckoutSchema = z.object({ orderId: z.string(), paid: z.boolean().optional(), url: checkoutUrl.optional(), qrCode: z.string().startsWith('weixin://wxpay/').max(4096).optional() })
export const membershipSchema = z.object({
  points: z.object({ balance: z.number().int(), totalEarned: credits, totalSpent: credits }),
  memberships: z.array(z.object({ id: z.string(), name: z.string(), expiresAt: z.number().int().positive() })).max(100),
  usage: z.object({ utcOffsetMinutes: z.number().int(), daily: window, weekly: window }),
  history: z.array(z.object({ date: z.iso.date(), used: credits })).length(7),
  plans: z.array(z.object({ id: z.string(), name: z.string(), description: z.string(), amount: credits, currency: z.string(), points: credits, days: credits, dailyPoints: credits.nullable(), weeklyPoints: credits.nullable(), pointsCost: credits.nullable() })).max(200),
  checkoutAvailable: z.boolean(),
  channels: z.array(z.object({ id: z.enum(['stripe', 'alipay', 'wechat']), name: z.string(), configured: z.boolean() })).length(3),
  pendingOrder: membershipCheckoutSchema.nullable(),
})
export type MembershipState = z.infer<typeof membershipSchema>
export const membershipOrderSchema = z.object({ planId: z.string().min(1).max(200), provider: z.enum(['stripe', 'alipay', 'wechat', 'points']), requestId: z.uuid() })
