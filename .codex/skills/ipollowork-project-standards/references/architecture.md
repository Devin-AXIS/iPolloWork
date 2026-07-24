# iPolloWork architecture boundaries

- `apps/app`: React/Vite user interface.
- `apps/desktop`: Electron shell, native helpers, and desktop lifecycle.
- `apps/server`: local server, runtime adapters, and bundled plugins.
- `apps/orchestrator`: CLI host for the local runtime.
- `packages/*`: shared libraries and publishable packages.
- OpenCode: external/runtime sidecar. Integrate through supported APIs, CLI, plugins, and config; do not silently change its source.

When a change crosses boundaries, keep the adapter at the edge and pass typed, minimal data inward. Verify the real startup path after changing a boundary contract.
