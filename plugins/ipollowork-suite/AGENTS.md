# iPolloWork DSH suite

This repository ships one native DeepSeek Harness Bundle. Keep DSH's launcher, loader, plugin manager, settings, and credential provider authoritative. Do not copy or modify the DSH agent loop, create another application executable, or import old iPolloWork runtime code.

`src/host` owns authenticated routes, catalog reading, and account credentials. `src/client` contributes native slots and reversible styles. `src/shared` contains credential-free records. `catalog/index.json` is DSH's existing format-1 index and is curated by the operator. `assets` contains shipped display resources.

Use ESM and strict TypeScript. All registrations and subscriptions must release with the plugin lifetime. Keep account tokens and passwords out of browser storage, model tools, logs, and error messages. Account and model-provider identities are separate. Declared API errors retain stable codes. A missing balance is not zero.

Changes require `npm run check`, `npm run pack:check`, and focused real-DSH verification for affected composition or UI behavior. Verify both themes and a constrained viewport for style changes. Use a disposable DSH home and the repository's browser-picker overlay for browser checks. Do not install into the user's working profile without an explicit request.

Document the exact security guarantee: the model-facing plugin-manager guard is not protection against arbitrary shell commands or same-process Host plugins. Never present it as enterprise isolation.
