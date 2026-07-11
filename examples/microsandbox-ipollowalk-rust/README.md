# Microsandbox iPolloWalk Rust Example

Small standalone Rust example that starts the iPolloWalk micro-sandbox image with the `microsandbox` SDK, publishes the iPolloWalk server on a host port, persists `/workspace` and `/data` with host bind mounts, verifies `/health`, checks that `/workspaces` is `401` without a token and `200` with the client token, then keeps the sandbox alive until `Ctrl+C` while streaming the sandbox logs to your terminal.

## Run

```bash
cargo run --manifest-path examples/microsandbox-ipollowalk-rust/Cargo.toml
```

Useful environment overrides:

- `IPOLLOWALK_MICROSANDBOX_IMAGE` - OCI image reference to boot. Defaults to `ipollowalk-microsandbox:dev`.
- `IPOLLOWALK_MICROSANDBOX_NAME` - sandbox name. Defaults to `ipollowalk-microsandbox-rust`.
- `IPOLLOWALK_MICROSANDBOX_WORKSPACE_DIR` - host directory bind-mounted at `/workspace`. Defaults to `examples/microsandbox-ipollowalk-rust/.state/<sandbox-name>/workspace`.
- `IPOLLOWALK_MICROSANDBOX_DATA_DIR` - host directory bind-mounted at `/data`. Defaults to `examples/microsandbox-ipollowalk-rust/.state/<sandbox-name>/data`.
- `IPOLLOWALK_MICROSANDBOX_REPLACE` - set to `1` or `true` to replace the sandbox instead of reusing persistent state. Defaults to off.
- `IPOLLOWALK_MICROSANDBOX_PORT` - published host port. Defaults to `8787`.
- `IPOLLOWALK_CONNECT_HOST` - hostname you want clients to use. Defaults to `127.0.0.1`.
- `IPOLLOWALK_TOKEN` - remote-connect client token. Defaults to `microsandbox-token`.
- `IPOLLOWALK_HOST_TOKEN` - host/admin token. Defaults to `microsandbox-host-token`.

Example:

```bash
IPOLLOWALK_MICROSANDBOX_IMAGE=ghcr.io/example/ipollowalk-microsandbox:dev \
IPOLLOWALK_MICROSANDBOX_WORKSPACE_DIR="$PWD/examples/microsandbox-ipollowalk-rust/.state/demo/workspace" \
IPOLLOWALK_MICROSANDBOX_DATA_DIR="$PWD/examples/microsandbox-ipollowalk-rust/.state/demo/data" \
IPOLLOWALK_CONNECT_HOST=127.0.0.1 \
IPOLLOWALK_TOKEN=some-shared-secret \
IPOLLOWALK_HOST_TOKEN=some-owner-secret \
cargo run --manifest-path examples/microsandbox-ipollowalk-rust/Cargo.toml
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
IPOLLOWALK_MICROSANDBOX_IMAGE=ttl.sh/ipollowalk-microsandbox-11559:1d \
cargo test --manifest-path examples/microsandbox-ipollowalk-rust/Cargo.toml -- --ignored --nocapture
```

## Persistence behavior

By default, the example creates and reuses two host directories under `examples/microsandbox-ipollowalk-rust/.state/<sandbox-name>/`:

- `/workspace`
- `/data`

That keeps iPolloWalk and OpenCode state around across sandbox restarts, while using normal host filesystem semantics instead of managed microsandbox named volumes.

If you want a clean reset, either:

- change the sandbox name or bind mount paths, or
- set `IPOLLOWALK_MICROSANDBOX_REPLACE=1`

## Note on local Docker images

`microsandbox` expects an OCI image reference. If `ipollowalk-microsandbox:dev` only exists in your local Docker daemon, the SDK may not be able to resolve it directly. In that case, push the image to a registry or otherwise make it available as a pullable OCI image reference first, then set `IPOLLOWALK_MICROSANDBOX_IMAGE` to that ref.
