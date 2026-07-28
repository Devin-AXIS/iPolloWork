---
name: ipollowork-maintainable-code
description: Enforce reuse-first implementation and repository boundaries in the iPolloWork monorepo. Use whenever AI creates, edits, or refactors React/TypeScript frontend code, server routes or services, shared packages, generated-file workflows, or features spanning apps/app and apps/server. Prevent duplicate components, helpers, types, routes, and runtime files; place new code and generated artifacts in the correct project-owned directories; and audit only the current change before completion.
---

# iPolloWork Maintainable Code

Implement iPolloWork changes with the smallest coherent diff. Search before creating, extend compatible code before adding parallel implementations, and preserve app/server/package ownership.

## Required Workflow

1. Find the repository root and read `AGENTS.md`, the nearest package manifest, and nearby implementations.
2. Read `references/repository-boundaries.md` before deciding where a new file belongs.
3. Search before creating anything:
   - Search component names, visible labels, route names, event names, type names, and distinctive behavior with `rg`.
   - Search `apps/app/src/components/ui`, `apps/app/src/components`, the target domain, `apps/server/src`, `packages/types`, and `packages/ui` as relevant.
   - Inspect exports and call sites, not just filenames.
4. Decide whether to reuse unchanged, extend an existing implementation, extract shared code, or create new code. New code is the last choice.
5. Implement within the ownership boundary and keep runtime-generated files outside source directories.
6. Add focused tests at the owning layer. Do not duplicate server business logic in the desktop app.
7. Run normal package checks plus:

```powershell
node .codex/skills/ipollowork-maintainable-code/scripts/audit-changes.mjs
```

8. Resolve errors. Inspect every warning and either fix it or explain why the implementations are intentionally distinct.

## Reuse Decision

| Situation | Action |
| --- | --- |
| Existing API/component/helper meets the need | Import and reuse it |
| Existing implementation differs only by presentation or configuration | Add typed props/options without changing existing defaults |
| Two real call sites need the same non-trivial behavior | Extract to the nearest shared owner |
| Similar-looking code has different domain rules or is unlikely to be reused | Keep it local; do not force an abstraction |
| No compatible implementation exists after searching | Create one in the narrowest correct owner |

Do not copy a component and rename it, create `*V2`, `*New`, `*Copy`, or duplicate a helper to avoid understanding its API. Do not add a generic abstraction for a single trivial use.

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

## Completion Standard

- No existing reusable implementation was missed.
- No client/server contract was duplicated.
- No runtime artifact was added to a source tree.
- New files have one clear owner and do not create a parallel architecture.
- Existing behavior remains the default when extending shared code.
- Tests and the focused audit pass, or remaining warnings are explicitly justified.
