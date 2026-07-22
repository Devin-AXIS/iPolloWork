# Scenario: Lightweight lifecycle over existing loaders
- Given: A validated package contains resources supported by the current extension installer and a native OpenCode plugin entry point.
- When: The user previews, installs, disables, enables, updates, rolls back, or uninstalls the package.
- Then: iPolloWork reuses existing resource and plugin configuration seams, records file ownership and versions, and preserves unrelated workspace content.

## Test Steps

- Case 1 (install): Preview exact writes, install bundled resources, register the OpenCode plugin spec, and emit existing reload events.
- Case 2 (idempotency): Install the same immutable version twice and make the second operation a no-op with a clear status.
- Case 3 (safe update): Update owned files and preserve compatible authorization records plus unrelated workspace files.
- Case 4 (conflict): Detect a user-modified owned file before overwrite and stop with an actionable conflict instead of silently replacing it.
- Case 5 (rollback): Restore the prior immutable version and its owned files after an update.
- Case 6 (uninstall): Remove only owned files, plugin configuration, package state, and authorization records.
- Case 7 (runtime lifecycle): Reuse one lazy service instance during normal calls and dispose it on update, disable, authorization changes, uninstall, and server shutdown.

## Status
- [x] Write scenario document
- [x] Write solid test according to document
- [x] Run test and watch it failing
- [x] Implement to make test pass
- [x] Run test and confirm it passed
- [x] Refactor implementation without breaking test
- [x] Run test and confirm still passing after refactor
