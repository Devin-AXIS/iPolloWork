---
name: github-sync-pr-flow
description: Preserve local work, sync an iPolloWork personal branch with remote main, validate and commit scoped changes, and push or open and merge a PR when requested. Apply to repository development and Git submission or synchronization tasks.
---

# GitHub Sync, Commit, and PR Flow

Migrated from `.codex/skills/github-sync-pr-flow/SKILL.md` at
`ipollowork-multi-engine` commit `05f917145cd320a93e514dbd01178133891bc4c6`.
This is the canonical skill for this repository's Git collaboration workflow.

## Scope and authorization

- Automatically read this skill before editing repository code and before sync,
  commit, push, or PR work. Reading it does not itself authorize those actions.
- Follow the user's requested scope. Existing authorization remains valid; do not
  ask again at every phase. A sync request authorizes fetching and merging the
  main branch and resolving routine conflicts, but does not authorize publishing.
- A commit request means a local commit. A push/submission request includes the
  current personal branch, but not a PR unless requested. A request to prepare a
  workflow or change code does not automatically authorize a commit or push.
- Requests to send work to main use a PR. Merge the PR only when requested and
  after required checks/reviews pass. Never infer authority to force-push, discard
  user work, rewrite shared history, or push directly to main.

## Branch and preflight rules

1. Inspect `git status --short --branch`, `git branch -vv`, `git remote -v`, the
   remote default branch, and the changed files/diff. Do not print credentials.
2. Stay on the current personal branch unless the user requests another branch.
   Do not commit on main/master or a detached HEAD. A fresh clone of main needs a
   personal branch before editing; use the user's existing branch when available.
3. Preserve unrelated files, generated artifacts, credentials, and existing
   commits. Stage an explicit file list; do not use `git add -A` with mixed work.
4. Run `npm run setup:git` once in an existing checkout. Normal `npm run setup`,
   `npm run setup:build`, and root package installation do this automatically.
   Hook installation preserves existing hooks; see [CONTRIBUTING.md](../../../CONTRIBUTING.md).

## Sync from main

1. Preserve dirty work before merging. Prefer a separate worktree if a stash
   would capture unrelated/untracked user data. If using a stash, record its exact
   ref, use `git stash apply <ref>`, and retain it until restoration is verified.
2. Fetch the remote default branch (normally `origin/main`). Use an explicit
   fetch and merge, not a plain pull that obscures which branch is integrated.
3. Merge `origin/main` into the personal branch; do not silently rebase shared
   commits. Inspect conflicts and combine both sides when the intent is clear.
4. When a conflict requires a product decision or risks user data, report paths,
   both sides' intent, and the decision needed. Do not guess or blanket-select
   `ours`/`theirs`. During a normal merge, ours is the personal branch and theirs
   is incoming main; stash application has different context.
5. Restore and verify preserved work. Run `git diff --check` and appropriate
   checks. A sync-only request ends here without a commit, push, or PR.

## Commit, push, and PR

1. Review the intended diff and staged diff. Keep secrets, logs, build outputs,
   and unrelated local changes out of the commit.
2. Run relevant package checks plus the repository checks required by AGENTS.md.
   Report commands/results and any skipped integration checks honestly.
3. Make scoped commits with concise English messages. PR titles/bodies also use
   English and describe final behavior, verification, and material limitations.
4. When pushing is requested, push the current personal branch to its upstream,
   or `origin/<current-branch>` if no upstream exists. Fetch/merge main first when
   the pre-push check reports that main has advanced; never force-push to bypass it.
5. Create a PR to the remote default branch only when requested. Inspect existing
   PRs before creating a duplicate. Use a body file for multiline CLI descriptions.
6. PR merge requires the user's merge request and passing required checks/reviews.
   Use GitHub's normal merge method; do not push directly to the protected branch.
7. Report the branch, commit/PR when created, checks, and remaining work. Do not
   claim remote delivery when changes remain only in the local working tree.

## Automatic checks and limits

The repository hooks reject commits on main/master, unresolved conflicts, staged
whitespace errors, direct pushes to protected branches, non-fast-forward updates,
and personal-branch pushes missing the fetched main revision. Pre-commit also
verifies the existing pinned DSH source. Hooks never stash, merge, stage, commit,
or push automatically. Existing Git LFS/custom hooks retain their input and run
after these checks.

Git intentionally does not execute downloaded hooks on clone/pull. Contributors
must run the normal setup (or `npm run setup:git`), which installs them locally.
GitHub's `Git collaboration / policy` PR check runs independently of local hooks.
Repository administrators should require that check and PRs in the main branch
ruleset. Local hooks can be bypassed; neither hooks nor CI can prove a human or
every possible AI editor read this skill.
