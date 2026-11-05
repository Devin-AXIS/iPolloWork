---
name: context7-version-aware-implementation
description: Use the current project dependency versions and Context7 documentation to implement or upgrade code without importing APIs from a different release line.
disable-model-invocation: false
---

# Context7 Version-Aware Implementation

1. Inspect the project manifest and lockfile to establish the exact dependency version.
2. Retrieve documentation and migration guidance for that release line.
3. Compare the current code with the documented API before editing.
4. Implement the smallest compatible change and preserve established project patterns.
5. Run the owning package checks and report any behavior that still requires runtime verification.

If the requested API is unavailable in the installed version, explain the supported alternative or propose an explicit dependency upgrade instead of silently mixing versions.
