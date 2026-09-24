---
name: stripe-payment-investigation
description: Investigate Stripe payment failures and unexpected outcomes from exact object IDs, lifecycle state, events, amounts, currency, refunds, and dispute evidence.
disable-model-invocation: false
---

# Stripe Payment Investigation

1. Confirm test or live mode before retrieving or changing anything.
2. Resolve exact customer, PaymentIntent, Charge, Invoice, refund, or dispute IDs from trusted input.
3. Read the lifecycle and relevant events, keeping amount and currency attached to every conclusion.
4. Separate customer-visible outcome, Stripe state, integration behavior, and next action.
5. Do not issue a refund, retry, capture, cancel, or update an object during a diagnosis-only request.

Redact unnecessary personal and payment data. Never infer live mode from an object description.
