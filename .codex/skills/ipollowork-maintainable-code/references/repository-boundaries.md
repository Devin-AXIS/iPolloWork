# iPolloWork Repository Boundaries

Use this map after checking the live repository, because the repository remains the source of truth.

## Placement Map

| Concern | Preferred owner | Notes |
| --- | --- | --- |
| Base buttons, inputs, dialogs, tabs, tooltips | `apps/app/src/components/ui` | Reuse existing shadcn/Base UI primitives |
| App-wide composed React UI | `apps/app/src/components` | Shared inside the desktop/web app |
| Feature UI, hooks, state, feature helpers | `apps/app/src/react-app/domains/<domain>` | Keep feature internals together |
| Server HTTP endpoint | `apps/server/src/routes` | Handler should validate and delegate |
| Server feature integration | `apps/server/src/extensions` | Prefer an existing extension owner |
| General server implementation | `apps/server/src` nearest owning module | Do not create a second service tree |
| Shared client/server schemas and DTOs | `packages/types` | One contract imported by both sides |
| UI used by multiple applications | `packages/ui` | Do not move app-only UI here preemptively |
| Bundled static templates | `apps/server/bundled-templates` | Versioned source assets |
| Design session artifacts | `<workspace>/design/<session-id>` | Runtime content; not source code |
| Video session artifacts | `<workspace>/video/<session-id>` | Runtime content; not source code |

## Dependency Direction

```text
apps/app UI -> app domain API/client -> server API
                                   -> packages/types
apps/server routes -> owning server service/extension -> filesystem/database
                                                   -> packages/types
packages/ui -> low-level shared packages only
```

Avoid app code importing server implementations, server code importing app internals, private cross-domain deep imports, packages depending on applications, and separate declarations of the same API payload.

## Search Checklist

```powershell
rg -n "ExactName|visible label|route-fragment|event-name" apps packages
rg --files apps/app/src/components apps/app/src/react-app/domains packages/ui
rg -n "export (type|interface|class|function|const)" packages/types apps/server/src apps/app/src
```

Search by behavior as well as names. A close button may be named `DismissButton`, and a payload may be inferred from a Zod schema instead of declared as an interface.

## Runtime Artifact Layout

Preserve the existing project convention:

```text
<workspace-root>/
  design/<session-id>/
    entry.html
    design-tokens.css
    assets/
  video/<session-id>/
    index.html
    design-tokens.css
    assets/
    renders/
```

The authoritative implementation is `sessionRoot` in `apps/server/src/templates.ts`. Inspect it before changing session paths. Use `apps/server/src/paths.ts` containment helpers for paths influenced by user input.

Requirements:

- sanitize IDs and resolve through containment helpers;
- use collision-resistant names, or stable names where replacement is intentional;
- isolate temporary files and clean them after success or failure;
- return logical metadata or a server URL instead of unrestricted absolute paths;
- keep creation and deletion lifecycle in the same owning service.

## Extraction Threshold

Extract shared code when two real consumers need meaningful shared behavior, centralization prevents security or contract drift, an existing owner can be extended compatibly, or extraction removes substantial duplicated branching/state.

Do not extract merely because two blocks share a few JSX or CSS lines. Prefer composition and typed configuration over large mode flags.
