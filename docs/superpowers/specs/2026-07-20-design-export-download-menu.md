# Design Export Download Menu

## Goal

Replace the separate presentation export buttons with one localized download button that lets the user choose PDF or PPTX.

## Interaction

- Show one outlined download button in the existing design-panel toolbar.
- Use the application's current locale for the button label, accessible label, tooltip, and menu item labels.
- Open a dropdown menu aligned to the end of the button.
- Offer two actions: download as PDF and download as PPTX.
- Keep the existing PDF export implementation unchanged.
- Keep the existing PPTX confirmation dialog and export implementation unchanged.

## Loading and Errors

- Disable only the menu item whose format is currently being generated.
- Keep the other format available while one format is being generated.
- Disable the download trigger only when PDF and PPTX are both being generated.
- Show the existing loading indicator beside the format currently being generated.
- Preserve the current success and error feedback from each export path.

## Implementation Boundaries

- Reuse the existing `DropdownMenu` components and toolbar button styling.
- Add focused design-export translation keys to every supported locale, relying on English only as the safety fallback for future locales.
- Do not change file naming, PDF rendering, PPTX generation, or PPTX confirmation behavior.
- Do not refactor unrelated design-panel controls.

## Verification

- Add a focused UI test that verifies one download trigger replaces the two export buttons.
- Verify the menu exposes PDF and PPTX options and calls their existing actions.
- Verify PDF and PPTX loading states disable only their corresponding menu item.
- Verify the trigger is disabled only when both formats are loading.
- Verify labels update when the application locale changes.
- Run the focused test and the app typecheck.
