# Scenario: Plugin-scoped authorization state
- Given: Two installed plugins and multiple accounts may authorize services on the same iPolloWork installation.
- When: Credentials are saved, status is queried, callbacks are completed, access is revoked, or a plugin is uninstalled.
- Then: State is addressed by plugin installation and account, app responses stay redacted, callbacks are one-time, and cleanup affects only the intended plugin records.

## Test Steps

- Case 1 (redaction): Save secret values and confirm subsequent list/status responses expose field presence and timestamps but not raw values.
- Case 2 (cross-plugin isolation): Attempt to query, complete, or revoke plugin A authorization through plugin B and confirm no record is disclosed or changed.
- Case 3 (account isolation): Authorize two accounts for one plugin, switch the active account, and revoke one without affecting the other.
- Case 4 (callback replay): Complete an OAuth or hosted callback once and reject the same state on the second attempt.
- Case 5 (expiry): Expire a pending flow and confirm late callbacks or polling cannot connect it.
- Case 6 (cleanup): Revoke an account and uninstall a plugin; confirm only the owned authorization records are removed.
- Case 7 (runtime binding): Invoke two declared local services and confirm each receives only an authorization capability bound to its own plugin installation.
- Case 8 (persistent selection): Restart the runtime and confirm the selected account remains active, falling back safely when that account is revoked.
- Case 9 (automatic refresh): Read an expired OAuth credential concurrently and confirm the provider refresh runs once, persists the replacement, and returns no token through public APIs.

## Status
- [x] Write scenario document
- [x] Write solid test according to document
- [x] Run test and watch it failing
- [x] Implement to make test pass
- [x] Run test and confirm it passed
- [x] Refactor implementation without breaking test
- [x] Run test and confirm still passing after refactor
