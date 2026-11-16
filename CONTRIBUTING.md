# Contributing to iPolloWork

Read the [license](LICENSE) before using or contributing code. Describe bugs with the iPolloWork version, DSH version, operating system, reproduction steps and a redacted error message. Never include API keys, cookies, account tokens, private documents or complete session logs.

Run `npm run setup:build` to prepare the pinned official DSH dependency. Keep changes in `plugins/`, `services/` or the product-owned `integrations/` directories. Do not modify `.upstream/dsh`: new capabilities use official extension points or independent services. Propose missing upstream capabilities separately.

For a change, run the owning package's checks plus `npm test`, `npm run check:upstream` and `npm run check:docs`. Runtime changes also need a real profile test. Test the public plugin in the official client and the branded client with their respective activation policies. State exactly what was tested and which platforms remain unverified.

Keep original author and license notices. Normal commits and file moves preserve history; do not rewrite shared history to change contributor attribution. Pull requests should explain the user-visible problem, the resulting behavior and verification.
