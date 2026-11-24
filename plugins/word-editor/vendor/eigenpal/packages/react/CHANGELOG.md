# @eigenpal/docx-js-editor

## 2.39.0

### Patch Changes

- Updated dependencies: @docx-editor.dev/core@2.39.0, @docx-editor.dev/i18n@2.39.0

## 2.38.0

### Minor Changes

- 05f76a2: `useEditorCaret()` returns `blockId`, the paragraph id that selection reads, search matches, and highlight ranges use. `paragraphId` stays as a deprecated alias for `at` parameters.
- c6dcb77: Add `ContextMenu.Start` to the React and Vue context menus. Rows inside it render above the default rows, followed by a separator.
- e5d9167: Add `useHighlights().refresh()` to refresh marks after application state changes. Add `useContextMenuHighlights()` to read marks under the pointer or keyboard menu anchor.

### Patch Changes

- Updated dependencies: @docx-editor.dev/core@2.38.0, @docx-editor.dev/i18n@2.38.0

## 2.37.0

### Patch Changes

- Updated dependencies: @docx-editor.dev/core@2.37.0, @docx-editor.dev/i18n@2.37.0

## 2.36.0

### Patch Changes

- Updated dependencies: @docx-editor.dev/core@2.36.0, @docx-editor.dev/i18n@2.36.0

## 2.35.0

### Minor Changes

- 6c10913: File > Print now asks which markup to print and whether comments print, and passes the choice to the PDF handler as `view.displayMode` and `view.comments`. Set `printSettings: false` on the menu to print the current view without asking.

### Patch Changes

- 1aa7918: When the toolbar collapses an image's controls into the "⋯" panel, Wrap text, Alt text, Image properties, and Insert image now show as full-width rows that open their menu, popover, or dialog on a click. Before, each showed a plain-text label beside a small icon, and only the icon took a click.
- Updated dependencies: @docx-editor.dev/core@2.35.0, @docx-editor.dev/i18n@2.35.0

## 2.34.0

### Minor Changes

- f182c70: Close the link panel when another participant strikes its selected words in suggesting mode, and add `hyperlinks.selectionIsPendingDeletion()` to tell whether a selection is a pending deletion. Fixes #1643.
- 27720ad: Composed editors accept `colorMode` on the root, with `useEditorColorMode()` and `useScopeClassName()` reporting the theme to your own parts, and the toolbar moves controls into the `⋯` panel one at a time instead of whole groups. Each toolbar control now sits in a `.docx-toolbar__item` element, so host CSS for direct children of `.docx-toolbar__group` needs that level added. Fixes #1613. Fixes #1614.

### Patch Changes

- 0ea7e91: The context menu's Insert link row opens the link popover for the selection, as the toolbar button and Ctrl+K do, instead of staying disabled. Fixes #1611.
- 445382d: The Insert link context menu row and toolbar button now open the mounted link panel, and the context menu row shows the Ctrl+K shortcut. If no link panel is mounted, both are disabled with a reason and Ctrl+K is left to the browser. Fixes #1592.
- b996a85: Closing the link popover with Escape, Cancel, or Apply returns the keyboard to the document, and the context menu row reads Edit link on an existing link. The panel also closes when another participant deletes the words it was about to link.
- d85ce82: The paragraph style pickers show the built-in styles (Normal, Title, Subtitle, Heading 1 to 9, No Spacing, Quote, Intense Quote, and List Paragraph) in the UI language, and the undo, redo, indent, Go To, and bookmark controls give their disabled reason in the UI language.
- c99eefb: Right-clicking a text field, popover, or dialog inside the editor, such as the link popover, now shows the browser menu instead of the document context menu. Fixes #1624.
- dbe57b9: Footnote and endnote numbering comes from each section's own note properties, including its start value, instead of the document-wide settings, and applying note properties to the whole document updates every section and keeps the values you did not change. Fixes #1527.
- 59e3c77: Show the macOS keyboard shortcut in the React and Vue link tooltips. Fixes #1195
- Updated dependencies: @docx-editor.dev/core@2.34.0, @docx-editor.dev/i18n@2.34.0

## 2.33.0

### Patch Changes

- c82ecbc: The loading overlay no longer fades in a second time when a large document finishes downloading.
- b0c962c: Fix the menu bar, link popup, header and footer options, note options, content control inspector, and dropdown menus staying open when you press the document.
- ba742d7: Fix menu bar arrow navigation in right-to-left interfaces in React and Vue.
- 5fc61e9: Fix toolbar popups staying open when the document surface cancels mouse events. Outside pointer presses now close the popup in React and Vue.
- Updated dependencies: @docx-editor.dev/core@2.33.0, @docx-editor.dev/i18n@2.33.0

## 2.32.0

### Minor Changes

- 244fa30: Let `DocxEditor` hosts supply an image decoder through `imageDecodePort` in both adapters.

### Patch Changes

- dcc2295: Keep unsupported-content placeholders visible when React renderers return empty fragments, arrays, or whitespace.
- 4804ef6: Changing the `fonts` prop now replaces the fonts without remounting the editor, so edits, selection, and undo history are kept, and the current fonts stay in use until the new ones are ready.
- Updated dependencies: @docx-editor.dev/core@2.32.0, @docx-editor.dev/i18n@2.32.0

## 2.31.0

### Minor Changes

- f2b71d4: Add `useReviewRailMetrics` for React and Vue to position custom review columns.

### Patch Changes

- Updated dependencies: @docx-editor.dev/core@2.31.0, @docx-editor.dev/i18n@2.31.0

## 2.30.0

### Minor Changes

- f09b44b: Add the `fontShaping` option, which sets the largest font file that text shaping accepts, separately from font loading limits.

### Patch Changes

- Updated dependencies: @docx-editor.dev/core@2.30.0, @docx-editor.dev/i18n@2.30.0

## 2.29.0

### Patch Changes

- Updated dependencies: @docx-editor.dev/core@2.29.0, @docx-editor.dev/i18n@2.29.0

## 2.28.0

### Minor Changes

- 9535470: The navigation pane now works inside `DocxEditor.Viewport`, covers the page on narrow screens, and captures the browser's find shortcut (Ctrl+F, or Cmd+F on macOS) while focus is in the editor; set `findShortcut` to `false` on the pane, or in the `navigation` prop, to leave the shortcut to the browser.
- 9535470: Toolbar and menu popups close when focus moves elsewhere, such as to the find field, and the navigation pane stays docked beside a scrolling review column. `Toolbar.Button`, `Menu.Item`, and `ContextMenu.Slot` take `slotId`; `slot` is deprecated and still works with a development warning, and on `MenuItemProps` and `MenuSubmenuProps` both `slot` and `labelKey` are optional, because `slotId` and `label` can take their place.
- 9535470: Add toolbar host groups, slot replacement, an Add comment control, and a table-size grid for the toolbar's table button, and make the menu bar move menus that do not fit into one "⋯" menu instead of wrapping by default (set `overflow={false}` to keep wrapping). The context-menu row id `review.comments` is deprecated in favor of `review.addComment`, and the old id still works with a development warning.

### Patch Changes

- 63dde82: Fix keyboard access and enabled states for composed menu actions in React and Vue.
- 9535470: The page number indicator now stays in view when you place it inside the viewport instead of beside it.
- 9535470: Close toolbar dropdowns, pickers, and the More panel when you press Escape in the document, and keep Escape in your own inputs working. Fixes #1151
- Updated dependencies: @docx-editor.dev/core@2.28.0, @docx-editor.dev/i18n@2.28.0

## 2.27.0

### Patch Changes

- Updated dependencies: @docx-editor.dev/core@2.27.0, @docx-editor.dev/i18n@2.27.0

## 2.26.0

### Patch Changes

- Updated dependencies: @docx-editor.dev/core@2.26.0, @docx-editor.dev/i18n@2.26.0

## 2.25.0

### Patch Changes

- Updated dependencies [5d02def]
- Updated dependencies [95fbca3]
- Updated dependencies [e151687]
- Updated dependencies [5d02def]
- Updated dependencies [5d02def]
- Updated dependencies [5d02def]
- Updated dependencies [95fbca3]
- Updated dependencies [7ac4f41]
- Updated dependencies [f098ae6]
- Updated dependencies [a13f6a7]
- Updated dependencies [5d02def]
  - @docx-editor.dev/core@2.25.0
  - @docx-editor.dev/i18n@2.25.0

## 2.24.0

### Patch Changes

- 3a8853f: Support inserting, editing, deleting, moving, and resizing body textboxes, with synchronized edits and remote cursors during collaboration. Fix textbox pagination and caret visibility, and keep text direction commands in Format.
- Updated dependencies [3a8853f]
- Updated dependencies [de3aac8]
- Updated dependencies [79d8bc1]
- Updated dependencies [997814e]
- Updated dependencies [de3aac8]
- Updated dependencies [567c1e5]
  - @docx-editor.dev/core@2.24.0
  - @docx-editor.dev/i18n@2.24.0

## 2.23.0

### Patch Changes

- 4fafb7c: Some inferred union types in the published declarations list their members in a different order. The types themselves are unchanged.
- Updated dependencies [30bd2a8]
- Updated dependencies [e608e2d]
- Updated dependencies [e608e2d]
- Updated dependencies [30bd2a8]
- Updated dependencies [b981ea6]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [0e42c85]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [d04902a]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [e608e2d]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [a2951cf]
- Updated dependencies [30bd2a8]
- Updated dependencies [5981e48]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [ab460dc]
- Updated dependencies [30bd2a8]
- Updated dependencies [e633def]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [cee5764]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [390c177]
- Updated dependencies [30bd2a8]
- Updated dependencies [ae1afe0]
- Updated dependencies [30bd2a8]
- Updated dependencies [bf776f2]
- Updated dependencies [30bd2a8]
- Updated dependencies [d6c75d2]
- Updated dependencies [2eea4de]
- Updated dependencies [30bd2a8]
- Updated dependencies [e040ff8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [aab4053]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [e608e2d]
- Updated dependencies [e608e2d]
- Updated dependencies [e608e2d]
- Updated dependencies [30bd2a8]
- Updated dependencies [9afb832]
- Updated dependencies [6794f4d]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [3b95523]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
  - @docx-editor.dev/core@2.23.0
  - @docx-editor.dev/i18n@2.23.0

## 2.22.0

### Patch Changes

- Updated dependencies [139688b]
- Updated dependencies [d98b6d8]
- Updated dependencies [abc656b]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
- Updated dependencies [9912e81]
- Updated dependencies [7ff2004]
- Updated dependencies [fe66ece]
- Updated dependencies [ac84ccf]
- Updated dependencies [cde01d8]
- Updated dependencies [648f13c]
- Updated dependencies [95c792f]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
- Updated dependencies [d98b6d8]
- Updated dependencies [23093e9]
- Updated dependencies [edfb06d]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
- Updated dependencies [d98b6d8]
- Updated dependencies [07718bd]
- Updated dependencies [d98b6d8]
- Updated dependencies [e6616fe]
- Updated dependencies [1bb2434]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
- Updated dependencies [139688b]
- Updated dependencies [a893c05]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
- Updated dependencies [9db7eb3]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
  - @docx-editor.dev/core@2.22.0
  - @docx-editor.dev/i18n@2.22.0

## 2.21.1

### Patch Changes

- Updated dependencies [6a7b93a]
  - @docx-editor.dev/i18n@2.21.1

## 2.21.0

### Patch Changes

- Updated dependencies [ab9548d]
- Updated dependencies [db1b50c]
- Updated dependencies [be94e1c]
- Updated dependencies [f30cd6a]
- Updated dependencies [424a121]
- Updated dependencies [87b8b3d]
- Updated dependencies [06b79d7]
- Updated dependencies [06b79d7]
- Updated dependencies [40ef065]
- Updated dependencies [14a3468]
- Updated dependencies [424a121]
- Updated dependencies [2d4e0e7]
  - @docx-editor.dev/core@2.21.0
  - @docx-editor.dev/i18n@2.21.0

## 2.20.0

### Patch Changes

- Updated dependencies [a9034d4]
- Updated dependencies [c10916a]
- Updated dependencies [a9034d4]
- Updated dependencies [a9034d4]
- Updated dependencies [a9034d4]
- Updated dependencies [a9034d4]
- Updated dependencies [a9034d4]
  - @docx-editor.dev/core@2.20.0
  - @docx-editor.dev/i18n@2.20.0

## 2.19.1

### Patch Changes

- @docx-editor.dev/i18n@2.19.1

## 2.19.0

### Patch Changes

- @docx-editor.dev/core@2.19.0
  - @docx-editor.dev/i18n@2.19.0

## 2.18.0

### Minor Changes

- d4daf40: Customize React and Vue popups with `definePopup()` components or typed render callbacks, including Page Setup, Paragraph Options, and Field Options. Reuse parts and draft hooks for automatic behavior, or disable automatic rendering to manage the popup yourself. Fixes #771.

### Patch Changes

- 90ea211: Preserve the document's scroll position and text selection when picking or typing a font size, or dismissing the font-size input with Escape. Restore the saved selection when returning focus to the editor from toolbar inputs.
- Updated dependencies [ded420d]
- Updated dependencies [d2d3824]
- Updated dependencies [b5bf09f]
- Updated dependencies [10a3d41]
- Updated dependencies [e78dc17]
- Updated dependencies [84c4622]
- Updated dependencies [564182f]
- Updated dependencies [f2dfcac]
- Updated dependencies [758551b]
- Updated dependencies [452312f]
- Updated dependencies [5598465]
- Updated dependencies [60b9163]
- Updated dependencies [59520ce]
- Updated dependencies [95db5eb]
- Updated dependencies [1e36856]
- Updated dependencies [6eb1eb4]
- Updated dependencies [37be540]
- Updated dependencies [9198848]
- Updated dependencies [2cea799]
- Updated dependencies [f23f974]
- Updated dependencies [7c2b4aa]
- Updated dependencies [90ea211]
- Updated dependencies [f10341d]
- Updated dependencies [040e653]
  - @docx-editor.dev/core@2.18.0
  - @docx-editor.dev/i18n@2.18.0

## 2.17.0

### Minor Changes

- d1d8043: Let `navigation` on `<DocxEditor>` pass through pane props so hosts can control open state and the active tab, and focus the find input when that tab is shown.

### Patch Changes

- Updated dependencies [332494b]
  - @docx-editor.dev/core@2.17.0
  - @docx-editor.dev/i18n@2.17.0

## 2.16.2

### Patch Changes

- @docx-editor.dev/i18n@2.16.2

## 2.16.1

### Patch Changes

- @docx-editor.dev/i18n@2.16.1

## 2.16.0

### Minor Changes

- 2c7a3c9: Use `locale` for regional date input in text form fields, including dotted dates and year-first patterns. Remove the unreleased `dateInputOrder` prop and setter. Preserve existing dates when locale changes.

  Form-field dialogs and accessibility labels now honor `i18n`, including live catalogue changes.

### Patch Changes

- 0a75175: Preserve pending form values when moving or remounting the editor. Add `PaginatedSurface.save()` to validate pending input and refresh REF fields before serialization. Browser automation and paginated React and Vue refs use this save path. Synchronous saves refuse active edits and destroyed surfaces. Field-exit callbacks can throw or remount the editor without changing date interpretation.

  Preserve nested simple-field results in clipboard HTML. Reject partial field quotes in the server-agent review example before an edit can affect additional text. Refuse tracked deletion or replacement of simple fields with nested result structures instead of leaving old text behind.

- Updated dependencies [96d7e74]
- Updated dependencies [0a3b35d]
- Updated dependencies [82b8e0c]
- Updated dependencies [7a18c15]
- Updated dependencies [863680d]
- Updated dependencies [62a6911]
- Updated dependencies [41a3bc7]
- Updated dependencies [e295e90]
- Updated dependencies [00666a8]
- Updated dependencies [a4a9bbc]
- Updated dependencies [76a4c5d]
- Updated dependencies [b7c82fa]
- Updated dependencies [03b88ea]
- Updated dependencies [1f207f8]
- Updated dependencies [19a420e]
- Updated dependencies [485bfd4]
- Updated dependencies [da01e25]
- Updated dependencies [f416965]
- Updated dependencies [954d9d1]
- Updated dependencies [6fac0e1]
- Updated dependencies [2c7a3c9]
- Updated dependencies [85bfd9c]
- Updated dependencies [3641f1e]
- Updated dependencies [10a0575]
- Updated dependencies [0a75175]
- Updated dependencies [3ca855b]
- Updated dependencies [46c0de2]
- Updated dependencies [fdd6045]
- Updated dependencies [eb0e520]
- Updated dependencies [5505944]
- Updated dependencies [b5ab91b]
- Updated dependencies [1de0f64]
- Updated dependencies [6f7da01]
  - @docx-editor.dev/core@2.16.0
  - @docx-editor.dev/i18n@2.16.0

## 2.15.1

### Patch changes

- @docx-editor.dev/i18n@2.15.1

## 2.15.0

### Patch changes

- Updated dependencies [5284df5]
- Updated dependencies [e9baf4d]
- Updated dependencies [087bb78]
- Updated dependencies [0d81033]
- Updated dependencies [a3819aa]
- Updated dependencies [a53f75c]
- Updated dependencies [36c1f04]
- Updated dependencies [8e6133f]
- Updated dependencies [678fe91]
- Updated dependencies [cfe3fe1]
- Updated dependencies [0e1360d]
- Updated dependencies [2a8e57e]
  - @docx-editor.dev/core@2.15.0
  - @docx-editor.dev/i18n@2.15.0

## 2.14.1

### Patch Changes

- @docx-editor.dev/i18n@2.14.1

## 2.14.0

### Patch Changes

- 1afc5f2: Treat contextual table controls as the first collapsible preset-toolbar group, so entering a table moves those controls into More before ordinary formatting controls instead of overlapping them. Keep table color pickers contained within the More panel so later controls remain clipped and scrollable while a picker is open. Fixes #669.
- Updated dependencies [7633b2c]
- Updated dependencies [1afc5f2]
- Updated dependencies [01022a4]
- Updated dependencies [6b5bb8d]
- Updated dependencies [f731c52]
  - @docx-editor.dev/core@2.14.0
  - @docx-editor.dev/i18n@2.14.0

## 2.13.0

### Patch Changes

- Updated dependencies [b360c3c]
- Updated dependencies [845e38f]
- Updated dependencies [fe26cd4]
- Updated dependencies [3c66a7c]
- Updated dependencies [16966b2]
- Updated dependencies [2d7dc10]
- Updated dependencies [346f7e6]
- Updated dependencies [5cf6f08]
- Updated dependencies [7ea84c3]
- Updated dependencies [2ea6a9d]
- Updated dependencies [e268614]
- Updated dependencies [8107826]
- Updated dependencies [0860dd2]
- Updated dependencies [b1fa0d6]
- Updated dependencies [f1d3940]
- Updated dependencies [0a6e44c]
- Updated dependencies [72ff41f]
- Updated dependencies [8506a62]
- Updated dependencies [0d782e3]
- Updated dependencies [7e85377]
- Updated dependencies [96cdbe2]
  - @docx-editor.dev/core@2.13.0
  - @docx-editor.dev/i18n@2.13.0

## 2.12.0

### Patch Changes

- Updated dependencies [531759c]
- Updated dependencies [40699c8]
- Updated dependencies [31780e5]
- Updated dependencies [4c2c119]
- Updated dependencies [3755b98]
- Updated dependencies [8fe5920]
- Updated dependencies [fe3b8a3]
  - @docx-editor.dev/core@2.12.0
  - @docx-editor.dev/i18n@2.12.0

## 2.11.0

### Patch Changes

- Updated dependencies [e4872fb]
- Updated dependencies [e4872fb]
- Updated dependencies [e4872fb]
- Updated dependencies [e4872fb]
- Updated dependencies [e4872fb]
- Updated dependencies [e4872fb]
- Updated dependencies [e4872fb]
- Updated dependencies [e4872fb]
- Updated dependencies [e4872fb]
- Updated dependencies [e4872fb]
- Updated dependencies [e4872fb]
- Updated dependencies [e4872fb]
- Updated dependencies [e4872fb]
- Updated dependencies [e4872fb]
- Updated dependencies [e4872fb]
- Updated dependencies [e4872fb]
- Updated dependencies [2015f33]
- Updated dependencies [1542e73]
- Updated dependencies [40578c6]
- Updated dependencies [e4872fb]
- Updated dependencies [e4872fb]
- Updated dependencies [e4872fb]
- Updated dependencies [e4872fb]
- Updated dependencies [e4872fb]
- Updated dependencies [e4872fb]
- Updated dependencies [e4872fb]
- Updated dependencies [c4b4dab]
- Updated dependencies [e4872fb]
- Updated dependencies [e4872fb]
- Updated dependencies [e4872fb]
- Updated dependencies [e4872fb]
- Updated dependencies [e4872fb]
- Updated dependencies [e4872fb]
- Updated dependencies [e4872fb]
- Updated dependencies [e4872fb]
- Updated dependencies [af77c9b]
- Updated dependencies [d11816f]
- Updated dependencies [0d770d9]
- Updated dependencies [dfaafc0]
  - @docx-editor.dev/core@2.11.0
  - @docx-editor.dev/i18n@2.11.0

## 2.10.0

### Patch Changes

- 2af5fea: Align the `DocxEditorShell` outline toggle with the page top when the ruler is shown, and stop insetting the outline past a vertical ruler that read-only mode hides. Fixes #486
- df91189: The error notification toast animates with a `docx-` prefixed keyframes name from the core stylesheet instead of injecting a global `@keyframes slideIn`, so it no longer collides with a host application's animation of the same name. Fixes #485
- 6b1b045: Remove the `DocxEditorShell` review highlight styles, which targeted class names the editor does not render, so they never painted in any release. To mark the active comment or tracked change, use `Editor.setActiveReviewItem`. Fixes #481
- Updated dependencies [79170d8]
- Updated dependencies [99c7408]
- Updated dependencies [56848c8]
- Updated dependencies [ab81336]
- Updated dependencies [8ac2e88]
- Updated dependencies [0928951]
- Updated dependencies [0e3663d]
- Updated dependencies [b10d396]
- Updated dependencies [0e3663d]
  - @docx-editor.dev/core@2.10.0
  - @docx-editor.dev/i18n@2.10.0

## 2.9.2

### Patch Changes

- @docx-editor.dev/i18n@2.9.2

## 2.9.1

### Patch Changes

- Updated dependencies [36ea49a]
  - @docx-editor.dev/core@2.9.1
  - @docx-editor.dev/i18n@2.9.1

## 2.9.0

### Patch Changes

- 040be03: Show a responsive document page with loading status while a document opens.
  - @docx-editor.dev/i18n@2.9.0

## 2.8.0

### Patch Changes

- 5ae7f4d: The style picker now labels built-in headings `Heading 4` through `Heading 9` instead of the lowercase name Word writes into `styles.xml`.
  - @docx-editor.dev/i18n@2.8.0

## 2.7.0

### Patch Changes

- 25235c1: Sustained key repeat against a fast document no longer risks React's maximum update depth guard; state notifications yield to a task when a notification-wave streak goes unbroken.
  - @docx-editor.dev/i18n@2.7.0

## 2.6.1

### Patch Changes

- fd610f2: Fixed the type declaration build for the react, vue, pro, and fonts packages, which could fail depending on which ambient type packages were installed.
  - @docx-editor.dev/i18n@2.6.1

## 2.6.0

### Minor Changes

- 4789535: The review rail adapts to the viewport: the full card column is reserved only while there is room for it beside the page, and narrower viewports get a centered document with a compact rail — markers in a mirrored strip, with the active card floating fully visible inside the viewport's edge. Custom chrome can read the reservation through the new `useReviewGutter` hook.

### Patch Changes

- a69ea43: Fix ruler behavior on narrow viewports: the horizontal ruler now clamps to the page's left edge instead of overflowing on both sides, and the vertical ruler hides while the page is wider than the viewport instead of scrolling out of view.
  - @docx-editor.dev/i18n@2.6.0

## 2.5.0

### Patch Changes

- @docx-editor.dev/i18n@2.5.0

## 2.4.1

### Patch Changes

- @docx-editor.dev/i18n@2.4.1

## 2.4.0

### Patch Changes

- @docx-editor.dev/i18n@2.4.0

## 2.3.1

### Patch Changes

- @docx-editor.dev/i18n@2.3.1

## 2.3.0

### Patch Changes

- @docx-editor.dev/i18n@2.3.0

## 2.2.1

### Patch Changes

- @docx-editor.dev/i18n@2.2.1

## 2.2.0

### Minor Changes

- 568ccf7: Localizing the editor now works the way the docs describe it. `<DocxEditor>` takes an `i18n` prop, so a locale no longer needs a `LocaleProvider` around it; a provider still works and now composes when nested instead of resetting the subtree to English. The toolbar's overflow panel also labels its value rows (zoom, line spacing, the style, font and colour pickers) from the active catalogue rather than showing the raw i18n key.

### Patch Changes

- a4d7885: `<DocxEditor>`'s title bar and toolbar now sit on one `--doc-surface` band, closed by a hairline and a soft shadow directly under the toolbar, with the ruler row and the workspace below it on `--doc-bg`. The seam used to be a border under the title bar, which split the band in two and left the toolbar edge to edge on no ground of its own: the toolbar paints a rounded pill, so flush against the frame its radius never showed and the row read as a second flat bar. Hosts were adding their own wrapper to get the packaged chrome to look like the composed demo it is modelled on. Nothing about the API changes, and both surfaces follow the dark palette as before.
- Updated dependencies [568ccf7]
  - @docx-editor.dev/i18n@2.2.0

## 2.1.3

### Patch Changes

- 531c47b: `<DocxEditor>` now shows rulers, and `onSave` no longer draws a button. The horizontal ruler compensates for the navigation shift and the review gutter itself, so it only measures correctly in the row above the scroll container — a slot the packaged host is the only thing that can offer, which meant a host mounting it by hand got ticks that drifted off the page. Pass `rulers={false}` for a bare page. Separately, setting `onSave` also rendered an inline-styled Save button into the title bar that a host could not remove; `onSave` is now just the action, and File -> Save still invokes it.
  - @docx-editor.dev/i18n@2.1.3

## 2.1.2

### Patch Changes

- 4fa91bd: Under the packaged `<DocxEditor>`, `.docx-editor` is now on the editor root and nowhere else. The toolbar, menu bar, navigation pane, context menu, viewport and page-number chip each added the class as their own Tailwind scope, which they only need when there is no scoped ancestor. A host rule like `.my-shell .docx-editor { height: 100% }` therefore also matched the toolbar. Composing from `DocxEditor.Root`, which renders no element, is unchanged: the parts still scope themselves.
  - @docx-editor.dev/i18n@2.1.2

## 2.1.1

### Patch Changes

- @docx-editor.dev/i18n@2.1.1

## 2.1.0

### Minor Changes

- c1a20c8: Composed chrome is legible and styled with zero configuration. Bare `DocxEditor.Toolbar`, `DocxEditor.Menu`, and `DocxEditor.ContextMenu` now resolve labels through the active locale catalogue (so `LocaleProvider` localizes them) instead of rendering raw i18n keys, and emit the `docx-editor` styling scope on their own root — matching `DocxEditor.Loading` — so they render styled wherever the host mounts them. New `useChromeTranslate(overrides?)` returns a catalogue-backed resolver assignable to every part's `t` prop, with a `Map` of key-level overrides consulted first. The `<DocxEditor>` `t` prop now also receives interpolation params, so host resolvers can format parameterized labels like the navigation match counter.
- dbf5501: Every remaining `ep-` prefixed CSS class and keyframe is renamed to `docx-editor-`, so the whole stylesheet shares one namespace with the `.docx-editor` root class. If your own CSS targets an `.ep-*` class or the `ep-caret-blink` keyframe, switch it to the same name under `docx-editor-` (`.ep-one-surface__caret` becomes `.docx-editor-one-surface__caret`).
- 43c3e6a: The shipped stylesheet is now precompiled and fully namespaced: every Tailwind utility, editable-surface rule and keyframe is scoped under the renamed `.docx-editor` root class (previously `.ep-root`), so the CSS no longer collides with a host app's Tailwind setup and styles the chrome correctly in hosts without Tailwind. If your own CSS targets `.ep-root`, switch it to `.docx-editor`.

### Patch Changes

- 9bba164: Keep page-relative anchored drawings paintable in multi-column sections by clipping them to the full page width instead of the active column.
- 03f57f3: Chrome that describes the document no longer renders before one is present. The review rail keeps its empty state and host furniture off screen until a document opens instead of floating them over the loading screen, the ruler parts render nothing rather than default Letter-size ticks for a page that does not exist, and the navigation pane and document outline no longer report "no headings" about an absent document. The same applies after a parse failure or a detach, not only while loading. `useReview().ready` reports false until a document is present and the hook now re-derives when a load fails.
- Updated dependencies [232728c]
  - @docx-editor.dev/i18n@2.1.0

## 2.0.1

### Patch Changes

- Updated dependencies [51f14f5]
  - @docx-editor.dev/core@2.0.1
  - @docx-editor.dev/i18n@2.0.1

## 2.0.0

### Major Changes

- 26095c6: Initial release.

  A WYSIWYG `.docx` editor that runs entirely in the browser: it opens a Word file, paints the real paginated layout, edits it in place, and writes a `.docx` back out.
  - `@docx-editor.dev/react` — the React adapter. `<DocxEditor document={bytes} />` for the packaged editor, or compose `DocxEditor.Root` / `.Viewport` / `.Content` with the hooks (`useEditorState`, `useEditorCommand`, `useDocxEditor`) to build your own chrome.
  - `@docx-editor.dev/core` — the framework-agnostic engine: OPC/XML reading, the canonical OOXML tree, layout, paint, and the `Editor` contract the adapters render.
  - `@docx-editor.dev/i18n` — the shared string catalogue, with nine locales.
  - `@docx-editor.dev/editor-api` — a batching document object model for automating a document from a server or from an editor already open in a page.
  - `@docx-editor.dev/pro` — tracked changes, comments, and custom nodes.

  Word fidelity is structural: styles, theme colours, tables, headers and footers, section layout, numbering, and tab stops resolve through the same cascade Word uses, and content the editor does not model round-trips untouched.

- 26095c6: Remove `EditorHost`, `EditorConfig` and `createEditor` from the public surface. They described a retired pipeline in which the adapter supplied DOM handles and a display sink; the editor has painted its own surface since `createDocxEditor` replaced it, and none of the three had a caller. Use `createDocxEditor` with `DocxEditorConfig`.

### Minor Changes

- 26095c6: Five additions to the customization surface, each one a gap a host had to work around:
  - `DocxEditor.Review` takes a `t` label resolver, like every other compound, and a `card={{ className }}` for the card box itself.
  - `DocxEditor.Review` accepts a render prop as its children, replacing the packaged card while keeping the rail's anchoring, stacking and virtualization.
  - A custom node's review card honours the same part overrides as every other kind, and carries `data-node-name` so a theme can tell one definition's cards from another's.
  - `DocxEditor.Menu.Group` and `DocxEditor.ContextMenu.Group` — a named section of rows with a real `role="group"` taking its heading as the accessible name.
  - `useEditorCaret()` returns the caret as `{ paragraphId, offset }` — the shape the write APIs take as their `at`, and reference-stable so it can be captured in a handler.

  An avatar with no author renders nothing rather than a blank disc, and rail `furniture` unmounts when the pane is shut — a closed rail is a 32px marker strip, and content laid out for the open column has nowhere to go in it.

### Patch Changes

- 26095c6: Document the whole public API surface. Every exported symbol in the engine, the pro modules, the font packages and the automation object model now carries TSDoc, and the generated API reference covers `@docx-editor.dev/core`, `/pro` and `/fonts` alongside the adapters it already described.
- 26095c6: Insert › Table now inserts a table. Pick a size from the 6×6 grid and an empty table with visible borders lands at the caret, columns evenly dividing the page's text width, caret in the first cell. The Insert menu no longer carries an Image row — picture insertion stays available through the image toolbar control and `DocxEditor.Menu.ImageInsert`.
- 26095c6: Resolve fonts on demand. `fonts` now also accepts a function, called once per load with the families the document actually declares, so only what a file needs is loaded. `googleFonts()` from `@docx-editor.dev/fonts/google` serves those families from a pinned, hash-checked catalog of 105 Google-hosted families, and `useFonts` gives React a stable `fonts` prop that never rebuilds the editor. App-supplied faces now also paint, through the same aliasing the engine already uses for embedded fonts.
- 26095c6: Render pictures whose `pic:spPr` or `pic:blipFill` omit optional children. `a:xfrm`, the geometry group and the fill-mode group are all optional in ECMA-376, but each was being required, so a conforming picture was treated as unrecognised content and never drawn. Word writes all of them, which is why this only showed up on files from other producers.

  Size the caret on an empty spaced paragraph to the text rather than the line box. Auto and at-least line spacing add their extra depth below the glyphs, so on a double-spaced empty paragraph the caret was drawn at the full height of the spaced box — about twice the height of the text about to be typed. The same measurement also fixes the highlight band a content control draws on such a line.

- 26095c6: The review rail now measures its position from client rects, so a host that positions its own page wrapper no longer lands the cards on top of the document. Rail furniture no longer pushes every card down by its own height, a custom node's context-menu card wraps instead of stretching the whole menu, the editing-mode menu right-aligns to its pill so a toolbar-end control no longer opens off-screen, and submenu panels place themselves in client space rather than being clipped by the context menu's own scroller.
- 26095c6: Stop an empty paragraph that carries a section break from producing a blank page. The paragraph mark holding a `w:sectPr` is the section break itself, so when it paints nothing it now stays on the page its section ended on instead of opening a sheet the following next-page section then leaves empty.
- 26095c6: Published packages now ship a `THIRD_PARTY_NOTICES.md` reproducing the license of every third-party package bundled into their release artifacts.
- 26095c6: Match Word's vertical pagination by excluding a font's external `hhea.lineGap` from shaped line boxes and allowing auto line-spacing depth below a final glyph band to cross the bottom text margin.
- Updated dependencies [26095c6]
- Updated dependencies [26095c6]
- Updated dependencies [26095c6]
- Updated dependencies [26095c6]
- Updated dependencies [26095c6]
- Updated dependencies [26095c6]
  - @docx-editor.dev/core@2.0.0
  - @docx-editor.dev/i18n@2.0.0

## 1.10.0

### Minor Changes

- bca00eb: Footnotes are now editable in the live editor. Click into a footnote to place a caret, type, select, and delete just like body text; in suggesting mode footnote edits are tracked changes. Edits round-trip back into the Word document. Available in both the React and Vue adapters.

### Patch Changes

- 53ede3c: Anchor the hidden ProseMirror caret to the painted caret so CJK IME candidate windows appear near the visible insertion point.
- Updated dependencies [00c015b]
- Updated dependencies [a631be1]
- Updated dependencies [7a03c16]
- Updated dependencies [c1871b5]
- Updated dependencies [18a686d]
- Updated dependencies [dc3d694]
- Updated dependencies [7a94b49]
- Updated dependencies [53ede3c]
- Updated dependencies [5e7120b]
  - @docx-editor.dev/core@1.10.0
  - @docx-editor.dev/agents@1.10.0
  - @docx-editor.dev/i18n@1.10.0

## 1.9.0

### Patch Changes

- f61435b: Harden `openPrintWindow` to build the print window via DOM APIs instead of `document.write`, so a crafted document title cannot break out into executable markup. The framework-agnostic print helpers are now exported from `@docx-editor.dev/core` as the single source of truth, and the React package re-exports them unchanged.
- 791b132: Remove two potential slow-input denial-of-service paths in the React adapter. The data URL MIME parser now uses index math instead of a backtracking regex, and the toolbar test-id helper no longer scans across unmatched parentheses, so neither degrades on long crafted input.
- Updated dependencies [4b47daf]
- Updated dependencies [9144b69]
- Updated dependencies [826aa32]
- Updated dependencies [826aa32]
- Updated dependencies [12c1f87]
- Updated dependencies [7839ee9]
- Updated dependencies [826aa32]
- Updated dependencies [9454c9a]
- Updated dependencies [f61435b]
- Updated dependencies [28876a2]
  - @docx-editor.dev/core@1.9.0
  - @docx-editor.dev/i18n@1.9.0
  - @docx-editor.dev/agents@1.9.0

## 1.8.3

### Patch Changes

- 5ce3faa: Escape embedded font-family names before interpolating into the injected `@font-face` stylesheet, and build the print window via DOM APIs instead of `document.write` string concatenation. Prevents CSS injection and print-time XSS from crafted DOCX font names.
- Updated dependencies [88a7650]
- Updated dependencies [5ce3faa]
- Updated dependencies [5eb0a43]
- Updated dependencies [673e917]
- Updated dependencies [74e36ef]
- Updated dependencies [447d5b0]
  - @docx-editor.dev/core@1.8.3
  - @docx-editor.dev/agents@1.8.3
  - @docx-editor.dev/i18n@1.8.3

## 1.8.2

### Patch Changes

- 7811a73: Fix caret size and table insert button position when the editor is zoomed. Both are painted inside the zoomed page container, so their geometry is now normalized by the zoom factor instead of being scaled twice.

  Fixes #928

- Updated dependencies [4f183b3]
- Updated dependencies [0c233db]
- Updated dependencies [7811a73]
  - @docx-editor.dev/core@1.8.2
  - @docx-editor.dev/agents@1.8.2
  - @docx-editor.dev/i18n@1.8.2

## 1.8.1

### Patch Changes

- Updated dependencies [6047f84]
  - @docx-editor.dev/core@1.8.1
  - @docx-editor.dev/agents@1.8.1
  - @docx-editor.dev/i18n@1.8.1

## 1.8.0

### Patch Changes

- Updated dependencies [274e45f]
- Updated dependencies [a1f4537]
- Updated dependencies [27740e1]
- Updated dependencies [114e83e]
  - @docx-editor.dev/agents@1.8.0
  - @docx-editor.dev/core@1.8.0
  - @docx-editor.dev/i18n@1.8.0

## 1.7.0

### Minor Changes

- c0923f7: Add `commentsSidebarOpen` and `onCommentsSidebarOpenChange` to `<DocxEditor>` for controlling the comments sidebar's visibility. When `commentsSidebarOpen` is set it becomes the source of truth; `onCommentsSidebarOpenChange` (React prop / Vue `comments-sidebar-open-change` event) fires whenever the editor wants to open or close it. Lets consumers that hide or replace the toolbar (`showToolbar={false}`) toggle the sidebar themselves, or open it programmatically. Omit both to keep the default self-managed behavior.
- 6f51f47: Add `onOpen` and `showFileOpen` props so React consumers can route File > Open through their own import pipeline or hide the built-in Open action.
- e0604af: Add a `showHelpMenu` prop to `<DocxEditor>` (default `true`) for hiding the Help menu in the menu bar. It is threaded through `ToolbarProps`, so the compound `<EditorToolbar.MenuBar />` API respects it too. Consumers that want File/Format/Insert without the Help menu can now pass `showHelpMenu={false}` instead of reaching for CSS overrides.

### Patch Changes

- 2bd49c2: Fix React toolbar toggle buttons losing their color on hover. The active (selected) button now keeps its dark fill on hover instead of showing a white icon over a near-transparent background, and inactive buttons get a visible hover background. These states are now owned by editor.css tokens rather than Tailwind utilities, which did not dedupe (cn is clsx-only).
- 25dbfe9: Fix severe typing and undo/redo latency when editing large documents that contain many comments and tracked changes. Sidebar anchor positions were resolved with a full page scan per comment/suggestion, so an edit near the start of a long review document spent seconds remapping every anchor. The scan now resumes from the previously matched page, cutting start-of-document keystroke latency from seconds to well under the responsiveness budget. Fixes #896.
- 421faf1: Support tracked changes (Suggesting mode) in headers and footers for both React and Vue components, including card positioning in the sidebar and command support.
- edd0bc2: Add themeable document-scrollbar CSS variables and apply the styled scrollbar to both React and Vue document scroll containers.
- Updated dependencies [ed04d10]
- Updated dependencies [35b5cee]
- Updated dependencies [186598a]
- Updated dependencies [2dedf30]
- Updated dependencies [dfd316f]
- Updated dependencies [6b1897a]
- Updated dependencies [8e95d60]
- Updated dependencies [f2c9f9f]
- Updated dependencies [fc95983]
- Updated dependencies [edd0bc2]
- Updated dependencies [d4a27d4]
  - @docx-editor.dev/core@1.7.0
  - @docx-editor.dev/agents@1.7.0
  - @docx-editor.dev/i18n@1.7.0

## 1.6.2

### Patch Changes

- 768b10e: Redesign the document outline toggle as a filled circular button in the left gutter (instead of a bare icon), tighten the outline panel's indentation, and keep the toggle and panel clear of the vertical ruler and of landscape pages.
- Updated dependencies [a8bce7a]
- Updated dependencies [768b10e]
  - @docx-editor.dev/core@1.6.2
  - @docx-editor.dev/agents@1.6.2
  - @docx-editor.dev/i18n@1.6.2

## 1.6.1

### Patch Changes

- Updated dependencies [7c1d1ff]
- Updated dependencies [c25ba18]
- Updated dependencies [26a048f]
- Updated dependencies [74ae87d]
- Updated dependencies [a89af59]
- Updated dependencies [6550426]
- Updated dependencies [4a75c5e]
  - @docx-editor.dev/agents@1.6.1
  - @docx-editor.dev/i18n@1.6.1
  - @docx-editor.dev/core@1.6.1

## 1.6.0

### Minor Changes

- a6a2dd0: Replace the Insert menu's "Page break" item with a "Break" submenu offering page break, section break (next page), and section break (continuous).
- 5509418: Add a `colorMode` prop (`'light' | 'dark' | 'system'`) for native dark mode. Dark mode re-themes the editor chrome through the shared design tokens and renders the document canvas like Word's dark view: a dark page with light text where authored colours are lightness-inverted (hue preserved) for legibility. It is a display transform only; the saved DOCX is unchanged. `'system'` follows the OS `prefers-color-scheme`.
- fae2765: Add a `watermarkPresets` prop to customize the text-watermark dialog's preset list. Pass an array of phrases to replace the built-in MS Word defaults (CONFIDENTIAL, DRAFT, …), or an empty array to hide the preset dropdown. Available in both React and Vue.

### Patch Changes

- 3a4a03f: Fix toolbar dropdowns closing when you scroll inside them. Scrolling the font size picker's preset list now keeps the dropdown open instead of dismissing it. Fixes #808.
- bbda628: Apply selected font picker options by their primary family name so CSS fallback stacks like Lato, sans-serif do not get stored as document font names.
- 7fe09f0: Share the paragraph-style-picker preview logic between the React and Vue toolbars. The filter/sort and per-style preview CSS now live once in `@docx-editor.dev/core/utils/stylePreview` (`resolveParagraphStyleOptions` + `getStylePreviewProps`), which both adapters call, so the style dropdown can no longer drift between them. Also fixes a Vue toolbar bug where typing a font size and then clicking a preset could re-commit the typed value over the preset.
- 7fe09f0: Align the React and Vue toolbar controls. The Vue font-size control is now an editable, clearly-bordered input box (matching React) instead of a plain button, and React's zoom control is now a − / + stepper around the level dropdown (matching Vue), so both adapters present the same editable zoom and font-size controls.
- 7fe09f0: Unify the editor UI colors onto one CSS-variable token palette. The canonical chrome stylesheet now lives in `@docx-editor.dev/core` (`packages/core/src/styles/editor.css`) and both adapters import it, so React and Vue can never drift. Component styles reference `--doc-*` tokens instead of hardcoded colors, and the shadcn HSL tokens are aligned to the same palette and support opacity modifiers. A commented `.ep-root.dark` scaffold is included as the structure for a future dark theme (no dark values are shipped yet — adding the `dark` class has no visual effect until they are filled in). Light-mode appearance is unchanged apart from minor consolidation of near-duplicate grays/blues. As part of this, the Vue full-screen loading overlay now uses the same dark backdrop with light text as React (previously a light backdrop), and the Vue editing-mode chip and toolbar dropdown elevation share React's hover/shadow tokens. The Vue toolbar buttons, dropdown triggers, menu items, and steppers now reference the same shadcn `foreground`/`muted-foreground`/`muted`/`border` tokens React uses (previously the `--doc-*` family), so the toolbar matches React in both light and dark mode; the dropdown triggers also render at React's normal weight (they previously looked bold), and the selected menu item uses React's grey highlight instead of an indigo tint.
- Updated dependencies [a6a2dd0]
- Updated dependencies [931931a]
- Updated dependencies [fa3383b]
- Updated dependencies [32c5382]
- Updated dependencies [7fe09f0]
- Updated dependencies [7fe09f0]
- Updated dependencies [f50a3c7]
- Updated dependencies [7fe09f0]
  - @docx-editor.dev/agents@1.6.0
  - @docx-editor.dev/core@1.6.0
  - @docx-editor.dev/i18n@1.6.0

## 1.5.0

### Minor Changes

- 19a25eb: Add `scrollToCommentId`, `scrollToChangeId`, and `highlightRange` methods to `DocxEditorRef` on both the React and Vue adapters, for revealing a location in the editor. Each scrolls the comment, tracked change, or position range into view and selects it so the selection overlay highlights the spot. `scrollToCommentId` and `scrollToChangeId` return `false` when the id no longer resolves, so callers can surface a "location no longer exists" affordance instead of silently doing nothing.

### Patch Changes

- ab38192: Support clickable inline Word checkbox content controls
- ca275f9: Fix the document outline toggle rendering above the title bar File menu. The outline button now uses the shared `Z_INDEX.outline` layer (40) instead of 50, and the toolbar shell is raised to `Z_INDEX.toolbar` (100) so title-bar dropdowns stay on top. Vue parity: outline toggle at 40, toolbar shell at 100.
- Updated dependencies [7d02ec1]
- Updated dependencies [04130ef]
- Updated dependencies [ab38192]
- Updated dependencies [5cdfa5c]
- Updated dependencies [335ad6c]
- Updated dependencies [c5a4b1e]
- Updated dependencies [c4fd221]
- Updated dependencies [ca005c5]
- Updated dependencies [7d6daeb]
- Updated dependencies [5cdfa5c]
- Updated dependencies [44161e5]
  - @docx-editor.dev/core@1.5.0
  - @docx-editor.dev/agents@1.5.0
  - @docx-editor.dev/i18n@1.5.0

## 1.4.0

### Minor Changes

- 1ab8b30: Image resize: drag a corner handle to scale (keeping aspect ratio) or an edge handle to stretch one side (width or height) and deliberately change the aspect ratio. Selection handles are now Word-style white dots. Inserted images keep their aspect ratio — a wide image dropped into a table cell or a narrow column now scales down to fit while staying in proportion, instead of squashing or overflowing the page. Fixes #266.

### Patch Changes

- Updated dependencies [28a521a]
- Updated dependencies [1ab8b30]
  - @docx-editor.dev/core@1.4.0
  - @docx-editor.dev/agents@1.4.0
  - @docx-editor.dev/i18n@1.4.0

## 1.3.3

### Patch Changes

- bd704e2: Assign every paragraph a stable id when a document is opened, so block ids and `getSelectionInfo().paraId` work before the first edit. Previously a document without `w14:paraId` had null ids until you typed or added a comment. Fixes #738.
- Updated dependencies [bf748c0]
- Updated dependencies [15d4f39]
- Updated dependencies [06fa96b]
- Updated dependencies [bd704e2]
- Updated dependencies [30df527]
  - @docx-editor.dev/core@1.3.3
  - @docx-editor.dev/agents@1.3.3
  - @docx-editor.dev/i18n@1.3.3

## 1.3.2

### Patch Changes

- Updated dependencies [3bd7bf7]
- Updated dependencies [0ded2a1]
- Updated dependencies [58e3a7e]
  - @docx-editor.dev/core@1.3.2
  - @docx-editor.dev/agents@1.3.2
  - @docx-editor.dev/i18n@1.3.2

## 1.3.1

### Patch Changes

- 3fe9c57: Share the layout pipeline across the React and Vue adapters. The Vue editor now renders multi-column section layouts with correct per-section column widths, coalesces a burst of keystrokes into one layout pass per frame, and no longer scrolls the page when you edit. React behavior is unchanged.
- d100115: Fix blank render on documents whose header contains a page-anchored letterhead. The body now clears the header/footer based on in-flow content only, so anchored shapes and text boxes (which Word positions on the page) no longer push the body off the page. Fixes #705.
- 66cf3a8: Share the React/Vue editor orchestration through core so both adapters stay in lockstep. Vue gains three behaviors it was missing: multi-cell selection highlighting, drag-to-edge auto-scroll while selecting, and correct comment/tracked-change ID allocation (IDs are no longer reused after a delete and no longer collide across the comment/revision space). Vue selection rectangles now also cover tab stops and hyperlink text. No public API changes.
- Updated dependencies [3fe9c57]
- Updated dependencies [d100115]
- Updated dependencies [db75f4f]
- Updated dependencies [66cf3a8]
  - @docx-editor.dev/core@1.3.1
  - @docx-editor.dev/agents@1.3.1
  - @docx-editor.dev/i18n@1.3.1

## 1.3.0

### Patch Changes

- 0d5beed: Fix long content in a table row getting cut off / hidden instead of flowing across pages. A table cell now measures its stacked paragraphs the way it paints them — collapsing adjacent paragraph before/after spacing (like Word) instead of adding it — so the row's height matches what's rendered and page breaks land on whole lines instead of slicing a line in two. Selecting text across a table that spans a page break no longer scatters selection highlights into the gap between pages, and contextual spacing is now suppressed inside table cells. Fixes #570.
- Updated dependencies [15966fc]
- Updated dependencies [2003cec]
- Updated dependencies [5e51a9b]
- Updated dependencies [cb5f622]
- Updated dependencies [1be9cf5]
- Updated dependencies [5fcca3b]
- Updated dependencies [f73706e]
- Updated dependencies [0d5beed]
- Updated dependencies [5b38696]
- Updated dependencies [15966fc]
- Updated dependencies [f3d6861]
- Updated dependencies [0f3eb97]
- Updated dependencies [eaa6f7f]
  - @docx-editor.dev/core@1.3.0
  - @docx-editor.dev/agents@1.3.0
  - @docx-editor.dev/i18n@1.3.0

## 1.2.1

### Patch Changes

- Updated dependencies [a0adf60]
- Updated dependencies [1c2b098]
  - @docx-editor.dev/agents@1.2.1
  - @docx-editor.dev/core@1.2.1
  - @docx-editor.dev/i18n@1.2.1

## 1.2.0

### Minor Changes

- 362a65f: Make block-level content controls (`w:sdt`) editable. Block structured document tags wrapping paragraphs or tables now convert to a dedicated ProseMirror node, so their content stays editable and the control survives the full edit cycle (previously it round-tripped on save but was flattened in the editor). The control boundary is drawn around its content in the paged view, and the region remains addressable by its tag/alias.
- d791e05: Add content-control (SDT) methods to the editor ref. `getContentControls` lists block controls in the live document (filtered by tag/alias/id/type) with their text and position; `scrollToContentControl` brings one into view; `setContentControlContent` fills a control by tag (as a normal undoable edit); `removeContentControl` deletes or unwraps one. Locked controls are refused unless forced. Paired across the React and Vue adapters.
- a60ed77: Add typed value setters for content controls. `setContentControlValue` (headless) and the `setContentControlValue` editor-ref method (React + Vue) set a dropdown selection, toggle a checkbox, or set a date by tag, updating both the visible content and the structured `w:sdtPr` state (dropdown `w:lastValue`, `w14:checked`, `w:date`'s `w:fullDate`). Validates the value against the control type and list items.
- a60ed77: Support repeating sections (`w15:repeatingSection`) with add/remove, matching Word. `addRepeatingSectionItem`/`removeRepeatingSectionItem` (headless) clone an item with fresh unique ids or drop one (keeping at least one); the editor renders ＋/✕ affordances on each repeating item in React and Vue. Items round-trip losslessly.

### Patch Changes

- Updated dependencies [362a65f]
- Updated dependencies [e30c763]
- Updated dependencies [d791e05]
- Updated dependencies [d791e05]
- Updated dependencies [a60ed77]
- Updated dependencies [bc67374]
- Updated dependencies [a60ed77]
  - @docx-editor.dev/core@1.2.0
  - @docx-editor.dev/agents@1.2.0
  - @docx-editor.dev/i18n@1.2.0

## 1.1.0

### Minor Changes

- 9d7138e: Add a `fonts` prop on `<DocxEditor>` for declarative custom-font registration — each entry injects an `@font-face` from the URL you provide, and entries sharing a `family` register different weights. Also exposes `loadFontFromUrl`, `loadFontDefinitions`, and the `FontDefinition` type from `@docx-editor.dev/core/utils`. Fixes #620.
- 9d7138e: Font-load failures now route through the React `onError` prop and the Vue `error` event instead of the console, so you can forward them to your own error tracker; with no subscriber attached they fall back to `console.warn`. Adds `onFontError(callback)` to `@docx-editor.dev/core/utils` for non-adapter hosts.
- 42ea72d: Track structural edits as OOXML revisions in suggesting mode. Paragraph-break insert/delete, paragraph-property changes, and table row/cell insert/delete/merge are now recorded, round-tripped through DOCX, and shown in the tracked-changes sidebar (React and Vue, localized). Adds `acceptChangeById(id)` / `rejectChangeById(id)`, and `acceptAllChanges` / `rejectAllChanges` now resolve every revision type rather than inline marks only. Fixes #614.

### Patch Changes

- 371dbaf: Fix Find navigation in the paged editor: matches now map to live document positions, the page scrolls to the active match, and Enter advances through results instead of snapping back to the first. Fixes #321.
- 79c68b0: Fix hyperlink popup text and URL inputs being uneditable. The editor container's focus and keydown handlers were redirecting focus to the document, so the popup inputs could never hold focus or accept typing.
- Updated dependencies [14fe4f2]
- Updated dependencies [9d7138e]
- Updated dependencies [7e77654]
- Updated dependencies [bf11ee8]
- Updated dependencies [30c1931]
- Updated dependencies [9d7138e]
- Updated dependencies [7a91813]
- Updated dependencies [a7f9ac5]
- Updated dependencies [42ea72d]
- Updated dependencies [ebb85a5]
- Updated dependencies [137d5de]
- Updated dependencies [e5e0997]
  - @docx-editor.dev/i18n@1.1.0
  - @docx-editor.dev/core@1.1.0
  - @docx-editor.dev/agents@1.1.0

## 1.0.3

### Patch Changes

- 3e4b98e: Fix inline-image header lines to match Word. A line with a tall inline logo plus short text now baseline-aligns the label with the image bottom instead of centering it in an inflated line box, so it hugs the paragraph border. Inline images also honor their `wp:inline` distT/distB wrap distances, which previously only the block-image path applied.
- 0a93cc3: Internal: co-locate the Tailwind library config inside `packages/react/`. No runtime change.
- 6d56181: Vue now renders documents with stacked floating objects identically to React. Previously, the Vue composable ran a simplified measurement pipeline without floating-zone awareness, so anchored images / floating textboxes / floating tables would not push body text below them in Vue. The float-extraction and per-block orchestration is now shared from `@docx-editor.dev/core/flow-model` (`measureBlocksWithFloats`); both adapters call it with their own per-block measure callback.
- e80093d: Body text now flows around stacked floating objects correctly. Documents with a side-anchored textbox plus an image floating to the right, or with a floating table whose width fills the page, used to render body paragraphs at full content width on top of the floats, push tables to the page top, or collapse the first paragraph to a single glyph per line. All three cases now match Word's layout.
- Updated dependencies [24b31a4]
- Updated dependencies [ec36a50]
- Updated dependencies [143c31e]
- Updated dependencies [d91357e]
- Updated dependencies [bdd7f50]
- Updated dependencies [6d56181]
- Updated dependencies [e80093d]
  - @docx-editor.dev/core@1.0.3
  - @docx-editor.dev/agents@1.0.3
  - @docx-editor.dev/i18n@1.0.3

## 1.0.2

### Patch Changes

- eb785dc: Fix `generateHexId` producing `w14:paraId` / `w14:textId` / comment `paraId` / `w16cid:durableId` values above their OOXML `ST_LongHexNumber` caps.

  `paraId` / `textId` are capped at `< 0x80000000`; `durableId` is capped at the stricter `< 0x7FFFFFFF`. Half of generated IDs previously landed in `[0x80000000, 0x100000000)` (paraId/textId/comment-paraId violations) and `0x7FFFFFFF` itself was also reachable (durableId violation). Word silently recovers these as "Document Recovery — Table Properties" on open and strict OOXML validators reject them.

  The generator now draws from `[0, 0x7FFFFFFE]` — the strictest bound across all consumers — so every ID is valid for every field that uses `generateHexId`.

- ba67554: Render PAGE/NUMPAGES/DATE field results with their own run formatting. The layout bridge dropped the field node's character marks, so a page number in a footer painted at the default font size and color instead of the footer run's.
- Updated dependencies [4e73af5]
  - @docx-editor.dev/core@1.0.2
  - @docx-editor.dev/agents@1.0.2
  - @docx-editor.dev/i18n@1.0.2

## 1.0.1

### Patch Changes

- fe4cb94: Add per-locale subpath imports to `@docx-editor.dev/i18n` so dynamic locale loading can code-split a single locale instead of bundling the whole set:

  ```ts
  // Static — bundler ships only this locale's strings
  import pl from '@docx-editor.dev/i18n/pl';

  // Dynamic — splits into its own chunk, loaded on demand
  const pl = (await import('@docx-editor.dev/i18n/pl')).default;
  ```

  Subpaths ship for every locale: `/en`, `/de`, `/he`, `/pl`, `/pt-BR`, `/tr`, `/zh-CN`. The named exports on the package root still work — pick the ergonomic path for static lists, the subpath for runtime locale switching.

  Also re-export `createEmptyDocument`, `createDocumentWithText`, and `CreateEmptyDocumentOptions` from `@docx-editor.dev/react` and `@docx-editor.dev/vue` so the common "spawn a blank editor" affordance no longer requires installing `-core` alongside the adapter.

  Surface `Comment`, `CommentRangeStart`, `CommentRangeEnd`, `TrackedChangeInfo`, `TrackedRunChange`, `Insertion`, `Deletion`, `MoveFrom`, `MoveTo`, and `ParagraphContent` from the main `@docx-editor.dev/core` entry. They were already public via `@docx-editor.dev/core/headless`; the main entry just hadn't been re-exporting them.

- Updated dependencies [8d60d65]
- Updated dependencies [7806b78]
- Updated dependencies [a193caa]
- Updated dependencies [fe4cb94]
  - @docx-editor.dev/core@1.0.1
  - @docx-editor.dev/i18n@1.0.1
  - @docx-editor.dev/agents@1.0.1

## 1.0.0

### Major Changes

- 6272b32: # 1.0.0

  First multi-package, multi-framework release. The monolithic `@eigenpal/docx-js-editor` is split into a framework-agnostic core and per-framework adapters, Vue 3 ships as a first-class adapter alongside React, and the license moves to Apache 2.0 across all packages.

  ## Package restructure (breaking)

  | Old import                            | New import                           |
  | ------------------------------------- | ------------------------------------ |
  | `@eigenpal/docx-js-editor`            | `@docx-editor.dev/react`             |
  | `@eigenpal/docx-js-editor/react`      | `@docx-editor.dev/react`             |
  | `@docx-editor.dev/react/core`         | `@docx-editor.dev/core`              |
  | `@docx-editor.dev/react/headless`     | `@docx-editor.dev/core/headless`     |
  | `@docx-editor.dev/react/core-plugins` | `@docx-editor.dev/core/core-plugins` |
  | `@docx-editor.dev/react/mcp`          | `@docx-editor.dev/agents/mcp`        |
  | `@docx-editor.dev/react/i18n/*.json`  | `@docx-editor.dev/i18n/*.json`       |

  The old `@eigenpal/docx-js-editor` package stays on 0.x for legacy maintenance — no 1.x compatibility shim ships. Framework-agnostic utilities (e.g. `createEmptyDocument`) move to core:

  ```diff
  - import { DocxEditor, createEmptyDocument } from '@eigenpal/docx-js-editor';
  + import { DocxEditor } from '@docx-editor.dev/react';
  + import { createEmptyDocument } from '@docx-editor.dev/core';
  ```

  ## Vue 3 adapter (`@docx-editor.dev/vue`)

  The Vue package becomes a real adapter (previously a stub). Public API mirrors React:
  - `<DocxEditor>` with matching prop surface
  - `useDocxEditor` composable + `renderAsync` for the Node.js path
  - `/ui`, `/composables`, `/dialogs`, `/plugin-api`, `/styles` subpaths

  Parity gates cover insert-table, find/replace, page-setup, context menus, image overlay (resize/move/rotate/aspect-locked corners, dimension tooltip), advanced cell/row options (margins, height rule, text direction, no-wrap), menu-bar icons + shortcuts + carets, toolbar pickers, and the agent UI surface.

  ## Shared i18n package (`@docx-editor.dev/i18n`)

  Locale strings move out of `@docx-editor.dev/react` into a dedicated package consumed by both adapters from a single source.

  ```diff
  - import de from '@docx-editor.dev/react/i18n/de.json';
  + import de from '@docx-editor.dev/i18n/de.json';
  ```

  The `defaultLocale` value (English) is still re-exported from the adapter packages, unchanged.

  ## Agent UI relocation (breaking)

  `AgentPanel`, `AgentChatLog`, `AgentComposer`, `AgentSuggestionChip`, `AgentTimeline` no longer ship from `@docx-editor.dev/react`. They live at:
  - `@docx-editor.dev/agents/react` — React components + `useAgentChat`
  - `@docx-editor.dev/agents/vue` — Vue 3 twins, plus `AIContextMenu` and `AIResponsePreview`
  - `@docx-editor.dev/agents/ai-sdk/react` / `/ai-sdk/vue` — `@ai-sdk/*` adapters
  - `@docx-editor.dev/agents/bridge` — React-free `createEditorBridge`, `agentTools`, `executeToolCall`, `getToolSchemas`, `createReviewerBridge`. Safe for headless / Vue / Node.

  ```diff
  - import { AgentPanel, AgentChatLog } from '@docx-editor.dev/react';
  + import { AgentPanel, AgentChatLog } from '@docx-editor.dev/agents/react';
  ```

  The agent components no longer call `useTranslation` directly — pass localized `*Label` props instead. `<DocxEditor>`'s built-in agent panel slot still forwards localized strings automatically.

  Accessibility polish on the agent surface: keyboard-operable resize handle, Escape-dismissable context menu, live-region chat log, WCAG AA contrast on response previews.

  ## Toolbar naming unified (breaking)

  The standalone formatting bar is `Toolbar` on both adapters. The old "classic" single-row `Toolbar` (with File/Format/Insert menus baked in) is removed — compose `EditorToolbar.MenuBar` + `EditorToolbar.Toolbar` for that layout.

  | Old (React)                    | New (React + Vue)       |
  | ------------------------------ | ----------------------- |
  | `FormattingBar`                | `Toolbar`               |
  | Classic `Toolbar` (with menus) | `EditorToolbar`         |
  | `EditorToolbar.FormattingBar`  | `EditorToolbar.Toolbar` |

  Vue: `BasicToolbar` / `FormattingBar` aliases removed; `EditorToolbar`'s `formatting-bar` slot is now `toolbar`. Vue's table border-color and cell-fill pickers now use the advanced color picker matching React. Vue `MenuDropdown`'s `showChevron` default flips from `true` to `false` — pass `:show-chevron="true"` explicitly to keep the caret.

  ## `showPrintButton` prop removed (breaking)

  Removed from `<DocxEditor>` and `<Toolbar>` on both adapters; the Vue `<Toolbar>` `print` event is gone with it. `onPrint` callback stays.

  ```diff
  - <DocxEditor showPrintButton onPrint={handlePrint} />
  + <DocxEditor onPrint={handlePrint} />
  ```

  To hide File > Print, omit `onPrint`. Programmatic print still works via `ref.current.print()` / `editorRef.value.print()`.

  ## License moves to Apache 2.0

  All published packages relicense to Apache 2.0. Notably: `@docx-editor.dev/agents` was AGPL-3.0-or-later — the relicense lifts copyleft obligations on agent embedders.

- fd1f9de: `@docx-editor.dev/i18n` ships its public surface as named exports from the package root. One import path, IDE-discoverable, tree-shakeable.

  ```ts
  import {
    // Locale data — typed
    en,
    de,
    pl,
    tr,
    he,
    ptBR,
    zhCN,
    // Runtime lookup by BCP-47 tag
    locales,
    // Types
    type LocaleStrings,
    type Translations,
    type TranslationKey,
    type LocaleCode,
  } from '@docx-editor.dev/i18n';
  ```

  `en` is typed as `LocaleStrings` (source of truth, 100% coverage). Every other locale is `PartialLocaleStrings` (null leaves fall back to English). Hyphenated locale codes use camelCase identifiers (`ptBR`, `zhCN`); the `locales` record keeps BCP-47 keys (`'pt-BR'`, `'zh-CN'`) for runtime lookup.

  The package is marked `sideEffects: false`, so importing one locale from the root tree-shakes the rest. Verified with esbuild: a consumer importing only `en` ships ~26KB.

  Breaking from earlier (unpublished) shape: the `./<locale>.json` subpath exports are gone. Everything goes through the root. The `LocaleStrings`, `Translations`, `PartialLocaleStrings`, and `TranslationKey` types are no longer re-exported from `-react` or `-vue`. Runtime exports from the adapters (`LocaleProvider`, `useTranslation`, `provideLocale`, `i18nPlugin`, `createTranslator`, `defaultLocale`) are unchanged.

### Patch Changes

- c395aa6: Render anchored DOCX text boxes with square text wrapping instead of converting them into standalone blocks.
- 0187af2: Emit consumer-friendly JSON docs at `docs/json/<pkg-slug>/<subpath>.json` for every `@public` export across the published packages. Companion to the existing `etc/<slug>.api.md` snapshots — same source of truth (API Extractor), different output shape: instead of human-readable Markdown, the JSON is structured for a docs site to render any layout it wants. Includes per-export source-link URLs into the GitHub source tree, type-reference canonical IDs for cross-page linking, and TSDoc summaries/remarks/examples parsed out of the source.

  New tooling: `bun run docs:json` regenerates, `bun run docs:check` (in CI) fails on drift. Contract documented in `CLAUDE.md` under `### Docs JSON`. No runtime change to any published package.

- 9d4d30e: Anchor hyperlink popup to its link on scroll; close Vue popup on outside click.
- 5d11c1a: Fix dense footnote rendering at page bottom
- bba58e4: Internal refactor: continue the DocxEditor.tsx cap effort. Extract the 432-LOC useImperativeHandle block into a useDocxEditorRefApi hook (preserves the dep array byte-for-byte so the editor-contract gate stays green). Pull the floating-overlay block (hyperlink popup, text + image context menus, toast container) into DocxEditorOverlays. Pull the lazy-loaded Suspense dialog block into DocxEditorDialogs — the lazy() import sites move with the JSX so the dialog code-split chunk is owned by the new component. Memoize the 60-line onSelectionChange closure on the PagedEditor mount. DocxEditor.tsx now 3724 → 3183 LOC. No public API change.
- 5a4ef95: Internal refactor: continue the DocxEditor.tsx cap effort, mirroring Vue's hook decomposition. Three more domain hooks extracted: useContextMenus (right-click text + image menus, contextMenuItems memo, handleContextMenuAction switch — comment-state writes routed through an onAddComment callback), useCommentManagement (controlled/uncontrolled comments routing, floating add-comment button position, new-comment workflow state, commentsRef mirror, orphaned-comments debouncer), and useCommentLifecycle (thread comments under overlapping tracked changes, auto-open sidebar on documents with existing tracked changes). DocxEditor.tsx 2634 → 2234 LOC. No public API change.
- cff5be4: Internal refactor: continue the DocxEditor.tsx cap effort by splitting the JSX render tree. Two new child components: DocxEditorToolbar (wraps the EditorToolbar with its 30+ props plus the title-bar slots and trailing extras) and DocxEditorPagedArea (PagedEditor mount, sidebar overlay, floating add-comment button, inline header/footer editor). DocxEditor.tsx 1972 → 1815 LOC. No public API change.
- 6ff5d22: Internal refactor: split DocxEditor.tsx (5158 → 3712 LOC, -28%) into focused hooks under `components/DocxEditor/hooks/` — useOutlineSidebar, useKeyboardShortcuts, useFileIO, usePageSetupControls, useHyperlinkActions, useFindReplaceBridge, useFormattingActions, useImageActions — plus 6 micro-components (CommentsSidebarToggle, LocalizedAgentPanel, PageIndicator, AgentPanelToggle, OutlineToggleButton, EditingModeDropdown) and a `commentFactories` module that hides the shared comment/revision ID counter behind getNextCommentId/bumpNextCommentIdAbove helpers. No public API change.
- 999a48d: Internal refactor: split PagedEditor.tsx (3230 → 775 LOC) into focused hooks under `components/DocxEditor/hooks/` — useLayoutPipeline, useSelectionOverlay, useImageInteractions, usePagedScrollApi, usePagesPointer, usePagedEditorRefApi, useLayoutTriggers — plus pure helpers domSelection.ts + tableResize.ts. No public API change.
- 348fa6b: API Extractor snapshots for the 6 published subpaths of `@docx-editor.dev/react` (root, `/ui`, `/hooks`, `/dialogs`, `/plugin-api`, `/styles`) and `@docx-editor.dev/vue` (root, `/ui`, `/composables`, `/dialogs`, `/plugin-api`, `/styles`). CI now fails on undocumented public-surface drift via `bun run api:check`.

  Adds `etc/parity.contract.json` — the cross-adapter parity contract listing which `DocxEditorProps` fields and `DocxEditorRef` members are paired between React and Vue, which are deliberately deferred in Vue, and which are Vue-exclusive. `bun run check:parity-contract` (also gated in CI) parses both snapshots and fails on any drift the contract doesn't acknowledge. Adding a new prop or ref method to either adapter forces an explicit classification in the contract.

  Vue composables now declare named `Use*Return` interfaces (`UseClipboardReturn`, `UseFindReplaceReturn`, `UseSelectionHighlightReturn`, `UseTableSelectionReturn`, `UseHistoryReturn`, `UseTableResizeReturn`, `UseDragAutoScrollReturn`, `UseVisualLineNavigationReturn`, `UseDocxEditorReturn`). Before this change the composables returned anonymous object literals that recursively expanded core's internal types in the published `.d.ts`, inflating `etc/composables.api.md` to 3,526 lines and locking core's internal `Run`/`Comment` shape into Vue's public contract. Named returns drop the snapshot to ~450 lines and decouple Vue's surface from core's internals.

  Vue's `useTableSelection` no longer exposes `manager: TableSelectionManager` in its return — it was unused by any internal consumer and leaked core's `TableSelectionManager` class as part of Vue's public surface.

  Side effect for `@docx-editor.dev/vue`: the build no longer writes workspace-relative source paths (e.g. `../../core/src/core.ts`) into published declarations. Those paths were valid in this repo but unresolvable once installed from npm; setting `pathsToAliases: false` on the dts plugin keeps the package names (`@docx-editor.dev/core`, `@docx-editor.dev/i18n`) intact in `dist/*.d.ts`.

  No runtime change for either package.

- 29f9575: Preserve fields, nested SDTs, and math inside `<w:sdt>` content controls so docProps-bound titles wrapped in SDT render correctly.
- 491ec9a: Preserve fields, nested SDTs, and math inside inline SDT content on save. Completes #482 by mirroring its parser-side widening in the serializer and PM → Document converter so docProps-bound title fields survive a full load → edit → save round-trip.
- 5a30387: Inherit header/footer references and titlePg from earlier sections per ECMA-376 §17.6. Fixes templates that set these on the cover sectPr only.
- 7c3f2e1: Internal Vue refactor: extract `useImageActions`, `useContextMenus`, `usePagesPointer`, `useSelectionSync`, and `useDocxEditorRefApi` composables from `DocxEditorVue.vue`. No public API change.
- 9233c6e: Internal: `DocxEditorVue.vue` now under the 1000-LOC cap (897). Split template into `DocxEditorMenuBar`, `DocxEditorDialogs`, `DocxEditorOverlays`; extracted `useMenuActions`, `useCommentLifecycle`, `useDocumentLifecycle` composables; moved styles to a co-located `.css` file. No public-API change.
- 372cab6: vue: internal source restructure for React parity — `DocxEditorVue.vue` → `DocxEditor.vue`, root-level `docx-editor-props.ts` / `editor-mode.ts` / `editor-ref.ts` consolidated into `components/DocxEditor/types.ts`, orchestration files nested under `components/DocxEditor/`. No public API change.
- Updated dependencies [6272b32]
- Updated dependencies [c5125ff]
- Updated dependencies [76093f9]
- Updated dependencies [c5125ff]
- Updated dependencies [348fa6b]
- Updated dependencies [0187af2]
- Updated dependencies [6b8f1fb]
- Updated dependencies [61983ca]
- Updated dependencies [f7b8dc7]
- Updated dependencies [b2230a3]
- Updated dependencies [8836214]
  - @docx-editor.dev/core@1.0.0
  - @docx-editor.dev/agents@1.0.0
  - @docx-editor.dev/i18n@1.0.0

## 0.5.1

### Patch Changes

- f7a1060: Fix header/footer table parity issues in paged render and inline editing, including header recreation after removal.
- cbff36e: Resolve themed table-cell border colors (`w:themeColor`) against the document theme so they render correctly in the inline header/footer editor and copied HTML, instead of falling back to the default Office palette.
- 2158433: Add Turkish (tr) translation with 100% coverage.

## 0.5.0

### Minor Changes

- 5fddb75: Image layout modes (Word-style): right-click image menu and toolbar dropdown now share five directional options (In Line with Text · Square Left · Square Right · Behind Text · In Front of Text) plus Cut/Copy/Paste/Delete. Inline ↔ anchor transitions promote inline images to anchored floats at the same rendered position (Word's behavior) and back, with full OOXML round-trip. Layout helpers (`pointerTargetResolveImage`, `captureInlinePositionEmu`, `deriveLayoutChoice`, `IMAGE_LAYOUT_OPTIONS`, `toolbarValueToLayoutTarget`) are exported from `@eigenpal/docx-core/painter-model` so framework adapters share them.
- c605277: Close 16 OOXML rendering gaps from the post-PR-#421 audit (#423): vertical anchor `align`, the six unhandled `relativeFrom` variants, bare `wp:positionH/V`, image crop (`wp:srcRect`), transparency (`a:alphaModFix`), `wp:effectExtent` shadow padding, rotation pivot, `layoutInCell` / `allowOverlap` round-trip, `w:vanish` / `w:rtl` / `w:effect` per-run, `w:trHeight hRule="exact"` enforcement, and `w:noWrap` on cells. `w:framePr` and `w:cols`-with-anchored-images are preserved on round-trip; visual rendering of those is left as a documented follow-up.

### Patch Changes

- aefb8c6: Serialize all integer-typed OOXML attributes (EMU and twips) as integers. Floating-point drift from arithmetic like `inches * 1440` (e.g. `0.7 * 1440 === 1008.0000000000001`) or `(px / 96) * 914400` (e.g. `cy="495299.99999999994"`) caused saved files to fail to open in Microsoft Word, even though tolerant readers accepted them. (fixes #417)

  Behavior changes for callers:
  - `pixelsToEmu`, `twipsToEmu`, and `emuToTwips` now round their result to the nearest integer. Previously they could return values like `495299.99999999994`.
  - `createEmptyDocument` rounds `pageWidth`, `pageHeight`, and all `margin*` options to integer twips at the API boundary.
  - `InsertImageCommand` (`agent.insertImage`) now correctly converts `width` / `height` from pixels to EMU. Previously it multiplied pixels by 914400 instead of 9525, producing images 96× the requested size (a 100 px image became a 96-inch image). Default 100 px now produces a ~1.04-inch image, matching the documented behavior.

  Defensive: every integer-typed XML attribute in the document, paragraph, table, and run serializers now coerces its value to an integer at write time, so fractional values reaching the serializer through any code path can no longer corrupt the saved file.

- b6c26db: Render `wp:wrapNone` anchored images (`behind` / `inFront`) as positioned floats instead of block images. They no longer consume paragraph flow height or create text-wrap exclusion zones, matching Word's behavior.

## 0.4.3

### Patch Changes

- 5fd14f9: Fix selection highlights bleeding from body into headers and footers. When body and header content shared low PM positions (because each is parsed as a separate ProseMirror document), the DOM-based selection painter matched both trees and drew phantom rectangles on every header and footer. Selection rectangles and caret lookups are now scoped to `.layout-page-content`.
- 11abc2d: Four header/footer fidelity follow-ups from the unification refactor:
  - **#379** — `RenderContext.positioning` controls renderer outer position. `paintTableFragment` and `paintParagraphFragment` now pick `position: absolute` vs `position: relative` based on context, so HF / textbox callers don't have to flip inline styles after the fact. Removes the post-render `style.position` flips at three call sites.
  - **#380** — Inline-vs-inherited paragraph spacing strip. `normalizeHeaderFooterMeasureBlocks` now strips `spaceBefore` / `spaceAfter` ONLY when they were resolved from a paragraph style (e.g. Normal's default 8pt-after) and not specified inline on the HF paragraph itself. Inline `<w:spacing>` is preserved per ECMA-376 §17.3.1.33; previously the blanket strip collapsed intentional Word spacing.
  - **#381** — Trailing empty paragraph after a table renders at zero height. OOXML requires a trailing block-level element after the last `<w:tbl>` (the canonical convention is an empty `<w:p/>`). Word renders that paragraph as a zero-height anchor; we previously added `~14pt` of phantom space. The new `suppressEmptyParagraphHeight` flag on `ParagraphAttrs` opts the empty paragraph out of the default empty-line height fallback during measurement, while keeping the block itself for click-to-position.
  - **#382** — Floating tables (`<w:tblpPr>`) honor `tblpX` / `tblpY` in headers/footers. New `resolveHeaderFooterFloatingTablePosition` resolves the anchor (`page` / `margin` / `text`) per ECMA-376 §17.4.57 and positions the table at the requested coordinates instead of inline at `cursorY`. Floating tables don't advance `cursorY` — surrounding HF blocks flow as if the table weren't there, matching Word's no-wrap behavior.

  `normalizeHeaderFooterMeasureBlocks` extracted into its own file to enable unit testing.

  Closes #379, #380, #381, #382.

- 0d3581d: Set package homepage to https://docx-editor.dev/.
- 4e194d7: Inline images in table cells now have visual breathing room. Previously when an image was taller than the parent paragraph's text line height, the line height was overwritten with the bare image height — so an image alone in a table cell rendered flush with the cell borders. Word treats an inline image as a tall glyph sitting on the text baseline: the image extends above the baseline (full ascent) and the line still reserves the parent font's normal descent + leading below. The line now grows to image-height + text-line-height, giving cells natural padding around image-dominant lines.
- e12c337: Footnote rendering now routes through the body pipeline (`footnoteToProseDoc → buildBoxTree → measureBlocks`), eliminating the shadow stack in `footnoteLayout.ts`. Footnotes inherit the full block-kind support of the body — paragraph, table, image, textBox, fields. Pre-PR a footnote that contained a table silently dropped the table; same for inline images and PAGE/NUMPAGES fields.

  The fix mirrors the header/footer unification (#356/#357/#358):
  - **Parser:** `parseFootnote` and `parseEndnote` now walk all child blocks (`<w:p>` + `<w:tbl>`) in document order. The `Footnote.content` and `Endnote.content` types widen from `Paragraph[]` to `(Paragraph | Table)[]` to match the body / HeaderFooter / TableCell shape and reflect ECMA-376 §17.11.10.
  - **Converter:** new `footnoteToProseDoc` next to `headerFooterToProseDoc`; takes `(Paragraph | Table)[]` and produces a PM doc using the same `convertParagraphWithTextBoxes` / `convertTable` machinery the body uses.
  - **Render adapter:** `convertFootnoteToContent` and `buildFootnoteContentMap` move from `core/flow-model/footnoteLayout.ts` to `react/.../PagedEditor.tsx`, parallel to `convertHeaderFooterToContent`. Footnote-specific presentation (default 8pt font, prepended display number as superscript) lives as a small post-process layer (`applyFootnotePresentation`).
  - **Cleanup:** `footnoteLayout.ts` shrinks from 293 lines to ~80 — only the page-mapping helpers remain (`collectFootnoteRefs`, `mapFootnotesToPages`, `calculateFootnoteReservedHeights`).

  Refs #378.

- 4aee2e0: Consolidate body-scoped `data-doc-from` DOM lookups behind `collectBodySpans` / `findBodyEmptyRuns` / `findBodyPmAnchors` / `findBodyPmAnchor` helpers in `@eigenpal/docx-core/flow-model`. Removes the lingering risk that body-only operations (caret resolution, selection painting, scroll restore, image `NodeSelection` lookup, sidebar anchor positioning, visual-line navigation) accidentally match a header or footer run whose ProseMirror position collides with a body position. Same bug class as #391; this finishes the cleanup started in #406.
- 274d858: Run-level OOXML attributes that were already parsed and held as ProseMirror marks now reach the painted DOM. The flow-model's `extractRunFormatting` had no `case` arm for several run-level marks, so the visible renderer silently dropped them while the hidden ProseMirror `toDOM` rendered them correctly:
  - **`w:caps` (§17.3.2.4) — `allCaps`** — uppercase styling on heading runs is no longer lowercased.
  - **`w:smallCaps` (§17.3.2.32) — `smallCaps`** — small-caps styling reaches the painted DOM.
  - **`w:position` (§17.3.2.24)** — baseline shift in half-points now applies as `vertical-align`.
  - **`w:w` (§17.3.2.43)** — horizontal text scale (e.g. 90% tracking on branded templates) applies as a `transform: scaleX(...)` on an inline-block.
  - **`w:kern` (§17.3.2.18)** — kerning threshold gate enables `font-kerning: normal` when the run's font size is at or above the threshold.

  The four `w:position` / `w:w` / `w:kern` properties share a single PM mark (`characterSpacing`) with a multi-attribute container; previously only its `spacing` attribute was bridged, so the other three sat in the model unread.

  Refs #410.

  Also propagates the cosmetic-effect marks (`emboss`, `imprint`, `textShadow`, `textOutline`, `emphasisMark`) which were the same defect class — PM marks parsed correctly but the flow-model had no `case` arm, so painted runs lost the effect. Each maps to the same CSS recipe the hidden PM `toDOM` uses, so editable + painted views stay visually identical.

  Adjacent fix for #392: paragraph runs without an explicit `fontFamily` mark now inherit the paragraph's resolved style font (from the basedOn → docDefaults cascade) instead of falling back to the painter's hardcoded Calibri stack. Same mechanism applies to `fontSize` — runs that don't override fall through to the paragraph's resolved default. Closes the per-run side of the rFonts cascade gap from #412.

  Refs #410, #412, fixes #392.

- 7ff0b6f: Fix style-cascade gaps for runs without an explicit `<w:rStyle>` and tables without an explicit `<w:tblStyle>`. Per ECMA-376 §17.7.4.18, both should inherit from the document's default style of the same type (the one marked `w:default="1"`); pre-PR the default character style was skipped entirely (only docDefaults.rPr reached such runs), and the table-borders cascade was hardcoded to look up styleId `"TableGrid"` instead of the parsed default flag.
  - `StyleResolver.getDefaultCharacterStyle()` finds the default by `w:default="1"` flag (varies by language: "Default Paragraph Font", "FontePadrao", "Fontepargpadro", etc.).
  - `resolveRunStyle()` now applies the cascade `docDefaults.rPr → default character style → explicit character style`, matching the cellMargins / paragraph cascade pattern.
  - `resolveTextFormatting()` no longer short-circuits when a run has no `styleId` — it always consults the full cascade.
  - Table borders cascade replaces the hardcoded `getStyle('TableGrid')` with `getDefaultTableStyle()`, matching the cellMargins cascade and working for documents whose default table style has any styleId.

  5 new unit tests cover the default character style cascade and the `getDefaultCharacterStyle()` helper. All 449 core tests pass (was 445).

  Refs #412.

- 4e194d7: Three Word-fidelity fixes surfaced by a customer job-description template:
  - **Inline images no longer overflow their containing line.** Browsers compute a non-integer height for `<img>` from the natural aspect ratio when only `width`/`height` attributes are set, which clipped images sized in EMU (e.g. wp:extent `1771650×278918` rounds to `186×29` px but the natural ratio gave `29.29` px). Width/height are now also pinned via inline style, and the inline-image vertical alignment is the default `baseline` rather than `middle` — `middle` adds half-x-height of parent-font leading and pushed the image past the bottom of any line sized to fit just the image (the typical "image alone in a table cell" case).
  - **Explicit `w:before` is honored on the first paragraph of a page/column.** The pageComposer was unconditionally zeroing `spaceBefore` whenever the cursor was at `topMargin`, which dropped Word-authored leading space (e.g. `w:before="1800"` on the title paragraph). Word 2013+ honors explicit before-spacing at the top of a page; trailing-spacing is already reset on new-page so applying it here does not carry spacing across page breaks.
  - **A hard `<w:br w:type="page"/>` in an otherwise-empty paragraph now forces a page break.** `paragraphHasPageBreak` previously required preceding visible content (relying on `renderedPageBreakBefore` to cover leading breaks), but that attr is informational only and not honored at layout, so an empty paragraph containing just a page-break run silently dropped the break.

## 0.4.2

### Patch Changes

- 4425996: Fix `apply_formatting` tool schema rejection by Gemini. The `marks.highlight` enum no longer contains an empty string, which Gemini's `GenerateContentRequest` rejects. Pass `"none"` to clear the highlight.
- 2442eb4: Fix footer overflowing into body content on documents with tracked-change footers (or any footer taller than the authored bottom margin). The auto-extend that pushes body content up to make room for an oversized footer was applied to the document-level fallback margins but not to per-section margins carried on section breaks. The layout engine prefers section-break margins, so the extension was getting overridden and the footer rendered on top of body text. Section-break and final-section margins now also extend.
- ff6dbe8: Fix header/footer interactions in the inline editor: toolbar now reflects table state when the cursor is in a header/footer table cell, right-click shows the table context menu, and the horizontal/vertical rulers stay above the inline HF editor on scroll instead of being painted over. Fixes #384, #385.
- 811bf2c: Fix layout for documents with mixed sections and complex tables. Fixes #319.
  - Documents that mix portrait and landscape sections render with each section's own page size, margins, and columns instead of forcing every page to the body default.
  - Paragraphs that follow `<w:lastRenderedPageBreak/>` (the marker Word writes when it lays out a doc) no longer collapse onto the previous page on first load. The marker survives save+reload at its original position.
  - A section break immediately followed by a `pageBreakBefore` paragraph (e.g. an "Attachment" heading after a section change) no longer leaves a blank page between the body and the heading.
  - Tables with auto-fit grids, zero-width grid columns, or sparse single-cell rows render with correct column widths instead of collapsing or stretching.
  - Tables with vertically merged columns (`vMerge`) or explicit `gridSpan` no longer have continuation cells incorrectly expanded to span the full row.
  - A section override of only `marginRight` or `marginBottom` is now honored; unset sides inherit from the prior section instead of resetting to the OOXML 1440 default.
  - Paragraph spacing inside table cells is applied during measurement and rendering.
  - An oversized paragraph or image (taller than the page content area, possibly after a continuous section break to a smaller page size) is placed with overflow instead of hanging the pageComposer.

- a2f6342: Trim verbose comments and dead test scaffolding left over from #334.
- e32ebed: Fix list numbering when multiple `<w:num>` elements share one `<w:abstractNum>`. Per ECMA-376 §17.9.18 they share counter state and a `<w:lvlOverride>/<w:startOverride>` only resets the shared counter the first time its numId appears. Counter state is now keyed by abstractNumId; first-encounter resets are honored. Also fixes a related justification bug where list-level indents written with `<w:ind w:start="0"/>` were ignored, causing a 720-twip fallback indent to be applied and table-cell text to render 48px short of the cell width.
- 7a2665c: Fix font reset on save when a paragraph style explicitly sets `<w:rFonts ascii="Arial">` while document defaults supply a paired `asciiTheme="minorHAnsi"`. The OOXML render layer treats the theme attribute as overriding the explicit name, so a stale `asciiTheme` from `docDefaults` was silently turning Arial headings into Calibri. The font merge now treats explicit/theme attribute pairs as a unit per ECMA-376 §17.3.2.27. Fixes #387.
- f42ad91: Fix paragraph default font family resolution when a paragraph's pPr/rPr sets only one slot of `<w:rFonts>` (e.g. `w:eastAsia="Calibri"`). Previously the entire fontFamily object was replaced on merge, wiping out other slots inherited from the basedOn chain (e.g. `w:ascii="Arial Narrow"`). Per ECMA-376 §17.3.2.27, each ascii/hAnsi/eastAsia/cs slot — and its theme pair — must merge independently. Identical paragraphs now resolve to the same default font family and render at the same height.
- e89e859: Translate the floating page indicator (the "current of total" widget that appears next to the scrollbar while scrolling a multi-page document). It was rendering the literal string `" of "` regardless of the active locale. Fixes #399. New `viewer.pageIndicator` translation key (`"{current} of {total}"`) routes through the same `i18n` prop as the rest of the UI. Also fills in the four remaining `null` keys in `he.json` (`toolbar.open`, `toolbar.openShortcut`, `toolbar.save`, `toolbar.saveShortcut`) so all six shipped locales (de, en, he, pl, pt-BR, zh-CN) are at 100% coverage.
- 5454bb2: Fix paragraph wrappers double-counting `spaceBefore`/`spaceAfter` in the renderer. The pageComposer already positions `fragment.y` with the gap baked in, but the renderer was also applying it as wrapper padding. Wrapper height is set to line-height only, so the padding pushed text below the wrapper bottom and the next paragraph's background covered the bottom half of the heading text. Symptom on real-world docs: top half of `Dev setup` heading missing — covered by the lavender background of the code block immediately following.
- 1259fa0: Unify header/footer rendering with the body pipeline. Header tables now render in the normal paginated view (previously they were silently dropped on the paginated render path while showing in edit mode), and headers/footers gain full block-kind support — paragraphs, tables, images, text boxes, and PAGE/NUMPAGES fields — by routing through the same `headerFooterToProseDoc → buildBoxTree → measureBlocks → paintFragment` chain the body uses. Fixes #356, #357, #358.
- f6703d0: Add Simplified Chinese (zh-CN) translation.

## 0.4.1

### Patch Changes

- bc02218: Fix long unbroken text overflowing page margins (#334). The page-level CSS default font (`Calibri, "Segoe UI", Arial, sans-serif`) didn't match the canvas measurement fallback (`Calibri, Carlito, ...`), so when Carlito loaded as a web font, line widths were measured against Carlito but rendered against Arial — causing strings like `asdfasdfasdf...` to extend past the right margin. Both sides now use the same `resolveFontFamily('Calibri')` chain.

## 0.4.0

### Minor Changes

- 159cad2: **Curated subpath exports + peerDeps move.** Replaces the `./*` wildcard on `@eigenpal/docx-core` with 17 explicit, tree-shakeable subpaths:
  - Top level: `.`, `./headless`, `./core-plugins`, `./mcp`
  - ProseMirror: `./prosemirror`, `./prosemirror/extensions`, `./prosemirror/conversion`, `./prosemirror/commands`, `./prosemirror/plugins`, `./prosemirror/editor.css`
  - DOCX I/O: `./docx`, `./docx/serializer`
  - Headless agent: `./agent`
  - Layout (`@experimental`): `./pagination-model`, `./painter-model`, `./flow-model`, `./plugin-api`
  - Types: `./types/document`, `./types/content`, `./types/agentApi`
  - Utilities: `./utils`

  **Breaking change for consumers**: `prosemirror-*` packages are now `peerDependencies` (in both `@eigenpal/docx-core` and `@eigenpal/docx-js-editor`) so consumer bundles don't end up with duplicate ProseMirror copies. After upgrading you must install them yourself:

  ```bash
  npm i prosemirror-commands prosemirror-dropcursor prosemirror-history \
        prosemirror-keymap prosemirror-model prosemirror-state \
        prosemirror-tables prosemirror-transform prosemirror-view
  ```

  Also breaks the `schema → StarterKit → extensions → schema` circular import that crashed bundled consumers with `X is not a function`. Extensions now receive their owning `ExtensionManager` via `ExtensionContext.manager` instead of reaching for the module-level `singletonManager`. The `singletonManager` is no longer exported from `./prosemirror` — internal commands still get it via the relative `./schema` path inside the package.

### Patch Changes

- 23a2c7e: Add Hebrew (he) locale

## 0.3.1

### Patch Changes

- e92b349: Fix comments sidebar not repositioning when comments are added programmatically (e.g. via the agent `addComment` ref). Cards no longer overlap until you click one — heights are now re-measured whenever the items list changes, mirroring the existing re-measure pass that runs on expand/collapse.

## 0.3.0

### Minor Changes

- fe17e73: Add Open and Save entries to the toolbar's File menu (with Ctrl+O / Ctrl+S labels) so users can import and download DOCX files without leaving the editor. New translation keys (`toolbar.open`, `toolbar.openShortcut`, `toolbar.save`, `toolbar.saveShortcut`) are wired through the i18n system and synced across community locales.

### Patch Changes

- 06cdf53: Agent now reads and searches the vanilla document. Previously, `read_document` showed insertions inlined and hid deletions (the resolved view), while the search backing `add_comment` / `suggest_change` flattened both — so a phrase the agent picked from `read_document` often failed to anchor and the bridge returned `null` with no diagnostic. Now both the read view and the search view treat the document as it exists right now: tracked insertions are hidden (not in the doc until accepted) and tracked deletions are visible as plain text (still in the doc until accepted). Anchoring against text the agent actually saw works on first try.
- beee9a4: Translate agent panel UI strings — wires `AgentPanel`, `AgentChatLog`, `AgentTimeline`, and `AgentComposer` through `t()` and ships full translations for `de`, `pl`, and `pt-BR`. Previously `agentPanel.*` keys were `null` in every non-English locale, and the chat primitives hardcoded strings like "Working… N steps", "Assistant is thinking", "Ask the assistant…", "Send", and "Resize agent panel".
- 69f5ab0: Translate the four File-menu keys (`toolbar.open`, `toolbar.openShortcut`, `toolbar.save`, `toolbar.saveShortcut`) in `de.json`, `pl.json`, and `pt-BR.json` so German, Polish, and Brazilian-Portuguese users see localized labels instead of the English fallback. All three locales are now at 100% coverage.

## 0.2.0

### Minor Changes

- 6094eaf: Built-in agent panel + chat primitives + expanded toolkit so consumers can plug a streaming AI agent into the editor in ~50 lines. See [`docs/agents.md`](../docs/agents.md).

  ### Agent panel
  - `<DocxEditor agentPanel={{ render }}>` — controllable right-hand dock with toolbar toggle, drag-to-resize, persisted width, animated open/close. Render-prop receives `{ close }`; controlled mode (`open` + `onOpenChange`) lets a parent drive it.
  - New `agent-sparkle` icon and i18n keys across en / de / pl / pt-BR.

  ### Chat primitives (opinionated, optional)
  - `<AgentChatLog>`, `<AgentComposer>`, `<AgentSuggestionChip>`, `<AgentTimeline>` — Google-Docs-style UI for message list, composer, starter chips, and a collapsible tool-call timeline (per-row spinner while streaming, auto-collapses to "N steps" on done).
  - New types: `AgentMessage`, `AgentToolCall`.

  ### Toolkit (`@docx-editor.dev/agents`)
  - Four new tools: `apply_formatting`, `set_paragraph_style`, `read_page`, `read_pages`.
  - `useDocxAgentTools` hook with `include` / `exclude` filters; `executeToolCall` enforces them.
  - `AgentToolDefinition.displayName` for friendly UI labels.
  - New subpath exports — package stays runtime-agnostic, AI SDK helpers are opt-in:
    - `/server` — `getToolSchemas`, `executeToolCall`, `getToolDisplayName` (OpenAI function-calling format)
    - `/react` — `useDocxAgentTools`
    - `/ai-sdk/server` — `getAiSdkTools()` returning `streamText({ tools })` shape
    - `/ai-sdk/react` — `toAgentMessages()` adapting `useChat`'s `UIMessage[]` to `AgentMessage[]`
  - `WordCompatBridge` parity contract — compile-time assertion that `EditorBridge` covers `Range.font.*` and `ParagraphFormat.style`.

  ### Bug fixes
  - **Rapid sequential `addComment` calls now all persist.** The unified `setComments` setter read a stale `commentsRef.current` for every call; a 30-comment burst kept only the last. Now assigns `commentsRef.current` synchronously in uncontrolled mode.

  ### Spec / Word-API hardening
  - **`paraId` allocator** — new `ParaIdAllocatorExtension` assigns fresh 8-char hex `w14:paraId`s on Enter / paste / split. Without this the agent's anchors silently drifted whenever the user typed Enter. Marked `addToHistory: false`.
  - **`apply_formatting`** validates `underline.style` against ECMA-376 §17.3.2.40 `ST_Underline` and `highlight` against §17.3.2.15 `ST_HighlightColor`. Out-of-spec values return a structured error instead of round-tripping invalid OOXML.
  - **`set_paragraph_style`** returns `false` for ids not in `styles.xml` — matches Word's `ItemNotFound` behavior.

  ### Public API additions

  `@eigenpal/docx-js-editor`: `<AgentPanel>`, `<AgentChatLog>`, `<AgentComposer>`, `<AgentSuggestionChip>`, `<AgentTimeline>`, matching prop types, `AgentMessage`, `AgentToolCall`. `DocxEditorRef` gains `applyFormatting`, `setParagraphStyle`, `getPageContent`.

  `@docx-editor.dev/agents`: new `/ai-sdk/server` and `/ai-sdk/react` subpaths (peer dep `ai`, optional). `/server` and `/react` unchanged. `displayName` on `AgentToolDefinition`.

  ### Known limitations (v1.1)
  - Missing Word `Range.font.*` properties: `superscript`, `subscript`, `allCaps`, `smallCaps`, `doubleStrikeThrough`, `colorTheme` tint/shade.
  - No paragraph-level mutators (`alignment`, `lineSpacing`, `spaceBefore`, `spaceAfter`) wired through the toolkit yet.

- 9c0721b: Add `disableFindReplaceShortcuts` to `DocxEditor` so host apps can let the browser handle native Cmd/Ctrl+F and Cmd/Ctrl+H shortcuts.
- c81fdd3: # Live agent chat + server-side MCP support

  A Word-API-style bridge that lets an AI agent read a DOCX, comment on it, suggest tracked changes, and scroll the view — live in a running editor, or server-side against a parsed file. Same tool catalog, same shape, two transports.

  ## The pattern

  Locate, then mutate. The agent calls a locate tool (`read_document`, `read_selection`, `find_text`) which returns paragraphs tagged with their stable Word `w14:paraId`. It passes those paraIds to mutate tools. paraIds survive concurrent edits and tool-loop iterations; ordinal indices don't.

  ## Ten agent tools

  OpenAI function-calling format (also accepted by Anthropic / Vercel AI SDK):
  - **Locate** — `read_document`, `read_selection`, `find_text`, `read_comments`, `read_changes`
  - **Mutate** — `add_comment`, `suggest_change` (one tool, three modes via empty-string semantics: replacement / deletion / insertion at paragraph end), `reply_comment`, `resolve_comment`
  - **Navigate** — `scroll`

  Exported from `@docx-editor.dev/agents` as `agentTools`, `getToolSchemas()`, `executeToolCall(name, args, bridge)`.

  ## Two bridges, same interface

  Everything wires into an `EditorBridge` interface. Two implementations ship:

  ```ts
  // Live editor in a browser
  import { useAgentChat } from '@docx-editor.dev/agents/bridge';
  const { executeToolCall, toolSchemas } = useAgentChat({ editorRef, author: 'AI' });

  // Server-side, against a parsed DOCX
  import { DocxReviewer, createReviewerBridge } from '@docx-editor.dev/agents';
  const reviewer = await DocxReviewer.fromBuffer(buffer, 'AI');
  const bridge = createReviewerBridge(reviewer);
  const result = executeToolCall('add_comment', { paraId, text }, bridge);
  ```

  Both expose the same 10 tools to the agent. The bridge layer abstracts the transport.

  ## MCP server (built-in, spec 2025-06-18)

  ```ts
  import { McpServer, createReviewerBridge, DocxReviewer } from '@docx-editor.dev/agents';
  import { McpServer as _ } from '@docx-editor.dev/agents/mcp';

  const server = new McpServer(bridge, { name: 'my-saas', version: '1.0.0' });
  const reply = server.handle(jsonRpcMessage); // sync, transport-free, never throws
  ```

  - **Transport-agnostic core**: wire `server.handle()` to HTTP-SSE, WebSocket, your queue worker, or a managed stdio process. The library does not pick a transport.
  - **stdio adapter** for customers who want to run the server inside a worker pool: `runStdioServer(bridge)` (Node-only).
  - **Spec compliance**: `initialize` / `tools/list` / `tools/call` / `ping`. Tool failures use the spec's `{isError: true, content: [...]}` envelope inside a successful JSON-RPC response; JSON-RPC errors are reserved for protocol-level problems. Includes UTF-8-safe chunk decoding (multi-byte codepoints don't break across stdio chunks) and a buffer cap to prevent memory DoS.

  A local-install stdio bin was prototyped and removed: one-document-per-config is the wrong shape for a contract-review product. The right deployment is a hosted MCP service the customer operates with their own auth + storage.

  ## Events

  `bridge.onContentChange(listener)` and `bridge.onSelectionChange(listener)` (both return unsubscribe functions) let host apps and MCP servers react to edits without owning the single React callback prop.
  - `ContentChangeEvent` ships `{ commentCount, changeCount, comments, changes }`.
  - `SelectionChangeEvent` ships the current `SelectionInfo` or `null`. (Reviewer bridge: never fires — no caret in headless mode.)

  ## New on `DocxEditorRef`

  ```ts
  addComment({ paraId, text, author, search? }) → number | null
  replyToComment(commentId, text, author)        → number | null
  resolveComment(commentId)                       → void
  proposeChange({ paraId, search, replaceWith, author }) → boolean
  findInDocument(query, { caseSensitive?, limit? }) → FoundMatch[]
  getSelectionInfo()                              → SelectionInfo | null
  getComments()                                   → Comment[]
  onContentChange(listener)                       → () => void
  onSelectionChange(listener)                     → () => void
  ```

  `scrollToParaId` was already public.

  ## New on `@eigenpal/docx-core`

  `findParagraphByParaId(doc, paraId)` returns the PM range for a paragraph by paraId.

  ## Word JS API parity contract

  `WordCompatBridge` (exported type from the package root) formally documents every Office.js Word API method we mirror. A compile-time static assertion enforces that `EditorBridge` satisfies it. If we drop or change a method that's part of the public Word-API mirror, typecheck breaks.

  ## Demos
  - **`examples/agent-use-demo` (roast-my-doc)** — server-side demo of the canonical "build your own MCP-shaped agent server" pattern: parse → `createReviewerBridge` → `agentTools` → tool-call loop with `executeToolCall` → `toBuffer()`. The route's preamble shows the one-line diff to convert it to a real MCP server.
  - **`examples/agent-chat-demo` (chat with your doc)** — live editor + chat panel. Demonstrates `useAgentChat` against a running `<DocxEditor>`.

  Both demos support `ALLOWED_ORIGINS` env var for production deployments (open by default for local dev), forward client `AbortSignal` to OpenAI calls, and cap upload size.

  ## Hardening
  - `proposeChange` refuses to layer onto an existing tracked-change run (would produce invalid OOXML).
  - Ambiguous `search` arguments return an error instead of silently mistargeting.
  - `scroll` does not steal the user's caret.
  - Comment IDs and tracked-change revisionIds use the shared monotonic counter to avoid collisions in OOXML.
  - Mark guards if a host StarterKit omits `comment` / `insertion` / `deletion` extensions.

  ## Spec

  `specs/live-agent-chat.md`.

- 8dba7e8: # Word-style split button for text + highlight color (issue #130)

  Closes [#130](https://github.com/eigenpal/docx-editor/issues/130).

  The font-color and highlight-color toolbar buttons are now Word-style split buttons. Two halves:
  - **Apply half (icon + swatch):** click to re-apply the last color you picked. No dropdown.
  - **Arrow half (▾):** click to open the full color picker (theme grid, standard colors, custom hex, "no color").

  Pick a color once, then for every subsequent occurrence just click the swatch — one click instead of three.

  ## API surface (consolidated)

  The package previously shipped two color pickers — a simple `ColorPicker` and a fuller `AdvancedColorPicker`. The two have been merged into a single `ColorPicker` with two new props:
  - `splitButton?: boolean` — default `true`. Set `false` to render a legacy single-button shape.
  - `defaultColor?: ColorValue | string` — initial "last picked" color used by the apply half before the user picks anything. Defaults: text → red, highlight → yellow, border → black.

  The "last picked" memory is independent of the current selection's color (matches Word). Picking "Automatic" / "No color" does NOT update it.

  ## Breaking changes
  - The legacy `ColorPicker` (the simpler grid picker that ran inline, not via dropdown) has been **removed**. Its types `ColorOption` and the old `ColorPickerProps` shape are no longer exported.
  - `AdvancedColorPicker` has been **renamed to `ColorPicker`**. Update imports:

    ```diff
    - import { AdvancedColorPicker } from '@eigenpal/docx-js-editor';
    + import { ColorPicker } from '@eigenpal/docx-js-editor';
    ```

    The exported `ColorPickerProps` and `ColorPickerMode` types now correspond to the renamed component (formerly `AdvancedColorPickerProps` / `AdvancedColorPickerMode`).

  - CSS class names changed from `docx-advanced-color-picker-*` → `docx-color-picker-*`. If you targeted these in user CSS overrides, update the selectors.

  ## Migration

  No changes needed inside the library — text-color, highlight-color, table-cell-fill, and table-border-color buttons all use the new `ColorPicker` automatically. If you import `AdvancedColorPicker` directly, switch to `ColorPicker`. If you used the legacy simpler `ColorPicker`, the new `ColorPicker` is a drop-in for any case that benefits from the fuller picker; otherwise build a small custom picker — the legacy one was thin enough to inline.

### Patch Changes

- 71a1836: Replace hardcoded `816` page-width literals in `DocxEditor` with the existing `DEFAULT_PAGE_WIDTH` constant exported from `PagedEditor`, and fold the two duplicated `pageWidth` fallback expressions into a single `pageWidthPx` value shared by `UnifiedSidebar` and `CommentMarginMarkers`.
- f31fd5a: Fix document outline overlap and ruler behavior
  - Outline panel no longer sits on top of the page. On wide viewports the page stays where it was (centered, or translated left by the comments sidebar) — only the layout's min-width grows so the centered page never overlaps the panel. On narrow viewports the page + outline scroll horizontally as a unit instead.
  - Outline panel header lines up with the doc's top margin and uses a transparent background so the page's left-side shadow stays visible when the viewport is squeezed.
  - Vertical ruler stays pinned to the viewport's left edge during horizontal scroll instead of scrolling out of view.
  - Horizontal ruler is now sticky inside the scroll container, so it scrolls horizontally with the doc and stays put on vertical scroll. Padding tracks the outline (right shift) and comments sidebar (left shift) so the ruler centers against the same axis as the page.
  - Editor surround uses `--doc-bg` uniformly so the over-scroll/rubber-band area matches the gutter.

- 6a0b9a9: Fix crash when accepting a tracked replacement.

  The `paragraphChangeTracker` plugin walked `tr.steps` using each step's raw `from`/`to`/`pos` against `tr.doc` (the final doc after every step has been applied). Those coords are valid only in the doc as it was _when that step ran_, so a later doc-shrinking step could leave the earlier step's coords past the final doc end and crash `Fragment.nodesBetween` on `undefined.nodeSize`.

  Concretely: `acceptChange` emits `[RemoveMarkStep, ReplaceStep]` when the range contains both an `insertion` mark and a `deletion` (a tracked replace). The replace shrinks the doc, the mark step's `to` becomes invalid in `tr.doc`, and the editor crashes.

  Remap each step's coords through `tr.mapping.slice(stepIndex + 1)` before using them with `tr.doc`, and skip steps whose range was fully consumed by a later deletion. Adds a regression test reproducing the accept-tracked-replacement crash shape.

- 95f8df1: Add Brazilian Portuguese (pt-BR) locale support with 100% translation coverage.

  This PR introduces:
  - New `packages/react/i18n/pt-BR.json` file
  - 619 translated UI strings (100% coverage)
  - Proper locale structure following existing patterns
  - All keys in sync with en.json source

  The translation covers core UI elements including:
  - Common actions (cancel, save, edit, etc.)
  - Toolbar and formatting controls
  - Color picker and dialog interfaces
  - Table operations and context menus
  - Error messages and status indicators

## 0.1.1

### Patch Changes

- 1a9d8eb: Fix caret rendering at the wrong height after changing font size/family in an empty paragraph. The paragraph measurement cache key didn't include `defaultFontSize`/`defaultFontFamily`, so empty paragraphs with different default fonts collided on the same key and the cache returned a stale measurement until the user typed a character.
- 1a9d8eb: Fix font/size/color/highlight changes silently dropping when applied in an empty paragraph (e.g. right after pressing Enter). The mark commands set stored marks before updating the paragraph node, but every transform step clears stored marks — so the chosen value was wiped before dispatch and typed text fell back to the editor default. Reordered so node updates run first.
- 14d7623: ci(release): fix Slack notification release link to use per-package tag (changesets fixed-group ships @eigenpal/docx-js-editor@X.Y.Z, not vX.Y.Z)

## 0.1.0

### Minor Changes

- 91a6f97: Add `fontFamilies` prop to `DocxEditor` to customize the toolbar's font dropdown.

  Pass either bare strings or full `FontOption` objects (or a mix). Strings render in the "Other" group; `FontOption[]` enables CSS fallback chains and category grouping. Omitting the prop preserves the existing 12-font default. Closes #278.

  ```tsx
  <DocxEditor
    fontFamilies={[
      'Arial',
      { name: 'Roboto', fontFamily: 'Roboto, sans-serif', category: 'sans-serif' },
    ]}
  />
  ```

### Patch Changes

- b10a517: Fix three toolbar tooltips/labels that ignored the `i18n` prop and rendered as English regardless of locale: the comments-sidebar toggle, the outline-toggle button, and the Editing / Suggesting / Viewing mode dropdown (including its descriptions). The translation keys already existed in `de.json` and `pl.json`; the components were just bypassing `useTranslation()`. Now wired through correctly.

## 0.0.35

### Patch Changes

- bcc9c6d: Fix a regression where clicking the checkmark of a resolved comment did not re-open the comment card (issue #268). `PagedEditor.updateSelectionOverlay` fired `onSelectionChange` from every overlay redraw — including ResizeObserver and layout/font callbacks — not only on actual selection changes. When the sidebar card resize (or any window resize) triggered a redraw, the parent received a spurious callback with the unchanged cursor and cleared the just-set expansion. Dedup by PM state identity (immutable references) so consumers are only notified for real selection / doc / stored-marks changes.

  Also: cursor-based sidebar expansion now skips resolved comments. Moving the cursor through previously-commented text no longer re-opens old resolved threads — they stay collapsed to the checkmark marker until the user explicitly clicks it.

## 0.0.34

### Patch Changes

- ce89e70: Yjs collab

## 0.0.33

### Patch Changes

- Add i18n

## 0.0.32

### Patch Changes

- Fixes with comments and tracked changes

## 0.0.31

### Patch Changes

- [`d77716f`](https://github.com/eigenpal/docx-editor/commit/d77716f3abc8580ca48d9e2280f6564ce17df443) Thanks [@jedrazb](https://github.com/jedrazb)! - Bump

## 0.0.30

### Patch Changes

- Bump

## 0.0.29

### Patch Changes

- Bump to patch

## 0.0.28

### Patch Changes

- Bump packages
