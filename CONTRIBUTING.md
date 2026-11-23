# Contributing to iPolloWork

Read the [license](LICENSE) before using or contributing code. Describe bugs with the
iPolloWork version, DSH version, operating system, reproduction steps and a redacted error message. Never include API keys, cookies, account tokens, private documents or complete session logs.

Run `npm run setup:build` to prepare the pinned official DSH dependency. Keep changes in `plugins/`, `services/` or the product-owned `integrations/` directories. Do not modify `.upstream/dsh`: new capabilities use official extension points or independent services. Propose missing upstream capabilities separately.

## Git collaboration

Follow [github-sync-pr-flow](.agents/skills/github-sync-pr-flow/SKILL.md) for repository
edits and Git operations. It was migrated from the multi-engine edition. AGENTS.md
loads it for repository-aware agents; CLAUDE.md supplies the same entry for Claude.
Use a personal branch, merge the remote default branch before pushing, and use a
PR for main. Reading the skill does not authorize a commit, push, or PR merge.

Normal `npm run setup`, `npm run setup:build`, and root package installation
install repository-local Git hooks. For an existing checkout, run:

```sh
npm run setup:git
```

The hooks reject commits on main/master or detached HEAD, unresolved conflicts,
staged whitespace errors, direct main pushes/deletion, non-fast-forward branch
updates, and pushes missing the main revision fetched at push time. Pre-commit
also retains the pinned DSH integrity check; run normal setup before committing.
These Node-based hooks replace the former product Lefthook configuration without
adding dependencies. They do not automatically merge or publish changes.

Existing hooks are kept beside the dispatcher as `.ipollowork-original` and run
after admission, with pre-push input/arguments preserved (including Git LFS).
Obsolete generated Lefthook hooks are retained but skipped when their configuration
no longer exists; the old whitespace and upstream checks now run in the dispatcher.
If `core.hooksPath` is already set, setup fails without changing it: integrate
`node integrations/tooling/git-workflow.mjs check` and `npm run check:upstream` into
its commit checks, and `node integrations/tooling/git-workflow.mjs pre-push` into
its push checks. Forward pre-push stdin to all existing consumers as well.

Git does not activate downloaded code on clone/pull, so a new contributor must
run setup once. Hooks can be bypassed, and tools cannot prove someone read a
skill. The independent **Git collaboration / policy** PR check verifies base
synchronization, whitespace, and shared policy files even without local hooks.
Repository administrators must require that check and PRs in the main branch
ruleset for server-side enforcement. This change does not modify GitHub settings.

中文：所有代码修改及 Git 操作先遵循上述 Skill。新克隆执行正常 setup，已有副本执行
`npm run setup:git`，即可安装本地检查；只拉取文件不会让 Git 自动执行钩子。个人分支
提交、合并最新主线后推送，通过 PR 进入主线。要让所有远端合并也受约束，管理员需把
`Git collaboration / policy` 设为主分支必需检查。现有 Git LFS/自定义钩子会保留。

Before developing or reviewing a plugin, follow the [plugin development standard](docs/plugin-development.zh.md), including its DSH architecture and UI requirements. The [repository skill](.agents/skills/ipollowork-plugin-development/SKILL.md) applies the same standard to agent-assisted work and is required by [AGENTS.md](AGENTS.md).

For a change, run the owning package's checks plus `npm test`, `npm run check:upstream` and `npm run check:docs`. Runtime changes also need a real profile test. Test the public plugin in the official client and the branded client with their respective activation policies. State exactly what was tested and which platforms remain unverified.

Keep original author and license notices. Normal commits and file moves preserve history; do not rewrite shared history to change contributor attribution. Pull requests should explain the user-visible problem, the resulting behavior and verification.
