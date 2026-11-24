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
  <a href="https://www.npmjs.com/package/@docx-editor.dev/react"><img src="https://img.shields.io/npm/v/@docx-editor.dev/react.svg?style=flat-square&color=3B5BDB" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@docx-editor.dev/react"><img src="https://img.shields.io/npm/dm/@docx-editor.dev/react.svg?style=flat-square&color=3B5BDB" alt="npm downloads" /></a>
  <a href="https://github.com/eigenpal/docx-editor/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-blue.svg?style=flat-square&color=3B5BDB" alt="license" /></a>
  <a href="https://docx-editor.dev/editor"><img src="https://img.shields.io/badge/Live_Demo-3B5BDB?style=flat-square&logo=vercel&logoColor=white" alt="Demo" /></a>
  <a href="https://www.docx-editor.dev/docs"><img src="https://img.shields.io/badge/Docs-3B5BDB?style=flat-square&logo=readthedocs&logoColor=white" alt="Documentation" /></a>
</p>

# @docx-editor.dev/react

A visual `.docx` editor for React. Open a DOCX document, edit its paginated layout, and save a DOCX file. Parsing and serialization run in the browser.

Saving preserves untouched content, unsupported OOXML, and package payloads. Continuous integration (CI) checks document structure and save-and-reopen behavior.

Install the adapter and its required engine peer:

```bash
npm install @docx-editor.dev/react @docx-editor.dev/core
```

## Features

- [Open, edit, and save documents](https://www.docx-editor.dev/docs/2.x/react/props).
- [Compose your editor interface](https://www.docx-editor.dev/docs/2.x/react/composition).
- [Connect controls through hooks](https://www.docx-editor.dev/docs/2.x/react/hooks).
- [Translate editor controls](https://www.docx-editor.dev/docs/2.x/i18n).

## Quick start

Import the stylesheet once and give the editor a container with a defined height:

```tsx
import { useState } from 'react';
import { DocxEditor } from '@docx-editor.dev/react';
import '@docx-editor.dev/core/styles/editor.css';

export function App() {
  const [doc, setDoc] = useState<Uint8Array>();

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <input
        type="file"
        accept=".docx"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          setDoc(file ? new Uint8Array(await file.arrayBuffer()) : undefined);
        }}
      />
      <div style={{ flex: 1, minHeight: 0 }}>
        {doc && <DocxEditor document={doc} mode="edit" />}
      </div>
    </div>
  );
}
```

`<DocxEditor>` includes the title bar, menu, toolbar, navigation pane, context menu, and document pages. It fills its parent container.

For Next.js and server-side rendering (SSR), load the editor in the browser. Use `dynamic(..., { ssr: false })` inside a Client Component.

## Build your own UI

Use components and hooks to build your own controls. Packaged controls use the same public API.

```tsx
import { DocxEditor, useEditorCommand } from '@docx-editor.dev/react';

function BoldButton() {
  const bold = useEditorCommand('text.bold');
  return (
    <button
      onMouseDown={(e) => e.preventDefault()} // chrome must not steal the caret
      onClick={() => bold.execute()}
      disabled={!bold.isEnabled}
      data-active={bold.isActive || undefined}
    >
      Bold
    </button>
  );
}

export function Editor({ bytes }: { bytes: Uint8Array }) {
  return (
    <DocxEditor.Root document={bytes}>
      <BoldButton />
      <DocxEditor.Viewport>
        <DocxEditor.Content />
      </DocxEditor.Viewport>
    </DocxEditor.Root>
  );
}
```

`Root` owns the editor instance. `Viewport` supplies scrolling, and `Content` displays pages. Add other controls as needed.

Use `className`, `data-active`, and `icon` for appearance changes. Use `asChild` to apply behavior to your own element. Use `hidden` or `preset={false}` to replace controls, or build controls with hooks.

## Hooks

| Hook | What it gives you |
| --- | --- |
| `useEditorCommand(slot)` | `execute`, `isActive`, `isEnabled`, `disabledReason` |
| `useEditorState(selector)` | A memoized slice of the editor snapshot |
| `useDocxEditor()` | The editor instance, or `null` before mount |
| `useEditorEvent(event, fn)` | `change`, `selectionChange`, `error` |
| `useFontFamily()` / `useParagraphStyle()` | Value controls: current value, options, setter |
| `usePageSetup()` | Margins, orientation, paper size |
| `useDocumentOutline()` / `useDocumentSearch()` | The navigation pane, headless |
| `useContentControl()` | Content controls at the caret |

Read `isEnabled` to set the disabled state. Show `disabledReason` when the command is unavailable.

## Companion packages

- [`@docx-editor.dev/pro`](https://www.npmjs.com/package/@docx-editor.dev/pro) — tracked changes, comments, custom nodes
- [`@docx-editor.dev/editor-api`](https://www.npmjs.com/package/@docx-editor.dev/editor-api) — A supported subset of the Office.js API for server and browser editing
- [`@docx-editor.dev/core`](https://www.npmjs.com/package/@docx-editor.dev/core) — the engine this adapter renders

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

- [Quickstart](https://www.docx-editor.dev/docs/2.x/quickstart)
- [Composition](https://www.docx-editor.dev/docs/2.x/react/composition)
- [Hooks](https://www.docx-editor.dev/docs/2.x/react/hooks)
- [Props and ref](https://www.docx-editor.dev/docs/2.x/react/props)
- [Export Markdown and PDF](https://www.docx-editor.dev/docs/2.x/guides/export)
- [Print documents](https://www.docx-editor.dev/docs/2.x/guides/print)

## License

Apache-2.0

### Custom unsupported content

Register components under `DocxEditor` or `DocxEditor.Root`. Each declaration handles matching unsupported content, including opaque inline and block elements.

```tsx
<DocxEditor document={bytes}>
  <DocxEditor.UnsupportedElement
    match={(element) => element.namespaceUri === 'urn:my-widgets'}
    layout={{ width: 180, height: 48 }}
  >
    {({ element }) => <MyWidget element={element} />}
  </DocxEditor.UnsupportedElement>
  <DocxEditor.UnsupportedElement>
    {({ element }) => <MyPlaceholder label={element.label} />}
  </DocxEditor.UnsupportedElement>
</DocxEditor>
```

The first mounted matching declaration wins. Prop updates retain its priority. Removing and mounting a declaration again gives it a later priority. To disable a specific renderer temporarily, keep it mounted and change `match`, or use matchers that do not overlap. Omit `match` for a catch-all. Use source metadata in predicates; geometry is not available before pagination. Return `null` to keep the default placeholder. An empty result does not select the next declaration.

`UnsupportedElement` exposes `nodeId`, `ownerPartName`, `namespaceUri`, `localName`, `source`, `placement`, and `label`. `bounds` describes the reserved box after layout. Optional `drawing` and `equation` records provide specialized metadata. Treat source content as read-only and untrusted.

`layout` reserves width and height in document points for opaque elements. Source placement determines inline or block flow. Without `layout`, opaque inline elements reserve 120 × 24 points; blocks reserve 240 × 96 points. Dimensions must be positive, finite, and at most 100,000 points. Drawing and equation fallbacks retain their existing geometry. Unmatched opaque content retains its existing invisible behavior. Properties, metadata, and nested payloads inside unsupported elements are not independent content occurrences.

Components retain framework context and local state across same-page repaints. They can remount when pagination, virtualization, or document changes remove an occurrence. Keep durable application data outside the component. Prop updates and declaration removal preserve document edits and undo history. Custom rendering does not change saved DOCX content.
