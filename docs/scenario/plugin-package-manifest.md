# Scenario: Engine-neutral self-contained plugin package
- Given: iPolloWork accepts one shared schema-version-2 plugin manifest across the app and server.
- When: A developer validates a versioned package containing portable resources, permissions, authorization, and optional engine bindings.
- Then: Portable capabilities remain engine-neutral while the active adapter handles native engine capabilities.

## Test Steps

- Case 1 (happy path): Validate a package containing one OpenCode engine binding, one skill, one MCP server, version metadata, compatible runtime ranges, and requested permissions.
- Case 2 (shared contract): Validate every built-in and bundled manifest with the same schema.
- Case 3 (invalid package): Reject malformed versions, unsafe paths, duplicate resource IDs, and unsupported permission identifiers with actionable issue paths.
- Case 4 (minimal package): Validate a package with no authorization and only one native engine capability.
- Case 5 (relationships): Validate skill requirements and service-provided actions, rejecting references to missing authorization methods, services, resources, or actions.
- Case 6 (obsolete manifest): Reject every plugin manifest that does not use schema version 2.

## Status
- [x] Write scenario document
- [x] Write solid test according to document
- [x] Run test and watch it failing
- [x] Implement to make test pass
- [x] Run test and confirm it passed
- [x] Refactor implementation without breaking test
- [x] Run test and confirm still passing after refactor
