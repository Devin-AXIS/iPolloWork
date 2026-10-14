# Unified queries and saved views

Visual filters, the read API and scoped MCP operations share `RecordQuery` from `src/core/query.ts`. No model is called by this application: iPolloWork supplies AI, discovers capabilities, and produces the same query that a person edits in the table toolbar.

## Request

`POST /api/tables/{tableId}/query` is a read-only JSON endpoint. Scoped integrations expose the same request through `records_list` (and `query_context` for discovery). Table MCP omits `tableId`; project MCP requires an in-scope table ID.

```json
{
  "page": 1,
  "selection": {
    "search": "",
    "filter": {
      "conjunction": "and",
      "conditions": [
        { "fieldId": "<currency-code-field-uuid>", "operator": "in", "value": ["USD", "EUR"] },
        { "fieldId": "<saved-rate-field-uuid>", "operator": "gt", "value": "1" }
      ]
    },
    "sort": [{ "fieldId": "<saved-rate-field-uuid>", "direction": "desc" }]
  }
}
```

Replace placeholders with UUIDs from discovery. `GET /api/tables/{tableId}/records` also accepts URL-encoded JSON in `selection`, or a saved `viewId`. Legacy `q` / `query` title-prefix searches still work. These entry modes cannot be mixed. Scope checks apply even when loading a saved view; out-of-scope relationships cannot be used to infer membership or counts.

Responses include `appliedQuery`, the full-table `total`, a bounded page (50 rows), and `queryInfo` with execution time, labels and any snapshot field IDs involved. Conditions and sorting execute in PostgreSQL before counting and pagination. Values are bound parameters; fields and joins are resolved against actual metadata. Stable record IDs break sort ties, with nulls last. Each filtered SQL statement has a five-second timeout. Pagination is stable for unchanged data; concurrent edits between requests can change page membership.

## Conditions

Groups use `and` / `or`, at most three levels and 40 conditions total. At most three unique sort fields are allowed. The operator list is derived from registered field storage and input types, so compatible extension fields participate without a separate query engine.

- Text: equality, inequality, starts-with, contains, any/none of a value list, empty/nonempty. Equality and lists are case-sensitive; starts-with/contains ignore case. `%`, `_` and backslashes in text are literal.
- Numbers: exact decimal comparison, using decimal strings to avoid floating-point loss.
- Dates, timezone-aware date-times, times: equality and ordered comparisons. Date-times normalize to UTC; times compare as SQL time values.
- Boolean: true/false and empty/nonempty; false is not empty.
- Multi-choice/tags: any/all/none of selected values, empty/nonempty.
- JSON: empty/nonempty. Arbitrary JSON-path filtering is not implemented.
- Links: empty/nonempty, any/all/none of record IDs. A condition may also supply `relatedFieldId` to compare a field in the linked table. This means **at least one linked record** satisfies that condition. Each condition is a separate existence test; an AND of two linked conditions may match different linked records. Only one hop is supported, within the integration's allowed table scope. EXISTS avoids counting a root record twice.

Scalar negative comparisons exclude null values. Use an OR group with `isEmpty` to include them. Null and an empty string are empty for text; null and an empty array are empty for lists. List negative comparisons exclude null. For links, `notHasAny` also matches records without links.

Text contains and ad hoc field comparisons may scan the physical table; no large-scale indexed performance claim is made. No indexes are created for every user field. Add workload-specific indexes only after measuring a real workload. Tests cover more than one page, SQL parameter binding, list/date/null semantics and bounded relation scope.

## API fields

Only **saved snapshots** can participate in full-table filters or sorting. Such queries remain on committed snapshot values; the UI pauses automatic API refresh while those predicates are active. Each row retains its existing source status and timestamps. Snapshot membership does not imply the quote is current.

`records_refresh` / the toolbar refresh explicitly refreshes **the selected page**, then re-executes the saved-value query so changed values do not contradict its predicates or ordering. It does not refresh the full table. A missing or failed value is not converted to zero. Live, unsaved fields are explicitly disabled/rejected for filtering and sorting. Provider-side pushdown and bounded live-filter execution are future connector capabilities, not implemented here.

## Saved views

`GET /api/tables/{tableId}/query-context` returns capabilities, linked field metadata, saved views and the current table `version`. `POST /api/tables/{tableId}/views` accepts `name`, `layout`, `query`, `version` and optionally an existing view `id`. `DELETE /api/tables/{tableId}/views/{viewId}` takes `{ "version": 1 }`.

MCP exposes `query_context`, `view_save` and `view_delete`; `records_list` can use `{ "viewId": "<uuid>" }`. Saving is an explicit mutation. The UI offers save-as, applying existing views, and deleting the active saved view. Existing definitions can be updated by the versioned API/MCP.

Definitions reside in the existing table's `query_views` metadata column: at most 20 per table, unique names, optimistic table version checks, row locking for concurrent updates. The migration runs for default and independently bound databases. Views are deleted with their table and never copy business records. Local browser preferences remember the current query per table; named definitions are shared in the database.

Field deletion or incompatible source changes do not silently erase conditions or broaden results. Invalid views fail with an actionable error and the editor remains available for correction. Charts/cards receive the same filtered page. The relation graph uses that page's root IDs and may show linked neighbors that do not match the root filter; it is a bounded neighborhood, not a full-table graph.

## Validation

`pnpm test` runs database-owning test files sequentially because their migrations and extension fixtures share a database. Within each suite, concurrency tests still execute simultaneous writes. `tests/query.test.ts` creates and removes its own projects and never uses an external quote feed as a test fixture.
