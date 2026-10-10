---
name: notion-databases
description: Query and update Notion databases with explicit database identity, property-aware inputs, bounded reads, and confirmation before material writes.
disable-model-invocation: false
---

# Notion Databases

1. Resolve the exact database and inspect its current properties before composing filters or writes.
2. Use bounded queries and return only the properties needed for the task.
3. For create or update operations, show the target database, record identity, and changed properties first.
4. Preserve existing properties that the user did not ask to change.
5. Re-read the affected record after a write and report the resulting URL or identifier.

Ask for clarification when multiple databases have similar names. Never guess select values, relation targets, people, dates, or status fields.
