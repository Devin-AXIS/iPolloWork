# Website Template CTA Interactions

## Goal

Every control in a bundled website template that visually presents itself as actionable must produce an observable result. A template must not ship with decorative buttons that silently ignore clicks.

This applies to all bundled templates whose manifest category is `site`, including desktop and mobile navigation.

## Interaction Rules

Each actionable control uses the most specific available behavior:

1. Navigation controls scroll to an existing section or open the declared local or external destination.
2. Toggle controls update their selected state and the content or values they govern.
3. Forms validate their inputs and show an inline success result after a valid submission.
4. Calls to action without a real destination show a concise, template-local acknowledgement that matches the label's intent.

The fallback acknowledgement is a visible result, not a browser `alert`. It uses an accessible status element so keyboard and assistive-technology users receive the same feedback. Repeated activations update the same status element instead of creating duplicate UI.

## Template Implementation

Existing native semantics remain the source of truth. Links keep `href`; submit controls remain attached to forms; section links use anchors. A small template-local runtime handles only controls that otherwise have no behavior and interactive demonstrations such as billing-period switches.

Controls declare fallback intent with an explicit data attribute rather than guessing from button text at runtime. This keeps copied or AI-edited templates predictable. Mobile navigation toggles are navigation infrastructure and retain their existing behavior.

All template scripts execute inside an isolated function scope. Templates must not introduce top-level lexical declarations that can conflict with the Design preview runtime or another inline script.

## User Feedback

Fallback feedback appears near the activated control or in one shared page-level status region. It states the observable outcome in plain language, for example that a plan was selected or that a request was received. It does not claim that an account, purchase, or external request was actually completed.

Interaction feedback must be visible, keyboard-operable, and exposed through `role="status"` or `aria-live="polite"`. Buttons receive an explicit `type` so they never submit a surrounding form accidentally.

## Validation

Automated template-market tests cover every bundled `site` template and enforce:

- every visible button has submit, navigation, toggle, or explicit fallback behavior;
- every link has a non-empty destination;
- inline scripts parse together in document order without global declaration conflicts;
- mobile navigation controls retain their accessible expanded state;
- required fallback status markup and runtime hooks are present when a template uses fallback actions.

Focused behavior tests cover at least one navigation action, one toggle, one valid form submission, and one fallback CTA acknowledgement. The real Design preview is then exercised to confirm the observable interaction path; if the repository's fraimz tooling is unavailable, the limitation and exact manual reproduction steps are reported rather than claiming full end-to-end proof.

## Scope

This change updates bundled website templates and their template validation only. It does not add backend signup, authentication, billing, or sales integrations, and it does not change slide, poster, app, or video templates.
