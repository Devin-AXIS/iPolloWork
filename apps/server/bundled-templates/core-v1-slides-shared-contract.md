# Shared Contract · core-v1 Slides

- Retain the fixed 16:9 canvas. Layouts supply structure and do not override active theme values.
- Semantic `--ipw-*` values come from the target template's `design-tokens.css` or entry styles. Library preview defaults are for inspection only and must not be copied into the deliverable.
- Preserve matching `data-pptx-text`, `data-pptx-shape` and `data-pptx-image` markers under the native editable PPT contract.
- Each reusable page root is one `section` with `data-ipw-slide`, `data-title` and `data-layout`.
- `data-slot` identifies content mapping, not hard content limits. Real capacity depends on fonts, size, leading, assets and available space; consult `layout.md` and measure actual content.
- Copy the section and necessary scoped layout CSS, including applicable baseline rules. Do not copy preview `body`, default colors, `main` or scripts.
- Verify long Chinese headings, real image proportions, contrast and exported editability in the final template or artifact.
- Visual-slot examples do not constrain final media types. Replace them with suitable images, editable charts or shapes and correct markers. Layout selection cannot bypass required asset assessment or capability queries. Adjust or create a structure when imagery needs a different region.
