---
name: record-operations
description: Inspect operation recordings and compile reusable DSH Skill bundles.
---

Use `ipollo_recorder` with `action: status`, `review`, `import-chrome` or `compile` and an `input` object. `status` reads recordings; the other actions modify plugin-owned records and are unavailable in read-only sessions. Start, pause, resume, stop and request native capture permissions from the 操作录制 workbench. Recording never authorizes executing its workflow. Preserve redaction, variables, recorded intermediate checks and any missing final success condition. Compile creates an installable DSH `.tgz` bundle containing SKILL.md and references/workflow.json. It does not install or execute the generated workflow. Report drafts and actual validation separately.

Before refining, call `prepare` and read its quality gaps. Use `events` with `offset` and `limit` until nextOffset is null. Preserve recorded evidence and distinguish inferred intent. Supply the latest prepare revision as `expectedRevision` to `compile`; read again if rejected. The model cannot mark human approval. Generated packages include evidence.json and evals/evals.json; those cases are pending checks, not execution results. Saved exports reappear in the workbench only while their evidence revision still matches.
