# Scenario: Additive self-contained plugin package
- Given: iPolloWork already accepts schema-version-1 extension manifests and native OpenCode plugin specifications.
- When: A developer validates a versioned plugin package that combines existing resource types with package, compatibility, permission, entry-point, and update metadata.
- Then: The package is normalized into the existing extension projection, while every current manifest remains valid without migration.

## Test Steps

- Case 1 (happy path): Validate a package containing one native OpenCode plugin, one skill, one MCP server, version metadata, compatible runtime ranges, and requested permissions.
- Case 2 (backward compatibility): Validate every current built-in extension manifest without adding new fields.
- Case 3 (invalid package): Reject malformed versions, incompatible entry points, duplicate resource IDs, and unsupported permission identifiers with actionable issue paths.
- Case 4 (minimal package): Validate a package with no authorization and only one native OpenCode plugin resource.
- Case 5 (relationships): Validate skill requirements and service-provided actions, rejecting references to missing authorization methods, services, resources, or actions.

## Status
- [x] Write scenario document
- [x] Write solid test according to document
- [x] Run test and watch it failing
- [x] Implement to make test pass
- [x] Run test and confirm it passed
- [x] Refactor implementation without breaking test
- [x] Run test and confirm still passing after refactor
