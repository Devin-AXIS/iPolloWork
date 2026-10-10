# iPolloWork Local HyperFrames

This directory vendors the HyperFrames source used by iPolloWork's embedded
Video Studio iframe.

- Upstream: https://github.com/heygen-com/hyperframes
- Upstream runtime baseline: [v0.8.140](https://github.com/heygen-com/hyperframes/releases/tag/v0.8.140), commit `5c7f631`, released 2026-10-07
- Previous baseline: v0.7.60, `f3d21006633014fcb29b7a51571cd50ce832fed3`
- License: Apache-2.0, retained in `LICENSE`

The iPolloWork desktop bridge starts `packages/cli/bin/hyperframes.mjs` from
this local checkout instead of downloading `hyperframes` with `npx`. The iframe
URL contract stays the same: `http://localhost:<session-port>/#project/<id>`.

To rebuild after changing Studio styles or UI:

```bash
cd vendor/hyperframes
bun install --frozen-lockfile
bun run build:local-studio
```

The local build intentionally targets the Studio/CLI path used by iPolloWork.
Repository docs, release plans, examples, and other upstream-only materials are
not vendored here.

## 2026-10-08 upgrade ownership

This remains the embedded iPolloWork fork. The compiler, runtime, parser,
capture/producer pipeline, SDK and upstream registry additions use v0.8.140.
The established Studio UI and desktop bridge remain locally owned so that
Chinese localization, script planning, semantic motion, image/avatar workbench,
host themes and host history keep their existing contracts. The editing,
project history, external-change coordination and thumbnail infrastructure now
use upstream owners beneath those existing UI surfaces.

| 原有功能 | 升级后使用的官方方案 | 保留的兼容接口 |
| --- | --- | --- |
| 时域运动模糊与像素混合 | `engine/services/motionBlur.ts`、`frameCapture.ts`、`utils/alphaBlit.ts` 和官方 producer capture pipeline；包括视频子帧采样处理 | 原有 `motionBlur: true` 对应 4 次采样、180° 快门、线性混合；普通 PNG 采样保留不透明输出背景，透明导出继续保留 alpha。 |
| 字体变量回退、解析和嵌入 | `core/fonts/deterministicFonts.ts`，通过 `@hyperframes/core/fonts/embed` 共用；删除 producer 中重复的旧字体实现 | 原有预览和导出共用官方字体嵌入逻辑，保留本地/系统字体及 CSS 变量回退。 |
| 删除元素后清除关联动画 | 官方 `removeElementFromHtml` / `removeElementWithGsapCascade` | 原有删除路由与编辑器入口保留；清理交给官方级联实现。 |
| 文件保存、版本冲突与批量编辑 | 官方 Studio Server 文件路由的原子替换、字节版本、写入回执和批量 CAS | 兼容原有语义动画、结构化文字、选择器隔离、位置路径偏移及 `inner-html`；Windows 备份失败时拒绝覆盖。 |
| 编辑事务与 SDK 会话 | 官方 cutover policy、事务验证/回滚、SDK reload 和写入身份登记 | 原有面板及主合成编辑范围保留；读取缺失文件会刷新文件树，事务失败不伪装成功。 |
| 自动保存与外部文件变化 | 官方 pending candidate、项目文件 writer、external-change coordinator 和恢复快照 | 保留未保存草稿；提供重试、使用外部文件、保留编辑器内容；不再按固定时间窗吞掉外部更新。 |
| 撤销/重做持久化 | 官方项目文件历史、claim/step、blob 内容校验和原子恢复 | 主应用主题变更仍经原桥接进入同一历史；旧 IndexedDB v1 记录只在链条与当前文件匹配时迁移，失败保留原记录并提示。旧客户端 reducer/writer 已移除。 |
| 文字、样式与导入字体 | 官方 `domStyleCommit`、SDK `rich-text` 事务和字体 CSS 生成 | 保留中文和原有背景 `cover`；CSS 属性规范化，自定义属性保留原名，同名字体的不同字重/样式分别登记。 |
| 时间轴与缩略图 | 官方 scheduler、lease、image/video decoder、clip index 和 viewport budgets | 原有 24px 紧凑时间轴保留；仅查询可视区和被固定的选中/拖动项，页面隐藏和滚动时暂停昂贵任务，接受写入后失效缓存。 |
| 音乐避让与音量包络 | 官方 `data-automation` 音量 lane，共用于原生预览与导出混音 | 原有事件 WAV、立体声位置、共享空间尾音和语言时间映射保留；新合成在 HTML 写入原生包络，既有 GSAP 调用字段保留，不与原生包络同时使用。 |
| 快速预览与画面检查 | 原有 `captureSize`/`outputSize` 适配接入新版 capture/encoder；原有 runtime review 接入官方缩略图入口 | 低分辨率采集按指定尺寸编码，保留色彩转换、奇数尺寸补边和手动编辑脚本；runtime review 返回即时 JSON，不使用图片缓存。 |

The v0.8.140 API/worker entrypoints and dependency changes are upstream-owned,
not a second rendering service. Optional cloud deployment packages remain
outside this local vendor's scope. New registry source files are upstream
distribution content; existing iPolloWork registry entries remain intact.

Verification receipts live in `evals/results/hyperframes-upgrade-20261008/`
and `evals/results/hyperframes-upgrade-export-20261008/`. They cover native
camera/reverse seeks, editable spring serialization, the current script modal
save/reopen journey, and measured 3840×2160 / 60 fps output through Studio API.

The editing migration receipts live in `evals/results/hyperframes-official-editing-script-20261008/`,
`hyperframes-official-history-20261008/` and `hyperframes-official-export-20261008/`.
They cover Chinese script save/reopen, real keyboard undo/redo after legacy
migration, outside filesystem updates, native volume automation in an encoded
video, capture/output scaling and uncached runtime review. The upstream modules
and their focused tests are vendored under their original owners; their size
is retained to preserve the upstream contracts rather than splitting a second
implementation. No additional runtime dependency is introduced.

## Motion capabilities and ownership

The public OneTake motion taxonomy was reviewed at
[`cf09bde`](https://github.com/feitangyuan/onetake/tree/cf09bde3e392c9aa32c4157f80cdbe1fa556685e).
Its source, instructions and assets are not vendored. The implementations below
reuse HyperFrames and iPolloWork contracts; equivalent intent does not mean
identical trajectories, timings or a copied renderer.

| Reference capability | Existing owner and integration | Current coverage |
| --- | --- | --- |
| word rise, letter drop, pop, masked lines, typing, ticks, lift exit | `core/src/motionPresetKeyframes.ts`, `structuredTextMotion.ts`, recipe-specific text timelines | Existing editable text/unit motion and stable GSAP seeks; bounce-card now samples the shared real damped oscillator rather than fixed bounce poses. |
| flying screens, cursor, press, squash/contact, impact split | Native `device-carousel`, `browser-walkthrough`, `flowchart-vertical`, text kinetic/particle tracks; GSAP Physics2D and MotionPath blocks | Reuse measured DOM paths, contact timing, deformation and ballistic motion. |
| container morph, gather and turning lockup | Existing `spatial-camera-suite` optional `container-morph` / `gather-lockup` | New: the same DOM card becomes its measured page rectangle; existing cards travel on staggered arcs into one shared cluster and growing ring. No scene swap masquerades as a morph. |
| iris, zoom-through, hop, ribbon and hard-cut words | Existing lens-focus/SDF iris transitions, camera push/focus presets, MotionPath, kinetic text/word-relay recipes | Reuse the appropriate distinct primitive. A wipe is not a container morph; a decorative shake is not a carried handoff. Keep a persistent subject where the story requires continuity. |
| operated camera, depth view/focus, whip, shake, deliberate drift, lattice | Camera presets, `spatial-camera-suite`, shader transitions, existing grid/depth planes | New optional `subject-follow-track` computes one camera from the moving featured card's actual layout. Original five shots and default remain unchanged. Existing per-plane depth/blur and deterministic shake remain available. |
| world/screen projection, tracked travel | Runtime DOM rectangles and camera transforms, runtime review carrier observations | Observe actual projected geometry. Do not infer a carried boundary or visual meaning merely from changing pixels. |
| native spring, magnetic return, precomputed mechanisms | `parsers/src/springEase.ts`, existing GSAP physics/path infrastructure | New shared `sampleSpringEase` reuses the existing oscillator; CustomEase, bounce-card and magnetic-snap share it. Critical damping and adjustable overshoot are supported. Sampled segments use linear timing, avoiding a second default easing over the physical curve. |
| light field, ripples and living material | Existing `shader-transitions` domain-warp/ripple/light-leak and `vfx-liquid-background` | Reuse real WebGL distortion and material waves. These are alternative light/material primitives, not an assertion that a wave shader reproduces the reference's silk noise. CSS depth blur is not temporal shutter blur. |
| continuous belt with a slowing internal clock | Existing `device-carousel`, optional `carouselMode=flow-belt` | New: a bounded analytic velocity integral drives the belt and its interior motion, so both accelerate/decelerate and stop together. Offscreen wrap is discrete; it never interpolates through the visible frame. Default `depth-tour` stays unchanged. |
| soft-body jelly / Verlet ropes | Existing extensible GSAP/timeline authoring path | Not made a mandatory runtime or a universal effect: these are material-specific simulations requiring actual attachment/shape input. Existing ballistic/path and spring motion cover current reusable UI/card needs. Do not claim a jelly or rope simulation from those substitutes. |

`data-ipw-carrier` identifies actual persistent subjects. Only an explicitly
required continuity boundary is evaluated as carried; cuts and readable holds
remain valid. The owning registry manifest supplies camera choices to Work's
component checker, so the host no longer duplicates its enum.

The executable `video-camera-direction` flow checks actual installed components,
all eight spatial variants in both themes, card/page geometry, gathered original
objects, shared belt clock, real serialized spring samples, reverse seeks,
local-image parameters and the existing nested export clock. Catalog/source
availability by itself is not end-to-end generation quality proof.

## Production integration and verification

| Capability | Existing owner and contract | Verification / boundary |
| --- | --- | --- |
| Measured reference rhythm | Work `video_reference_analyze` reads local video with ffprobe and bounded low-resolution decoded frames/audio. | Reports real cadence, still intervals, activity and audio peaks; it does not label pixel changes as optical flow, semantic quality or shutter smear. Full-frame sampling is bounded to 30 seconds / 1,024 frames. |
| Persistent subjects and deterministic seeking | `video-render.ts` and Studio runtime screenshot review observe actual DOM identity, rectangles, transforms and visibility. | Only `data-ipw-continuity="required"` demands a carried subject. Ordinary cuts and reading holds remain valid. Direct/reverse state comparison covers DOM state, not Canvas/WebGL pixels. |
| Temporal motion blur | Existing core subframe seek, engine capture and producer render paths; optional `motionBlur: true`. | Four samples across a 180-degree exposure are averaged in linear light with premultiplied alpha. Holds and cut boundaries stay crisp. Normal editing seeks are unchanged. HDR and transparent shader combinations are explicitly rejected; SDR shader composition is supported. |
| Exact export settings | Existing Work render input and Studio/CLI adapters pass fps, aspect-preserving resolution and motion blur to the producer. | Actual Studio API export is decoded at 3840×2160 / 60 fps. Authored CSS size and output pixel ratio are applied once. A receipt distinguishes requested settings from measured output. |
| Event sound and shared acoustic space | Work `video_soundtrack_prepare` generates separate editable WAV clips or processes local licensed assets, with event strength, position and a common room tail. | Speech and event windows drive one bounded music-volume envelope through official native audio automation and mixer. No new player, transport or audio service. Source provenance remains in the storyboard. |
| Language variants of one composition | Work `video_language_timing_prepare` validates exact narration files, ordered measured word sidecars and explicit phrase pairs. A composition-local film wrapper maps its paused visual author timeline and native children; narration stays at normal speed. | Source-language identity, direct/reverse pixels, suppressed/parent seeks, camera callbacks and zero-duration event counts are checked. Caption and sound windows use the same anchors. Native proof uses measured local TTS chunk fixtures, not a new live provider alignment call or a listening review. |
| Product UI and creative selection | Video plugin compose/storyboard references reuse actual supplied captures, real browser views and editable native components. | Concepts follow content and design variables; templates are optional. A fake button animation is not evidence that the real product works. Read only the references needed for the current stage. |

OneTake is a reference for capabilities, not a runtime dependency. Its upstream
license is PolyForm Noncommercial 1.0.0; no upstream implementation, instruction
text or assets are included. Owning plugin references and checked distribution
copies use the same content. The host exposes validated tools; creative rules
stay inside the video plugin.

Nine native relationship/data recipes had two competing opacity writes at
time zero. Their generic transform reset now leaves opacity to each target's
own tween. Cold seeks, reverse-to-zero and event callbacks are tested; their
established middle/end frames remain pixel-identical. Both PNG and JPEG
screenshots use CSS clip dimensions and viewport DPR once, including a reused
probe session. Rebuild the bundled CLI after engine/producer changes: its
embedded capture code is the actual desktop renderer.

Local proof artifacts are under `evals/results/onetake-capabilities-2026-10-03/`,
`onetake-motion-capabilities-2026-10-03/`, `onetake-reference-quality-20261003/`
and `video-onetake-absorption-2026-10-03/`. They cover render, runtime and helper
behavior; they do not establish a fresh GPT-generated film's artistic quality.


## Official Studio workbench integration (2026-10-08)

The workbench remains pinned to HyperFrames 0.8.140. The eight groups in
`HyperFrames新版功能与iPollo视频工作台优化建议.docx` are integrated into the
existing editor and mutation/history owners, with no new runtime dependency.

| Requested behavior | Official implementation reused | iPollo integration retained or added |
| --- | --- | --- |
| Select/Razor, thumbnails, fit, collapse | Player active tool, thumbnail mode, viewport zoom, Dock controller | Chinese controls and short-composition fit; the fit button highlights the active mode and explains the whole-composition extent. The duplicate split-at-playhead toolbar button is removed by user request; Razor and the existing S shortcut retain splitting. Video/image decoding stops when thumbnails are hidden. |
| Layers and nested compositions | Existing timeline hierarchy, expansion and composition stack | Script rows locate their actual scene id/source, reveal its clip and seek without rebuilding a second timeline. |
| Visual keyframes and animation parameters | GSAP parser/cache, official keyframe writer, GsapAnimationSection | Independent Visual row, source badges and an animation-segment click opens the official start/duration/easing editor. Custom motion presets remain accessible. |
| Workspace layout | Upstream Dockview panels, layout schema, persistence, resize/accessibility, visibility and reset | Preview and Timeline share the left column; the full-height right inspector owns Assets, while Script keeps its top view. The Code tab is removed by user request. The existing tools menu owns Timeline collapse/expand and reset; essential closed panels recover on reload. Native title rows and the redundant Workspace menu are hidden. |
| Gain/fades | Upstream TimelineClipFades, fade geometry and keyboard/pointer interaction; native data-volume/data-fade-in/data-fade-out | Existing DOM SDK transaction/history owns writes, rollback and undo/redo. Gain and fades audition live and persist through the same source used by export. |
| Object/region/range AI | Official element and timeline prompt builders and AskAgentModal | Existing validated host Ask AI bridge; source locator, exact seconds and normalized frame coordinates. The region UI is an adapter because upstream does not provide the iPollo host interaction. Component semantic data is preserved in object requests. |
| Component previews | Upstream registry preview document and existing PreviewController lifecycle | Temporary transparent preview over the current canvas, explicit preview badge, pointer/focus leave restores, click/Enter inserts through the existing block writer. Unsupported browser features show a reason. |
| Manual keyframe result | Official add/replace-with-keyframes and explicit point editing | New manual tweens carry GSAP data metadata, visible element/property/time markers and honest write feedback. Manual points are added with the diamond/K control; selecting a timeline point edits that point, while ordinary edits adjust the whole animation. Automatic keyframe mode and its state are removed by user request. |

The animation strip badge describes its owning tween. New points recorded by
manual capture or property/drag edits also carry GSAP-reserved `data` metadata,
so diamonds distinguish them from endpoints imported with a preset. Both native
writers and parsers preserve it; display/property capture excludes this metadata.
Historical imported points without provenance retain their owning origin rather
than inventing an author's history. Visual rows can be folded independently;
keyframe seeks round to milliseconds and region drafts cancel when the project,
composition or playhead changes. The official composition stack is wired to
clip double-clicks, normalizes Windows source paths, and saves each parent-local
playhead for returning from any nesting depth (including time zero). Capturing a
point isolates shared targets through the existing official source mutation;
private stable-id targets expose the same native animation controls. Extending
a converted tween keeps its original segment easing and precise endpoint time.
Success feedback requires a persisted point at the playhead, not merely a saved
conversion. A rejected file write leaves capture disabled and can be retried.

Registry templates and their generators register timelines with the authored
composition id as a fallback after the official compiler flattens an inner
root. The upstream scoped-window proxy maps this id to each mounted instance;
this preserves independent animation clocks without modifying the compiler.
Registry installation normalizes Windows file paths to forward slashes at the
HTML source-URL boundary. Existing component variables, theme aliases and user
catalog additions retain their contracts. Actual nested exports verify this
registration, in addition to catalog and installer regression tests.
Bundled installation also uses the official prepared-item publication, lock
record and atomic file replacement. Reusing an edited or older component keeps
its source; only newly published files receive runtime normalization. Custom
registries and project install paths use the upstream `addToProject` owner,
including dependency ordering and the primary composition path. Visual component
mounts opt into the existing iPollo contain-fit adapter: their original pixel
dimensions remain intact and GSAP transforms keep working inside resized hosts.
Upstream 0.8.140 has no equivalent automatic aspect-fit behavior for these host
mounts, so this adapter remains. The CLI test config's missing home-isolation
helper is restored verbatim from the same upstream release.
Repeated visual mounts carry the official authored-composition identity beside
their unique DOM ids, so the native compiler and runtime assign independent
instance clocks while preserving the inner root and contain fitting. The Studio
loading adapter reads the official player's per-document `ready` state: a late
iframe load cannot reopen a stuck overlay, and a new document still shows loading.
Existing user catalog additions are included in contract checks. The legacy
`product` category resolves to `business`, keeping workflow cards searchable and
insertable without overwriting their manifests or introducing another category.

Narration, branding/theme, asset import, custom semantic motion recipes, nested
composition clocks, source SDK transactions, history and export retain their
existing owners. New dock/fade modules over the normal size guideline are exact
upstream component/test owners; splitting them into parallel implementations
would break their contracts. Host narration, avatar and theme overlays follow
the official dock content rectangle, including maximizing and changing position;
old width-only requests retain their existing default placement.

## Workbench conflict cleanup

Assets has one entry in the right inspector. Existing `tab=assets`
links and Ctrl/Cmd+2 reveal Assets there; Ctrl/Cmd+1 opens the top-level script
view. The removed left column no longer duplicates that script view. The user
removed the right Code page; its tab, rendered source-panel wrapper and automatic
source-opening callback are removed together. Legacy Code deep links resolve to
the inspector instead of a blank page. File/media and source-writing services
remain available to Assets, script/element editing and SDK transactions;
background lint and runtime diagnostics remain active. Dockview's native header visibility
reclaims the Preview, Timeline and Properties title rows while retaining native
layout, resizing and persistence. Saved layouts containing removed dock panels
are rejected by the existing panel schema and rebuilt without touching projects.
The right inspector uses a native root-edge column spanning Preview and Timeline.
Saved top-row inspectors migrate through native group movement, preserving their
width and visibility; close/reopen and reset use the same placement. Preview and
Timeline keep their native vertical splitter in the left column. The canvas
annotation button is inset 16px from the top and left edges.
The restored Control tools menu controls Preview, Timeline and Properties with
native dock group visibility, preserving the mounted preview and saved layout.
Restoring all hidden groups recovers the inspector width and timeline height
through native sizing APIs, avoiding an oversized inspector column.
It also provides native layout reset. Collapse/expand Timeline and reset layout
remain reachable in the existing Shortcuts and tools menu. Its native top-layer popover escapes the
timeline panel's overflow clipping and supports Escape dismissal. When Timeline is hidden, that tool moves back
to the preview transport; resetting the dock rebinds its toolbar slot. Saved
layouts that closed Preview or Timeline are rebuilt; collapsed groups and a
closed right inspector remain valid without changing composition files.
Thumbnail content subscribes to the native thumbnail preference; authored media
metadata participates in the existing timeline equality check. Explicit runtime
rebinds publish the native timeline payload even when duration is unchanged, so
soft undo/redo refreshes audio handles without remounting the preview. Ask AI
draft and context fields use the existing light/dark panel tokens. Submitted
canvas, element and time-range edit requests enter the current left conversation
through its normal draft dispatcher, carrying the existing selection context;
the canvas selection toolbar and inspector reuse the official instruction modal,
as do timeline range editing and catalog component requests. Catalog requests
retain the component contract, semantic data, duration and preview references;
direct insertion and preview still use the native catalog path. Pending requests disable repeat submission and
closing; errors retain the draft with an inline reason, and host acceptance shows
the same left-conversation receipt. Canvas annotations keep their inline input
with the same pending, receipt and retry contract. Selection-only integrations
still stage a composer chip. The host acknowledges actual
dispatch acceptance, with errors preserving the request. Conversation and
workspace identity plus iframe source/origin are checked before dispatch.
Preview duration comparison uses the official frame alignment contract: exact
audio seconds and an upward-rounded video frame must not select silent seek-only
playback. A usable native runtime takes precedence over the legacy carousel clock.
The native dock owns visibility, placement, resizing and saved layouts. The
unused sidebar width/collapse and inspector split state are removed.

The active property inspector remains intact; its permanently disabled classic
branch and four exclusive helper components are removed. The unused classic
text renderer is removed from the shared text-fields module. Shared text, 3D,
grading, audio, motion and editing helpers remain. The component library and
animation recipe library keep their original specialized behavior.

The shared normalized panel-bounds schema validates embedded overlay geometry.
Studio measures the actual content slot and republishes through ResizeObserver,
native dock layout events and coalesced animation frames. The host reuses those
bounds for voice, avatar and theme content while keeping script dialogs separate.
Dock colors consume the existing Studio light/dark tokens rather than unresolved
upstream palette names. Development composition files use the upstream independent Chokidar watcher
and preview-change ownership rather than Vite's full-page HTML reload. The
same watcher feeds preview signatures and the existing project history; source
write receipts and dependency-aware refresh remain owned by the official server.
Dev thumbnails reuse the renderer engine's public managed-browser resolver.
Version diagnostics read the launched browser through CDP; Windows GUI Chrome
is never started synchronously for `--version`, which can block every API and
lazy-loaded editor panel indefinitely. Other CLI probes have a bounded timeout;
unsupported browsers are closed and rejected after launch. Existing explicit
paths, Puppeteer Chrome caches and system installs remain supported.
No dependency, service, route or persistent store is added.
Script-to-timeline navigation resolves official scene identities and repeated
component hosts; legacy unbound scripts require a unique scene with matching
frame-aligned timing. Ambiguous or unsaved scripts do not navigate to guessed
clips. Each shot exposes its overlapping picture/audio tracks, including shared
media, through the same native selection, ancestor expansion, reveal and seek
requests. Shared-lane controls follow the selected clip or playhead. Double-click
expands same-document groups; external compositions retain native drill-down.
Focused navigation tests protect legacy deep links and native visibility without
adding a second layout implementation. Earlier conflict-cleanup proof:
`evals/results/hyperframes-conflict-cleanup-20261008/`.

Verification covers actual bundled Studio UI edits and source files, focused
component/route tests, TypeScript and production builds. Local proof is saved in
`evals/results/hyperframes-official-workbench-20261008/fraimz.html` and the
follow-up `evals/results/hyperframes-workbench-recheck-20261008/fraimz.html`. Standalone
AI requests are verified as clipboard prompts; embedded delivery uses the
existing origin/source/path-validated host bridge. No claim is made that a live
model/provider completed an editing request in this proof.
