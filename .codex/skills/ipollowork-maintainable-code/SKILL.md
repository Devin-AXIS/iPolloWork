---
name: ipollowork-maintainable-code
description: iPolloWork coding skill for feature development, fixes, refactors, tests, data changes, and packaging. Use for every product code change to reuse existing owners and preserve compatibility with DSH upgrades and in-app updates for existing users.
---

# iPolloWork Maintainable Code

Read [AGENTS.md](../../../AGENTS.md), the owning package instructions, and the normal entry point. Search existing components, schemas, routes, services, and tests before adding code. Extend the narrowest existing owner. Keep DSH integration in product plugins or the desktop shell, account authorization in the owning service, and runtime artifacts under the existing user or workspace data directory.

## DSH compatibility

- Apply this check to every feature and fix. Read the pinned DSH version in [upstream.json](../../../integrations/runtime/upstream.json) and trace affected host, client, desktop, and service contracts.
- Use public DSH APIs, typed extension points, and declared slot and event contracts. Keep `.upstream/dsh` and the upstream Agent, launcher, and plugin manager intact. Isolate version-sensitive code at the product boundary. Detect optional capabilities and use a supported fallback or a clear unavailable state when absent. Preserve permission checks, credential protections, and user data in fallback paths.
- When a change relies on DSH behavior, update the [compatibility record](../../../integrations/runtime/compatibility.md) and its Chinese counterpart with the owning files, exact dependencies, and how to reproduce the check against the next pin. For a pin change, use the actual candidate runtime to exercise the affected feature and plugin lifecycle.

## Existing users and in-app updates

- Consider supported existing installations for every change. Preserve usable accounts, sessions, projects, files, settings, local links, and plugin versions and enablement. Keep installation identity, data paths, and persistent formats stable or provide a tested migration. Exercise the old data shapes and client, service, or runtime combinations affected by the change.
- Make migrations safe to retry and recover after interruption. Preserve working access where a compatible path exists. When continuing would leave an unusable profile, present the existing recovery or compatibility flow before modifying the installation. Never require users to reset their profile or reinstall just to complete a normal upgrade.
- Use affected package checks and focused regression tests for coding changes. For a desktop release, DSH pin change, or change to the update path, follow [desktop upgrade qualification](../../../.agents/skills/desktop-upgrade-qualification/SKILL.md). Use the real in-app updater and exact candidate package from the current published version and one older supported version. Verify restart into the new version and DSH runtime, old user data, plugin compatibility, and recovery on failure. Exercise product-only and DSH-changing updates when the change affects both paths. State which upgrade combinations were actually tested.
