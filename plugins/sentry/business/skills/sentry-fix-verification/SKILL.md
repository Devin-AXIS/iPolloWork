---
name: sentry-fix-verification
description: Verify a production fix by linking the changed code and release to Sentry issue state and post-release event trends without resolving issues prematurely.
disable-model-invocation: false
---

# Sentry Fix Verification

1. Record the target issue, expected fix, code change, release, environment, and observation window.
2. Confirm the release containing the change is actually present in Sentry.
3. Compare post-release events and affected users with the pre-release baseline.
4. Report whether evidence shows fixed, improving, unchanged, regressed, or insufficient traffic.
5. Change issue state only when the user requests it and the verification evidence is adequate.

Keep local tests, merged code, deployed release, and observed production behavior as separate milestones.
