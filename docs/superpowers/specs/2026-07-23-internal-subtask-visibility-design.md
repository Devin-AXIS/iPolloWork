# Internal Subtask Visibility Design

## Goal

Keep agent-created internal subtasks out of every user-facing task list while
preserving the main task and user-created conversations.

## Scope

- Hide internal subtasks from the workspace sidebar.
- Hide the same records from the command-palette session switcher and session
  search, including the recent-session list.
- Do not delete, archive, or otherwise mutate the underlying OpenCode sessions.
- Do not hide user-created root tasks or user-created branches.

## Classification

The OpenCode session record is the source of truth. A session is an internal
subtask only when both conditions hold:

1. It has a non-empty `parentID`.
2. Its `agent` is an internal delegated-agent value rather than the main
   `orchestrator` agent.

The frontend must carry the optional session `agent` field into the shared
sidebar/session-list type. Classification must use this structured field,
never the task title such as `(@executor subagent)`.

This retains ordinary user conversations and explicit user branches, including
their `parentID` relationship, because they do not carry an internal delegated
agent identity.

## Data Flow

The workspace route already receives the complete list of OpenCode sessions.
It will derive a user-visible list with one shared predicate before producing
workspace session groups and palette/search session options. Internal subtasks
remain in the raw list for runtime bookkeeping (activity/reload safety and
direct-route handling), but never enter user-facing lists.

## Error Handling

Older or remote session payloads that omit `agent` remain visible. This avoids
hiding any session when its origin cannot be established.

## Verification

Add focused tests covering:

- an `executor` or `general` session with `parentID` is filtered out;
- an `orchestrator` session with `parentID` stays visible;
- a session with no `agent` stays visible;
- sidebar tree, session switcher, and search all receive the same filtered
  collection.
