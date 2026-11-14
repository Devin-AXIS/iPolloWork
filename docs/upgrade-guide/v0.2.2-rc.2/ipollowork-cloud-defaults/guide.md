---
kind: upgrade-guide
description: "The iPolloWork suite uses the production account service and leaves generated output files local by default."
---

# iPolloWork account and output defaults

English | [中文](guide.zh.md)

## Change

The iPolloWork suite defaults to `https://work.ipollo.net` instead of `http://localhost:4785`. Saved account grants remain scoped to their original service. Native `present` events no longer upload output files automatically unless the deployment explicitly enables `automaticOutputArchive`.

## Migration

1. For a local account service, keep `accountOrigin: http://localhost:4785` under the profile patch's `ipollowork-suite` entry. Production installations can omit the setting or use `https://work.ipollo.net`.
2. Sign in to the selected service. When an operator migrates an existing database, preserve its authentication secret and account data before changing client connections; do not reuse a grant with an unrelated service.
3. Use the project Files page to upload selected outputs. Existing uploaded versions remain available. A deployment that still requires automatic presentation uploads can set `automaticOutputArchive: true`; its project upload permission remains authoritative.
4. Generate an output and confirm it remains local until an explicit upload. Check the account page for the intended service origin and identity.
5. For Design webpage sharing, deploy the account service's publication API and set `PUBLICATION_ORIGIN` to a separate HTTPS origin. The production proxy also needs `PUBLICATION_DOMAIN`; see the [deployment configuration](../../../../services/ipollowork/deploy/README.md). Upgrade the Design bundle and suite together so the editor uses the shared publishing service.
