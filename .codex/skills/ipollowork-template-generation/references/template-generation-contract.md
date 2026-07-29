# iPolloWork Template Generation Contract

Use this contract when creating new templates so generated HTML works with iPolloWork design-system switching and bulk variable controls.

## Package shape

```text
template-id/
|-- manifest.json
|-- entry.html or index.html
|-- design-tokens.css
`-- assets/ optional
```

`manifest.json` must keep normal template metadata and include:

```json
{
  "designSystem": {
    "tokenVersion": 1,
    "tokens": "design-tokens.css",
    "editableGroups": ["theme", "background", "typography", "components"]
  }
}
```

Video manifests may also include content variables such as title, logo URL, narration, or scene text. Do not convert content variables into CSS tokens.

## Required stable tokens

Every new template must define these tokens in `:root`. Source design systems can map their own token names into this stable layer.

```css
:root {
  --ipw-color-bg: #ffffff;
  --ipw-color-surface: #f8fafc;
  --ipw-color-text: #111827;
  --ipw-color-muted: #64748b;
  --ipw-color-border: #e2e8f0;
  --ipw-color-primary: #2563eb;
  --ipw-color-secondary: #0f766e;
  --ipw-color-accent: #7c3aed;
  --ipw-color-success: #059669;
  --ipw-color-warning: #d97706;
  --ipw-color-danger: #dc2626;
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
```

Templates may add more `--ipw-*` tokens for real controls. Do not invent UI controls for variables absent from the selected design-system source.

## Managed theme block

Theme application may replace only this block:

```css
/* ipw-theme:start */
/* ipw-design-system: theme-id */
:root {
  /* selected design-system source tokens and stable mappings */
}
/* optional compatibility variables */
/* ipw-theme:end */

/* Template-owned structural CSS remains below or in the page CSS. */
```

Structural CSS includes fixed stages, icon and logo dimensions, media sizing, grid geometry, animation definitions, clip timing, and template-specific layout.

## Generation patterns

Prefer direct token usage:

```css
body {
  margin: 0;
  background: var(--ipw-color-bg);
  color: var(--ipw-color-text);
  font-family: var(--ipw-font-body);
  line-height: var(--ipw-body-line-height);
}

.cta {
  background: var(--ipw-color-primary);
  color: var(--ipw-color-on-primary);
  border-radius: var(--ipw-button-radius);
}
```

Use structural values for geometry:

```css
.brand-logo {
  width: 48px;
  height: 48px;
  object-fit: contain;
}
```

Do not theme geometry through broad selectors:

```css
/* Avoid */
img,
svg {
  width: var(--ipw-icon-size);
}
```

## Surface invariants

### Web

- Preserve semantic landmarks, links, forms, and scripts.
- Preserve responsive behavior.
- Tokenize page, surface, text, border, action, typography, spacing, radius, and shadow values.

### Slides/PPT

- Preserve fixed 16:9 stage dimensions unless the requested source explicitly uses another ratio.
- Preserve all slide and PPT export markers.
- Theme text, fills, borders, and shadows without moving objects.

### Video/HyperFrames

- Preserve `data-composition-id`, dimensions, duration, tracks, clips, sub-compositions, variables, and timeline keys.
- Keep framework-owned media playback and deterministic animation.
- Do not add non-deterministic CSS transitions or infinite ambient animation for renderable frames.

## Review checklist

- `manifest.json` points to `design-tokens.css`.
- Entry HTML has exactly one `data-ipw-design-tokens` stylesheet link after all inline styles.
- Stable `--ipw-*` tokens exist.
- Visual CSS consumes tokens.
- No later CSS or inline style defeats the tokens.
- Theme switching changes visual style without changing skeleton, icons, logos, media geometry, slide structure, or video timing.
- Bulk controls can be derived from the selected design-system token source.
