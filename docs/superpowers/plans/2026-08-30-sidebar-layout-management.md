# Sidebar Layout Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent project ordering, Session ordering, and UI-only Session reassignment between sidebar projects without changing engine-owned Session data.

**Architecture:** A small Zustand persisted store owns layout metadata keyed by work context. The sidebar derives visible project/session rows from that store, carries each Session's source Workspace ID through rendering, and handles native HTML drag/drop locally. Server routes and engine runtimes remain unchanged.

**Tech Stack:** React, TypeScript, Zustand 5, native HTML5 drag/drop, Bun tests.

**Spec:** `docs/superpowers/specs/2026-08-30-sidebar-layout-management-design.md`

## Global Constraints

- Do not mutate Session engine data, cwd, history, or project files.
- Do not add a dependency; use the existing Zustand dependency and native drag/drop.
- Preserve all existing click, context-menu, rename, archive, delete, and expand behavior.
- Keep source Workspace ID separate from the sidebar display container Workspace ID.
- Do not touch unrelated existing worktree changes.

---

### Task 1: Add the persisted sidebar layout model

**Files:**
- Create: `apps/app/src/react-app/domains/session/sidebar/sidebar-layout-store.ts`
- Modify: `apps/app/tests/sidebar-projects.test.ts`

**Interfaces:**
- Produces `SidebarLayoutState`, `sessionLayoutKey`, `normalizeSidebarLayout`, and the `useSidebarLayoutStore` actions used by the sidebar.

- [x] **Step 1: Write failing pure-state tests**

Add tests for project reorder, moving a Session to another project, root Session reorder, and pruning stale IDs. The tests must assert that only layout metadata changes.

- [x] **Step 2: Run the focused test and verify failure**

Run `bun test apps/app/tests/sidebar-projects.test.ts`.
Expected: FAIL because the new store module and actions do not exist.

- [x] **Step 3: Implement the store**

Implement a persisted Zustand store with:

```ts
type SidebarLayoutState = {
  projectOrderByContext: Record<string, string[]>;
  sessionOrderByProject: Record<string, string[]>;
  sessionProjectByKey: Record<string, string>;
  reorderProjects: (contextId: string, sourceId: string, targetId: string) => void;
  moveSession: (sessionKey: string, targetProjectId: string) => void;
  reorderSessions: (projectId: string, sourceKey: string, targetKey: string) => void;
  prune: (input: { contextId: string; projectIds: string[]; sessionKeys: string[] }) => void;
};
```

Use `createJSONStorage(() => localStorage)` with name `ipollowork.react.sidebarLayout.v1`. Reorder functions must be no-ops for unknown or identical IDs and must preserve unlisted IDs. `prune` must remove stale IDs and reset a Session assignment to its source project when the target no longer exists.

- [x] **Step 4: Run the focused test and verify pass**

Run `bun test apps/app/tests/sidebar-projects.test.ts`.
Expected: PASS for all new store tests and all existing sidebar tests.

### Task 2: Wire source Workspace identity and derive ordered rows

**Files:**
- Modify: `apps/app/src/react-app/domains/session/sidebar/utils.ts`
- Modify: `apps/app/src/react-app/domains/session/sidebar/app-sidebar.tsx`
- Modify: `apps/app/src/react-app/domains/session/sidebar/app-sidebar-provider.tsx`
- Modify: `apps/app/src/react-app/domains/session/chat/session-page.tsx`
- Modify: `apps/app/src/react-app/shell/session-route.tsx`

**Interfaces:**
- Consumes the store from Task 1.
- Produces ordered project data and `FlattenedSessionRow.sourceWorkspaceId` for drag rendering and action routing.

- [x] **Step 1: Add a failing derivation test**

Test that a moved Session appears under the target project but retains its original Workspace ID, and that unknown layout IDs are pruned from derived output.

- [x] **Step 2: Run the focused test and verify failure**

Run `bun test apps/app/tests/sidebar-projects.test.ts`.
Expected: FAIL because the sidebar derivation does not yet consume layout state.

- [x] **Step 3: Implement derivation and routing**

Add an optional `workContextId` to sidebar props, pass `activeWorkContextId` from `session-route`, order projects from the store, and build display project lists by assigning each Session to its stored target project while attaching `sourceWorkspaceId`. Pass `sourceWorkspaceId` to Session actions and navigation. Call `prune` after project/session lists are available.

- [x] **Step 4: Run focused tests**

Run `bun test apps/app/tests/sidebar-projects.test.ts`.
Expected: PASS with existing project/sidebar behavior unchanged.

### Task 3: Add native drag/drop interactions

**Files:**
- Modify: `apps/app/src/react-app/domains/session/sidebar/app-sidebar.tsx`
- Modify: `apps/app/tests/sidebar-projects.test.ts`

**Interfaces:**
- Consumes ordered rows and source Workspace identity from Task 2.
- Produces project reorder, Session move, and Session reorder callbacks backed by the persisted store.

- [x] **Step 1: Add source-level interaction tests**

Assert that project and Session rows expose `draggable`, `onDragStart`, `onDragOver`, `onDrop`, and a drop-target highlight class; assert that Session actions still call the source Workspace ID.

- [x] **Step 2: Run the focused test and verify failure**

Run `bun test apps/app/tests/sidebar-projects.test.ts`.
Expected: FAIL because the sidebar rows have no drag/drop handlers.

- [x] **Step 3: Implement drag/drop**

Use a local drag payload discriminated by `project` or `session`. Project rows reorder within the active work context. Session rows dropped on a project move their layout assignment; Session rows dropped on another Session first assign to that Session's project and then reorder. Prevent drops onto the same item, stop propagation from action buttons, and clear drag state on `dragend`.

- [x] **Step 4: Run focused tests**

Run `bun test apps/app/tests/sidebar-projects.test.ts`.
Expected: PASS.

### Task 4: Verify build-level safety and document behavior

**Files:**
- Modify: `apps/app/tests/sidebar-projects.test.ts` if additional regression coverage is needed.

- [x] **Step 1: Run targeted tests**

Run `bun test apps/app/tests/sidebar-projects.test.ts`.
Expected: PASS.

- [x] **Step 2: Run TypeScript/app validation available in the repository**

Run the app's documented typecheck/build command from `apps/app/package.json`; do not install dependencies. Expected: no new type errors.

- [x] **Step 3: Inspect the diff**

Run `git diff --check` and `git diff --stat`. Confirm only the new sidebar layout files and directly related tests/components changed; leave unrelated pre-existing modifications untouched.
