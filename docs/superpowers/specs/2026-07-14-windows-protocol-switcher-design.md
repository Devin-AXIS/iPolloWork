# Windows Protocol Switcher Design

## Goal

Provide two root-level Windows command scripts that switch the current user's `ipollowork://` protocol handler between this repository's Electron development app and an installed production iPolloWork app.

## Behavior

- `切到开发版.cmd` derives every development path from its own repository location, registers itself as the handler, and verifies the resulting open command. When Windows invokes it with a callback URL, it restores the `dev:cloud` environment and forwards the URL to the isolated development Electron instance.
- `恢复正式版.cmd` searches the current-user and machine uninstall registries, then common per-user and Program Files install locations. It stops without changing the registry if no production executable exists.
- Both scripts modify only `HKCU`; they require no administrator permissions and do not start or stop either app.
- Both scripts print an explicit success or failure result and return a non-zero exit code on failure.

## Safety

The production restore script resolves and validates an existing executable before writing anything. Registry writes use `reg.exe` with explicit value names. Development registration quotes the Electron executable, Electron entry point, and callback placeholder independently so paths containing spaces or Chinese characters remain valid.

## Verification

A Node test runs the scripts against a temporary registry key selected through a test-only environment override. It verifies development command construction, production discovery and restoration, and the no-production-installation case without altering the real `ipollowork://` handler.
