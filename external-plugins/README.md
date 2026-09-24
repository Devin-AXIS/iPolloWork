# External plugins

This directory owns independently installed integrations for third-party agent
hosts. Each host plugin is a self-contained package with its own manifest,
lockfile, build, and release lifecycle.

These are external-host integrations, not iPolloWork's in-product capability
packages or OpenCode workspace plugins.

Plugins here are intentionally excluded from the root pnpm workspace. Building
or installing iPolloWork therefore does not install them; each package is built
and published only by its own workflow.

Shared product behavior belongs in `packages/`. A host plugin should remain a
thin adapter around those contracts and must not fork Design Studio or Video
Studio implementations.
