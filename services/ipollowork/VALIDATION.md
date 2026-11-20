# Configuration and UI handoff validation — 2026-11-20

Service **0.1.16**, Suite **0.1.41**, native DSH **0.2.2-rc.3**. Business schema remains **19**. Source changes retain the prior backup, compiled-CLI and model-recovery work. Existing customer databases, production cloud services and the user's daily desktop profile were not modified.

## Configuration behavior

- Public default account origin is in `plugins/ipollowork-suite/deployment.json`. Platform/preset `DSH_DESKTOP_ACCOUNT_ORIGIN` overrides the default; explicit one-off `PACKAGE_ACCOUNT_ORIGIN` overrides the file, including unsigned/Linux builds. The selected origin is embedded in native application composition. Dedicated desktop interface requirements no longer overwrite it. Explicit old official origins remain explicit.
- Exact-origin account credentials remain isolated. HTTPS is required except loopback development origins; embedded credentials, paths, queries and fragments are refused.
- The server and every production operator command share `.env` or process-selected `IPOLLO_CONFIG_FILE`. Process variables win; missing explicit files fail before database connection. Both database URLs/schemas are configurable. External Compose supports host-side `IPOLLO_ENV_FILE`; bundled PostgreSQL Compose intentionally constructs its own local URL.
- All four Compose combinations validated. An explicit host dotenv retained both database URLs and the correct source build context. The new compiled migration/admin commands also loaded that selected file with production-only dependencies and no tsx.

## Completed automated verification

- Service `npm run check`: **105 passed, 0 failed**, followed by a successful server/SQL/Vite build. Tests use fixture-owned schemas on PostgreSQL 18 bound to `127.0.0.1:15485`, never customer RDS. New tests exercise explicit dotenv loading/precedence, missing-file failure and authorized/validated/masked cloud settings.
- Suite `npm run check`: **205 passed, 11 optional skipped, 0 failed**; build/type checks, catalog artwork and `pack:check` passed. The first attempt omitted TEST_DATABASE_URL; it was corrected and the complete check passed against the isolated cluster.
- Desktop account/preset/overlay tests: **83 passed**. This checkout contains real legacy workspace directories and lacks generated resolution links. Windows refused creation of file symlinks without administrator privileges. The same three test files ran using an ignored isolated Vitest configuration, pinned upstream modules/TypeScript and the official Include implementation. No existing workspace directory or upstream source was replaced.
- Root product tools: **16 passed**. File/default validation and composition tests preserve custom origins and unrelated plugin preferences. Final documentation, source-pin and whitespace checks are recorded with delivery.
- A real `ipollo-dsh-suite-0.1.41.tgz` was installed through the native plugin CLI into a disposable profile, then launched with a custom loopback account service. Its `/info` reported the expected package version and dedicated desktop flag; sign-in and sign-out used the fixture account service. The archive was removed afterward. Unneeded @google/genai and protobufjs install scripts were explicitly denied in the disposable profile's pnpm policy, rather than granting script execution.
- Prior backup regression remains in the 105 tests: both schemas restored, effective authentication key and private file retained, encrypted setting decrypted, original password accepted. No final backup directory is published on a failed dump/copy.

## Browser and HTTP verification

The actual compiled server started by reading `IPOLLO_CONFIG_FILE`, using separate account/app-data fixture schemas and a local data directory at `http://localhost:4798`. The port is temporary, not a handoff endpoint.

- Administrator: overview, users, organizations, projects, service center, resources, plans, orders, app data and settings. **60 layout/load checks** covered all ten pages at 1280, 768 and 390 pixel widths in light/dark themes, with no page-level horizontal overflow, loading failure or displayed API error.
- Organization details: members, departments, templates, plugins, Skill, MCP, activity and settings loaded at mobile width without errors/overflow. Tables intentionally use horizontal scrolling when necessary.
- Ordinary account: administrator-only navigation absent; an account without organization membership created a personal project from the real form, and the result appeared as personal ownership in the list.
- Cloud gateway: enabling without required parameters was rejected with a visible explanation. A valid origin saved while disabled; no external gateway was called. HTTP tests confirm masked/blank key edits preserve stored credentials and invalid saves preserve prior settings.
- Provider connection: a test provider held a mixture of enabled/disabled service records. Saving its real connection form without changing the activation checkbox preserved every record's activation state, verified in the fixture database. No provider request was made.
- Screenshots and geometry matrices were retained with the delivery. Non-mutating HTTP smoke covers liveness, dual-database readiness, discovery, built page shells/assets, unauthenticated administrator denial and unknown API rejection.

The prior production-only dependency install proved compiled migrate/admin/backup without tsx on Node 24.22.3. The prior official npm-registry production audit reported zero advisories; this is not a comprehensive security audit.

## Remaining target-environment acceptance

**No Docker Engine is available here; application and operations images have not been built or executed.** Standalone Compose validates configuration only. The receiving team must build both targets on its Linux architecture, match PostgreSQL client/server majors, record image digests, verify persistent volumes/restarts/draining and run a restore drill before traffic cutover.

Real OSS transfers, company mail, actual model pricing/quotas, payment callback verification and production WebSockets require the receiving team's credentials and infrastructure. Fixture/UI checks do not replace those acceptance steps. Optional native/external suites skipped above remain explicitly unverified. No installer was repackaged or uploaded.
