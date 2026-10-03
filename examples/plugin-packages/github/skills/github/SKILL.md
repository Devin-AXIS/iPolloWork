---
name: github
description: Use the connected iPolloWork GitHub service to inspect repositories, pull requests, issues, reviews, and Actions, then route focused work to the review, CI, or publish skill.
disable-model-invocation: false
---

# GitHub

Use this skill as the entrypoint for general GitHub work. It combines structured remote GitHub data from the iPolloWork GitHub service with the current local checkout.

## Service boundary

- Call `ipollowork_extension_list_actions` with `extensionId: "github"` before using the service.
- Use `ipollowork_extension_call` only with the declared GitHub actions and explicit `owner` and `repo` values.
- Use local `git` for branch, status, diff, commit, and push operations.
- Never request, print, or place the GitHub token in a prompt, command, file, or environment variable. iPolloWork owns the credential.

## Routing

1. Resolve the repository from the user's URL or request. For requests about the current checkout, inspect the local remote and branch first.
2. Classify the job:
   - General repository, PR, or Issue understanding stays here.
   - Unresolved review feedback uses `github-review-follow-up`.
   - Failing GitHub Actions uses `github-ci-debug`.
   - Commit, push, and Draft PR creation uses `github-publish-changes`.
3. Switch to the specialist workflow immediately once the intent is clear.

## General workflow

1. Use `repository-context` to confirm the target and default branch.
2. Use `list-pull-requests`, `pull-request-detail`, `list-issues`, or `issue-detail` for the requested scope.
3. Summarize current state, important evidence, and the smallest useful next action.
4. Before a write action, restate the exact repository and target. iPolloWork will request confirmation for service writes.

Do not invent repository search results. If the repository cannot be derived from the request or current checkout, ask for `owner/repo`.
