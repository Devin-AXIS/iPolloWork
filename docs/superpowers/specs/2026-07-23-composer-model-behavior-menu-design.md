# Composer Model and Reasoning Menu Design

## Goal

Replace the Composer's two adjacent model and reasoning-strength controls with
one compact summary control and one menu hierarchy, matching the interaction
shape in the approved reference.

## Scope

- Change only the Composer control row in the session conversation surface.
- Replace the separate `ModelSelect` and `ModelBehaviorSelect` triggers with
  one summary button showing `model name · reasoning label`.
- The menu has a root view with two selectable rows:
  - **Model** — shows the current model and opens the existing searchable
    model-selection content.
  - **Reasoning strength** — shows the current behavior label and opens the
    current model's available behavior choices.
- Keep the existing model-unavailable warning and disabled/busy behavior.
- Do not change Settings, the full modal model picker, provider management,
  or task/session routing.
- Do not add a reset action, a new default-setting flow, or session-specific
  model/behavior overrides.

## Interaction

### Collapsed state

The Composer shows one rounded, low-emphasis button in the existing control
row. Its text is the current selected model label followed by a separator and
the current reasoning label, plus a downward chevron. If the active model has
no reasoning options, it shows only the model label.

### Root menu

Clicking the summary button opens a popover above the Composer. The root menu
contains `Model` and, only when choices exist, `Reasoning strength`. Each row
has a current-value summary and a right chevron. There is no reset/default
row.

### Child menus

- Selecting **Model** reveals the existing searchable, provider-grouped model
  list inside the same popover. Selecting a model retains the current
  behavior: it updates `local.prefs.defaultModel`; if it differs from the
  prior model, it clears `local.prefs.modelVariant`; then the popover closes.
- Selecting **Reasoning strength** reveals the existing choices for that
  model. Selecting a value updates `local.prefs.modelVariant` and closes the
  popover.
- A back control returns from either child view to the root menu. Escape and
  click-away close the popover. Keyboard focus remains usable through the
  existing command/select primitives.

## Data and Compatibility

No new preference or session state is introduced. The combined control is a
presentation and navigation wrapper around the exact current callbacks:

- Model selection continues through `ComposerProps.onModelChange`.
- Reasoning selection continues through `ComposerProps.onModelVariantChange`.
- The route continues to derive labels/options with `useModelBehavior`.

Consequently, the preferences page remains the source and editor of defaults,
and current behavior after switching model or reasoning strength remains
unchanged.

## Component Design

Create a Composer-specific combined picker component under
`domains/session/surface/composer/`. It owns popover open state and which
menu view is active (`root`, `model`, or `behavior`). It consumes the selected
model, behavior label/options, and the existing callbacks. It reuses the
model-listing/query behavior from `ModelSelect` rather than duplicating a
second provider/model-fetching path; the existing standalone `ModelSelect`
and `ModelBehaviorSelect` remain available to other UI surfaces.

`composer.tsx` becomes responsible only for passing the current props into the
new combined picker in place of the two existing controls.

## Verification

Add focused tests for the component's derived root entries:

- it renders a single summary trigger with model and reasoning labels;
- it omits the reasoning row when the active model has no behavior choices;
- selecting a model delegates exactly to `onModelChange`;
- selecting reasoning delegates exactly to `onModelVariantChange`.

Run the focused test, existing Composer-related tests, TypeScript typecheck,
and manually verify the Composer in the running desktop app: choose a model,
choose a reasoning strength, and confirm the summary updates with no separate
model/depth buttons remaining.
