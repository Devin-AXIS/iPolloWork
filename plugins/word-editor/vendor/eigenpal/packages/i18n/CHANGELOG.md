# @docx-editor.dev/i18n

## 2.39.0

### Patch Changes

- 615f6e2: The note actions menu label is translated into every shipped language.

## 2.38.0

### Minor Changes

- db0e2ca: Add the Italian (`it`) locale catalog and its `@docx-editor.dev/i18n/it` subpath export.

## 2.37.0

No changes in this release.

## 2.36.0

### Minor Changes

- c8ed53d: Formatting cards describe tracked highlight changes, such as “Highlight: yellow”. `ReviewRevisionItem.formattingChanges` includes `highlight` with the `w:highlight` color name.

## 2.35.0

### Minor Changes

- 6c10913: File > Print now asks which markup to print and whether comments print, and passes the choice to the PDF handler as `view.displayMode` and `view.comments`. Set `printSettings: false` on the menu to print the current view without asking.

## 2.34.0

### Patch Changes

- d85ce82: The paragraph style pickers show the built-in styles (Normal, Title, Subtitle, Heading 1 to 9, No Spacing, Quote, Intense Quote, and List Paragraph) in the UI language, and the undo, redo, indent, Go To, and bookmark controls give their disabled reason in the UI language.

## 2.33.0

## 2.32.0

## 2.31.0

### Patch Changes

- 2c318e3: Translate the equation popover messages that explain why an equation cannot be changed with linear editing or in suggesting mode.

## 2.30.0

### Minor Changes

- 5a463b5: Add Russian (ru) translations through the `ru` export and the `@docx-editor.dev/i18n/ru` subpath.

## 2.29.0

## 2.28.0

## 2.27.0

## 2.26.0

## 2.25.0

### Patch Changes

- 5d02def: Remove accidentally included example-only messages from the locale catalogs.

## 2.24.0

### Minor Changes

- 3a8853f: Support inserting, editing, deleting, moving, and resizing body textboxes, with synchronized edits and remote cursors during collaboration. Fix textbox pagination and caret visibility, and keep text direction commands in Format.
- 567c1e5: Add Japanese translations through the `ja` export and the `@docx-editor.dev/i18n/ja` subpath.

## 2.23.0

### Minor Changes

- 5981e48: Add a Spanish (`es`) locale, available as the `es` export and the `@docx-editor.dev/i18n/es` subpath.

### Patch Changes

- 3b95523: Fix translation differences and fill missing interface translations across nine languages.

## 2.22.0

## 2.21.1

### Patch Changes

- 6a7b93a: Match Word when resolving paragraph breaks before tables, numbering-reference insertion history, and partial section-property history. Preserve protection and selected-decision boundaries, and expose structural operation details and accurate table/cell review anchors.

  Show structural decisions in the React and Vue review sidebars by default, with descriptive row, cell, merge, and numbering labels. Keep run/paragraph formatting in balloons while showing formatting without a painted anchor in the sidebar.

## 2.21.0

## 2.20.0

### Patch Changes

- c10916a: Resolve filtered or explicitly selected revisions in one undo unit. Skip unsupported groups and report remaining decisions; retain strict story-wide automation methods.

## 2.19.1

## 2.19.0

## 2.18.0

## 2.17.0

## 2.16.2

## 2.16.1

## 2.16.0

### Patch Changes

- 00666a8: Render, edit, search, and copy text inside smart tags, inline custom XML, and bidirectional run wrappers, and add text form selection, boundary deletion, replacement, field options in React and Vue, and protected filling; Fixes #710

## 2.15.1

## 2.15.0

## 2.14.1

## 2.14.0

## 2.13.0

## 2.12.0

## 2.11.0

## 2.10.0

## 2.9.2

## 2.9.1

## 2.9.0

## 2.8.0

## 2.7.0

## 2.6.1

## 2.6.0

## 2.5.0

## 2.4.1

## 2.4.0

## 2.3.1

## 2.3.0

## 2.2.1

## 2.2.0

### Minor Changes

- 568ccf7: The catalogue drops 456 keys nothing renders, mostly strings for dialogs that no longer ship, and every community locale is pruned to match. `TranslationKey` and `LocaleStrings` narrow accordingly, so naming a removed key is now a type error rather than a lookup that returned nothing visible.

## 2.1.3

## 2.1.2

## 2.1.1

## 2.1.0

### Patch Changes

- 232728c: Complete the German, French, Hebrew, Hindi, Indonesian, Polish, Brazilian Portuguese, Turkish, and Simplified Chinese translations; previously missing strings fell back to English.

## 2.0.1

## 2.0.0

### Patch Changes

- 26095c6: Published packages now ship a `THIRD_PARTY_NOTICES.md` reproducing the license of every third-party package bundled into their release artifacts.

## 1.10.0

## 1.9.0

### Patch Changes

- 28876a2: Make regular expressions over file- and library-supplied strings run in linear time and escape quoted font names completely. The variable-detection, plural-message, and core-properties date regexes no longer backtrack polynomially on hostile input, and font family names are now backslash-escaped before being wrapped in a quoted CSS string so a crafted DOCX font name cannot break out of it.

## 1.8.3

## 1.8.2

## 1.8.1

## 1.8.0

## 1.7.0

## 1.6.2

## 1.6.1

### Patch Changes

- c25ba18: Fix Indonesian (id) locale interpolation: restore the `{total}`, `{minRows}/{maxRows}/{minCols}/{maxCols}`, and `{label}` placeholders that were renamed or dropped, so the find/replace match count, insert-table validation hint, and line-spacing tooltip render their values instead of literal braces.
- 4a75c5e: Add Indonesian (id) community-maintained locale - 97% Coverage

## 1.6.0

## 1.5.0

## 1.4.0

## 1.3.3

## 1.3.2

## 1.3.1

## 1.3.0

## 1.2.1

## 1.2.0

## 1.1.0

### Minor Changes

- a7f9ac5: Add French locale
- 42ea72d: Track structural edits as OOXML revisions in suggesting mode. Paragraph-break insert/delete, paragraph-property changes, and table row/cell insert/delete/merge are now recorded, round-tripped through DOCX, and shown in the tracked-changes sidebar (React and Vue, localized). Adds `acceptChangeById(id)` / `rejectChangeById(id)`, and `acceptAllChanges` / `rejectAllChanges` now resolve every revision type rather than inline marks only. Fixes #614.

### Patch Changes

- 14fe4f2: add Hindi (hi) community-maintained locale

## 1.0.3

## 1.0.2

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

### Patch Changes

- 6b8f1fb: Fill in the last 26 untranslated keys in `de`, `he`, `pl`, `pt-BR`, `tr`, and `zh-CN`. All six community locales now reach 100% coverage against `en.json`.
