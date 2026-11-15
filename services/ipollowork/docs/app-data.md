# App data

App data gives small plugins, websites, apps and mini programs a hosted record store without a database of their own. Callers send JSON statements; they never see SQL, tables or connection strings. Larger systems that need joins, server-side logic or payments should run their own back end.

## Storage

Records live in a separate PostgreSQL database named by `APP_DATA_DATABASE_URL` (optional `APP_DATA_DATABASE_SCHEMA`). The service refuses to start when it names the account database and schema. Without the variable, every `/api/data/v1` route answers `APP_DATA_NOT_CONFIGURED`; nothing falls back to the account database. Migrations use `app_data_schema`; schema 2 adds each app's kind and classifies existing apps with public collections as sites, schema 3 adds tombstone removal and named rate buckets, and schema 4 adds strict collections. A service older than the database's schema refuses to start. The account database still owns users, organizations and memberships, which the service reads on every request.

Apps, collections and records are rows in fixed tables, so adding or deleting apps never changes the database schema. Each app declares its kind when created: `plugin` for data a DSH plugin uses, `site` for a website, app or mini program that visitors open. Each record is a JSON object of at most `APP_DATA_MAX_RECORD_BYTES` (16 KiB). A field's type, text, number, boolean or json, is fixed by its first value or a `define` statement. An app holds at most 50 collections of at most 100 fields, `APP_DATA_MAX_RECORDS_PER_APP` records (100,000) and `APP_DATA_MAX_BYTES_PER_APP` bytes (64 MiB). Each person or organization has at most `APP_DATA_MAX_APPS_PER_OWNER` apps (1,000) holding `APP_DATA_MAX_BYTES_PER_OWNER` bytes in total (1 GiB); concurrent writes to different apps may overshoot the total by their own size. Only growth is refused, so an app over a lowered limit can still delete records. Text containing a NUL character or an unpaired surrogate, and JSON nested deeper than 16 levels, is refused with `DATA_VALUE_INVALID`.

The app data pool is shared by every owner. Statements stop after `APP_DATA_STATEMENT_TIMEOUT_MS` (5 seconds), and each owner runs at most `APP_DATA_OWNER_CONCURRENCY` statements at once (8) across all of its apps; up to 100 more wait and the rest receive `DATA_RATE_LIMITED`. The limit is per service process.

Deleting an app or dropping a collection stops access immediately; a background pass removes the records in chunks and resumes after a restart. Deleted records remain as tombstones for synchronization for `APP_DATA_TOMBSTONE_DAYS` (30) and are then removed by an hourly pass, so deleting records cannot grow storage without bound.

## Access

A personal app belongs to its creator. An organization app is readable and writable by current members; its creator and the organization's owners and administrators manage it. Managers alone run `define` and `drop`, rename the app, replace its public key or delete it. Non-members receive `DATA_APP_NOT_FOUND`.

Each app has a public key for page code. By default it grants nothing. A collection defined with `"public":["read"]` admits anonymous `get`, `find` and `count`; `"public":["create"]` admits anonymous single-record inserts that use only declared fields. Anonymous callers cannot update, delete, batch, sync, read app details or choose a record id. Per visitor and app they are limited to `APP_DATA_ANONYMOUS_PER_MINUTE` reads (120) and `APP_DATA_ANONYMOUS_CREATES_PER_MINUTE` creates (20); a visitor is an IPv4 address or an IPv6 /64 network. Behind a reverse proxy, list it in `TRUSTED_PROXY_IPS`, otherwise every visitor shares the proxy's address and one limit. One app serves at most `APP_DATA_ANONYMOUS_CONCURRENCY` anonymous statements at once (4), so visitors cannot use all of its owner's slots. The key of a banned or removed personal owner stops working. Visitors have no accounts, so they cannot read back or cancel their own submissions. Replace a leaked key with `PATCH /api/data/v1/apps/:id {"rotateKey":true}`.

## API

Signed-in callers send `Authorization: Bearer <session token>`; page code sends `X-Data-Key: <public key>`. Cookies are ignored and any origin may call, without credentials.

| Route | Purpose |
| --- | --- |
| `GET /api/data/v1/apps` | List personal and organization apps |
| `POST /api/data/v1/apps` | `{name, kind, slug?, enterpriseId?, workspace?}`; returns the existing app with the same slug or creates one with that kind |
| `GET`, `PATCH`, `DELETE /api/data/v1/apps/:id` | Detail with endpoint, public key and collections; rename or rotate the key; delete |
| `POST /api/data/v1/apps/:id/run` | Run one statement or `{"batch":[…]}` of up to 20 statements in one transaction |
| `GET /api/data/v1/apps/:id/changes?after=&limit=` | Changes after a cursor for another device, never splitting one commit; `reset: true` means deletions older than the cursor were removed and the caller must reload every record |

Statements:

~~~json
{"insert":"bookings","values":{"name":"Ann","date":"2026-12-01","slot":10}}
{"find":"bookings","where":{"date":{">=":"2026-12-01"},"slot":{"in":[9,10]}},"search":"ann","sort":"-createdAt","limit":20,"after":"<next>"}
{"get":"bookings","id":"<uuid>"}
{"count":"bookings","where":{"name":{"contains":"an"}}}
{"aggregate":"orders","where":{"paid":true},"group":"day","sum":["total"],"avg":["total"],"sort":"-count","limit":50}
{"update":"bookings","id":"<uuid>","set":{"note":null},"version":2}
{"update":"items","id":"<uuid>","inc":{"stock":-1}}
{"upsert":"settings","id":"profile","values":{"goal":"run 10k"}}
{"delete":"bookings","id":"<uuid>"}
{"define":"bookings","fields":{"name":"text","slot":"number"},"public":["create"],"unique":["date","slot"],"strict":true,"remove":["typo"]}
{"drop":"bookings"}
{"info":true}
~~~

Record ids are 1 to 64 letters, digits, underscores or hyphens, such as `profile`; `insert` generates a UUID when the record supplies none, and an id freed by `delete` can be inserted again. `insert` creates a missing collection and accepts up to 100 records. `update` merges fields, removes fields set to `null` and rejects a stale `version`; `inc` adds to number fields atomically, starting a missing field at 0. `fields` on `find` and `get` returns only the named fields besides the system fields. `aggregate` returns `{items}` with `count` and the requested `sum`, `avg` (numbers), `min` and `max` (numbers or text): one row of totals, or with `group` one row per value of a text, number or boolean field, carrying that value as `key`, ordered by `key` or `count`, at most 1,000 rows with `more` telling whether rows were cut off. Dates stored as ISO text sort, filter and group correctly. `define` with `"strict":true` makes every write use only declared fields, and `"remove"` deletes fields and their values from every record; removed values keep counting toward the size limit until their records are next written. `upsert` creates the record with its id or replaces all of its fields, recreating a deleted record. Rejections name what exists: an unknown field lists the collection's fields and types, an unknown collection lists the app's collections and a missing record names its collection and id. `find` filters with `=`, `!=`, `>`, `>=`, `<`, `<=`, `in` and `contains` (text), sorts by one field and pages with the returned `next`. `search`, on `find` and `count`, keeps records whose id or any text or number field contains the term, ignoring letter case, and combines with `where`. A `null` condition matches a missing field. JSON fields cannot be filtered or sorted. The default order, newest first, reads an index; sorting by another field orders the whole collection. A batch is one commit with one sequence number in the change feed. `unique` rejects a second live record with the same values and can be set only on an empty collection. Records carry `id`, `version`, `createdAt` and `updatedAt`, which writes cannot set.
