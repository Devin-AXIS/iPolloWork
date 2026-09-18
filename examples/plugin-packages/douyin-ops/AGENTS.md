# Bundled plugin maintenance

This directory is the authoritative Douyin plugin source inside the iPolloWork plugin collection. Follow the repository root `AGENTS.md`. Do not push or publish unless the user explicitly requests it.

Use pnpm. After changes, bump the package, manifest and workbench UI versions together. Run `pnpm --dir examples/plugin-packages/douyin-ops run check` and `pnpm --dir examples/plugin-packages/douyin-ops test`, then install or update `douyin-ops` through the host catalog and verify the affected fraimz flow.

Keep the plugin ID, update ID and `~/.ipollowork/plugin-data/douyin-ops` path stable. Never commit accounts, drafts, OAuth credentials, tokens or generated runtime files.
