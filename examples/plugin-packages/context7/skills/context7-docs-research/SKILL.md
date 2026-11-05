---
name: context7-docs-research
description: Resolve the correct library and retrieve a small, relevant set of version-aware official documentation before answering a technical question.
disable-model-invocation: false
---

# Context7 Documentation Research

1. Identify the exact library, framework, product, and version from the request or current project.
2. Resolve the library identity before querying documentation.
3. Ask focused documentation questions and keep retrieved context bounded.
4. Prefer API references, migration guides, and official examples that match the installed version.
5. Explain the answer with relevant API names and version constraints; distinguish documentation from inference.

Do not mix examples from incompatible major versions or claim undocumented behavior as guaranteed.
