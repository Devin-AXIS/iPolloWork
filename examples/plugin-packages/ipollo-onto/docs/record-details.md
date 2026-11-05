# Record details and grid editing

The table defaults to view mode: every record cell opens a right-side detail sheet. Grid edit mode opens the existing typed field input at the cell. Enter saves text and numeric inputs; Ctrl/Cmd + Enter saves multiline and compound inputs. Escape cancels. Clicking outside an edited cell does not discard it. API fields remain read-only.

The sheet shows the stable primary field as its title, the first image field when present, and up to three populated compact fields in detail order. The Details tab contains ordinary and API fields. Every relationship has its own tab, with paginated related records, navigation and back navigation. Edit mode uses the shared field inputs and existing bidirectional relation writes. Saving keeps the sheet open. Leaving with changed values offers save, discard, or continued editing.

## Persistence and API

Field presentation adds no entities or tables. The existing `iw_data.tables` owns `detail_layout` JSONB (`{fieldOrder: UUID[]}`), deleted with its table and migrated in both default and independent databases. It contains presentation metadata only. Dragging a detail field, or Alt + Up/Down on its handle, saves immediately. Main-grid column order and primary-field identity stay independent. New fields not yet in the saved order appear at the end.

- `PATCH /api/tables/:id/detail-layout`: `{fieldOrder, version}`. Requires every current non-relation field exactly once. Locks the table, checks the version, updates layout and increments the table version. Stale changes return 409.
- `GET /api/tables/:id/records/:recordId/relations/:fieldId?page=1`: validates source membership, resolves the canonical inverse relation and returns the existing `TableData` shape. SQL filtering/counting precede pagination (50 records per page); no per-record lookup loop. Uses the source table's database routing, including same-database cross-project relations.
- Both editing surfaces use the existing record POST/PATCH/DELETE paths and the current record version. Existing records send changed fields only; API fields cannot be overwritten. Dynamic reads use existing providers and snapshot rules.

## Verification

`tests/record-detail.test.ts` covers independent layout ordering, stale concurrent changes, field membership, cross-project relation pagination, inverse traversal, invalid scope and partial record updates. The independent-database test in `tests/kernel.test.ts` also saves a detail layout, reads related records and reopens the database to check persistence.

Grid and field editing introduce no AI provider or alternative record-write engine. The new view props for edit mode and saved/active cell callbacks are optional, so existing view plugins remain compatible.

## Record documents

The document tab is a lazy-loaded Tiptap editor. A record starts without a body; clicking **Start writing** creates its first document. The document switcher can add more documents or attach an existing document from the same project. Documents open before Details when already present. The drawer remains the shared shell for grids, cards and related-record navigation.

Writing follows contextual block interactions: type `/` to search commands at the caret (Chinese or English keywords, arrow keys, Enter and Escape); select text for a floating formatting/link toolbar; hover a block for `+` and a grip. The grip supports dragging, a click menu for duplicate/move/delete, and Alt + Up/Down. Standard Markdown input shortcuts are supplied by the editor. Available blocks are paragraphs, three heading levels, lists, tasks, quotes, code, dividers, images, videos, directly editable tables and existing-table references. Commands and selection formatting stay inside the sheet and flip when space is limited. No permanent formatting toolbar or separate visual page builder is required.

### Ownership and storage

Two tables are migrated in every selected PostgreSQL database:

- `iw_data.documents`: project-owned title, bounded JSONB block body, schema version, independent write version and timestamps. Project deletion cascades to its documents.
- `iw_data.document_records`: canonical many-to-many bindings to record IDs. Removing a binding or deleting a record preserves the document and other bindings. Unbound documents remain available in the project picker.

One document can be shared by records in different tables **within one project**. It is one body, not copies synchronized later. Bodies never join into normal table or field queries. Metadata lists are bounded to 100 documents per record and 50 per project page. Background checks read only the document version; the body loads on opening or when that version changes.

The current body is limited to 500 KB, 5,000 nodes, depth 12, and 12 embedded-table references. Keeping prose in JSONB permits atomic version checks and local block operations without an object-storage round trip. Binary attachments use content-addressed local files under `DOCUMENT_FILES_DIR` (default `.data/document-files`), partitioned by physical database identity and project. Back up this directory with the database. Images accept PNG/JPEG/GIF/WebP up to 5 MB; SVG is rejected. Videos accept MP4/WebM up to 25 MB and support HTTP byte-range playback. Both can be inserted using a direct HTTP(S) media URL instead of an upload. Webpage/player URLs are not resolved into video streams. Orphan image files are currently retained, so deletion/retention policies must account for this directory. An OSS adapter is not implemented.

### Frequent edits and references

Edits debounce for 800 ms, serialize saves, and retain an unsaved draft locally. A document version protects against overwriting another writer. Independent title/block changes can merge; conflicting edits to the same block remain visible, with the local draft preserved and an option to save it as another document. This is not live multi-cursor collaboration or an unbounded revision history. UI closure and related-record navigation flush pending writes before leaving.

Table-reference blocks store IDs and query configuration, not copied rows. They use existing paginated table/filter/relationship reads (50 records, up to six ordinary fields), validate project/MCP scope, and read saved data without starting external API calls. A current-record or related-record reference retains its source record ID, including when its document is linked elsewhere.

**Export document** downloads standalone HTML with the current body, embedded local images/videos, ordinary tables, and bounded snapshots of referenced tables (first 50 rows with total counts and an export timestamp). It does not create a public sharing URL. API/MCP read, create, update and linking operations are described in [AI interface](ai-interface.md); AI generation remains owned by iPolloWork.

### Document verification

`tests/documents.test.ts`, `tests/document-merge.test.ts` and `tests/editor-interactions.test.ts` cover scoped access, canonical sharing, optimistic concurrency, independent merges, content limits, image storage, export escaping/snapshots, menu search and positioning. The independent-database kernel test creates, updates and reads documents through routed HTTP endpoints and verifies that bodies do not land in the default database.

Ordinary document tables are prose blocks (up to 100 rows and 30 cells per row), separate from business tables. Click cells to type; Tab moves between cells, column boundaries resize, and the block grip menu adds/removes rows or columns and toggles the header. The `/` menu distinguishes **Simple table** from **Reference table**. HTML content blocks are deferred and are not registered or accepted by the content API.
