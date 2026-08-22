# Unified built-in browser flows

End-to-end scenarios for the single Desktop Host-owned browser runtime shared by
OpenCode, DeepSeek Harness, Codex Harness, and future engines.

## Architecture invariant

- The Desktop Host owns tabs, semantic snapshots, refs, real input, uploads,
  shared browser session, approval, and audit.
- Every engine discovers the same `ipollowork_browser_*` catalog from
  `/engine-tools`; adapters must not implement browser behavior.
- Product automation never needs a remote debugging port, an engine-specific
  browser plugin, arbitrary page evaluation, or CSS selectors supplied by a
  model.
- `IPOLLOWORK_ELECTRON_REMOTE_DEBUG_PORT` is an explicit development/evaluation
  switch only.

## Flow 1 — one catalog for every engine

1. Start the desktop development app with `pnpm dev`.
2. Inspect `/engine-tools` and the tool catalog exposed by each installed
   engine adapter.
3. Switch the current workspace between OpenCode, DeepSeek Harness, and Codex
   Harness where installed.

Pass criteria:

- Every engine exposes `ipollowork_browser_open_url`,
  `ipollowork_browser_snapshot`, `ipollowork_browser_act`, and
  `ipollowork_browser_set_proxy` with the same descriptions and JSON contract.
- No engine configuration or packaged resource refers to a separate browser
  automation plugin.

## Flow 2 — open, observe, and act

1. Call `ipollowork_browser_open_url` for a deterministic test page containing
   a labelled text field and button.
2. Call `ipollowork_browser_snapshot` with the returned `tabId`.
3. Fill the field and click the button in one `ipollowork_browser_act` batch,
   using only the returned `snapshotId` and refs.
4. Take another semantic snapshot.

Pass criteria:

- The right-side built-in browser visibly opens the page.
- The snapshot is bounded and contains accessible role/name lines with stable
  refs; protected values are absent.
- Fill uses real text input and click uses real pointer events.
- The final snapshot reflects the page change.

## Flow 3 — stale and unsafe targets fail closed

1. Take a snapshot, then navigate or replace the referenced control.
2. Attempt to act with the old `snapshotId` or ref.
3. Attempt a click with an `expectedName` different from the current accessible
   name, then cover or disable the target and retry.

Pass criteria:

- Every attempt is rejected with guidance to take a new snapshot.
- No selector fallback, synthetic DOM `.click()`, or arbitrary evaluation is
  used.

## Flow 4 — modern document coverage

Use a deterministic fixture containing an open/closed shadow tree, a same-origin
frame, a cross-origin frame, an off-screen control, and a file input.

Pass criteria:

- Semantic controls reachable through Chromium accessibility/CDP receive refs
  across supported shadow/frame boundaries.
- Off-screen controls are scrolled into view before interaction.
- Upload accepts only registered-workspace files or the named plugin's private
  data, at most 20 files and 1 GB per file.
- Unsupported boundaries fail clearly without falling back to page scripts.

## Flow 5 — engine switching keeps one browser session

1. Sign into a test site with one engine and keep the browser tab open.
2. Switch engines in the same workspace.
3. Use the new engine to snapshot and continue in the returned `tabId`.

Pass criteria:

- The same tab, cookies, login state, proxy, and browser permissions remain.
- A new engine does not start Chrome or create another browser runtime.

## Flow 6 — consequential controls require approval

1. Snapshot a page containing publish, send, submit, pay, buy, confirm, and
   delete controls.
2. Ask the agent to click one, then deny approval.
3. Repeat and approve once.

Pass criteria:

- The first attempt pauses before the click and is not retried after denial.
- The approved attempt performs exactly one verified click.
- The workspace audit records the actor, tab, and browser action.

## Flow 7 — extension UI remains optional

1. Open the composer Extensions menu and select iPolloWork Browser.
2. Disable/hide it, verify it disappears from the composer, then restore it.
3. Open Settings -> Extensions -> Marketplace and import another package.

Pass criteria:

- Selecting the extension inserts its composer label without exposing raw
  prompts or tool parameters.
- UI enablement affects discovery without installing an engine-specific
  browser runtime.
- Marketplace import and other extensions remain unaffected.
