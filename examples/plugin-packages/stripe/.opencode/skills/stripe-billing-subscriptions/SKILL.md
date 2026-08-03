---
name: stripe-billing-subscriptions
description: Analyze Stripe customers, subscriptions, prices, invoices, payment status, and lifecycle transitions with explicit environment and object scope.
disable-model-invocation: false
---

# Stripe Billing And Subscriptions

1. Confirm test or live mode and resolve the exact customer or subscription.
2. Read the current subscription, items, prices, invoices, payment state, trial, cancellation, and collection settings relevant to the request.
3. Explain current state and the expected effect of a proposed change, including timing and proration when evidence is available.
4. Preview changes to plan, quantity, cancellation, trial, or collection behavior before writing.
5. Re-read affected objects after a confirmed write.

Do not guess prices, tax behavior, billing-cycle anchors, or proration outcomes.
