import { z } from "zod";
import { readFile } from "node:fs/promises";
import type { App } from "./http.js";
import type { Store } from "./database.js";
import type { Config } from "./config.js";
import { audit, ledgerEntry, now, refundOrder, requireAdmin, settleOrder, uid, type Order } from "./domain.js";
import { Settings } from "./settings.js";
import { ServiceError } from "./errors.js";

export const planSchema = z.object({
  name: z.string().trim().min(1).max(120), description: z.string().max(2000).default(""),
  kind: z.enum(["points","membership"]), amount: z.number().int().min(0).max(1_000_000_000),
  currency: z.string().regex(/^[A-Z]{3}$/).default("CNY"), points: z.number().int().min(0).max(1_000_000_000),
  days: z.number().int().min(0).max(36500).default(0), enabled: z.boolean().default(true),
  appleProductId: z.string().max(200).nullable().default(null),
  pointsCost: z.number().int().positive().max(1_000_000_000).nullable().default(null),
}).refine(v => v.kind !== "membership" || v.days > 0, "会员套餐必须设置有效天数");

/** Provider verification is outside SQLite transactions; settlement is atomic. */
export function mountPayments(app: App, store: Store, settings: Settings, config: Config) {
  app.get("/api/v1/plans", c => c.json({ items: store.all("SELECT * FROM plans WHERE enabled=1 ORDER BY created_at") }));
  app.get("/api/v1/admin/plans", c => { requireAdmin(c.get("actor")); return c.json({ items: store.all("SELECT * FROM plans ORDER BY created_at LIMIT 200") }); });
  app.post("/api/v1/admin/plans", async c => {
    const actor = c.get("actor"); requireAdmin(actor);
    const p = planSchema.parse(await c.req.json()), id = uid();
    store.transaction(() => {
      store.run("INSERT INTO plans VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", id,p.name,p.description,p.kind,p.amount,p.currency,p.points,p.days,Number(p.enabled),p.appleProductId,now(),p.pointsCost);
      audit(store, actor, "plan.create", id);
    });
    return c.json({ id, ...p }, 201);
  });
  app.put("/api/v1/admin/plans/:id", async c => {
    const actor = c.get("actor"); requireAdmin(actor);
    const p = planSchema.parse(await c.req.json()), id = c.req.param("id");
    store.transaction(() => {
      const changed = store.run("UPDATE plans SET name=?,description=?,kind=?,amount=?,currency=?,points=?,days=?,enabled=?,apple_product_id=?,points_cost=? WHERE id=?", p.name,p.description,p.kind,p.amount,p.currency,p.points,p.days,Number(p.enabled),p.appleProductId,p.pointsCost,id);
      if (!changed.changes) throw new ServiceError("PLAN_NOT_FOUND",404);
      audit(store,actor,"plan.update",id);
    });
    return c.json({ ok: true });
  });
  app.post("/api/v1/admin/points/:userId", async c => {
    const actor = c.get("actor"); requireAdmin(actor);
    const input = z.object({ amount: z.number().int().min(-1_000_000_000).max(1_000_000_000), reason: z.string().trim().min(1).max(300), requestId: z.uuid() }).parse(await c.req.json());
    store.transaction(() => {
      ledgerEntry(store,c.req.param("userId"),input.amount,"adjust/"+input.requestId,input.reason,actor.id);
      audit(store,actor,"points.adjust",c.req.param("userId"));
    });
    return c.json({ ok: true });
  });
  app.get("/api/v1/orders", c => c.json({ items: store.all("SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 100", c.get("actor").id) }));
  app.get("/api/v1/admin/orders", c => {
    requireAdmin(c.get("actor"));
    return c.json({ items: store.all('SELECT o.*,u.name AS user_name,u.email,p.name AS plan_name FROM orders o JOIN "user" u ON o.user_id=u.id JOIN plans p ON p.id=o.plan_id ORDER BY o.created_at DESC LIMIT 200') });
  });
  app.post("/api/v1/orders", async c => {
    const input = z.object({ planId:z.string(),provider:z.enum(["stripe","app_store","points"]),requestId:z.uuid() }).parse(await c.req.json());
    const actor = c.get("actor"), p = store.one("SELECT * FROM plans WHERE id=? AND enabled=1",input.planId);
    if (!p) throw new ServiceError("PLAN_NOT_FOUND",404);
    const prior = store.one<Order>("SELECT * FROM orders WHERE id=?",input.requestId);
    if (prior && (prior.user_id !== actor.id || prior.plan_id !== p.id || prior.provider !== input.provider)) throw new ServiceError("ORDER_CONFLICT",409);
    if(input.provider === "points" && !p.points_cost) throw new ServiceError("INVALID_REDEMPTION",400,"该套餐未开放积分兑换");
    if(input.provider === "app_store" && !p.apple_product_id) throw new ServiceError("INVALID_PRODUCT",400,"该套餐未关联 App Store 商品");
    if (!prior) store.run("INSERT INTO orders VALUES(?,?,?,?,NULL,'pending',?,?,?,?,?,NULL)", input.requestId,actor.id,p.id,input.provider,input.provider === "points" ? p.points_cost : p.amount,p.currency,p.points,p.days,now());
    if(prior?.status === "paid" || prior?.status === "refunded") return c.json({orderId:prior.id,paid:prior.status === "paid"});
    if (input.provider === "points") {
      store.transaction(() => {
        const order = store.one<Order>("SELECT * FROM orders WHERE id=?",input.requestId)!;
        if (order.status === "paid") return;
        if (order.status !== "pending") throw new ServiceError("ORDER_NOT_PENDING",409);
        ledgerEntry(store,actor.id,-order.amount,"redeem/"+order.id,"兑换套餐",actor.id);
        store.run("UPDATE orders SET status='paid',provider_id=?,paid_at=? WHERE id=?","points/"+order.id,now(),order.id);
        if (order.points) ledgerEntry(store,actor.id,order.points,"order/"+order.id,"套餐积分");
        if (order.days) {
          const end=Number(store.one("SELECT MAX(expires_at) AS value FROM entitlements WHERE user_id=? AND revoked_at IS NULL",actor.id)?.value??0);
          store.run("INSERT INTO entitlements VALUES(?,?,?,?,?,NULL)",order.id,actor.id,p.id,now(),Math.max(now(),end)+order.days*86400000);
        }
      });
      return c.json({ orderId:input.requestId,paid:true });
    }
    if (input.provider === "app_store") return c.json({ orderId:input.requestId,productId:p.apple_product_id });
    const stripeConfig=settings.get("stripe");
    if (!stripeConfig.secretKey) throw new ServiceError("PAYMENT_NOT_CONFIGURED",503,"支付渠道尚未配置");
    const { default:Stripe }=await import("stripe");
    const stripe=new Stripe(stripeConfig.secretKey);
    const checkout=await stripe.checkout.sessions.create({
      mode:"payment",client_reference_id:input.requestId,customer_email:actor.email,
      line_items:[{quantity:1,price_data:{currency:String(prior?.currency??p.currency).toLowerCase(),unit_amount:Number(prior?.amount??p.amount),product_data:{name:String(p.name)}}}],
      success_url:config.origin+"/?payment=success",cancel_url:config.origin+"/?payment=cancelled",metadata:{orderId:input.requestId},
    },{idempotencyKey:input.requestId});
    return c.json({ orderId:input.requestId,url:checkout.url });
  });
  app.post("/hooks/stripe",async c=>{
    const s=settings.get("stripe");
    if (!s.secretKey || !s.webhookSecret) throw new ServiceError("PAYMENT_NOT_CONFIGURED",503);
    const { default:Stripe }=await import("stripe"),stripe=new Stripe(s.secretKey);
    let event:import("stripe").Stripe.Event;
    try { event=stripe.webhooks.constructEvent(await c.req.text(),c.req.header("stripe-signature")??"",s.webhookSecret); }
    catch { throw new ServiceError("INVALID_PAYMENT_SIGNATURE",400); }
    if(event.type==="checkout.session.completed" || event.type==="checkout.session.async_payment_succeeded") {
      const session=event.data.object;
      if(session.payment_status!=="paid" || !session.client_reference_id || session.amount_total===null || !session.currency) throw new ServiceError("PAYMENT_NOT_PAID",409);
      const order=store.one<Order>("SELECT * FROM orders WHERE id=?",session.client_reference_id);
      if(!order || order.provider!=="stripe") throw new ServiceError("ORDER_NOT_FOUND",404);
      const paymentId=typeof session.payment_intent==="string"?session.payment_intent:session.payment_intent?.id;
      if(!paymentId) throw new ServiceError("PAYMENT_ID_MISSING",409);
      settleOrder(store,order.id,paymentId,session.amount_total,session.currency);
    } else if(event.type==="charge.refunded" && event.data.object.refunded) {
      const intent=event.data.object.payment_intent;
      if(typeof intent==="string") refundOrder(store,intent);
    }
    return c.json({ received:true });
  });
  app.post("/api/v1/payments/storekit/verify",async c=>{
    const input=z.object({orderId:z.string(),transactionId:z.string().min(1)}).parse(await c.req.json());
    const actor=c.get("actor"),order=store.one<Order>("SELECT * FROM orders WHERE id=? AND user_id=? AND provider='app_store'",input.orderId,actor.id);
    if(!order) throw new ServiceError("ORDER_NOT_FOUND",404);
    const s=settings.get("app_store");
    if(!s.privateKey || !s.bundleId || !s.issuerId || !s.keyId || !s.rootPaths) throw new ServiceError("PAYMENT_NOT_CONFIGURED",503,"App Store 尚未配置");
    const {AppStoreServerAPIClient,Environment,SignedDataVerifier}=await import("@apple/app-store-server-library");
    const environment=s.environment==="production"?Environment.PRODUCTION:Environment.SANDBOX;
    const verifier=new SignedDataVerifier(await Promise.all(s.rootPaths.split(",").map(p=>readFile(p.trim()))),true,environment,s.bundleId,s.appAppleId?Number(s.appAppleId):undefined);
    const api=new AppStoreServerAPIClient(s.privateKey.replace(/\\n/g,"\n"),s.keyId,s.issuerId,s.bundleId,environment);
    const response=await api.getTransactionInfo(input.transactionId);
    if(!response.signedTransactionInfo) throw new ServiceError("INVALID_RECEIPT",400);
    const receipt=await verifier.verifyAndDecodeTransaction(response.signedTransactionInfo);
    const plan=store.one("SELECT apple_product_id FROM plans WHERE id=?",order.plan_id);
    if(receipt.transactionId!==input.transactionId || receipt.appAccountToken!==actor.id || receipt.productId!==plan?.apple_product_id || receipt.revocationDate || receipt.price===undefined || !receipt.currency) throw new ServiceError("RECEIPT_MISMATCH",409);
    return c.json(settleOrder(store,order.id,input.transactionId,Math.round(receipt.price/10),receipt.currency));
  });
}
