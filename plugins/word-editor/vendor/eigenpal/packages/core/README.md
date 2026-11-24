<p align="center">
  <a href="https://www.docx-editor.dev/">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/eigenpal/docx-editor/main/.github/assets/readme-logo-dark.svg" />
      <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/eigenpal/docx-editor/main/.github/assets/readme-logo-light.svg" />
      <img src="https://raw.githubusercontent.com/eigenpal/docx-editor/main/.github/assets/readme-logo-light.svg" alt="DOCX Editor by EigenPal" width="320" height="90" />
    </picture>
  </a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@docx-editor.dev/core"><img src="https://img.shields.io/npm/v/@docx-editor.dev/core.svg?style=flat-square&color=3B5BDB" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@docx-editor.dev/core"><img src="https://img.shields.io/npm/dm/@docx-editor.dev/core.svg?style=flat-square&color=3B5BDB" alt="npm downloads" /></a>
  <a href="https://github.com/eigenpal/docx-editor/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-blue.svg?style=flat-square&color=3B5BDB" alt="license" /></a>
  <a href="https://www.docx-editor.dev/docs"><img src="https://img.shields.io/badge/Docs-3B5BDB?style=flat-square&logo=readthedocs&logoColor=white" alt="Documentation" /></a>
</p>

# @docx-editor.dev/core

Use the [docx-editor.dev](https://docx-editor.dev) engine to read, edit, render, and save DOCX files. The engine stores document content in a canonical tree. It has no framework dependency.

Install this package alongside the React or Vue adapter. Both adapters require it as a peer dependency. You can also use its public contracts to build your own adapter.

```bash
npm install @docx-editor.dev/core
```

Node.js requires `^20.16.0 || >=22.3.0`.

## Features

- [Read and save DOCX files](https://www.docx-editor.dev/docs/2.x/guides/loading-and-saving).
- [Lay out and render document pages](https://www.docx-editor.dev/docs/2.x/docx-fidelity). Charts, DrawingML diagrams saved without their drawing, shape effects, and VML text paths need [`@docx-editor.dev/pro/drawing`](https://www.docx-editor.dev/docs/2.x/pro/drawing).
- [Build an editor with shared commands and controls](https://www.docx-editor.dev/docs/2.x/guides/chrome-slots).
- [Configure fonts for text measurement](https://www.docx-editor.dev/docs/2.x/guides/fonts).

## Entry points

Import editor creation, font helpers, and contract types from the package root:

```ts
import { createDocxEditor, loadFonts, DEFAULT_FONT } from '@docx-editor.dev/core';
import type { Editor, EditorSnapshot } from '@docx-editor.dev/core';
```

`DEFAULT_FONT` provides the default font configuration: Calibri at 11 points. `WORD_DEFAULT_FONT` is its deprecated alias. Document formatting and document-default rules determine the text size used for layout. Missing defaults and explicitly empty defaults can produce different results.

The root exports editor creation, contracts, font helpers, control definitions, and document types. Use subpaths to access storage, layout, and rendering.

| Subpath | Exports |
| --- | --- |
| `.` | Create an editor, the contract, fonts, the chrome registry, the document model. |
| `./editor` | Everything the root re-exports, plus the paginated surface and ruler geometry. |
| `./contracts/editor` | `Editor`, `EditorCommand`, `EditorQuery`, `EditorSnapshot`, `PageSetup`. |
| `./contracts/document` | The document-level edit and query vocabulary. |
| `./contracts/interaction` | Semantic addressing (`SemanticTarget`) and the `InteractionOutcome` an attempt answers with. |
| `./contracts/types` | Document model types. |
| `./contracts/modules` | `EditorModule` — the shape `@docx-editor.dev/pro` implements. |
| `./store` | The canonical tree and its transactional store. |
| `./layout` | The DOM-free layout pass. |
| `./output` | Paint layouts and selection overlays into the DOM. |
| `./export` | Document layout sessions for exporters. No DOM required. |
| `./automation` | The object model behind `@docx-editor.dev/editor-api`. |
| `./collaboration` | Provider-neutral collaboration session contracts. |
| `./collaboration/replication` | Replication helpers for collaboration providers. |
| `./styles/editor.css` | The one editor stylesheet, shared by packaged and custom chrome. |

## Architecture

The engine reads DOCX bytes into a canonical OOXML tree. Layout reads the tree and produces painted pages. Saving serializes the tree back into a DOCX package.

The document tree holds all editing state. The engine displays editable pages and converts browser input into tree operations.

Typed nodes supply layout properties. Generic nodes preserve other element structures, including unsupported extensions.

Export sessions default to `all-markup`, which shows inserted and deleted text. Use `displayMode: 'proposed'` for the accepted view or `displayMode: 'original'` for the rejected view.

### Build a paginated exporter

For exports that need font-based page breaks, use `openFontBackedDocumentForExport`. It resolves the fonts used throughout the document before layout. Without a measurer, `openDocumentForExport(bytes)` uses a fixed-width approximation.

Install `@docx-editor.dev/fonts` to use packaged substitutes in this example:

```ts
import { readFile } from 'node:fs/promises';
import { openFontBackedDocumentForExport } from '@docx-editor.dev/core/export';
import { packagedFonts } from '@docx-editor.dev/fonts';

const bytes = new Uint8Array(await readFile('contract.docx'));
const opened = await openFontBackedDocumentForExport(bytes, {
  fonts: packagedFonts(),
  fontPolicy: 'strict',
  onFontResolution: (report) => console.info(report),
});

if (!opened.ok) throw new Error(`DOCX rejected: ${opened.reason}`);
try {
  const layout = await opened.session.layout();
  console.log(layout); // Replace this with your exporter.
} finally {
  opened.session.dispose(); // releases document-owned shaping bytes
}
```

Let the engine manage fonts, resources, and layout. Build your output from the returned pages. For a live `HeadlessDocumentView`, pass the editor's revision-stable measurer.

## Fidelity

Untouched content, unsupported OOXML, and package payloads survive editing and save. The canonical tree preserves document structure while embedded fonts, macros, media, and other payloads pass through untouched. Two oracles gate this in CI: a canonical fingerprint over the tree, and a save-and-reopen semantic digest.

## Untrusted input

Treat DOCX files as untrusted input. The engine validates URLs and limits XML entities, archive expansion, nesting, and element counts. It does not automatically fetch external document relationships. Serialization escapes document text.

Anything you render from document data (a font name, a hyperlink target, a comment body) is still attacker-controlled at your boundary. Render it as text; do not build markup or URLs from it.

## Which API for which job

Use the React or Vue adapter hooks, the review hooks, and `DocxEditorReview` from `@docx-editor.dev/pro/react` or `@docx-editor.dev/pro/vue` to build browser review controls. Use the editing API in `@docx-editor.dev/editor-api` for document automation. It follows the Office.js object model and runs in browser and server hosts.

| Task | Browser controls (React or Vue) | Document automation |
| --- | --- | --- |
| [Comment on found text](https://www.docx-editor.dev/docs/2.x/recipes/comment-on-found-text) | `editor.findMatches`, `editor.selectMatch`, then `useReview().comment` | `body.search`, then `Range.insertComment` |
| [Reply to a thread](https://www.docx-editor.dev/docs/2.x/pro/comments) | `useReview().reply(item, text)` | `Comment.reply(text)` |
| [Record a tracked replacement](https://www.docx-editor.dev/docs/2.x/recipes/tracked-replacement) | Suggesting mode, then `editor.exec({ type: 'replaceMatch', match, text })` | `document.changeTrackingMode = 'TrackMineOnly'`, then `Range.insertText(text, 'Replace')` |
| [Propose an AI rewrite as tracked changes](https://www.docx-editor.dev/docs/2.x/recipes/propose-rewrite) | `prepareRewrite` through `DocxEditor.createBrowser` | `prepareRewrite` from `@docx-editor.dev/editor-api/agent` |
| [Accept or reject a change](https://www.docx-editor.dev/docs/2.x/recipes/accept-reject-without-scrolling) | `useReview().accept(item)` or `useReview().reject(item)` | `Revision.accept()` or `Revision.reject()` |
| [Open a change without scrolling](https://www.docx-editor.dev/docs/2.x/recipes/accept-reject-without-scrolling) | `useReview().setActive(key, { reveal: false })` | Not applicable: no viewport |
| [Highlight ranges](https://www.docx-editor.dev/docs/2.x/recipes/highlight-ranges) | `useHighlights(name, source, options)` | Not applicable |
| [Custom review rail cards](https://www.docx-editor.dev/docs/2.x/recipes/custom-review-cards) | `DocxEditorReview` with `preset` set to `false`, `useReviewCardHeights`, `useStackedReviewPositions`, and `useReviewRailMetrics` | Not applicable |
| Comment-on-selection button | `DocxEditorReview.AddComment` as a direct child of `DocxEditorReview`, or `useEditorCommand('review.addComment')` | Not applicable |
| [Page setup and paragraph dialogs](https://www.docx-editor.dev/docs/2.x/customization/dialogs) | `DocxEditor.PageSetupDialog` or `DocxEditor.ParagraphDialog` | `Section.pageSetup`, and `Paragraph` properties such as `alignment` |

This package ships the task recipes in [`docs/index.md`](./docs/index.md). They are also on the site: [Task recipes](https://www.docx-editor.dev/docs/2.x/recipes).

## Documentation

- [Core overview](https://www.docx-editor.dev/docs/2.x/core)
- [Architecture](https://www.docx-editor.dev/docs/2.x/core/architecture)
- [Feature support and fidelity](https://www.docx-editor.dev/docs/2.x/docx-fidelity)

## License

Apache-2.0. See [LICENSE](LICENSE). The tables derived from ECMA-376 are used under the Ecma copyright notice, not Apache-2.0. Other third-party material keeps its own terms. See [`licenses/`](licenses) and `THIRD_PARTY_NOTICES.md`.
