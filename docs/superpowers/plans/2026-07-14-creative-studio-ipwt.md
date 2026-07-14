# Creative Studio `.ipwt` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a self-contained, locally importable `creative-studio.ipwt` adapted from Start Bootstrap Creative and prove its Design editing flow.

**Architecture:** Keep the distributable template source in a focused fixture directory with a schema-valid manifest, one editable HTML entry, one Design Token stylesheet, local SVG artwork, cover, and upstream MIT license. Add a repository script that packages that directory into the ZIP-compatible `.ipwt` artifact and a Bun test that validates both source and archive contracts without changing the bundled catalog.

**Tech Stack:** Static HTML/CSS/JavaScript, SVG, TypeScript/Bun tests, Node.js packaging script, pnpm, iPolloWork template manifest v1.

## Global Constraints

- Deliver a local template with ID `startbootstrap.creative-studio`, version `1.0.0`, category `site`, subcategory `creative-agency`, and minimum app version `0.17.20`.
- Do not add it to `apps/server/bundled-templates` or change the production template catalog.
- Preserve the complete Start Bootstrap Creative MIT license and repository attribution.
- Do not package remote fonts, CDN dependencies, third-party trademarks, or assets with unclear redistribution rights.
- The page must render without JavaScript; JavaScript may only enhance mobile navigation.
- Use local abstract SVG portfolio artwork and ordinary HTML text, links, and images compatible with the existing Design runtime.
- Run package tests, existing template/runtime tests, build verification, and the real fraimz flow before reporting completion.

---

## File Map

- `apps/server/template-fixtures/creative-studio/`: authoritative source directory for the locally importable template.
- `apps/server/template-fixtures/creative-studio/manifest.json`: template metadata and Design System contract.
- `apps/server/template-fixtures/creative-studio/entry.html`: editable, responsive Creative Studio page.
- `apps/server/template-fixtures/creative-studio/design-tokens.css`: global editable iPolloWork tokens and their page bindings.
- `apps/server/template-fixtures/creative-studio/assets/*.svg`: original abstract portfolio artwork.
- `apps/server/template-fixtures/creative-studio/cover.svg`: catalog preview.
- `apps/server/template-fixtures/creative-studio/LICENSE`: complete upstream MIT notice.
- `apps/server/script/package-template.mjs`: deterministic stored-ZIP `.ipwt` packager for one source directory.
- `apps/server/src/creative-studio-template.test.ts`: source, license, reference, and archive validation.
- `evals/voiceovers/creative-studio-ipwt.md`: approved user-visible demo.
- `evals/flows/creative-studio-ipwt.flow.mjs`: real import/edit/save/reopen proof.
- `artifacts/creative-studio.ipwt`: uploadable output; generated and ignored if the repository already ignores `artifacts/`, otherwise placed under the fraimz run output and linked from the handoff.

### Task 1: Lock the package contract with a failing test

**Files:**
- Create: `apps/server/src/creative-studio-template.test.ts`

**Interfaces:**
- Consumes: `templateManifestV1Schema` from `@ipollowork/types/templates` and the fixture path resolved relative to the test file.
- Produces: executable contract tests for Tasks 2 and 3.

- [ ] **Step 1: Write the failing manifest and source-contract tests**

Create tests that read `../template-fixtures/creative-studio`, parse `manifest.json` with `templateManifestV1Schema`, and assert exact metadata, required files, all seven page sections, local `assets/portfolio-*.svg` image references with non-empty alt text, use of `design-tokens.css`, and absence of `http://`, `https://`, protocol-relative URLs, `@import`, Bootstrap, or remote scripts in HTML/CSS/JS.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
pnpm.cmd exec bun test apps/server/src/creative-studio-template.test.ts
```

Expected: FAIL because `apps/server/template-fixtures/creative-studio/manifest.json` does not exist.

- [ ] **Step 3: Add license-specific assertions**

Assert that `LICENSE` contains `The MIT License (MIT)`, `Start Bootstrap LLC`, and the MIT permission paragraph. Assert that the manifest source repository equals `https://github.com/StartBootstrap/startbootstrap-creative` while excluding manifest metadata from the no-network runtime-reference scan.

- [ ] **Step 4: Re-run and retain the expected RED state**

Run the same focused command. Expected: FAIL only because the fixture is absent, not because of test syntax or imports.

- [ ] **Step 5: Commit the contract test**

```powershell
git add apps/server/src/creative-studio-template.test.ts
git commit -m "test: define Creative Studio template contract"
```

### Task 2: Implement the editable Creative Studio source

**Files:**
- Create: `apps/server/template-fixtures/creative-studio/manifest.json`
- Create: `apps/server/template-fixtures/creative-studio/entry.html`
- Create: `apps/server/template-fixtures/creative-studio/design-tokens.css`
- Create: `apps/server/template-fixtures/creative-studio/cover.svg`
- Create: `apps/server/template-fixtures/creative-studio/LICENSE`
- Create: `apps/server/template-fixtures/creative-studio/assets/portfolio-01.svg`
- Create: `apps/server/template-fixtures/creative-studio/assets/portfolio-02.svg`
- Create: `apps/server/template-fixtures/creative-studio/assets/portfolio-03.svg`
- Create: `apps/server/template-fixtures/creative-studio/assets/portfolio-04.svg`
- Create: `apps/server/template-fixtures/creative-studio/assets/portfolio-05.svg`
- Create: `apps/server/template-fixtures/creative-studio/assets/portfolio-06.svg`

**Interfaces:**
- Consumes: manifest v1 schema and current `--ipw-*` variables recognized by the Design System drawer.
- Produces: a self-contained directory accepted by the contract test and later packager.

- [ ] **Step 1: Create the exact manifest**

Use the approved metadata, `cover.svg`, `entry.html`, `design-tokens.css`, editable groups `theme`, `background`, `typography`, and `components`, plus a checklist covering metadata, brand/navigation, hero, services, portfolio artwork, CTA/contact, footer, responsive navigation, and global tokens.

- [ ] **Step 2: Add the complete upstream MIT license**

Copy the license text from `StartBootstrap/startbootstrap-creative` without changing its copyright statement.

- [ ] **Step 3: Build the token stylesheet**

Define all token families already used by `ipollowork.saas-landing`: background/surface/text/muted/border/primary/secondary/accent/status colors, display/body fonts, scale/line height, content width/page padding/section spacing, button/card styles, and background image/gradient/overlay. Bind body, headings, containers, buttons, cards, and theme surfaces to those tokens.

- [ ] **Step 4: Build the semantic HTML page**

Create `header`, `main`, seven identifiable sections/regions, and `footer`. Use ordinary text nodes, standard anchors, six local images with alt text, semantic headings, a keyboard-accessible mobile menu button, responsive grids, visible focus styles, and a small inline script that only toggles the navigation state.

- [ ] **Step 5: Add original local artwork and cover**

Create six visually distinct abstract SVGs using gradients and geometric shapes without text, logos, embedded raster data, external URLs, or copied upstream artwork. Create a 1200×720 cover that previews the warm orange hero and portfolio grid.

- [ ] **Step 6: Run the contract test and verify GREEN**

```powershell
pnpm.cmd exec bun test apps/server/src/creative-studio-template.test.ts
```

Expected: all Creative Studio source-contract tests pass.

- [ ] **Step 7: Commit the template source**

```powershell
git add apps/server/template-fixtures/creative-studio apps/server/src/creative-studio-template.test.ts
git commit -m "feat: add Creative Studio local template source"
```

### Task 3: Package and validate the `.ipwt` artifact

**Files:**
- Create: `apps/server/script/package-template.mjs`
- Modify: `apps/server/src/creative-studio-template.test.ts`
- Create: `artifacts/creative-studio.ipwt` only if `artifacts/` is ignored; otherwise generate under `evals/results/<run-id>/`.

**Interfaces:**
- Produces CLI: `node apps/server/script/package-template.mjs <source-directory> <output.ipwt>`.
- Archive output: stored ZIP with UTF-8 paths and fixture files at archive root.

- [ ] **Step 1: Extend the test to require an archive packager**

Have the test run the packager into a temporary directory, parse the ZIP central directory using the same stored-ZIP assumptions as `templates.ts`, and assert that `manifest.json` is at the archive root, every fixture file is present exactly once, no wrapping directory exists, and the generated archive can be passed to `importTemplate` and materialized into a temporary Design session.

- [ ] **Step 2: Run the focused test and verify RED**

Run the focused test. Expected: FAIL because `script/package-template.mjs` is missing.

- [ ] **Step 3: Implement the minimal deterministic packager**

Reuse the CRC32 and stored-ZIP layout already present in `copy-bundled-templates.mjs`. Recursively collect files, normalize separators to `/`, sort names, reject symbolic links and an empty source directory, create the output parent, and write the archive without changing source files.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the focused test. Expected: source, archive, import, and materialization assertions all pass.

- [ ] **Step 5: Generate the upload artifact**

```powershell
node apps/server/script/package-template.mjs apps/server/template-fixtures/creative-studio artifacts/creative-studio.ipwt
```

If `artifacts/` is not ignored, use the final fraimz result directory instead and do not add the binary to Git.

- [ ] **Step 6: Commit the packager and archive test**

```powershell
git add apps/server/script/package-template.mjs apps/server/src/creative-studio-template.test.ts
git commit -m "build: package local Design templates"
```

### Task 4: Add and execute the approved real-app proof

**Files:**
- Create: `evals/voiceovers/creative-studio-ipwt.md`
- Create: `evals/flows/creative-studio-ipwt.flow.mjs`

**Interfaces:**
- Consumes: generated `.ipwt`, existing Design template importer, Design canvas/runtime, and fraimz runner.
- Produces: `evals/results/<run-id>/fraimz.html` with observable assertions and screenshots.

- [ ] **Step 1: Record the approved voiceover**

Write the seven-step demo from the specification: import, install, choose, render offline sections, edit text/link/image/theme, save, reopen, and confirm persistence.

- [ ] **Step 2: Implement the fraimz flow**

Follow `design-template-library.flow.mjs` and `design-html-editor.flow.mjs`. Each frame must bind one claim to a user action, DOM assertion, and screenshot. Assert the template card metadata, all major sections, successful heading edit, changed local image source, changed primary token, saved HTML content, and persistence after close/reopen.

- [ ] **Step 3: Run focused and regression tests**

```powershell
pnpm.cmd exec bun test apps/server/src/creative-studio-template.test.ts apps/server/src/templates.test.ts apps/server/src/templates.e2e.test.ts apps/app/tests/design-html-runtime.test.ts
```

Expected: all assertions pass. If the known Windows `EBUSY` cleanup failure recurs, record it separately and rerun the failing E2E test alone after confirming no server process remains.

- [ ] **Step 4: Build the affected server package**

```powershell
pnpm.cmd --filter ipollowork-server build
```

Expected: exit code 0 and no TypeScript or packaging errors.

- [ ] **Step 5: Run fraimz**

```powershell
pnpm.cmd fraimz --flow creative-studio-ipwt
```

Expected: a result directory containing `fraimz.html`, with every claim backed by an observable assertion and screenshot.

- [ ] **Step 6: Inspect final state**

Run `git diff --check`, inspect `git status --short`, ensure no unrelated `.idea/` or user files are staged, confirm the artifact exists and is non-empty, and open the final screenshots for visual inspection.

- [ ] **Step 7: Commit proof files**

```powershell
git add evals/voiceovers/creative-studio-ipwt.md evals/flows/creative-studio-ipwt.flow.mjs
git commit -m "test: prove Creative Studio template flow"
```

## Completion Evidence

The handoff must include the absolute `.ipwt` path, exact commands and results, the fraimz result path and verdict, license/source summary, and any Windows cleanup warning. Do not report `Passed` without a complete `fraimz.html`.
