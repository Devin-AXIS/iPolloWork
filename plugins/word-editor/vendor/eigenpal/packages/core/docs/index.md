<!-- Generated from docs/site/content/recipes by scripts/sync-agent-docs.mjs. Edit the source and run `bun run docs:agent`. -->

# Task recipes

Each recipe solves one task with a complete code sample. Choose the API first, then find the symbol for your task.

## Which API for which job

Use the React or Vue adapter hooks, the review hooks, and `DocxEditorReview` from `@docx-editor.dev/pro/react` or `@docx-editor.dev/pro/vue` to build browser review controls. Use the editing API in `@docx-editor.dev/editor-api` for document automation. It follows the Office.js object model and runs in browser and server hosts.

| Task | Browser controls (React or Vue) | Document automation |
| --- | --- | --- |
| [Comment on found text](./comment-on-found-text.md) | `editor.findMatches`, `editor.selectMatch`, then `useReview().comment` | `body.search`, then `Range.insertComment` |
| [Reply to a thread](https://www.docx-editor.dev/docs/2.x/pro/comments) | `useReview().reply(item, text)` | `Comment.reply(text)` |
| [Record a tracked replacement](./tracked-replacement.md) | Suggesting mode, then `editor.exec({ type: 'replaceMatch', match, text })` | `document.changeTrackingMode = 'TrackMineOnly'`, then `Range.insertText(text, 'Replace')` |
| [Propose an AI rewrite as tracked changes](./propose-rewrite.md) | `prepareRewrite` through `DocxEditor.createBrowser` | `prepareRewrite` from `@docx-editor.dev/editor-api/agent` |
| [Accept or reject a change](./accept-reject-without-scrolling.md) | `useReview().accept(item)` or `useReview().reject(item)` | `Revision.accept()` or `Revision.reject()` |
| [Open a change without scrolling](./accept-reject-without-scrolling.md) | `useReview().setActive(key, { reveal: false })` | Not applicable: no viewport |
| [Highlight ranges](./highlight-ranges.md) | `useHighlights(name, source, options)` | Not applicable |
| [Custom review rail cards](./custom-review-cards.md) | `DocxEditorReview` with `preset` set to `false`, `useReviewCardHeights`, `useStackedReviewPositions`, and `useReviewRailMetrics` | Not applicable |
| Comment-on-selection button | `DocxEditorReview.AddComment` as a direct child of `DocxEditorReview`, or `useEditorCommand('review.addComment')` | Not applicable |
| [Page setup and paragraph dialogs](https://www.docx-editor.dev/docs/2.x/customization/dialogs) | `DocxEditor.PageSetupDialog` or `DocxEditor.ParagraphDialog` | `Section.pageSetup`, and `Paragraph` properties such as `alignment` |

## Check prerequisites

- The review hooks need `reviewModule()` from `@docx-editor.dev/pro` in the editor's modules.
- Comments and tracked changes need an author: the editor's `author` prop, or the runtime's `author` option.
- Create a server runtime with `DocxEditor.createServer` from `@docx-editor.dev/editor-api`. Create a browser runtime with `DocxEditor.createBrowser` from `@docx-editor.dev/editor-api/browser`.
- Review controls stay separate from the Office.js-shaped document model.
- `@docx-editor.dev/pro` and `@docx-editor.dev/editor-api` require the EigenPal Pro License. For more information, see [Pro features](https://www.docx-editor.dev/docs/2.x/pro).

## See also

- [React hooks](https://www.docx-editor.dev/docs/2.x/react/hooks)
- [Vue composables](https://www.docx-editor.dev/docs/2.x/vue/composables)
- [Editing API](https://www.docx-editor.dev/docs/2.x/editor-api)
