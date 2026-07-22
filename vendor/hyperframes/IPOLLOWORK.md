# iPolloWork Local HyperFrames

This directory vendors the HyperFrames source used by iPolloWork's embedded
Video Studio iframe.

- Upstream: https://github.com/heygen-com/hyperframes
- Vendored from upstream HEAD: f3d21006633014fcb29b7a51571cd50ce832fed3
- License: Apache-2.0, retained in `LICENSE`

The iPolloWork desktop bridge starts `packages/cli/bin/hyperframes.mjs` from
this local checkout instead of downloading `hyperframes` with `npx`. The iframe
URL contract stays the same: `http://localhost:<session-port>/#project/<id>`.

To rebuild after changing Studio styles or UI:

```bash
cd vendor/hyperframes
bun install --frozen-lockfile
bun run build:local-studio
```

The local build intentionally targets the Studio/CLI path used by iPolloWork.
Repository docs, release plans, examples, and other upstream-only materials are
not vendored here.
