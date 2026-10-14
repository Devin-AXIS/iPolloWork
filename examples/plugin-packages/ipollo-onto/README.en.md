# iPollo Onto

Version **0.1.5**, integrated in the iPolloWork plugin source collection from [upstream commit c209c8b](https://github.com/Devin-AXIS/iPollo-Onto/tree/c209c8b8ebdb36773232632e83a02de52360882f). Original branding, copyright, [LICENSE](LICENSE) and [NOTICE](NOTICE) are preserved.

Install the complete cloud package, enable it, and open the workbench. It uses the host's built-in SQLite runtime and its own data file: no PostgreSQL server, Node.js or pnpm installation is required. Projects, typed tables, relations, graphs, documents, views, import, automation, and scoped MCP remain available. Connect project MCP through the host's native settings using the real project URL.

The package includes its frontend, backend and dependencies. User databases, documents, encryption keys and imported extensions live outside the versioned installation and survive updates. Existing PostgreSQL data is not silently migrated. External PostgreSQL projects remain optional; that remote path was not revalidated without credentials.

For development, install this package's frozen dependencies with pnpm --ignore-workspace, then run build and test. The host's canonical packaging scripts create and sign dist/package; signing keys stay outside the archive. See [Chinese development and data guide](README.md) for commands and boundaries. This remains a trusted-local application rather than a multi-user authenticated service.
