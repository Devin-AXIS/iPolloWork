# HyperFrames Video Template Rules

Use for the Video category. Maintain an `index.html` HyperFrames composition.

- Preserve composition IDs, stage dimensions, duration, tracks, clips, clip windows, sub-compositions, and timeline keys.
- Declare reusable variables with valid, stable, unique IDs and supported types; mirror them in the manifest exactly.
- Keep animation deterministic for every frame. Avoid ambient infinite animation, time-dependent randomness, and CSS transitions that make renders diverge.
- Keep media playback and sequencing framework-owned.
- Use design tokens for scene styling only; never move timing or track data into `design-tokens.css`.
- Verify variable defaults, timeline bounds, empty media, long text, and the full duration in Video Studio.
- Theme switching may change scene styling but must not alter timing, tracks, clips, composition roots, or media geometry.
