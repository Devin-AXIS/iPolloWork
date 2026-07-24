---
name: github-sync-pr-flow
description: Use when preparing iPolloWork local changes for GitHub: stash or preserve local edits, sync the current personal branch with remote main, re-apply local work, diagnose conflicts, commit in English, push to the current remote branch, and open a PR to main without creating extra branches.
---

# GitHub Sync, Pull, and PR Flow

Use this workflow for iPolloWork developer submissions, personal-branch syncs, and PR requests. Keep the developer on their current personal branch unless the user explicitly asks for another branch.

## Permission Boundary

- This skill is a workflow guide. Do not run the publish flow just because the skill exists.
- Before changing branch history, syncing from `main`, committing, pushing, creating a PR, or calling GitHub APIs, get explicit user approval for that phase.
- If the user only asks to prepare or document the workflow, only create or update this skill file.
- If the user asks to check readiness, inspect and report state without changing Git state unless they approve the next step.
- If any command would overwrite, drop, rebase, force-push, or otherwise risk local work, stop and ask for explicit approval.

## Branch Rules

- Do not create extra branches by default.
- Never commit directly to `main`.
- Treat the current non-main branch as the developer's personal remote branch.
- Commit messages, PR titles, and PR bodies must be in English.
- Push to the current branch's upstream or `origin/<current-branch>`.
- PR target is the remote default branch, normally `origin/main`.

## Intent Routing

Choose the smallest workflow that matches the user's words.

- "Submit/commit my code" means commit current local changes and push them to the current personal remote branch. Do not open a PR unless requested.
- "Push my code" means push committed or newly committed changes to the current personal remote branch. Do not open a PR unless requested.
- "Pull/sync/update from main" means preserve local work, bring `origin/main` into the current personal branch, then restore local work. Do not commit or push unless requested.
- "Open a PR" means ensure the personal branch is pushed, then create a PR from the current branch to `main`.
- "Merge my code into main" means use the PR flow. Do not push directly to `main`.
- "Merge the PR" means merge through GitHub after checks and review approval, using the repository's normal merge method.
- Ambiguous requests must be clarified before write operations.

## Preflight Check

Before any sync, commit, push, or PR action:

1. Inspect state.
   - Run `git status --short --branch`, `git branch -vv`, and `git remote -v`.
   - Identify current branch, upstream branch, default branch, and dirty files.
   - If on `main`, stop and ask for the intended personal branch.
2. Inspect scope.
   - Review changed file names and enough diff context to understand what will be affected.
   - If unrelated changes are mixed together, ask which files belong to this operation.
   - Do not stage secrets, `.env` files, local logs, build artifacts, or generated cache files unless explicitly intended.
3. Confirm the next phase.
   - State which workflow will run: pull/sync only, commit/push only, PR only, or PR merge.
   - Continue only after the user approves that phase.

## Pull / Sync From Main

Use this when the user asks to pull, sync, update from `main`, or prepare their personal branch before submission.

1. Start from the current personal branch.
   - Confirm the branch is not `main`.
   - Confirm the remote target is `origin/main`.
2. Preserve local work.
   - If the worktree is dirty, run `git stash push -u -m "<clear English message>"`.
   - Record the stash ref and summary.
   - If `git stash` fails, stop and report the error.
3. Fetch remote state.
   - Run `git fetch origin --prune`.
   - Do not use plain `git pull` for this workflow because it hides whether the incoming changes came from `main`, the current branch upstream, or both.
4. Merge remote main into the current personal branch.
   - Run `git merge origin/main` unless the repository explicitly documents a rebase workflow.
   - If the merge conflicts, stop immediately.
   - Report conflict files, modules, remote/main changes, and local branch changes.
   - Ask the user how to resolve before editing conflict hunks.
5. Re-apply local work.
   - Run `git stash pop` for the saved stash.
   - If stash pop conflicts, stop immediately.
   - Report conflict files, modules, remote/main changes, and local stashed changes.
   - Keep the stash until the restored changes are confirmed safe.
6. Validate local state.
   - Run `git status --short --branch`.
   - Run `git diff --check`.
   - Run narrow checks only if the user approved validation or the next workflow depends on it.
7. Stop.
   - Do not commit, push, or open a PR after pull/sync unless the user explicitly asks.

## Commit And Push To Personal Branch

Use this when the user says "submit my code", "commit my code", or "push my code" without asking to merge to `main`.

1. Run the preflight check.
2. Confirm intended files.
   - Stage only the files that belong to the user's request.
   - Avoid `git add -A` when unrelated changes exist.
3. Validate.
   - Run `git diff --check`.
   - Run relevant tests, typecheck, or lint for changed areas when available.
4. Commit.
   - Use a concise English commit message.
   - Mention the feature, fix, or workflow changed.
5. Push.
   - Run `git push -u origin <current-branch>`.
6. Stop.
   - Do not open a PR unless the user requested it.

## PR To Main

Use this when the user asks to open a PR or merge their code toward `main`.

1. Run the pull/sync workflow first unless the user explicitly says the branch is already synced.
2. If new local changes remain after sync, run the commit and push workflow.
3. Open PR.
   - Prefer GitHub CLI or GitHub API, depending on local availability.
   - Base branch: `main`.
   - Head branch: current personal branch.
   - Title/body in English.
   - Body should describe what changed, why, validation, and known risks.
4. Stop after PR creation unless the user explicitly asks to merge the PR.

## Merge PR Into Main

Use this only when the user explicitly asks to merge into `main`.

1. Confirm the PR target is `main` and the head branch is the user's personal branch.
2. Check required CI status and review state.
3. If checks or review are missing, report what is blocking merge.
4. If merge conflicts exist on GitHub, report the conflict modules and ask how to proceed.
5. Merge through GitHub using the repository's normal merge method.
6. Do not push directly to `main` from local unless the repository owner explicitly requires it.

## Conflict Report Format

When conflicts occur, report:

- Conflict file path.
- Module or feature area.
- Remote/main side: concise description from `git diff --ours` or upstream context.
- Local side: concise description from `git diff --theirs`, stash context, or working-tree context.
- Same area changed by whom when known from commit authors.
- Recommended resolution when it is clear.
- Required decision: keep remote, keep local, or combine.

Do not resolve conflicts without user confirmation unless the resolution is mechanically obvious and explicitly allowed.

## Legacy Full Submission Flow

Use this only when the user explicitly asks for the full sequence from local changes to PR.

1. Inspect state and confirm scope.
2. Stash dirty local edits.
3. Fetch/prune origin.
4. Merge `origin/main` into the current branch.
5. Pop stash.
6. If conflicts occur, stop and ask.
7. Validate locally.
8. Stage intended changes.
9. Commit in English.
10. Push to `origin/<current-branch>`.
11. Open PR to `origin/main`.
12. Summarize PR URL, commit hash, checks, and remaining risks.
