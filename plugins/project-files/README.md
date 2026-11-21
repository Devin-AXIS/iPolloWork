# Project files

Project Files is a native right-sidebar tab for an iPolloWork or DeepSeek Harness workspace. Open a project conversation, expand the right sidebar, and select **Project files**.

- The library has **Inputs** and **Outputs**. Use **This conversation** or **Entire project** to filter both. Project view places current conversation items first and lists duplicates once. All items share the same compact file style and a trailing file-action menu. Delivered items use their supplied description as the title when present, with the original filename beneath it. Click HTML to preview it. Images use the same icon-sized slot. The view switch changes the entire panel between grid and list.
- **Inputs** collects uploaded attachments and recorded project-local `@file` references across the project's conversations. Download an attachment or copy it into a project folder. References open in the native preview.
- **Outputs** shows explicitly delivered files first, followed by recorded successful writes and reported workspace changes. A delivered folder with an `index.html` or `index.htm` entry opens directly in the native HTML preview. **Project folder** shows the real workspace directories, including files that a conversation did not record.
- In the project folder, click to select an item, then double-click or press Enter to open it. Right-click for file actions or use Cmd/Ctrl+C, X and V. Drag to a folder or breadcrumb to move. Hold Option/Alt while dropping to copy. F2 renames. **Recently deleted** can restore trashed items.
- File changes are restricted to a verified workspace on the local filesystem of the current DSH Host. Copy and cut use the plugin's project-specific file clipboard.

Bundled with the iPolloWork Suite as `ipollo-project-files`. Standalone installation uses the built `@ipollo/dsh-project-files` archive in the native Plugin Manager. Choose one installation per profile.

From this directory run `npm ci`, `npm run check`, and `npm run pack:check` after the repository's hash-pinned DSH setup. Build and install the archive into a disposable profile before upgrading a working profile.
