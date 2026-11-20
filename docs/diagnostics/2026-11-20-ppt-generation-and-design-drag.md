# PPT generation interruptions and Design pointer transforms

Date: 2026-11-20, Asia/Shanghai.

The inspected desktop session `session-84666655-aa52-4947-9e9a-e274499fccb4` ended turn 1 at step 54 with HTTP 503 / `SERVICE_UPSTREAM_REJECTED`, then turn 2 at step 21 with HTTP 503 / `IPW_SERVICE_UNAVAILABLE`. These are official-model channel failures. The historical gateway response does not retain the original upstream status, so the first rejection cannot be classified retrospectively as rate limiting. The other inspected presentation session completed normally.

The original Design runtime parsed authored CSS values with `parseFloat(element.style...)`. Imported PPT objects use percentage insets and dimensions, which were consequently treated as pixels. Stylesheet positioning also fell back to viewport coordinates instead of containing-block insets. Guide snapping could turn small click jitter into an edit.

The Design fix resolves used CSS values, converts movement through the containing block's scale, preserves right/bottom-anchored dimensions and waits for actual movement before snapping. Existing HTML is not rewritten by selection alone. Browser regressions cover percentages, stylesheet `calc()`, content-box sizing, anchored objects and fixed presentation zoom.

Official-model transport recovery reuses one invocation ID before headers, with at most three retries and cancellable delays. Account changes, permanent rejections, unknown outcomes and interrupted response streams remain terminal. Server-side rate-limit recovery retries only explicit HTTP 429 responses for synchronous chat, at most twice, inside one billing invocation. Long `Retry-After` values remain visible instead of holding the request indefinitely. Cancellation during a rejected-call cooldown releases its reservation. Rejection logs contain only request ID and numeric status.

The cloud service must be deployed separately for the server-side change to affect `cloud.ipollo.net`; a desktop update alone cannot change the production gateway. No provider key, account grant, prompt or response content is recorded in this diagnostic.

## Development verification

The user requested an update of the running development application only. No plugin archive, installer or production deployment was produced. The desktop's native plugin manager now selects a local link to `.ipollowork-dev/dsg31/packages/deepseek-design`; the linked Work bundle was rebuilt and the Electron Host restarted with the existing user-data and DSH home.

Checks completed:

- Root tests, upstream pin verification and documentation checks passed.
- Work bundle compilation and TypeScript checks passed. The initial full test run had two missing test-database configuration failures and one native launcher timeout. Both database cases passed against the isolated local test database; the native cloud-profile case passed with plain Node rather than the tsx runner. The catalog artwork check passed. Eleven environment-dependent tests remain skipped.
- Account-service compilation and type checking passed. Its 99 test cases passed across the full run and an isolated rerun of the storage case that timed out under concurrent database load. All database verification used the local test database.
- Design's full source check passed: compilation, type checking, 136 tests, dependency boundaries, package payload validation and the retained-source adaptation ledger. Browser editor regressions passed all 18 cases, including five new pointer-transform cases.
- The actual running development Host passed a browser flow using a separate regression workspace and conversation. Selecting the PPT object left its authored style and position unchanged; dragging moved it exactly 43 by 27 viewport pixels; resizing increased its viewport size exactly 31 by 19 pixels; the real save persisted the geometry. Screenshots cover both themes and 390px inspection. No page errors were recorded.
- The same flow passed in disposable native DSH profiles with Design alone and with Design plus Video. These checks installed local source links and used a fixture model; they did not generate archives or call a paid model. Both temporary Hosts were stopped after verification.

Native installation briefly materialized duplicate profile copies of runtime-owned DSH packages, causing a Cordis injection failure on restart. Those copies were preserved under `.ipollowork-dev/ppt-fix-dev-review/profile-core-backup-*` and removed from profile resolution, restoring the application-owned runtime. No upstream implementation was modified. The existing account remains signed in, the original two presentation files retain their pre-update SHA-256 values, and the development Electron window is responsive.

Local evidence is under `.ipollowork-dev/ppt-fix-dev-review/`; it includes the active-Host result, screenshots, original document fingerprints and profile metadata backups. Local evidence and generated bundles are not release artifacts.
