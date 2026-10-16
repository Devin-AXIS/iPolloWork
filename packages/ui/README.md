# @ipollowork/ui

Shared UI primitives for iPolloWork apps.

## Acceptance status and required matrix

Track five independent dimensions: public code availability, actual business
adoption, Figma identity/visual alignment, scoped interaction acceptance, and
packaged release verification. Recommended does not mean accepted in every
state. A recorded Figma ID is identity evidence, not proof of every variant;
null means unverified identity, not missing implementation. The current core
barrel exports 43 modules, not 43 independent components. Current states and
historical evidence live in the plugin-UI component catalog.

| Area | Required observable assertions | Existing executable owner |
| --- | --- | --- |
| Foundation | Light/dark, 1280/390px, long Chinese/English text, contrast, stable selected geometry | shared-ui-core, shared-ui-compositions |
| Controls | Normal/hover/pressed/focus/disabled/invalid; keyboard activation, disabled non-execution and linked errors | shared-ui-core, shared-ui-compact-controls |
| Overlays | Open/close, Escape, focus restoration, bounded menu/dialog; cancel causes zero business writes | component-validation-matrix, shared-ui-overlays |
| Async | Initial loading, refreshing retained data, confirmed empty/no-match, failure, same-draft retry and duplicate-submit guard | shared-ui-async-feedback |
| Table | Sort/filter before paging, page-local mixed selection, stable cross-page IDs, failed subset recovery | shared-ui-table |
| Video workbench | Six inspector tabs, shared first-module spacing, expanded script hides and disables inspector, collapse restores tab; light/dark and narrow bounds | video-studio-shared-ui (isolated P0), video-workbench-modules, video-script-inspector-readonly (native) |

Only mark Passed when each claimed action has an observable assertion and a
validated screenshot in fraimz.html. Unmeasured cells remain Incomplete; tests
or mounting alone cannot certify the matrix. Use isolated callbacks for
save/upload/retry/delete; actual user tasks and credentials are out of scope.
Dialog-open-only checks do not certify submitting or real persistence.
Native zoom and packaged Electron need separate acceptance from CSS zoom and
isolated browser/component fixtures.

For the read-only Studio P0 matrix, start Studio Vite on 127.0.0.1:5198 and run:
```sh
node --input-type=module -e "const m=await import('./evals/flows/video-studio-shared-ui.flow.mjs');await m.runIsolatedP0Proof()"
```

Run from the repository root. The bootstrap uses a temporary Chrome profile,
five in-memory script shots and the existing isolated Studio proof project.
All non-read requests are intercepted; selection callbacks are in-memory,
content writes are rejected. It checks actual Studio navigation/layout, not
the host's voice/style/avatar forms or packaged Electron integration. Those
remain covered separately by host fixtures and native read-only flows.

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
typed core barrel, currently aggregating 43 modules listed in package exports
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
plugin business-script API. Runtime `1.7.0` is distinct from client/plugin
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
shared palette's `sky/green/red-2` for information, success and errors. Warning
uses `--project-dialog-notice`: warm gray `#f4f4ee` in light theme and
`--gray-3` in dark theme. Warning icons retain their semantic accent. Alert
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

## Compact high-frequency controls (runtime 1.6)

Public entries: `/search-field`, `/number-field`, `/slider`, `/calendar`,
`/date-picker` (also TimeInput), `/file-upload` (also FileUploadItem).
Use `requireRuntime(1, required, 6)`. Search composes existing InputGroup;
NumberField/Slider reuse Base UI. All reuse compact 32px controls, 13px roles and
host theme tokens. Input composition follows [shadcn Base InputGroup](https://ui.shadcn.com/docs/components/base/input-group);
calendar follows its [DayPicker-based pattern](https://ui.shadcn.com/docs/components/base/calendar).

Calendar adds pinned `@daypicker/react@10.0.2` (MIT), rather than a bespoke
calendar navigation/accessibility implementation. It transitively uses
react-day-picker, date-fns and @date-fns/tz. DatePicker values are local
YYYY-MM-DD strings, not UTC timestamps. TimeInput uses native local time.
Range/multi-date props remain DayPicker-owned; this batch verifies single dates.

Search consumers own filtering. NumberField reports invalid bounds without
silently accepting a commit; Slider exposes native accessible range inputs.
FileUpload validates empty/type/size selections atomically. Upload transport,
progress, errors and retry are caller-owned; never invent a progress percentage
or cancellation capability. FileUploadItem only offers actions with callbacks.

Host adopters include settings searches, plugin custom ratio fields, template
numeric sliders, work-item dates and avatar image upload. Professional editing
layouts remain unchanged. See `shared-ui-compact-controls.flow.mjs`: both runtime
modes plus real host components; work-item persistence callbacks and upload HTTP
responses are isolated, not a proof of production server writes.

Measured host runtime 1.6.0 on 2026-10-12: 1,115,281 bytes raw / 303,026 gzip,
versus 981,023 / 260,820 before this batch (+134,258 raw / +42,206 gzip).
This full-core cost is paid only by opted-in plugins; production business
scripts still do not bundle a second copy.

## Standard compositions (runtime 1.6.1)

Reuse primitives rather than inventing a component for each arrangement.
Field supports vertical, horizontal and responsive layouts. Responsive layouts
use the surrounding FieldGroup container query, not the viewport. FieldContent
groups a label and description; each editable control still needs its own
label association and explicit hint/error IDs. Required, disabled and invalid
states remain caller-owned; saving failures must not replace the draft.

```tsx
<FieldGroup>
  <Field data-invalid={Boolean(error)}>
    <FieldLabel htmlFor="name">名称</FieldLabel>
    <Input id="name" required aria-invalid={Boolean(error)}
      aria-describedby={error ? "name-help name-error" : "name-help"} />
    <FieldDescription id="name-help">填写可辨认的名称</FieldDescription>
    {error && <FieldError id="name-error">{error}</FieldError>}
  </Field>
  <Field orientation="horizontal">
    <Switch id="enabled" />
    <FieldContent>
      <FieldLabel htmlFor="enabled">启用</FieldLabel>
      <FieldDescription>即时生效的开关</FieldDescription>
    </FieldContent>
  </Field>
</FieldGroup>
```

InputGroup composes icons, text units, buttons and multiline footers. Keep addons
after the editable control in DOM order, use align to position them, and use
tabIndex=-1 for noninteractive text addons. Interactive buttons retain normal
Tab behavior and localized names. Clicking an addon focuses either input or
textarea without hijacking a child button. Counts are outside editable content
and referenced by aria-describedby; do not announce every keystroke as an alert.

```tsx
<Field>
  <FieldLabel htmlFor="description">描述</FieldLabel>
  <InputGroup>
    <InputGroupTextarea id="description" rows={3} maxLength={3000}
      value={draft} onChange={event => setDraft(event.currentTarget.value)}
      aria-describedby="description-count" />
    <InputGroupAddon align="block-end" tabIndex={-1}>
      <InputGroupText id="description-count">{draft.length} / 3000</InputGroupText>
    </InputGroupAddon>
  </InputGroup>
</Field>
```

Action groups compose Button with DropdownMenu, or SearchField with Popover/
Select filters. Use a named role=group, flex-wrap and a shrinkable search area.
Do not declare role=toolbar unless implementing its keyboard navigation.
Keep primary actions visible, disabled items non-executable, and Escape focus
restoration owned by the existing overlay. Domain-specific timelines, canvases
and property layouts are not replaced by these recipes.

Adopters: avatar name/description/action group, voice search/filter, storyboard
asset search/footer and plugin-library search/filters. `shared-ui-compositions`
checks labels, linked errors, draft retention, multiline counts/addon focus,
menus, dark/narrow containers and real components with isolated service data.

## Async feedback recipes

Compose existing Skeleton, Empty, Alert/AlertAction, Button and FileUploadItem;
there is no new generic async state machine or runtime API.

- Initial loading: announce status and aria-busy; skeleton only if nothing usable
  exists. A refresh retains last confirmed content, selection and input.
- Empty: show only after a successful empty response. Filtered no-match uses a
  clear/reset action; genuinely empty data offers import/create, not retry.
- Failure: show a scoped persistent Alert with the request's cause and real retry.
  Never reinterpret a failed request as an empty list. Keep the draft and files.
- Retry: reuse the same operation/file, guard duplicate in-flight requests, and
  do not clear old successful data before receiving a new response.
- Success: update with actual returned data and release busy state. Inline
  status is sufficient; do not invent percentages or equate a toast to acceptance.
- Upload: FileUploadItem shows only real available actions/progress. Failed
  storyboard imports keep the same File for retry and preserve current assets.

Adopters: voice library refresh/loading/empty/retry and preset no-match reset;
storyboard asset no-match/import recovery; avatar upload uses the existing
same-file recovery. Providers and file services stay in their current owners.
Proof flow: `shared-ui-async-feedback`; delayed/failing service responses in
its fixture are explicit simulations, not proof of paid provider or disk writes.

## Controlled table compositions (runtime 1.7)

The existing `/table` and `/core` now export TableSortHead, TablePagination,
TablePageSelection and TableBulkActions. Use `requireRuntime(1, required, 7)`.
Existing Table markup/density remains unchanged. No additional dependency or
data-fetching/state-machine implementation is introduced.

TableSortHead takes direction (none/ascending/descending) and a next-direction
callback, applies aria-sort to its th and uses a compact keyboard button.
TablePagination takes zero-based pageIndex, positive pageSize, nonnegative total,
localized labels and controlled callbacks. The caller must provide valid page
bounds and available page sizes, clamp after total changes, and reset pageIndex
when changing page size or filters. Unknown cursor totals need a separate caller
pagination presentation; do not invent exact page counts.

TablePageSelection receives counts only for the selectable current page.
It shows mixed state and disables an empty page; it never selects unseen rows.
Selection must use stable IDs, persist across pages and clear when the filter
scope changes. Sorting does not invalidate stable-ID selections.
TableBulkActions renders selected count/actions; business callbacks, confirmation,
busy state and partial failure handling are caller-owned. Compose AlertDialog,
snapshot selected IDs on confirmation, disable conflicting controls while busy,
remove successful IDs and retain failed IDs for retry. Never retry successes.

Compose SearchField/Select for filters, Empty for confirmed no-match with reset,
and Alert for retryable reads. Remote queries must sort/filter before pagination
on their owning server; sorting a fetched page is not full-collection sorting.
During a page request, retain the last confirmed rows and page metadata; accept
only the latest request. Small bounded local collections can use local processing.

The executable sample in `shared-ui-core-fixture.mjs` simulates a complete
23-item service in memory; it is not a production data engine. Its standard
controls are the real public implementations. Open the current dev client's
`/@fs/<repository>/evals/support/shared-ui-core.html?mode=host&table=1`.
Batch changes affect only this isolated sample, never user files or tasks.
`shared-ui-table` proves bundled/host sorting, filters, pages, selection,
confirmation/cancel, read failure and partial batch recovery.

Measured 1.7 host runtime: 1,117,754 raw / 304,119 gzip bytes, versus
1.6.1's 1,115,327 / 303,032 (+2,427 raw / +1,087 gzip); no dependency added.
Proof: `evals/results/2026-10-12T05-18-08-985Z/fraimz.html` (16 frames).
