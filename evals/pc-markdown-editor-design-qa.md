# Design QA — PC Markdown editor

## Visual truth

- Source interaction reference: `/tmp/codex-remote-attachments/019f521e-ff71-7512-9dcc-f19185aa32a3/445D2B30-BA93-4850-B8DE-4E0D2F3E865F/1-照片-1.jpg`
- Source selection reference: `/tmp/codex-remote-attachments/019f521e-ff71-7512-9dcc-f19185aa32a3/445D2B30-BA93-4850-B8DE-4E0D2F3E865F/2-照片-2.jpg`
- Implementation: `evals/results/2026-07-12T09-00-09-455Z/pc-markdown-editor-02-pc-markdown-slash-menu.png`
- Rich blocks: `evals/results/2026-07-12T09-00-09-455Z/pc-markdown-editor-05-pc-markdown-rich-blocks.png`
- Image editing: `evals/results/2026-07-12T09-00-09-455Z/pc-markdown-editor-06-pc-markdown-image-editor.png`
- Side-by-side comparison input: `/tmp/pc-markdown-editor-comparison.png`

## Target state

- Viewport: 1180 × 780 desktop.
- Existing right-side Artifact panel, not a separate page.
- Cursor-anchored slash menu with text, headings, image, table, code, and list blocks.
- Selection-anchored Markdown-safe formatting toolbar.
- Directly rendered image, fenced code, and GFM table blocks with an explicit path back to source editing.
- Image replacement editor for URL and description.

## Comparison

- Preserves the reference's document-first reading surface and compact, contextual editing controls.
- Adapts the mobile bottom-sheet block picker into a desktop cursor-anchored menu without introducing a permanent toolbar.
- Keeps typography, borders, radii, spacing, and monochrome hierarchy consistent with the current iPolloWork shell.
- Rich blocks remain lightweight Markdown underneath and do not introduce a parallel document model.
- The live 9823 client passed all six interaction frames, including automatic save and reopen persistence.

passed
