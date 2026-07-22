# iPolloWork FAQ knowledge base

This directory is the source draft for the public Chinese FAQ. It is kept out
of the Mintlify navigation until product wording and capability status have
been reviewed.

## Content contract

- Keep every item addressable with a stable ID such as `faq-001`.
- Start with a direct answer, then state scope, maturity, and a canonical
  source.
- Use only `Live`, `Beta`, `Alpha`, `Roadmap`, or `Policy` for
  maturity. Never present roadmap work as available.
- Distinguish local iPolloWork, iPolloWork Cloud, and the external OpenCode
  sidecar.
- Use `iPolloWork` and `ipollowork` consistently. The four public work
  directions are `Work`, `Code`, `Create`, and `Video`; keep former labels
  such as `WWork` as search aliases only.
- Keep dynamic versions and dependency inventories linked to repository
  sources instead of copying long lists that will become stale.

## Source priority

1. Runtime behavior and package configuration.
2. Published product documentation and the repository README.
3. Changelog and validated eval evidence.
4. Roadmap documents.

## Publishing checklist

1. Review every answer with product and engineering owners.
2. Split or generate individual public pages when stable URLs are required.
3. Add the approved FAQ page to `packages/docs/docs.json`.
4. Generate search/AI indexes from the approved MDX; do not maintain a second
   hand-written TXT or JSON knowledge source.
