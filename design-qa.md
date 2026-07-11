**Design QA**

- Source visual truth: `/tmp/ipollowork-open-design-review/03-ipollowork-current-layout.png` (existing iPolloWork shell) and `/tmp/ipollowork-open-design-review/01-open-design-home.png` (Open Design direct-manipulation reference).
- Implementation screenshot: `/Users/devin/Documents/opw/_worktrees/ipollowork-design-html-editor/evals/results/2026-07-11T08-20-04-389Z/design-html-editor-06-advanced-properties-modern.png`.
- Saved-state screenshot: `/Users/devin/Documents/opw/_worktrees/ipollowork-design-html-editor/evals/results/2026-07-11T08-20-04-389Z/design-html-editor-07-saved-and-reopened.png`.
- Viewport: 2048 x 1280 Electron desktop capture.
- State: local HTML selected, visual edit enabled, heading selected, compact toolbar and modern properties panel visible; saved state also checked after close and reopen.

**Findings**

- No actionable P0, P1, or P2 differences remain.
- Typography: the new panel reuses iPolloWork's existing font stack, sizes, weights, and muted-label hierarchy. Preview typography comes from the edited HTML rather than being restyled by iPolloWork, which is intentional.
- Spacing and layout: the right rail, task header, transcript, composer, and footer retain the existing iPolloWork rhythm. Design uses the same panel border, toolbar height, compact controls, radii, and inspector density as the surrounding product.
- Colors and tokens: shell controls use existing semantic background, border, foreground, muted, primary, and destructive tokens. The purple preview colors belong to the sample HTML and are isolated inside the preview.
- Image quality and assets: no target imagery was replaced or approximated. Existing iPolloWork icons remain from the product's icon library; the HTML preview renders its own authored content.
- Copy and content: `Design`, `Local HTML only`, `Edit page`, and the empty-state guidance clearly establish the local-file boundary and editing mode.
- Accessibility and behavior: interactive controls have accessible labels, the selected element receives a visible outline, save/undo disabled states are visible, and the inspector remains scrollable. The iframe is sandboxed and does not receive same-origin access. Uploaded images are resized and compressed before embedding so save/reopen remains reliable.

**Full-view comparison evidence**

The combined comparison shows that the implementation preserves the existing iPolloWork shell and adds a dedicated Design panel in the established right-side surface. It borrows Open Design's direct-selection idea without copying its full product chrome or replacing iPolloWork's browser/task layout.

**Focused region comparison evidence**

The selected-heading and advanced-properties frames were inspected at full resolution. The selection outline, compact toolbar, font-size control, color palette, preset cards, typography controls, color controls, box controls, and preview remain legible and aligned. The optional properties panel intentionally narrows the preview while open and remains scrollable.

**Primary interactions tested**

- Create a fresh task and confirm Browser, Design, and Extensions remain available.
- Open a workspace-local HTML file in Design.
- Enable Edit page and select a heading.
- Change heading text directly in place and through the compact editor.
- Change font size and text color from the floating toolbar.
- Upload a replacement image, open the modern properties panel, apply a text preset, and change presentation properties.
- Undo, save, close Design, reopen it, and confirm the text, color, compressed image, saved file, and unchanged task tools.

**Console and runtime check**

The Electron flow completed without an app error state or failed Design request. The dev runtime emitted only existing Electron/Chromium deprecation and GPU mailbox warnings; no Design-specific exception appeared.

**Comparison history**

- Initial implementation comparison: no P0/P1/P2 visual mismatch found, so no visual repair iteration was required.

**Implementation Checklist**

- [x] Preserve the iPolloWork shell and right rail.
- [x] Keep Browser separate from Design.
- [x] Use existing iPolloWork controls and design tokens.
- [x] Provide visible selection, direct text editing, quick font size/color, image replacement, modern properties, undo, save, and saved-state feedback.
- [x] Keep the preview sandboxed and local-workspace-only.

**Follow-up Polish**

- P3: a future wider inspector/resizable split would make long URLs and style values easier to scan on narrower app windows.

final result: passed
