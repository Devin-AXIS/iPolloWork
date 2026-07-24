# Step 7 - Final Review

- The plugin platform has no production import or call to Authorization Center or the global environment credential store.
- Raw credentials are encrypted at rest and are not returned through settings or action-list APIs.
- Local-service actions receive a plugin-bound capability and are callable through the existing OpenCode extension tools. Services are lazy singletons and are disposed at every lifecycle boundary.
- Active accounts and refreshed tokens persist in the encrypted plugin vault; skills and the model never receive provider login material.
- Declared skill/service/authorization relationships drive readiness, so a partially authorized package is not presented as ready.
- Existing schema-version-1 manifests remain accepted; current OpenCode and extension loaders are reused.
- `git diff --check` passes, the example package validates, and the pnpm lockfile parses with its restored `pptxgenjs` dependency.
- Hosted publisher accounts, review queues, artifact storage, and catalog rollout remain a separate external service; the local package and release contract is ready for that future service.
