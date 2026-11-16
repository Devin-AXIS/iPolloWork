# iPolloWork

This repository owns iPolloWork plugins, services, clients and packaging. DSH is an
external, version-pinned dependency. Never edit `.upstream/dsh`, copy its Agent loop into this repository, or add product patches to the official runtime.

Run `npm run setup:build` for a fresh checkout. It verifies the official archive, installs its locked dependencies and creates ignored local resolution links. The exact revision and SHA-256 live in `integrations/runtime/upstream.json`. Upgrades change that pin deliberately, then run the product checks and real-client smoke before adoption.

Keep existing product behavior, accounts, projects and files. New capabilities use official plugins, configuration or independent services. Keep credentials out of browser storage and logs. Reuse the official `dsh` profile launcher; do not create a second Agent runtime.

Use ESM and strict TypeScript. Follow subtree instructions, especially `plugins/ipollowork-suite/AGENTS.md`. Run `npm test`, `npm run check:upstream`, the changed package's checks and the relevant built-client smoke. Test UI changes in both themes and at narrow width. Do not claim unrun checks or publish deployments without user authorization.

Generated files, runtime caches, dependency folders and credentials are not committed. Keep English and Chinese READMEs consistent. Preserve upstream license notices for derived client code. Final changes must pass `git diff --check`.
