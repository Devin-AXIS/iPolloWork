---
name: stripe-safe-operations
description: Review and execute explicitly requested Stripe writes with exact environment, object, amount, currency, customer, and irreversible-effect confirmation.
disable-model-invocation: false
---

# Stripe Safe Operations

Use this skill for refunds, cancellations, subscription changes, or other material Stripe writes.

1. Read the target object immediately before acting.
2. Present test/live mode, account, object ID, customer, amount and currency, current state, requested change, and irreversible effects.
3. Require explicit user confirmation for the exact operation. A general request to investigate is not confirmation to write.
4. Execute once and avoid blind retries when the result is uncertain.
5. Re-read the object and report the final state and identifiers.

Never expose credentials or full sensitive payment details. Never switch from test to live mode implicitly.
