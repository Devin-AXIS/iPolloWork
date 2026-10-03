# Bundled plugin maintenance

This directory is the authoritative WeChat Channels plugin source inside the iPolloWork plugin collection. Follow the repository root `AGENTS.md`. Do not push or publish unless the user explicitly requests it.

Use pnpm. After changes, bump the package and manifest versions together. Run `pnpm --dir examples/plugin-packages/wechat-channels-ops run check` and `pnpm --dir examples/plugin-packages/wechat-channels-ops test`, then install or update `wechat-channels-ops` through the host catalog and verify the affected fraimz flow.

Keep the plugin ID, update ID and `~/.ipollowork/plugin-data/wechat-channels-ops` path stable. Never commit accounts, drafts, browser data, credentials or generated runtime files. Platform identities and results must come from observed WeChat Channels Assistant pages; local accounts remain unverified until that check succeeds.
