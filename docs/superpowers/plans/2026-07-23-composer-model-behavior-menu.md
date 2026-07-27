# Composer Model and Reasoning Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Composer's adjacent model and reasoning controls with a single summary menu that lets users choose either setting without changing the existing persistence behavior.

**Architecture:** Add a Composer-local `ModelBehaviorMenu` component that owns its three visual views (`root`, `model`, `behavior`) and delegates selection to the existing callbacks. Extract the reusable selectable-model query/list from the existing `ModelSelect` into an exportable content component or hook so the menu reuses the exact provider filtering and model-selection behavior rather than creating a second data path.

**Tech Stack:** React 19, TypeScript, Base UI popover/command primitives, Tailwind, Bun test.

## Global Constraints

- Change only the Composer interaction; Settings and `ModelPickerModal` behavior remain unchanged.
- Do not add reset actions, session overrides, or new persisted preference state.
- Existing callbacks remain authoritative: `onModelChange(model)` and `onModelVariantChange(value)`.
- The summary displays `model name · reasoning label`, and displays only model name if no reasoning options exist.
- Root menu contains exactly **Model** and, conditionally, **Reasoning strength**; no default/reset row.
- Model selection preserves the current route behavior; behavior selection preserves the current route behavior.
- Use `pnpm.cmd` on Windows.

---

### Task 1: Extract a reusable model-list content surface

**Files:**
- Modify: `apps/app/src/components/model-select.tsx`
- Test: `apps/app/tests/composer-model-behavior-menu.test.ts`

**Interfaces:**
- Produces: `ModelListContent` accepting `{ value: ModelRef; onChange: (model: ModelRef) => void; onConfigureModels?: () => void; autoFocus?: boolean }` and rendering the current provider-filtered searchable list.
- Consumes: the existing provider-list query, desktop restrictions, `openModelPickerEvent`, command primitives, and provider icon support from `model-select.tsx`.

- [ ] **Step 1: Write the failing source-contract test**

```ts
test("exports reusable Composer model-list content", () => {
  const source = readFileSync(modelSelectPath, "utf8");
  expect(source).toContain("export function ModelListContent");
  expect(source).toContain("onChange: (model: ModelRef) => void");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm.cmd --filter @ipollowork/app exec bun test tests/composer-model-behavior-menu.test.ts`

Expected: FAIL because `ModelListContent` does not exist.

- [ ] **Step 3: Extract the model picker list without changing selection semantics**

```tsx
export function ModelListContent({ value, onChange, onConfigureModels, autoFocus = true }: ModelListContentProps) {
  // Keep useModelOptions, groupByProvider, selection, search reset, and
  // configure-model action behavior from ModelSelect.
}

export function ModelSelect(props: ModelSelectProps) {
  return (
    <Popover /* existing open behavior */>
      <PopoverTrigger /* existing button */ />
      <PopoverContent /* existing geometry */>
        <ModelListContent
          value={props.value}
          onChange={(model) => { props.onChange(model); props.onOpenChange(false); }}
          onConfigureModels={props.onConfigureModels}
        />
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 4: Run focused test to verify it passes**

Run: `pnpm.cmd --filter @ipollowork/app exec bun test tests/composer-model-behavior-menu.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/components/model-select.tsx apps/app/tests/composer-model-behavior-menu.test.ts
git commit -m "refactor: expose reusable model picker content"
```

### Task 2: Add the combined Composer menu

**Files:**
- Create: `apps/app/src/react-app/domains/session/surface/composer/model-behavior-menu.tsx`
- Modify: `apps/app/src/react-app/domains/session/surface/composer/composer.tsx:1-16,1659-1684`
- Test: `apps/app/tests/composer-model-behavior-menu.test.ts`

**Interfaces:**
- Consumes: `selectedModel`, `modelVariant`, `modelVariantLabel`, `modelBehaviorOptions`, `onModelChange`, `onModelVariantChange`, `onConfigureModels`, and `busy` from existing Composer props.
- Consumes: `ModelListContent` from `@/components/model-select`.
- Produces: `ModelBehaviorMenu`, rendered as the Composer's only model/behavior trigger.

- [ ] **Step 1: Extend the failing source-contract test**

```ts
test("Composer uses one combined model and reasoning menu", () => {
  const composer = readFileSync(composerPath, "utf8");
  const menu = readFileSync(menuPath, "utf8");

  expect(composer).toContain("<ModelBehaviorMenu");
  expect(composer).not.toContain("<ModelSelect");
  expect(composer).not.toContain("<ModelBehaviorSelect");
  expect(menu).toContain('type MenuView = "root" | "model" | "behavior"');
  expect(menu).toContain("modelVariantLabel");
  expect(menu).toContain("onModelVariantChange");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm.cmd --filter @ipollowork/app exec bun test tests/composer-model-behavior-menu.test.ts`

Expected: FAIL because the combined menu file and render site do not exist.

- [ ] **Step 3: Implement the root and child views**

```tsx
type MenuView = "root" | "model" | "behavior";

export function ModelBehaviorMenu(props: ModelBehaviorMenuProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<MenuView>("root");
  const hasBehavior = Boolean(props.options?.length);
  const summary = hasBehavior ? `${props.modelLabel} · ${props.modelVariantLabel}` : props.modelLabel;

  // Root: Model row + conditional Reasoning strength row.
  // Model view: back button + ModelListContent; selecting calls props.onModelChange and closes.
  // Behavior view: back button + current option buttons; selecting calls props.onModelVariantChange and closes.
}
```

Replace the two control components in `composer.tsx` with:

```tsx
<ModelBehaviorMenu
  selectedModel={props.selectedModel}
  modelVariant={props.modelVariant}
  modelVariantLabel={props.modelVariantLabel}
  options={props.modelBehaviorOptions}
  onModelChange={props.onModelChange}
  onModelVariantChange={props.onModelVariantChange}
  onConfigureModels={props.onConfigureModels}
  disabled={props.busy}
/>
```

- [ ] **Step 4: Run focused test to verify it passes**

Run: `pnpm.cmd --filter @ipollowork/app exec bun test tests/composer-model-behavior-menu.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/react-app/domains/session/surface/composer/model-behavior-menu.tsx apps/app/src/react-app/domains/session/surface/composer/composer.tsx apps/app/tests/composer-model-behavior-menu.test.ts
git commit -m "feat: combine Composer model and reasoning menus"
```

### Task 3: Validate the Composer experience

**Files:**
- Verify: `apps/app/src/react-app/domains/session/surface/composer/model-behavior-menu.tsx`
- Verify: `apps/app/src/react-app/domains/session/surface/composer/composer.tsx`
- Verify: `apps/app/tests/composer-model-behavior-menu.test.ts`

**Interfaces:**
- Consumes: completed combined Composer menu implementation.
- Produces: evidence that source composition, type safety, and running desktop behavior satisfy the approved interaction.

- [ ] **Step 1: Run focused tests and related Composer contract suite**

Run: `pnpm.cmd --filter @ipollowork/app exec bun test tests/composer-model-behavior-menu.test.ts tests/composer-plus-entry-menu.test.ts`

Expected: all tests pass with zero failures.

- [ ] **Step 2: Run the app typecheck**

Run: `pnpm.cmd --filter @ipollowork/app typecheck`

Expected: exit code 0.

- [ ] **Step 3: Verify running desktop UI manually**

1. Open an existing task's Composer.
2. Confirm there is one `model · reasoning` trigger and no separate reasoning button.
3. Open it, choose **Model**, choose a model, and confirm the summary updates.
4. Open it, choose **Reasoning strength**, choose a value, and confirm the summary updates.
5. Switch to a model without behavior choices and confirm the root menu contains only **Model**.

Expected: all interactions work without changing Settings UI or adding a reset/default row.

- [ ] **Step 4: Inspect working tree**

Run: `git diff --check && git status --short`

Expected: no whitespace errors; unrelated design files remain untouched.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/components/model-select.tsx apps/app/src/react-app/domains/session/surface/composer/model-behavior-menu.tsx apps/app/src/react-app/domains/session/surface/composer/composer.tsx apps/app/tests/composer-model-behavior-menu.test.ts
git commit -m "feat: combine Composer model and reasoning menus"
```
