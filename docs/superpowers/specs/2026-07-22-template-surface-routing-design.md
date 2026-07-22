# Template Surface Routing Design

## Goal

Opening a materialized template entry must always open its owning editor, even when the template-session metadata request is still in flight.

## Scope

The change applies only to entries that belong to a stored template session. Ordinary workspace HTML files keep their existing artifact preview and source-editing behavior.

## Routing Contract

1. A template session has a persisted `surface` (`design` or `video`) and an entry path.
2. A click on that session's entry waits for the session binding when it has not finished loading.
3. `surface: "design"` opens the Design panel.
   - `category: "slides"` uses the existing deck/pagination behavior and may expose PPTX-compatible export.
   - Website, app prototype, poster, info card, report, article, and other design categories use the same Design panel without PPT-specific behavior.
4. `surface: "video"` opens the Video Studio.
5. A file with no template-session binding remains a normal artifact; HTML keeps the existing HTML preview/source-editor path.

## Failure Handling

If the lookup concludes that there is no template-session binding, routing falls back to the current artifact behavior. A failed lookup must not reroute an ordinary file or guess from its filename.

## Implementation Boundary

Extract a small, pure route resolver that consumes an open target plus optional template-session metadata and returns `design`, `video`, or `artifact`. The SessionPage click handler owns the asynchronous metadata wait and then delegates to this resolver. This keeps surface routing independently testable and avoids duplicating the decision in the Design, Video, and artifact panels.

## Regression Coverage

Tests cover these outcomes:

- a Design-category template entry resolves to `design`;
- a Slides/PPTX-compatible template entry resolves to `design`;
- a Video template entry resolves to `video`;
- a normal HTML file resolves to `artifact`;
- a click issued before metadata is available waits, then routes according to the resolved surface rather than briefly opening the artifact panel.

## Non-goals

- Do not change template rendering, PPTX export, or Video Studio functionality.
- Do not change how ordinary files are classified as artifacts.
- Do not infer template ownership purely from `entry.html` or `index.html` filenames.
