# Design Export Download Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the separate PDF and PPTX export buttons with one localized download dropdown while preserving both export paths and their independent loading states.

**Architecture:** Extract the toolbar control into a focused `DesignExportMenu` component that receives the two existing export callbacks and loading booleans. The component reads the current application translation at render time, while `DesignPanel` continues to own all PDF/PPTX generation and PPTX confirmation state.

**Tech Stack:** React 19, TypeScript, Base UI-backed `DropdownMenu`, Lucide icons, the existing iPolloWork i18n module, Bun tests.

## Global Constraints

- Keep the existing PDF export implementation unchanged.
- Keep the existing PPTX confirmation dialog and export implementation unchanged.
- Disable only the menu item whose format is currently being generated.
- Disable the download trigger only when PDF and PPTX are both being generated.
- Add localized copy for every currently supported locale.
- Do not refactor unrelated design-panel controls.

---

### Task 1: Localized download menu component

**Files:**
- Create: `apps/app/src/react-app/domains/session/design/design-export-menu.tsx`
- Create: `apps/app/tests/design-export-menu.test.tsx`
- Modify: `apps/app/src/i18n/locales/en.ts`
- Modify: `apps/app/src/i18n/locales/zh.ts`
- Modify: `apps/app/src/i18n/locales/ja.ts`
- Modify: `apps/app/src/i18n/locales/vi.ts`
- Modify: `apps/app/src/i18n/locales/pt-BR.ts`
- Modify: `apps/app/src/i18n/locales/th.ts`
- Modify: `apps/app/src/i18n/locales/fr.ts`
- Modify: `apps/app/src/i18n/locales/ca.ts`
- Modify: `apps/app/src/i18n/locales/es.ts`
- Modify: `apps/app/src/i18n/locales/ru.ts`

**Interfaces:**
- Consumes: `t(key)` from `@/i18n` and the existing dropdown/button components.
- Produces: `DesignExportMenu(props: { exportingPdf: boolean; exportingPptx: boolean; onExportPdf: () => void; onExportPptx: () => void }): React.ReactElement`.

- [ ] **Step 1: Write the failing component test**

Create a focused Bun test that calls the component as a pure React function, walks the returned React element tree, and asserts:

```tsx
setLocale("en");
const menu = DesignExportMenu({
  exportingPdf: false,
  exportingPptx: false,
  onExportPdf,
  onExportPptx,
});

expect(textContent(menu)).toContain("Download");
expect(textContent(menu)).toContain("Download PDF");
expect(textContent(menu)).toContain("Download PPTX");
expect(findMenuItem(menu, "Download PDF").props.disabled).toBe(false);
expect(findMenuItem(menu, "Download PPTX").props.disabled).toBe(false);
```

Add separate cases that invoke each menu item's `onClick`, verify only the matching callback runs, verify each loading boolean disables only its matching item, verify both loading booleans disable the trigger, and verify `setLocale("zh")` changes the labels to `下载`, `下载 PDF`, and `下载 PPTX`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm.cmd --filter @ipollowork/app exec bun test tests/design-export-menu.test.tsx`

Expected: FAIL because `design-export-menu.tsx` does not exist.

- [ ] **Step 3: Add translation keys to all supported locales**

Add these exact keys to every locale map:

```ts
"design.export.download": "Download",
"design.export.download_pdf": "Download PDF",
"design.export.download_pptx": "Download PPTX",
```

Use native translations for each locale. For Simplified Chinese use `下载`, `下载 PDF`, and `下载 PPTX`.

- [ ] **Step 4: Implement the minimal menu component**

Implement one outlined `Button` rendered through `DropdownMenuTrigger`, with a `Download` icon and `t("design.export.download")`. Render two `DropdownMenuItem` children aligned to the trigger's end:

```tsx
<DropdownMenuItem disabled={exportingPdf} onClick={onExportPdf}>
  {exportingPdf ? <Loader2 className="animate-spin" /> : <Download />}
  {t("design.export.download_pdf")}
</DropdownMenuItem>
<DropdownMenuItem disabled={exportingPptx} onClick={onExportPptx}>
  {exportingPptx ? <Loader2 className="animate-spin" /> : <Presentation />}
  {t("design.export.download_pptx")}
</DropdownMenuItem>
```

Set the trigger's `disabled` property to `exportingPdf && exportingPptx`. Use the localized base label for its visible text, `aria-label`, and `title`.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run: `pnpm.cmd --filter @ipollowork/app exec bun test tests/design-export-menu.test.tsx`

Expected: PASS for labels, callbacks, and loading states.

- [ ] **Step 6: Commit the component unit**

```powershell
git add -- apps/app/src/react-app/domains/session/design/design-export-menu.tsx apps/app/tests/design-export-menu.test.tsx apps/app/src/i18n/locales
git commit -m "feat: add localized design export menu"
```

### Task 2: Integrate the menu into the design toolbar

**Files:**
- Modify: `apps/app/src/react-app/domains/session/design/design-panel.tsx:1092`
- Modify: `apps/app/tests/design-export-menu.test.tsx`

**Interfaces:**
- Consumes: `DesignExportMenu` from Task 1; existing `exportDeckToPdf`, `setPptxConfirmationOpen`, `exportingPdf`, and `exportingPptx` values.
- Produces: One toolbar download control wired to both unchanged export flows.

- [ ] **Step 1: Add a failing integration assertion**

Read `design-panel.tsx` in the focused test and assert the toolbar renders one `DesignExportMenu` with the existing handlers:

```ts
expect(panelSource).toContain("<DesignExportMenu");
expect(panelSource).toContain("onExportPdf={() => void exportDeckToPdf()}");
expect(panelSource).toContain("onExportPptx={() => setPptxConfirmationOpen(true)}");
expect(panelSource).not.toContain("Export presentation to PDF");
expect(panelSource).not.toContain("Export presentation to PPTX");
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm.cmd --filter @ipollowork/app exec bun test tests/design-export-menu.test.tsx`

Expected: FAIL because `design-panel.tsx` still contains the two old buttons.

- [ ] **Step 3: Replace the old buttons with the menu**

Import `DesignExportMenu`, remove now-unused toolbar icon imports, and replace the two buttons inside the existing `deck ? ... : null` block with:

```tsx
<div className="ml-auto">
  <DesignExportMenu
    exportingPdf={exportingPdf}
    exportingPptx={exportingPptx}
    onExportPdf={() => void exportDeckToPdf()}
    onExportPptx={() => setPptxConfirmationOpen(true)}
  />
</div>
```

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```powershell
pnpm.cmd --filter @ipollowork/app exec bun test tests/design-export-menu.test.tsx tests/design-pptx-export.test.ts tests/design-pdf-export-colors.test.ts
pnpm.cmd --filter @ipollowork/app typecheck
```

Expected: all selected tests PASS and typecheck exits 0.

- [ ] **Step 5: Verify the running desktop UI**

Open a slide design in the current Electron dev app. Confirm there is one localized download button, that it opens two format choices, that PDF starts directly, that PPTX still opens the existing confirmation dialog, and that changing the app language updates all three labels.

- [ ] **Step 6: Commit the integration**

```powershell
git add -- apps/app/src/react-app/domains/session/design/design-panel.tsx apps/app/tests/design-export-menu.test.tsx
git commit -m "feat: combine presentation export controls"
```
