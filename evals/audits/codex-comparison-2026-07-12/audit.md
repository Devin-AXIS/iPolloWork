# iPolloWork vs Codex desktop design audit

## Audit scope

- Surface: desktop conversation workspace.
- User goal: direct an agent, follow progress, review output, and continue the task without interface clutter.
- iPolloWork evidence: live debug client at `http://localhost:5173` captured through Electron CDP.
- Codex evidence: official OpenAI Codex thread screenshot from OpenAI Academy.
- Comparison: `03-side-by-side.png`.

## Steps

1. iPolloWork current conversation — functional, but visually fragmented.
2. Official Codex conversation reference — healthy, with a clearer thread hierarchy.

## Strengths

- iPolloWork already follows the useful three-part desktop structure: navigation, conversation, contextual work surface.
- The composer is persistent and contains the controls needed for agent, model, effort, attachment, and run.
- Workspace and team switching is visible without leaving the conversation.
- The removed bottom status strip brings the main surface closer to Codex's quieter structure.

## UX risks

1. The main content reads like a document viewer rather than a conversation. Turn boundaries, the user's request, agent progress, and the final answer are not visually distinct enough.
2. The left sidebar has weak contrast and unclear selection. Workspaces, session types, and conversations compete at nearly the same visual weight.
3. The persistent right tool rail exposes too many icon-only destinations. Codex keeps secondary work surfaces behind fewer contextual controls.
4. Header content is noisy. `已连接`, notification controls, and `Reset notifications` compete with the task title; the English debug/reset copy is especially distracting.
5. The composer is too wide and shows too many choices at once. The primary action is visually weak while model, agent, and effort controls receive similar weight.
6. Mixed Chinese and English copy makes the product feel unfinished: `Jump to start`, `Reset notifications`, `Create a Group`, model names, and Chinese controls appear together.

## Accessibility risks

- Sidebar text and icons have visibly low contrast against black.
- Several icon-only rail actions rely on tooltips and are difficult to identify at a glance.
- Muted composer text and the disabled run button are close to disappearing on the white surface.
- Screenshot evidence cannot confirm keyboard order, focus visibility, screen-reader labels, or zoom reflow.

## Recommended order

### P0 — make the thread feel like a conversation

- Add a restrained user prompt bubble.
- Group agent work/progress into a compact expandable row.
- Separate the final response from intermediate activity.
- Keep a consistent readable content width and reduce the empty right-side field.

### P1 — simplify navigation and chrome

- Increase sidebar contrast and add one obvious selected-session pill.
- Reduce the right rail to one contextual side-panel toggle plus the active artifact state.
- Keep only title, workspace, search, and notifications in the header; remove visible reset/debug copy.
- Finish locale consistency across the complete shell.

### P2 — tighten the composer

- Reduce width and make it a centered floating card.
- Keep attachment and the primary agent choice visible.
- Move model and effort into quieter secondary controls.
- Strengthen the send/run action and make running, queued, and interrupted states visually explicit.

## What not to copy

- Keep iPolloWork's personal/team workspace switcher.
- Keep agent type and artifact surfaces, but reveal them contextually.
- Do not copy Codex's git/branch language into non-code workflows.

## Evidence limits

- The Codex reference is an official OpenAI screenshot, not a capture of the user's current local Codex window.
- This audit covers the visible desktop conversation state only; it does not establish full accessibility compliance.
