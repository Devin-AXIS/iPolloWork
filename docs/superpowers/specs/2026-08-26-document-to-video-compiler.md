# Universal Document To Design Compiler Spec

## Summary

Add a shared document-to-design compiler layer in front of iPolloWork Design and iVideo surfaces. The goal is to let users create videos, slides/PPT, posters, reports, articles, cards, or sites from a blank prompt, PDF, image, or PPT/PPTX without forcing the main agent to read the full source document.

The upload/ingest layer should be universal. Target-specific compilers should consume the same document IR instead of each design surface building its own file parser.

## Existing Project Fit

Current relevant pieces:

- `external-plugins/deepseek-harness/video-studio` already hosts an iVideo/HyperFrames studio surface.
- `packages/video-studio/src/bridge.ts` already defines AI editing prompts for a video session.
- `apps/server/src/templates.ts` already supports `surface: "video"` sessions and writes `video/<sessionId>/brief.json`.
- `apps/desktop/electron/main.mjs` currently simplifies the HyperFrames UI and hides advanced tabs such as Storyboard in simple mode.

This spec adds the missing ingest/compiler layer before each surface's `brief.json`, `manifest.json`, and editable HTML entry.

## Product Goals

- Start from blank and generate a structured design project.
- Import PDF and PPT/PPTX files and turn them into videos, slides, posters, reports, articles, cards, or sites.
- Extract images, charts, page renders, and slide renders as reusable assets.
- Preserve provenance from source page/slide to generated scene.
- Keep the main agent context small even for 100-page documents.
- Reuse the existing Design, template, PPTX-compatible, and video-studio/HyperFrames editing and validation paths.

## Non-Goals

- Do not replace HyperFrames or the existing video studio.
- Do not make the main agent ingest full document text.
- Do not store images inside JSON as base64.
- Do not require the first milestone to export MP4; editable HTML/video session output is enough.

## Targets

Initial targets:

- `video`: `video/<sessionId>/index.html`, `surface: "video"`, `category: "video"`.
- `slides`: `design/<sessionId>/entry.html`, `surface: "design"`, `category: "slides"`, native PPT markers where possible.
- `poster`: `design/<sessionId>/entry.html`, `surface: "design"`, `category: "poster"`.
- `site`, `article`, `report`, `cards`: `design/<sessionId>/entry.html`, target-specific layouts.

## Proposed Session Layout

```text
<surface>/<sessionId>/
  source/
    input.pdf
    input.pptx
  extracted/
    document_index.json
    coverage_matrix.json
    assets_manifest.json
    pages/
      page-001.json
    sections/
      sec-001.json
    assets/
      images/
      charts/
      page_renders/
      slide_renders/
  story/
    video_brief.json
    scenes.json
    narration.json
    timeline.json
  brief.json
  manifest.json
  index.html or entry.html
```

## Pipeline

```text
InputRouter
-> ExtractionRuntime
-> DocumentIRWriter
-> SectionCleaner
-> StoryCompiler
-> HyperFramesRenderer
-> VideoValidation
```

Initial CLI entry:

```bash
pnpm document:design -- --target video --source path/to/input.pdf --session ses_document_video --goal "Create a 60 second summary video."
pnpm document:design -- --target slides --source path/to/input.pdf --session deck_from_pdf --goal "Create a presentation."
pnpm document:design -- --target poster --source path/to/input.pdf --session poster_from_pdf --goal "Create a recruiting poster."
pnpm document:video -- --source path/to/input.pdf --session ses_document_video --goal "Create a 60 second summary video."
```

The current CLI entry lives at `scripts/document-to-design-compiler.mjs`; the older `scripts/document-to-video-compiler.mjs` implementation remains as a compatibility module. The `document:video` script is a compatibility alias for `target=video`.

### 1. InputRouter

Accepts:

- Blank prompt
- PDF
- PPT/PPTX
- Existing images or screenshots

Creates the session folder and copies source files into `video/<sessionId>/source/`.

### 2. ExtractionRuntime

Uses deterministic code where possible:

- PDF: extract text per page, embedded images, page renders, and tables when available.
- PPT/PPTX: unzip and inspect slide XML, extract media, notes where available, and slide renders when available.
- Blank: create an empty `document_index.json` and start from `story/video_brief.json`.

Writes raw page/slide JSON under `extracted/pages/` and assets under `extracted/assets/`.

### 3. DocumentIRWriter

Writes:

- `extracted/document_index.json`
- `extracted/coverage_matrix.json`
- `extracted/assets_manifest.json`

The main agent should read `document_index.json` first and only load a section file when selected for the story.

### 4. SectionCleaner

Can use subagents. Each subagent receives only bounded input:

- one page range
- one slide range
- one raw page JSON
- one section JSON

Subagents must write output files and return only status, output paths, warnings, and test/validation notes.

### 5. DesignCompiler

Reads the user goal plus `document_index.json`, selects high-value sections/assets, then writes:

- `story/design_brief.json`
- `story/scenes.json`
- `story/narration.json`
- `story/timeline.json`

Scene files are neutral design units. For video they become timed scenes; for slides they become slides; for posters they become content blocks. They reference `section_id` and `asset_id`; they should not copy long source text.

### 6. Target Renderer

Compiles story files into the existing editable target session:

- `brief.json`
- `manifest.json`
- `index.html` for video or `entry.html` for design targets
- copied assets

The renderer should preserve the existing iPolloWork template/session contract and keep generated text as editable DOM text where possible.

### 7. VideoValidation

Use existing video validation when available, especially `ipollowork_video_validate` in the video studio plugin/runtime.

## Agent Boundary

Main agent reads:

- `extracted/document_index.json`
- `extracted/assets_manifest.json`
- `story/design_brief.json`
- selected `extracted/sections/*.json`

Main agent does not read:

- full PDF/PPT text
- all page JSON files
- all section JSON files
- binary assets

Subagents read only bounded files and write reports to disk.

## Suggested Implementation Milestones

1. Add the skill and JSON contract documentation. Done in `设计skill/document-to-video-compiler`.
2. Add a local extraction CLI that creates the proposed folder structure for PDF/PPT/PPTX. Initial version done in `scripts/document-to-design-compiler.mjs`.
3. Add JSON validators for index, coverage, assets, sections, and story files.
4. Add a simple target compiler that turns selected sections into `story/scenes.json`.
5. Compile story files into basic video, slides, and poster HTML entries.
6. Connect import actions in Design and video-studio UI.
7. Decide whether to expose hidden Storyboard/Slideshow tabs behind an advanced toggle.

## Acceptance Criteria

- A 100-page PDF can be processed without pasting full text into the main agent context.
- Every source page or slide appears in `coverage_matrix.json`.
- Extracted images are written as files and referenced by `asset_id`.
- `document_index.json` is small enough for the main agent to read comfortably.
- Generated scenes reference source sections/assets with provenance.
- The resulting target session opens in the existing iPolloWork editor for that surface.
