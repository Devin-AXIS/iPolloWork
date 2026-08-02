# Shared Template Authoring Contract

The service implementation in `apps/server/src/templates.ts` and shared schemas in `packages/types/src/templates.ts` are the hard truth. This reference explains the creative workflow; it does not replace validation.

## Package Shape

```text
template-id/
|-- manifest.json
|-- entry.html or index.html
|-- design-tokens.css
|-- cover.svg or another declared cover
`-- assets/ optional
```

Keep `manifest.json` synchronized with the actual category, surface, entry, cover, source, design-system data, reusable variables, PPT/video metadata, and apply checklist. Never put session-only `brief.json`, captures, exports, or renders in a saved template.

## Reusable Variables

- Use manifest design-system variables for genuine `--ipw-*` visual tokens present in `design-tokens.css`.
- Use HyperFrames variables for reusable Video content or render controls and declare the same IDs in the composition document.
- Keep IDs stable, descriptive, unique, and correctly typed.
- Do not expose a control that is absent from the selected design system or composition.
- Prefer a small set of high-value controls over mirroring every literal.

## Design-System Layer

The entry has exactly one marked stylesheet link after inline style blocks:

```html
<link rel="stylesheet" href="design-tokens.css" data-ipw-design-tokens>
```

The managed token block contains selected-theme values and stable mappings. Structural CSS remains template-owned outside it. Components consume semantic `--ipw-*` tokens for colors, typography, spacing, radii, borders, and shadows.

Never theme geometry with broad `img`, `svg`, icon, slide, composition, or media selectors. Theme switching must not resize logos, icons, stages, clips, media, or composition roots.

## Cover And Checklist

- Prefer a meaningful 960 x 540 user cover showing the reusable template, without transient editor chrome.
- If no valid cover exists, the save pipeline generates the standard SVG cover.
- Maintain an apply checklist that tells the next user which copy, variables, media, and structure require attention.

## Validation And Re-instantiation

Run the shared product validator. A package is complete only when it validates, saves under a new `personal.*` ID, materializes into a separate session, opens the correct editor, preserves editable variables and theme behavior, and leaves the source project and source template unchanged.
