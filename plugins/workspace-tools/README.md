# Workspace Tools

The iPolloWork market offers Markdown Editor, Excel Editor, Conversation Export, Task Templates, Reference Preparation, and Legacy Workspace Import as separate bundles. Disable the old Workspace Tools bundle when switching to the separate plugins. Task Templates and Legacy Workspace Import use the existing template records, so saved and imported templates remain available.

Install and enable the archive in iPolloWork's plugin manager. In a local workspace conversation, select Edit on the document preview toolbar to edit Markdown or XLSX. Markdown has formatting controls, preview, and a save shortcut. XLSX supports changing sheets and editing ordinary cell values while preserving formulas and protected cells. External changes are reported without dropping the draft.

Use the conversation menu to export Markdown or save a task template. Workspace Tools in the right sidebar manages templates, prepares references, and previews and imports commands and skills from a legacy workspace export. Templates prepare conversation drafts. References are parsed locally, with originals, evidence, assets, and an index kept under the project's `references/`. Scan-only PDFs require OCR first.

Imported commands become editable templates. Skills are saved under the current project's `.agents/skills/`. Existing skills are preserved.

Run `npm ci`, `npm run check`, and `npm run pack:check`. Run `npm pack` to build the installation archive.
