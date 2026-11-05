---
name: sentry-regression-monitoring
description: Compare bounded Sentry windows and releases to identify new issues, regressions, frequency changes, and user-impact changes.
disable-model-invocation: false
---

# Sentry Regression Monitoring

1. Confirm the projects, environments, releases, and comparison windows.
2. Compare new, regressed, and materially changed issues using counts and affected-user evidence.
3. Exclude known test, development, and irrelevant environments unless requested.
4. Rank findings by user impact and confidence, not raw event count alone.
5. Return links or identifiers and state gaps caused by sampling or missing release data.

Do not treat correlation with a release as proof of causation.
