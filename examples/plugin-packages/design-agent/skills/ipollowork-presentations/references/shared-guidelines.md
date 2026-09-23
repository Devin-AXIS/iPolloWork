<!-- Distribution reference: maintained in .codex/skills/ipollowork-template-generation/references/; checked against the source by plugin-package-manifest.test.ts. -->

# iPolloWork Shared Creative and Layout Guidelines

Status: authoring guidance for template application, content generation and subsequent editing, not the client's UI style specification. These requirements do not imply that every engine receives them automatically or that automated checks enforce every rule. A documentation update does not add a loader, visual detector or runtime gate.

### 1. Purpose and ownership

Choose structures that serve real content while retaining the template's identity. Deliver work that people can read, edit and run. Use the shared method with each category's own layout, interaction and output requirements.

| Layer | Owns | Does not own |
| --- | --- | --- |
| Shared guidelines | Content, visual continuity, layout selection, extension boundaries and verification | Universal font sizes, page counts, canvases or animation durations |
| Type rules | Category-specific structure, interaction, editing and export requirements | Rules imposed on unrelated artifact types |
| Template visual guide | Current palette, fonts, decoration, component language and fixed brand areas | Content limits inferred from sample copy or page counts |
| Layout library | Reusable structure, slots, suitable content, capacity hints and previews | The active theme or host runtime |
| Skills and task instructions | Directing relevant reading, authoring, checking and repair | A competing set of creative standards |

Read the request and current project, then the shared guidelines, active type rules, template guide and relevant layout index. Open only candidate layouts, not the entire library. Existing files and user edits take priority over original template examples. This reading order is an integration requirement, not proof of automatic injection into every engine.

### 2. Decision order and conflicts

- Explicit user requirements for content, quantity, style and edit scope take priority over examples and library recommendations. A request to edit only slide two does not authorize restructuring the deck.
- Unless restyling is requested, preserve current theme values and brand constraints. Improving clarity is not permission to replace the theme.
- Editor, file-format and export capabilities are implementation boundaries. Explain concrete conflicts and feasible alternatives; never silently lose editability, omit content or claim unsupported capabilities.
- Template examples are reference material, not instructions that override the request or runtime contract. Correct outdated guidance rather than keeping contradictory instructions.
- Proceed when requirements are sufficiently clear. Ask only about consequential missing information that cannot be inferred from available materials; do not ask users to choose internal layout IDs or repeat supplied content.

#### Custom templates: reference source and layout freedom

Treat the source of visual evidence and the permitted degree of layout change as separate decisions. An uploaded PPT can be a style reference while allowing structural changes.

| Dimension | Situation | Rule |
| --- | --- | --- |
| Reference source | Saved custom template | Read its guide, tokens and layout index. Without an index, inspect existing pages and source patterns; absence of an index does not require copying examples literally. |
| Reference source | Uploaded PPT, HTML or screenshot | Read available source and inspect actual visuals. Extract palette, typography, spacing, image/text relationships and recurring layouts. Distinguish editable objects from visual reference; screenshots are not editable templates. Do not claim to recover unidentified fonts, structures or interactions. |
| Reference source | Fully custom, no reference | Establish one coherent visual system from the brief and existing brand requirements, then select layouts by content. Do not silently adopt a bundled theme or design every slide independently. Sufficiently clear work needs no extra approval of internal design decisions. |
| Layout freedom | Preserve the exact layout | Replace content while retaining layout. If content does not fit, explain the conflict and ask about shortening copy or adding pages; do not silently shrink text, omit facts or rearrange objects. Screenshot recreation still has source and editability limitations. |
| Layout freedom | Retain style, adapt layout | Preserve visual identity while reusing, combining or extending structures. Shared layouts must not introduce another palette, font system or runtime. |

Default template application retains style while adapting structure to content. Exact-layout mode applies only when explicitly requested or already agreed. Preserve prior choices without asking again; clarify only ambiguity that materially affects the result. Targeted edits protect unrelated pages and objects. Theme-only edits preserve content and geometry; the default freedom does not expand either scope.

Sample copy, page counts, data and assets are not automatically user requirements or verified facts. Check the active import, editing and export path: editable objects in the source file do not prove that the current importer preserves them. Disclose unsupported or unreadable parts; do not present flat screenshots as editable delivery.

Acceptance must distinguish saved templates without indexes, editable uploads, screenshot-only references and custom work without references, as well as exact-layout versus adaptive modes. Claim verification only for combinations actually exercised; bundled-template tests do not prove all custom-template cases.

### 3. Content before structure

Identify audience, purpose, main message, supporting material and intended action before organizing pages, sections or scenes.

- Content determines page count, scene count and duration. Examples are not quotas. Only explicit user quantities constrain the result; distinguish approximate targets from strict limits.
- Separate facts, goals, assumptions and unresolved information. Never invent data, sources, testimonials, customer logos, prices or outcomes to fill a layout.
- Preserve important facts, conditions, units and source relationships. Tighten wording without removing qualifications or evidence merely to fit.
- An empty slot may mean the structure is unsuitable. Remove unnecessary slots or change layout instead of padding with meaningless copy.
- Produce actual files when information is sufficient. If confirmation is necessary, pause only dependent work. A confirmed video script does not need the same approval again.

### 4. Preserve visual identity

- Retain the current palette, typography, radii, decoration and overall character by default. A new topic or audience does not authorize a brand redesign.
- Use current semantic `--ipw-*` tokens. Keep structural CSS separate from theme values; do not create another theme in inline styles or scripts. Follow the Design-System Layer contract below where applicable.
- Shared layouts supply structure and capacity guidance. Map them to the active visual language; omit preview palettes, fonts, hosts and demo scripts.
- Preserve proportions of logos, icons and photos. Keep fixed brand areas; update editable brand slots from user content. Demo logos are not customer endorsements.
- Do not categorically reject particular colors, serif fonts, gradients or symmetry. Judge readability, template intent and user requirements rather than imposing a universal aesthetic.
- Theme changes must not rewrite content, replace images or reorder pages. Check actual typography after font changes to catch new overflow.

### 5. Select and extend layouts

Identify the content relationship: statement, comparison, process, data, case study, hierarchy or summary. Compare local and shared patterns and prefer a suitable structure that retains the style; neither source has unconditional priority.

The catalog is a preferred reuse source, not an ID whitelist or a complete inventory of extracted templates. Local source patterns remain valid even when absent from the global catalog. When none fits, write a new layout within the current visual language and record its origin, relationship, slots and capacity in the page plan. A new ID, missing global registration or missing provenance attribute is not grounds for rejection. Validate content fit, rendered layout and type contracts. Do not label a one-off extension as a verified library pattern; admission requires separate real-content, client-preview and applicable export checks.

| Situation | Action |
| --- | --- |
| Relationship and capacity fit | Reuse, replace content and check actual rendering |
| Relationship fits; capacity differs slightly | Adjust columns, proportions, alignment, image/text area or optional slots |
| Relationship does not fit | Select another pattern; do not force a sequence into unordered cards |
| No suitable existing structure | Extend with the current template's visual elements and retain the type runtime contract |
| Exact layout is required but content will not fit | Explain the conflict and offer copy reduction or additional pages/scenes; do not omit content without permission |

Extension is not a theme change. Scope new CSS locally so one edit does not affect unrelated pages. Repeat structures when comparison benefits from consistency; do not force variety or turn everything into the same card simply for convenience.

Capacity is a selection hint, not a hard limit on user content. First tighten nonessential wording, then adjust space, choose a better structure or split within user constraints. Do not default to shrinking all text, compressing line height or clipping important content.

Fixed-canvas presentations retain the established aspect ratio and coordinate system. Do not use negative positioning, viewport-dependent `@media`/`@container` reflow or off-canvas hiding as overflow workarounds. Adjust structure, remove unused slots or redistribute content. `overflow: hidden` may define the canvas boundary, never conceal titles, body text or editable objects. An intentional local offset must be judged by actual bounds and output, not rejected solely because it is negative.

### 6. Hierarchy, spacing and Chinese typography

Each reading region should make the entry point, grouping and next step clear. Establish hierarchy through size, weight, position, whitespace and color without forcing every region into an identical heading scale.

- Keep roles consistent: peer headings, body copy, captions and data labels need coherent styles. Equal relationships use equal spacing; different relationships may use different spacing.
- Clearly associate headings with body copy, charts with captions, and values with units. Check both crowding and gaps that interrupt the reading relationship.
- Multiline Chinese titles must not inherit tight English leading or negative tracking blindly. Check the actual font, weight and canvas for glyph collisions; handle mixed scripts locally.
- Avoid short last lines consisting of a lone Chinese character and punctuation. Break at meaningful boundaries. `text-wrap: balance` helps but cannot replace screenshot review or guarantee intact phrases.
- Hard breaks that work on desktop may create orphans on narrow websites; check breakpoints. Do not convert a fixed PPT canvas into vertically stacked web content.
- Keep values, units, headers and notes aligned. Do not clip chart labels. Choose text sizes by artifact type, viewing distance and template rules; the client's 14px chat text is not a PPT or video body-text standard.
- Inspect reading rhythm and density visually as well as geometrically. Staying inside bounds does not establish good layout.

### 7. Color, media and motion

- Use color consistently for hierarchy, brand or state. Important distinctions must not rely on color alone. Check text, controls and charts against actual backgrounds; type rules define applicable contrast targets.
- Emphasis serves content. Do not impose arbitrary accent-color quotas or add glows, icons, cards and backgrounds foreign to the template language.
- Motion should support sequence, feedback or narrative. Website interaction and video storytelling do not share one fixed-duration rule. Reduced-motion interaction preferences must not silently rewrite an exported video's timeline.
- Video uses its supported deterministic timeline so seeking, playback and export agree. Web animation must not block reading or interaction and should support reduced motion where appropriate. Static deliverables need no decorative animation merely to demonstrate capability.

#### Asset selection, authorization and generation

This workflow applies to all Design categories and video. Shared guidance decides when assets are useful, when user input is needed and what delivery requires. The media workbench plugin and corresponding Skills own capability queries, model parameters, submission, job status and result placement; type rules must not implement competing call flows.

For initial creation and full redesign, decide useful visuals **before choosing layouts**. Scene, story, place, people, product and cover content normally merits image consideration; data/process/architecture normally merits editable diagrams. Suitable existing assets should be reused. Images need not be indispensable, and there is no image quota. A text-only attachment, an imageless catalog example, editable PPT mode or a self-chosen geometric style is not a reason to skip imagery. An illustration may evoke autumn or explain a warehouse scenario; label it as illustrative and never claim it is documentary evidence.

Use one three-step workflow for template application and custom creation:

1. **Plan and query.** Discover `media/artifact_media_review` through the host extension tools and call `phase="plan"` once before layout. Pass the active workspace-relative HTML `sourcePath` and concise `needs` (`id`, `purpose`, `kind`: `image`, `video`, `reuse` or `diagram`). The host records the plan in the existing `brief.json` and performs live capability queries for image/video needs. Reuse that result for the task; query again only when the requested operation, model choice, authorization state or failed submission materially changes. Read the returned capabilities; plugin installation or a chat model name is not proof of media authorization. Do not write a separate assessment document. An empty plan requires a specific exemption (`explicit-text-only`, `no-generation`, `local-edit`, `theme-only`, `existing-assets` or `diagrams-sufficient`) and reason grounded in the user's scope and content. Do not use diagrams-sufficient merely because shapes can be drawn. Reuse needs still require delivery placement checks. Keep existing planned needs across retries.
2. **Resolve and produce.** Use the model-selection table below, then the image-generation/media-use Skill for actual generation, saving and insertion. Do not ask for per-page approval or another generation confirmation within authorized scope. Preserve real evidence, relevant existing files, and scope/cost constraints. Call job status/recovery for uncertain submissions before retrying. A submitted request is not a saved asset. Save to the current project's `assets/` and use relative URLs. If capability querying, authorization or generation fails, continue independent file work with a coherent fallback and report the specific limitation; do not open settings or wait for authorization. Keep an image pending only when the table explicitly requires a user decision.
3. **Check before delivery.** Call `media/artifact_media_review` once with `phase="check"`, the same `sourcePath`, and one outcome per planned id after asset placement is settled. Use `generated`/`reused` with a project-relative `path`; a generated copy also includes the original workspace-relative `generationPath` returned by the tool. The host verifies nonempty files, HTML/CSS references and actual session generation receipts. Use `diagram` only for a planned diagram. Pending or missing items must be resolved; a second empty plan or geometric replacement does not satisfy a planned image. `declined`, `unavailable` and `failed` require specific reasons and are reported partial media delivery, not successful generation. Preserve the actual tool/user evidence; the validator does not independently prove consent, authorization failure or relevance. Independently preview the final result to check cropping, visibility, meaning and playback. Repeat the check only after outcomes or paths change. If the host review action itself is unavailable, disclose that verification gap rather than claiming it ran.

| Model condition | Action |
| --- | --- |
| User explicitly selected an available, suitable model | Use it; preserve the choice within the task |
| Explicit model unavailable or unsuitable | Use an authorized equivalent automatically only when provider, cost and capability do not materially change; otherwise explain and ask once while continuing independent work |
| No explicit model; verified suitable saved preference or approved automatic-selection policy | Follow it within scope and cost settings |
| Exactly one suitable authorized model and no preference | Use it within scope |
| Multiple suitable models and no preference/policy | For routine requested or supporting media, use the suitable authorized `defaultModel`, or the first suitable authorized model in returned product order. Ask only for a requested choice or a material provider, cost or capability tradeoff; never leave an asset pending solely because multiple models exist |
| No authorized suitable model | Continue the file with reuse or a coherent editable fallback and report the unavailable asset; do not guide to settings |
| Query failed | Report capability as unknown, not unauthorized; continue with a disclosed fallback |

The API's `defaultModel` is the product's computed automatic candidate for the current status response, not a saved preference. It may be used for routine generation within the authorized task, but must never be persisted as a user preference without an explicit request. Recheck capability when the model, operation, parameters or authorization changes, or an error requires it. Never request keys in chat or invent prices, budgets or authorization state.

The catalog owns structural relationships and reusable fragments, not media policy. Adapt a fitting layout to a useful asset; write a new composition when needed. Type rules add only medium-specific constraints: fixed canvas/editable objects for PPT, responsive loading for web, source evidence for reports, and timing/synchronization for video. Completion checks must exercise the actual query → selection → generation → saved file → insertion path; valid HTML or installed rules alone do not prove it.

### 8. Interaction and artifact state, where applicable

Apply this section only to interactive artifacts or regions. Static PPT pages do not need unrelated forms or queues.

- Buttons, links and menus need real destinations and appropriate pointer, keyboard and focus behavior.
- Cover normal, loading, empty, failed and successful states as relevant. Offer retry/cancel only when actually supported.
- Local prototype feedback is acceptable when clearly identified as disconnected from real services. Do not fabricate submission, payment or save success.
- Distinguish unfinished generation, partial delivery and editable outputs. Existing files do not mean the entire task is done. Link to real files and identify specific gaps.

### 9. Author, inspect and repair

1. **Read:** request, current project, type constraints, template guide and relevant layouts.
2. **Plan:** identify each page/section/scene's asset purpose, available files and gaps; query as required by section 7, then select or create structures. Explain key decisions briefly without requiring approval of internal layout IDs.
3. **Implement:** generate within existing authorization and model choices, save/place real content, preserve theme/runtime contracts and limit extensions to necessary changes.
4. **Programmatic checks:** run existing type/package validators once as an aggregate batch for what they actually cover and record tool names and results.
5. **Real experience:** render the artifact in one batch at target canvas/viewport sizes. Use aggregate thumbnails, contact sheets or equivalent output to cover the whole artifact, then inspect representative and flagged pages/sections/scenes at full size. Check requested formats only when requested or required by the active delivery contract.
6. **Local repair:** collect observed issues, repair them together, and retest affected areas in one targeted batch. Shared CSS/token changes require a batched whole-artifact recheck because their impact is global.
7. **Deliver:** provide real artifacts and distinguish verified, unverified and unfinished work.

Record asset verification separately from layout verification: purpose/gaps, actual required capability calls, reasons for generating or not generating, saved files and placement. Distinguish no generation needed, reuse, generated, unavailable authorization/tools, and query/generation failure. `unavailable` or `failed` is an accepted completion status when the file continues with a coherent fallback. Without call evidence, do not claim a query occurred or authorization is absent. A selected layout, valid HTML or verbal assertion cannot substitute for asset evidence. Keep records in the task, not additional user forms.

Self-checks include representative short content, long Chinese titles and dense content; type rules determine exact cases. Source checks cannot substitute for missing rendering/export access. Preserve files, state limitations and tie repair cycles to observed failures rather than regenerating the whole artifact repeatedly.

#### Executable verification and repair requirements

- Before authoring, establish available preview and capture entry points once. Discover export only when it is requested or required by the active contract. Prefer the client and supplied tools; if none is known, make one targeted environment check. Do not repeatedly scan the system or install browsers/dependencies to hide a verification gap. Continue independent work while marking visual acceptance unverified.
- Verify real content, final fonts and saved assets after fonts/images load. Record page/section/timestamp, observed issue, repair and recheck in the task's existing record; do not create a parallel project-file system.
- DOM bounds and resource checks identify candidates; screenshots establish reading quality. Neither excess `scrollHeight` nor successful package validation alone proves visual failure or success. Inspect title/body overlap, contrast on real backgrounds and obvious orphans in rendered output.
- Fix required issues directly when within authorization and scope. Do not deliver known defects as normal completed work. If repair conflicts with exact layout, fixed page count or theme-only scope, explain the concrete tradeoff and ask only about it.
- Default to one consolidated repair pass followed by one targeted re-render/recheck. If a must-fix defect remains, allow one additional targeted repair; then choose a simpler suitable structure or preserve the work and report the blocker. Never loop on optional polish. Recheck only affected areas unless shared styles/tokens changed, in which case run one batched whole-artifact check.
- Report content, structure, visual, editing and export results separately. Image generation success proves only the asset path; overlap means visual verification fails, and an unperformed export remains unverified.

### 10. Acceptance levels and implementation status

These are review categories, not claims of deployed automated enforcement. Preserve user files when reporting required repairs.

| Level | Examples | Delivery treatment |
| --- | --- | --- |
| Must fix | Missing/fabricated essential content, obscured text, broken assets, necessary interaction/playback failure, flattened output when editability is required | Do not claim complete acceptance; repair or identify the blocker |
| Should fix | Unrequested theme drift, title orphans, inconsistent peer styles, unclear grouping, visibly uneven spacing | Repair and review; explain justified exceptions |
| Optional refinement | Nonessential decoration, rhythm or motion polish | Stay within style/scope and do not delay essential delivery |

Actual automated coverage comes from service schemas, product validators and returned checks. Some package paths/fields, structures, variables and media timelines are checked; aesthetics, semantic completeness, Chinese line breaks and UX are not comprehensively automated. State conditions for screenshot, DOM and real-operation evidence.

### 11. Type boundaries and acceptance

Use the Design routing index to read only the active category. Existing PPT and Video workflows remain separate; shared principles do not impose one canvas or navigation model.

| Category | Additional requirements | Acceptance evidence |
| --- | --- | --- |
| `slides` | Narrative, capacity, fixed canvas, editable objects and export | Every slide covered by a batched render/blank-resource check; flagged and representative slides inspected at full size; requested exports inspected |
| `site` | Responsive sections, semantics, navigation/forms and loading | Representative widths and working primary actions |
| `app` | Task flows, data density, controls and states | Main flow and relevant empty/error/recovery cases |
| `poster` | Target canvas, focal message, safe areas and resolution | Complete canvas at target size and requested export |
| `cards` | Sequence, per-card capacity and series consistency | Every card, correct order and requested export count |
| `report` | Evidence, charts/tables, hierarchy and pagination | Source/value checks, full report and requested print output |
| `article` | Reading rhythm, attribution and publishing compatibility | Full reading flow and actual target transfer when available |
| `other` | Explicit medium and capability contract | Relevant borrowed checks and stated format limitations |
| `video` | Pacing, timeline, narration/captions and synchronization | Batched scene coverage, targeted seek/playback and requested exports |

Rule coverage is not tested generation coverage. Validate representative real artifacts category by category, then feed cross-type findings into the shared source. A successful PPT does not prove another category's rendering, interactions or exports. Define scope, counterexamples and verification before expanding libraries.
