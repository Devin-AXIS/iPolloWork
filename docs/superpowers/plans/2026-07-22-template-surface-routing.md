# Template Surface Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open every materialized template entry in its assigned Design or Video editor, including when metadata is still loading, while preserving ordinary HTML artifact behavior.

**Architecture:** A focused route module maps an exact template entry path plus its persisted `surface` to the right panel. SessionPage waits for that route before artifact fallback; if local metadata is unavailable it reads the server's canonical template-session binding.

**Tech Stack:** React, TypeScript, Bun test, iPolloWork template-session API.

## Global Constraints

- Use the persisted template-session binding; never infer ownership from `entry.html` or `index.html` alone.
- Design templates, including Slides/PPTX-compatible templates, resolve to `design`.
- Video templates resolve to `video`.
- A missing binding preserves the artifact route.
- Do not change Design, Video, PPTX export, or artifact classification.

---

### Task 1: Generalize and test template-entry surface resolution

**Files:**

- Create: `apps/app/src/react-app/domains/session/templates/template-entry-route.ts`
- Modify: `apps/app/tests/design-entry-target.test.ts`
- Delete: `apps/app/src/react-app/domains/session/design/design-entry-target.ts`

**Interfaces:**

- Produces `TemplateEntrySurface = "design" | "video"`.
- Produces `resolveTemplateEntrySurface(target, binding): TemplateEntrySurface | null`.
- Produces `waitForTemplateEntrySurface(target, bindingPromise): Promise<TemplateEntrySurface | null>`.

- [ ] **Step 1: Write the failing route tests**

Replace `apps/app/tests/design-entry-target.test.ts` with:

```ts
import { describe, expect, test } from "bun:test";
import { resolveTemplateEntrySurface, waitForTemplateEntrySurface } from "../src/react-app/domains/session/templates/template-entry-route";

describe("template entry surface routing", () => {
  test("routes website and Slides entries to Design", () => {
    expect(resolveTemplateEntrySurface({ kind: "file", value: "design/ses_site/entry.html" }, { surface: "design", entry: "design/ses_site/entry.html" })).toBe("design");
    expect(resolveTemplateEntrySurface({ kind: "file", value: "design/ses_slides/entry.html" }, { surface: "design", entry: "design/ses_slides/entry.html" })).toBe("design");
  });

  test("routes a Video entry to Studio", () => {
    expect(resolveTemplateEntrySurface({ kind: "file", value: "video/ses_video/index.html" }, { surface: "video", entry: "video/ses_video/index.html" })).toBe("video");
  });

  test("keeps ordinary HTML and non-entry files on the artifact route", () => {
    expect(resolveTemplateEntrySurface({ kind: "file", value: "reports/overview.html" }, null)).toBeNull();
    expect(resolveTemplateEntrySurface({ kind: "file", value: "design/ses_slides/brief.json" }, { surface: "design", entry: "design/ses_slides/entry.html" })).toBeNull();
  });

  test("waits for pending metadata before choosing the editor", async () => {
    let release!: (binding: { surface: "design"; entry: string } | null) => void;
    const metadata = new Promise<{ surface: "design"; entry: string } | null>((resolve) => { release = resolve; });
    const route = waitForTemplateEntrySurface({ kind: "file", value: "design/ses_slides/entry.html" }, metadata);
    let settled = false;
    void route.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    release({ surface: "design", entry: "design/ses_slides/entry.html" });
    expect(await route).toBe("design");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm.cmd --dir apps/app exec bun test tests/design-entry-target.test.ts`

Expected: FAIL because `template-entry-route.ts` is absent.

- [ ] **Step 3: Implement the minimal resolver**

Create `apps/app/src/react-app/domains/session/templates/template-entry-route.ts`:

```ts
export type TemplateEntrySurface = "design" | "video";
export type TemplateEntryBinding = { surface: TemplateEntrySurface; entry: string };
type OpenableTarget = { kind: string; value: string };

function normalizePath(path: string) {
  return path.replaceAll("\\\\", "/");
}

export function resolveTemplateEntrySurface(target: OpenableTarget, binding: TemplateEntryBinding | null | undefined): TemplateEntrySurface | null {
  if (target.kind !== "file" || !binding) return null;
  return normalizePath(target.value) === normalizePath(binding.entry) ? binding.surface : null;
}

export async function waitForTemplateEntrySurface(target: OpenableTarget, binding: Promise<TemplateEntryBinding | null>) {
  return resolveTemplateEntrySurface(target, await binding);
}
```

Delete the design-only predicate module.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm.cmd --dir apps/app exec bun test tests/design-entry-target.test.ts`

Expected: PASS with 4 tests and 0 failures.

- [ ] **Step 5: Commit the resolver and tests**

```powershell
git add apps/app/src/react-app/domains/session/templates/template-entry-route.ts apps/app/src/react-app/domains/session/design/design-entry-target.ts apps/app/tests/design-entry-target.test.ts
git commit -m "test: cover template entry surface routing"
```

### Task 2: Await the canonical binding before artifact fallback

**Files:**

- Modify: `apps/app/src/react-app/domains/session/chat/session-page.tsx:74-76,901-962`
- Modify: `apps/app/tests/design-entry-target.test.ts`

**Interfaces:**

- Consumes `waitForTemplateEntrySurface()` from Task 1.
- Consumes `getTemplateSession(workspaceId, sessionId)` and its `{ surface, state.entry }` binding.
- Produces the current `setCurrentSidePanel("design" | "video")` action before normal artifact routing.

- [ ] **Step 1: Add the delayed Video regression**

Append this test:

```ts
test("routes delayed Video metadata to Studio instead of an HTML artifact", async () => {
  let release!: (binding: { surface: "video"; entry: string } | null) => void;
  const metadata = new Promise<{ surface: "video"; entry: string } | null>((resolve) => { release = resolve; });
  const route = waitForTemplateEntrySurface({ kind: "file", value: "video/ses_video/index.html" }, metadata);
  release({ surface: "video", entry: "video/ses_video/index.html" });
  expect(await route).toBe("video");
});
```

- [ ] **Step 2: Run the test to record the current result**

Run: `pnpm.cmd --dir apps/app exec bun test tests/design-entry-target.test.ts`

Expected: the resolver test passes after Task 1; the unimplemented SessionPage integration remains the behavior under test in the next steps.

- [ ] **Step 3: Integrate the route in SessionPage**

1. Replace the design-only predicate import with `waitForTemplateEntrySurface`.
2. Add `resolveOpenTargetTemplateSurface(target, sourceSessionId)` before `openTarget`.
3. Return `null` if target/session/client are unavailable or the target belongs to another session.
4. Use loaded `templateSessionData` first; otherwise call `getTemplateSession(runtimeWorkspaceId, selectedSessionId)`, mapping lookup errors to `null`.
5. Pass only `manifest.surface` and `state.entry` to `waitForTemplateEntrySurface`.
6. Make `openTarget` asynchronous. Before `isCollectibleArtifactTarget(target)`, await the helper and run `setCurrentSidePanel(templateSurface)` for a non-null result. A null result retains the normal-file and artifact path.

The new branch is:

```ts
const templateSurface = await resolveOpenTargetTemplateSurface(target, sourceId);
if (templateSurface) {
  setCurrentSidePanel(templateSurface);
  return;
}
```

- [ ] **Step 4: Run targeted regression tests**

Run: `pnpm.cmd --dir apps/app exec bun test tests/design-entry-target.test.ts`

Expected: Design, Slides/PPTX, Video, ordinary HTML, and delayed-metadata cases pass.

- [ ] **Step 5: Run TypeScript verification**

Run: `pnpm.cmd --dir apps/app typecheck`

Expected: exit code 0.

- [ ] **Step 6: Commit the integration**

```powershell
git add apps/app/src/react-app/domains/session/chat/session-page.tsx apps/app/tests/design-entry-target.test.ts
git commit -m "fix: route template entries by surface"
```

### Task 3: Verify final scope

**Files:**

- Review: `apps/app/src/react-app/domains/session/templates/template-entry-route.ts`
- Review: `apps/app/src/react-app/domains/session/chat/session-page.tsx`
- Review: `apps/app/tests/design-entry-target.test.ts`

- [ ] **Step 1: Inspect the final diff**

Run: `git diff main...HEAD -- apps/app/src/react-app/domains/session/templates/template-entry-route.ts apps/app/src/react-app/domains/session/chat/session-page.tsx apps/app/tests/design-entry-target.test.ts`

Expected: only surface routing, tests, and SessionPage integration; no PPTX, Video Studio, or artifact-classification changes.

- [ ] **Step 2: Re-run the regression suite and typecheck**

Run: `pnpm.cmd --dir apps/app exec bun test tests/design-entry-target.test.ts; pnpm.cmd --dir apps/app typecheck`

Expected: 0 test failures and typecheck exit code 0.

- [ ] **Step 3: Confirm clean committed state**

Run: `git status --short`

Expected: no output.
