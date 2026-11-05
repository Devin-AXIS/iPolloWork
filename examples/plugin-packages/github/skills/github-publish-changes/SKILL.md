---
name: github-publish-changes
description: Publish intentional local changes by confirming scope, creating a branch when needed, staging selected files, committing, pushing, and creating a Draft Pull Request through the connected GitHub service.
disable-model-invocation: false
---

# GitHub Publish Changes

Use this skill only when the user explicitly wants local changes committed, pushed, or opened as a Pull Request.

## Workflow

1. Inspect `git status -sb`, the complete diff, the current branch, and remotes.
2. Identify exactly which changes belong to this task. In a mixed worktree, never stage unrelated files and never default to `git add -A` without confirmed scope.
3. If currently on the default branch, create an `agent/<short-description>` branch. Otherwise keep the intended feature branch.
4. Stage explicit paths and review the staged diff.
5. Run the most relevant checks if they have not already passed.
6. Commit with a short message describing the complete scoped diff.
7. Push the current branch with upstream tracking.
8. Resolve the GitHub `owner`, `repo`, remote default branch, and pushed head branch.
9. Call `create-pull-request` through the GitHub service. Keep `draft` true unless the user explicitly requests a ready-for-review PR.
10. Report the branch, commit, PR URL, test results, and any remaining review risk.

## Safety

- Do not push when the requested scope is unclear.
- Do not force-push, delete a branch, merge, or rewrite history unless explicitly requested.
- Do not include credentials, local caches, generated secrets, or unrelated user changes.
- Creating the PR is a GitHub write action and must pass iPolloWork's confirmation gate.
