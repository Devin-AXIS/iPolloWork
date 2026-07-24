# Microsandbox iPolloWork Rust Example

Small standalone Rust example that starts the iPolloWork micro-sandbox image with the `microsandbox` SDK, publishes the iPolloWork server on a host port, persists `/workspace` and `/data` with host bind mounts, verifies `/health`, checks that `/workspaces` is `401` without a token and `200` with the client token, then keeps the sandbox alive until `Ctrl+C` while streaming the sandbox logs to your terminal.

## Run

```bash
cargo run --manifest-path examples/microsandbox-ipollowork-rust/Cargo.toml
```

Useful environment overrides:

- `IPOLLOWORK_MICROSANDBOX_IMAGE` - OCI image reference to boot. Defaults to `ipollowork-microsandbox:dev`.
- `IPOLLOWORK_MICROSANDBOX_NAME` - sandbox name. Defaults to `ipollowork-microsandbox-rust`.
- `IPOLLOWORK_MICROSANDBOX_WORKSPACE_DIR` - host directory bind-mounted at `/workspace`. Defaults to `examples/microsandbox-ipollowork-rust/.state/<sandbox-name>/workspace`.
- `IPOLLOWORK_MICROSANDBOX_DATA_DIR` - host directory bind-mounted at `/data`. Defaults to `examples/microsandbox-ipollowork-rust/.state/<sandbox-name>/data`.
- `IPOLLOWORK_MICROSANDBOX_REPLACE` - set to `1` or `true` to replace the sandbox instead of reusing persistent state. Defaults to off.
- `IPOLLOWORK_MICROSANDBOX_PORT` - published host port. Defaults to `8787`.
- `IPOLLOWORK_CONNECT_HOST` - hostname you want clients to use. Defaults to `127.0.0.1`.
- `IPOLLOWORK_TOKEN` - remote-connect client token. Defaults to `microsandbox-token`.
- `IPOLLOWORK_HOST_TOKEN` - host/admin token. Defaults to `microsandbox-host-token`.

Example:

```bash
IPOLLOWORK_MICROSANDBOX_IMAGE=ghcr.io/example/ipollowork-microsandbox:dev \
IPOLLOWORK_MICROSANDBOX_WORKSPACE_DIR="$PWD/examples/microsandbox-ipollowork-rust/.state/demo/workspace" \
IPOLLOWORK_MICROSANDBOX_DATA_DIR="$PWD/examples/microsandbox-ipollowork-rust/.state/demo/data" \
IPOLLOWORK_CONNECT_HOST=127.0.0.1 \
IPOLLOWORK_TOKEN=some-shared-secret \
IPOLLOWORK_HOST_TOKEN=some-owner-secret \
cargo run --manifest-path examples/microsandbox-ipollowork-rust/Cargo.toml
```

## Test

The crate includes an ignored end-to-end smoke test that:

- boots the microsandbox image
- waits for `/health`
- verifies unauthenticated `/workspaces` returns `401`
- verifies authenticated `/workspaces` returns `200`
- creates an OpenCode session through `/w/:workspaceId/opencode/session`
- fetches the created session and its messages

Run it explicitly:

```bash
IPOLLOWORK_MICROSANDBOX_IMAGE=ttl.sh/ipollowork-microsandbox-11559:1d \
cargo test --manifest-path examples/microsandbox-ipollowork-rust/Cargo.toml -- --ignored --nocapture
```

## Persistence behavior

By default, the example creates and reuses two host directories under `examples/microsandbox-ipollowork-rust/.state/<sandbox-name>/`:

- `/workspace`
- `/data`

That keeps iPolloWork and OpenCode state around across sandbox restarts, while using normal host filesystem semantics instead of managed microsandbox named volumes.

If you want a clean reset, either:

- change the sandbox name or bind mount paths, or
- set `IPOLLOWORK_MICROSANDBOX_REPLACE=1`

## Note on local Docker images

`microsandbox` expects an OCI image reference. If `ipollowork-microsandbox:dev` only exists in your local Docker daemon, the SDK may not be able to resolve it directly. In that case, push the image to a registry or otherwise make it available as a pullable OCI image reference first, then set `IPOLLOWORK_MICROSANDBOX_IMAGE` to that ref.
