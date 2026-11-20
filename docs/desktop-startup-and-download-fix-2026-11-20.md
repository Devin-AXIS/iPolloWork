# Mac startup and website downloads — 2026-11-20

## Diagnostic evidence

The supplied report identifies **iPollo 1.0.7, darwin arm64**, Electron 44.7.0. The executable was launched from a mounted `iPollo 1.0.7-arm64` volume. This report does not describe a 1.0.8 executable.

The required model service failed with `cannot get property "root" without inject`. Its `@deepseek-ai/dsh-llm` and `dsh-typert-protocol` modules came from the mutable desktop profile. The reported LLM package version was `0.2.0-rc.1`; the application and other native services used `0.2.2-rc.3`. The Agent loop and session controller could not activate because the LLM service never started. This is a mixed runtime dependency failure, rather than a model API-key rejection or an Apple signature rejection.

The operation history includes plugin installations. It supplies useful context but does not independently prove which installation introduced each hoisted package.

## Repair

Under the existing profile lock, compare known shipped DSH/Cordis core package versions against `desktop-runtime.json`. Move conflicting top-level profile entries to a unique `runtime-dependency-backups` directory with a journal, then launch through the unchanged official profile loader. Do not run a package manager or replace the user's settings, plugin bundles or task data. Restarting repeats the check if another plugin installation reintroduces an obsolete dependency. Unknown plugins and matching core versions remain untouched. Linked directories outside the profile are not modified through an ancestor junction.

The original dialog displayed only the last error lines, which could hide the failed plugin and original exception. It now retains the beginning and a bounded tail; the complete report remains available.

## Downloads

The live website matcher accepts `ipollowork-win-x64-1.0.8-unsigned.exe`. Its previous implementation waited up to five seconds for the unauthenticated GitHub Latest API, then fell back to the release page. A public API check during diagnosis returned HTTP 403. Thus the filename alone did not explain the redirect.

Publish the canonical versioned Windows website name and fixed per-platform `latest` filenames from hash-verified release payloads. Keep the existing automatic-update filenames and bytes. The website initializes supported-platform buttons to fixed direct links immediately and adopts the exact versioned URL if the API responds. Apple silicon/Intel selection remains available when the browser cannot determine the architecture.

## Verification boundaries

Local regression tests cover backup/idempotence/data preservation, bounded root-cause display, alias byte identity, incomplete-payload rejection and website API failure. Packaging adds a seeded old-core profile to the real Host smoke. Mac release qualification also mounts the completed DMG, copies the signed application, opens its real welcome window, checks the repair journal and captures a screenshot.

The earlier Intel Office timeout's underlying host-state mechanism remains unknown. Retaining the failed signed application avoids losing the diagnostic input and rebuilding it unnecessarily. This startup repair does not claim to identify that unrelated CI mechanism.
