# Word Editor

Install and enable the archive in iPolloWork's plugin manager, then open a DOCX in a local project conversation or from Project Files. The right sidebar opens Word Editor. Use the document toolbar to switch to the built-in preview if needed.

The editor supports paginated editing, text and paragraph formatting, tables, images, links, lists, heading navigation, search, undo and redo, and page setup. Changes save back to the current document after a short pause and can also be saved with Ctrl/Cmd+S. Download copy exports the open document. External file changes are checked before saving. If the disk version has changed, a downloadable draft remains available for review.

The engine is built and served with the plugin. It runs on the local client without a document server. Pagination can differ when fonts are unavailable. Editing is for DOCX in local workspaces. Legacy DOC, password-protected or signed documents, and advanced review and live co-editing are outside the supported editing workflow.

The Apache-2.0 EigenPal sources (core, i18n, React adapter) are pinned under `vendor/eigenpal`. With Node 24 and Bun, run `npm ci`, `npm run build:source`, `npm run check` and `npm run pack:check`. Use `npm pack` for the installable archive. The browser engine is built from the checked-in source.
