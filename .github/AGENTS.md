# iPolloWork automation

Workflows operate on this product repository and fetch DSH through `npm run setup`. Do not assume official source is tracked under `apps/` or `packages/`; those are ignored build-time links. Desktop builds use `integrations/desktop/run.mjs`; business services deploy independently.

Preserve existing runner selection, signing credentials, environment approvals, artifact retention, and explicit publication steps. Windows jobs use native PowerShell. A package verification run must never publish or advance a rollout.
