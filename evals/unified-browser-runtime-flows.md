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
  `ipollowork_browser_read`, `ipollowork_browser_snapshot`,
  `ipollowork_browser_screenshot`, `ipollowork_browser_act`, and
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

## Flow 3 — complete semantic actions and bounded waits

1. Snapshot labelled hover, native select, checkbox, and scrollable controls.
2. Hover by ref and wait for accessible text instead of sleeping blindly.
3. Select one exact native option, check the requested state, and scroll by one
   bounded amount, taking a fresh snapshot whenever requested.
4. Use Enter or Space only with a stable ref and exact accessible name.

Pass criteria:

- Hover, select, check, scroll, and structured waits all use the same
  `ipollowork_browser_act` contract for every engine.
- URL, accessible text, ref visibility, and document readiness waits are
  bounded to 10 seconds each and 10 seconds per action batch.
- Select rejects missing or ambiguous options; check is idempotent; radios
  cannot be unchecked; Enter and Space cannot bypass named-ref validation.
- No engine-supplied JavaScript, CSS selector, or coordinate is accepted.

## Flow 4 — stale and unsafe targets fail closed

1. Take a snapshot, then navigate or replace the referenced control.
2. Attempt to act with the old `snapshotId` or ref.
3. Attempt a click with an `expectedName` different from the current accessible
   name, then cover or disable the target and retry.

Pass criteria:

- Every attempt is rejected with guidance to take a new snapshot.
- No selector fallback, synthetic DOM `.click()`, or arbitrary evaluation is
  used.

## Flow 5 — modern document coverage

Use a deterministic fixture containing an open/closed shadow tree, a same-origin
frame, a cross-origin frame, an off-screen control, and a file input.

Pass criteria:

- Semantic controls reachable through Chromium accessibility/CDP receive refs
  across supported shadow/frame boundaries.
- Off-screen controls are scrolled into view before interaction.
- Upload accepts only registered-workspace files or the named plugin's private
  data, at most 20 files and 1 GB per file.
- Unsupported boundaries fail clearly without falling back to page scripts.

## Flow 6 — engine switching keeps one browser session

1. Sign into a test site with one engine and keep the browser tab open.
2. Switch engines in the same workspace.
3. Use the new engine to snapshot and continue in the returned `tabId`.

Pass criteria:

- The same tab, cookies, login state, proxy, and browser permissions remain.
- A new engine does not start Chrome or create another browser runtime.

## Flow 7 — consequential controls require approval

1. Snapshot a page containing publish, send, submit, pay, buy, confirm, and
   delete controls.
2. Ask the agent to click one, then deny approval.
3. Repeat and approve once.

Pass criteria:

- The first attempt pauses before the click and is not retried after denial.
- The approved attempt performs exactly one verified click.
- The workspace audit records the actor, tab, and browser action.

## Flow 8 — extension UI remains optional

1. Open the composer Extensions menu and select iPolloWork Browser.
2. Disable/hide it, verify it disappears from the composer, then restore it.
3. Open Settings -> Extensions -> Marketplace and import another package.

Pass criteria:

- Selecting the extension inserts its composer label without exposing raw
  prompts or tool parameters.
- UI enablement affects discovery without installing an engine-specific
  browser runtime.
- Marketplace import and other extensions remain unaffected.

## Flow 9 — compact reading and scoped semantic changes

1. Read the fixture with `ipollowork_browser_read` in page, article, links,
   tables, and forms modes.
2. Take interactive-only and content-only snapshots, scope a later snapshot to
   one stable ref, then request a delta without changing the page.

Pass criteria:

- Reading returns bounded headings, text, safe links, tables, and form labels
  without protected values or the full accessibility tree.
- Snapshot mode and scope omit unrelated content while refs remain host-owned.
- An unchanged delta returns a short unchanged result and reports saved
  characters; a changed delta falls back to the full tree when that is smaller.

## Flow 10 — act and observe in one bounded call

1. Snapshot the fixture and call `ipollowork_browser_act` with `observe`.
2. Perform a verified action, optionally wait for document readiness, and let
   the host settle briefly before it captures the new semantic state.

Pass criteria:

- The result contains the action record and a fresh snapshot with current refs.
- `snapshotRequired` is false because the observation is already current.
- Timing and returned-character metrics are present without persistent tracing.

## Flow 11 — visual fallback stays selective

1. After a semantic snapshot, capture the viewport, a bounded region, and one
   referenced element.
2. Request an annotated capture and then repeat it with `ifChanged`.

Pass criteria:

- Screenshots are PNG files owned by the Desktop Host; MCP clients receive the
  image directly while other engines receive a local `imagePath` to inspect.
- At most 40 visible semantic refs are overlaid, and the overlay is removed
  immediately after capture.
- An unchanged repeat reports `changed=false` and does not resend image bytes.

## Flow 12 — efficiency contract is engine-neutral

Switch between installed engines and inspect their browser tool declarations.

Pass criteria:

- Read, snapshot modes/deltas, act observation, screenshots, and metrics all
  come from the same host runtime and schemas.
- No adapter adds selectors, coordinates, arbitrary JavaScript, OCR, or its own
  screenshot implementation.
