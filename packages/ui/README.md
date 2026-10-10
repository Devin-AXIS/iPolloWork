# @ipollowork/ui

Shared UI primitives for iPolloWork apps.

## Public UI foundations (runtime 1.3)

Brand `--primary` is teal; Button default uses `--action-background` / `--action-foreground`
(light #161E24 / white, dark #1FBAC0 / #161E24). Use `text-link` / `--primary-text`
for readable links, not brand teal on white. Hover, pressed and focus are shared tokens.
The runtime emits `text-ui-page-title` (16/24/600), `text-ui-section-title` (14/20/600),
`text-ui-control` (13/18/500), `text-ui-body` (13/20/400), `text-ui-meta` (12/18),
`text-ui-caption` (11/16), `text-ui-micro` (10/14/600, badges only).
Plain CSS consumers use `--ui-{role}-size` / `--ui-{role}-line` (px) and
`--ipollowork-font-sans` / `--ipollowork-font-mono`. Meta/caption default to regular;
add `font-medium` when appropriate. Field owns its 8px hint/error gap.

```tsx
import { Button, Field, FieldLabel, Input, FieldDescription } from '@ipollowork/ui/core';
// Host CSS already loads the shared theme; iframe consumers instead obtain these
// constructors from requireRuntime(1, ['Button','Field','FieldLabel','Input','FieldDescription'], 3).
<Field>
  <FieldLabel htmlFor="project-name">项目名称</FieldLabel>
  <Input id="project-name" aria-describedby="project-hint" />
  <FieldDescription id="project-hint">填写可辨认的名称</FieldDescription>
  <Button>保存</Button>
</Field>
```

Native HTML adaptation remains limited to Button/Input/Textarea; other components
must mount through the runtime's React/createRoot. No typography constructor exists.
Figma style and variable IDs are recorded in the Skill's component-mapping.json.
Updating Figma alone does not update a client: rebuild development bundles, update
the host and reopen production plugin workspaces. CSS root font-size fallback is
not iframe font-size synchronization; native Electron zoom requires separate testing.

The Paper entrypoint is `@ipollowork/ui/react`, used by `apps/app`
and `ee/apps/den-web`. (A Solid flavor existed during the Solid-to-React
migration and was removed once the last Solid consumer disappeared.)

Exports resolve to `src/` directly, so consumers need no build step.

## Plugin controls and runtime

`@ipollowork/ui/controls` exports the same Button, Input and Textarea used by
the main app. Host CSS and iframe runtime share `palette.css`, `tokens.css`
and `theme.css`. Select, Dialog and Toaster/toast also have shared entries
`@ipollowork/ui/select`, `/dialog` and `/sonner`. `@ipollowork/ui/core` is the
typed core barrel, including 32 additional modules listed in package exports
(forms, menus, overlays, feedback, data and layout). Each module also has its own
entry, such as `/checkbox`, `/command`, `/sheet`, `/table` and `/tabs`.
Host compatibility files point to this same implementation; Alert/Image retain
small host translation adapters. Business components are not implicitly public.

Development plugins bundle `buildPluginRuntime('bundled')`. Production HTML
opts in with `<meta name="ipollowork-ui-runtime" content="1">`; the host
injects `buildPluginRuntime('host')` into its existing sandbox without network
access or a looser CSP. Import `requireRuntime` from the lightweight
`@ipollowork/ui/runtime-contract` entrypoint, not the implementation entrypoint,
so production plugins do not accidentally bundle another React copy.

Runtime 1.3 exposes React, createRoot and the core barrel's value exports.
New consumers pass their actual function names to
`requireRuntime(1, required)` before initializing the bridge. An old 1.x without
these functions receives an update prompt. For native
HTML, mark elements with `data-ipw-control="button|input|textarea"` and call
`enhance(root)` or `observe(root)`. HTML adaptation shares styles, not Base UI
behavior; labels, focus, validation and persistence remain plugin-owned.

Existing dependencies were relocated with the controls; Tailwind and esbuild
reuse workspace versions for two real consumers: host and short-video plugin.
The runtime is approximately 971KB raw / 258KB gzip, built once per host build,
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
The core expansion adds approximately 362KB raw / 85KB gzip over runtime 1.1;
this is intentionally one opted-in full core runtime, not per-component chunks.
Production plugin
business scripts still contain neither React nor component implementations.
Shared modules own implementation; same-named host files are reexports or
small translation/theme adapters, not duplicate source implementations.

See `.codex/skills/ipollowork-plugin-ui/references/plugin-contract.md` for
the canonical v1 public-entry, build/injection and major-version contract,
including current limitations, and `evals/flows/shared-ui-runtime.flow.mjs`
for proof. `plugin-runtime` is an implementation entrypoint, not the production
plugin business-script API. Runtime `1.4.0` is distinct from client/plugin
package versions; `requireRuntime(1, required, 3)` enforces minor >= 3 in major 1.
Older two-argument callers remain compatible. There is no semver range negotiation.
The built-in production plugin was installed in a dedicated Electron dev
profile and verified through the real host: 32px controls at a 13px root font,
failure recovery, disk persistence, reopen, theme/390px container and incompatible
major rejection and missing-function rejection. See `evals/flows/shared-ui-client.flow.mjs`
and `evals/flows/shared-ui-overlays.flow.mjs`. This pilot was rebuilt to use the new
APIs; compatible host implementation updates do not require bundling the components
again into plugin business scripts. Control spacing is scoped, not a global reset.
Signed archive upload, packaged Electron and cross-client upgrades must still
be checked before a production release. Local Carrie integration is not publication.

The core calling showcase is `evals/support/shared-ui-core.html`, with the
public consumer in `shared-ui-core-fixture.mjs` and the two-mode executable flow
`evals/flows/shared-ui-core.flow.mjs`. Form/delete callbacks in this showcase are
isolated demo callbacks, not persistence or a real deletion service. Mounting a
component is not proof of all of its states. AlertDialogAction is a Button, not
an automatic close action: consumers control open state and close after success.
See the Skill mapping for catalog identities; unverified Figma main IDs stay
null. Figma changes do not automatically rewrite code.
Runtime 1.2 has been integrated locally into Carrie, without a commit, push or
publication; the isolated branch remains intact. Its current-checkout sandbox
proof is `evals/results/2026-10-10T04-46-21-450Z/fraimz.html` (twelve frames), not
an Electron installation check. Sidebar, Resizable, PanelTabs and the host's
business-heavy components remain outside this public core batch.

Toast and Alert close actions reuse the public Button (`ghost`, `icon-sm`),
not separately styled native buttons. The iframe applies a scoped Button reset
at the base layer; component utilities still determine variant and size. This
does not reset unrelated plugin HTML. The core flow checks Toast button/SVG
centers within 1 CSS pixel, 28px target/16px icon, zero padding/border, and mouse
and keyboard dismissal in both runtime modes. Its matrix covers light/dark,
1280/390px containers, 13/16px root fonts and CSS layout zoom 1/1.25/1.5, with
normal/hover/focus states (144 geometry checks). CSS zoom is not a packaged
Electron/native browser-zoom acceptance test. Latest twelve-frame proof:
`evals/results/2026-10-10T04-18-15-972Z/fraimz.html`.

Alert and Toast use soft semantic backgrounds with no border or shadow.
`tokens.css` maps `--feedback-{info,success,warning,error}-background` to the
shared palette's `sky/green/amber/red-2`, including dark theme values. Alert
variants remain `default/success/warning/destructive`; Toast keeps its existing
default/info/success/warning/error API. The core flow checks all variants in
both themes and runtime modes, readable description contrast, dismiss and retry.
Development bundles must be rebuilt; host-injected workspaces load the updated
runtime when reopened after the host updates. Figma edits alone do not update
installed clients or already running plugin scripts.

The settings Button decoration is absolutely positioned so it cannot consume
a flex gap; typography and padding remain stable between ghost and secondary.
DialogContent supplies the standard ghost close (28px target, 16px centered X).
Template facets compose this Button with DropdownMenu; the model selector keeps
its text and trailing chevron in narrow containers without a leading icon.
Current two-mode feedback proof:
`evals/results/2026-10-10T05-18-34-476Z/fraimz.html`.

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

### Public icons (runtime 1.4)

`Icon` from `@ipollowork/ui/icon` or `core` provides 32 curated Lucide glyphs, enumerated by `ICON_NAMES` and typed by `IconName`. Sizes `s`/`m`/`l` are fixed14/16/20px; default `m`. It is decorative unless `label` is supplied. Compose existing Button children with `data-icon="inline-start"` or `inline-end`; pure icon buttons require an accessible Button name. iframe consumers call `requireRuntime(1, ['Button', 'Icon'], 4)`. Button `sm`/default/`lg` and matching icon sizes use28/32/36px; legacy xs remains24px. No Lucide namespace or arbitrary icon-name loading is exposed.

```tsx
import { Button, Icon } from '@ipollowork/ui/core';
<Button onClick={save}><Icon name="Save" data-icon="inline-start" />保存</Button>
<Button size="icon" aria-label="搜索"><Icon name="Search" /></Button>
```
