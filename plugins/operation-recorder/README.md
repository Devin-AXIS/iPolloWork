# Operation recorder

English | [中文](README.zh.md)

Independent DSH bundle `@ipollo/dsh-operation-recorder`, migrated from the multi-engine iPolloWork recorder 0.3.0. Retains semantic desktop capture, pause/resume, saved recordings, Chrome Recorder import, redaction, editable steps, deterministic Skill compilation and export. No model keys or second Agent runtime.

The package exports its manifest and localized display metadata for native Plugin Manager icons. The workspace header and open actions use native DSH controls and wrap in narrow containers.

## Build and install

Run `npm ci --legacy-peer-deps`, `npm run link:workspace` for monorepo development, `npm run check`, `npm run pack:check`, then `npm pack`. Build the root official runtime first. Full native builds require Go 1.26; macOS universal capture also requires Swift 6/Xcode command-line tools. The package includes prebuilt capture helpers; end users need no compiler. Install the resulting `.tgz` using `dsh plugin --profile <profile> add /absolute/path/ipollo-dsh-operation-recorder-0.2.1.tgz`. Check the target profile before installation.

Open **操作录制**, select an existing DSH workspace and open the workbench. Recording requires explicit system permissions. Windows uses UI Automation and passive hooks, Linux X11 uses XRecord/AT-SPI, macOS uses Accessibility/CGEventTap. Wayland supports Chrome Recorder import, not full desktop capture. Previous live capture limitations remain; cross-compilation and mock tests do not prove real desktop input capture on each platform.

The `ipollo_recorder` tool exposes `status`, `review`, `import-chrome`, `compile` with arguments in `input`; writes reject read-only sessions. Capture and permission requests stay in the user workbench. **AI refinement** opens a native DSH conversation with an unsent draft, preserving existing text; the user reviews and sends it. Generated `.tgz` files are real independent DSH Skill bundles, with `package.json`, `cordis.patch.yml`, lifecycle registration, `SKILL.md` and `references/workflow.json`. They can be installed using the same official plugin command. A draft export does not mean successful replay or human approval.

Records are stored under `<workspace>/.ipollowork/plugins/operation-recorder/workspaces/<workspace-hash>`. Old recorder data is not moved or deleted automatically; Chrome JSON remains importable. Disabling releases HTTP listeners and native capture processes; uninstalling preserves records. Workbench routes require a DSH owner connection and service credentials remain on the Host. This is not isolation from arbitrary shell access or other Host plugins.

`npm run check` covers input redaction, imports, versioned exports, workspace isolation, symlink rejection, native helper mocks and service disposal. Real DSH/client and real platform capture checks are additional. See `LICENSE`, `NOTICE.txt`, and `native/THIRD-PARTY-NOTICES.txt`.

## 0.2 evidence and refinement

An optional workflow goal, quality findings (missing target, missing completion condition, empty/active recording), compact `prepare` evidence and paginated `events` now guide refinement. AI compile calls require the current `expectedRevision` and cannot grant human approval. Exports persist as the latest preview and reappear after reopening; changed evidence invalidates them. Bundles include `references/evidence.json` and `evals/evals.json`, explicitly marked `not_run`, without inventing missing assertions. Evidence remains plugin-owned workspace files, with no database or new service.

Research references: [humblebanana/dsh-record-replay](https://github.com/humblebanana/dsh-record-replay/tree/32d06f7db906914e278d1552728d1d63f191d6ad) separates evidence validation, preparation and skill creation; [kangshifu1/dsh-record-replay](https://github.com/kangshifu1/dsh-record-replay/tree/e1015e57a4f815dba5f4776f6ae9d969a3e25ddf) uses video frames for visual skill generation. Sources were inspected; neither runtime was copied or installed in the user's profile. This release strengthens the existing semantic workflow; screen video, autonomous replay and community-plugin compatibility on rc.3 are not claimed. The macOS collector also records printable-key intent in custom editors with incomplete accessibility roles, without reading typed characters; unnamed targets still require evidence or user clarification.
