<!-- Distribution reference: maintained in .codex/skills/ipollowork-template-generation/references/; checked against the source by plugin-package-manifest.test.ts. -->

# Design Type Routing

Use only the active type reference below and applicable sections of the [shared guidelines](shared-guidelines.md). The session contract, manifest category, editable path and actual export capabilities are authoritative. Do not ask the user to choose an internal category when the task is clear.

## Task scope and reading

Read the current source, tokens and confirmed request first. Copy, selected-element and theme-only edits need only the affected type's rules; do not reload narrative, layout or media guidance for unchanged work. Theme-only edits preserve content, geometry, assets and runtime hooks. If a supplied selection no longer resolves, stop without changing the file and request a new selection.

For initial/full authoring or structural changes, consult the relevant shared content, visual-identity and layout sections, then the matching category. For asset work use the shared media section; initial/full authoring calls `media/artifact_media_review` with `phase="plan"` before layout and `phase="check"` after placement. A local/theme edit with unchanged media and valid existing assets needs no new plan or generation request. Reuse prior guidance and completed checks until the scope or evidence changes. Type references' shared-guideline prerequisites mean applicable sections, not a requirement to load every rule for every edit.

## Content-led authoring

Extract the existing typography, palette, spacing, shapes and artwork before composing. Match each section to its purpose—comparison, steps, evidence, case study or key message—and reuse, adapt or create structures from those primitives. Add, remove, reorder or repeat patterns when real content requires it; preserve exact layout only when explicitly requested or agreed. Recompose dense material without deleting facts or shrinking all text, and avoid unjustified repeated card grids or decorative variation.

When choosing layouts for a declared slide/site library, read its project-local index and active-type catalog, then shortlist at most three fitting candidates. Open source only for those candidates; a new layout remains valid if none fits. Copy structural fragments and scoped styles without preview hosts, sample palettes or scripts. Retain current tokens and each type's runtime: responsive flow for websites, fixed canvas and supported editable markers for PPT, separate timed playback for Video. A saved custom template without a catalog supplies local patterns; uploaded sources and screenshots provide only the evidence actually available, not proof of editable import or export fidelity.

For websites, `media/artifact_preview_review` with `kind="site"` is the sole client batch preview. Do not start a server, helper preview HTML or generic browser screenshots/tabs. Follow the active category's checks, review affected content and repair observed defects together; shared style/token changes require a whole-artifact batch recheck. Media review, catalog validation, source checks and rendered/export evidence prove different things. Missing client or export access means that check is unverified, not passed.

| Manifest category | Scope | Type reference or handoff |
| --- | --- | --- |
| `site` | Websites, landing pages and portfolios | [Website](design-site.md) |
| `app` | Application screens, dashboards and interactive prototypes | [Application](design-app.md) |
| `slides` | HTML presentations and native editable PPTX | Use `ipollowork-presentations`; repository template authors read `slides-ppt.md` and `layout.md` |
| `poster` | Posters, banners and single-canvas promotional designs | [Poster](design-poster.md) |
| `cards` | Social carousels and shareable information card series | [Cards](design-cards.md) |
| `report` | Reports, research summaries and data-led documents | [Report](design-report.md) |
| `article` | Editorial pages, long-form reading and WeChat articles | [Article](design-article.md) |
| `other` | Designs with no fitting existing category | [Other](design-other.md) |
| `video` | Timed compositions on the Video surface | Use `ipollowork-video-studio`; repository template authors read `video.md` |

Landing, social, email and image are not additional manifest categories. Route landing pages to `site`, social card sequences to `cards`, and single promotional visuals to `poster`. Reading-oriented newsletters belong to `article`; actual email delivery also needs the compatibility checks in `design-other.md`. Generated image assets use media Skills. Preserve existing manifests; do not silently recategorize a user's project.

For mixed artifacts, use the primary deliverable's rules and consult only relevant secondary sections. An embedded chart does not turn a website into a report; a dashboard screenshot does not make a poster interactive.

## Design boundary

The shared guidelines own project preservation, media policy, layout extension and verification levels. The active category reference adds only its medium-specific structure, behavior and acceptance checks. A type reference never proves automatic enforcement or a completed export.
