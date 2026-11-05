---
name: sentry-issue-investigation
description: Investigate a Sentry issue from bounded event, stack, tag, environment, release, and timeline evidence before proposing a code change.
disable-model-invocation: false
---

# Sentry Issue Investigation

1. Resolve the organization, project, environment, issue, and time window.
2. Read representative recent events rather than assuming the issue summary is complete.
3. Compare stack frames, exception values, tags, releases, affected users, and recurrence patterns.
4. Separate the observed failure, likely trigger, suspected code path, and remaining uncertainty.
5. When implementation is requested, inspect the matching code and make the smallest evidence-backed fix.

Do not expose user data from event payloads. Do not claim root cause from a title or one stack trace alone.
