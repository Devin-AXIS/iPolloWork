# Faithful Text Animation Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore all 13 migrated caption effects as faithful, editable selected-text animations using the deleted registry implementations as the visual oracle.

**Architecture:** Extend the semantic motion compiler with a typed `StructuredTextRecipe` that describes split units, generated layers, deterministic runtime data, and multiple GSAP tracks. Core validates and compiles recipes, Studio executes the compiled recipe for preview, and Studio Server persists the same compiled recipe with reversible generated DOM. Existing single-target presets remain on the current keyframe path.

**Tech Stack:** TypeScript, React, GSAP 3, linkedom, Vitest, Puppeteer, HyperFrames Core/Studio/Studio Server.

## Global Constraints

- Deleted implementations at commit `16fd0b9b4bbf57493c4a7cf3a7004f3aae429982^` are the behavioral source of truth.
- Preview and saved playback execute the same compiled recipe.
- Generated helper nodes are tagged, deterministic, removable, and never accumulate on reapply.
- Applying, editing, replacing, or removing preserves the original text value and unrelated authored children.
- Variable-bound text must retain required per-word or per-character behavior and rebuild after value changes.
- Recipe kinds, layers, properties, counts, and assets are allow-listed; no free-form JavaScript is accepted.
- Existing non-structured semantic motion presets remain behaviorally unchanged.
- Defaults reproduce the old demo; user controls are bounded and round-trip through saved metadata.
- A whole-box flash or generic single-target approximation is a failing visual result.

---

### Task 1: Structured Recipe Contract and Compiler

**Files:**
- Create: `vendor/hyperframes/packages/core/src/structuredTextMotion.ts`
- Create: `vendor/hyperframes/packages/core/src/structuredTextMotion.test.ts`
- Modify: `vendor/hyperframes/packages/core/src/motionPresets.ts`
- Modify: `vendor/hyperframes/packages/core/src/motionPresetCatalog.ts`
- Modify: `vendor/hyperframes/packages/core/src/index.ts`

**Interfaces:**
- Produces `StructuredTextRecipe`, `CompiledStructuredTextMotion`, `isStructuredTextPreset`, `compileStructuredTextMotion(instance, text)` and `structuredMotionSelector(base, role)`.
- `CompiledMotion` gains optional `structured?: CompiledStructuredTextMotion`; ordinary `keyframes` remains supported.

- [ ] **Step 1: Write failing contract tests**

Add tests proving Highlight compiles to word units with `word`, `background`, and `text` roles; recipes reject unknown roles/properties and more than 96 generated particles; identical input produces deep-equal output; ordinary `element.enter.fade` remains unstructured.

```ts
expect(compileStructuredTextMotion(instance, "Make motion clear")).toMatchObject({
  split: "word",
  units: [{ sourceText: "Make" }, { sourceText: "motion" }, { sourceText: "clear" }],
  tracks: expect.arrayContaining([
    expect.objectContaining({ role: "background", stagger: 0.05 }),
  ]),
});
```

- [ ] **Step 2: Run RED**

Run: `pnpm.cmd --dir vendor/hyperframes/packages/core exec vitest run src/structuredTextMotion.test.ts`

Expected: FAIL because the structured recipe exports do not exist.

- [ ] **Step 3: Implement the typed contract**

Use allow-listed types; do not store executable callbacks in recipes.

```ts
export type StructuredTextRole =
  | "unit" | "text" | "background" | "clone-primary" | "clone-accent"
  | "mask" | "texture" | "particle-container" | "particle";

export interface CompiledStructuredTrack {
  role: StructuredTextRole;
  keyframes: MotionKeyframe[];
  position: number;
  duration: number;
  stagger: number;
}

export interface CompiledStructuredTextMotion {
  version: 1;
  recipeId: string;
  split: MotionTextUnit;
  units: Array<{ index: number; sourceText: string }>;
  layers: Array<{ role: StructuredTextRole; perUnit: boolean; className: string }>;
  tracks: CompiledStructuredTrack[];
  particles?: Array<{ unitIndex: number; x: number; y: number; size: number; delay: number }>;
  assets?: string[];
  seed: number;
}
```

Create deterministic grapheme/word segmentation and seeded number generation. Validate every property against the existing finite mutation safety rules and explicit structural bounds.

- [ ] **Step 4: Add Highlight recipe compilation**

Highlight must compile separate per-word background and text tracks. The background track starts at `scaleX: 0, opacity: 0`, expands to `scaleX: 1, opacity: 1` from the requested direction, then fades and resets. It must not animate the selected element's `backgroundColor`.

- [ ] **Step 5: Run GREEN and regression**

Run:

```powershell
pnpm.cmd --dir vendor/hyperframes/packages/core exec vitest run src/structuredTextMotion.test.ts src/motionPresets.test.ts
pnpm.cmd --dir vendor/hyperframes/packages/core build
```

Expected: all tests pass and build exits 0.

- [ ] **Step 6: Commit**

```powershell
git add vendor/hyperframes/packages/core/src
git commit -m "feat(motion): add structured text recipe compiler"
```

### Task 2: Reversible Persistence and Highlight End-to-End

**Files:**
- Create: `vendor/hyperframes/packages/studio-server/src/helpers/structuredTextMotionDom.ts`
- Create: `vendor/hyperframes/packages/studio-server/src/helpers/structuredTextMotionDom.test.ts`
- Modify: `vendor/hyperframes/packages/studio-server/src/routes/files.ts`
- Modify: `vendor/hyperframes/packages/studio-server/src/routes/motionPresets.test.ts`
- Modify: `vendor/hyperframes/packages/studio/src/components/editor/SemanticMotionPanel.tsx`
- Create: `vendor/hyperframes/packages/studio/src/components/editor/structuredMotionPreview.ts`
- Create: `vendor/hyperframes/packages/studio/src/components/editor/structuredMotionPreview.test.ts`
- Modify: `vendor/hyperframes/packages/studio/src/components/editor/SemanticMotionPanel.test.tsx`

**Interfaces:**
- Consumes `CompiledStructuredTextMotion` from Task 1.
- Produces `materializeStructuredMotion(target, compiled, document)`, `removeStructuredMotion(target, motionId)`, and `previewStructuredMotion(target, compiled, gsap)`.

- [ ] **Step 1: Write failing DOM lifecycle tests**

Test apply, reapply, replace, remove, variable-text rehydrate, and authored-child preservation. Assert one background layer per word, no duplicate helpers, and exact restored text.

- [ ] **Step 2: Run RED**

Run:

```powershell
pnpm.cmd --dir vendor/hyperframes/packages/studio-server exec vitest run src/helpers/structuredTextMotionDom.test.ts src/routes/motionPresets.test.ts
pnpm.cmd --dir vendor/hyperframes/packages/studio exec vitest run src/components/editor/structuredMotionPreview.test.ts src/components/editor/SemanticMotionPanel.test.tsx
```

Expected: FAIL because materialization and structured preview do not exist.

- [ ] **Step 3: Implement reversible generated DOM**

Generated wrappers and layers must carry `data-ipw-motion-owner`, `data-ipw-motion-unit`, and `data-ipw-motion-role`. Store the original text in semantic metadata, not an unsafe executable attribute. Removal deletes only nodes owned by the motion id and reconstructs the source text.

- [ ] **Step 4: Persist structured GSAP tracks**

When `compiled.structured` exists, `executeMotionMutation` materializes layers and emits one GSAP tween per compiled track with stable ids derived from motion id and role. Replacing the phase removes every old track and helper owned by that motion before creating the new recipe.

- [ ] **Step 5: Use the same executor in Studio preview**

Replace the direct single-target `timeline.to` path for structured presets with `previewStructuredMotion`. Cleanup must restore the preview DOM and inline styles when the draft changes or the component unmounts.

- [ ] **Step 6: Verify Highlight visually and functionally**

Use Puppeteer against the current project to apply Highlight to `Duty, not consequence.` Assert four word units and four background layers, then capture start/peak/exit screenshots. Confirm the red bar expands horizontally behind each word rather than changing the h1 box background.

- [ ] **Step 7: Run GREEN and builds**

Run the four focused test files, then build Core, Studio Server, Studio, and CLI. Expected: zero failures and all builds exit 0.

- [ ] **Step 8: Commit**

```powershell
git add vendor/hyperframes/packages/studio-server/src vendor/hyperframes/packages/studio/src/components/editor
git commit -m "feat(motion): restore structured highlight sweep"
```

### Task 3: Split, Mask, and Fill Recipes

**Files:**
- Modify: `vendor/hyperframes/packages/core/src/structuredTextMotion.ts`
- Modify: `vendor/hyperframes/packages/core/src/structuredTextMotion.test.ts`
- Modify: `vendor/hyperframes/packages/core/src/motionPresetCatalog.ts`
- Modify: `vendor/hyperframes/packages/studio-server/src/helpers/structuredTextMotionDom.ts`
- Modify: `vendor/hyperframes/packages/studio-server/src/helpers/structuredTextMotionDom.test.ts`

**Interfaces:**
- Adds recipe ids for Matrix Decode, Gradient Fill, Clip Wipe, and Weight Shift without changing Task 1 public signatures.

- [ ] **Step 1: Write failing per-effect structure tests**

Assert Matrix creates character units with deterministic glyph sequences; Gradient creates a fill/mask layer; Clip Wipe creates overflow-hidden word masks with directional tracks; Weight Shift creates per-word `fontVariationSettings` or `fontWeight` tracks.

- [ ] **Step 2: Run RED**

Run the Core and Studio Server structured-motion tests. Expected: four recipe assertions fail.

- [ ] **Step 3: Implement from deleted sources**

Read each full old component from `16fd0...^` before implementing. Copy timing proportions, split cadence, colors, and structural roles into typed recipes. Use seeded glyph tables for Matrix and preserve original text in a dedicated text layer.

- [ ] **Step 4: Add bounded parameter schemas**

Expose only the parameters listed in the design acceptance matrix. Defaults must use old demo values. Keep variable-bound text split for Matrix, Clip Wipe, and Weight Shift.

- [ ] **Step 5: Run GREEN and commit**

Run focused Core/Server tests and both builds. Commit as `feat(motion): restore split and fill text effects`.

### Task 4: Clone and Blend Recipes

**Files:**
- Modify: `vendor/hyperframes/packages/core/src/structuredTextMotion.ts`
- Modify: `vendor/hyperframes/packages/core/src/structuredTextMotion.test.ts`
- Modify: `vendor/hyperframes/packages/core/src/motionPresetCatalog.ts`
- Modify: `vendor/hyperframes/packages/studio-server/src/helpers/structuredTextMotionDom.ts`
- Modify: `vendor/hyperframes/packages/studio-server/src/helpers/structuredTextMotionDom.test.ts`

**Interfaces:**
- Adds Neon Glow, Neon Accent, RGB Glitch, and Blend Difference using existing clone roles.

- [ ] **Step 1: Write failing clone-layer tests**

Assert Neon Glow and Neon Accent compile distinct layer/track sets; RGB Glitch creates base, red, and cyan channels with old snap cadence; Blend Difference retains the old blend mode and readability behavior.

- [ ] **Step 2: Run RED**

Run focused Core/Server tests. Expected: clone and blend assertions fail.

- [ ] **Step 3: Implement from deleted sources**

Preserve old timing ratios and channel offsets. Clones must use `aria-hidden="true"`, remain pointer-inert, and never contribute duplicate accessible text.

- [ ] **Step 4: Run GREEN and commit**

Run focused tests and builds. Commit as `feat(motion): restore neon glitch and blend effects`.

### Task 5: Generated Layers and Asset Recipes

**Files:**
- Modify: `vendor/hyperframes/packages/core/src/structuredTextMotion.ts`
- Modify: `vendor/hyperframes/packages/core/src/structuredTextMotion.test.ts`
- Modify: `vendor/hyperframes/packages/core/src/motionPresetCatalog.ts`
- Modify: `vendor/hyperframes/packages/studio-server/src/helpers/structuredTextMotionDom.ts`
- Modify: `vendor/hyperframes/packages/studio-server/src/helpers/structuredTextMotionDom.test.ts`
- Restore or relocate required texture assets under `vendor/hyperframes/packages/studio/public/motion-assets/texture-fill/`

**Interfaces:**
- Adds Texture Fill, Kinetic Slam, Emoji Pop, and Particle Burst recipes and allow-listed texture asset resolution.

- [ ] **Step 1: Write failing generated-layer tests**

Assert Texture references only allow-listed bundled assets; Kinetic Slam reproduces old launch/impact/settle stages; Emoji Pop segments graphemes without splitting emoji sequences; Particle Burst creates deterministic bounded particles around word anchors.

- [ ] **Step 2: Run RED**

Run Core/Server tests. Expected: four recipe assertions fail.

- [ ] **Step 3: Restore assets and recipes from deleted sources**

Restore only assets actually used by the default/available texture choices. Particle count must be derived from bounded density and capped at 96. Generated visual nodes are `aria-hidden` and pointer-inert.

- [ ] **Step 4: Run GREEN and commit**

Run focused tests and builds. Commit as `feat(motion): restore generated text effects`.

### Task 6: Shared Template Preview and 13-Effect Visual Gate

**Files:**
- Modify: `vendor/hyperframes/packages/studio/src/components/sidebar/AnimationTemplatesTab.tsx`
- Modify: `vendor/hyperframes/packages/studio/src/components/sidebar/AnimationTemplatesTab.test.ts`
- Create: `vendor/hyperframes/packages/studio/src/components/sidebar/StructuredMotionThumbnail.tsx`
- Create: `vendor/hyperframes/packages/studio/src/components/sidebar/StructuredMotionThumbnail.test.tsx`
- Create: `vendor/hyperframes/packages/studio/test/faithfulTextMotion.visual.test.ts`
- Create: `vendor/hyperframes/packages/studio/test/fixtures/faithful-text-motion.html`

**Interfaces:**
- Uses the same structured preview executor from Task 2 for cards and canvas.
- Produces one visual regression suite covering all 13 presets at start, peak, settle, and exit.

- [ ] **Step 1: Write failing thumbnail tests**

Assert migrated cards render the real recipe executor rather than static `Make motion clear.` text and clean up animation timelines when scrolled/unmounted.

- [ ] **Step 2: Run RED**

Run AnimationTemplates and StructuredMotionThumbnail tests. Expected: FAIL because cards still use static previews.

- [ ] **Step 3: Implement shared animated thumbnails**

Use compact sample text and the preset defaults. Pause animation when the card is outside the viewport. Respect reduced motion by showing the recipe peak state.

- [ ] **Step 4: Build the old-vs-new visual fixture**

Load deleted demo markup as the reference side and the selected-text recipe as the candidate side with matched dimensions, text, font, and time. Assert required layer counts and motion direction before screenshot comparison.

- [ ] **Step 5: Run full verification**

Run:

```powershell
pnpm.cmd --dir vendor/hyperframes/packages/core exec vitest run src/motionPresets.test.ts src/structuredTextMotion.test.ts
pnpm.cmd --dir vendor/hyperframes/packages/studio-server exec vitest run src/helpers/structuredTextMotionDom.test.ts src/routes/motionPresets.test.ts
pnpm.cmd --dir vendor/hyperframes/packages/studio exec vitest run src/components/editor/SemanticMotionPanel.test.tsx src/components/editor/structuredMotionPreview.test.ts src/components/sidebar/AnimationTemplatesTab.test.ts src/components/sidebar/StructuredMotionThumbnail.test.tsx
pnpm.cmd --dir vendor/hyperframes/packages/core build
pnpm.cmd --dir vendor/hyperframes/packages/studio-server build
pnpm.cmd --dir vendor/hyperframes/packages/studio build
pnpm.cmd --dir vendor/hyperframes/packages/cli build
```

Then run the 13-effect Puppeteer visual suite and apply/edit/remove each preset in the current Electron project. Expected: no save errors, no duplicate helpers, and all required structure/motion assertions pass.

- [ ] **Step 6: Commit**

```powershell
git add vendor/hyperframes/packages/studio/src vendor/hyperframes/packages/studio/test
git commit -m "test(motion): enforce faithful migrated previews"
```

### Task 7: Final Migration Review

**Files:**
- Review all files changed by Tasks 1-6.

- [ ] **Step 1: Run full branch review**

Review the complete diff against `docs/superpowers/specs/2026-08-11-text-animation-migration-design.md`. Reject any migrated preset still using only its approximate `buildPresetKeyframes` branch.

- [ ] **Step 2: Verify working tree ownership**

Confirm unrelated pre-existing modifications and the confirmed Parallax Layers deletion remain untouched.

- [ ] **Step 3: Final live verification**

Restart the Electron-managed HyperFrames child on its actual assigned port, load the current session, and verify Highlight plus at least one preset from each recipe group through card preview, apply, edit, and remove.

