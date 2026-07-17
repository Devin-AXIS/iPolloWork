# PPTX-Compatible Template System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` or `executing-plans` to implement task-by-task with tests before production code.

**Goal:** Add a distinct, native-editable PPTX template family that is visibly identified and prioritized for slide creation, without changing legacy visual-first templates.

**Architecture:** Template manifests opt into `pptxCompatibility: "native-editable"`. The catalog sorts opted-in slide templates first. Their HTML uses a small, declarative `data-pptx-*` vocabulary; the exporter maps that vocabulary directly to PowerPoint text, shape, and image objects and rejects unsupported visuals instead of rasterizing the whole slide.

**Tech Stack:** TypeScript, React, Bun tests, PptxGenJS, bundled HTML templates.

## Global Constraints

- Preserve all existing templates and their visual-first export behavior.
- Do not use a whole-slide raster image for `native-editable` exports.
- Do not use template-name conditionals in the native exporter.
- Use only the declared `data-pptx-shape`, `data-pptx-text`, `data-pptx-image`, and `data-pptx-ignore` semantic contract.
- Block native export when the compatible contract is violated; do not silently substitute a screenshot.
- Keep changes local; do not commit or push.

---

### Task 1: Template Capability Metadata

**Files:**
- Modify: `packages/types/src/templates.ts`
- Modify: `apps/server/src/templates.ts`
- Test: `apps/server/src/templates.test.ts`

- [ ] Add an optional `pptxCompatibility` manifest field whose only current opt-in value is `native-editable`.
- [ ] Add a shared `isPptxCompatibleTemplate` predicate.
- [ ] Sort native-editable slide templates before visual-first slide templates while preserving category and title ordering elsewhere.
- [ ] Test manifest parsing and catalog ordering.

### Task 2: Native PPTX Export Contract

**Files:**
- Create: `apps/app/src/react-app/domains/session/design/pptx-compatible-export.ts`
- Modify: `apps/app/src/react-app/domains/session/design/design-panel.tsx`
- Modify: `apps/app/src/react-app/domains/session/design/deck-export.ts`
- Test: `apps/app/tests/design-pptx-compatible-export.test.ts`

- [ ] Define an HTML contract for slide backgrounds, native shapes, rich text, images, and ignored preview controls.
- [ ] Convert marked DOM elements into PptxGenJS shapes, rich text runs, and images in document order.
- [ ] Validate unsupported CSS and unmarked visible content before writing a native PPTX.
- [ ] Route manifest opt-ins to native export and keep legacy templates on their visual-first fallback.

### Task 3: PPTX-Compatible Templates

**Files:**
- Create: `apps/server/bundled-templates/ipollowork.pptx-compatible-brief/*`
- Create: `apps/server/bundled-templates/ipollowork.pptx-compatible-pitch/*`
- Create: `apps/server/bundled-templates/ipollowork.pptx-compatible-report/*`
- Test: `apps/app/tests/design-pptx-compatible-template.test.ts`
- Test: `apps/server/src/templates.test.ts`

- [ ] Add three 16:9 templates with explicit `pptxCompatibility: "native-editable"` metadata.
- [ ] Mark every exported visual element with the native contract and exclude presentation controls.
- [ ] Ship distinct 960 by 540 PNG template covers and editable design tokens.
- [ ] Test that each template has semantic export markers and does not use unsupported visual effects.

### Task 4: Clear Product Signaling

**Files:**
- Modify: `apps/app/src/react-app/domains/session/templates/template-market-dialog.tsx`
- Modify: `apps/app/src/react-app/domains/session/chat/session-page.tsx`
- Modify: `apps/app/src/components/chat/new-conversation-starter.tsx`
- Modify: `apps/app/src/i18n/locales/*.ts`
- Test: `apps/app/tests/template-pptx-compatibility.test.ts`

- [ ] Show a `PPTX-compatible` badge wherever slide templates are chosen or previewed.
- [ ] Preserve normal labels for legacy templates.
- [ ] Verify that catalog consumers receive the compatible templates first.

### Verification

- [ ] Run targeted Bun tests for metadata, templates, and native exporter.
- [ ] Run app typecheck and production build.
- [ ] Generate a native PPTX from a compatible template and inspect OOXML: native text and shapes must exist, and no full-slide image relationship may exist.
