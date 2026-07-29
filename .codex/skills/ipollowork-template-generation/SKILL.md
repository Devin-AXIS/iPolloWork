---
name: ipollowork-template-generation
description: Generate new iPolloWork HTML templates for web pages, PPT/slides, and HyperFrames video that are compatible with the project's design-system theme switching and variable-control UI from the start. Use when AI creates bundled templates, batch-generates template HTML, writes template prompts/specs, or updates template-generation rules so produced HTML consumes --ipw-* tokens without breaking layout, slide structure, animation, timing, icons, or media geometry.
---

# iPolloWork Template Generation

Generate templates that are theme-ready on first output. Treat the design system as a stable token layer that can change colors, typography, spacing, radii, and shadows without rewriting the DOM or changing geometry.

## Required References

- Read [references/template-generation-contract.md](references/template-generation-contract.md) before creating or updating a template.
- Run `node scripts/audit-template.mjs <template-directory>` after generating or changing a template.
- For converting or auditing an existing template, also use `$ipollowork-themeable-template` and run its audit workflow.

## Generation Workflow

1. Classify the requested template as `web`, `slides`, or `video`.
2. Create the normal template package:
   - `manifest.json`
   - `entry.html` or `index.html`
   - `design-tokens.css`
   - local assets only when needed
3. Put exactly one marked stylesheet link after all inline `<style>` blocks and before `</head>`:

```html
<link rel="stylesheet" href="design-tokens.css" data-ipw-design-tokens>
```

4. Add `designSystem` metadata to `manifest.json`:

```json
{
  "designSystem": {
    "tokenVersion": 1,
    "tokens": "design-tokens.css",
    "editableGroups": ["theme", "background", "typography", "components"]
  }
}
```

5. Define stable semantic `--ipw-*` variables in `design-tokens.css`. Put selected theme values inside the managed block:

```css
/* ipw-theme:start */
/* ipw-design-system: default */
:root {
  --ipw-color-bg: #ffffff;
  --ipw-color-surface: #f8fafc;
  --ipw-color-text: #111827;
  --ipw-color-muted: #64748b;
  --ipw-color-border: #e2e8f0;
  --ipw-color-primary: #2563eb;
  --ipw-color-secondary: #0f766e;
  --ipw-color-accent: #7c3aed;
  --ipw-color-on-primary: #ffffff;
  --ipw-font-display: Inter, ui-sans-serif, system-ui, sans-serif;
  --ipw-font-body: Inter, ui-sans-serif, system-ui, sans-serif;
  --ipw-type-scale: 1;
  --ipw-body-line-height: 1.55;
  --ipw-content-width: 1080px;
  --ipw-page-padding: 32px;
  --ipw-section-space: 80px;
  --ipw-button-radius: 8px;
  --ipw-card-bg: var(--ipw-color-surface);
  --ipw-card-border: var(--ipw-color-border);
  --ipw-card-radius: 14px;
  --ipw-card-shadow: 0 12px 32px rgb(15 23 42 / 10%);
}
/* ipw-theme:end */
```

6. Write component CSS so visual style consumes tokens directly:
   - backgrounds: `--ipw-color-bg`, `--ipw-color-surface`, `--ipw-card-bg`
   - text: `--ipw-color-text`, `--ipw-color-muted`, `--ipw-color-on-primary`
   - accents/actions: `--ipw-color-primary`, `--ipw-color-secondary`, `--ipw-color-accent`
   - borders/shadows: `--ipw-color-border`, `--ipw-card-shadow`
   - typography: `--ipw-font-display`, `--ipw-font-body`, `--ipw-type-scale`, `--ipw-body-line-height`
   - adjustable details: `--ipw-page-padding`, `--ipw-section-space`, `--ipw-button-radius`, `--ipw-card-radius`
7. Preserve layout with template-owned CSS outside the managed theme block. Theme switching must not resize logos, icons, images, stages, clips, slides, or composition roots.
8. Do not expose hardcoded variable-control options. The control UI must derive editable variables from the selected design system's real token source.
9. Run the audit script:

```powershell
node .codex/skills/ipollowork-template-generation/scripts/audit-template.mjs <template-directory>
```

Pass `--surface web`, `--surface slides`, or `--surface video` when the manifest does not identify the surface clearly.
10. Validate by switching at least background, primary color, text color, radius, and spacing tokens mentally or with the app. The result must visibly change style while preserving skeleton and media geometry.

## Hard Rules

- Never use broad theme selectors that target `img`, `svg`, `button`, `[class*="icon"]`, `[data-ipw-slide]`, `[data-composition-id]`, or all cards in a way that changes dimensions.
- Never put themeable colors, fonts, radii, shadows, or spacing in inline `style` attributes.
- Never define `--ipw-*` variables in a later stylesheet or later `<style>` block after the token link.
- Never replace the whole `design-tokens.css` during theme application; replace only the managed block and preserve structural CSS.
- Never change slide count, PPT export markers, HyperFrames timing, tracks, clips, `data-duration`, animation keyframes, canvas dimensions, or fixed stage dimensions for theme reasons.
- Keep data visualization series colors fixed only when the color carries semantic meaning; otherwise map accents to tokens.
- Keep brand logos and raster assets content-owned. Do not recolor or resize them through the design-system layer.

## Surface Rules

**Web:** Use semantic HTML, responsive behavior, and tokenized visual CSS. Keep hover/focus states tokenized.

**Slides/PPT:** Keep fixed stage dimensions and all `data-ipw-slide`, `data-pptx-text`, `data-pptx-shape`, and `data-pptx-image` markers. Theme fills, text, borders, and shadows without moving objects.

**Video/HyperFrames:** Preserve composition IDs, `data-duration`, clip windows, tracks, variables, and deterministic animation. Theme scene visuals only; avoid CSS transitions or ambient infinite animation that changes rendered frames.

## Completion Standard

Report the surface, template files created or changed, token coverage, preserved structural constraints, audit command/result, and validation performed. If an existing artifact was converted, include the `$ipollowork-themeable-template` audit result.
