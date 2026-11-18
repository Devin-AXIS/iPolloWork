# iPolloWork

This repository owns iPolloWork plugins, services, clients and packaging. DSH is an
external, version-pinned dependency. Never edit `.upstream/dsh`, copy its Agent loop into this repository, or add product patches to the official runtime.

Run `npm run setup:build` for a fresh checkout. It verifies the official archive, installs its locked dependencies and creates ignored local resolution links. The exact revision and SHA-256 live in `integrations/runtime/upstream.json`. Upgrades change that pin deliberately, then run the product checks and real-client smoke before adoption.

Update the [DSH compatibility record](integrations/runtime/compatibility.md) in the same change whenever a product modification adds, replaces, or relies on DSH behavior. Record the product files, upstream API/event/slot or DOM dependency, and how to verify the behavior on the next pin. Prefer upstream extension points and types. When an upstream release replaces an adaptation, mark the entry as retired and record the first verified release.

Keep existing product behavior, accounts, projects and files. New capabilities use official plugins, configuration or independent services. Keep credentials out of browser storage and logs. Reuse the official `dsh` profile launcher; do not create a second Agent runtime.

## Plugin development

For every task that creates, changes, ports, reviews, packages or integrates a DSH plugin, read and follow the repository skill at [`.agents/skills/ipollowork-plugin-development/SKILL.md`](.agents/skills/ipollowork-plugin-development/SKILL.md) before planning or editing. This applies even when the user does not name the skill and when plugin composition or distribution changes outside `plugins/`. Follow the [plugin development standard](docs/plugin-development.zh.md), including its DSH architecture and UI requirements, and any instructions for the affected subtree.

Use ESM and strict TypeScript. Follow subtree instructions, especially `plugins/ipollowork-suite/AGENTS.md`. Run `npm test`, `npm run check:upstream`, the changed package's checks and the relevant built-client smoke. Test UI changes in both themes and at narrow width. Do not claim unrun checks or publish deployments without user authorization.

Generated files, runtime caches, dependency folders and credentials are not committed. Keep English and Chinese READMEs consistent. Preserve upstream license notices for derived client code. Final changes must pass `git diff --check`.
