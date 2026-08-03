# find-unused.sh

Wrapper around [knip](https://knip.dev) that detects unused-file candidates
and cross-references them against CI configs, build configs, package scripts,
TypeScript configs, runtime-discovered directories, and sibling repo CI/CD
pipelines to reduce false positives. It never deletes files.

## Usage

```bash
bash scripts/find-unused.sh
```

Uses the repository-pinned `knip` dev dependency through `pnpm exec`. A fake
`DATABASE_URL` is injected so config resolution doesn't fail.

The script auto-detects whether it's running inside a factory layout (`../../.._repos/`). When inside a factory, it cross-references sibling repos. When standalone, it skips sibling checks gracefully and still runs all internal checks.

## What it does

1. **Runs `knip --include files`** to get a list of unused files across the monorepo.
2. **Indexes infra files** — collects current build/config/CI files into a single searchable set:
   - GitHub workflow YAMLs
   - Build tool configs (Vite and tsup)
   - Build scripts (`.mjs`, `.ts`, `.sh` across all workspaces)
   - `.opencode` skill scripts
   - All `package.json` files (for script references)
   - All `tsconfig*.json` files (for path aliases and includes)
3. **Cross-references** each file against:
   - **Internal infra** — all indexed config/build files, searching by filename and relative path
   - **Convention patterns** — filenames like `postinstall` and `drizzle.config`
   - **Runtime-discovered dirs** — eval flows, Vite overlay entries, design-system assets, Electron entry files, local skills, and vendored HyperFrames
   - **Sibling repo CI/CD** — workflows, Dockerfiles, and build scripts in sibling repos and factory-level CI, with smart filtering to avoid false positives on generic filenames (e.g., `index`, `utils`, `config`)
4. **Displays results in two buckets** (oldest first within each):
   - `✗` **Unreferenced candidate** — no static or infra references found; manual runtime and product review is still mandatory
   - `⚠` **Convention/infra reference** — keep unless the owning runtime or workflow is retired too

A progress indicator shows the current file being checked during cross-referencing.

Certain paths are ignored entirely (scripts, dev tools) — see the `IGNORE_PREFIXES` array in the script.

## Using knip directly

The script only checks for unused **files**. Knip can detect much more — run it directly for deeper analysis:

```bash
# Unused exports (functions, types, constants)
pnpm exec knip --include exports

# Unused dependencies in package.json
pnpm exec knip --include dependencies

# Everything at once
pnpm exec knip

# Scope to a single workspace
pnpm exec knip --workspace @ipollowork/app

# Auto-fix removable issues (careful — modifies files)
pnpm exec knip --fix
```

See the [knip docs](https://knip.dev) for the full set of options.
