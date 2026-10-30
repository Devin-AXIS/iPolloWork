---
name: ipollowork-design-web
description: Create or edit websites and application interfaces in the current iPolloWork Design session.
---

# iPolloWork Websites and App Interfaces

Use for manifest category `site` or `app`; route other categories through `ipollowork-design-studio` before editing. Do not recategorize.

Use the injected exact source inside `design/<session-id>/`; read it and `design-tokens.css`. Preserve `--ipw-*` tokens/variable bindings, component IDs, editable/locked markers, runtime and selected scope. A stale locator requires a new selection before editing. Theme-only edits preserve content/assets/geometry. The host owns preview/export; no replacement project, preview host or application-source edits.

Use only [Website rules](../ipollowork-design-studio/references/design-site.md) for `site`, or [Application rules](../ipollowork-design-studio/references/design-app.md) for `app`.

Targeted copy/selection/theme edits read affected type sections only; skip catalogs and unchanged layout/media guidance. Creation/structural work reads applicable content/style/layout sections of [Shared guidance](../ipollowork-design-studio/references/shared-guidelines.md); catalogs are for layout selection. Asset work uses its media workflow; initial/full authoring plans before layout and checks saved placement. Valid unchanged local/theme assets need no new plan/generation.

Follow active type acceptance through the supported host surface; `site` uses `media/artifact_preview_review` with `kind="site"`. Shared style/token changes require whole-artifact rechecking. Verify affected editing/interaction and requested supported exports; disclose unavailable/unperformed checks. Resolve installed links once; report missing references without searching other checkouts.
