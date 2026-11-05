---
name: sentry-release-health
description: Assess release health from Sentry errors, regressions, affected users, crash evidence, and comparison with the previous stable release.
disable-model-invocation: false
---

# Sentry Release Health

1. Resolve the release and production environment exactly.
2. Compare it with the previous relevant stable release over equivalent windows.
3. Report new and regressed issues, affected users, severity, and high-confidence change points.
4. Distinguish incomplete rollout, low traffic, and missing instrumentation from healthy behavior.
5. Recommend continue, monitor, pause, or rollback only when the evidence supports that choice.

Never claim a release is safe solely because no events were returned.
