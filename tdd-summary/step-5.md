# Step 5 - Refactor

- Kept the new platform in focused `plugin-*` modules instead of changing Authorization Center or the global environment store.
- Reused runtime OpenCode plugin/MCP registration and the existing extension action bridge.
- Added immutable artifact snapshots, ownership hashes, rollback, and conflict detection.
- Captured authorization input values before React releases synthetic events after a live-browser crash exposed the issue.
- Added localized operation summaries while preserving actionable developer diagnostics.
- Kept one lazy service instance per installed plugin version, with explicit disposal on update, disable, authorization changes, uninstall, and server shutdown.
- Added a persisted active account per authorization method and deduplicated automatic token refresh so skills never handle login material.
