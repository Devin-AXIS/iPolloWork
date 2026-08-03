# iPolloWork Repository Boundaries

Use this map after checking the live repository, because the repository remains the source of truth.

## Placement Map

| Concern | Preferred owner | Notes |
| --- | --- | --- |
| Base buttons, inputs, dialogs, tabs, tooltips | `apps/app/src/components/ui` | Reuse existing shadcn/Base UI primitives |
| App-wide composed React UI | `apps/app/src/components` | Shared inside the desktop/web app |
| Feature UI, hooks, state, feature helpers | `apps/app/src/react-app/domains/<domain>` | Keep feature internals together |
| Electron shell, native integration, desktop lifecycle | `apps/desktop` | Keep shell behavior out of app domains |
| Server HTTP endpoint | `apps/server/src/routes` | Handler should validate and delegate |
| Server feature integration | `apps/server/src/extensions` | Prefer an existing extension owner |
| General server implementation | `apps/server/src` nearest owning module | Do not create a second service tree |
| Headless runtime orchestration | `apps/orchestrator` | Keep one orchestration owner |
| Shared client/server schemas and DTOs | `packages/types` | One contract imported by both sides |
| UI used by multiple applications | `packages/ui` | Do not move app-only UI here preemptively |
| Bundled static templates | `apps/server/bundled-templates` | Versioned source assets |
| Design session artifacts | `<workspace>/design/<session-id>` | Runtime content; not source code |
| Video session artifacts | `<workspace>/video/<session-id>` | Runtime content; not source code |

## Repository Shape

Use an existing top-level owner. The normal choices are:

| Content | Existing owner |
| --- | --- |
| Application and service code | `apps/` |
| Shared or published libraries | `packages/` |
| Durable engineering and operations documentation | `docs/` |
| Product and architecture specifications | `specs/` |
| Executable validation flows | `evals/` |
| Development, audit, build, and release automation | `scripts/` |
| Complete integration examples | `examples/` |
| Installer and distribution metadata | `packaging/` |
| Pinned third-party source built by iPolloWork | `vendor/` |

Do not add a top-level directory for a feature note, temporary experiment,
handoff, QA report, generated output, or alternate implementation. Do not add a
new root Markdown file when an existing durable document can be updated. A new
application, package, or repository-level content class requires explicit user
approval and a clear lifecycle owner.

Inside an owner, extend the nearest existing domain or module. Avoid generic
containers such as `misc`, `common`, `helpers`, `new`, `old`, `v2`, `backup`,
`temp`, or `drafts`; these names hide ownership and usually create parallel
architectures. Use a capability or domain name only when a distinct directory
is justified.

## Dependency Direction

```text
apps/app UI -> app domain API/client -> server API
                                   -> packages/types
apps/server routes -> owning server service/extension -> filesystem/database
                                                   -> packages/types
packages/ui -> low-level shared packages only
apps/desktop -> app/server entrypoints and typed native boundaries
apps/orchestrator -> server/runtime APIs
OpenCode -> external sidecar reached through supported API/SDK/CLI/plugin/config
```

Avoid app code importing server implementations, server code importing app internals, private cross-domain deep imports, packages depending on applications, and separate declarations of the same API payload.
Do not copy OpenCode internals into iPolloWork or create a parallel runtime path.

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

## Performance Ownership

| Cost | Owning boundary |
| --- | --- |
| Database filtering, pagination, joins, and transactions | `apps/server` owning route/service |
| Filesystem traversal, artifact lifecycle, and heavy conversion | `apps/server` owning service |
| Remote-data caching | existing query/cache layer with one invalidation owner |
| UI-only derived state | nearest component or domain selector, not a second store |
| Heavy optional UI | owning domain with lazy loading when bundle impact is material |

Keep costs visible and bounded. Do not solve server performance in the client,
duplicate remote state for convenience, or introduce caches without an
invalidation rule.
