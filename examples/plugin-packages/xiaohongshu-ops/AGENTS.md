# Bundled plugin maintenance

This directory is the authoritative Xiaohongshu plugin source inside the iPolloWork plugin collection. Follow the repository root `AGENTS.md`. Do not push or publish unless the user explicitly requests it.

Use pnpm. After changes, bump the root package version, manifest version and workbench UI version together. Run `pnpm --dir examples/plugin-packages/xiaohongshu-ops run setup`, `check`, `test` and `build`, then install or update `xiaohongshu-ops` through the host catalog and verify the affected fraimz flow.

Keep the plugin ID, update ID and `~/.ipollowork/plugin-data/xiaohongshu-ops` path stable. Never commit accounts, drafts, browser data, credentials or generated runtime files.
