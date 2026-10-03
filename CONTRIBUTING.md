# Contributing to iPolloWork

Thank you for helping improve iPolloWork. Read `README.md`, `AGENTS.md`,
`docs/governance.md`, `SECURITY.md`, and `apps/app/src/react-app/ARCHITECTURE.md`
before making product changes.

## Development

```bash
./ipollowork setup
./ipollowork dev
./ipollowork check
```

Keep changes focused, preserve the iPolloWork/OpenCode boundary, and include the checks used to validate the change.

## Issue tracker

Use GitHub Issues for public bug reports, feature requests, documentation
defects, and task tracking. Do not use public issues for security
vulnerabilities; follow `SECURITY.md` instead.

## Coding standards

Primary application code is TypeScript, React, Electron, Bun, and Node.js.
Contributions must follow the local patterns in the owning package and these
project-wide rules:

- Prefer the existing module owner before adding files, directories, routes, or
  dependencies.
- Keep the iPolloWork/OpenCode boundary intact and use supported OpenCode
  APIs, SDKs, CLI, plugins, and configuration surfaces.
- Use typed boundaries; avoid `any`, broad type assertions, duplicated derived
  state, and fallback paths that the type system or control flow already rules
  out.
- Reuse UI primitives from `apps/app/src/components/ui` and shared app
  components from `apps/app/src/components`.
- Keep generated runtime artifacts out of source directories.
- Preserve third-party copyright and license notices.

The standard check command is `./ipollowork check` on macOS/Linux or
`.\ipollowork.cmd check` on Windows. CI also runs package tests, type checks,
REUSE lint, OpenSSF Scorecard, CodeQL, and dependency review.

## Tests

Major new functionality must include automated tests at the owning package
layer. Bug fixes should include regression tests whenever practical; maintainers
expect regression tests for at least half of bugs fixed in any six-month period.
If a change cannot be tested automatically, explain the reason and include
manual verification steps in the pull request.

Run the narrowest meaningful checks before opening a pull request, then let CI
run the shared repository checks. Document every command and result in the pull
request template.

## Change review

All non-trivial code changes should be reviewed by a maintainer who did not
author the change. Reviewers check correctness, tests, security impact,
license/attribution, user-facing behavior, and rollback risk.

## Contribution terms

By submitting a pull request or other contribution for inclusion in iPolloWork, you represent that you have the right to submit it and agree that:

1. The contribution may be distributed to users under the current iPolloWork Source Available License and any future version of that license; and
2. You grant Different AI, Inc. a perpetual, worldwide, non-exclusive, irrevocable, royalty-free license to use, reproduce, modify, distribute, sublicense, and commercially license the contribution as part of iPolloWork and related products.

Third-party code must keep its original copyright and license notice. Identify the source and license in the pull request. Do not submit code that cannot legally be included under these terms.
