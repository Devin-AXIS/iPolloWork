# Creative Studio `.ipwt` Template Design

## Goal

Create a locally importable iPolloWork Design template adapted from Start Bootstrap Creative. The deliverable is a self-contained `creative-studio.ipwt` package for manual upload and editing tests. It will not be added to the bundled template catalog in this change.

## User Demo

1. Start a new Design task and open the Website category.
2. Import `creative-studio.ipwt`, confirm the local-template warning, and install it.
3. Choose Creative Studio and complete the Design brief.
4. Confirm that navigation, hero, services, portfolio, call to action, contact, and footer render without network access.
5. Edit a heading, body copy, and link on the canvas.
6. Replace a portfolio image and change the global theme color and typography.
7. Save, close Design, reopen it, and confirm the edits persist.

## Package Contract

The archive root contains no wrapping directory:

```text
manifest.json
entry.html
cover.svg
design-tokens.css
LICENSE
assets/
```

The manifest uses schema version 1, local-safe ID `startbootstrap.creative-studio`, version `1.0.0`, kind `design`, category `site`, and subcategory `creative-agency`. It records Start Bootstrap as the source, links to `StartBootstrap/startbootstrap-creative`, identifies the license as MIT, and requires iPolloWork `0.17.20` or newer.

## Visual and Content Scope

Preserve the recognizable Creative structure and warm orange visual direction while replacing upstream demo branding and copy with neutral Creative Studio content. Keep these sections:

- responsive navigation;
- hero with primary call to action;
- services grid;
- six-item portfolio grid;
- call-to-action section;
- contact section;
- footer.

The template will be a static, editable HTML document rather than a copy of the upstream Pug/SCSS build system. Mobile navigation and small presentation effects may use a short local script in `entry.html`; Bootstrap and other runtime libraries will not be included.

## Design Editing Contract

All user-facing text remains ordinary HTML text so the current Design runtime can edit it directly. Links use standard `href` attributes, and portfolio visuals use local `<img>` elements with meaningful `alt` text so the existing link and image controls work without template-specific code.

`design-tokens.css` provides and applies the existing iPolloWork token families for:

- theme and surface colors;
- display and body fonts;
- type scale and line height;
- content width, page padding, and section spacing;
- button and card radius;
- card background, border, shadow, and blur;
- page background image, gradient, and overlay.

Template CSS must consume these variables instead of duplicating the same values as literals. Section-specific layout values may remain local when they are not exposed by the current Design System.

## Assets and Licensing

The package retains the complete upstream MIT license and copyright notice. `manifest.json` records the original repository and license.

No upstream trademark, brand logo, remote font, CDN file, or asset with unclear redistribution rights will be packaged. Portfolio artwork will be newly authored local SVG assets made from simple abstract geometry. These assets belong to the adapted template and require no network access or separate attribution.

## Error and Compatibility Boundaries

- The archive must stay below the server package and file-size limits.
- Every manifest path must exist and use an allowed static extension.
- The archive root must contain `manifest.json` directly.
- The template must render with JavaScript unavailable; JavaScript only enhances mobile navigation.
- External HTTP(S) dependencies are prohibited in HTML, CSS, and JavaScript.
- The template ID must not use the reserved `ipollowork.*` namespace because this deliverable is imported locally.

## Verification

Add a focused package test that validates the manifest schema, required files, complete MIT notice, archive root layout, self-contained references, and expected editable sections. Run the existing server template import/materialization tests and Design HTML runtime tests.

Build the `.ipwt` archive using the repository's existing ZIP format expectations. Validate the real application flow through the approved demo and generate fraimz evidence. Report `Passed` only when `fraimz.html` exists and every frame has an observable assertion; otherwise report `Incomplete` with reproduction steps.

## Deliverable

Provide the absolute path to `creative-studio.ipwt` for manual upload. Do not add the template to `apps/server/bundled-templates` or change the production catalog in this change.
