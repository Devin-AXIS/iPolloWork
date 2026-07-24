---
name: ipollowork-project-standards
description: Apply iPolloWork's modern, minimal-change engineering standards when adding features, fixing bugs, refactoring, changing UI, or upgrading dependencies. Use for every implementation task in the iPolloWork repository.
---

# iPolloWork project standards

Use this skill for every code change in this repository. The goal is a fast, modern, small implementation that preserves existing behavior and keeps iPolloWork separate from its OpenCode runtime.

## Before changing code

1. Inspect the real entrypoint, owning package, existing scripts, and nearby implementation.
2. Reproduce the issue or define the user-visible acceptance criteria.
3. Search for an existing component, hook, utility, API, or OpenCode primitive before creating one.
4. Write a short reason for each non-trivial change: problem, chosen approach, and why the smaller alternative was insufficient.

## Implementation rules

- Prefer the smallest coherent patch. Do not add abstractions, dependencies, files, or configuration without a concrete need.
- Reuse existing patterns and design tokens; keep UI compact, accessible, keyboard-friendly, and visually consistent.
- Keep code modern: TypeScript types at boundaries, functional React, narrow modules, explicit async/error states, and no duplicated state.
- Keep changes local to the owning package. Avoid broad rewrites and unrelated formatting churn.
- Preserve public behavior, data formats, routes, plugin contracts, and existing user workflows unless the task explicitly changes them.
- Do not modify or fork OpenCode internals to implement iPolloWork features. Prefer its documented CLI/API/plugin/config surface; isolate compatibility adapters at the boundary.
- Do not commit secrets, generated artifacts, local caches, credentials, or commercial-only code.
- Keep names consistently `iPolloWork` / `ipollowork`; do not reintroduce old product names in new code, docs, paths, or user-facing strings.

## Verification required

Run the narrowest useful checks first, then expand with risk:

- TypeScript/UI changes: the owning package typecheck and focused tests.
- Server/plugin changes: focused unit tests plus the relevant package test.
- Build/runtime changes: build the affected package and start the real local entrypoint.
- UI changes: verify the actual browser/Electron surface, not only snapshots.
- Dependency/OpenCode upgrades: record the old/new versions and verify startup, configuration loading, plugin loading, and the affected flow.

Before reporting completion, inspect the diff, run `git diff --check`, confirm no unrelated files changed, and state any warnings or unverified paths.

## Decision rule

If a requested feature can be implemented by a small extension of existing code, do that. If it requires a new subsystem, stop and explain the boundary, alternatives, risk, and validation plan before expanding scope.

## Reference

For the repository's package boundaries and runtime contract, read [architecture.md](references/architecture.md) when a change crosses app, desktop, server, plugin, or OpenCode boundaries.
