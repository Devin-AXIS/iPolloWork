# Contributing to iPolloWork

Thank you for helping improve iPolloWork. Read `AGENTS.md`, `VISION.md`, `PRINCIPLES.md`, `PRODUCT.md`, and `ARCHITECTURE.md` before making product changes.

## Development

```bash
./ipollowork setup
./ipollowork dev
./ipollowork check
```

Keep changes focused, preserve the iPolloWork/OpenCode boundary, and include the checks used to validate the change.

## Community contribution plan

iPolloWork welcomes focused contributions that improve the local-first agent
workspace while keeping generated outputs editable and inspectable. Maintainers
prioritize work in this order:

1. Reliability fixes for the desktop app, local runtime, packaging, permissions,
   and release flows.
2. Documentation, examples, and templates that help users build Skills, plugins,
   MCP integrations, documents, websites, presentations, designs, and videos.
3. Small product improvements with clear user value, matching tests, and no
   broad architectural churn.
4. Larger feature proposals after an issue, design note, or discussion confirms
   ownership boundaries, migration impact, and validation requirements.

Good first contributions include documentation corrections, reproducible bug
reports, narrow UI fixes, plugin package examples, evaluation coverage, and
platform-specific packaging notes. For new third-party integrations, include
the intended permission model, auth flow, data handled, and license status in
the pull request.

Community work is coordinated through GitHub issues, pull requests, release
notes, and the community channels linked from the README. Maintainers should
label accepted starter issues, respond with the expected validation path, and
close stale proposals when ownership, scope, or licensing cannot be confirmed.

## Contribution terms

By submitting a pull request or other contribution for inclusion in iPolloWork, you represent that you have the right to submit it and agree that:

1. The contribution may be distributed to users under the current iPolloWork Source Available License and any future version of that license; and
2. You grant Different AI, Inc. a perpetual, worldwide, non-exclusive, irrevocable, royalty-free license to use, reproduce, modify, distribute, sublicense, and commercially license the contribution as part of iPolloWork and related products.

Third-party code must keep its original copyright and license notice. Identify the source and license in the pull request. Do not submit code that cannot legally be included under these terms.
