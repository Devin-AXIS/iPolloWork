# @ipollowork/ui

Shared UI primitives for iPolloWork apps.

The Paper entrypoint is `@ipollowork/ui/react`, used by `apps/app`
and `ee/apps/den-web`. (A Solid flavor existed during the Solid-to-React
migration and was removed once the last Solid consumer disappeared.)

Exports resolve to `src/` directly, so consumers need no build step.

## Plugin controls and runtime

`@ipollowork/ui/controls` exports the same Button, Input and Textarea used by
the main app. Host CSS and iframe runtime share `palette.css`, `tokens.css`
and `theme.css`. Select, Dialog and Toaster/toast also have shared entries
`@ipollowork/ui/select`, `/dialog` and `/sonner`; other app components remain private.

Development plugins bundle `buildPluginRuntime('bundled')`. Production HTML
opts in with `<meta name="ipollowork-ui-runtime" content="1">`; the host
injects `buildPluginRuntime('host')` into its existing sandbox without network
access or a looser CSP. Import `requireRuntime` from the lightweight
`@ipollowork/ui/runtime-contract` entrypoint, not the implementation entrypoint,
so production plugins do not accidentally bundle another React copy.

Runtime 1.1 exposes React, createRoot, the three controls, Select/Dialog named
exports and Toaster/toast. New consumers pass their actual function names to
`requireRuntime(1, required)` before initializing the bridge. An old 1.x without
these functions receives an update prompt. For native
HTML, mark elements with `data-ipw-control="button|input|textarea"` and call
`enhance(root)` or `observe(root)`. HTML adaptation shares styles, not Base UI
behavior; labels, focus, validation and persistence remain plugin-owned.

Existing dependencies were relocated with the controls; Tailwind and esbuild
reuse workspace versions for two real consumers: host and short-video plugin.
The runtime is approximately 609KB raw / 173KB gzip, built once per host build,
and injected only into opted-in workspaces. It includes React/ReactDOM for the
supported React consumer. The HTML/React-island production pilot is approximately 56KB
and does not carry this runtime. Tokens and source recipes are not duplicated.

Runtime bundles retain upstream license comments. These dependencies were
already used by the host, not replaced with a new UI framework. The Skill is
a durable multi-file catalog/contract/mapping owner, and this plugin runtime
is unrelated to the video compositor's similarly named runtime module.

The extraction relocates lucide-react 0.577.0 (ISC) and Sonner 2.0.7 (MIT)
from the host's existing locked graph, without upgrades. They preserve the
actual existing icons and notification behavior instead of rebuilding them.
The measured runtime growth is about 201KB raw / 61KB gzip; production plugin
business scripts still contain neither React nor component implementations.
Shared modules own implementation; same-named host files are reexports or
small translation/theme adapters, not duplicate source implementations.

See `.codex/skills/ipollowork-plugin-ui/references/plugin-contract.md` for
the canonical v1 public-entry, build/injection and major-version contract,
including current limitations, and `evals/flows/shared-ui-runtime.flow.mjs`
for proof. `plugin-runtime` is an implementation entrypoint, not the production
plugin business-script API. Runtime `1.1.0` is distinct from client/plugin
package versions; `requireRuntime(1)` does not enforce a minimum minor version.
The built-in production plugin was installed in a dedicated Electron dev
profile and verified through the real host: 32px controls at a 13px root font,
failure recovery, disk persistence, reopen, theme/390px container and incompatible
major rejection and missing-function rejection. See `evals/flows/shared-ui-client.flow.mjs`
and `evals/flows/shared-ui-overlays.flow.mjs`. This pilot was rebuilt to use the new
APIs; compatible host implementation updates do not require bundling the components
again into plugin business scripts. Control spacing is scoped, not a global reset.
Signed archive upload, packaged Electron and cross-client upgrades must still
be checked before a production release. Local Carrie integration is not publication.

## Paper components

The first shared components live under the `paper` namespace and wrap Paper Design shaders with iPolloWork-specific defaults and deterministic seed support.

Current components:

- `PaperMeshGradient`
- `PaperGrainGradient`

Both accept a `seed` prop. Pass a TypeID-like string such as `om_01kmhbscaze02vp04ykqa4tcsb` and the component will deterministically derive colors and shader params from it. The same seed always produces the same result.

Explicit props still work and override the seeded values, so the merge order is:

1. iPolloWork defaults
2. Seed-derived values from `seed`
3. Explicit props passed by the caller

## Layout convention

These components default to `fill={true}`, which means they render at `width: 100%` and `height: 100%`. Put them inside a sized container and they will fill it without needing manual width or height props.

## Agent notes

- Shared seed logic lives in `src/common/paper.ts`
- React wrappers live in `src/react/paper/*`
- Prefer extending the existing seed helpers instead of inventing per-app one-off shader configs
