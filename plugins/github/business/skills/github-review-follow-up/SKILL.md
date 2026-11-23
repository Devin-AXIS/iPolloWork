---
name: github-review-follow-up
description: Inspect unresolved GitHub pull request review threads, group actionable feedback, implement selected fixes locally, and only reply or resolve threads after explicit user intent.
disable-model-invocation: false
---

# GitHub Review Follow-up

Use this skill for requested changes, inline review comments, and unresolved Pull Request feedback.

## Workflow

1. Resolve `owner`, `repo`, and PR number from the request, URL, or current branch.
2. Call the GitHub service `pull-request-detail` and `review-threads` actions.
3. Separate the returned threads into:
   - unresolved and actionable;
   - informational or approval-only;
   - outdated, resolved, duplicate, or ambiguous.
4. Group actionable items by file or behavior and present a numbered, concise scope.
5. If the user asked to address everything, fix all clear unresolved items. Otherwise confirm which numbered items are in scope.
6. Modify the local checkout with each change traceable to its review thread.
7. Run the narrowest relevant tests and summarize what was addressed and what remains.

## Write safety

- Do not post a comment or call `resolve-review-thread` unless the user explicitly asks.
- Never mark a thread resolved before the corresponding change or explanation is complete.
- If comments conflict or would regress behavior, explain the conflict before editing.
- If the PR or repository is ambiguous, stop and request the missing target rather than guessing.
