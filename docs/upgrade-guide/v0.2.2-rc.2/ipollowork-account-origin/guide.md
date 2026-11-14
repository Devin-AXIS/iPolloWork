---
kind: upgrade-guide
description: "The iPolloWork suite uses the local account service when accountOrigin is omitted."
---

# iPolloWork account service origin

English | [中文](guide.zh.md)

## Change

The iPolloWork suite's default `accountOrigin` changes from `https://i.ipollo.ai` to `http://localhost:4785`. Installations without an explicit profile override connect to the separately started local account service. Installing the suite does not start that service. Explicit origins remain unchanged; existing account tokens are never forwarded to a different origin, and this change does not migrate accounts or balances.

## Migration

1. For local use, start the [account service](../../../../services/ipollowork/README.md) with `SERVICE_ORIGIN=http://localhost:4785` and `PORT=4785`.
2. For a hosted service, set `config.accountOrigin` on the `ipollowork-suite` row in the profile's `cordis.patch.yml` to that service's HTTPS origin. Set the former origin explicitly only if that deployment is still intended.
3. Reload the profile and refresh the browser. Open iPolloWork account settings and confirm the displayed service address. Register or sign in with an account on that service; unrelated model credentials remain unchanged.
