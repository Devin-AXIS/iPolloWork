# Design Selection AI Copilot Design

## Goal

Let a user select one editable element in a Design/PPT canvas, invoke AI from the last control in the floating selection toolbar, and send a scoped request to the existing session conversation. The AI applies its edit directly to that selected element; the user can undo the resulting persisted edit.

## User flow

1. The user selects text, an image, or another editable element on a Design/PPT canvas.
2. The existing white floating selection toolbar shows an AI button as its final action.
3. Clicking the AI button creates one selection-context chip in the existing main conversation composer and focuses that composer. The chip uses the existing inline token behavior: it can be removed with Backspace as one unit.
4. The chip label identifies the selected object without exposing raw HTML, for example `H1 · 用AI重构企业智能运营`, `Image · hero-banner.png`, or `Paragraph · 一站式企业AI决策平台…`.
5. The user writes a request after the chip and sends it through the normal model/agent flow.
6. The request carries an invisible, structured instruction identifying the active Design file and exactly one target element. The agent must change only that element unless the user explicitly asks for a wider change.
7. The agent writes the Design file. When the agent turn completes, the canvas reloads the changed file and the normal chat transcript shows the result.
8. The Design toolbar Undo action restores the file snapshot captured immediately before that AI turn, including for PPT decks.

## Interaction boundaries

- The AI action is available only when an element is selected and the editor is active.
- The AI button is appended after the existing selection-toolbar actions, matching Office/Copilot-style contextual editing rather than adding a separate Design sidebar.
- Slide/deck roots and runtime controls remain non-selectable and cannot become AI targets.
- The existing normal conversation remains the only chat surface: model selection, streaming, stop, queued prompts, and transcript behavior are unchanged.
- A direct AI edit is not applied until the normal agent turn completes. The canvas will not present an unverified local simulation.

## Selection context

The selection context is stored in a session-scoped frontend store and contains:

- a generated context ID and display label;
- workspace/session IDs and the active Design file path;
- the exact pre-AI HTML snapshot and its file revision;
- element kind, element locator, text or original image source, selected style fields, and frame bounds.

The runtime provides a stable locator and user-facing summary for every editable selection. For image selections, the context uses the original workspace image source rather than a temporary preview data URL.

The main composer renders the context as a dedicated purple Design chip. Its serialized token resolves to a synthetic agent instruction that tells the agent to read the active file, locate the exact selected element, preserve unrelated elements, and make the requested update only within the target's scope.

## AI update and undo lifecycle

Before the request reaches the agent, the send path writes the captured pre-AI HTML to the active Design file if it differs from disk, so the agent always operates on the selected canvas state. The same snapshot is retained as an AI undo checkpoint.

When the agent turn returns, the Design panel reads the active file again. If its content changed, it updates the preview and adds the pre-AI checkpoint to the Design undo stack. Undo writes that checkpoint back to the workspace with the latest revision guard, reloads the iframe, and removes the checkpoint. If the agent did not alter the file, no undo checkpoint is added and the canvas remains unchanged.

Existing in-canvas edits continue to use their existing local history first. After those local changes are undone, the AI checkpoint is available to restore the prior persisted file version.

## Failure handling

- No active selection: the AI toolbar action is unavailable.
- A stale file revision before send: do not prompt the agent; report the write conflict and retain the chip for retry.
- Agent completion without a file change: leave the canvas untouched and state that no Design change was detected.
- Undo write conflict: do not overwrite the workspace; report the conflict and retain the checkpoint so the user can reload or retry deliberately.
- Missing target after an agent response: reload the changed Design file rather than attempting a brittle partial client-side patch.

## Files and responsibilities

- `apps/app/src/react-app/domains/session/design/design-html-runtime.ts`: enrich editable selection messages with stable element context.
- `apps/app/src/react-app/domains/session/design/design-ai-selection-store.ts`: keep selection contexts and AI undo checkpoints session-scoped.
- `apps/app/src/react-app/domains/session/design/design-panel.tsx`: render the contextual AI toolbar action, create a context chip, reload post-agent changes, and undo persisted AI changes.
- `apps/app/src/react-app/domains/session/surface/composer/mention-encoding.ts` and `editor.tsx`: support a Design selection chip in the composer.
- `apps/app/src/react-app/domains/session/surface/composer-state-store.ts` and `session-surface.tsx`: preserve the chip in a draft and convert it to a structured design-selection part.
- `apps/app/src/app/types.ts` and `apps/app/src/react-app/shell/session-route.tsx`: deliver the structured scope instruction to the agent, snapshot the selected source state before prompting, and notify the Design panel when the turn finishes.

## Verification

Automated tests cover:

- the AI action appears only for a selected editable element and is last in the floating toolbar;
- the selection chip label and structured context survive a composer draft round trip;
- text and image contexts include correct stable source data;
- the outgoing agent instruction restricts the request to one element and its active file;
- an agent-written change reloads the Design preview and creates a persisted undo checkpoint;
- undo restores the exact pre-AI HTML and does not overwrite on revision conflict;
- existing PPT selection, pan/zoom, toolbar deletion, and ordinary composer mentions continue to work.
