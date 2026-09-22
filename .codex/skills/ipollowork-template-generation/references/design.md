# Design Type Routing

Read the [shared guidelines](template-generation-contract.md#ipollowork-shared-creative-and-layout-guidelines), then only the active type reference below. The session contract, manifest category, editable path and actual export capabilities are authoritative. Do not ask the user to choose an internal category when the task is clear.

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

## Shared execution boundary

- Preserve project paths, semantic `--ipw-*` tokens, editor hooks and fixed brand regions. Initial generation adapts structure to content; targeted edits protect unrelated work.
- Apply shared asset rules to every type. A missing image slot or catalog does not remove a useful visual need. Type references add suitability checks, not competing model-selection or authorization policies.
- Read a layout library only when supplied by the session. Prefer fitting catalog or local patterns; extend when none fits. Do not invent catalog paths for categories without a library or require IDs for new structures.
- Inspect real content after fonts/assets load. Verify the requested output, not merely HTML source. Shared-style changes require checking every affected section/page.
- These references are guidance, not evidence of automatic enforcement or completed acceptance. Report source, rendering, interaction, editing and export checks separately.
