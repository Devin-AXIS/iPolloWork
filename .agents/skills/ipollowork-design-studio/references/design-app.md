<!-- Distribution reference: maintained in .codex/skills/ipollowork-template-generation/references/; checked against the source by plugin-package-manifest.test.ts. -->

# Application Interface Rules

Use for `app`: screens, dashboards and interactive prototypes. Read `design.md` and shared guidelines first.

## Tasks and structure

- Identify the main user task, entry state, action and observable outcome. Select screens and states from that flow rather than copying a sample dashboard.
- Reuse navigation, controls, spacing and state language. Do not fill space with invented analytics, customers or activity.
- Choose suitable forms, tables, lists, inspectors and detail views. Marketing sections are not a substitute for a usable application flow.
- Keep the implementation boundary explicit: an HTML prototype may demonstrate local interaction, but does not establish authentication, persistence, payment or remote integration.

## States and assets

- Cover normal, loading, empty, invalid, failed and completed states needed by the flow. Keep transitions consistent; success must reflect an actual or clearly labeled simulated outcome.
- Preserve input after validation errors. Explain unavailable actions and protect destructive actions appropriately within the artifact's scope.
- Use labeled inputs, accessible state feedback, keyboard navigation and visible focus. Test menus, dialogs, escape/close and forms; do not rely on hover alone.
- Adapt dense navigation/data to narrow screens through intentional scrolling or alternate views, rather than clipping controls or squeezing labels.
- Follow shared media rules for meaningful product/content visuals. Prefer editable charts for data and consistent icons for navigation; decorative generation remains optional.

## Acceptance

Drive the primary flow from entry to outcome, including relevant empty/error/recovery cases. Check representative widths, long labels and realistic data volumes. Verify edit/save claims in the supported runtime. Distinguish prototype behavior from connected services and identify untested states.
