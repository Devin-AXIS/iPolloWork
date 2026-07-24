# Step 3 - Write Failing Test

## Failing Tests Created

- FR-1: Additive self-contained plugin package - `docs/scenario/plugin-package-manifest.md` - `apps/server/src/plugin-package-manifest.test.ts`
- FR-2: Independent multi-method plugin authorization - `docs/scenario/plugin-authorization-methods.md` - `apps/server/src/plugin-authorization-methods.test.ts`
- FR-3: Plugin-scoped authorization state - `docs/scenario/plugin-authorization-isolation.md` - `apps/server/src/plugin-authorization-isolation.test.ts`
- FR-4: Lightweight lifecycle over existing loaders - `docs/scenario/plugin-package-lifecycle.md` - `apps/server/src/plugin-package-lifecycle.test.ts`
- FR-5: Friendly developer and user workflows - `docs/scenario/plugin-developer-user-flow.md` - `apps/app/tests/plugin-developer-user-flow.test.ts`

## RED Evidence

- Server command: `bun test src/plugin-package-manifest.test.ts src/plugin-authorization-methods.test.ts src/plugin-authorization-isolation.test.ts src/plugin-package-lifecycle.test.ts`
- Server result: 0 passed, 12 failed because the four planned production modules do not exist yet.
- App command: `bun test tests/plugin-developer-user-flow.test.ts`
- App result: 0 passed, 3 failed because the planned state projection module and English/Chinese translation keys do not exist yet.

The functional-requirement count, scenario-document count, and scenario-test-file count are all five.
