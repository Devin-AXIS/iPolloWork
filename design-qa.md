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

---

## Session header simplification — 2026-07-13

- Source visual truth: `/Users/devin/Library/Group Containers/7D498F54KM.com.yinxiang.Mac/Evernote/quick-note/22991999-personal-app.yinxiang.com/quick-note-Sum1lI/attachment--AJdxtI/screenshot.png`.
- Implementation screenshot: `/tmp/ipollowork-header-simplified.png`.
- Full header comparison: `/tmp/ipollowork-header-codex-comparison.png`.
- Narrow viewport screenshot: `/tmp/ipollowork-header-narrow.png`.
- Viewport and state: Electron desktop with an active session; a 980 × 760 narrow-width check was also captured.

**Findings**

- No actionable P0, P1, or P2 differences remain for the requested header hierarchy.
- Typography: the session name stays the sole text hierarchy in the header, with a compact adjacent ellipsis. The previous workspace name, connection state, debug reset control, and notification text no longer compete for attention.
- Spacing and layout: the leading group follows the Codex title-plus-overflow pattern and includes the left conversation-sidebar toggle. The trailing group contains global session search plus an independent right-work-panel toggle; both remain visible at 980px.
- Colors and tokens: controls use the existing quiet muted foreground, hover surface, border, and focus tokens; no black or high-emphasis utility control was added.
- Image and icon fidelity: no reference imagery is involved. Product controls use the existing Lucide icon system; the reference's information hierarchy, not its product identity, is reproduced.
- Copy and content: global search uses the existing localized `搜索会话` / `Search sessions` label. Rename and delete stay inside the ellipsis menu. Notifications now sit beside the account control at the lower-left sidebar.

**Focused region comparison evidence**

The stacked header comparison shows the same structural read: title and ellipsis at the leading edge, with a quiet utility area separated to the far edge. A focused header crop was sufficient because the change is isolated to the title bar; the full Electron capture verifies the surrounding sidebar and composer remain intact.

**Primary interactions tested**

- Opened the title ellipsis and confirmed Rename session and Delete session are available.
- Opened the global search icon and confirmed its dialog opens.
- Toggled the leading conversation-sidebar trigger and confirmed it moves only the left sidebar off canvas and back.
- Toggled the trailing right-work-panel trigger and confirmed it closes and restores only the right panel.
- Verified the notification bell renders beside the lower-left account control.

**Comparison history**

- Initial state contained title, workspace, connected status, notification bell, find control, and debug reset text in one header row.
- Replaced that with a title-plus-overflow group, moved notifications to the sidebar footer, and initially placed the sidebar trigger in the trailing group.
- Follow-up correction: split the controls into a leading left-sidebar trigger and a trailing right-work-panel trigger. Runtime geometry confirmed the controls operate independently.
- Post-fix Electron captures show the requested hierarchy with no P0/P1/P2 follow-up finding.

**Implementation Checklist**

- [x] Keep only session title and ellipsis in the leading header group.
- [x] Put rename/delete in the ellipsis menu.
- [x] Keep a global search icon in the header.
- [x] Move notifications beside the sidebar account control.
- [x] Keep separate left-sidebar and right-work-panel toggles and verify their independent behavior.

final result: passed
