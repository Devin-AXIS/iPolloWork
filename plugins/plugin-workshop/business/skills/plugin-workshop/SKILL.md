---
name: plugin-workshop
description: Build, preview and package installable native DSH plugins for iPolloWork.
---

Read the current repository AGENTS.md and docs/plugin-development.zh.md. Create a native ESM DSH Bundle with package.json exports, engines.dsh and dsh.bundle.patch. Register tools, Skills, authenticated routes and client slots through the native lifecycle. Never copy the old host or Agent loop. Keep credentials in the Host provider, enforce workspace and read-only permissions, and release registrations on disable. Build and check the package, inspect npm pack --dry-run, and test its actual .tgz in a disposable DSH_HOME. Deliver the package for installation in the native Plugin Manager. Publishing or deploying requires the user's request.
