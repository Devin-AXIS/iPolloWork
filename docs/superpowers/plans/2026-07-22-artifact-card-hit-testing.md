# Artifact Card Hit Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make visible transcript artifact cards receive pointer clicks after restoring a saved scroll position.

**Architecture:** Keep scroll-state persistence unchanged. Replace direct DOM `scrollTop` writes in the session scroll controller with one clamped transient-anchor `scrollIntoView` helper, which forces Electron's visual compositor and DOM hit-test coordinates to share the same scroll update path.

**Tech Stack:** React, TypeScript, Bun test, Electron WebView.

## Global Constraints

- Keep the diff limited to transcript scrolling and its regression test.
- Do not modify artifact-card rendering or artifact preview routing.
- Use pnpm and Bun commands only.

---

### Task 1: Synchronize immediate programmatic transcript scrolling

**Files:**
- Modify: `apps/app/src/react-app/domains/session/surface/scroll-controller.ts`
- Test: `apps/app/tests/scroll-controller.test.ts`

**Interfaces:**
- Produces: `syncProgrammaticScrollTop(container: HTMLElement, top: number, behavior?: ScrollBehavior): number`, which clamps `top`, calls `scrollIntoView` on a temporary positioned anchor, removes it, and returns the clamped value.
- Consumes: the existing `scrollToBottom` and session-restoration flows in `useSessionScrollController`.

- [x] **Step 1: Write the failing test**

```ts
test("uses a transient anchor to synchronize immediate transcript positioning", () => {
  const source = readFileSync(controllerPath, "utf8");

  expect(source).toContain('container.ownerDocument.createElement("span")');
  expect(source).toContain('behavior: ScrollBehavior = "auto"');
  expect(source).toContain('anchor.scrollIntoView({ block: "start", inline: "nearest", behavior })');
  expect(source).toContain("anchor.remove()");
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @ipollowork/app exec bun test tests/scroll-controller.test.ts`

Expected: FAIL because the transient anchor helper does not exist and direct
`scrollTop` assignment remains.

- [x] **Step 3: Implement the minimal controller change**

```ts
function syncProgrammaticScrollTop(container: HTMLElement, top: number, behavior: ScrollBehavior = "auto") {
  const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
  const clampedTop = Math.min(Math.max(0, top), maxScrollTop);
  const anchor = container.ownerDocument.createElement("span");
  anchor.style.cssText = `position:absolute;top:${clampedTop}px;left:0;width:1px;height:1px;pointer-events:none;`;
  container.append(anchor);
  anchor.scrollIntoView({ block: "start", inline: "nearest", behavior });
  anchor.remove();
  return clampedTop;
}
```

Use the helper for bottom jumps and saved manual-scroll restoration, updating
`lastKnownScrollTopRef` from its return value.

- [x] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @ipollowork/app exec bun test tests/scroll-controller.test.ts`

Expected: PASS with one passing test.

- [x] **Step 5: Run type checking**

Run: `pnpm --filter @ipollowork/app typecheck`

Expected: exit code 0.

- [x] **Step 6: Verify the user-facing regression in Electron**

Bring the visible `entry.html` card into view, click its center using pointer
input, and assert that the right-side tab button named `Select tab: entry.html`
is visible.
