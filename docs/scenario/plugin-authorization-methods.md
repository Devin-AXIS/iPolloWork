# Scenario: Independent multi-method plugin authorization
- Given: An installed plugin owns its service and declares its authorization choices in its manifest.
- When: A user opens the plugin and chooses secret form, OAuth PKCE, device/QR, or plugin-hosted browser authorization.
- Then: The platform starts the chosen plugin-scoped flow without consulting Authorization Center or reading/writing global credential environment variables.

## Test Steps

- Case 1 (secret form): Save the plugin-declared fields and return a connected or validation-failed state without exposing saved values.
- Case 2 (OAuth PKCE): Create a verifier, challenge, state, authorization URL, expiry, and one-time callback record from plugin-declared public-client metadata.
- Case 3 (device/QR): Return a verification URL, user code, optional QR value, polling interval, and pending state; expire or cancel correctly.
- Case 4 (hosted browser): Create a one-time plugin-vendor authorization URL and accept only the matching callback state and installation.
- Case 5 (multiple choices): Present all methods in manifest order and keep the selected method local to that plugin account.
- Case 6 (invalid declaration): Reject duplicate method IDs, insecure remote origins, embedded confidential client secrets, and unsupported method kinds.

## Status
- [x] Write scenario document
- [x] Write solid test according to document
- [x] Run test and watch it failing
- [x] Implement to make test pass
- [x] Run test and confirm it passed
- [x] Refactor implementation without breaking test
- [x] Run test and confirm still passing after refactor
