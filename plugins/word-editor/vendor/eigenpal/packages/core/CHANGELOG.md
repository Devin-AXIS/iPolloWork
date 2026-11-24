# @docx-editor.dev/core

## 2.39.0

### Minor Changes

- 64f1990: Deleting a paragraph or table inside a footnote, endnote, comment, or text box now works when that story keeps another paragraph, and the caret stays in it. Deleting the last paragraph of a story or table cell, or the last row or column of a table, now fails with `NotSupported` and the new `edit.content-required` diagnostic instead of `GeneralException` and `edit.stale-target`. Fixes #2039
- 768aefd: Picture bullets now draw at their correct size relative to the image's pixel height, so a bullet from a large image no longer fills the page.
- 1d092ab: A rich paste leaves the caret at the end of the pasted content, so the next character you type follows it. Fixes #1990
- 9d4be8f: Table borders now display compound, three-dimensional, dash-dot-stroked, and dashed line styles the same on screen and in PDF output. Wide outer table borders now sit at the table indent, and negative cell margins no longer shift the table.

### Patch Changes

- c6566d9: A centered AutoFit table with a fixed width in a document before compatibility mode 15 now fills the text column correctly when its columns need more room than the column has.
- 6de128b: An AutoFit table cell with `w:noWrap` and no preferred width now keeps its text on one line and widens its column, instead of wrapping the text.
- 66f6efd: Tables now stand beside floating tables and text frames that leave room for them, and floating tables follow their saved alignment, vertical position, and keep-whole settings more closely.
- aa9a33b: Floating objects laid out in a table cell are positioned against the cell text area inside the cell margins, and legacy-mode column alignment keeps the paragraph indents.
- e080a79: Paragraphs with contextual spacing at the edge of a table cell now drop their space when the neighboring cell, the row end, or the paragraph before the table has the same style.
- eea8480: Numbered lists with automatic paragraph spacing in table cells keep the space before their first item and after their last.
- 38861ed: Raised floating tables in multi-column sections now keep their position, and the earlier text they cover moves below them or wraps beside them in each column they cross.
- 0127b12: Text composed with an input method editor (IME) over a selected word that sits between words in another script, such as a Latin code between Hangul words, now replaces the selection instead of disappearing.
- e6bd742: PDF export loads the fonts that empty paragraphs and empty table cells are measured with, so their lines have the correct height when no text uses those fonts.
- 708f28b: Equations with complex-script bold (`w:bCs`) or a complex-script size (`w:szCs`) that differs from `w:sz` now draw as math instead of plain text when their text has no complex-script characters.
- c49fad8: A paragraph at the top of a page now keeps its space before when a floating table it anchors covers it, or, in older compatibility modes, covers the top of the text area beside it.
- 0339cfc: A table positioned against the text now counts its offset from the top of its anchor paragraph, and the spacing around it no longer collapses across the table.
- 344b056: A page- or margin-positioned table on the first page of a continuous section now breaks at the bottom margin of that page.
- 7cfd7a9: Floating tables that share an anchor paragraph and rise above it are now placed in source order, and before compatibility mode 15 a paragraph's space after keeps it clear of a floating table.
- 5d64f9f: With the setting that allows text after a floating table break, the text after a split floating table now starts beside its first part, and every part wraps text on its page.
- e54cebf: A text-anchored floating table whose top distance or negative offset reaches above its anchor now keeps its place, and the earlier lines it meets wrap beside it.
- ece2438: Headers and footers taller than the page push the body by their full height and show only the lines that fit, and top and bottom margins taller than the page stay as authored. Pictures that a table cell anchors against the page take their vertical offset from their row and no longer wrap header or footer text.
- 1fbb476: A header or footer now takes at most half the page height, so a very tall picture in it no longer pushes the body text onto hundreds of pages.
- 9017bbf: Rows whose cells hide their end-of-cell mark and hold only an empty paragraph no longer reserve a line of height.
- 9728828: A floating table inside a table cell is positioned within its cell, and the cell text wraps around it.
- 42c6580: A right-click on a note now opens one menu: the document menu inside the note you are editing, and the note menu on another note or a reference mark. The note menu now has styled rows, keyboard navigation, and closes on an outside press, Escape, or a scroll.
- f6c3687: A selection that starts in a footnote or endnote now extends into the next notes of the same kind. Copy and formatting work across notes; typing, deletion, paste, and cut over such a selection are refused. Fixes #2010
- 4efad2c: The body starts at the authored top or bottom page margin, and a tall header or footer pushes it by its full height instead of stopping at two fifths of the page.
- 2ddc239: Tables follow row-level alignment and indent exceptions, and right-aligned rows in legacy compatibility modes end past the text edge by their first cell's left margin.
- fcb045f: Table rows apply their row-level cell margin exceptions, so a row with a minimum height is no longer padded by margins it does not have.
- 2cae153: Update code comments to cite the ECMA-376 specification.
- 7ca77a4: A table that opens the document now keeps one line in its first row when its cells hide their end marks.
- 764bd09: Table rows with an exact height now place the cell bottom margin below the row content, so the row keeps its full content height.
- 4658f94: Table header rows that do not fit below earlier content now break across pages correctly for the document's compatibility mode. AutoFit and fixed percentage-width tables size their columns more accurately around side rules and cell margins.
- 7daf054: Move the caret between cells of a large table without a pause while the toolbar checks its table controls.
- f4fcb4c: Column breaks in table cells, list markers in centered or styled cells, table style font sizes by compatibility mode, math runs with a kerning threshold, and pie chart legends with several series now lay out correctly.
- e00740b: Type faster in a large table when the edited row grows and pushes the rows below it to later pages.
- ed1f3a1: A heading that starts with a page break is placed on the page where its text appears in tables of contents, page references, links, the navigation pane, PDF links, and Markdown pages. Fixes #1997
- Updated dependencies: @docx-editor.dev/i18n@2.39.0

## 2.38.0

### Minor Changes

- 1f54ef6: Add the Format shape pane and `useSelectedShape` in React and Vue. Handle the added `EditorPaneId` value `shape` in exhaustive switches and `usePaneRequest` filters.
- b742cb2: Documents show sooner because `packagedFonts()` and `googleFonts()` first load the font faces that the text uses and load the other faces in the background. Set `loading: 'eager'` to load every face before the text shows, or `loading: 'lazy'` to load each face when the text first uses it.
- cdc64af: Add `editor.getParagraphs()`, `editor.getParagraphText()`, accepted-text offset helpers, and `replaceAcceptedText` for proofing tools. Update highlight counts as document layout completes.
- 5793d02: Add paragraph change events, accessible proofing highlights, highlight navigation, and editing API critique annotations. Keep keyboard context menus open during background layout.
- 24ce743: Add `replaceAllMatches` to replace matches across document stories in one undo step, with tracking in suggesting mode. Report replaced and skipped matches in `replacements`.
- 3a49612: Let `replaceMatch` and `selectMatch` accept computed ranges and refuse stale targets with `notFound`. Resolve stories from paragraphs and replace matches in closed headers, footers, and notes.
- 4e12c3c: Enable object selection for shapes, lines, groups, and drawings behind text where no text covers the pointer. Allow selection, movement, and deletion of anchor-locked drawings.
- 24ce743: Enable `replaceText`, `applyFormatting`, `splitParagraph`, `mergeParagraphs`, and `removeTabMark` at the selection. Each command creates one undo step and supports suggesting mode.
- ca0a4ad: Add `editor.getSelectionRange()`, `snapshot().selectionRange`, and `editor.getCaretRect()`, with `blockId` targets in `setSelection`. Place keyboard context menus at the caret and expose their trigger through `useContextMenuAnchor()`.
- 3f13fec: Render separate table and cell borders when cell spacing applies, in the editor and PDF export.
- fe49844: Render table and row exception shading in cell-spacing gaps, in the editor and PDF export. Fixes #1900
- c249c34: Add undoable DOCX replacement through `replaceDocument`, `Body.insertFileFromBase64(base64File, 'Replace')`, and document refresh `mode: 'edit'`. Remove collaborative comment thread records when undoing their replies. Fixes #1907, fixes #1934

### Patch Changes

- 948475b: Enable revision and comment editor commands through the review module. Tracked-changes protection refuses revision decisions but permits comments.
- f429ad2: Fix autofit table columns that widened for a long word in a compatibility mode 15 document with automatic hyphenation. The column now keeps its preferred width, and words in capitals stay whole when the document sets `w:doNotHyphenateCaps`.
- 90f044b: Keep autofit columns wide enough for `w:caps` and `w:smallCaps` words when `w:doNotHyphenateCaps` prevents hyphenation.
- dab9554: Preserve balanced spaces beside East Asian text when character spacing or scaling applies under `w:balanceSingleByteDoubleByteWidth`. Fixes #1913
- e2cbc55: Correct percentage widths and placement for right-to-left tables with cell spacing, including tables aligned to the visual left edge. Fixes #1948
- 0299e85: Bound EMF and WMF previews to 2,048 pixels per side while preserving embedded image conversion.
- 5a6e15c: Preserve content types for parts added during collaboration, so saved comments and headers remain readable after reopening.
- 313429a: Keep context menus above host controls and inside the window. Enable arrow-key scrolling when a menu exceeds the window height.
- 845bd85: Render equation delimiters (`m:d`) with brackets and separators sized to their contents.
- c92f662: End page content after a footnote reference when its note continues, moving later rows and paragraphs to the next page.
- e2cbc55: A gradient whose `rotWithShape` spells false with surrounding spaces now keeps its direction in a rotated group.
- 4644e6c: Keep input method composition visible at line ends and preserve it through collaborative edits. Fixes #1912
- 5db571e: Keep input method typing responsive in long documents by committing composed syllables after their display frame. Fixes #1931
- 59809e2: Fix mobile keyboard Backspace actions that removed incorrect characters or restored deleted words. Fixes #1896
- c92f662: Correct table placement with cell spacing or skipped grid columns outside compatibility mode 15. Remove excess height from empty paragraphs after nested tables.
- 0299e85: Keep paragraph notifications complete after listener edits, document replacement, and style removal. Ignore obsolete notifications after document loads.
- f041510: Shape pane number fields now parse long digit strings in linear time.
- e2cbc55: Report command-specific refusal reasons for rotation, flipping, replacement, and hyperlinks on selected shapes and text boxes. Fixes #1944
- ca8b82c: Spaced tables with a thicker outer rule on one side lay out their column widths, frame width, and alignment correctly. Spaced percentage-width tables get the correct width in older compatibility modes.
- 05856f6: Avoid unnecessary control renders and listener updates during typing and layout. Keep snapshot reads consistent with typed text.
- cd04dcc: Preserve an editable empty paragraph after tables that end a body, note, or text box, including during save.
- 414877c: Resolve table column widths correctly for stated table and cell widths, skipped grid columns, and tables with cell spacing.
- e2cbc55: Select callout text boxes through their tails and render complete tails on rotated text boxes. Fixes #1953
- e2cbc55: Render rotated and flipped shape groups with transformed members, and select the group through any painted member. Rotated members in a group that scales its axes unevenly no longer skew. Fixes #1945
- 479c556: Render and select rotated shapes and lines. Keep zero-size lines invisible but selectable. Fixes #1917
- e2cbc55: Render and select complete outlines and geometry outside text-free shape bounds, including callout tails and negative effect extents. Fixes #1946
- Updated dependencies: @docx-editor.dev/i18n@2.38.0

## 2.37.0

### Minor Changes

- 98c0537: Insert and edit charts through React, Vue, or editor commands. Resize, move, wrap, copy, and paste charts.
- 6ed6c40: Edit your own comments and replies through the actions menu or `content` property. Edits support undo, redo, and collaboration.
- 329587e: Resize, move, wrap, and delete DrawingML diagrams, and drag inline charts like inline images. A diagram resize scales its saved drawing to the new frame.
- 9eef508: Add image drops and inline image movement with destination previews, refusal messages, edge scrolling, and custom drop handling. Fixes #1136
- b19ea8f: Preserve content-control prompts during partial selection typing and rich paste. Add insertion bias for tabs, breaks, images, and charts.
- c5b12fb: Add `textRendering` to the canvas measurement context and align painted text with unhinted glyph advances. Canvas-measured text can change line and page breaks in Chromium on Linux.

### Patch Changes

- 32042df: Fix character spacing in distributed paragraphs with balanced space widths.
- 6eb82e6: Reduce browser startup work with native font hashing and remove unused JavaScript from consumer bundles.
- 67f463b: Respect content-control locks and data bindings when editing chart data and formatting.
- a095122: Speed up chart paste in documents with many parts.
- 5dc9dac: Synthesize bold text when an embedded bold font contains regular outlines.
- 6642951: Update `fast-xml-parser` to 5.12.0, which stops quadratic CPU use on unterminated stop-node tags.
- 13f0855: Preserve balanced space widths beside East Asian text and in repeated spaces, including justified lines.
- 329587e: Fix adding a hyperlink to a picture whose DrawingML namespace is declared on its graphic.
- 2294aa0: Delete and Backspace select content-control prompts before removing the control. Copy and cut include the complete prompt.
- Updated dependencies: @docx-editor.dev/i18n@2.37.0

## 2.36.0

### Minor Changes

- c8ed53d: Formatting cards describe tracked highlight changes, such as “Highlight: yellow”. `ReviewRevisionItem.formattingChanges` includes `highlight` with the `w:highlight` color name.

### Patch Changes

- bac199e: Floating objects that wrap text near page bottoms stay on the page when compatibility settings require it. Paragraph-relative and line-relative objects use the correct position on each page.
- 63a5c8f: AutoFit tables preserve cell margins and distribute width reductions proportionally when unbreakable text exceeds the available width. Fixes #1838
- fd9ee96: Input method composition at a text control’s end stays inside the control, including under forms protection. Typing and composition at placeholder boundaries keep the caret after inserted text, including in suggesting mode.
- b131138: Custom shape paths with no current point display nothing. Arcs that sweep more than one turn keep smooth outlines. Fixes #1833
- 44774ad: Shapes, text, charts, and diagrams support all DrawingML color models and transforms, including tints and shades. Fixes #1831
- 304dd92: Paragraphs joining lists with style-linked levels use their indent to select a level. Paragraphs joining ordinary lists use the preceding item’s level. Fixes #1847
- ede53f5: All-capital list numbers leave enough space before paragraph text. List numbers and bullets ignore small-capital formatting. Fixes #1834
- 4d9451d: List space suffixes keep consistent widths across marker fonts. The Normal Table style uses its built-in properties regardless of document overrides.
- e404652: List buttons start a separate list for selections containing list items and plain paragraphs. Selections starting with a plain paragraph join a preceding compatible ordinary list instead. Fixes #1851
- cf257ca: List buttons create independent lists without reusing heading numbering. Paragraphs joining numbered headings take the heading style for their level. Fixes #1842
- a0825f1: Active tracked changes display without an extra underline. Remove the unused `--doc-revision-insertion-active-border` and `--doc-revision-deletion-active-border` tokens.
- 5da2ca2: Saved documents keep paragraph and run properties in schema order, including after concurrent formatting changes. Fixes #1850
- 8eaccb6: Tables remain editable after concurrent formatting changes. Saved documents combine repeated table, row, and cell property elements and keep their contents in schema order. Fixes #1853
- b983305: Cells display table style shading, including after you clear a cell fill. Pattern shading blends the pattern and background colors. Fixes #1844, fixes #1848
- Updated dependencies: @docx-editor.dev/i18n@2.36.0

## 2.35.0

### Minor Changes

- 6c10913: File > Print now asks which markup to print and whether comments print, and passes the choice to the PDF handler as `view.displayMode` and `view.comments`. Set `printSettings: false` on the menu to print the current view without asking.
- 92097ea: Sections with vertical alignment place their text centered, at the bottom, or spread from top to bottom on each page, in the editor and in PDF export.

### Patch Changes

- 68ad495: In dark mode, headers, footers, footnotes, and floating drawings now use the same light colors as the body text.
- 2da039e: A content control that you empty now shows the placeholder that its `w:placeholder` glossary block defines, instead of the default English prompt.
- 2ad80e6: Opening or editing documents with many text-wrapped pictures is faster. Fixes #1795.
- 88fa746: A text-anchored floating table that fits the rest of the page now stays on that page when the paragraph after it starts a new page with a page break before.
- 43c2012: Pages with footnotes now lay out the same after an edit as when the document opens fresh, and editing long documents with footnotes is faster. Fixes #1761.
- 8aec65b: Large documents with footnotes open faster, and edits that move many pages, such as accepting or rejecting every change, lay out fewer pages again.
- cb318b3: An inline content control that you empty now shows the same glossary placeholder text that it shows when the document opens.
- e4823be: Pictures and shapes in a header or footer now stack in their z-order, so a picture watermark covers a picture that ranks below it.
- 1aa7918: When the toolbar collapses an image's controls into the "⋯" panel, Wrap text, Alt text, Image properties, and Insert image now show as full-width rows that open their menu, popover, or dialog on a click. Before, each showed a plain-text label beside a small icon, and only the icon took a click.
- 1e1dc0b: Paragraphs that allow lines to break inside words keep Latin words whole only in Korean text, where both the paragraph mark and the text use the Korean language, and break them at any character elsewhere.
- 7df7abb: Korean paragraphs that wrap by word no longer break a word at its parentheses, commas, digits, or Latin letters.
- 1b9779a: Typing in long tables with vertically merged cells is faster. Part of #1797.
- 80423a6: Deeply nested tables open and edit faster: each nested table's column needs are measured once per layout pass instead of once for every enclosing level. Fixes #1798
- 9ddf7f6: A nested table with vertically merged cells now breaks across pages between its rows, also inside a merge whose text fits its first row, instead of moving whole to the next page.
- 68ad495: A tracked insertion and a deletion from the same author that touch show as one replacement in either order.
- 8e1dc7e: Characters that a serif Korean font lacks now draw in a serif Hangul font such as Batang, instead of a Gothic font.
- 57a3ae1: In suggesting mode, typing in a text box and choosing a dropdown, combo box, date, or checkbox content control value now record tracked changes, as does `ContentControl.setValue` with change tracking on, Next and Previous Change now reach changes inside text boxes, and you can comment on text in a text box. Moving or resizing a picture or text box applies directly because it has no tracked form, and a legacy form checkbox or dropdown refuses the change with a reason instead of ignoring the press.
- 74592f0: Text typed or pasted on one line at the end of an inline text content control now stays in the control, and forms protection accepts it there.
- 049f4a2: Saved documents give each tracked change its own id across the body, headers, footers, and notes, keep one id for the pieces of one change, and replace ids outside the 32-bit range. Fixes #1429.
- 80cf09a: Documents whose text wrap around pictures does not settle now open instead of failing to lay out. Part of #1803.
- Updated dependencies: @docx-editor.dev/i18n@2.35.0

## 2.34.0

### Minor Changes

- 3934f6a: Inline equations place n-ary limits to the right of the operator as a subscript and superscript, display equations follow `m:limLoc`, and an n-ary with an `m:limLoc` of `subSup` displays as math; `EquationExpression` n-ary structures carry it as `limitLocation`. Fixes #1543.
- 3934f6a: Equation scripts and bars take their size from the structure's control properties, or from the text around the equation, and a tall subscript drops until its top meets the subscript limit; `EquationExpression` structures carry the control size as `controlFontSizePt`. Fixes #1539.
- f182c70: Close the link panel when another participant strikes its selected words in suggesting mode, and add `hyperlinks.selectionIsPendingDeletion()` to tell whether a selection is a pending deletion. Fixes #1643.
- 4e4d44d: Remove a generated table of contents from its context menu or with the `removeToc` command. Fixes #1223.
- bb84b35: A handle at a table's top-left corner selects the whole table, and dragging it moves the table between the blocks around it; `selectTableRegion` supports `region: 'table'`. Suggesting mode no longer deletes a whole table untracked. Fixes #1567, fixes #1568
- 9c02206: Equations render border boxes, text boxes that fit their shape to their text take the text height, paragraphs that name a missing or character style take the default paragraph style, and page borders held only in tracked section properties draw. PDF export uses fonts installed on the system, and Segoe UI resolves to a metric-compatible packaged substitute.

### Patch Changes

- ae0ccce: Backspace at the start of an indented paragraph now removes the indent before it joins the paragraph to the previous one, and keeps the right indent. Fixes #1690.
- 8671251: Backspace at the start of a list item now removes its bullet or number and keeps the text in place, and a second Backspace joins it to the previous paragraph. In suggesting mode, list changes are now tracked as suggestions. Fixes #1594.
- 5abd50f: In a legacy compatibility mode that compresses punctuation, a document that balances single-byte and double-byte widths now shrinks inter-word spaces down to a quarter of the font size to keep one more word on a line. Fixes #1667.
- 2b3abe6: Text inside `w:bdo` and `w:dir` wrappers now displays in the direction that the wrapper declares, and the caret, clicks, and arrow keys follow that order. Fixes #714.
- 6a8141c: Page number, page count, and section page count fields in the document body now show the page they are on, instead of the result saved in the file.
- 93fbd9b: Data-bound content controls open showing the current value of their custom XML or document property node instead of the saved text. Fixes #1684.
- f5cdd00: Paragraph formatting, such as indents, spacing, alignment, styles, and lists, now applies inside data-bound block content controls, and the bound text stays unchanged. In suggesting mode, indents, spacing, alignment, and styles become a suggestion that can be accepted or rejected. Fixes #1661.
- 98f3186: Text no longer disappears from runs, paragraphs, and tables whose markup is out of order, repeated, or nested, and repeated run, paragraph, and table properties now combine instead of only the first applying. Text in `w:t` without `xml:space="preserve"` now drops its leading and trailing spaces.
- 398963c: Formatting or clearing formatting at a caret inside a word applies to the whole word as one undo step, and a format painter click on a word with a tracked replacement paints the whole visible word.
- 5186d17: Replacing a checkbox content control's glyph with its checked or unchecked glyph now changes the checkbox state inside the control, and other replacement text is refused instead of emptying the control. Fixes #1144.
- 752d5fb: A long word with no break opportunity keeps its final period on the line, hanging past the margin, instead of moving it alone to a new line. Fixes #1639.
- 9e7a1ac: Justified and distributed lines with East Asian text give every character the same gap, including gaps next to punctuation, and spaces and automatic gaps between scripts take only a bounded share of the slack. Fixes #1542.
- a343e05: Lines drawn in a Chinese, Japanese, or Korean face that is taller than one em now take 1.3 times the height of that face, so documents that use such faces paginate correctly. A character in a run with the East Asian font hint that the East Asian face cannot draw now keeps the Latin face.
- 74b3b0e: In a collaboration session, moving a block toward the start of its container, or formatting text whose properties are stored out of order, no longer removes a neighboring block or property for every participant. A table moved after concurrent moves of the same table keeps the empty paragraph between it and the next table. Fixes #1572. Fixes #1606.
- f5cdd00: The Decrease Indent button state updates quickly when a long selection, such as a select-all in a long document, has no indented paragraph. Fixes #1660.
- d460053: Formatting stored on the default character style no longer changes text, so text keeps the size and color of its paragraph style.
- 3e928db: Distributed paragraphs stretch their final line, including table cells and passages beside floating objects. Fixes #1361.
- 9622f77: Distributed paragraphs spread their lines across every character in legacy compatibility modes and when the styles part defines run defaults, keep the letters of kerned runs together in modern modes, and center a line that has nothing to stretch.
- 752d5fb: A distributed line keeps the next word only when its spaces would lose at most a third of the stretch the shorter line takes, and hangs a final comma or period beside spaces at their limit. Fixes #1637.
- a990507: A distributed line with a tab stretches the text after its last tab from a left stop to the line end, and centers when that tab reaches a right, center, or decimal stop. Fixes #1541.
- b3f007c: Punctuation compression, kana compression, and hanging punctuation now turn on for documents whose default East Asian font is Osaka, Nanum Gothic, Klee Medium, Klee One, or a font named in East Asian characters, and turn off for Hiragino, PingFang, and Heiti unless the font table marks them as East Asian. Picking Osaka in the font menu now also sets the East Asian font. Fixes #1725.
- a4a765d: Documents whose default East Asian font is Noto Sans CJK JP now compress punctuation and shrink justified spaces like other Japanese defaults, also when the face is not installed and the font table has no entry for it. Fixes #1663.
- 00044e7: East Asian line-end punctuation hangs only where the line-start rules forbid it, at every alignment in legacy compatibility modes and in distributed paragraphs, kana compress to fit a line-start-prohibited character, and pair kerning leaves full-width East Asian text unkerned. Fixes #1574, #1575, #1577, #1578, #1581.
- fca265a: In documents with an East Asian language, a justified line shrinks its spaces to keep a line-end comma or period inside the margin, and hangs the mark only when the spaces cannot make room for it. Fixes #1605.
- 9e7a1ac: East Asian text on justified lines no longer spreads between its characters, and automatic spacing between East Asian and Latin text no longer opens, when the document's run defaults name no East Asian font. Fixes #1556.
- 677252d: Formatting at the caret of an empty paragraph applies to its paragraph mark as a document change with its own undo step, so Bold and other toggles turn off a format the mark already has. Fixes #1626.
- 7760eb5: When two participants type at the same place, each caret now stays after its own text, and later typing no longer lands inside text that was already typed. Fixes #1710.
- 598631e: Use authored text fonts for equation digits, except in bold math styles, and the paragraph font for unstyled normal text. Fixes #1307.
- f7baed2: An equation overline or underline keeps a fixed gap from the glyphs that it covers, and its stroke follows the rule thickness of the math font.
- f7baed2: Equation runs whose font slots name different faces render as math with their face, size, and math style instead of a text fallback.
- f7baed2: Inline equation fractions center their rule on the math axis, place their numerator and denominator by the math font constants, and add no side padding, so a line with a fraction is no taller than it needs to be; fractions in display equations keep their padded placement.
- 4d616ff: An equation whose runs differ in size no longer makes its line too tall: the first run keeps its full height, and a later, larger run adds only the height of its glyphs. Fixes #1540.
- 6505457: Equations space relations, binary operators, punctuation, fractions, and n-ary operators by their operator class, and a sign at the start of an argument or after another operator stays unspaced; a hyphen draws as the minus sign and `*` as the asterisk operator, and the saved text does not change. Fixes #1533.
- f7baed2: Equation runs that name a language render as math at their own size instead of a text fallback, and save keeps the language.
- f7baed2: Equation scripts draw at 73 percent of the run size in whole half points, or 60 percent inside another script, and superscripts rise a fixed share of the size, or higher over a tall base.
- 7e0a75f: Equation lines with scripts and fractions now take the height of their glyphs, later scripts and fractions take their offsets from the size of the first run, and multiple line spacing adds its share of the text height below an equation instead of keeping the equation as a minimum. Fixes #1591.
- f7baed2: Equation subscripts sit a fifth of an em below the baseline and keep a gap below a superscript on the same base, so a line with a subscript no longer gains extra height.
- 6505457: Equations with spaced operators paint each source run as one text span, and PDF export writes one text object per face and baseline, so pages with many operators paint faster and export smaller. Fixes #1560.
- c3e33c6: A fixed-height table row that ends a page now keeps its authored height with the table's bottom border below it, and moves to the next page when that border does not fit. A fixed-height row that opens a later page of its table grows by the extra width of the top border there. Fixes #1534.
- 31562fa: A fixed-height last table row keeps its authored height, with its bottom border placed below it and cell text aligned to the authored bottom. If the row does not fit with its border, it moves to the next page unless it starts the page, and repeated header rows that leave no room for the border are omitted in compatibility mode 15 and later.
- a67a4ed: Runs with `w:fitText` now take the width the property states, so a fitted phrase no longer wraps onto an extra line. Fixes #1646.
- 1c501ef: Documents that turn off automatic paragraph spacing now keep each paragraph's own space before and space after, including list items and paragraphs at the edges of table cells, headers, footers, and notes. An empty paragraph with a hidden mark before a table no longer keeps a blank line because of automatic space before alone.
- 924ec26: Compress spaces within each text passage so justified lines beside floating objects can keep the next word. Fixes #1360.
- 55e7541: Text whose font is written as a list, such as `Verdana, Geneva, sans-serif`, now renders in the first font of the list, and text whose font name no font can carry, such as `"Open Sans", sans-serif`, renders in Cambria instead of disappearing from PDF export.
- 5ffe967: Page numbers in header and footer frames that do not wrap text now sit at their frame position beside the header or footer text, instead of taking a line of their own.
- ad7c146: In documents that use the current compatibility mode, a line whose line spacing would reach into the footnote area now moves to the next page. A heading kept with a paragraph now returns to the previous page with the paragraph's opening lines when its footnote reference comes later.
- 0b4ada3: Pages with long footnotes now settle on one layout, so an edited document ends on the same pages as the same document opened fresh. Fixes #1747.
- 918aa35: A footnote cited beside indented text now continues on the next page instead of moving its paragraph, and a paragraph kept with the next one now moves with it when the next paragraph's space after does not fit above the footnote area. Fixes #1748
- 2b13781: A manual page break inside a text frame no longer moves the frame and the text after it to a new page.
- 233aeaa: Text in Garamond keeps the font's own line height when the font is not available, so its line spacing and page breaks no longer depend on the fallback font. Fixes #563.
- a67a4ed: List items in headers and footers now share one count across the document, so a footer list continues the header list instead of starting again at one. Fixes #1631.
- 802b03b: Headers and footers keep the automatic space after their last paragraph, so body text starts below the header and ends above the footer at the correct position.
- 3f3fc9a: Japanese kana no longer shrink in every overflowing paragraph when kana compression is enabled. Fixes #1303.
- fca265a: A combining kana voiced or semi-voiced sound mark takes a full cell in faces that space it, joins its base in faces that class it as a mark, and stays on the line of its base. Fixes #1576.
- 752d5fb: Kana compression keeps a kana and its spaced sound mark on a full line, and PDF text gives a kana and a joined sound mark as the precomposed character. Fixes #1638.
- 021c787: A keep-with-next paragraph or kept row before a table row that cannot break across pages and is taller than a page now moves to the next page instead of staying beside earlier content, and authored header rows no longer hold such a row on their page. Fixes #1529.
- 259b9e8: Follow the run language for hanging punctuation and fill the line before a hanging mark. Fixes #1323
- 37ef590: Long documents without East Asian text lay out faster again, because line layout no longer checks every word for East Asian text spacing.
- 752d5fb: In older compatibility modes with punctuation compression and an East Asian default font, a line at any alignment shrinks its spaces down to half the average character width of their font to keep one more word, unless the document balances single-byte and double-byte widths. Fixes #1635.
- 445382d: The Insert link context menu row and toolbar button now open the mounted link panel, and the context menu row shows the Ctrl+K shortcut. If no link panel is mounted, both are disabled with a reason and Ctrl+K is left to the browser. Fixes #1592.
- 4051150: Keep a list item in place when you switch it between bullets and numbers, using the indents of the list it leaves instead of default indents. Fixes #1705.
- f48510f: A list item with its own indent now moves to the indent of its new level when Tab, Shift+Tab, Increase Indent, Decrease Indent, Enter on an empty item, or `listItem.level` changes its level, and keeps its right indent. Fixes #1720.
- a886a00: Number list items correctly when several lists share one numbering definition and one of them restarts, and start each new list, and each list given a starting number, on its own. Lists that share a definition with no start override now continue one count, so lists that earlier versions started this way can renumber. Fixes #1597.
- 6a13d2f: A list item on a deeper level now counts the parent levels it skips, so the next parent item continues from there, and list numbers past 9999 show in full. Fixes #1662.
- a67a4ed: `LISTNUM` fields in the document body now show their list number, computed from the document's list definitions, also when the field has no saved result. Fixes #1644.
- 70b5641: Moving, deleting, double-click selecting, and format painting by word stop at both edges of every inline content control, including Shift selection and headers and footers. Fixes #1300.
- 3d74192: Allow paragraph alignment inside content-locked controls, including tracked changes. Fixes #1311.
- 01e6845: Refuse paragraph formatting other than alignment in content-locked controls with code `locked`, and let every participant edit, review, and accept or reject changes suggested during a collaboration session in every story, including headers, footers, and notes created in the session.
- f182c70: Allow alignment, indents, spacing, line spacing, and line and page break settings on paragraphs inside content-locked controls, plainly or as suggestions that can be accepted or rejected there, while styles, lists, direction, and tab stops stay locked. Fixes #1622.
- bd947a7: Preserve each item indent when converting mixed style-numbered and directly numbered items to bullets.
- 7e0a75f: In compatibility mode 14 and earlier, a repeated table header stays above a row that continues from the previous page when its next line or nested table does not fit below the header, and the rest of the row stays on that page. Fixes #1602.
- 1135d96: In compatibility mode 14 and earlier, a repeated table header stays above a row that opens with a nested table whose first row does not fit below it, also when the row is taller than a page, and that row stays whole past the bottom margin. Fixes #1582.
- 845e680: In compatibility mode 14 and earlier, a repeated table header stays above a splittable row whose first line does not fit below it, and that row stays whole past the bottom margin. Fixes #1565.
- 7408aad: An n-ary equation operator without an operator character draws and copies as an integral, and copied text, Markdown, PDF text, and accessible labels include each drawn n-ary operator. The equation popover disables replacement of an equation that has no linear form and shows the reason. Fixes #1564.
- c6f8f0f: The number at the head of a footnote or endnote now follows its renumbering. When a note was cited before an existing one, or the note number format changed, the notes area kept the existing note's old number until the document was reopened, while its citation in the text showed the new one.
- dbe57b9: Footnote and endnote numbering comes from each section's own note properties, including its start value, instead of the document-wide settings, and applying note properties to the whole document updates every section and keeps the values you did not change. Fixes #1527.
- 396296f: Keep text typed after a note reference out of the reference style and superscript. Fixes #1127.
- 233aeaa: Pages after a section's overflowing endnotes show the even or odd header and footer of their new page number. Fixes #515.
- 85f3a0f: Text typed after a note reference takes the formatting of the text before the reference, and toolbar presses there and beside locked content controls toggle the formatting that typing applies.
- b2f826b: In compatibility mode 15 and later, the content after a table whose last page leaves out the repeated header rows starts on the next page. Fixes #1559.
- c556512: Draw each supported equation run at its authored font size. Mixed sizes also set the equation line height.
- f182c70: Report a Paragraph dialog submission whose settings are already in force as a success with no change, as `can` already did.
- a886a00: Keep the number text, number formatting, symbol bullets, and indents of pasted list levels. Fixes #1596.
- 93fbd9b: Fields in pasted word-processor HTML stay fields, so a pasted table of contents keeps its entry styles and can be updated or removed. Fixes #50.
- 78abf89: PDF export draws highlight, shading, strikethrough, every underline style, and tracked-change marks continuously across the gaps of justified and distributed lines, as the editor does.
- cbff3e2: In a percentage AutoFit table whose cells state percentage widths, the columns that give way to a widened column now give up equal parts, so their text no longer changes their widths. Fixes #1754.
- b2213a6: When people type at the same place at the same time, your caret no longer jumps back into text you already typed. Fixes #1710.
- b2f826b: The first body row below a repeated table header reserves the wider of its own top border and the header's bottom border in compatibility mode 14 and earlier, and the border it shares with the row above it in mode 15 and later. Fixes #1561.
- b2f826b: In documents that declare compatibility mode 14 or earlier, or no mode, repeated header rows stay on a continuation page above a row that cannot split and does not fit below them, and that row runs past the bottom margin. Fixes #1538.
- 627e74a: A right-click (or Control-click on macOS) in document text outside the selection now moves the caret to the click, so the context menu acts on the text under the pointer instead of a selection elsewhere in the document. A right-click inside a selection keeps it.
- 6cf19f1: Right-to-left text beside a floating object fills the passage to the right of the object first and aligns each part inside its own passage, and square wrapping on the largest side with equal sides keeps text on the left in compatibility mode 15 and later. Fixes #1528.
- 1135d96: In compatibility mode 15 and later, justified left-to-right paragraphs beside floating objects compress their spaces also when they contain right-to-left runs. Fixes #1573.
- e16cdca: In a right-to-left interface, the vertical scroll bar of the editor viewport is now on the left, and a page wider than the viewport opens at its right edge. Fixes #1493.
- 8bc3cad: A section that authors its own footnote or endnote properties without a number format now numbers its notes in the default format instead of inheriting the document-wide format from settings.xml. A document whose settings use `chicago` for a title-page note no longer shows every body note as a symbol. The final section's note properties are also read from the body-level `w:sectPr` in the notes layout and NOTEREF numbering, as the note properties state already did.
- f182c70: Find the right header, note, section, or link for content another participant created during a collaboration session, so table controls, page setup, comments, custom nodes, and the content control at the caret act on it. Fixes #1633.
- fa9d0cb: Header STYLEREF fields that name a paragraph style now show the matching paragraph text for each page instead of the saved result.
- 0e0c430: Tables with an absolute width in older compatibility modes, and right-to-left tables, now align their borders and text with the text column edge.
- aa6e145: The table move handle shows again for the table that holds the caret after you drag a table to another page.
- 44647ff: Percentage-width, nested, and text-box tables now place their borders and text at the expected positions, including right-to-left tables.
- 6f4505a: In compatibility mode 14 and earlier, a page that holds a whole table row taller than the page keeps the first line of the first footnote that the row references. Fixes #1554.
- 6f4505a: In documents that declare compatibility mode 14 or earlier, or no mode, a text-only table row that cannot split and is taller than a page stays whole on one page and runs past the bottom margin instead of splitting. Fixes #1532.
- fa80cde: Pictures no longer blink while you type in a text box on the same page.
- a9c00f2: Applying many tracked edits in one transaction is much faster on long documents, especially when the batch also inserts content controls or splits paragraphs.
- 7539b23: With change tracking on, `Paragraph.split()` proposes each new paragraph mark, and `Range.insertBreak()` proposes page and next-page section breaks, as tracked changes that reject removes. Fixes #1617.
- e0c6488: Rejecting all changes after a table is inserted as a suggestion now gives back the original paragraphs, and a table inserted at the end of a paragraph no longer adds an empty paragraph after it. Splitting a paragraph right after a field that edits as one unit now keeps the whole field in the first paragraph. Fixes #1609.
- bafbf5a: Typing in large documents with tables, footnotes, and tracked changes responds faster, and saving does less repeated validation.
- 45cd6f8: The font notice lists a missing symbol face when a symbol in the document has no Unicode equivalent and would show as a missing-glyph box. Fixes #753.
- 94d7d1c: Table grid columns that no cell reaches no longer take width, so a one-cell row in a wider grid is as wide as its cell.
- bd3ffb7: Keep the hanging indent, number position, and number format of lists pasted from Word.
- 443b2ad: A header or footer page number in a text-wrapping frame without a set width now sits beside the text instead of taking a line of its own.
- Updated dependencies: @docx-editor.dev/i18n@2.34.0

## 2.33.0

### Minor Changes

- 0c90746: Add an Arabic interface translation, mirror the editor interface for Arabic and Hebrew, and export `localeDirection()` for composed hosts. Right-to-left text keeps its order beside floating objects and symbols, typed Arabic and Hebrew letters start a right-to-left run, and right-to-left sections place the first column at the right.
- 86b3e88: Picture edits on a chart are now refused whether it is drawn, shows its saved fallback, or shows a placeholder, deleting a chart removes it with its fallback, and `drawing.chart` is present on every chart drawing when the chart part can be read, with a new `shownAs` field that says how the page shows it.
- f85416f: A chart placeholder now carries the chart's title and plot types in `drawing.chart`, so a custom unsupported-content component can name the chart.
- 0c90746: `useChromeDir` in both adapters and `chromeDirection` in `@docx-editor.dev/i18n` report the direction the editor interface renders in, and a review column that scrolls sideways in a right-to-left interface keeps the page in view as the content widens.
- 22aee05: Large fonts can load after the document first paints: `cjkFonts()` does so by default, `googleFonts({ cjk: true })` serves regional Noto Sans faces for Chinese, Japanese, and Korean families, and `deferFonts()` moves any font origin to the background. Documents that use font resolvers also open sooner, because the text shaper downloads alongside the fonts.
- e914152: Let custom `UnsupportedElement` components also cover drawings that render without some features, and report how completely each drawing renders. A custom component that renders nothing now keeps the built-in placeholder or drawing visible.
- 469350a: The font picker lists a standard font that no font source serves only when the computer has it installed, and `packagedFonts()` serves Helvetica with the Liberation Sans faces of Arial. `PackagedFontsFragment.supportedFamilies` is now typed as `readonly string[]`, because it can list aliases such as Helvetica.
- f85416f: A drawing group with more than one picture now renders every picture, in document order with its own crop, together with its shapes and text box text, on screen and in PDF export.
- 26b5382: Edit text boxes in headers and footers: double-clicking one opens its header or footer, where you can type, format, paste, move, resize, and delete the box as in the body, including during collaboration. Legacy VML text boxes now move and resize, inline text boxes resize, and typing in a header or footer repaints only the header and footer of each page.
- 1df327c: Honor the noColumnBalance compatibility option in documents saved in compatibility mode 14 or earlier, or with no declared mode, and keep continuous sections below all preceding columns.
- f85416f: Glow, inner shadow, reflection, soft edge and bevel rim effects, WordArt outside watermarks, and EMF and WMF pictures in PDF export now render through `drawingModule()` from `@docx-editor.dev/pro/drawing`, which `reviewModule()` also installs. Without the module, shapes paint without these effects, WordArt keeps its placeholder, and the editor still rasterizes EMF and WMF pictures.
- 2b4c7b8: Render authored diagonal cell borders in the editor and PDF export.
- 0c90746: `useReviewRailMetrics` reports the page side of the review column as `side`, `LocaleProvider dir="ltr"` keeps a left-to-right interface on a right-to-left host page, and the review column and navigation pane follow an inherited host page direction.
- 0c90746: `blankDocumentBytes({ direction: 'rtl', bidiLanguage })` starts a new document right to left, and the header and footer hover hints follow the interface language.
- 0c90746: In a right-to-left interface, the comments and changes column sits on the left of the page, with its markers, add-comment button, and rulers mirrored to match.
- 0c90746: Ruler numbers count from the margin where the paragraph starts, the right margin for right-to-left paragraphs, and a right-to-left interface shows the vertical ruler on the right.
- f85416f: Render SmartArt diagrams, drawing canvases, legacy shape groups, all preset shapes, custom curves, gradient and pattern fills, shadows, glows, dashed and compound outlines, and all line-end types read-only in the editor and in PDF export, with pictures and text boxes in their own shapes and EMF and WMF pictures as PDF vectors. The new `drawingModule` from `@docx-editor.dev/pro/drawing` renders charts (including radar, bubble, stock, and of-pie charts with trendlines and error bars) and lays out SmartArt saved without its drawing, and PDF export includes it.
- f85416f: Documents that set the option to move the paragraph mark after a page break onto the next page now keep that mark as a line at the top of the new page in older compatibility modes.
- 241085f: Accepting and rejecting tracked changes now resolves formatting with its paragraph mark, nested changes, table and list changes, moves, content controls, fields, equations, and comment text as one decision, and counts changes the same way in every list. A change that stays pending reports why through the `reviewChangesResolved` event, `reviewCodeOfSkip`, and the new `review.locked-content` and `review.bound-content` codes. Fixes #1458, fixes #1459, fixes #1460

### Patch Changes

- ba742d7: Avoid duplicate export warnings for legacy drawings selected from alternative content while retaining page locations.
- f85416f: A floating object anchored after a page break in its paragraph now appears on the page after the break.
- f85416f: An empty paragraph that holds only one floating object now moves its paragraph mark below that object when the object leaves no room beside it, as a paragraph with several floating objects already did.
- f85416f: ASK and SET fields no longer show their stored result in the document text.
- b9cbb36: Table AutoFit now counts adjacent East Asian punctuation pairs at their compressed width when it sizes a column to its widest line.
- f85416f: An AutoFit table column no longer widens for content that fits once a negative paragraph indent moves it into the cell margin.
- 2677e94: Autofit table columns no longer widen for spaces that open a cell, keep `w:noWrap` cells at their preferred width, and size first-line indents by the document's compatibility mode. A top-level autofit table whose absolute width is past the text column is laid out at that width.
- f85416f: An AutoFit table whose stated width already exceeds the text column now widens to keep a word that cannot break on one line, instead of splitting the word.
- f85416f: Text with an automatic colour on dark character or paragraph shading now renders white in the editor and in PDF export.
- 9b1cfbc: Speed up deleting many comment threads and replies in one batch.
- 3933348: Inline pictures in the main document text that are wider than the text area extend into the left and right page margins instead of being cut at the text edge.
- f85416f: A paragraph that holds only a page break stays at the end of the page when its line fits, so it no longer leaves a blank page.
- de9e468: Make repeated text measurements in the browser faster.
- f85416f: A wrapped picture in a table cell now stays inside its cell: a negative offset stops at the cell top, and the row grows to hold the whole picture.
- b9cbb36: Inline pictures in table cells that are wider than the cell text extend over the cell margins and are cut at the cell edge instead of the text edge.
- f85416f: Centered and right-aligned lines now ignore all of their trailing spaces when they align their text, at a line wrap and at the paragraph end.
- 86b3e88: Chart data labels show their own saved text, wrap at a fifth of the chart width, keep labels moved by hand where they were placed, and use the theme's complex-script and East Asian fonts; 3-D pie charts size their pie and labels to match the saved layout more closely.
- 86b3e88: A click now selects a chart as an object without handles in every state, so Delete removes it, a chart whose fallback picture does not load shows a chart placeholder that says the chart is not shown, and copy or cut of a selection that includes a chart is refused. The editor and PDF export no longer wait for a drawn chart's fallback picture, and Markdown export leaves out a chart whose fallback picture does not load in time instead of failing.
- 41059e7: Use legal CJK paragraph breaks for table autofit minimum widths. Preserve contextual unwrapped maximum widths, paragraph-wide dash cuts, and zero-width-space handling.
- cf213e9: Table AutoFit minimum widths use the compressed width of adjacent full-width punctuation that shares a line. Fixes #1468
- d09efc6: Add automatic spacing between East Asian text and Latin letters or digits.
- d19e13b: East Asian punctuation now compresses to fit a line only in justified paragraphs, so left-aligned, centered, and right-aligned paragraphs wrap instead.
- 981b790: Add automatic spacing between Latin text and the East Asian text after it for common fonts that a substitute font draws.
- 8b69cf0: Collaborators see the same document after concurrent decisions on tracked changes and concurrent typing near moved or repaired text, and an emoji that concurrent edits split no longer stops the document from saving.
- f85416f: Text now wraps around the authored contour of a tight or through floating drawing that is stored with a compatibility fallback, instead of around its whole box.
- f85416f: Triple and thin-thick paragraph and page borders now draw each stroke and gap at its authored width in the editor and in PDF export, instead of an even double line or a dashed line.
- f85416f: A paragraph below one whose space after contextual spacing removes now keeps only the part of its space before that exceeds that space after.
- 6a1464d: Keep the first line of a continued section inside its page content area.
- f85416f: A continuous section now wraps its text around text frames from the earlier section on the same page instead of starting below them, and an empty section mark that anchors those frames keeps its line.
- f85416f: Text that a tight or through wrapped object leaves no room beside now moves down one line at a time until it clears the object, never puts a character into a gap narrower than that character, and horizontal rules keep their line beside floating objects.
- f85416f: Justified Cyrillic text now compresses its spaces to keep a word on the line, as justified Latin text already did.
- f85416f: A tab on a line that ends short of the right edge now moves to the next line when its next default stop lies past that edge, instead of stacking at the edge.
- f85416f: Charts now draw logarithmic value axes, PDF export keeps the opacity of each gradient stop, and EMF and WMF pictures over the image size limit stay refused in PDF export instead of replaying.
- 175c654: Large documents with pictures, charts, and diagrams no longer block the page while they open: a picture that finishes loading during the open is shown when the open completes instead of laying the opened pages out again.
- f85416f: Charts now format elapsed times, fractions of a second, and pie and legend category labels, and place monthly and yearly date axes at even steps. Malformed TIFF, EMF, WMF, and WordArt content can no longer stall or exhaust memory, and a filled shape with a double outline paints its fill once. A drawing record's `placeholderGraphicKind` is now typed as `DrawingPlaceholderKind`.
- cdd42c3: Curly quotes in runs with the East Asian font hint now compress beside East Asian characters, so these lines no longer wrap early.
- b9cbb36: Documents whose defaults name no East Asian font no longer compress East Asian punctuation to fit a justified line or hang punctuation past the margin.
- f85416f: EMF pictures that map their own window and viewport now draw in place instead of shifted off their frame, and an EMF stored under a `.wmf` name draws by its contents.
- 86b3e88: Exports no longer fail with a resource timeout when a slow layout pass uses up the resource time limit while shapes or charts are still settling.
- f85416f: The document's first paragraph no longer takes automatic space before when a tall header pushes the body below the top margin.
- f85416f: A floating table positioned relative to the text that comes directly before an ordinary table now stays at that table's place on the same page, and the ordinary table moves below it.
- 2677e94: A floating table with no vertical anchor now measures its vertical offset from the top margin instead of from the text before it.
- 2677e94: Floating tables no longer cover the text around them near page and column bottoms, adjacent floating tables with the same position stack into one table, and an edit near a page-positioned table or picture lays out the same as opening the document.
- ba742d7: Prevent foreign XML properties from changing floating table placement and stacking.
- 0c90746: Times New Roman version 7 lines take their legacy line spacing, plain characters in symbol fonts draw the symbol, and European digits in Arabic right-to-left text use the run's Latin font and line height.
- 469350a: A Latin font picked for East Asian text no longer replaces its East Asian font, and the font picker shows the East Asian font of a selection that contains East Asian text. Background font loading keeps the configured default font and reports every failure.
- fbc0d7e: The font picker shows and changes the font that East Asian text is drawn in, instead of the Latin font of its run.
- f85416f: A text frame without a set width that holds one single-line paragraph now fits the width of that line, so text beside it wraps at the right place.
- f85416f: A text frame with a negative vertical offset from its paragraph now sits above that paragraph, no higher than the page top, instead of flowing as ordinary text.
- f85416f: Embedded object previews inside text frames now draw at the frame's position instead of disappearing and leaving an empty line in the text.
- f85416f: Line ends of lines inside a scaled drawing group keep their own size instead of growing with the group.
- f85416f: Outlines of shapes inside a drawing group keep their own line width when the group is scaled, instead of growing or shrinking with the group.
- f85416f: Pictures inside a drawing group that have a solid outline now render with that outline, instead of the whole group being left out.
- b9cbb36: A justified East Asian line can now hang its final punctuation mark past the margin and compress the punctuation before it in the same line.
- b9cbb36: Line-end punctuation now hangs past the margin only in justified paragraphs, so Latin punctuation in East Asian language runs stays inside left-aligned, centered, and right-aligned lines.
- b9cbb36: Inline pictures in headers and footers that are wider than the text area extend into the left and right page margins up to the paper edge instead of being cut at the text edge.
- f85416f: A text frame with a set position and width in a header or footer now sits at its offset from the next paragraph or table, without taking room in the header or footer.
- f85416f: A header text frame with the default wrap setting no longer pushes the page body down.
- 86b3e88: Header picture watermarks whose picture frame template omits its formulas now render behind the text in the editor and in PDF export. Fixes #1001
- ba742d7: Keep header and footer text boxes editable after document pagination changes.
- f85416f: A table row marked hidden whose cells show nothing now takes no space on the page.
- f85416f: A line that holds only a soft hyphen or a zero-width character now takes the paragraph mark's height, like an empty line.
- f85416f: In documents saved in older compatibility modes, an inline picture that starts a line now stays on that line beside a floating table or picture even when it is wider than the space there, instead of moving below it.
- 3933348: Reduce layout work on lines that contain no inline picture.
- f85416f: A justified line that ends at a line break or a tab now compresses its spaces to keep its last word, instead of moving the word to a new line.
- f85416f: A keep-with-next paragraph before a section's empty closing paragraph now stays on its page, so a new-page section no longer leaves a blank page before it.
- b9cbb36: Text that East Asian line-break rules keep together now breaks at its last fitting character when it is wider than a whole line, instead of running past the margin.
- f85416f: Text after a page or column break that opens its paragraph now takes the paragraph's first-line or hanging indent.
- ba742d7: Keep text clear of leading paragraph-relative pictures after page breaks.
- 7265b38: Fix text overlapping leading floating pictures when paragraphs have spacing before them.
- f85416f: A custom left tab stop past the right indent now places the text after it on the same line, as in table-of-contents entries, instead of moving that text to a new line.
- f85416f: In documents saved in older compatibility modes, a column break at the start of a paragraph no longer leaves an empty line at the bottom of the column it ends.
- f85416f: More legacy shapes paint: paths with omitted coordinates, flat coordinate extents, explicit solid fills, through wrapping, shapes placed against their paragraph by name, and groups that hold a picture beside their text.
- f85416f: List numbers no longer take the underline of their paragraph mark; only an underline set on the numbering level underlines the number.
- 89b1ef0: Fit East Asian punctuation on lines that also contain Latin words or digits, without changing the widths of those words.
- f85416f: Left-aligned tables whose vertical cell borders differ in width now center each border on its column line and measure the cell margin from it, and the widest top border in a table's first row moves the text of every cell in that row down.
- f85416f: Paragraphs with a negative left or right indent now extend past the column edge also on pages that hold a wrapping picture or shape.
- f85416f: A wrapping picture or text box that a negative offset lifts above its paragraph no longer starts above the top margin in documents saved in compatibility mode 15 or later, and a top-and-bottom box now moves the earlier lines it covers below it.
- f85416f: A `num` tab stop in a paragraph without a list number now acts as an ordinary left tab stop.
- b0c962c: Fix the menu bar, link popup, header and footer options, note options, content control inspector, and dropdown menus staying open when you press the document.
- fc28dba: Open documents with large, markup-dense parts faster by reading their XML in one pass. Fixes #1464
- c82ecbc: The page counter shows the full page count as soon as a large document finishes laying out, and after edits that move pages.
- f85416f: A floating table positioned on the page or margin directly before an ordinary table moves the earlier text on its page below it, while a floating table positioned against the text takes the ordinary table's place.
- f85416f: Text before a text frame positioned on the page or margin now wraps around that frame when both share a page.
- f85416f: A page- or margin-anchored floating table that spans the text column now moves earlier lines on its page that it would cover below it, along with any text-anchored table that follows it.
- f85416f: Paragraph borders with a shadow now draw the shadow bands on the right and bottom edges and take the extra height the shadow adds, and left and right paragraph rules sit at their measured distance from the text.
- f85416f: PDF export now draws TIFF pictures, including black and white fax-compressed scans, and embeds grey and colour PNG pictures without decoding them, which makes exports with many scanned pages faster and smaller.
- f85416f: PDF export draws the underline of an underlined tab, so form lines made of tabs appear.
- f85416f: A line holding an inline picture under multiple line spacing no longer moves below a floating picture of the next paragraph that only touches it.
- 86b3e88: Unsupported drawing placeholders take their label from one translation key per kind, `image.placeholder.<kind>`, which replaces `image.nonPictureGraphic`; move an override of the old key to the new keys.
- b9cbb36: Justified East Asian lines now compress punctuation on every blank side, including both sides of adjacent marks, and can fit up to nearly one more full-width character.
- f85416f: Text after a column break in a narrower column no longer moves to the next page early.
- aaf6c34: Remote carets no longer slow the editor in long collaborative documents, and a collaborator's caret no longer lands on the later of two paragraphs that came to share an id. Fixes #1498
- 0c90746: The review column moves with the page in the same frame when the pane opens or closes, and the add-comment button keeps clear of cards and markers, responds to a press, and keeps no hover color after a tap.
- f85416f: Shape outlines without a join now draw round corners, and a miter join without a limit uses a limit of eight line widths, in the editor and in PDF export. Fixes #1321
- 0c90746: In a right-to-left interface, document text in the navigation pane, review cards, and link popup keeps its own reading order, and review dates follow the interface language.
- 0c90746: A justified right-to-left line with nothing to stretch, such as one word before a manual line break, stays at the right edge.
- 0c90746: Match reference layout for synthesized bold widths, table rows under a larger end-of-cell mark, list numbers that hang into the margin or sit in narrow right-to-left cells, numbering across vertically merged cells, lines under reduced line spacing, and justified right-to-left lines. PDF export now draws the numbers of empty list paragraphs, Webdings and Wingdings 2 symbols, and compound borders as parallel lines.
- 0c90746: In a right-to-left interface, submenus open to the left and take the left arrow key, the header, footer, and note bars mirror, and link address fields read left to right.
- 0c90746: In a right-to-left interface, the navigation pane moves the page away from its own side instead of under itself, a review column that scrolls sideways opens with the page in view, and the Vue review rail detects its compact mode correctly.
- c72b146: Document search no longer keeps a list of story paragraphs for every revision that the undo history holds.
- e01c2d9: `findMatches` builds each paragraph's searchable text once per paragraph node instead of once per query, so a paragraph an edit did not touch keeps its text across revisions. A host asking many queries of one document paid a walk of every story and a rebuild of every paragraph's text for each one: about 33 ms a query on a 120-page document with footnotes, now under 1 ms. The answers are the same.
- 2677e94: An empty paragraph that ends a section no longer pushes footnotes off its page, and before a section that starts on a new page it no longer draws borders or shading or adds a blank page.
- f85416f: Synthesized small capitals now take 0.8 of the run size rounded to a whole half-point, so lines with small caps wrap where the source document wraps them.
- f85416f: Spaces in synthesized small caps now take the small capital size, so small caps lines keep their source width.
- 0c90746: Kerned text applies the font's kerning pair between a space and the next letter, so kerned headings break their lines where the source document does.
- f85416f: Table rows now keep their correct heights when a vertically merged cell starts inside another merged cell and ends below it, and merged cells whose last row has an exact height are clipped at that row instead of growing an earlier row.
- 57819e9: Indent, outdent, Tab, Enter on an empty item, and the Bullets and Numbering toggles now work on a list item numbered through its paragraph style, such as List Bullet. Fixes #1461, fixes #1462
- f85416f: Text after a centered, right, or decimal tab now aligns together with the inline pictures in the same segment.
- f85416f: An ordinary table whose top falls inside a page-positioned floating table that spans the column now starts below that floating table instead of under it.
- ee62d4a: Tab and Shift+Tab in a table cell move to the next or previous cell and select its content, Tab in the last cell adds a row, and Option+Tab or Ctrl+Tab types a tab character in a cell.
- f85416f: Percentage cell widths in a table that states no width of its own now share the text column, instead of being ignored in favor of equal columns.
- f85416f: A horizontal border between two table rows now reserves the width of the rule it paints, also when one side of the boundary sets its border to none or authors a narrower rule.
- f85416f: Every cell in a table row now starts its text below the row's largest top cell margin, so a cell with a smaller top margin no longer sits higher than its neighbors.
- ba742d7: Prevent foreign XML properties from changing table widths, cell margins, and row geometry.
- 2677e94: Text-anchored floating tables break across pages, and split table rows keep their minimum height on the next page. Fixes #1489
- 2a72389: A drawing wrapped top and bottom and offset from its paragraph keeps its band where the drawing is painted when its anchor sits on a later line of the paragraph, so the paragraph's own lines that the band crosses move below it instead of running under the drawing.
- 6691767: Lines before the anchor of a drawing wrapped top and bottom and positioned from its paragraph now move below the drawing when its band crosses them.
- f85416f: An underline element without a style value no longer underlines text; it only recolours an inherited underline.
- ba742d7: Show a replaceable placeholder when visible alternative drawing content cannot render, while preserving its source and layout.
- ba742d7: Keep documents usable when unsupported header or footer drawings block the entire body area.
- f85416f: A text box whose text does not wrap grows only to the column width, and a longer line wraps there.
- f85416f: Paragraphs in a vertically merged continuation cell no longer take a list number.
- f85416f: Legacy shapes filled with a picture now draw that picture, and legacy shape groups that hold a picture keep their other shapes in front of or behind it.
- 24fdb13: Render legacy text boxes on ovals, rounded rectangles, and preset shapes, with turned boxes, vertical text, dashed outlines, shadows, and boxes that fit their text, in the editor and in PDF export.
- f85416f: Left-aligned tables whose outer vertical border is wider than their inside borders now center every vertical border on its column line, so cell text no longer starts too far left.
- f85416f: PDF export and the editor now draw the text of WMF pictures in the character set and face their fonts name, so Arabic, Hebrew, Cyrillic, and East Asian labels no longer turn into Latin letters.
- f85416f: With 1.5 or double line spacing, a floating picture now moves a line only when it overlaps the line's text or picture, not the extra space the line spacing adds below it.
- Updated dependencies: @docx-editor.dev/i18n@2.33.0

## 2.32.0

### Minor Changes

- b16195d: Packages ship task recipes in `docs/`, `DocxEditorReview.Draft` takes the host's position and can render inside custom cards, and review writes such as accept, reject, and comment no longer scroll the page. Editing API tracked changes save their dates to the second like editor edits, and refusals and toolbar reasons name the API to use instead.
- bad7784: Add compound UnsupportedElement renderers in React and Vue for generic unsupported OOXML content and existing drawing/equation fallbacks. Match source metadata, reserve layout dimensions, and preserve custom component state across repaints without changing saved content.
- b27446d: The editing API adds `Range.getTextRanges`, `Paragraph.getTextRanges`, `Range.expandTo`, and `Range.getRange`, so an agent can split a paragraph into word ranges and replace, delete, or insert after a run of words. `Range.getReviewedText` and `Paragraph.getReviewedText` read text as if every pending tracked change were accepted or rejected, and `Range.contentControls` and `Paragraph.contentControls` list the content controls a range or paragraph overlaps.
- e63b697: Add `setFonts()` to replace host fonts without resetting document edits, selection, or undo history.
- 9770e78: Merge and split table cells from the context menu, the table toolbar, and the automation object model through `Table.mergeCells` and `TableCell.split`. Column insertion, deletion, and resizing work on tables with merged cells.
- fb28d79: The `insertInlineContentControl` operation accepts a `revision` to propose the control as a tracked insertion, and `insertCustomNode` proposes the node as a tracked insertion in suggesting mode.
- 59e913c: Readers can select and copy text in viewing mode, and `snapshot().selection`, the `selectedText` query, and `getSelectionPlacement()` report that selection. Edits stay refused. Fixes #1455

### Patch Changes

- 017aaab: Fix missing embedded pictures in cached complex field results, including nested results.
- c85001c: Fix table pagination around wrapping pictures, oversized rows, captions, repeated headers, and empty header frames.
- 6df9b17: Preserve authored paragraph spacing at later column starts in continued regions.
- b192207: An inline `contentLocked` control can now be removed as a whole: by deleting its paragraph or table, by a selection across paragraphs, by typing over it, or by rejecting the insertion that holds it. In suggesting mode and through tracked editing, deleting the whole control proposes its removal. Joining two paragraphs next to a locked inline control is no longer refused. Fixes #1425, fixes #1427
- e658e4b: Fix extra or missing blank pages around continuous section restarts and restarted odd-page or even-page breaks.
- 0b9a319: Text typed right before or after a locked inline control, such as a custom node, now takes the formatting of the text beside the control instead of the control's own, and the toolbar shows that formatting at the caret.
- a91ff98: Copied pictures with an extension-style content type, such as `image/.png`, now carry the standard image type, so earlier editor versions also paste them.
- 1b19b22: Fix documents that stay gray and reject clicks after an external file refresh.
- 8759fed: Preserve empty-paragraph line height and wrapping below full-width floating tables.
- 7fda473: Restore paragraph spacing in continued columns and empty-paragraph placement below full-width floating tables.
- 8f541b3: Pictures whose content type carries the file extension, such as `image/.jpg`, now survive copy and paste, and documents that also declare a conflicting standard type still open.
- 017aaab: Fix extra pages after continuous sections with multiple columns. Keep paragraphs below preceding content when they move between columns.
- 9d171a6: Correct table border spacing, floating-table wrapping, rotated inline picture dimensions, and header drawing positions and text clearance.
- 90d101e: Text formatting over a selection that includes a content-locked control is now reported as unavailable by `can()` and the toolbar, and `exec` returns `ok: false` instead of reporting success with no change. Fixes #1426
- 3464f5e: Long documents take input as soon as their first pages show while the rest lays out in the background, and typing, new paragraphs, and accepting or rejecting all tracked changes are faster in long documents. A cross-reference whose target appears later in the document now updates after edits made right after opening.
- 7701301: Start continuous sections below all in-flow columns on the final page of a preceding multi-page section.
- 90370ef: Honor authored footer PAGE frame positions and keep supported exact-height floating frames out of normal footer flow.
- e14f744: A custom node inserted into a paragraph that held no control now appears in the review list at once. Fixes #1428
- c85001c: Fix blank pages and header selection after section numbering restarts, and missing borders beside omitted table cells.
- 73169ac: A tracked deletion or replacement that covers an equation now proposes removing the whole equation. Before, it struck the text around the equation and left the equation in place. Fixes #1424
- 500a5f0: `@docx-editor.dev/core/editor` exports `observeUnsupportedElements` and the unsupported-element types, which the React and Vue adapters now import from there.
- b6625f4: Lines now break after zero-width spaces and after a dash that starts a run, and Khmer and Myanmar stacked consonants and Myanmar spacing vowels stay together on one line.
- Updated dependencies: @docx-editor.dev/i18n@2.32.0

## 2.31.0

### Minor Changes

- f19be09: Add bookmarks: show, insert, delete, and go to bookmarks in the editor and the automation API.
- 61aa80e: Support picture insertion in collaborative automation runtimes and expose specific refusal reasons for scripted edits and review actions. Fixes #1348
- ffbe8cf: The Add comment control is disabled until something can open a comment draft, and the `useCommentDraftRequest` hook lets your own comment UI serve it.
- bc6b51a: Render text and picture watermarks in the editor and PDF export, and add a Watermark dialog.
- 2741998: Support pop-out windows and iframes while preserving edits, selection, undo history, and collaboration when the editor moves. Fixes #1312
- 02b31d7: Long documents with justified text, footnotes, tables, and SimSun text now break lines and pages more accurately. PDF export now completes long documents and uses installed Garamond and large CJK fonts.
- 173b73c: Show the applied paragraph spacing in the line-spacing menu. Expose the active language through `useTranslation().lang`.
- e42431e: Explain document opening failures in a customizable React and Vue dialog with stable error codes.
- bc6b51a: Show picture insertion failures in a customizable editor dialog.
- f94c8a5: The `replaceMatch` command now replaces a found match without moving the selection or the page, and records a tracked replacement in suggesting mode. Activating a review item with `reveal: false` no longer scrolls the page.
- 1bf0015: Group tracked replacements into one review item and navigation stop by default. Set `pairReplacements: false` to list each change separately.
- 72f2cc3: Group review decisions into one undo step. Keep note and comment removal with its related text edit during undo.
- 784b7d7: Preserve authored vector line caps and round or bevel joins in SVG and PDF output.

### Patch Changes

- 23b9fcf: Comments and replies created through the editing API now record when they were written, so `creationDate` reads a date and saved files keep it.
- a15181f: Preserve bookmark copies outside replaced text, and remove old copies when you move a bookmark across document stories.
- a15181f: Preserve protected bookmarks when a move or deletion targets locked or bound content controls.
- 722e648: Export the `TextMatch` type from `@docx-editor.dev/core/editor`, next to the other editor search and highlight types.
- 504a0e2: Allow equation editing with shared default control properties and preserve size, language, and complex-script italic during layout. Fixes #1335
- 504a0e2: Allow equation editing with shared default run formatting and apply run sizes during layout. Fixes #1340
- adee88a: Show merged cell text through every fixed-height row it covers and clip it at the bottom of the last row. Fixes #1305
- 8f68066: Report font shaping byte-limit refusals through the host font-error callback while retaining fallback measurement.
- 3c6a0d3: Inline pictures can change their text wrapping, and a floating wrap keeps the picture in place on the page.
- aaebb18: Open long documents faster and keep editing, review decisions, comments, and scrolling responsive in documents with thousands of pages, tracked changes, and footnotes. Pages with footnotes now paginate the same after edits as when the saved document is opened again.
- a15181f: Fix early line breaks before Latin punctuation in paragraphs with an East Asian run language.
- b5f9eff: Refuse control removal in suggesting mode. Support Ctrl+Backspace and selection deletion for selected content-locked controls.
- 29accef: Select adjacent content-locked controls before deletion, and refuse removal when the control itself is locked. Fixes #1299
- 68ee15c: Render equation structures with control properties and preserve those properties on save. Fixes #1306
- aaebb18: A font that is not available now falls back to a face of the same kind (serif, sans-serif, or monospace), and the editor draws that text with the same face it measures, including with a fixed font configuration such as `defaultFonts`.
- d92a3ac: Align text separately on each side of floating pictures and honor largest-side wrapping. Fixes #1351
- 05e53d3: Keep full-width punctuation pairs compressed when a full-width colon moves a line break.
- 17a2495: Compress full-width punctuation pairs only within one line and restrict hanging punctuation to justified paragraphs. Fixes #1302
- 7cd3776: Save long documents in short tasks and reuse unchanged paragraphs and table rows.
- Updated dependencies: @docx-editor.dev/i18n@2.31.0

## 2.30.0

### Minor Changes

- 8488733: Set `contentLockPolicy.allowFormattingInLockedContent` in `createDocxEditor`, `createServerAutomationHost`, or the React and Vue `contentLockPolicy` prop to let users format content-locked controls while their text stays protected.
- f09b44b: Add the `fontShaping` option, which sets the largest font file that text shaping accepts, separately from font loading limits.
- 4d55c5b: Set `lockedControlNavigation: 'atomic'` in `createDocxEditor`, or the React and Vue `lockedControlNavigation` prop, to make arrow keys, Shift selection, and clicks treat a content-locked inline control as one unit.
- 0c1b370: Apply both runs’ kerning thresholds and require an East Asian font as the default East Asian face for full-width punctuation compression, while honoring `w:noPunctuationKerning` and preserving Latin font kerning. Keep kana advances on non-full lines and preserve authored text, formatting, and collaboration operations.
- 306337a: Preserve supported equation run formatting and bars while refusing compact replacements that would discard source properties.

### Patch Changes

- bf0eb44: Keep cells inside their row bounds when merged text extends a table with cell spacing.
- 78a6f6a: Keep the visible part of a text line in a fixed-height table row without changing its authored height.
- 7d53f73: Paint the selected TrueType collection face while preserving its tables, including face signature tables.
- b25afe8: Stop stale font error delivery after a listener replaces the document or destroys the editor.
- b25afe8: Discard deferred font errors after document replacement or editor destruction.
- 38ce956: Release offscreen image elements and URLs, then recreate them when you return to the page.
- d5b1fdc: Render Office Math letters with their mathematical style while preserving source text and normal-text runs.
- 926bcdc: Refuse conflicting content control deletion and insertion before changing the document.
- 926bcdc: `insertContentControl` with `returnHandle`, and Office.js `range.insertContentControl()`, return a handle to their own control when one batch creates several controls.
- 49fe893: Hash complete blocks directly from the caller's byte view and allocate only the 64- or 128-byte padding tail. Preserve digest encoding, native hashing, and caller bytes while avoiding a payload-sized copy in the pure SHA-256 path.
- 7d53f73: Keep complete font collections for first-face painting and preserve selected signature tables for other faces.
- 306337a: Keep equations with unknown run properties or structure children in the bounded fallback.
- b0abf51: Editors report session starts and ends, active editing time, committed edits by origin, and each `save()` call, and telemetry records them as events and metrics for session counts, edit failure rates, and save success rates.
- f6b64cc: Use the authored hAnsi face for curly quotes without an East Asian font hint, while preserving complex-script overrides.
- 4c9da7e: Use the authored hAnsi face for en and em dashes, ellipses, low quotes, and middle dots beside Han text without an East Asian font hint. Fixes #1301
- bf0eb44: Keep text and cached fields visible when protected vertically merged body cells continue across pages. Measure the carried cursor again after each page cut and grow the last non-exact row for the remaining text.
- Updated dependencies: @docx-editor.dev/i18n@2.30.0

## 2.29.0

### Minor Changes

- e3f8337: Failed opens, refused edits, and skipped tracked changes now carry anonymous failure detail: the engine reason, the role of the part, the class of an unexpected exception, and the kind of tracked change. An open or a command that throws is now reported too.
- e3f8337: Report undo history and custom node payload diagnostics in the anonymous diagnostics stream, add the bucketed document shape to opened documents, and stop including font family and part names in font error messages.
- e3f8337: Report anonymous diagnostics with stable codes and fixed hints when a document fails to open, an edit or tracked change is refused, or a font fails, through `editor.on('diagnostic')` and a module `onDiagnostic` listener. Open failure messages no longer include names from inside the file.
- e3f8337: Editors report an anonymous `performance` diagnostic once per minute of use, with the time from a key press or click to the next frame and the engine layout and paint times, and the telemetry package records it in a new `performance` area.
- b6fdbf5: With paragraph marks shown, page breaks, column breaks, and section breaks show a labeled dotted line that names the break type.

### Patch Changes

- e3f8337: A collaboration status diagnostic reports a connect time only when the editor saw the room join, so a room that was ready before the editor attached no longer reports a connect time near zero.
- 75a3ce3: Text after a column break at the start of a paragraph now gets the paragraph's space before in the next column or page.
- f90ab3a: Copying a selected computed field now copies its whole result as plain text. Fixes #1245
- 838394b: Fix copied header and footer field results that repeat across pages.
- 7146830: The first paragraph of a document no longer starts below the top margin when it uses automatic space before.
- f397ea3: A table row with an exact height taller than the page now fills a page instead of failing the whole layout. Fixes #1220
- 3741111: Table rows no longer grow by an extra line when a cell hides its end mark and ends with an empty paragraph.
- 6dd82b5: Justified lines keep a word that contains a no-break space on the line when its spaces can shrink to fit.
- 6dd82b5: Justified lines that contain a tab keep their last word on the line when the spaces after the tab can shrink to fit.
- 4270ac9: Exact line spacing keeps the font baseline under `w:noExtraLineSpacing` in every compatibility mode, including mode 15. Fixes #1205
- 15bcf38: Lay out documents whose nested table rows, cell pictures, balanced column sections, or chains of wrapped floating objects do not fit on one page, instead of rejecting them. Separate table rows by their cell spacing, and drop hidden empty paragraphs before tables.
- 2f60b53: A page break directly followed by a line break no longer starts a new page, and a paragraph that opens with a column break keeps that break on a full page or column. Fixes #1219. Fixes #1222
- e3f8337: Inserting a picture while a picture is selected is refused with a clear reason, the toolbar button explains it, and refused picture inserts and replacements now reach diagnostics.
- 388c278: Table rows keep a minimum height when you drag their border, so a resized row can always be dragged back. Fixes #1270
- a16db3a: Selecting text next to a tracked change or comment no longer highlights that change as active.
- a768653: Formatting a selection that includes a generated table of contents now formats the rest of the selection instead of refusing the whole change.
- c78d733: Underlines, including tracked insertion underlines, now draw as one unbroken line across spaces and descenders.
- Updated dependencies: @docx-editor.dev/i18n@2.29.0

## 2.28.0

### Minor Changes

- 9535470: Home, End, Up, Down, and clicks at a wrapped line edge put the caret on the correct line, and typed text lands where the caret shows. `moveCaret` accepts and returns an optional `lineId` for the line the caret shows on.
- 9535470: Add `compactCollaborationState` and `checkCollaborationRoomGeneration`, so a Hocuspocus server keeps each room's size bounded by compacting it into a new generation when it loads the room. A replica that still holds the previous generation reports `room-generation-changed` and rejoins.
- 9535470: Add `loadingIndicator` to the packaged React editor and a `loadingIndicator` slot to the Vue editor, so you can replace the loading spinner, including on the first page while a large document opens.
- 9535470: Add a `fieldResults: 'editable'` option to `createDocxEditor` and the React and Vue editors, so readers can type, delete, and select inside the saved results of DATE, MERGEFIELD, HYPERLINK, and similar fields. Fixes #1197
- 9535470: Layout accepts a `fieldResults: 'editable'` option that lays out the saved results of DATE, MERGEFIELD, HYPERLINK, and similar fields as text, so the caret, hit testing, and selection work inside a result. The default `atomic` mode is unchanged.
- 9535470: The store can address the saved results of DATE, MERGEFIELD, HYPERLINK, and similar fields as editable text through a new `fieldResults: 'editable'` option on transactions, edit options, and `paragraphTextOf`. The default `atomic` mode keeps every field one unit, so existing offsets do not change.
- 9535470: Improve the layout of pictures, text boxes, drawing groups, and header and footer floating tables, honor clearing line breaks, and show embedded object and fallback previews that did not paint before.
- 9535470: A click at a line edge keeps the caret on the clicked line, in multi-line field results, wrapped text, right-to-left lines, and beside inline pictures. `caretAt` accepts an optional `preferredLineId` that selects which painted line shows a shared position.
- 9535470: The navigation pane now works inside `DocxEditor.Viewport`, covers the page on narrow screens, and captures the browser's find shortcut (Ctrl+F, or Cmd+F on macOS) while focus is in the editor; set `findShortcut` to `false` on the pane, or in the `navigation` prop, to leave the shortcut to the browser.
- 9535470: Change the author, and optionally the date, of pending tracked changes without accepting or rejecting them, with `useReview().adopt()`, the `setReviewChangesAuthor` editor command, or `RevisionCollection.setAuthor()`. Fixes #1145
- 9535470: Add tracked change balloons, comment marker styles, and horizontal review pane scrolling. Comment markers use icons by default; set `commentMarkers: 'initials'` to show author initials and reply counts.
- 9535470: Add the `reviewItemReveal` editor event, which fires when Next Change or Previous Change lands on a review item, or when `setActiveReviewItem` succeeds with `announce: true`, so a host can open its own balloon or card.
- 9535470: Add review pane settings, `getReviewItemsAt`, `getReviewItemRects`, `getActivatedReviewItemKey`, replacement pairing, and `scrollToBlock` scroll options for hosts that draw their own review interface. Fix the compact review card template, reply author colors, and `useReviewAuthor` outside the review rail.
- 9535470: With `revisionsIn: 'balloons'`, comments that reply to tracked changes no longer open an empty review pane, and the new `reviewPaneListsItem` export tells a custom review pane which items to list. PDF export marks text in tracked table rows inside text boxes.
- 9535470: Toolbar and menu popups close when focus moves elsewhere, such as to the find field, and the navigation pane stays docked beside a scrolling review column. `Toolbar.Button`, `Menu.Item`, and `ContextMenu.Slot` take `slotId`; `slot` is deprecated and still works with a development warning, and on `MenuItemProps` and `MenuSubmenuProps` both `slot` and `labelKey` are optional, because `slotId` and `label` can take their place.
- 9535470: Pressing Tab or Shift+Tab over selected paragraphs, or over a selection from a paragraph start, changes their indent and keeps the text, where Tab replaced the text with a tab before. Fixes #1172
- 9535470: PDF export marks text in tracked table rows, new table rows keep the source row's paragraph formatting, and tracked edits can start right after your own pending insertion. A range whose text changed since it was read now fails with `StaleDocument` instead of editing the wrong text.

### Patch Changes

- 9535470: Stop editing a long document from growing memory with every edit, most of all inside long tables, lists, and documents with headers or footers.
- 9535470: Keep your caret, and the carets of other participants, next to the same character when one remote update changes text on both sides of it.
- 9535470: Keep caret positions and selections before and after computed fields in field-only paragraphs.
- 9535470: A list level with empty number text keeps its suffix, so the first line and the caret in an empty item start at the tab stop, after the space, or at the number position.
- 63dde82: Keep saved fields with empty text elements selectable and removable in editable field-result mode.
- 9535470: Use less memory to open long documents, and release a closed document's memory, including after a PDF export whose result you keep.
- 9535470: Typing, pressing Enter, and turning paragraphs into lists respond faster in long documents.
- 9535470: Allow selecting listed font names that contain commas or semicolons, keep script default fonts in large documents, and ignore font-table alternate names longer than 31 characters.
- 9535470: The font substitution notice lists only fonts that the document's text renders in, so East Asian fonts named for Latin-only text and fonts overridden by a nearer style no longer appear.
- 9535470: Text uses the correct font for full-width characters, East Asian font hints, the no-break space, and font slots that no style names, and PDF export and the font substitution notice use the same fonts.
- 9535470: Keep a line on its page in a section with a document line grid when its text fits above the bottom margin and only the space below the text crosses it.
- 9535470: Lay out multiple and at-least line spacing in sections with a document line grid in whole grid lines, with the text centered.
- 9535470: Use the declared hAnsi font for eligible non-ASCII text when it differs from the ascii font.
- 9535470: Keep line-fitting spacing adjustments out of Format Painter writes.
- 9535470: Tables in older compatibility modes align their content with the text column for every alignment, indent, and layout, AutoFit tables without a width fit the room their indent leaves, and a compatibility mode declared outside the compat element applies.
- 9535470: Disable the menu bar while a large document opens, and show the loading indicator higher on the page.
- 9535470: Snap footnote and endnote lines to the document line grid of the section that holds them.
- 9535470: A paragraph border box now starts at the first line of a hanging indent, and adjacent bordered paragraphs share one box when their box edges match.
- 9535470: A paragraph that holds more than one `w:pPr` element now loads with its first one, shows, and saves, instead of disappearing from the editor.
- 9535470: Editor popups close when focus moves into a host's own modal dialog, and the Vue table toolbar keeps its menus in server-rendered apps after the selection leaves a table and returns.
- 9535470: Split mixed East Asian cached field text into font-specific display spans while preserving each field's atomic model range.

  Keep note navigation and measurement reservations unchanged. This changes font selection for displayed field results, without changing canonical data.

- 9535470: A selection that the host sets now stays where the host put it, also when a participant's earlier change is still showing.
- 9535470: A paragraph that opens with a page break followed by another page or column break no longer adds an extra blank page after a full page.
- 9535470: Tables draw the borders that a row's own table property exceptions set, so a row that clears its borders draws no rules.
- 9535470: Read run language only from WordprocessingML namespace elements and attributes. Keep foreign extensions in saved documents.
- 9535470: Read run and paragraph properties only from WordprocessingML namespace elements and attributes, and keep foreign extensions unchanged when you edit formatting.
- 9535470: Give a line with large superscript, subscript, or note reference text the full height of that text above and below the baseline on every line, which also corrects these lines on a document grid, and stop scaling raised text offsets with multiple line spacing. Fixes #1198
- 9535470: Open large documents faster without freezing the page as long, and reduce memory use and typing delays in large documents, including line breaks, numbered paragraph breaks before tables, table edits, undo, and redo.

  Fix row resizing in large documents, support column resizing below horizontal merged headers, keep empty cell carets inside their cells, and correct borders and excess wrapping in tables with partial borders.

- 9535470: Keep the page responsive while a large document opens by reading and laying it out in small steps, and show its first pages under the loading indicator until it is ready.
- 9535470: Keep symbol-font bullets and checkboxes visible when the symbol font is unavailable, and lay out their lines and glyph widths with the symbol font's own metrics.
- 9535470: Tables with a percentage width above 100% extend past the text column instead of shrinking to it, so their cells keep their line breaks.
- 9535470: AutoFit tables share width between columns by each column's spare room above its content. Tables with zero cell margins, in text boxes, nested without a width, or right to left take their correct width and position.
- 9535470: Preserve whole document font names and resolve unavailable faces through whole font-table alternate names.

  Use the same admitted substitute for editor measurement, painting, font notices, and font-backed export.

- 9535470: Render horizontal and vertical VML shape paths with one zero extent.
- Updated dependencies: @docx-editor.dev/i18n@2.28.0

## 2.27.0

### Minor Changes

- f4b7b73: Automation text reads report manual line breaks as `\v` and column breaks as U+000E instead of `\n`. Update text processing for these characters; paragraph separators remain `\r`.
- a2bd25c: Add local tracked-change styling with optional text backgrounds through shared API settings and an accessible review dialog in React and Vue. Fixes #1113

### Patch Changes

- 2137ed4: Automation can insert manual line breaks with `insertBreak` and `Line`, or with `\v` in inserted text, including with change tracking. Fixes #1124
- 2246044: Split typing undo groups after pauses and during continuous input to keep each undo step small.
- 2246044: Give caret formatting its own undo and redo step in standalone and collaborative editors.
- 4f19f31: Fix content after a floating table being pushed below the table: text in a following continuous section and text around no-overlap tables now flows beside floating tables. Fixes #1109
- f64b50a: Header and footer drawings set in front of text no longer cover body text or body drawings in the editor and in PDF export. Fixes #1126
- cd10695: Documents, scrolling, and zoom behave the same when the host page uses right-to-left direction. Fixes #1115
- 2a6d116: Render and edit the text of legacy VML text boxes, and render VML lines, stroked and rounded rectangles, and aligned VML shapes. Fixes #1108
- f00ea50: Open documents that contain a small, highly compressible entry, XML names with non-ASCII letters, or a malformed content type on a part the editor does not need. Fixes #1107
- 79f3595: PAGE, NUMPAGES, and SECTIONPAGES fields with the Arabic, roman, alphabetic, or ArabicDash format switch now show the computed value on each page instead of the saved result. A numeric picture switch now applies in sections with a roman or alphabetic page-number format, and alphabetic page numbers past 26 repeat one letter. Fixes #1110
- 7a3aa00: Require prosemirror-view 1.42.3 or later to include the paste security fix for GHSA-c8x8-7fp4-3x9w.
- 2246044: Rename the review dialog to Track changes options, complete translations, and keep controls within narrow screens. Keep text inside tracked placeholder controls when replacing their prompts. Fixes #1128
- 556210d: You can type before a locked custom node or content control at the start of a paragraph or between two of them, and typing next to a checkbox no longer writes into it.

  Fixes #1121

- 8fcab75: Undo and redo treat a run of typing as one step at any typing speed, in local and collaborative editing. Fixes #1114
- e965797: A custom node without a review card no longer shows the active highlight when you place the cursor inside it.
- 13785e8: Reads on a missing header or footer return empty results instead of refusing. Fixes #1125
- Updated dependencies: @docx-editor.dev/i18n@2.27.0

## 2.26.0

### Minor Changes

- 5799fda: Rename the default font exports to `DEFAULT_FONT`, `DefaultFontFamily`, `DEFAULT_FONT_FAMILIES`, and `ALL_DEFAULT_FONT_FAMILIES`. The previous names still work and are deprecated.
- 6f356f2: Inline pictures take their correct position, caret, and paragraph mark in left-to-right and right-to-left text and beside floating objects. Fixes #1058
- 9cceda8: The automation API exposes floating and inline shapes through `Body.shapes` and `Paragraph.shapes`, and a text box's `Shape.body` reads, searches, edits, and reviews its text like any body, so the owner story's tracked changes, `acceptAll`, and `rejectAll` no longer include text box changes. Saving writes edited text box text into the legacy VML copy too, and a paragraph that anchors a floating shape no longer reads an object character. Fixes #1070
- ffe4071: Render display equations, paste equations from Microsoft Word and MathML as editable equations, and copy equations to Microsoft Word and other applications. Fixes #1063

### Patch Changes

- 2a6d159: Size AutoFit table columns from their content: a column widens to hold its widest unbroken word, columns whose cells state no width take their content's width, a spanning cell widens the columns it spans, a nested fixed table fits its cell, and cell spacing separates cells by twice its value. Fixes #1067
- 4e9e3ef: Lay out a table cell paragraph that continues across many pages in time linear in its length, and keep a cell paragraph's indents next to a floating picture that sits beside the cell or above the paragraph. Fixes #1068
- ffe4071: Preserve equations and optional hyphens when rich paste merges paragraphs with local namespace declarations.
- 42c6c26: Lay out documents that declare compatibility mode 16 or later as mode 15, align fixed table content in every legacy mode, and split footnotes below their references in every mode.
- 03edc1d: Read decimal and unit-suffixed twips values in page, column, paragraph, tab, and table properties, so a document with decimal column widths no longer lays out one character per line, and keep stated column widths and gaps when they do not fit the page.
- 2399ed9: Documents that set `w:doNotExpandShiftReturn` keep the natural spacing of a justified line that ends in a manual line break. Fixes #1093
- 6da4b6a: Fix invisible input-method composition text in empty paragraphs and beside inline pictures on lines without text.
- 6da4b6a: Use available fallback fonts when an earlier export font exceeds the shaping limit, and report the rejected source.
- 5e6c3c5: Line breaks and page breaks inside a field result now break the line or page, and REF fields keep line breaks from their bookmarked text.
- 5955c48: Wrap an unbroken field result, such as a URL in a HYPERLINK field, at the line edge instead of painting it across neighboring table cells or past the right margin. A space after a word that is cut at the line edge now stays at the end of that line instead of starting the next one. Fixes #1065
- 8c2b7ed: Render, edit, and search inline text boxes, and inset text box content by half its outline width.
- 7803d5c: Justified right-to-left lines now fit between the margins, and the space at the end of a justified line hangs in the margin, also before a line break. A justified line that ends in a page or column break is no longer stretched. Fixes #1092
- 6cf7b9f: Lay out, copy, and paste documents that omit their default run or paragraph properties with 12pt text and the default paragraph spacing, instead of 10pt text with no spacing. Fixes #1075
- 774ea4d: Non-breaking and optional hyphens are now characters of paragraph text (U+001E and U+001F), so text reads, search, selection, and deletion include them, inserted U+001E and U+001F become hyphens, and deleting text across a symbol removes it. Paragraph offsets after a hyphen move by one. Fixes #1071
- a4d6f8d: Lines now break at optional hyphens when a word does not fit, and the line ends with a visible hyphen, including in right-to-left paragraphs. A U+00AD character in run text shows as a hyphen, copies as itself, and in search matches only itself.
- c6a061c: Documents that declare compatibility mode 14 or earlier, or no mode, stretch a justified line that ends in a page or column break to both margins. Fixes #1095
- cd0202f: Break tables positioned against the page or margin across pages when they reach below the bottom margin, so rows past the first page are no longer hidden below it. Fixes #1074
- 6da4b6a: Preserve right-to-left word order around field and note marks displayed with ASCII decimal digits. Fixes #1079
- 77e1010: Place the trailing spaces of mixed-direction lines beside the text they follow, so right-to-left paragraph lines no longer run past the right margin, and spaces whose direction differs from their run or paragraph take room on the line instead of hanging. Fixes #1061
- 7b96dfc: A symbol is now one character of paragraph text that reads as "(", so the caret steps over it in one move, Backspace and Delete remove it, and search never matches it. Paragraph offsets after a symbol move by one.
- 36390bf: Deleting the row where a vertical merge starts now moves the merge start to the next row instead of leaving a continuation with nothing to continue, `Table.deleteRows()` accepts tables with merged cells, and a continuation cell with no merged cell above it starts its own merge instead of hiding its content. Fixes #1069
- Updated dependencies: @docx-editor.dev/i18n@2.26.0

## 2.25.0

### Minor Changes

- 5d02def: Report document refresh location diagnostics and processor review summaries, match paragraph IDs without case sensitivity, and reject malformed metadata before replacement.
- 7ac4f41: Find highlights every match, and `useDocumentSearch()` and `createDocumentSearch()` search and highlight from code. Use `useHighlights`, `watchHighlights()`, or `setHighlights()` to highlight your own text ranges. Fixes #1042

### Patch Changes

- 5d02def: Remove unused empty comment parts when saving while preserving unknown metadata, live undo, and concurrent comment edits.
- 95fbca3: Reduce page scans when painting text highlights in long documents.
- e151687: Give every pasted paragraph a paragraph ID, and keep list numbering when you paste a list into a document that already has lists.
- 5d02def: Preserve content in unsupported revision wrappers.
- 95fbca3: Fix search results when single queries and query batches share an editor, and report exact search result limits.
- f098ae6: The `@docx-editor.dev/i18n` type declarations are now valid when a project type-checks its dependencies with `skipLibCheck` turned off. Some declared types print in a different form, such as `DocumentOutline` as a `MemoExoticComponent`, with the same meaning.
- a13f6a7: In viewing mode, clicks, drags, and caret keys no longer place a caret or select text, so the toolbar keeps its values and the pointer shows an arrow over text.
- 5d02def: Fix successive writer edits and mixed paragraph insertion order, and reject control suggestions over pending paragraph revisions.
- Updated dependencies [5d02def]
  - @docx-editor.dev/i18n@2.25.0

## 2.24.0

### Minor Changes

- 3a8853f: Support inserting, editing, deleting, moving, and resizing body textboxes, with synchronized edits and remote cursors during collaboration. Fix textbox pagination and caret visibility, and keep text direction commands in Format.
- de3aac8: Render bounded paragraph frames with authored height rules, automatic width, relative alignment, wrapping, supported drop caps, and locked anchors.

### Patch Changes

- de3aac8: Fix centered footer page numbers and premature page breaks with directly formatted paragraph frames. Fixes #1019
- 79d8bc1: Reduce text layout work during document rendering and export without changing glyph positions.
- 997814e: Fix fixed-table column widths when explicit cell preferences are smaller than the initial grid.
- Updated dependencies [3a8853f]
- Updated dependencies [567c1e5]
  - @docx-editor.dev/i18n@2.24.0

## 2.23.0

### Minor Changes

- 30bd2a8: Show cached previews for inline embedded objects outside paragraph frames, and refuse clipboard transfers that cannot preserve objects.
- 30bd2a8: Allow eligible text-anchored floating tables to split across pages while preserving anchor constraints.
- d04902a: Draw vertical and horizontal lines, and draw shape outlines at their full width, inside the shape where the outline is set to sit inside it, and at the width the document theme gives them. Fixes #972
- 30bd2a8: Support bounded body style-separator display flow and report unsupported joins through export content warnings.
- a2951cf: Add customizable paragraph highlights with `editor.highlightAnchor()` and `editor.clearAnchorHighlight()`. Add alignment, motion, and offset settings to `editor.scrollToAnchor()`.
- 30bd2a8: Keep footnote references with legal note openings and reserve authored continuation notices.
- 30bd2a8: In documents that use Word 2013 layout, left-aligned and right-aligned tables with an absolute width now place their outer side rule on the aligned edge and measure cell margins from the rule center, so their cells wrap text at the correct width.
- bf776f2: Numbered paragraphs now start their first line at a tab stop between the number and the text indent, so the line wraps with the width it has. Documents that set `w:doNotUseIndentAsNumberingTabStop` use the first tab stop past the number instead of the text indent.
- 30bd2a8: Resolve character-style header references from visible page text and adjust header height for each page.
- e608e2d: Right-to-left runs now render with their complex-script font, size, bold, and italic, and alignment, paste, and copy follow each paragraph's direction. A new `setParagraphDirection` command with `direction.ltr` and `direction.rtl` toolbar controls switches paragraph direction. Fixes #864
- 30bd2a8: Paragraph lines follow active section line grids. Paragraph overrides and table compatibility settings control snapping.
- 6794f4d: Odd-page and even-page sections, and sections that restart page numbering when odd and even pages differ, now start on a page of the correct parity, with one empty sheet inserted when needed and marked by `PageRecord.parityBlank`. Sheets after section-end note sheets or a continuous section now continue the running page number, and `w:evenAndOddHeaders` with the value `off` now turns different odd and even pages off.
- 30bd2a8: Render supported picture members in shape groups in the editor and PDF exports.
- 30bd2a8: Table row layout records report `placesWhole` for rows with `w:cantSplit` or an exact height, and `hasContinuation` for a row that continues on the next page.

### Patch Changes

- 30bd2a8: Documents with `doNotUseHTMLParagraphAutoSpacing` add adjacent paragraph gaps. Automatic spacing uses 5pt before and 10pt after.
- e608e2d: Arabic and other joining scripts now join across a formatting change inside a word, such as a color change, in layout and in PDF export.
- e608e2d: PDF export now joins Arabic letters when the run's font has no Arabic glyphs, and the exported text extracts as whole words in logical order.
- 30bd2a8: A line with at-least line spacing no longer extends past the bottom margin, so it moves to the next page when its full height does not fit.
- b981ea6: Wrap text around floating drawings that use `behindDoc` with `wrapSquare`, `wrapTight`, or another wrapping mode. These drawings still paint behind the text, while `wrapNone` watermarks remain unchanged.
- 30bd2a8: A bordered or shaded paragraph that starts with a manual page break no longer adds a blank page after a full page. The borders and the space before of a paragraph that starts with a manual page break go with the text after the break.
- 30bd2a8: Bottom-to-top table cell text wraps within the final row or merged cell height.
- 30bd2a8: Prevent manual page breaks inside table cells from adding empty lines or changing tab alignment, justification, and text wrap.
- 30bd2a8: Preserve visible field result formatting after leading direction marks.
- 30bd2a8: Fix footnote pagination after live headers change the available body space.
- 30bd2a8: A manual page break at the start of a table cell paragraph no longer adds an empty line before a word or picture that does not fit, and no longer moves the caret or line beside a floating picture.
- 30bd2a8: Manual page breaks inside table cells no longer reorder right-to-left text and numbers or move decimal tab alignment. Layout measures Arabic letters on both sides of such a break as one joined word when the font has Arabic glyphs.
- 30bd2a8: A manual page break inside a table cell no longer increases the height of a line that also holds an inline picture or equation with automatic line spacing.
- 30bd2a8: A manual page break inside a table cell no longer increases line height when the word that holds it wraps to the next line.
- 0e42c85: A continuous section with a different header or footer height, or with a different first page, now continues on the sheet where the previous section ended instead of starting a new sheet.
- 30bd2a8: Correct body pagination and placement for right-aligned footer page fields above empty anchor paragraphs.
- 30bd2a8: Fix blank space before returning paragraph continuations when their footnotes fit.
- 30bd2a8: Paragraphs ahead of a footnote reference that moves to the next page now stay on the earlier page when they fit, instead of leaving blank space above the footnotes.
- 30bd2a8: A footnote cited on the second line of a paragraph no longer moves to a later page without its first lines when the paragraphs ahead of the reference change pages.
- 30bd2a8: Fix footnote spacing when paragraph continuations and kept paragraph openings return to an earlier page.
- 30bd2a8: Footnotes referenced from table rows now stay on the page of their row. A long footnote continues on the next page when at least two of its lines fit below the row, or below the reference line where the row splits; otherwise the row moves to the next page with the footnote.
- 30bd2a8: Footnotes that fit below the text of the last line on a page no longer split or move to a later page.
- 30bd2a8: Place floating tables in headers and footers at their anchor positions, and stop spaces and tabs from making lines taller. Text below a top-and-bottom object now keeps its paragraph spacing before.
- 30bd2a8: A page number frame at the start of a header shares the first line of the header text instead of adding a line, so the body starts one line higher. Frames aligned inside or outside alternate margins by physical page, also after a page numbering restart.
- 30bd2a8: A vertically merged cell inside table header rows now sizes each header row by its own content, on the first page and on every repeated header.
- e608e2d: In exported PDFs, Hebrew lines drawn in a fallback font now take that font's line height, so they no longer take the extra height of the run's own font.
- 30bd2a8: Reserve wrapping space for unsupported floating drawing groups while their content stays hidden.
- 30bd2a8: Preserve host callback failures when checking whether hidden header or footer drawings require a layout retry.
- 30bd2a8: Justified paragraphs in documents that use modern compatibility settings can now fit their last word on the line by compressing the spaces between words.
- 30bd2a8: Preserve justified word wrapping and compressed spacing across formatting runs.
- 30bd2a8: A keep-with-next paragraph that does not fit in the space left on a page now splits there when its keep-lines and widow-control settings allow it, instead of moving whole to the next page. In documents that use Word 2013 or later layout, a paragraph in a keep-with-next chain that fits but leaves no room for the next paragraph also splits, and its last lines move to the next page.
- ab460dc: Keep headings with following paragraphs when widow control or keep-lines moves those paragraphs to the next page.
- 30bd2a8: Render known single-byte Symbol and Wingdings bullets when their font is unavailable.
- e633def: A plain paragraph that starts with a manual page break and has text after the break no longer adds a blank page when it follows a full page.
- 30bd2a8: Prevent blank lines before long words that follow leading tabs.
- 30bd2a8: Legacy checkbox form fields take their line height from the run font, so lines and table rows that hold them no longer grow taller.
- 30bd2a8: Render uniform single-line borders around inline legacy VML pictures and reserve their full size.
- 30bd2a8: A table row that continues a vertical merge in any column ignores "Page break before" and keeps its placement.
- cee5764: A paragraph that contains a line break outside a run now renders and stays editable, and the misplaced break is saved unchanged.
- 30bd2a8: Correct cell widths for automatic-width tables with simple borders in documents that use Word 2013 layout.
- 30bd2a8: In documents that use Word 2013 layout, centered tables with an absolute width no longer inset cell text by an extra half border width, so their cells wrap text at the correct width.
- 30bd2a8: A word that wraps to a line or float passage where only the word itself fits now keeps its trailing space at the end of that line, instead of starting the next line with the space or adding a line that holds only the space.
- 30bd2a8: A negative top or bottom page margin places the text at that exact distance from the page edge, and a taller header or footer overlaps the text instead of pushing it. In that overlap, text, links, note references, pictures, and form fields take the pointer, and a closed header or footer highlights only its part in the page margin.
- 390c177: A field nested inside another field's instruction no longer adds its saved result, including line breaks, to the displayed text, Find, or text reads.
- 30bd2a8: A vertically merged cell that contains another vertical merge in a different column now sizes each covered row by its own content instead of adding the merged height to its first row.
- ae1afe0: Preserve no-break space behavior across formatting runs and keep figure spaces attached to adjacent East Asian text.
- 30bd2a8: Numbered and bulleted paragraphs keep their markers with their text after a leading manual page break.
- 30bd2a8: A paragraph whose own top-and-bottom picture leaves no room for its text on a page no longer adds blank pages. The paragraph and its picture move to the next page once.
- d6c75d2: A manual page break followed by an empty section-break paragraph no longer adds a blank page before a section that starts on a new page.
- 2eea4de: A character style on a paragraph mark now sets the height of an empty paragraph and formats the paragraph's list number, so headers and footers with styled empty paragraphs leave the correct space for body text. Text typed into such a paragraph takes the same character style.
- 30bd2a8: A larger paragraph mark no longer makes the last line of its paragraph taller when that line holds text, superscript or subscript text, an inline picture, or an equation; a line with only inline pictures takes the text height of the runs that hold them, and a larger paragraph style size no longer makes a superscript or subscript last line taller. Empty paragraphs and empty last lines still take the mark's height.
- e040ff8: Runs, paragraphs, tables, and pictures written with indented XML under `xml:space="preserve"` now open as editable content, so their no-break spaces, tabs, and text appear in the layout instead of disappearing.
- 30bd2a8: Account for raised and lowered text when sizing automatic paragraph lines.
- aab4053: Render embedded rasters when their byte signature differs from the declared raster format. Format-class mismatches remain refused.
- 30bd2a8: Correct character-style header selection and preserve supported picture and table border boundaries.
- 30bd2a8: Right-aligned page numbers can share the following footer text line without adding footer height or reducing body space.
- e608e2d: Right-to-left paragraphs now take `w:left` indents from the right margin, place list markers on the right in right-to-left order, and number `hebrew1`, `hebrew2`, `arabicAlpha`, `arabicAbjad`, and `hindiNumbers` lists in their own scripts. For these paragraphs, `formatting.indent` reports the `w:left` value as `left` and sets `rtl`, and the ruler mirrors its indent handles.
- e608e2d: Tabs in right-to-left paragraphs now keep the text segments in reading order and measure tab stops from the right margin.
- 9afb832: An empty section-break paragraph with a page break before it no longer adds a blank page after the content of its section, also when the paragraph holds only bookmarks, proofing marks, permission or comment range markers, or empty text.
- 30bd2a8: Vertically merged cells that start and end in the same rows now share those rows, so the first row no longer grows to hold a merged cell's full content.
- 30bd2a8: Table indents now move left-aligned and right-to-left tables by the full stated amount, including negative indents and tables wider than the text column, and a zero indent on a table overrides the indent of its table style.
- 30bd2a8: A word that spans more than one run now wraps to the same place as the same word in one run when it fits the line or float passage it moves to, so it no longer splits around a floating picture, sits under it, or loses the height of an inline picture on the line it leaves.
- 30bd2a8: In a paragraph numbered through its style, the numbered style's own indents, spacing, alignment, and tab stops override the list level, and the level overrides that style's base styles.
- 30bd2a8: Table text in the default paragraph style keeps the font size of that style when the table style states no font size.
- 30bd2a8: A table row whose first cell starts with a keep-with-next paragraph now moves to the next page with the row or paragraph that follows it, and a keep-with-next paragraph before a table now moves with the rows it keeps with instead of staying alone at the bottom of a page.
- 30bd2a8: Move a table row to the next page when the remaining space cannot hold its minimum height. Keep preceding captions with the row.
- 30bd2a8: Start a table row on a new page when the first paragraph of its first cell has "Page break before" set, including through its paragraph or table style.
- 30bd2a8: Place tables below wrapping pictures when their rows would overlap the pictures, including header pictures on continuation pages.
- 30bd2a8: Keep terminal note citations with words that fit through justified space compression.
- 30bd2a8: Fix clipboard checks in headers, footers, and notes so they do not retain editing resources.
- 30bd2a8: A floating picture that may not overlap other objects no longer moves to a later page, or adds blank pages, when it reaches past the bottom margin without touching another object.
- 30bd2a8: PDF export no longer fails on a centered bottom-to-top cell that spans merged rows.
- 30bd2a8: Support visible hidden-mark paragraph joins with compatible paragraph geometry.
- 30bd2a8: Carry merged text to the next row when a two-row vertical merge breaks before its text can start.
- 30bd2a8: Floating drawings handle negative wrap distances without excess gaps. Changing a drawing's wrap mode preserves inherited anchor distances.
- Updated dependencies [5981e48]
- Updated dependencies [3b95523]
  - @docx-editor.dev/i18n@2.23.0

## 2.22.0

### Minor Changes

- 07718bd: Reserve the full height of a collapsed horizontal table border in the row below it. Draw each column's border downward from the shared boundary.
- fe66ece: Add safe DOCX refresh with scroll preservation, customizable timed change highlights, and configurable change navigation. Fixes #951
- 648f13c: Add optional File menu exports for continuous Markdown and PDF with clear setup and conversion errors. Customize export feedback with `popups.export` in React and Vue.
- 95c792f: Add File > Print and Ctrl+P, which print the document through the configured PDF converter. Customize print feedback with `popups.print` in React and Vue.
- 07718bd: Add `lastResortFonts` to `openFontBackedDocumentForExport`. These font sources resolve missing families after embedded fonts, preserving fonts supplied by the document.
- 07718bd: Add export capabilities for absolute span geometry, laid-out glyph shaping, glyph fallback, picture bullet records, and fixed picture opacity from `a:alphaModFix`.
- a893c05: Add `editor.scrollToAnchor()` to reveal paragraphs by `paraId` without changing selection or focus. Fixes #957

### Patch Changes

- 139688b: Improve screen reader labels and keyboard access for document pages, formatting controls, and vertical ruler margins.
- d98b6d8: Floating objects that must not overlap now move beside the object they collide with, as Word places them, and move down only when neither side has room.
- abc656b: Keep floating drawings whose anchor flags are spelled with surrounding whitespace. `behindDoc`, `locked`, `layoutInCell`, `allowOverlap`, `simplePos` and `hidden` are `xsd:boolean`, which carries a fixed `whiteSpace="collapse"` facet, so `1` and `true\n` are legal — the anchor gate compared the raw string and dropped the drawing instead. Schema-invalid spellings such as `yes` or `2` are still refused.
- 07718bd: Center `w:insideV` table borders on column boundaries, including the first and last columns.
- 07718bd: Center vertical table borders on column boundaries when `w:tblW` uses `w:type="auto"`.
- 07718bd: Support color fonts that include glyph outlines. Prefer color emoji fonts for emoji-presentation text while preserving symbol fonts for other characters.
- 9912e81: Fix slow download file names, layout, and Markdown conversion for text with long runs of spaces or dots. Download names also prefix Windows device names that have an extension, such as `_NUL.tar.docx`, and no longer double a padded `.docx` suffix.
- 7ff2004: When a section has other content, the empty paragraph that ends it before a continuous section no longer adds its line height or paragraph spacing, so the next section starts directly below the previous content.
- ac84ccf: Convert long documents to PDF about twice as fast, and shape text faster in the editor and in headless exports. Page content is unchanged, but compressed PDF stream bytes can differ.
- cde01d8: Enter, Backspace, and typing are faster in long documents, most of all in documents with many sections, tables, comments, or page-number footers.
- 07718bd: Include a floating table's outer border in its text-wrapping exclusion area.
- 07718bd: Use the run font's strikeout metrics to set the thickness and baseline offset of `w:separator` footnote rules.
- 07718bd: Draw a framed paragraph's bottom border at the frame's bottom edge, after the paragraph's trailing spacing.
- d98b6d8: Header and footer text outside tables in documents saved before Word 2013 compatibility mode no longer wraps around the floating objects in that header or footer, as Word lays it out.
- 23093e9: Empty paragraphs whose paragraph mark is hidden no longer add blank lines and spacing to the page, and they still count in list numbering.
- edfb06d: Justified paragraphs now compress inter-word spaces to fit a word when the space after that word is in a separate run or the paragraph uses an East Asian language, so these lines no longer wrap one word early. Justified lines that end in a double space split across runs now fill the full line width.
- 07718bd: Apply `w:widowControl` to footnotes and endnotes that span pages. Move a three-line note to the next page when splitting it would leave its final line alone.
- d98b6d8: Floating objects in a table cell now stay in the cell when `layoutInCell` is off in a document saved in Word 2013 or later compatibility mode, as Word lays them out. For such an object, `AnchoredDrawingRecord.layoutInCell` now reports where the layout placed it rather than the authored attribute.
- 07718bd: Exclude page-positioned floating objects with `w:layoutInCell="0"` from text wrapping inside their containing table cell.
- d98b6d8: In documents saved before Word 2013 compatibility mode, table rows now move below a floating object that a cell places against the page, and objects positioned against their own character or line stay in their cell, as Word lays them out.
- e6616fe: Table rows that cannot break across pages but are taller than a page now start on a new page and continue onto the following pages, instead of failing layout and export.
- 1bb2434: A page- or margin-anchored floating table that spans the text column now moves to the next page with its following paragraph when earlier text on the page would leave no room for that paragraph below the table.
- 07718bd: Keep picture bullets aligned with text when a bottom-aligned cell, frame, or note moves the paragraph. Apply fixed picture opacity in the editor and reject invalid character-border colors before rendering.
- 07718bd: Render `w:numPicBullet` picture bullets as image list markers in the editor and PDF export. Use the list level's bullet text when the image is unavailable.
- 139688b: Preserve accepted document refresh results when a change observer cancels processing.
- 07718bd: Use authored `w:tblGrid` column widths when the table specifies a total width. Apply absolute cell widths only to columns without a grid width.
- 07718bd: Reduce cumulative rounding errors in PDF text baselines across paragraph lines.
- 07718bd: Render list bullets and calculate their line height using the document's specified symbol font. Preserve Unicode text for copying.
- 07718bd: Apply automatic spacing between table-cell paragraphs when `w:beforeAutospacing` or `w:afterAutospacing` is enabled.
- 9db7eb3: Improve PDF conversion with reusable export sessions, configurable limits, typed errors, and font diagnostics.
- 07718bd: Include the anchor's vertical offset when positioning text below a drawing with top-and-bottom wrapping.
- 07718bd: Prevent extra line breaks at run boundaries after a drawing with top-and-bottom wrapping.
- 07718bd: Draw vertical table borders outward from their grid lines instead of inside the preceding cell.
- 07718bd: Apply modern justification and default ligatures to documents with `compatibilityMode` 16 or later.
- 07718bd: Expand `w:lineRule="atLeast"` line boxes upward when their minimum height exceeds the text height. Improve PDF baseline placement at rounding boundaries.
- 07718bd: Allow documents with wrapping exclusions to complete layout when they require more than eight reflow passes.
- @docx-editor.dev/i18n@2.22.0

## 2.21.1

### Patch Changes

- 0b06827: Update the wording of public documentation comments.
- 9c7ac7c: Prevent unformatted paragraph marks from inflating smaller text and adding extra pages. Preserve nested-table insertion controls while moving the pointer onto them.

  Reduce mount-time hash overhead, skip selection geometry for collapsed ranges, and reuse bounded serialization results when saving an unchanged document.

- 377882e: Keep the viewport still when a click places the caret, so a double-click in the blank header or footer margin creates and opens that story. Shift-extended keyboard moves and form-fill Tab now scroll to keep their target in view.
- 6a7b93a: Include tracked formatting in shared styles in document-wide review decisions, counts, and individual review commands. Commit style and story decisions atomically with protection, undo/redo, collaboration replay, and formatting-cache invalidation. Keep malformed authorless revisions visible instead of silently omitting them.
- 6a7b93a: Support accepting and rejecting table rows, independent cells, merge states, table grids, and structural property history. Preserve dependent and protected changes, restore cell geometry consistently, and keep historical markers out of the pending review queue.
- 6a7b93a: Match Word when resolving paragraph breaks before tables, numbering-reference insertion history, and partial section-property history. Preserve protection and selected-decision boundaries, and expose structural operation details and accurate table/cell review anchors.

  Show structural decisions in the React and Vue review sidebars by default, with descriptive row, cell, merge, and numbering labels. Keep run/paragraph formatting in balloons while showing formatting without a painted anchor in the sidebar.

- fc755da: Preserve list spacing when pressing Enter, including inherited styles, blank-paragraph separators, following styles, and automatic list margins.

  Resolve relocated style definitions through the document relationship when editing and creating list styles.

  Resolve line-unit paragraph margins, numbering-level formatting, and contextual spacing in body text and table cells. Preserve separator behavior across content controls and distinguish blank paragraphs from non-text content. Keep edits valid when XML namespace prefixes conflict.

- a023045: Fix grouping and resolution of tracked table changes, including nested rows, cell formatting, shared grid histories, widths, alignment, and row heights. Related changes resolve together while preserving independent revisions, protected content, and unknown metadata.

  Fix move-revision handling and partial-resolution reporting. Preserve existing nested tables when a row cannot be removed, and report `retained-structure` when its structural change remains pending.

- Updated dependencies [6a7b93a]
  - @docx-editor.dev/i18n@2.21.1

## 2.21.0

### Minor Changes

- db1b50c: Add keyboard-accessible content-control popups, regional date entry, replaceable React/Vue parts, picture replacement, and glossary building-block insertion with restored placeholders. Legacy checkboxes support click and Space toggling with larger pointer targets and matching caret geometry; symbol-only paragraphs now render.
- be94e1c: Add engine-owned history groups, shared React and Vue gesture bindings, and history outcomes so live formatting controls record one undo step per gesture while every value renders and replicates. Fixes #902
- f30cd6a: Legacy Word dropdown form fields (`FORMDROPDOWN`) use native select menus. Choices update the saved index and displayed text together, support undo and forms protection, and survive save/reopen. Disabled fields and viewing or suggesting mode refuse changes.
- 87b8b3d: Add Word's Simple Markup view: the proposed text with a red change bar beside every changed line, and a click on the bar that switches to All Markup and back. All Markup now draws one neutral gray hairline per page, halfway into the left margin, continuous across changed lines, for every story, and No Markup and Original no longer paint insertion or deletion markup.
- 06b79d7: Render section page borders with text-relative or page-relative offsets, first-page filters, and foreground or background placement. Art borders remain preserved without rendering, and page borders have no editing UI.

### Patch Changes

- ab9548d: Preserve empty paragraph typing formatting across caret moves and save/reopen, and update caret size immediately when the typing font changes.
- 424a121: Hash layout cache tokens and admitted font bytes with the host's native SHA-256 in Node and Bun, which cuts headless export time by about a tenth on long documents. Browsers keep the JavaScript implementation.
- 06b79d7: Fix dashed and dotted paragraph and page borders that incorrectly rendered as solid lines.
- 40ef065: Remove circular declaration re-export warnings from core package builds without changing public APIs.
- 14a3468: Use the shared page-margin revision bars for tables and drawings without duplicate colored row bars or image frames. All Markup uses gray bars; Simple Markup uses red bars. Remove unused legacy cell-revision styles and tint tokens. The Igloo demo also inherits the standard margin-bar colors.
- 424a121: Headless export no longer fails with "unsupported value type in comparator input: undefined" for a document whose theme has no East Asian, complex-script, or supplemental font scheme.
- 2d4e0e7: Resolve independent table and paragraph changes in bulk without blocking them on unsupported or excluded revisions. Preserve pending table properties when removing all rows, and group only the properties a selected revision can replace or remove.
- @docx-editor.dev/i18n@2.21.0

## 2.20.0

### Minor Changes

- c10916a: Resolve filtered or explicitly selected revisions in one undo unit. Skip unsupported groups and report remaining decisions; retain strict story-wide automation methods.

### Patch Changes

- a9034d4: Fix cross-reference links so clicking their results navigates to the target bookmark. Fixes #886.
- a9034d4: Keep continuous tracked insertions containing fields together in one review card. Fixes #890.
- a9034d4: Show pointer cursors on clickable document links in standalone hosts. Keep inert links and format-painter cursors distinct. Fixes #893.
- a9034d4: Fix editing and highlighting of ordinary text beside table-of-contents field boundaries. Fixes #887.
- a9034d4: Match Word's TOC link appearance while preserving explicit formatting and clickable targets. Fixes #892.
- a9034d4: Support the Word keyboard shortcut for switching between field instructions and results. Fixes #891.
- Updated dependencies [c10916a]
  - @docx-editor.dev/i18n@2.20.0

## 2.19.1

### Patch Changes

- ccd6bdd: Avoid an extra blank page when a page-break-before paragraph starts a new section. Fixes #870.
- ccd6bdd: Use Word's default C identifier for TOC source filtering and untyped TC entries. Fixes #878.
- ccd6bdd: Bound TOC detection work when documents contain excessive nested field markers. Fixes #879.
- ccd6bdd: Keep the first refreshed TOC entry beside its opening field markers, without adding a blank paragraph. Fixes #877.
- ccd6bdd: Fix numbered table-of-contents rows skipping the hanging-indent tab and wrapping page numbers. Fixes #867.
- ccd6bdd: Keep TOC hover highlights around the complete entry, including hanging clause numbers and right-aligned page numbers. Fixes #874.
- ccd6bdd: Refresh table-of-contents entries within field boundary paragraphs and detect single-paragraph tables of contents. Fixes #869.
- ccd6bdd: Preserve inline content controls during TOC refresh and respect locked cached page numbers. Fixes #875.
- ccd6bdd: Preserve stale tabbed TOC titles when page numbers are omitted by their TC source. Fixes #876.
- ccd6bdd: Preserve TC-based table-of-contents entries during refresh, including entry levels, identifiers, and page numbers. Fixes #868.
- @docx-editor.dev/i18n@2.19.1

## 2.19.0

### Patch Changes

- @docx-editor.dev/i18n@2.19.0

## 2.18.0

### Minor Changes

- ded420d: Render Arabic text paragraphs with script-aware measurement, inherited RTL alignment, and matching caret geometry. Fixes #773.
- 564182f: Add `customFonts()` to supply company fonts alongside packaged and Google fonts, with validation and failure reporting. Support cancellation in `loadFonts()` and custom font resolution, and match font names consistently during measurement and painting.
- f2dfcac: Style packaged dialogs with bordered inputs and visible buttons that withstand host CSS resets. Forward `id`, `aria-*`, and `data-*` attributes through popup parts, and omit decorative classes when using `asChild`.
- 758551b: Add Review > Protect Document for Forms to enable forms protection or stop an enforced restriction without a password. Each toggle supports undo and persists on save. Enforce read-only and comments-only restrictions, and disable suggesting mode under forms protection.
- 6eb1eb4: Expand the Office.js-compatible API for text, formatting, lists, tables, pictures, fields, and review workflows, with task guides and compatibility reports. Fix batching errors and preserve document content during structural edits.
- 9198848: Show configured providers’ supported fonts in the searchable font dropdown without preloading their bytes. Load newly selected fonts on demand while preserving selection and undo history.
- f23f974: Render visually RTL table columns, merged cells, borders, interaction geometry, and HTML clipboard direction in the correct order. Fixes #774.
- 040e653: Improve Word fidelity for theme fonts, RTL numbers, floating-table passages, and narrow CJK punctuation.

  Use editor-scoped fonts; `packagedFonts.install` and `installDefaultFontFaces()` are deprecated and inert, so configure app fonts separately.

### Patch Changes

- d2d3824: Add `activeBackground` to author styles to set the open change's highlight band per author.
- b5bf09f: Preserve table structure and formatting when toggling checkbox content controls. Fixes #817.
- 10a3d41: Fix automated checkbox updates to save Word symbol glyphs with the declared state font, matching editor toggles. Fixes #754.
- e78dc17: Keep the toolbar's standard font choices available in empty and populated documents. Merge configured and document-specific fonts into that list without loading unused font bytes.
- 84c4622: Preserve the table cell or row a text, dropdown, combo box, or date content control wraps when its value changes. Fixes #825.
- 452312f: Keep direct text formatting, including font family and size, when you press Enter after formatted text. Preserve paragraph style transitions, such as a heading followed by body text.
- 5598465: Fix CJK punctuation spacing and overlap when `characterSpacingControl` enables compression, while preserving authored spaces and paragraph boundaries.
- 60b9163: Release temporary font-discovery caches before export layout to keep large documents within constrained memory limits.
- 59520ce: Apply reviewer filters and display modes inside legacy text form fields and tracked positional tabs, and remove empty revision cards after nested changes are resolved. Fixes #826. Fixes #829.
- 95db5eb: Fix declaration builds and text-shaper initialization with bidi-js 1.1.0 and harfbuzzjs 1.6.1.
- 1e36856: Match Word's picture brightness and contrast so washout watermarks retain a white background. Fixes #821.
- 37be540: Allow adding, replying to, resolving, reopening, and deleting comments in comments-only documents. Disable commands that forms protection refuses and return a readable reason. Keep supported form fields, unlocked content controls, and unprotected sections editable.
- 2cea799: Resolve missing East Asian fonts from document theme languages, inherited language hints, and supplemental theme fonts. Load the selected Chinese, Japanese, and Korean fonts before shaping in editors and exports.
- 7c2b4aa: Keep typing at the end of an unprotected legacy text form field outside its result, matching Word. Preserve protected filling, surrounding locks, and tracked changes at the boundary.

  Treat unprotected form fields as complete units for word-delete shortcuts. Preserve Word’s select-then-delete behavior for Backspace and Shift+Backspace.

- 90ea211: Preserve the document's scroll position and text selection when picking or typing a font size, or dismissing the font-size input with Escape. Restore the saved selection when returning focus to the editor from toolbar inputs.
- f10341d: Prevent excessive processing time when documents contain malformed VML color values with long whitespace sequences.
- @docx-editor.dev/i18n@2.18.0

## 2.17.0

### Patch Changes

- 332494b: Dismiss content-control dropdown and date menus on outside press or Escape; re-pressing the widget toggles the menu shut.
- @docx-editor.dev/i18n@2.17.0

## 2.16.2

### Patch Changes

- d8c40b2: Set tracked insertion underlines slightly below the text like Word, with a CSS token for the gap.
- 02b77f6: Use a thin solid underline for tracked insertions and add CSS tokens for its style and thickness.
- @docx-editor.dev/i18n@2.16.2

## 2.16.1

### Patch Changes

- b2390c6: Improve Word review parity with grouped paragraph breaks, optional paragraph and manual line-break marks, detailed formatting cards, separate formatting decisions, navigation, bulk acceptance/rejection, and markup display controls. Fixes #793 and #794.
- @docx-editor.dev/i18n@2.16.1

## 2.16.0

### Minor Changes

- 0a3b35d: Fix East Asian wrapping across formatting changes, preserve full-width number groups, and apply CJK justification and document typography settings.
- 00666a8: Render, edit, search, and copy text inside smart tags, inline custom XML, and bidirectional run wrappers, and add text form selection, boundary deletion, replacement, field options in React and Vue, and protected filling; Fixes #710
- 19a420e: Render supported legacy VML photos, annotation groups, and straight WordArt while preserving original XML, shared media, and drawing offsets during edits.
- 6fac0e1: Keep symbol faces, such as the MS Gothic face a Word checkbox names, out of the font substitution notice, and report them to the font resolver so an app can supply them. Fixes #729, fixes #730
- 2c7a3c9: Use `locale` for regional date input in text form fields, including dotted dates and year-first patterns. Remove the unreleased `dateInputOrder` prop and setter. Preserve existing dates when locale changes.

  Form-field dialogs and accessibility labels now honor `i18n`, including live catalogue changes.

- 0a75175: Preserve pending form values when moving or remounting the editor. Add `PaginatedSurface.save()` to validate pending input and refresh REF fields before serialization. Browser automation and paginated React and Vue refs use this save path. Synchronous saves refuse active edits and destroyed surfaces. Field-exit callbacks can throw or remount the editor without changing date interpretation.

  Preserve nested simple-field results in clipboard HTML. Reject partial field quotes in the server-agent review example before an edit can affect additional text. Refuse tracked deletion or replacement of simple fields with nested result structures instead of leaving old text behind.

- 3ca855b: Add Office-shaped server redlining through `Document.changeTrackingMode` and standard `Range.insertText`, `delete`, and `clear`. Collaborative agents can author real Word revisions and replicate them to open editors, with atomic commits, revision checks, and typed refusals for unsupported targets. `TrackMineOnly` is host-local; `TrackAll` explicitly refuses.
- 1de0f64: Write a suggested replacement as Word does: the deletion first, then the insertion, each under its own revision id, wherever in the paragraph the replaced text sits. Add `replacementLanding` to the editor surface and the automation port, so a scripted replacement writes and reports the same position typing does. Fixes #691.

### Patch Changes

- 96d7e74: CJK text now wraps at the column width with UAX #14 ideographic break opportunities and basic kinsoku, instead of breaking only at run boundaries or spaces. Fixes #526
- 82b8e0c: Preserve regional dates during save, keep four-digit years, and reject tracked edits inside rows with pending revisions.
- 7a18c15: Render flipped DrawingML paths and open connectors with triangular line ends.
- 863680d: Honor explicit East Asian font hints for Latin-1 symbols, including middle dots, degree signs, multiplication and division signs. Keep ASCII text, model offsets and canonical run formatting unchanged.
- 62a6911: Keep floating image overlays visible beyond their anchor cells while preserving page clipping.
- 41a3bc7: Render checkbox states that omit their font with Word's default MS Gothic font instead of literal hexadecimal text. Fixes #752.
- e295e90: Report omitted legacy drawings and incomplete content scans during export. Preserve usable font faces after partial font-source failures while reporting those failures to strict policy.
- a4a9bbc: Search body, header, and footer text-box stories during Find navigation. Fixes #711
- 76a4c5d: Keep overflowing whitespace-only runs at the end of their current line instead of indenting the next line, preserving their canonical text and caret ranges.
- b7c82fa: Render JPEG photos with large metadata segments and validate their EXIF-oriented dimensions without changing the original media.
- 03b88ea: Position supported legacy PAGE footer frames without adding an extra footer line. Clip fixed-width frames above empty or PAGE anchors while preserving fields, selections, and document structure.
- 1f207f8: Preserve supported legacy full-width table alignment across body, header, footer, text-box, and note stories, with consistent compatibility settings and cache invalidation.
- 485bfd4: Render the DrawingML bilevel picture color mode.
- da01e25: Render numeric positioned text frames and wrap body text around supported floating tables without adding their height to paragraph flow.
- f416965: Avoid quadratic merge time when you paste many distinct images. Fixes #502.
- 954d9d1: Keep focus in outside controls when fonts finish loading, while preserving the editor's saved selection across the font remount.
- 85bfd9c: Keep joined emoji and combining marks intact under East Asian font hints, avoid premature word wrapping at trailing spaces, and preserve terminal floating tables beside empty anchors with bookmarks or paragraph spacing.
- 3641f1e: Improve fidelity for justified lines, East Asian font hints, explicit symbol fonts, drawing and textbox updates, EXIF-oriented JPEG photos, and clicks beside legacy centered PAGE footer frames.
- 10a0575: Fix shared-border spacing between repeated table headers and complete text rows without changing authored borders.
- 46c0de2: Render opaque solid Word 2010 text outlines with explicit RGB colors.
- fdd6045: Preserve pending date input when fonts load, wrap long words after protected text boundaries, and keep default document loads compatible with browser runtimes.
- eb0e520: Enabling suggesting mode without a configured author now returns a clear configuration error and raises it once through the `error` event, instead of entering the mode and silently ignoring keystrokes. Setting the author later enters the requested mode, and the toolbar's mode menu keeps the other modes available. Fixes #692
- 5505944: Request fonts used by SYMBOL fields and numbering markers when you open a document. Fixes #749.
- b5ab91b: Preserve floating-image text distances, and keep text out of narrow image side gaps.
- 6f7da01: Avoid an extra blank page after simple text-anchored tables with a terminal empty paragraph that fits the same page.
- Updated dependencies [00666a8]
  - @docx-editor.dev/i18n@2.16.0

## 2.15.1

### Patch changes

- @docx-editor.dev/i18n@2.15.1

## 2.15.0

### Minor changes

- 5284df5: Add `@docx-editor.dev/core/export` for document layout without a DOM. Export sessions share the browser editor's layout engine and return immutable pages, comments, tracked changes, and font-resolution reports.
- 0d81033: Add font resources, shaped text, embedded fonts, metadata, internal link targets, and comment and tracked-change positions to export sessions.
- 8e6133f: Apply author, mode, translation, and locale changes without rebuilding the editor, including Vue root and packaged components. Fixes #695 and #561.

### Patch changes

- e9baf4d: Search headers, footers, footnotes, endnotes, table cells, and saved field results. Fixes #703 and #694.
- 087bb78: Fix floating table positions, vertical cell text, stacked fractions, and inline pictures in later columns. Preserve equation size and pagination with automatic line spacing. Fixes #662.
- a3819aa: Wrap long words across tracked insertions in suggesting mode without splitting Unicode graphemes. Fixes #716.
- a53f75c: Render hyperlinks in headers, footers, and anchored text boxes. While editing a header or footer, use Control+K to edit or remove its links. Links in these regions do not navigate. Fixes #643.
- 36c1f04: Update list markers in text boxes inside tables and reduce repeated paragraph layout work. Fixes #639.
- 678fe91: Group tracked field controls into one review card for each insertion or deletion. Fixes #718.
- cfe3fe1: Allow on-demand font resolvers to return empty results without a configuration error.
- 0e1360d: Keep underlined trailing spaces and underscore tab leaders as single rules that reach the line margin.
- 2a8e57e: Show tracked field controls with their adjacent replacement instead of separate **Deleted** cards.
- @docx-editor.dev/i18n@2.15.0

## 2.14.1

### Patch Changes

- @docx-editor.dev/i18n@2.14.1

## 2.14.0

### Minor Changes

- 7633b2c: Add Review > Markup Options > Reviewers to filter tracked changes and comments by author without changing saved document data. Keep an optional composable toolbar shortcut with a host-provided icon. Fixes #666.
- 01022a4: CJK text now measures and paints in the `eastAsia` font the document names (`w:rFonts w:eastAsia` / `w:eastAsiaTheme`, including through `w:docDefaults` and the theme's `a:ea` typefaces) instead of the run's Latin face. `ResolvedRunStyle` gains `fontFamilyEastAsia`, and `StyleSpanRecord` gains `fontSlot`; the format painter copies the East Asian face into `w:eastAsia`, and the font catalog lists the theme's East Asian faces.
- 6b5bb8d: Add `setTrackedChangesFilter` with a predicate over complete revision items. Filtered revisions render as accepted without changing saved OOXML. Fixes #668.
- f731c52: Add an `accept` or `reject` content projection mode to `setTrackedChangesFilter`. Both modes remain view-only and preserve tracked changes in saved DOCX files.

### Patch Changes

- 1afc5f2: Treat contextual table controls as the first collapsible preset-toolbar group, so entering a table moves those controls into More before ordinary formatting controls instead of overlapping them. Keep table color pickers contained within the More panel so later controls remain clipped and scrollable while a picker is open. Fixes #669.
- @docx-editor.dev/i18n@2.14.0

## 2.13.0

### Minor Changes

- 3c66a7c: The font-substitution notice now reports only families that rendered text resolves to through the style cascade, so declarations in unused styles no longer trigger it. Adds `renderedFontFamilies()` to the tree session.
- 2ea6a9d: Saving now refreshes stale REF field results inside footnotes and endnotes as one undoable transaction with the body, so the exported note parts carry the values the pages paint; a field inside a locked or data-bound content control keeps its cached result without blocking the others, and collaborative sessions keep exporting cached results. Fixes #611
- 0860dd2: Let a font substitution carry the requested family's line box through `FontSourceSubstitution.lineMetrics`, so a substitute with different vertical metrics still paginates like the face the document names.
- b1fa0d6: REF cross-reference fields now compute their results live from the bookmark target and the resolved numbering, so references such as "Section 1.2" track renumbering edits instead of painting the saved result forever. Fixes #601.
- f1d3940: Saving now rewrites stale REF field results into the exported bytes, and REF fields inside footnotes and endnotes paint live values. Fixes #606.
- 96cdbe2: Preserve Word page breaks, paragraph flow, list formats, tables, inline controls, links, and mislabeled preview images during rich copy and paste.

### Patch Changes

- b360c3c: Paragraph spacing-after no longer counts toward the page-fit decision: a line that fits stays on its page and trailing space clips at the boundary, so an oversized `w:after` (the signature-block idiom) no longer mints blank trailing pages. Fixes #615.
- 845e38f: `AUTONUM`, `AUTONUMLGL`, and `AUTONUMOUT` fields now paint a synthesized sequential number (one counter per kind, in document order, with `\*` format switches and `\e`) instead of nothing, and `REF` number switches resolve against bookmarked auto-numbered paragraphs. Fixes #618.
- fe26cd4: Numbered lists inside text boxes in table cells and headers stay correct after a numbering edit. Headers no longer keep stale list markers or images. Fixes #622
- 16966b2: Keep a footnote whole with its reference: a note that cannot fit below its reference line moves to the next page with the line instead of splitting mid-sentence or trailing its reference as an unmarked continuation. Fixes #627
- 2d7dc10: Price the `w:keepNext` group-height lookahead at the placed column's width, so a keep group in a section with unequal explicit column widths breaks on the correct block. Fixes #623
- 346f7e6: Layout no longer eagerly measures per-character caret edges for every laid span; caret and hit-test positions are measured on demand through the same measurer, and the selection-rect APIs accept an optional measurer for exact intra-span edges. Repagination after a page-boundary edit costs about a third of before. Fixes #632
- 5cf6f08: Re-break a renumbered list paragraph when its wider ordinal overflows the hanging indent, so the first line moves to the next tab stop instead of keeping its pre-renumber position under the marker.
- 7ea84c3: Hyperlinks inside footnotes and endnotes now resolve their relationship ids against the notes part's own relationships instead of the body part's. Fixes #637
- e268614: Typing in a paragraph that carries a footnote reference no longer re-lays every note story in the document, and unchanged footnote pages keep their identity across passes so the painter keeps their DOM. Fixes #631
- 8107826: Body `PAGEREF` fields now compute the page number of their bookmark target at pagination time and refresh on save, so table-of-contents page numbers stay correct after edits and in exported files. Each field is calibrated against its authored cache; unsupported switches or a missing bookmark keep the cached result. Fixes #617.
- 0a6e44c: Resolve the REF `\t` switch and NOTEREF fields live from the document's numbering, so those references track edits instead of painting stale cached results. Fixes #612.
- 72ff41f: Footnotes taller than the remaining page now start on their reference page, share it correctly with other references, and release their space when drained, so footnote-heavy documents paginate at the correct density. A `w:cantSplit` table row taller than the band a footnote reserve leaves now takes the full page instead of failing the layout. Fixes #608.
- 8506a62: Numbered paragraphs now inherit the list id through the style chain when a style sets only the level, so multilevel heading numbering in legal templates renders. Fixes #600.
- 0d782e3: Invalidate a table's cached break correctly when drawing layout moves between its cell paragraphs: the drawing-token aggregate now preserves paragraph position instead of sorting, so two different token assignments can no longer alias. Fixes #626
- 7e85377: Declare the Node floor the text shaper needs (`^20.16.0 || >=22.3.0`) so an installer reports it before a run fails. Fixes #595.
- @docx-editor.dev/i18n@2.13.0

## 2.12.0

### Minor Changes

- 531759c: Paint theme-coloured DrawingML shapes and grouped vector graphics.

### Patch Changes

- 40699c8: Keep note overflow sheets in separate page rectangles after insertion. Fixes #513.
- 31780e5: Every authorable op kind and every accepted property, image-wrap, and content-control variant is now proven to replicate through collaboration by a journal replay-convergence fixture, or declared not-expressible with a reason. Adding an editing capability without one fails the coverage gate.
- 4c2c119: A collaborative edit that moves an existing node while changing its content — a hyperlink inserted across a tracked-change run — now replicates the change instead of duplicating the old text on every receiving peer. Fixes #557.
- 3755b98: Combine style toggle properties per level of the style hierarchy, shape small capitals with matching advances, and draw one frame around consecutive identically bordered paragraphs in a table cell. Fixes #505.
- 8fe5920: A relationship, content type, or extra part written through a transaction's `applyPackage` now survives into the package, the save, and one shared undo unit with the story edit, instead of replicating to peers while vanishing from the author's own document. Fixes #558.
- fe3b8a3: Pasting rich content into non-empty documents no longer degrades to plain text or inserts Word's macOS preview image. Word headings, captions, and image dimensions now retain their source semantics and physical size.
- @docx-editor.dev/i18n@2.12.0

## 2.11.0

### Minor Changes

- e4872fb: Replicate a cross-paragraph collaboration selection as an anchor and a head address.
- 1542e73: Fix toolbar and menu bar popups rendering behind the open navigation pane. Fixes #522
- 40578c6: Add a format painter: the `format.painter` toolbar slot, `copyFormatting` and `pasteFormatting` commands, `Ctrl+Alt+C` / `Ctrl+Alt+V` (`Command` on macOS), and Copy formatting / Paste formatting rows on the right-click menu. Clear formatting now leaves a paragraph alone when the selection only ends at its start. Fixes #519
- e4872fb: Add a provider-neutral collaboration port and session contracts so the editor can attach a replication implementation without importing a CRDT or transport.
- e4872fb: Share table-cell and header selection presence as two endpoints plus an optional cell kind.
- af77c9b: Tables match Word's default cell metrics: a table that names no style resolves the document's default table style, cell margins fall back to Word's own values, the paragraph Word writes to close a cell after a nested table takes no height, and a single-spaced line box includes the font's line gap. `StyleCascadeTable` gains `defaultTableStyleId`, and `DEFAULT_CELL_MARGINS` is no longer a uniform 3pt.
- dfaafc0: Live collaboration now reports every failure a room can reach, including a session that fails after connecting, and presence chrome finds its session through the editor rather than a prop. Adds `DocxEditorCollaborationRoot` for mounting a room and `readCollaborationDocument` for reading one on a server.

### Patch Changes

- e4872fb: Allocate bookmark ids per collaboration actor so concurrent table-of-contents edits cannot mint the same id.
- e4872fb: Give each picture its own `wp:docPr` id when two people insert an image into the same document at the same time, so Word no longer renumbers the drawings when it opens the merged file.
- e4872fb: Allocate revision, comment, relationship, bookmark, and numbering ids per collaboration actor so concurrent peers no longer mint the same id from a shared snapshot.
- e4872fb: Keep both footnotes when two people add the first one to the same document at the same time, so neither author's note becomes unreachable after the edits merge.
- e4872fb: Give each paste its own bookmark, revision, and `wp:docPr` ids when two people paste into the same document at the same time, so the merged file keeps every marker, tracked change, and drawing addressable on its own.
- e4872fb: Allocate table-of-contents bookmark names and content-control ids per collaboration actor so concurrent peers cannot mint the same value.
- e4872fb: Headless automation writes now publish to a collaboration replica before the call returns, so a script that edits and then reads a peer no longer sees the document as it stood before the edit.
- e4872fb: Insert Picture and Replace Picture now mint their `wp:docPr` and relationship ids under the collaboration actor, so two people adding an image to the same document at the same time no longer produce colliding ids. A single author still gets Word's dense numbering.
- e4872fb: A rich clipboard paste now replicates story content and imported package resources to collaboration peers.
- e4872fb: Attach a collaboration session after the editing surface finishes mounting, so a session no longer fails to start and report an error status.
- e4872fb: Comments, tracked-change decisions, tables of contents, and custom nodes now replicate while a collaboration replica is attached, so those writes are no longer refused.
- e4872fb: Comment writes now replicate the comments part, relationship, and content type to collaboration peers.
- e4872fb: Add the `create-or-join` collaboration bootstrap: every peer opens a room with the same options, the first peer seeds it and later peers join it, so hosts no longer decide out-of-band which peer creates the room. A room that two partitioned peers seeded concurrently reports the new terminal failure code `concurrent-seed` on every replica; recover by creating a new room from saved bytes.
- e4872fb: Concurrent first-create of a customXml store keeps both custom nodes on collaboration peers.
- e4872fb: Give each review author slot its own hue, so two authors no longer read as the same colour.
- 2015f33: Grow a vertically merged cell by one row when you insert a row inside its span, instead of breaking the merge and shifting the grid. In a merged table, a row that holds a cell inside a content control refuses the insert rather than marking the wrong column. Fixes #57.
- e4872fb: Minted external hyperlink relationships are indexed in both `relationships` and `externalTargets`, matching the shape after save and reopen.
- e4872fb: Image insert, list numbering, and hyperlink minting now replicate to collaboration peers instead of staying local.
- e4872fb: A collaborative replica now rebuilds only the nodes a received edit names, keeps the rest of the document by identity, and revalidates only the parts that changed.
- e4872fb: Joining a collaboration room keeps inline images, and the image selection frame sits on the selected drawing.
- e4872fb: Typing in a large document with a collaboration replica attached no longer costs a scan of every node id in the part on each edit, so an attached editor now runs at close to solo speed.
- e4872fb: Add an `offlineEditing` option to the collaboration factories and hooks: a disconnected replica keeps accepting local edits, and the buffered updates merge on reconnect.
- c4b4dab: Minify the shipped `dist/editor.css`, which halves it from 212 KiB to 109 KiB.
- e4872fb: Keep a queued collaboration edit when a remote update arrives during it, and flush each document's queue independently so two documents in one process no longer strand each other.
- e4872fb: Resolve collaboration presence addresses without scanning the document, so remote carets no longer slow down typing on long documents.
- e4872fb: Remote carets now follow a collaborator's typing instead of stopping at the last place they clicked.
- e4872fb: Remote presence highlights now measure only visible pages, so a large remote selection no longer walks the whole document on every keystroke.
- e4872fb: Rejected tracked deletions restore ordinary run text on collaboration peers, and custom-node create-part writes now carry their content-type overrides.
- e4872fb: Receiving a collaborative edit now costs the size of the edit instead of the size of the document, and a received keystroke reaches layout as the same paragraph-scoped change a local one does.
- e4872fb: Review chrome no longer commits queued typing while it reads, and a missing image at paint time shows a placeholder instead of throwing.
- d11816f: A cell merged over several rows now takes the height of the rows it covers instead of loading all of it onto the row it starts on, so the rows beside it keep their own heights and shading. A `w:cantSplit` row holding such a merge can now split across a page rather than failing the table's layout. Fixes #504
- 0d770d9: Header and footer variants resolve per page, so a title page with no first-page header starts its body at the top margin, and a sheet added for note overflow takes the variant its own page number resolves. `PAGE` and `NUMPAGES` fields evaluate the `\#` numeric picture switch instead of painting the result cached in the file.
- @docx-editor.dev/i18n@2.11.0

## 2.10.0

### Minor Changes

- 79170d8: Add continuous section breaks: `insertBreak` takes a new `sectionContinuous` kind, and the Insert > Break > Section break (continuous) menu row is live. A next-page break cut from a continuous section now really starts a page.
- 56848c8: Add an Image row to the packaged Insert menu that opens the shared file picker, and scale an inserted image down proportionally when its natural size does not fit its cell, column, or page content box. Fixes #276
- 8ac2e88: Word-like copy and paste: copy writes plain text plus HTML with an embedded document fragment, and paste restores styles, lists, tables, links, images, and footnotes — inside the editor and from external HTML. Adds a `pasteWithoutFormatting` command (Ctrl+Shift+V) and an optional `html` payload on `paste`.
- 0e3663d: Suggesting mode records a formatting change as a tracked change instead of applying it outright, so a reviewer can reject it and get the previous properties back. Formatting also reaches the same runs through the toolbar and the automation object model, and only the runs the current view shows. Fixes #495, fixes #497, fixes #498

### Patch Changes

- 99c7408: Press Enter at the end of a paragraph, and the new paragraph takes the style's `w:next` the way Word does, so a heading is followed by body text instead of a second heading.
- ab81336: Remove leftover stylesheet rules for class names the painter no longer emits, and restore the text cursor over the page content area. Fixes #239
- 0928951: Mark a drawing inside a tracked insertion or deletion with a revision outline, the standard revision datasets, and a margin change bar; a deleted picture stays visible and dimmed under all-markup and disappears from the proposed result. In suggesting mode, inserting an image proposes a tracked insertion, deleting a selected image proposes a tracked deletion, and Delete on a pointer-selected picture deletes the picture instead of the paragraph break beside it. Fixes #479
- b10d396: Run formatting (bold, italic, font family, font size, color) now applies to text inside tracked changes; it previously did nothing over runs wrapped in `w:ins` or `w:del`. Fixes #493
- 0e3663d: Double-clicking either half of a tracked replacement now selects that half. A word no longer runs through struck text, which Word paints immediately before the text proposed to replace it.
- @docx-editor.dev/i18n@2.10.0

## 2.9.2

### Patch Changes

- 541e16f: Reduce per-keystroke latency on documents with footnotes or endnotes: mutation-path note-reference scans reuse per-subtree results instead of re-walking the whole package.
- d459c9b: Refresh header and footer pages when a picture that a text box clips out of the baseline layout finishes decoding, so a page-specific projection of the box no longer keeps a loading placeholder. Fixes #467
- 88935e6: Smart text substitutions (macOS double-space period, autocorrect) now replace the text they target instead of inserting beside it, and the browser's selection fix-up around them no longer highlights a stale range or moves the caret.
- 3289402: Repaint a header or footer once a picture inside one of its text boxes finishes decoding, so the picture no longer stays a loading placeholder. Fixes #442
- af18283: Fix the image selection overlay keeping the drawing's old frame after a resize, move, wrap, or transform. Image ops now commit through the same layout/paint tail as keystrokes, and multi-section layout no longer republishes a previous pass's sheets for a section that changed inside a balancing or re-run pass.
- e01432d: Drawing selection now follows Word's object-selection rule: a document no longer opens with a drawing selected, typing beside a drawing's anchor no longer selects it, and the selection ring and resize handles align with the image instead of landing outside the page.
- ba2fd94: Reduce input delay while typing into very large documents: when the browser reports queued input behind an expensive layout pass, a keystroke commits in its own task and layout and paint follow in separate tasks, instead of one blocking flush.
- d043089: Reduce per-keystroke latency on very large documents: structural edits no longer re-derive whole-document indexes, and page-field projection reuses unchanged pages.
- a11911c: Fix footnote placement in multi-section documents: a citation on a full page of a later section now reserves space on that page, so the note sits under its citation instead of draining onto the following pages. Fixes #460
- 067cec6: Reduce per-keystroke scan work and memory use on documents with footnotes or endnotes.
- 9716e13: PAGE and NUMPAGES footers on reused pages now update when an edit changes the page count in a single-section document. Fixes #441
- e506262: Speed up typing and document open on large multi-section documents: each keystroke now pays for the edit instead of the document, and documents with footnotes open with one pagination pass instead of two.
- 0d572e0: Render list markers for numbered paragraphs inside anchored text boxes, in the body and in headers and footers, and refresh reused pages when a numbering change moves a marker inside a box. Fixes #466
- 950d5c5: Draw a thinner insertion caret with a translucent contrast ring, so the caret no longer shows a hard outline over highlighted or shaded text.
- bb31f97: Fix tracked replacements over a rectangle of table cells to land in the first cell after its struck content, and allow `proposeReplacement` to span paragraph marks with the same landing rule as typing. Text-carrying proposals (`proposeInsertion`, `proposeReplacement`, and the matching `proposeTextChange` kinds) now refuse empty or newline-containing text instead of committing it. Fixes #459
- da051fc: Suggesting mode now records page field, hyperlink, and footnote/endnote insertion as tracked changes, and an armed caret format survives an IME replacement. Fixes #463
- e568148: Fix replacements over a selection in tracked-changes mode: typing, paste, Enter, tab, breaks, and page fields now land after the struck words with the caret following, instead of reversed or in front of the strike. Multi-line paste now splits its paragraphs inside the tracked insertion, and typing over your own pending Enter merges it instead of doing nothing.
- 263ceb1: Suggesting mode now records inserted tabs, line breaks, and page breaks as tracked insertions, and an armed typing format is no longer dropped when the insert relocates past struck text. Fixes #458
- @docx-editor.dev/i18n@2.9.2

## 2.9.1

### Patch Changes

- 36ea49a: Show selected paragraph marks and empty lines with a small selection block.
- @docx-editor.dev/i18n@2.9.1

## 2.9.0

### Minor Changes

- 686a9d6: Add agent-safe document writing and revision APIs.
  - Add an explicit `original` text projection. Pending deletions remain visible, while pending insertions stay hidden. This matches Word's Original review view.
  - Add the atomic `replaceStoryBlocks` automation operation with stable paragraph identities.
  - Add the DocxEditor `revisionTextView` runtime option outside the Office.js object model.
  - Implement `proposeInsertion`, `proposeDeletion`, and `proposeReplacement` editor commands.

  Projected search ranges map back to editable model offsets and retain their projection for later range reads and searches.

- dfe6d27: Display and edit Word mathematical equations through a bounded linear-math editor.
- 0fb376a: The store entry point now exports the full review-item vocabulary: `ReviewCustomItem` joins the `ReviewItem` union, and `ReviewModelInput` carries the custom-node inputs.

### Patch Changes

- 1b7ce7c: API report snapshots now use a canonical member order, so `api:check` no longer fails across machines; no runtime changes.
- 71052d6: Internal unit-type hardening: twips and points values now carry branded types and share one conversion module, with no behavior change.
- 91d3797: Typing now skips unused note pagination and reuses unchanged document layout data in large documents. Fixes #391.
- 1367058: Typing in a long document no longer rebuilds the review paragraph-order index on every keystroke, and repeated state reads reuse the resolved caret content control instead of re-running the hit test. Replacing a block content-control placeholder now reports the paragraph swap, so review items anchored in the replacement stay activatable.
- 5d08027: Lists now suppress paragraph spacing between consecutive items when converted documents omit the built-in contextual spacing rule.
- 0f09123: List markers now reflow when the numbering level's face or size changes.
- 5fbddee: Keep font, spacing, and alignment menus visible in the responsive toolbar overflow panel.
- fae8055: The note-properties state now refreshes when a shared header or footer is re-entered from a different section, instead of reporting the previously opened section's numbering.
- 865637a: New ordered lists now start at one instead of continuing an earlier disconnected list.
- 808ffac: Typing in a multi-page section keeps the section's untouched sheets identical across passes, so paint skips them, and repaints no longer walk the whole document to collect drawing keys.
- abd2d27: Selection writes in a repeating table header now land on the page the user is looking at, so copy and typing no longer target the first painted copy.
- 94ec84e: Plain horizontal arrow keys now collapse a text selection to its start or end without moving one extra character.
- 44f11db: The editor snapshot now notifies subscribers when `hasReviewContent` changes.
- 03262fc: Review author colours now remain stable while you edit, remove, and undo comments or tracked changes in an attached document.
- 2704c4d: Speed up large-document typing by caching paragraph, section, list, and content-control lookups so keystrokes avoid repeated full-document walks.
  - @docx-editor.dev/i18n@2.9.0

## 2.8.0

### Minor Changes

- 5ae7f4d: A blank document now ships Word's built-in style gallery, so the style picker offers Heading 1 through Heading 9, Title, Subtitle, Quote, No Spacing, and List Paragraph. Turning a list on applies List Paragraph the way Word does, which closes the space between consecutive items and leaves the paragraph indented when you turn the list back off.
- 91fc4c8: Add `insertContentControl`, so an open editor can create a content control as well as fill and remove one, as a single undoable step.

  A collapsed selection inserts an empty control showing its type's prompt, the way Word does, and the first character typed replaces the prompt whole. The same position now works through the automation protocol, which refused it before.

- 91cb3e0: Added the Paragraph dialog, which sets alignment, indentation, spacing, line spacing, tab stops and the pagination flags by value as one undo step. Open it from **Line spacing options…** on the line-spacing menu, or drive it yourself with the new `setParagraphFormat` command and `useParagraphFormat` hook.
- dab6700: `selectionRects` and `spansInSelection` now require the story's paragraph order as a third argument, so a two-argument call no longer compiles. Pass the new `everyStoryOrder(layout)` when you have no story in hand: the body-only order they used to assume is what made `spansInSelection` read a selection in a header, footer or note as empty. `selectionRects` still walks body fragments only, so it returns no rectangles outside the body whichever order you give it.
- dab6700: `PaginatedSurface` gains `sectionAnchorParagraphAt` and `sectionAtPage`, `TreeDocxSessionView` gains `storyParts`, and `PlacedCell` gains `offsetX` and `offsetY`. All three are produced by the engine and consumed by hosts, so this is additive for callers.
- dab6700: Editing in a header, footer, footnote or endnote now behaves as it does in the body: lists, tables, content controls, page setup, formatting and indent all act on the story the caret is in, and every story's paragraphs are addressable by anchor. A comment authored in one of those stories is now related from the main document, so Word can see it. Pointer chrome follows too: content control outlines and the hyperlink popover resolve in the story they are painted in, and table row and column handles are offered in the story you are editing.

### Patch Changes

- ac5ec3f: Fixed bordered paragraphs drawing a separate box each instead of one box, in a section whose columns have different widths.
- 130ba52: Fixed bordered paragraphs drawing the wrong edges, and pages breaking in the wrong place, after you edited a bordered run. Fixed a refreshed table of contents losing its empty-TOC placeholder line until you reopened the document.
- 5ae7f4d: Fixed list items and other same-style paragraphs not closing up until you reopened the document.
- 7a58fb2: Fixed IME text being dropped when you compose into an empty paragraph, and fixed a composition deleting an inline image or hidden text elsewhere in the same paragraph. Composing over a selection that spans two paragraphs now replaces the whole range in one step. Text in a header, a repeating table header row, or a footnote referenced twice no longer duplicates when you compose into it.
- dab6700: A document protected with `w:documentProtection w:edit="forms"` now refuses edits in headers, footers and notes as it already did in the body. Form fields in those stories stay fillable.
  - @docx-editor.dev/i18n@2.8.0

## 2.7.0

### Minor Changes

- 010a327: Fixed paragraph formatting controls reading a paragraph's document defaults instead of its own formatting, which left "Add space before/after paragraph" with no effect on the page. `PaginatedDocxEditorHandle.setParagraphProperty` takes an `options.mergeAttributes` flag so a line-spacing pick keeps the paragraph's spacing. Fixes #360

### Patch Changes

- 4c907ed: Fixes a group of caret and scope defects: undo after editing a header no longer leaves the editor unable to type, opening a header while a footnote is open no longer refuses every keystroke, inserting a footnote over a selection replaces it instead of destroying the note on the next keystroke, redo puts the caret where the redone edit ends, resolving a tracked change keeps the caret on the text it was in, accepting the deletion of a table's only row removes the table, a selection ending at a field no longer collapses, Backspace after a table is a quiet no-op instead of a dropped keystroke, and the paragraph, delete-row and delete-column commands act on every cell of a selected rectangle.
- 447d983: Fixed the caret jumping back to the start of a header or footer after each character typed. The `change` event's revision and `getDocumentHandle().revision` now rise for every edit, including one made in a header, footer or note, and an explicit table target is no longer refused as stale after such an edit. Fixes #361
- 047b2c6: Entering a header or moving between shared header copies no longer rebuilds every visible page. The active band is retinted in place.
- 4c907ed: Typing no longer rebuilds every visible page. A document carrying a footnotes part — which is nearly every file Word writes, even with no notes in it — discarded every page record on every layout pass, and pressing Enter in a list re-measured every paragraph in the document.
- 25235c1: Pressing Enter or Backspace in a large multi-section document no longer re-lays the whole document; layout now reuses unchanged sections and whole pages shifted by the edit, and typing latency in 500+ page documents drops sharply.
- 25235c1: Typing in long documents with footnotes gets faster again: the notes pass reuses per-page footnote areas, reserves, reference hits, and mark contexts across keystrokes when nothing note-related changed, instead of re-deriving them for every page on every edit.
- 25235c1: Typing in a long document repaints only the paragraph that changed, instead of rebuilding whole pages: pages keep their identity when content controls or page-level indexes have not moved, and the document-wide indexes the toolbar and review rail read are now built per page and reused.
- 4c907ed: Typed characters now stay in order after a repaint. A repaint that followed an edit could read the browser's own selection back as the paragraph start, so the first character landed and every one after it was inserted in front of it.
- 4c907ed: Backspace now takes back a paragraph break you proposed a moment earlier, instead of proposing to delete your own proposal. Enter then Backspace in suggesting mode left an empty paragraph behind and two entries in the review pane.
- 4c907ed: Typing over your own pending suggestion now replaces it. The keystroke was refused and silently dropped, because a suggestion the same author retracts leaves the paragraph instead of staying struck in place.
- 25235c1: Typing latency in very long documents drops further: layout reuses each unchanged section's whole prepass, list numbering, font catalogs, drawing scans, and note-mark projection reuse memoized answers across keystrokes, and shaped text measurement stops rebuilding string keys per probe.
- 4c907ed: Fixes four write lanes that had drifted from the rules the others follow: Enter inside a tracked insertion now breaks the paragraph at the caret, a table inside a header or footer can be deleted, IME text in suggesting mode is proposed rather than written, and a multi-line paste proposes its paragraph breaks and leaves the caret after the pasted text.
  - @docx-editor.dev/i18n@2.7.0

## 2.6.1

### Patch Changes

- @docx-editor.dev/i18n@2.6.1

## 2.6.0

### Minor Changes

- 56bb68f: The font compatibility notice no longer reports a document that renders no text, or a family whose metric-compatible substitute is available on the platform.
- 622c4f9: `document` and `load()` now accept `'blank'` for an empty document. Omitting `document` still means no document at all, which holds the editor on its loading screen with every control disabled. Fixes #275
- c6529c8: ESM browser builds no longer fail with `Module not found: Can't resolve 'module'`, and the new `setHarfBuzzWasmUrl` points bundlers that emit no WASM asset (esbuild, Bun) at a self-hosted `harfbuzz.wasm`. Server-side shaping over ESM now needs Node 20.16 or 22.3 and later. Fixes #282
- 0452f9c: Opening a review card no longer selects the change's text: the caret moves to the start of the range and the card's own highlight marks it, so the reader keeps whatever they had selected. Read `item.ranges` (revisions) or `item.range` (comments) for what a card is about, rather than the selection after `setActive`.
- 0652ae4: Replace `PaginatedSurface.session` with the PM-free `TreeDocxSessionView` and remove unsupported projection methods from the public editor surface.
- 9a64477: Tracked changes are now colored per author by default, the way Word shows them, and review cards carry each author's color. Mount `DocxEditor.AuthorStyle` to give a named author their own color, background, class names, or avatar, or `DocxEditor.ColorByChangeType` to keep the previous green-and-red rendering.

  Comment authors share the same colors, and every element with an author — painted spans, comment highlights, cards, balloons, and markers — carries `data-review-author` and `data-review-author-slot`. This renames the painted span's `data-revision-author` and the `--doc-review-author` custom property, which is now `--doc-review-author-current`; update any CSS that used the old names. Read the roster with `useReviewAuthors()` or `editor.getReviewAuthors()`.

- 008243e: Viewing mode no longer offers write affordances it refuses: the header and footer hover invitation, content-control widgets, image resize handles, and the custom-node and comment context-menu rows. Content-control edits are now refused in viewing instead of committing.

### Patch Changes

- 7e59774: The caret now moves freely through tracked-deleted text, one character at a time, as Word does. Text typed with the caret inside a deletion lands beside the deletion instead of corrupting it.
- 3c80f4f: Fix inter-word gap painting on lines that merge two paragraphs in a resolved revision view: a drawing in one half no longer shifts or doubles gaps in the other half.
- 3c80f4f: Fix the selection highlight in justified paragraphs: the band is now continuous across stretched inter-word spaces instead of breaking into one block per word. Underline and character shading also continue across those spaces, as Word draws them.
- bc614bd: Anchored images in the document body now keep their place when a header or footer is taller than its margin. A page-relative image was pushed down the page by the header height, and a bottom-margin-relative one followed an oversized footer. Fixes #274.
- 1ce2f55: Resolved comment miniatures now show a hover fill, and the reply field shows a focus outline.
- 887f67f: Viewing mode refuses every path into header and footer editing, not only a double-click, and a document opened in viewing no longer comes up with an editable pages layer.
  - @docx-editor.dev/i18n@2.6.0

## 2.5.0

### Minor Changes

- d905af3: PAGE, NUMPAGES, and SECTIONPAGES fields in the document body (and body tables) now render the page number, document page count, or section page count when the field has no cached result, instead of showing blank.
- 5c65a88: Opening a large document now shows a loading screen instead of freezing the page: the engine mounts it behind one painted frame, `snapshot().isOpening` reports that window, and `DocxEditor.Loading` gains an `overlay` variant that the packaged React frame mounts by default.
- d905af3: Document-property fields (TITLE, AUTHOR, SUBJECT, KEYWORDS, LASTSAVEDBY, COMMENTS, and DOCPROPERTY for those names) now render their value from the document properties when the field has no cached result, instead of showing blank.
- d905af3: HYPERLINK field links now work with the link popover the same way typed links do: the popover opens read-only over one, Ctrl/Cmd+K reaches it, and it dismisses when the caret leaves the field. Two adjacent HYPERLINK fields that point at the same target now render as two separate links.
- 346cc78: Tracked changes on a paragraph mark now reach the page and the review pane: every decision on a mark is read rather than the first, a paragraph moved whole raises a card and resolves, a format change on the mark is published, a mark inside a table cell is drawn, the margin gets its change bar, and a resolved view draws no attribution. Renumbering a list or a footnote, and every field a fragment publishes, now take part in incremental layout reuse, so a reused page no longer shows a value the document has moved past.
- 289a7a1: Clicking a tracked-change card now opens that card, and text one reviewer inserted and another struck opens the deletion, as Word reads it.
- 5a2f3ed: A review card for a paragraph break now says which change it is. A deleted break read as "Inserted paragraph break", which is the reverse of what accepting that card does, and both halves of a moved paragraph read the same way.
- 5a2f3ed: The resolved display modes now merge the paragraphs their decisions merge, in the body, in table cells, and in headers and footers: a paragraph whose mark a tracked change deleted runs into the next one in the final view, as it does in Word and as accepting the change already did. Accepting a run of deleted paragraph marks also collapses them into one paragraph rather than into pairs, and no longer carries content past a table or a content control.
- 266a086: The `mode` option accepts `'suggesting'` and now decides the mode a document opens in; the React and Vue `<DocxEditor>` components default it to `'edit'`, so a document carrying `w:trackRevisions` opens ready to type there. Omit `mode` on `createDocxEditor` or `DocxEditor.Root` to keep following the document's request.
- d905af3: SYMBOL, MACROBUTTON, and GOTOBUTTON fields and w:sym symbol runs now render, legacy FORMCHECKBOX and FORMDROPDOWN fields paint their w:ffData state, and PAGE-family fields nested inside other fields evaluate per page. HYPERLINK fields are clickable links with the same target sanitization as typed hyperlinks.

### Patch Changes

- f3e5d58: Keystrokes arriving in a burst now land as one transaction and one layout flush instead of one per character, so fast typing in long documents stays responsive; a burst is also one undo step and one tracked change.
- 192c644: Pasting from an application that offers only an HTML flavour now recovers its text more faithfully: an attribute value holding a `>` no longer truncates the paste, unterminated markup is no longer pasted as literal text, and a very large table no longer blocks the page. Reading a document's content types no longer uses a pattern a crafted file could make backtrack.
- f811b44: Memoize package snapshots, section enumeration, and list resolution so a keystroke in a long document no longer rescans the whole tree; typing in large documents is significantly faster.
- 4a57eed: Update harfbuzzjs to 1.6.0 (HarfBuzz 14.3.0). Shaping output does not change.
  - @docx-editor.dev/i18n@2.5.0

## 2.4.1

### Patch Changes

- @docx-editor.dev/i18n@2.4.1

## 2.4.0

### Patch Changes

- @docx-editor.dev/i18n@2.4.0

## 2.3.1

### Patch Changes

- 1c9b6a2: Long documents now reuse pagination after explicit page and section breaks, avoiding full-document work for ordinary typing, wrap-inducing edits, and character, word, line, vertical, or document-edge caret movement. Rapid typing preserves input order while coalescing pending page, toolbar, and review-rail refreshes, and repeated tracked deletions stay compact instead of adding one OOXML run per keypress.
- 1c9b6a2: Rapid typing no longer reorders characters when a deferred paint leaves the DOM caret behind the model. Native and touch carets that return to that leftover offset still edit there.
  - @docx-editor.dev/i18n@2.3.1

## 2.3.0

### Patch Changes

- @docx-editor.dev/i18n@2.3.0

## 2.2.1

### Patch Changes

- 35f6d04: Fix exported comment replies opening as separate comments instead of a thread in Microsoft Word.
  - @docx-editor.dev/i18n@2.2.1

## 2.2.0

### Minor Changes

- 3096225: The document now fits its container by default, so a narrow window shrinks the page instead of overflowing it and opening the comments pane shrinks the document rather than pushing it off screen. Drive it with `Editor.setZoomMode` or React's new `useZoom` hook, and pass `zoomMode={{ type: 'fixed' }}` to keep the old behavior.

### Patch Changes

- 9c25492: Keep legacy FORMTEXT result text editable with character-accurate caret and selection offsets.
- 04c2379: Programmatic selections made while embedded fonts load now keep their range and visible highlight after the shaped-font remount.
- f0e4ab9: Tracked changes on a field's result now render as tracked. A deletion or insertion around the value of a cross-reference, page number or form field previously painted as ordinary unchanged text, so a reviewer saw no strikethrough or author colour on an edit the review sidebar was reporting correctly. A paragraph containing such a field also measured longer than what was laid out from it, which put the caret and the keystroke at different offsets — clicking after the field placed the cursor in one place and typing appeared in another. `w:fldSimple` now paints its cached result instead of blank space, allowlisted PAGE/NUMPAGES/SECTIONPAGES nested inside a non-page simple field evaluate per sheet rather than reusing the saved cache, and field results carry Word's grey field shading — always for legacy form fields unless the document sets `w:doNotShadeFormData`, and per the new `fieldShading` option (`never` / `when-selected` / `always`) for the rest.
- Updated dependencies [568ccf7]
  - @docx-editor.dev/i18n@2.2.0

## 2.1.3

### Patch Changes

- @docx-editor.dev/i18n@2.1.3

## 2.1.2

### Patch Changes

- efd3d76: Menus and popovers now paint above the editor's own furniture. Toolbar dropdowns, the menu bar, colour pickers and the hyperlink popover sat at a lower z-index than the navigation gutter and table chrome, so opening File put the menu underneath the navigation toggle. Layering is now three `--doc-z-*` tokens (`chrome`, `overlay`, `context`) rather than a dozen hand-picked numbers.
- 69a97f3: `setActiveReviewItem` and `useReview().setActive` take a `reveal` option, so a host can choose where an activated change lands instead of taking the engine's default: `'start'`, `'center'`, `'centerIfNeeded'`, `'nearest'`, or `false` to select the item without moving the viewport at all.
- ede69f6: Activating a review card now reports whether it landed. `setActiveReviewItem` returns an `ExecResult` and `useReview().setActive` a boolean, so a host walking the queue with next/previous controls can tell a step that did nothing from one that worked — activation is refused for an unknown key, an item with no range, a story that will not open, and a revision kind the rail excluded. Review items carry a matching `activatable` flag, so a card that cannot be clicked can be drawn that way instead of discovering it on click.
- 802ab3e: The collapsed review rail now draws a glyph for what each marker actually is — an insertion, a deletion, a formatting change, a comment or a custom node — instead of one comment bubble for every kind. A custom node names its own through `reviewCard`'s new `icon`, and the `Markers` part takes an `icon` of its own for a host that wants to draw all of them itself.
- 4fa91bd: The painted-document rules are now scoped to the editor. Around a hundred `.layout-*` and `.paged-editor*` selectors shipped unscoped, so a host with its own `.layout-page-header` or `.layout-page-content` had those elements restyled by the editor's stylesheet. The class names are unchanged; only the rules moved under `.docx-editor`. The stylesheet guard now exempts `.docx-` alone, so nothing else can ship unanchored.
- 4fa91bd: The y-prosemirror remote-cursor styles are now scoped to the editor. `.ProseMirror-yjs-cursor` is y-prosemirror's class name rather than one the engine mints, and it shipped unscoped, so a host running its own ProseMirror editor with Yjs on the same page had its remote cursors restyled. The stylesheet guard no longer treats `.ProseMirror-` as an engine-owned namespace.
  - @docx-editor.dev/i18n@2.1.2

## 2.1.1

### Patch Changes

- d74c5d6: Jumping to a tracked change or a selection now lands on it: the reveal was measuring caret geometry against the top of the sheet rather than the page's content box, so every jump stopped one page margin short and left the target just under the fold. Reveals that have to travel now centre their target instead of stopping the moment it clears the bottom edge, and one that is already on screen still does not move.
  - @docx-editor.dev/i18n@2.1.1

## 2.1.0

### Minor Changes

- a9fd363: BMP and WebP images now render instead of showing an unsupported-format placeholder.
- 3310029: Custom nodes can carry a payload larger than the 64-character `w:tag` cap, in a customXml data part an SDT binds to, with a sweep that collects payloads whose control was deleted and a removal that leaves no record of the store for documents exported outside the system.
- d116599: Custom nodes can be inserted, updated and removed inside a header, footer or note, including a node carrying a payload: the control lands in that story while its customXml store stays on the main document part, where Word looks for it. Which story a write targets now comes from the node or paragraph id rather than from wherever the reader happens to be, so a caller can address a node in a story it has left. Inserting, updating and removing all refuse a document open for viewing instead of editing it — these writes go through the store, below the editing-mode gate — and report the same `locked` code the engine's own refusal uses.
- dbf5501: Every remaining `ep-` prefixed CSS class and keyframe is renamed to `docx-editor-`, so the whole stylesheet shares one namespace with the `.docx-editor` root class. If your own CSS targets an `.ep-*` class or the `ep-caret-blink` keyframe, switch it to the same name under `docx-editor-` (`.ep-one-surface__caret` becomes `.docx-editor-one-surface__caret`).
- 8b4830e: Review navigation now goes where it says it does: activating a card selects the item's whole range and scrolls to it even when your own UI holds focus or the target page is not yet materialized, walking from a header change back to a body change leaves the header story so the body card activates again, and the `setSelection` command reveals its target. New `setReviewActivationExclusions` lets a host rail tell the engine which revision kinds it hides, so clicking tracked text never opens a card the rail does not render.
- 7a72c42: Tracked changes and comments inside footnotes and endnotes now reach the review queue. They get cards with real geometry, `getTrackedChanges` names the story holding them, the caret can make one active, opening a card enters that note, accept and reject resolve against the note's own part, and a note card can be replied to — commenting anywhere after a note reference was refused before, because the offset walk counted note marks as no characters. Commenting outside the body works the same way: a range selected in a header, footer or note offers the affordance and the comment lands in that story. `focus(scope)` honours its argument, and a scope it cannot open is refused without first closing the story the reader had open.
- 43c3e6a: The shipped stylesheet is now precompiled and fully namespaced: every Tailwind utility, editable-surface rule and keyframe is scoped under the renamed `.docx-editor` root class (previously `.ep-root`), so the CSS no longer collides with a host app's Tailwind setup and styles the chrome correctly in hosts without Tailwind. If your own CSS targets `.ep-root`, switch it to `.docx-editor`.
- d793994: TIFF images now render instead of reserving their extent behind a placeholder. The image decode port's `convertMetafile` hook is renamed to `convertPreserved` and receives TIFF alongside EMF and WMF.

### Patch Changes

- d793994: The caret now carries a contrasting ring, so it stays visible against dark content. Clicking beside a dark image, or arrowing onto the line one sits on, no longer leaves the insertion point invisible.
- 6dee1e3: Comment markers now land on the character they were asked for in paragraphs holding a drawing, a field or an inline content control, and a comment can be anchored inside a content control at all. The comment writer measured those paragraphs with a walk of its own that counted such elements as nothing, so commenting near one was either refused outright or, worse, placed the marker silently on the wrong character. A marker at the far edge of a complex field is also placed after the whole field rather than among its parts, where Word would drop it on the next field rebuild.
- f4eac0c: Update fast-xml-parser to 5.10.1.
- b3e3457: Pin the node and mark name unions on `treeSchema` so the generated type declaration is identical between builds.
- 7dce3ba: Keep sub-1pt drawing extents at full paint height so Word's hairline form-rule bars stay visible instead of shrinking to a sub-pixel clip.
- a758db1: Fix images in a header or footer staying on the loading placeholder forever. The picture decodes, but the page kept the furniture it was laid out with, so it never showed.
- 42406bc: Header and footer ink now overflows its band like Word instead of being clipped: anchored shapes offset past the content width or below the header text stay visible, and negative indents hang into the margin. Overflowing shapes stay inert until the band is edited, so they never swallow clicks meant for the body.
- d793994: Fix a band of blank space under an inline image in a paragraph using multiple line spacing. The multiple now scales the text line, as Word does, instead of the image's own height.
- d89ef55: Stop binding Cmd+R for right alignment on macOS: the browser reserves that chord for reload, so the old binding re-aligned the paragraph and the page still reloaded. Right alignment stays on Ctrl+R on every platform.
- d56b1a5: Speed up the document pipeline on long documents: opening, laying out, editing and saving a 500-page document is roughly a third faster end to end, and unchanged-document layout passes drop by more than half. Parsing, validation, layout keying and serialization now avoid recomputing facts already proven for unchanged, immutable nodes; no validation or security bound changed.
- 34be525: Apply Word's automatic paragraph spacing when `w:beforeAutospacing` or `w:afterAutospacing` is set, instead of the measurement the flag replaces. Documents written by Word's HTML filter carry it on every paragraph and were laid out 9pt tight per boundary, which moved page breaks.
- 765e617: Stop applying paragraph-mark `w:pPr/w:rPr` font size to content runs that inherit the paragraph style. Mark formatting still sizes empty lines and last-line mark height.
- 113ed44: Tracked changes from other editors now coalesce the way Word shows them: adjacent same-author deletions or insertions merge into one review card, and a deletion meeting an insertion pairs into a single Replaced card regardless of how far apart their timestamps are.
- 3f70246: Speed up comment and tracked-change derivation on heavily reviewed long documents: re-reading the review queue over an unchanged document is ~25x faster, and the re-derive after an accept, reject, comment write or undo drops by more than half. Derivation semantics are unchanged.
- 8b4830e: Review and navigation now land in the story they name: accepting or rejecting a header or footer card leaves the caret inside that story instead of throwing it into the body (after which every keystroke was silently refused), replying to a header or footer card writes into that part instead of being refused, and jumping to a body search hit or outline heading leaves an open header or note first.
- 585413d: Fix caret and hit-test drift on lines containing superscript or subscript text. The shaped measurer rounded the reduced super/subscript size to a whole half-point, measuring those runs up to 3% wider than they paint; the caret landed mid-glyph for the rest of the line.
- cc82d50: Pictures inside footnotes, endnotes and text boxes now render. They previously painted nothing at all, not even a placeholder.
- ec538fa: Fix suggesting mode dropping text typed at the start of a paragraph that carries properties, which made the keyboard look dead in the item Enter had just opened. An empty list item's marker also no longer paints over the item above it.
- 45c9b93: Anchored text boxes now render their content clipped inside the shape's extent in the body, headers, and footers, with PAGE / NUMPAGES / SECTIONPAGES fields inside header/footer text boxes evaluated per page. Editing a header or footer whose direct content is nearly empty now shows a full-height edit band instead of a hairline.
- 0a62c6d: Typing in a tracked table row no longer drops that row's tracked-change card, so the row insertion stays acceptable and rejectable.
- e215962: Trailing tabs no longer start a new line, so a header authored as tabbed columns keeps its own height and stops pushing the body down the page. Header and footer shapes marked `behindDoc` now paint beneath the body text instead of over it.
- 434454d: Paint form-blank underlines across tab advances: an underlined `w:tab` now draws a rule for the reserved stop width instead of relying on CSS text-decoration on an invisible tab glyph.
- Updated dependencies [232728c]
  - @docx-editor.dev/i18n@2.1.0

## 2.0.1

### Patch Changes

- 51f14f5: Add the `repository` field to the core package manifest so npm can verify its provenance statement on publish.
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

- 26095c6: `setSelection` now types the forms it actually accepts. `EditorSelection` gained the `{ anchor, head }` paragraph-id pair the engine honours, and lost the `SemanticTarget` and `DocLocation` arms it never accepted, so the outline and any other caller can move the caret without a cast.

  Breaking if you passed a `SemanticTarget` or a `DocLocation`-ended range to `setSelection`: both were refused at runtime with `unsupported`, so working code is unaffected.

- 26095c6: Remove `EditorHost`, `EditorConfig` and `createEditor` from the public surface. They described a retired pipeline in which the adapter supplied DOM handles and a display sink; the editor has painted its own surface since `createDocxEditor` replaced it, and none of the three had a caller. Use `createDocxEditor` with `DocxEditorConfig`.

### Minor Changes

- 26095c6: Put the caret in the right place on an empty paragraph. A centred or right-aligned one drew it at the left margin, and one with a first-line indent ignored the indent; in both cases it only jumped to the correct position once a character was typed. Lines now publish their aligned content origin as `LineRecord.contentX`.
- 26095c6: The root entry and the `contracts/*` entries now export the types their own signatures hand out — `CanResult` from `can()`, `TextMatch` from `findText()`, `TableContext` from `query()` and around 60 more that were previously unnameable from the entry point that returns them. The root re-exports the whole `Editor` contract rather than a hand-listed subset, so it cannot drift from it again.

  Removes `@docx-editor.dev/core/contracts/plugin` and `@docx-editor.dev/core/contracts/mcp`. Every function in them threw, and `coreTools` had no runtime binding at all. Extensions and MCP are deferred to a separately specified contract; `EditorModule` is the supported seam.

### Patch Changes

- Updated dependencies [26095c6]
  - @docx-editor.dev/i18n@2.0.0
