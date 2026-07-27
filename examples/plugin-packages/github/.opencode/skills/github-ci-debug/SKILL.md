---
name: github-ci-debug
description: Diagnose failing GitHub Actions runs from bounded run, job, and step evidence, propose a focused fix, and modify the local checkout only when the requested task includes implementation.
disable-model-invocation: false
---

# GitHub CI Debug

Use this skill only for GitHub Actions failures.

## Workflow

1. Resolve the repository and Actions run ID from the supplied URL, PR, or current branch context.
2. Call `actions-failure` through the connected GitHub service.
3. Report the run URL, failing jobs, failing steps, and the most likely root cause supported by the returned evidence.
4. If the check belongs to an external provider, report its URL and do not pretend the GitHub service controls it.
5. Propose the smallest fix tied directly to the failing step.
6. When the user asked for a fix, implement it locally and run the relevant local check.
7. Summarize remaining uncertainty and what needs a remote rerun.

## Guardrails

- Do not rerun or cancel workflows; those actions are not part of this plugin version.
- Do not claim complete log coverage when the service returned only job and step summaries.
- Do not change code when the evidence points to an unrelated infrastructure or flaky failure unless the user chooses that scope.
