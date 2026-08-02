# Slides And Native PPT Rules

Use for Presentation and native editable PPT. The application-selected PPT mode is authoritative.

## Shared Slides

- Use a fixed 16:9 stage and recognized `data-ipw-slide` roots.
- Keep slide roots, order, count, and object geometry stable unless the user explicitly changes the story.
- Tokenize text, fills, borders, shadows, and decorative styling without moving objects.
- Keep copy concise enough to fit the fixed stage and verify long text does not overflow.

## Native Editable PPT

- Preserve `data-pptx-text`, `data-pptx-shape`, and `data-pptx-image` markers on every object that must remain editable after export.
- Keep marked objects structurally simple and their bounds deterministic.
- Do not flatten editable text or shapes into screenshots.
- Validate both the slide document and editable marker coverage before saving.

Theme switching must never alter stage dimensions, slide roots, PPT object markers, or export eligibility.
