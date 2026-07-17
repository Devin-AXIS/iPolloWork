# 可编辑 PPTX 导出 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让幻灯片 HTML 导出为以原生 PowerPoint 文本、图片和基础形状为主、仅对不兼容视觉局部栅格化的 PPTX。

**Architecture:** 新的 `pptx-element-export.ts` 负责从一个已布局的 HTML slide 收集有序元素计划并分类为文本、图片、形状或局部回退。`design-panel.tsx` 保持 iframe 和文件下载职责，按计划把原生对象写入 PptxGenJS，并仅对回退计划调用 html2canvas。旧的全页 PNG 背景截图路径被移除；复杂 deck 背景是唯一允许的满页回退，且其捕获过程必须隐藏内容层。

**Tech Stack:** React、TypeScript、DOM `getComputedStyle`、html2canvas-pro、PptxGenJS 3.12、Bun tests。

## Global Constraints

- 修改当前运行中的 `D:\ipollo实习\iPolloWork\iPolloWork-fresh-main`，保留用户已有未提交的 PPTX 导出改动。
- 不改变 PDF 导出逻辑。
- 普通文本、图片和基础形状必须生成原生 PPTX 对象；不支持 CSS 只能局部图片化，不得默认把整页内容截图。
- CSS/JavaScript 动画在此阶段导出为静态状态，不声称为 PowerPoint 原生动画。
- 所有新增行为先写 Bun 测试并确认其在实现前失败。

---

### Task 1: 定义元素导出计划与兼容性分类

**Files:**
- Create: `apps/app/src/react-app/domains/session/design/pptx-element-export.ts`
- Create: `apps/app/tests/pptx-element-export.test.ts`

**Interfaces:**
- Produces: `collectPptxElementPlans(slide: HTMLElement): PptxElementPlan[]`
- Produces: `PptxElementPlan` with `kind: "shape" | "text" | "image" | "fallback"`, `element`, `frame`, and optional native object data.
- Produces: `pptxExportSummary(plans: readonly PptxElementPlan[]): { nativeObjectCount: number; fallbackCount: number }`.

- [ ] **Step 1: Write the failing tests**

```ts
test("keeps plain text, image and solid card native", () => {
  expect(classifyPptxElement({ tag: "p", text: "Editable", style: plainTextStyle })).toBe("text");
  expect(classifyPptxElement({ tag: "img", src: "data:image/png;base64,AA==", style: plainImageStyle })).toBe("image");
  expect(classifyPptxElement({ tag: "div", style: solidCardStyle })).toBe("shape");
});

test("uses a local fallback for unsupported visual CSS", () => {
  expect(classifyPptxElement({ tag: "div", style: { ...solidCardStyle, backgroundImage: "linear-gradient(red, blue)" } })).toBe("fallback");
  expect(classifyPptxElement({ tag: "p", text: "Glow", style: { ...plainTextStyle, textShadow: "0 1px #000" } })).toBe("fallback");
});

test("counts only native plans and local fallbacks", () => {
  expect(pptxExportSummary([{ kind: "text" }, { kind: "shape" }, { kind: "fallback" }] as PptxElementPlan[])).toEqual({ nativeObjectCount: 2, fallbackCount: 1 });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `pnpm --filter @ipollowork/app exec bun test --isolate tests/pptx-element-export.test.ts`

Expected: FAIL because `pptx-element-export.ts` and its exports do not exist.

- [ ] **Step 3: Implement the minimal classifier and plan collector**

```ts
export type PptxElementKind = "shape" | "text" | "image" | "fallback";

export type PptxElementPlan = {
  kind: PptxElementKind;
  element: HTMLElement;
  frame: PptxFrame;
  text?: PptxTextOverlay;
  shape?: PptxShapeOverlay;
};

export function pptxExportSummary(plans: readonly Pick<PptxElementPlan, "kind">[]) {
  return plans.reduce((summary, plan) => ({
    nativeObjectCount: summary.nativeObjectCount + (plan.kind === "fallback" ? 0 : 1),
    fallbackCount: summary.fallbackCount + (plan.kind === "fallback" ? 1 : 0),
  }), { nativeObjectCount: 0, fallbackCount: 0 });
}
```

Implement a depth-first collector. When an element is `fallback`, add it once and do not inspect descendants. When a container has no visual paint, recurse into children without adding an object. Skip editor/navigation/notes nodes and elements outside the slide rectangle.

- [ ] **Step 4: Run tests to verify GREEN**

Run: `pnpm --filter @ipollowork/app exec bun test --isolate tests/pptx-element-export.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit only if the worktree is clean aside from this task**

Do not commit user-owned dirty files. Record the verified task in the plan instead if unrelated work is present.

### Task 2: Replace full-slide image export with element-plan emission

**Files:**
- Modify: `apps/app/src/react-app/domains/session/design/design-panel.tsx:576-703`
- Modify: `apps/app/src/react-app/domains/session/design/pptx-export.ts`
- Modify: `apps/app/tests/design-pptx-export.test.ts`

**Interfaces:**
- Consumes: `collectPptxElementPlans` and `pptxExportSummary` from Task 1.
- Produces: PPTX slides containing `addText`, `addShape`, and local `addImage` fallback objects.

- [ ] **Step 1: Write the failing tests**

```ts
test("labels the export as editable-first and describes local visual fallbacks", () => {
  expect(PPTX_EXPORT_CONFIRMATION.title).toBe("可编辑优先导出 PPTX");
  expect(PPTX_EXPORT_CONFIRMATION.message).toContain("局部图片");
});

test("does not expose a required whole-slide background image constant", () => {
  expect(PPTX_BACKGROUND_IMAGE_FORMAT).toBeUndefined();
});
```

Also add a source-level regression test asserting the PPTX export callback calls `collectPptxElementPlans(slide)` and does not call `html2canvas(slide`.

- [ ] **Step 2: Run tests to verify RED**

Run: `pnpm --filter @ipollowork/app exec bun test --isolate tests/design-pptx-export.test.ts`

Expected: FAIL because current exporter still uses the whole-slide PNG path and current confirmation copy.

- [ ] **Step 3: Implement plan emission**

For each plan in DOM order:

```ts
if (plan.kind === "shape") pptxSlide.addShape(plan.shape.shape, plan.shape);
if (plan.kind === "text") pptxSlide.addText(plan.text.text, toPptxTextOptions(plan.text));
if (plan.kind === "image" || plan.kind === "fallback") {
  const canvas = await html2canvas(plan.element, captureOptions(plan.frame));
  pptxSlide.addImage({ data: canvas.toDataURL("image/png"), ...plan.frame });
}
```

Use a helper that captures only the selected element bounds. Remove the current `pptxSlide.addImage({ data: canvas.toDataURL(...), x: 0, y: 0, w: PPTX_SLIDE_WIDTH_INCHES, h: PPTX_SLIDE_HEIGHT_INCHES })` path. Use plan-summary data for the completion toast.

- [ ] **Step 4: Run tests to verify GREEN**

Run: `pnpm --filter @ipollowork/app exec bun test --isolate tests/design-pptx-export.test.ts tests/pptx-element-export.test.ts`

Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @ipollowork/app typecheck`

Expected: exit code 0.

### Task 3: Preserve deck background without baking content into it

**Files:**
- Modify: `apps/app/src/react-app/domains/session/design/pptx-element-export.ts`
- Modify: `apps/app/src/react-app/domains/session/design/design-panel.tsx`
- Modify: `apps/app/tests/pptx-element-export.test.ts`

**Interfaces:**
- Produces: optional `PptxBackgroundFallbackPlan` whose capture hides slide content and navigation chrome before rendering a deck-sized visual background.

- [ ] **Step 1: Write the failing tests**

```ts
test("creates no background fallback for a solid slide background", () => {
  expect(needsPptxBackgroundFallback({ backgroundImage: "none", filter: "none" })).toBe(false);
});

test("creates a background-only fallback for a complex deck background", () => {
  expect(needsPptxBackgroundFallback({ backgroundImage: "radial-gradient(red, blue)", filter: "none" })).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `pnpm --filter @ipollowork/app exec bun test --isolate tests/pptx-element-export.test.ts`

Expected: FAIL because `needsPptxBackgroundFallback` does not exist.

- [ ] **Step 3: Implement background-only capture**

If the slide/deck background has unsupported visual paint, add a first, explicitly named background fallback. The html2canvas clone callback must hide all `[data-ipw-slide]`, `section.slide`, `.slide`, `.deck-chrome`, and known navigation controls. If the background is solid, set `pptxSlide.background` instead and add no image.

- [ ] **Step 4: Run tests to verify GREEN**

Run: `pnpm --filter @ipollowork/app exec bun test --isolate tests/pptx-element-export.test.ts tests/design-pptx-export.test.ts`

Expected: PASS.

### Task 4: Verify an actual generated PPTX and document template authoring rules

**Files:**
- Modify: `packages/docs/zh/start-here/do-work-with-it/build-a-template.mdx`
- Modify: `apps/app/tests/design-slide-template.test.ts`

**Interfaces:**
- Produces: template-author guidance for editable-first slide HTML.
- Produces: a regression test ensuring the bundled pitch-deck retains identifiable text and slide semantics.

- [ ] **Step 1: Write the failing documentation/template test**

```ts
test("marks the built-in slide deck text for editable PPTX export", async () => {
  const html = await Bun.file(templateUrl).text();
  expect(html).toContain('data-ipw-text');
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `pnpm --filter @ipollowork/app exec bun test --isolate tests/design-slide-template.test.ts`

Expected: FAIL because the current built-in deck lacks editable-export semantic markers.

- [ ] **Step 3: Add minimal semantic markers and authoring guidance**

Add `data-ipw-text` to the deck's key editable text regions without changing visual styling. Document the editable-first contract: semantic text tags, `<img>` for images, basic shapes on containers, and local fallback behavior for complex CSS.

- [ ] **Step 4: Run focused tests and generate a PPTX**

Run: `pnpm --filter @ipollowork/app exec bun test --isolate tests/design-slide-template.test.ts tests/design-pptx-export.test.ts tests/pptx-element-export.test.ts && pnpm --filter @ipollowork/app typecheck`

Expected: all tests pass and TypeScript exits 0.

Using the running app, export a financing/pitch deck and inspect the generated OOXML: per slide native text boxes must exist; images must be limited to actual image/fallback regions; no default full-slide screenshot may contain slide text.

- [ ] **Step 5: Run end-to-end visual proof**

Run the repository’s applicable fraimz flow for slide editing/export if present; otherwise record the exact app actions, output filename, OOXML object counts, and PowerPoint manual verification in the final handoff.
