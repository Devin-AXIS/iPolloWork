# Data annotation training

English | [中文](README.zh.md)

Independent DSH bundle `@ipollo/dsh-data-annotation`, migrated from Smart Future School's data annotation training plugin 0.3.0. Supports image, video, audio and text annotation, text-layer PDF import, twelve training projects, editable labels and saved projects. Uses the official DSH 0.2.2-rc.3 plugin lifecycle, sidebar, workspace registry, authentication, tools and skills. No upstream runtime patches or second Agent runtime.

The package exports its manifest and localized display metadata for native Plugin Manager icons. The workspace header and open actions use native DSH controls and wrap in narrow containers.

## Build and install

From this directory, run `npm ci --legacy-peer-deps`, `npm run check`, `npm run pack:check`, then `npm pack`. For monorepo development run `npm run link:workspace` after installing dependencies; the root official runtime must already be built. Install the resulting `ipollo-dsh-data-annotation-0.1.1.tgz` with the official `dsh plugin --profile <profile> add /absolute/path/to/package.tgz`. Restart that profile if requested by DSH. Do not point installation at a different or active profile unintentionally.

Open **数据标注实训云** in the sidebar, select an existing DSH workspace, then open the workbench. Projects remain in `<workspace>/.ipollowork/plugins/labelu-data-annotation`; legacy schema-1 tasks are read without rewriting them. Nothing is moved automatically from a different workspace. Uninstalling preserves user files.

The `ipollo_annotation` tool offers only `list-projects` and `get-project`, with arguments inside `input`. Conversation tools cannot modify annotations. Workbench routes require a DSH owner connection; a local service owns media processing and is disposed when disabled. Service tokens stay on the Host, never in browser storage or workbench URLs. Host plugins and arbitrary shell access are not isolated by this boundary. PDF import extracts existing text, without OCR or a cloud upload.

## Verification

`npm run check` builds both UI and service and tests PDF import, legacy data, label revisions, training materials and read-only conversation actions. A real DSH profile is also needed to validate authentication, client loading, themes and workspace isolation. Large LabelU lazy-loaded chunks trigger Vite size warnings; that warning is not an import failure.

Source and third-party notices are in `NOTICE.txt`, `LICENSE-THIRD-PARTY.txt` and `LICENSE`. LabelU-Kit and PDF.js are Apache-2.0; this independent plugin is not endorsed by their authors.
