# Scenario: Friendly developer and user workflows
- Given: A developer has a local plugin package and a non-technical user discovers its published projection.
- When: The developer validates or locally installs the package and the user installs, authorizes, uses, updates, or revokes it.
- Then: Both workflows use the same manifest contract, developers receive actionable diagnostics, and users see one clear action with plain-language state and no JSON or environment editing.

## Test Steps

- Case 1 (developer validation): Return structured issue paths and messages for an invalid local manifest without writing workspace files.
- Case 2 (developer local install): Preview and install an unpacked local package through the same lifecycle used by published packages.
- Case 3 (user details): Show version, publisher/source, requested permissions, included skills/MCP/services, authorization choices, and update availability.
- Case 4 (primary action): Derive exactly one primary action from package state: Install, Connect, Open, Update, or Repair.
- Case 5 (simple authorization): Generate standard authorization controls from the manifest and keep technical details collapsed.
- Case 6 (localization): Render user-facing plugin platform states and errors in both Chinese and English catalogs.

## Status
- [x] Write scenario document
- [x] Write solid test according to document
- [x] Run test and watch it failing
- [x] Implement to make test pass
- [x] Run test and confirm it passed
- [x] Refactor implementation without breaking test
- [x] Run test and confirm still passing after refactor
