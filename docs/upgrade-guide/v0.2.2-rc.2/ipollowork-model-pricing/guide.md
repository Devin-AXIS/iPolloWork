---
kind: upgrade-guide
description: iPolloWork hides unconfigured models and requires explicit prices before exposing them to users.
---

# iPolloWork model pricing

English | [中文](guide.zh.md)

## Change

The standalone iPolloWork account service omits official models without a configured key, active price or enabled model entry from the user catalog. Enabling a model without a price is rejected. Explicit free models remain supported. Existing service keys, operator prices and database records are retained.

The administration service groups connections by shared key. Alibaba chat, image, video, speech synthesis, recognition and embedding entries use one key. Model discovery appends models without enabling them or replacing operator edits. Asynchronous image and audio jobs now settle credits from their terminal result, like video jobs.

## Migration

1. Back up PostgreSQL and the account-service authentication secret, then rebuild and restart `services/ipollowork`. No database schema migration is required.
2. Open **Service center** as an administrator. Configure the provider key once and confirm its regional API origin. Use **Sync all models** to import the Alibaba directory.
3. Review each enabled model's input/output prices, units, context tiers and price validity date. Mark a model free only when its provider cost is zero. Models without reviewed prices remain unavailable.
4. Confirm a configured model appears in the user catalog and an unconfigured model does not. Check one debit and settlement before enabling paid traffic. Keep uncertain provider outcomes reserved until reconciliation.
