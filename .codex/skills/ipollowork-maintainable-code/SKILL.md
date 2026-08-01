---
name: ipollowork-maintainable-code
description: Mandatory iPolloWork code-change gate for modern, minimal, performant, reuse-first implementation and clean repository ownership. Use whenever AI creates, edits, deletes, or refactors application code, server code, packages, scripts, tests, dependencies, schemas, routes, UI, or generated-file workflows. Reuse existing code before creating files, keep one source of truth, prevent parallel implementations and junk directories, justify every new file or dependency, and audit the current change before completion.
---

# iPolloWork Maintainable Code

Treat this as the repository's single code-quality Skill. Implement changes with the smallest coherent diff, modern platform patterns, bounded runtime cost, and one clear owner. Search and reuse before creating anything.

## Non-Negotiable Outcomes

- **Modern:** use the current repository stack and supported platform APIs; do not add legacy wrappers or compatibility layers without a real supported consumer.
- **Minimal:** solve the requested job with the fewest concepts, files, dependencies, states, and routes that remain clear.
- **Performant:** keep network, database, filesystem, bundle, render, and memory work bounded; optimize measured or structurally obvious hot paths.
- **Reusable:** extend compatible components, hooks, services, schemas, types, and utilities before creating parallel versions.
- **Owned:** keep one source of truth and place behavior in the narrowest existing owner.
- **Clean:** do not create convenience directories, one-off design notes, duplicate implementations, generated source artifacts, or abandoned replacement files.

## Required Workflow

1. Find the repository root. Read `AGENTS.md`, the owning package manifest, the real entrypoint, and nearby implementations.
2. Read `references/repository-boundaries.md` before adding a file, directory, dependency, API, table, or cross-package import.
3. Define a change budget before editing: intended behavior, owning module, expected files touched, and whether any new file, directory, dependency, route, table, or persistent state is truly required. Default every category to zero.
4. Search before creating anything:
   - Search component names, visible labels, route names, event names, type names, and distinctive behavior with `rg`.
   - Search `apps/app/src/components/ui`, `apps/app/src/components`, the target domain, `apps/server/src`, `packages/types`, and `packages/ui` as relevant.
   - Inspect exports and call sites, not just filenames.
5. State the reuse decision: reuse unchanged, extend compatibly, extract for real multiple consumers, or create as the last choice. For each new file or dependency, record why no existing owner can absorb the change.
6. Implement locally. Remove the replaced path in the same change; do not leave `old`, `new`, `v2`, fallback, or dead compatibility copies behind.
7. Add focused tests at the owning layer. Do not duplicate server business logic, contracts, state, or validation in the desktop app.
8. Run the narrow package checks, inspect the complete diff, then run:

```powershell
node .codex/skills/ipollowork-maintainable-code/scripts/audit-changes.mjs
```

9. Resolve every error. Fix warnings or give a concrete ownership/performance reason for keeping the exception.

## Creation Gate

- Add a file only when it has a distinct owner and responsibility that would make an existing file less coherent. A long file alone is not a reason to split it.
- Add a directory only for a real subsystem or package with multiple cohesive files and a stable owner. Never create a directory to hold one small feature, one handoff, one report, or one Markdown note.
- Do not add a new top-level directory without explicit user approval and a repository-level architectural reason.
- Do not create `new`, `old`, `v2`, `copy`, `backup`, `temp`, `tmp`, `misc`, `notes`, `drafts`, `handoff`, or `tdd-summary` paths to avoid integrating with the current owner.
- Do not create a design, plan, QA, summary, or TODO Markdown file for each small feature. Update an existing durable document only when future maintainers need information that code, tests, types, or comments cannot express.
- Add a dependency only when the platform, current dependency graph, and local utilities cannot meet the requirement cleanly. Account for bundle/runtime cost, maintenance, license, and existing transitive capability.
- Do not create a generic abstraction for one caller. Extract only after two real consumers need meaningful shared behavior or centralization prevents contract/security drift.

## Reuse Decision

| Situation | Action |
| --- | --- |
| Existing API/component/helper meets the need | Import and reuse it |
| Existing implementation differs only by presentation or configuration | Add typed props/options without changing existing defaults |
| Two real call sites need the same non-trivial behavior | Extract to the nearest shared owner |
| Similar-looking code has different domain rules or is unlikely to be reused | Keep it local; do not force an abstraction |
| No compatible implementation exists after searching | Create one in the narrowest correct owner |

Do not copy a component and rename it, create `*V2`, `*New`, `*Copy`, or duplicate a helper to avoid understanding its API. Do not add a generic abstraction for a single trivial use.

## Modernity And Simplicity

- Use typed boundaries, functional React, explicit async/error states, semantic controls, and current repository primitives.
- Avoid `any`, broad type assertions, duplicated derived state, prop-to-state mirroring, hidden global state, and fallback branches that types or control flow make impossible.
- Prefer composition and typed options over copied components or mode-heavy forks. Preserve existing defaults when extending shared code.
- Delete obsolete code, exports, dependencies, flags, tests, and documentation when their supported path is removed.
- Keep compatibility only for a named active format, client, or migration window. Document the removal condition beside the boundary.

## Performance Gate

- Keep lists and APIs paginated and bounded. Select only needed fields and avoid N+1 queries, request loops, and repeated filesystem scans.
- Keep React subscriptions narrow. Derive values instead of synchronizing copies, avoid effects for pure computation, and lazy-load genuinely heavy optional surfaces.
- Do not add caching or memoization without a clear owner, invalidation rule, and demonstrated reuse or cost.
- Do not move server-owned data or heavy processing into the browser. Keep network and filesystem work out of render paths and short transactions free of network calls.
- For a hot or high-volume path, record the relevant measurement, query plan, bundle effect, or complexity argument. Do not claim a performance improvement from code shape alone.

## Frontend Rules

- Reuse primitive controls from `apps/app/src/components/ui`.
- Put app-wide composed UI in `apps/app/src/components`.
- Put feature-specific UI, hooks, state, and behavior in `apps/app/src/react-app/domains/<domain>`.
- Move UI to `packages/ui` only when more than one application genuinely consumes it.
- Keep domain internals private. Share a stable public API or move truly cross-domain logic to a neutral owner instead of deep-importing another domain.
- Use server APIs for server-owned behavior. Never reproduce filesystem, persistence, authorization, or orchestration logic in the client.
- Put cross-process request/response contracts in `packages/types`; do not maintain separate client and server copies.

## Server And Generated Files

- Add thin HTTP handlers to `apps/server/src/routes`; put reusable business behavior in the existing owning service/extension module.
- Reuse path guards from `apps/server/src/paths.ts`, including safe workspace-relative normalization and root containment helpers.
- Never construct user-controlled filesystem paths with unchecked `path.join` or string concatenation.
- Runtime exports, uploads, captures, renders, audio, images, and generated HTML must not be written under `apps/server/src` or another source directory.
- Preserve the current session layout: `<workspace>/design/<session-id>/...` for design/PPT/web sessions and `<workspace>/video/<session-id>/...` for video sessions.
- Put artifact kinds such as assets, renders, audio, captures, and exports below the owning session directory when appropriate.
- Centralize directory creation and path resolution in one owning service. Routes and UI should pass identifiers, not invent disk paths.

## Platform And Repository Safety

- Keep Electron lifecycle and native integration in `apps/desktop`; do not leak shell-specific behavior into app domains.
- Keep headless runtime orchestration in `apps/orchestrator`; do not create a second orchestration path in the UI or server.
- Keep OpenCode external. Use its supported API, SDK, CLI, plugin, and configuration surfaces; do not fork or silently modify its internals.
- Keep names consistently `iPolloWork` and `ipollowork`; do not introduce alternate product spellings in code, paths, docs, or user-facing text.
- Do not commit secrets, credentials, local caches, build output, generated runtime artifacts, or commercial-only code.

## Verification By Risk

- TypeScript or UI: run the owning package typecheck and focused tests.
- Server or plugin: run focused unit tests and the relevant package test.
- Build or runtime boundary: build the affected package and start the real development entrypoint.
- Observable UI: verify the actual browser/Electron flow using the repository experience-proof rules in `AGENTS.md`.
- Dependency or OpenCode change: record old/new versions and verify startup, configuration, and the affected loading path.
- Database or high-volume query: verify migrations, constraints, rollback/rejection behavior, bounded results, and the relevant query plan when representative data exists.

## Completion Standard

- No existing reusable implementation was missed.
- No unjustified file, directory, dependency, route, table, state store, or abstraction was added.
- No client/server contract was duplicated.
- No runtime artifact was added to a source tree.
- New files have one clear owner and do not create a parallel architecture.
- Runtime work is bounded and no obvious N+1, request loop, broad subscription, or heavy eager import was introduced.
- Existing behavior remains the default when extending shared code.
- Replaced code and stale documentation were removed instead of retained as alternate versions.
- Focused tests, package checks, `git diff --check`, and the maintainability audit pass; any unverified runtime surface is stated explicitly.
