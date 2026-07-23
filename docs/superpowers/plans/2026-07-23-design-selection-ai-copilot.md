# Design Selection AI Copilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an AI action to the final position of the Design/PPT selection toolbar; it inserts a scoped object chip in the normal composer, applies the agent's file edit, and supports persisted Undo.

**Architecture:** The iframe editor supplies a stable CSS locator and selection summary. A session-scoped Design AI store keeps the pre-AI HTML, file revision, and target metadata. The existing composer displays an atomic purple Design chip and the normal prompt pipeline translates it into a synthetic instruction that restricts the agent to one file and one element. Completion reloads the edited Design file and makes the captured pre-image available to the Design Undo action.

**Tech Stack:** React 19, TypeScript, Zustand, Lexical, TanStack Query, existing OpenCode prompt flow, Bun tests.

## Global Constraints

- Reuse the normal session composer; do not introduce another chat surface or agent session.
- The AI icon is the final control in the existing floating toolbar.
- Do not allow slide/deck roots or runtime controls to become AI targets.
- The AI instruction must name one active Design file and one stable CSS locator, and prohibit unrelated edits.
- Never optimistically mutate the canvas; refresh only after the normal agent turn finishes.
- Persisted AI undo uses a revision guard and must not overwrite an externally changed file.
- Do not stage `design/ses_076ea9b8affe6bxZ39oVB9TYuX/brief.json` or the pre-existing untracked plan/spec documents.

---

### Task 1: Model and store Design AI contexts

**Files:**

- Create: `apps/app/src/react-app/domains/session/design/design-ai-selection.ts`
- Create: `apps/app/src/react-app/domains/session/design/design-ai-selection-store.ts`
- Create: `apps/app/tests/design-ai-selection.test.ts`

**Interfaces:**

- Produces `DesignAiSelectionContext`, `DesignAiUndoCheckpoint`, `designAiSelectionToken`, `parseDesignAiSelectionToken`, `designAiSelectionInstruction`, and `useDesignAiSelectionStore`.
- Consumed by the toolbar, composer parser, prompt sender, and Design Undo workflow.

- [ ] **Step 1: Write failing token and scope tests**

```ts
test("round-trips a Design selection chip token", () => {
  expect(parseDesignAiSelectionToken(designAiSelectionToken("design-ai-1"))).toBe("design-ai-1");
  expect(parseDesignAiSelectionToken("[design-ai:design-ai-1]")).toBeNull();
});

test("restricts the agent instruction to one element in one file", () => {
  const instruction = designAiSelectionInstruction(context);
  expect(instruction).toContain("design/ses_1/index.html");
  expect(instruction).toContain("body > h1:nth-of-type(1)");
  expect(instruction).toContain("Do not modify any other element");
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm.cmd --filter @ipollowork/app exec bun test --isolate tests/design-ai-selection.test.ts`

Expected: FAIL because the module and helpers do not exist.

- [ ] **Step 3: Implement immutable context helpers and a session store**

```ts
export type DesignAiSelectionContext = {
  id: string;
  sessionId: string;
  workspaceId: string;
  filePath: string;
  baseUpdatedAt: number | null;
  beforeHtml: string;
  target: {
    tag: string;
    label: string;
    locator: string;
    text: string;
    src: string;
    alt: string;
    styles: Record<string, string>;
  };
};

export function designAiSelectionToken(id: string) {
  return `[[design-ai:${id}]]`;
}

export function designAiSelectionInstruction(context: DesignAiSelectionContext) {
  return [
    "Design selection request:",
    `- Edit only the file: ${context.filePath}`,
    `- Edit only the selected element at CSS locator: ${context.target.locator}`,
    "- Do not modify any other element, page structure, slide, or file unless the user explicitly asks for a wider change.",
    "- Preserve unrelated content and styles.",
  ].join("\n");
}
```

The store holds contexts by ID and LIFO undo checkpoints by `{ sessionId, filePath }`. It exposes `createContext`, `markRunning`, `complete`, `fail`, `latestUndoCheckpoint`, `popUndoCheckpoint`, and `resetSession`.

- [ ] **Step 4: Verify GREEN and lifecycle behavior**

```ts
test("keeps completed checkpoints in LIFO order", () => {
  const store = useDesignAiSelectionStore.getState();
  store.complete("design-ai-1", { afterHtml: "<h1>One</h1>", afterUpdatedAt: 13 });
  expect(store.latestUndoCheckpoint("ses_1", "design/ses_1/index.html")?.beforeHtml).toContain("Original");
});
```

Run: `pnpm.cmd --filter @ipollowork/app exec bun test --isolate tests/design-ai-selection.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the isolated model/store change**

```powershell
git add -- apps/app/src/react-app/domains/session/design/design-ai-selection.ts apps/app/src/react-app/domains/session/design/design-ai-selection-store.ts apps/app/tests/design-ai-selection.test.ts
git commit -m "Add Design AI selection context"
```

### Task 2: Add a stable selection locator and final AI toolbar action

**Files:**

- Modify: `apps/app/src/react-app/domains/session/design/design-html-runtime.ts`
- Modify: `apps/app/src/react-app/domains/session/design/design-panel.tsx`
- Modify: `apps/app/tests/design-html-runtime.test.ts`
- Modify: `apps/app/tests/design-deck-navigation.test.ts`

**Interfaces:**

- Extends `DesignSelection` with `locator` and `source`.
- Extends `DesignPanelProps` with `onAskAi(context: DesignAiSelectionContext): void`.

- [ ] **Step 1: Write failing runtime and toolbar tests**

```ts
test("describes an editable element with a stable CSS locator", () => {
  const preview = buildDesignPreviewDocument("<!doctype html><html><body><section><h1>Title</h1></section></body></html>", true);
  expect(preview).toContain("const elementLocator = (element: HTMLElement)");
  expect(preview).toContain("nth-of-type");
  expect(preview).toContain("locator: elementLocator(element)");
});

test("places AI after every floating toolbar action", async () => {
  const source = await Bun.file(panelUrl).text();
  expect(source).toContain('aria-label="Ask AI about selected element"');
  expect(source.lastIndexOf('aria-label="Ask AI about selected element"')).toBeGreaterThan(source.lastIndexOf('aria-label="Toggle advanced design settings"'));
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm.cmd --filter @ipollowork/app exec bun test --isolate tests/design-html-runtime.test.ts tests/design-deck-navigation.test.ts`

Expected: FAIL because the locator and AI toolbar action are absent.

- [ ] **Step 3: Implement selection context creation**

Add `elementLocator` in the editor bridge by walking from the element to `body` and composing `tag:nth-of-type(index)` segments. Include it in every `DesignSelection`; for images, source must prefer `data-ipw-preview-src` over a preview data URL.

In `DesignPanel`, create the context only after `readLatestCanvasHtml()` captures the canvas. Use the active page path, `fileQuery.data.updatedAt`, selection metadata, and a generated ID. Append a `Sparkles` AI icon button after the advanced-settings action with `aria-label="Ask AI about selected element"` and call `onAskAi(context)`.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm.cmd --filter @ipollowork/app exec bun test --isolate tests/design-html-runtime.test.ts tests/design-deck-navigation.test.ts`

Expected: PASS including protected roots, text-only div editing, toolbar delete, and PPT canvas checks.

- [ ] **Step 5: Commit the toolbar entry point**

```powershell
git add -- apps/app/src/react-app/domains/session/design/design-html-runtime.ts apps/app/src/react-app/domains/session/design/design-panel.tsx apps/app/tests/design-html-runtime.test.ts apps/app/tests/design-deck-navigation.test.ts
git commit -m "Add Design selection AI action"
```

### Task 3: Add an atomic purple Design chip to the existing composer

**Files:**

- Modify: `apps/app/src/app/types.ts`
- Modify: `apps/app/src/react-app/domains/session/surface/composer/editor.tsx`
- Modify: `apps/app/src/react-app/domains/session/surface/session-surface.tsx`
- Modify: `apps/app/src/react-app/domains/session/chat/session-page.tsx`
- Create: `apps/app/tests/design-ai-composer.test.ts`

**Interfaces:**

- Adds `ComposerPart` variant `{ type: "design-selection"; contextId: string; label: string }`.
- `SessionPage` receives `onAskAi`, replaces a prior Design token in the current draft, and focuses the normal composer.

- [ ] **Step 1: Write failing composer tests**

```ts
test("converts one Design token into a structured composer part", () => {
  const parts = parseComposerParts("[[design-ai:design-ai-1]] make it blue", {
    mentions: {},
    pasteParts: [],
    designSelectionLabel: () => "H1 路 Original",
  });
  expect(parts).toContainEqual({ type: "design-selection", contextId: "design-ai-1", label: "H1 路 Original" });
  expect(parts).toContainEqual({ type: "text", text: " make it blue" });
});

test("renders a Design token as an atomic purple chip", async () => {
  const source = await Bun.file(editorUrl).text();
  expect(source).toContain("composer-design-selection");
  expect(source).toContain('contentEditable = "false"');
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm.cmd --filter @ipollowork/app exec bun test --isolate tests/design-ai-composer.test.ts`

Expected: FAIL because the part and Lexical node do not exist.

- [ ] **Step 3: Implement chip rendering, parsing, and insertion**

```ts
export type ComposerPart =
  | { type: "text"; text: string; synthetic?: boolean }
  | { type: "design-selection"; contextId: string; label: string };

function replaceDesignSelectionToken(draft: string, token: string) {
  const withoutPrevious = draft.replace(/\[\[design-ai:[a-zA-Z0-9_-]+\]\]\s*/g, "").trimEnd();
  return `${withoutPrevious}${withoutPrevious ? "\n" : ""}${token} `;
}
```

Create a `ComposerDesignSelectionNode` with `data-composer-token="design-selection"`, purple rounded-pill styling, the stored selection label, and `contentEditable = "false"`. Serialize it to `[[design-ai:<id>]]`; Backspace removes it atomically. Extract and export `parseComposerParts(text, input)` from `session-surface.tsx`, then have `buildDraft` use it to split this token before normal `@`, paste, skill, and slash parsing, resolve its label from the Design AI store, and create the new `ComposerPart`.

In `SessionPage`, pass `onAskAi` to `DesignPanel`; it uses the composer Zustand store to insert the token and emits `ipollowork:focusPrompt`.

- [ ] **Step 4: Verify GREEN and mention compatibility**

Run: `pnpm.cmd --filter @ipollowork/app exec bun test --isolate tests/design-ai-composer.test.ts tests/mention-encoding.test.ts`

Expected: PASS with unchanged agent/file/app mention encoding.

- [ ] **Step 5: Commit composer integration**

```powershell
git add -- apps/app/src/app/types.ts apps/app/src/react-app/domains/session/surface/composer/editor.tsx apps/app/src/react-app/domains/session/surface/session-surface.tsx apps/app/src/react-app/domains/session/chat/session-page.tsx apps/app/tests/design-ai-composer.test.ts
git commit -m "Add Design selection composer chip"
```

### Task 4: Scope the agent turn, refresh changed Design HTML, and persistently undo it

**Files:**

- Modify: `apps/app/src/react-app/shell/session-route.tsx`
- Modify: `apps/app/src/react-app/domains/session/sync/runtime-sync.tsx`
- Modify: `apps/app/src/react-app/domains/session/design/design-panel.tsx`
- Modify: `apps/app/src/react-app/domains/session/design/design-ai-selection-store.ts`
- Create: `apps/app/tests/design-ai-session-route.test.ts`
- Modify: `apps/app/tests/design-ai-selection.test.ts`

**Interfaces:**

- Consumes a `design-selection` part and context store record.
- Completes a context only with `{ afterHtml, afterUpdatedAt }` when the agent actually changed the active file.
- Uses the existing `session.status` / `session.idle` sync callbacks to detect that the normal agent turn has completed; `promptAsync` only enqueues the turn and must not trigger completion itself.

- [ ] **Step 1: Write failing send, refresh, and undo tests**

```ts
test("expands the selected Design chip to a synthetic scoped agent instruction", async () => {
  const parts = await draftToParts(draftWithDesignSelection, "C:/workspace");
  expect(parts[0]).toMatchObject({ type: "text", synthetic: true });
  expect(JSON.stringify(parts[0])).toContain("Do not modify any other element");
});

test("writes the AI pre-image with the post-agent revision during undo", async () => {
  const source = await Bun.file(panelUrl).text();
  expect(source).toContain("baseUpdatedAt: checkpoint.afterUpdatedAt");
  expect(source).toContain("Could not undo the AI Design change because the file changed");
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm.cmd --filter @ipollowork/app exec bun test --isolate tests/design-ai-session-route.test.ts tests/design-ai-selection.test.ts`

Expected: FAIL because Design selection parts do not reach the prompt flow or persisted undo.

- [ ] **Step 3: Implement preflight, completion, refresh, and undo**

Export `draftToParts` and add an optional `designSelectionStore` dependency for its test. Turn a valid `design-selection` part into `{ type: "text", text: designAiSelectionInstruction(context), synthetic: true }`, preserving the user request as a separate normal text part.

Immediately before `promptAsync`, read `context.filePath`; reject a stale revision; write `context.beforeHtml` with `baseUpdatedAt: current.updatedAt`; then mark the context running. `promptAsync` only submits the turn, so it must not reread or complete the context. Pass an `onSessionStatus` callback through `ReactSessionRuntime`; on the next `session.idle` for the running Design context, reread the file. If changed from `beforeHtml`, complete the context with the post-agent HTML/revision; otherwise mark the context completed-without-change and create no undo checkpoint.

`DesignPanel` observes the completed context for its active session/file, reloads `afterHtml`, increments `previewRevision`, and retains the checkpoint. Its existing Undo first uses local canvas history; when it is empty it writes `checkpoint.beforeHtml` with `baseUpdatedAt: checkpoint.afterUpdatedAt`, reloads the result, then removes the checkpoint. On write conflict, retain the checkpoint and show `Could not undo the AI Design change because the file changed. Reload before trying again.`

- [ ] **Step 4: Verify GREEN and Design regressions**

Run:

```powershell
pnpm.cmd --filter @ipollowork/app exec bun test --isolate tests/design-ai-session-route.test.ts tests/design-ai-selection.test.ts tests/design-html-runtime.test.ts tests/design-deck-navigation.test.ts tests/design-preview-height.test.ts tests/presentation-canvas.test.ts
pnpm.cmd --filter @ipollowork/app typecheck
git diff --check
```

Expected: all tests pass, TypeScript exits 0, and `git diff --check` prints no errors.

- [ ] **Step 5: Validate the real Electron flow and commit**

1. Select a title and confirm the final floating-toolbar action is `Ask AI about selected element`.
2. Click it and confirm the normal composer focuses with one purple title chip.
3. Repeat for an image and confirm the chip label uses its original source filename instead of a preview data URL.
4. Send a narrow request, wait for the agent, and confirm the active canvas file refreshes.
5. Click Design Undo and confirm the original title/image source and workspace file return.
6. Confirm protected slide roots do not expose AI.

```powershell
git add -- apps/app/src/app/types.ts apps/app/src/react-app/domains/session/design/design-ai-selection.ts apps/app/src/react-app/domains/session/design/design-ai-selection-store.ts apps/app/src/react-app/domains/session/design/design-html-runtime.ts apps/app/src/react-app/domains/session/design/design-panel.tsx apps/app/src/react-app/domains/session/chat/session-page.tsx apps/app/src/react-app/domains/session/surface/composer/editor.tsx apps/app/src/react-app/domains/session/surface/session-surface.tsx apps/app/src/react-app/domains/session/sync/runtime-sync.tsx apps/app/src/react-app/shell/session-route.tsx apps/app/tests/design-ai-selection.test.ts apps/app/tests/design-ai-composer.test.ts apps/app/tests/design-ai-session-route.test.ts apps/app/tests/design-html-runtime.test.ts apps/app/tests/design-deck-navigation.test.ts apps/app/tests/design-preview-height.test.ts
git commit -m "Add AI editing for selected Design elements"
```


