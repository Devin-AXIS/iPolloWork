---
name: stripe-reconciliation
description: Reconcile bounded Stripe payment and payout records with supplied business records while preserving object IDs, currency, time zone, and discrepancy evidence.
disable-model-invocation: false
---

# Stripe Reconciliation

1. Confirm environment, account, currency, time zone, and inclusive reporting window.
2. Use bounded Stripe queries and the user-supplied business records; do not scan an unlimited account history.
3. Match by stable IDs first, then amount, currency, and timestamps when IDs are unavailable.
4. Classify exact matches, timing differences, fees, refunds, disputes, missing records, and ambiguous records separately.
5. Return a reproducible discrepancy list without modifying Stripe objects.

Do not combine currencies or treat pending balance activity as settled funds.
