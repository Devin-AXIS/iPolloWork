# Website Rules

Use for `site`: websites, landing pages and portfolios. Read `design.md` and shared guidelines first.

## Content and layout

- Organize around audience, main promise, evidence and intended action. Sample feature, pricing and testimonial sections are optional patterns, not quotas. Never invent prices or endorsements.
- Reuse fitting source or supplied library sections; adapt or compose new sections in the current visual language. Do not reduce every relationship to a card grid.
- Use semantic landmarks and coherent headings. Align DOM and visual reading order; navigation labels must lead to real destinations.
- Use fluid layouts, readable measure, flexible media and content-driven breakpoints. Inspect narrow phone, intermediate and desktop widths, including the intended minimum width. Do not shrink a desktop canvas into unreadable mobile content.

## Assets and interaction

- Apply shared asset/model rules. Product and context imagery may help without being indispensable. Set intrinsic image dimensions, suitable alternative text and deliberate crops at each width.
- Keep primary content readable while media loads and when motion is reduced or enhancement fails. Animation must not block reading.
- Test menus, anchors, links, forms and primary actions with pointer and keyboard. Handle focus, validation and supported loading/error/success states. Never present local prototype feedback as a real service submission.
- Preserve the supported runtime; a static HTML task does not authorize a backend or app source changes.

## Acceptance

Call `media/artifact_preview_review` once with the active `sourcePath` and `kind="site"`. It uses the running client's Design renderer and hydrated project assets to review desktop and mobile viewports together. Treat its blank, broken-media and horizontal-overflow findings as repair inputs, then call it once more only if those findings required changes. Do not start an HTTP server, create a preview wrapper, use generic browser tools, or capture widths in separate calls. Exercise affected destinations, menus and form behavior once through the supported product surface; do not repeat unrelated interactions for a content-only edit. Report disconnected integrations and interaction gaps that the batch action cannot prove.
