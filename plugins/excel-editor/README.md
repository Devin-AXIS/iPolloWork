# Excel Editor

Open a spreadsheet from a conversation or the project file tree, then choose Edit in the right workspace. Scroll the sheet continuously. Select cells with the mouse or Shift and the arrow keys, copy or paste a range, clear it with Delete, and undo or redo changes before saving. Double-click or press F2 to edit a cell. Enter an address in the box to go there, or use Find to locate a value.

XLSX, CSV, and TSV changes save to the original file. XLSX shows formatted values and cached formula results in the grid and the underlying value or formula in the input bar. Existing formulas stay protected and recalculate in spreadsheet software. XLS and ODS open for viewing and editing with **Save as XLSX**. The source stays intact. Some legacy charts and styles may not carry over.

The CSV and TSV parsing is adapted from iPolloWork's multi-engine branch at `05f917145cd320a93e514dbd01178133891bc4c6`. The Excel Host bundles SheetJS CE 0.20.3 (Apache-2.0) for legacy import and number formatting. Its license ships with the plugin.

Build and package from the repository with `npm run package:workspace-market -- excel-editor` after preparing the dependencies in `plugins/workspace-tools`.
