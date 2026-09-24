# Video Studio component-to-motion map · core-v1

Use this index after selecting the scene's narrative job. It maps every registry block currently exposed to Video Studio to one primary temporal pattern. The mapping is a routing default, not a mandatory visual treatment: change the pattern when the actual content has a different narrative verb, and write a local treatment when none fits. Open only the chosen recipe and component source.

## Reading contract

- **Primary pattern** chooses the authoritative attention path. A component may support secondary motion, but it must not create a competing story.
- **Narrative capability overlays** form a many-to-many index below the primary table. They identify components that can implement `montage`, `camera-journey`, `dialogue`, `kinetic-type`, or `audio-reactive` when that overlay is the scene's actual primary narrative pattern.
- Selecting a component is an implementation decision, not visual inspiration. Install selected IDs through `media/video_component_install`, reference the returned composition, and retain `data-ipw-registry-component` plus `data-motion-pattern` in the host scene.
- **Typical phase** is a common placement, not a fixed sequence position. Content intent remains authoritative.
- **Seekable** means the registry manifest declares deterministic timeline seeking. **Legacy metadata** components may still animate, but must pass real-project playback checks before reuse.
- Preserve component editability, the active theme, narration timing, FPS boundaries, and one paused project timeline.
- This file must cover the exact current set of registry blocks whose manifest exposes the `video` surface. Coverage tests fail when a component is added, removed, or left unmapped.

## Executable motion routing

The component table chooses the scene body. It does not prove that motion covers a longer host scene. Bind every beat to one of these executable references and preserve the matching metadata in the saved HTML.

| Beat job | Animation reference | Typical preset choices |
| --- | --- | --- |
| Run the installed component's native sequence | `component:<registry-id>` | Limited to the component's recorded native duration |
| Bring in a new focal group | `preset:<preset-id>` | `element.enter.fade`, `element.enter.slide`, `element.enter.scale`, `motion.enter.content-reveal`, `motion.enter.gradual-focus`, `motion.enter.scan-reveal` |
| Shift attention inside an established scene | `preset:<preset-id>` | `element.emphasis.lift`, `element.emphasis.pulse`, `element.emphasis.tilt`, `element.emphasis.spotlight-card`, `element.emphasis.glare-sweep`, `motion.emphasis.soft-float`, `motion.emphasis.focus-tilt`, `motion.emphasis.magnetic-snap` |
| Emphasize a key phrase | `preset:<preset-id>` | `text.emphasis.highlight-sweep`, `text.emphasis.weight-shift`, `text.emphasis.kinetic-slam`, `text.emphasis.shiny-sweep`, `text.emphasis.true-focus` |
| Deliberately preserve a readable state | `hold:<reason>` | `hold:reading`, `hold:emphasis`, `hold:handoff`, `hold:outro`, `hold:media` |
| Express motion unavailable in the preset catalog | `custom:<specific timeline label>` | A finite, seek-safe timeline segment scoped to the listed targets |

Call `list_motion_presets` before choosing a preset and `mutate_motion` to apply it. The animated target must retain `data-ipw-animation-reference="<preset-id>"`. Do not write a preset name into the beat map without applying it. When a host lasts more than two seconds beyond a component's native duration, add a later preset/custom beat or shorten the host; an implicit frozen remainder fails acceptance.

### Incoming scene transitions

Full scene windows meet at one boundary. Every scene after the first uses one transition below at the beginning of the incoming scene and records `data-ipw-transition-in`, `data-ipw-transition-duration`, and `data-ipw-transition-intent` (`continue`, `topic-change`, `time-change`, `location-change`, `compare`, `reveal`, or `closure`).

| Transition | Duration | Use |
| --- | ---: | --- |
| `cut` | `0` | A deliberate immediate change with a visible incoming base state |
| `preset:element.enter.fade` | 0.35–0.8s | Quiet continuation or closure |
| `preset:element.enter.slide` | 0.45–0.9s | Directional continuation, time, or location change |
| `preset:element.enter.scale` | 0.35–0.75s | Focus change or reveal |
| `preset:motion.enter.content-reveal` | 0.6–1.2s | Structured topic change |
| `preset:motion.enter.gradual-focus` | 0.7–1.4s | Reveal from context into detail |
| `preset:motion.enter.scan-reveal` | 0.6–1.2s | Technical or analytical reveal |
| `preset:transition.depth-push` | 0.7–1.3s | Move from context into a deeper focal plane |
| `preset:transition.diagonal-slice` | 0.6–1.1s | Energetic chapter, time, or topic change |
| `preset:transition.lens-focus` | 0.7–1.3s | Reveal a subject from surrounding context |
| `preset:transition.split-wipe` | 0.6–1.2s | Directional handoff or explicit comparison |

Use the same transition for repeated continuity when that supports the story. Variety is not a quality target. Strong transitions belong only to real changes or reveals.

## Pattern summary

| Primary pattern | Default attention path | Recipe | Components |
| --- | --- | --- | ---: |
| `progressive-build` | Reveal ordered ideas, layers, or a statement in meaningful beats. | [progressive-build.md](progressive-build.md) | 34 |
| `focus-transfer` | Move attention among peers while their relationship remains visible. | [focus-transfer.md](focus-transfer.md) | 23 |
| `path-journey` | Advance a route, workflow, dependency, or chronology. | [path-journey.md](path-journey.md) | 28 |
| `state-transformation` | Make a before/after, correction, resolution, or completion legible. | [state-transformation.md](state-transformation.md) | 8 |
| `data-accumulation` | Build quantitative evidence, rank, distribution, or signal over time. | [data-accumulation.md](data-accumulation.md) | 33 |
| `asset-exploration` | Guide attention through media, an interface, a device, or social content. | [asset-exploration.md](asset-exploration.md) | 22 |
| `montage` | Compress distinct shots or assets into one accumulating meaning. | [montage.md](montage.md) | overlay |
| `camera-journey` | Travel through space, media, routes, or interfaces with continuous orientation. | [camera-journey.md](camera-journey.md) | overlay |
| `dialogue` | Alternate speakers or viewpoints with explicit turn and response timing. | [dialogue.md](dialogue.md) | overlay |
| `kinetic-type` | Use language, emphasis, and typographic transformation as the temporal subject. | [kinetic-type.md](kinetic-type.md) | overlay |
| `audio-reactive` | Drive visual events from measured audio cues rather than decorative timing. | [audio-reactive.md](audio-reactive.md) | overlay |

## progressive-build

Reveal ordered ideas, layers, or a statement in meaningful beats.

| Component | Typical phase | Registry contract | Intended use |
| --- | --- | --- | --- |
| `agenda-opener` | opening | seekable | Open a structured explainer with a readable agenda. |
| `brand-cta` | closing | seekable | A clean ending lockup that turns a completed story into one clear next action. |
| `brand-headline` | opening | seekable | A theme-linked opening statement with an editorial frame and a decisive brand lockup. |
| `brand-manifesto` | opening | seekable | Turn a brand belief into a strong editorial statement. |
| `bullet-stack` | body | seekable | A paced vertical list for arguments, takeaways and step-by-step narration. |
| `campaign-lockup` | opening | seekable | An editorial campaign frame that combines identity, headline, message and date. |
| `chapter-countdown` | opening | seekable | Count into a chapter while previewing its key beats. |
| `chapter-divider` | opening | seekable | A numbered editorial divider that clearly opens a new chapter or section. |
| `checklist-reveal` | body | seekable | Turn a practical checklist into a satisfying sequence. |
| `code-file-tree` | body | seekable | Reveal the files involved in a product change. |
| `concept-layers` | body | seekable | Teach a concept by revealing its dependent layers. |
| `definition-card` | body | seekable | An editorial definition frame that explains one term and grounds it with an example. |
| `definition-highlight` | body | seekable | Define a key term in a highly readable editorial frame. |
| `end-screen` | closing | seekable | A flexible closing frame with brand, final message, primary action and a secondary destination. |
| `evidence-stack` | body | seekable | A concise proof card that connects one claim to a measurable evidence point and source. |
| `faq-stack` | body | seekable | Answer a short sequence of common questions. |
| `feature-spotlight-stack` | body | seekable | Stage product benefits as a focused vertical stack. |
| `formula-breakdown` | body | seekable | Explain a formula by revealing each input and its role. |
| `founder-story` | opening | seekable | Tell a founder's motivation in a concise narrative frame. |
| `kinetic-keyword` | body | seekable | Build a text-first beat around one decisive keyword. |
| `learning-pyramid` | body | seekable | A clear three-level framework for education, knowledge and strategic explanation. |
| `lt-clean-bar` | overlay / any | seekable | A clean lower-third identity bar for speakers, roles and interview context. |
| `narrative-hook` | opening | seekable | Open with a tension-and-payoff story hook. |
| `next-step-outro` | closing | seekable | End with one concrete next step and destination. |
| `offer-card` | body | seekable | A high-contrast promotional offer with supporting detail and a focused call to action. |
| `offer-countdown` | body | seekable | Present a time-sensitive offer without visual clutter. |
| `product-spotlight` | body | seekable | A commercial product hero with a bold value proposition, benefit list and offer badge. |
| `pull-quote` | body | seekable | A full-frame editorial quotation without the portrait treatment of a profile card. |
| `question-opener` | opening | seekable | A curiosity-led opening card built around one strong question and compact context. |
| `quote-pullout` | body | seekable | Pull one sentence from a longer narrative as a visual beat. |
| `release-highlights` | body | seekable | Summarize the most useful changes in a product release. |
| `section-marker` | opening | seekable | Mark a new section with a compact editorial lockup. |
| `terminal-run` | body | seekable | A polished terminal result card for commands, build output and a final status. |
| `xiaohongshu-checklist` | body | seekable | A Xiaohongshu-style saveable checklist with structured rows and an emphasized action. |

## focus-transfer

Move attention among peers while their relationship remains visible.

| Component | Typical phase | Registry contract | Intended use |
| --- | --- | --- | --- |
| `brand-palette` | body | seekable | A brand color system with labeled swatches, usage note and light or dark presentation. |
| `brand-system-board` | body | seekable | Summarize the visual ingredients of a brand system. |
| `comment-thread` | body | seekable | A compact discussion thread for showing reactions, questions and a highlighted reply. |
| `comparison-matrix` | body | seekable | A compact multi-criterion matrix for comparing two options without replacing the before-and-after component. |
| `creator-profile-card` | body | seekable | Introduce a creator with platform identity and content pillars. |
| `customer-quote-wall` | body | seekable | Show several concise customer proof points together. |
| `device-carousel` | body | seekable | Compare how one product moment appears across devices. |
| `douyin-comment-stack` | body | seekable | A stacked Douyin-style comment panel for audience reactions, Q and A, and pinned responses. |
| `expert-panel` | body | seekable | Present several expert viewpoints in one balanced frame. |
| `feature-grid` | body | seekable | A product showcase that stages three focused benefits as a theme-aware card system. |
| `interface-state-board` | body | seekable | Compare important UI states before a walkthrough. |
| `logo-wall` | body | seekable | A theme-linked social-proof wall generated from a short logo list. |
| `partner-logo-feature` | body | seekable | Feature partner names with a clear collaboration message. |
| `pricing-plans` | body | seekable | A three-plan pricing comparison with structured values and one featured offer. |
| `product-comparison-stage` | body | seekable | Compare two product approaches around customer outcomes. |
| `profile-quote` | body | seekable | A focused people card for a founder, expert, teacher or customer point of view. |
| `social-comment-highlight` | body | seekable | Elevate one useful audience comment from a conversation. |
| `source-citation-card` | body | seekable | Present a claim together with a clear source citation. |
| `speaker-intro` | opening | seekable | Introduce a speaker with role, perspective and topic. |
| `split-screen` | body | seekable | A balanced two-panel media layout for parallel stories, perspectives or before-and-after framing. |
| `team-grid` | body | seekable | A four-person team grid with names, roles, one highlighted member and a context note. |
| `team-spotlight` | body | seekable | Feature one team member and their current contribution. |
| `testimonial-card` | body | seekable | A customer proof frame that connects one quote, one identity and one measurable result. |

## path-journey

Advance a route, workflow, dependency, or chronology.

| Component | Typical phase | Registry contract | Intended use |
| --- | --- | --- | --- |
| `agent-tool-trace` | body | seekable | Visualize how an agent selects and invokes tools. |
| `api-request-flow` | body | seekable | Explain an API request from client through response. |
| `architecture-hub` | body | seekable | A theme-aware system diagram that connects one core capability to three clear outcomes. |
| `capability-map` | body | seekable | Group related capabilities around a shared platform. |
| `cause-effect-chain` | body | seekable | Teach how one condition creates a sequence of effects. |
| `conversion-funnel` | body | seekable | Explain how an audience narrows toward a final action. |
| `decision-branch-map` | body | seekable | Map a decision into bounded outcomes and next actions. |
| `decision-flow` | body | seekable | A focused decision path that turns a complex process into three connected steps. |
| `dependency-graph` | body | seekable | Show which inputs unlock a final deliverable. |
| `deployment-pipeline` | body | seekable | Explain how a change moves safely into production. |
| `feature-adoption-ladder` | body | seekable | Show how customers progress from discovery to mastery. |
| `feedback-loop` | body | seekable | Explain a repeatable review-and-improve cycle. |
| `integration-showcase` | body | seekable | Show how integrations connect to the core product workflow. |
| `learning-path` | body | seekable | Turn a learning objective into a progressive route. |
| `location-pulse-map` | body | seekable | A local-area map that reveals multiple named locations with proportional values and sequential signal pulses. |
| `map-flow` | body | seekable | A theme-aware origin-to-destination map story with a clear route, signal, and annotation. |
| `metro-network-map` | body | seekable | A multi-stop network map that draws weighted routes, reveals stations and moves a signal along the leading connection. |
| `milestone-timeline` | body | seekable | A three-step roadmap that turns a process into a clear time-bound story. |
| `process-cycle` | body | seekable | A circular process diagram that connects up to four stages around one central idea. |
| `process-handoff-map` | body | seekable | Show the critical handoffs in a delivery process. |
| `product-benefit-orbit` | body | seekable | Connect product benefits to one central promise. |
| `product-steps` | body | seekable | A numbered three-step product flow with one active stage and a clear outcome. |
| `project-roadmap` | body | seekable | A four-phase horizontal roadmap with a time horizon and one highlighted milestone. |
| `route-map` | body | seekable | Theme-aware animated map route with a focused location and annotation contract. |
| `sequence-diagram` | body | seekable | Explain messages exchanged between systems over time. |
| `swimlane-workflow` | body | seekable | Show responsibility moving across a multi-role workflow. |
| `terminal-command-sequence` | body | seekable | Explain a command workflow without exposing a full terminal log. |
| `us-map-flow` | body | legacy metadata | Animated connection arcs between US cities over a base map — composable origin-destination flow visualization |

## state-transformation

Make a before/after, correction, resolution, or completion legible.

| Component | Typical phase | Registry contract | Intended use |
| --- | --- | --- | --- |
| `before-after-contrast` | body | seekable | A balanced comparison frame for showing a meaningful change without a complex slider setup. |
| `case-study-result` | body | seekable | Connect a customer problem directly to a measurable result. |
| `code-diff-card` | body | seekable | A before-and-after code diff card that makes one implementation change easy to explain. |
| `logo-reveal` | opening | seekable | A restrained monogram reveal that resolves into a brand name and tagline. |
| `media-before-after` | body | seekable | Compare two visual states with clear labels and context. |
| `myth-fact-reveal` | body | seekable | Correct a misconception with a concise explanation. |
| `summary-resolve` | closing | seekable | Close an explainer by resolving its core argument. |
| `validation-stamp` | closing | seekable | Turn completed quality checks into a final proof frame. |

## data-accumulation

Build quantitative evidence, rank, distribution, or signal over time.

| Component | Typical phase | Registry contract | Intended use |
| --- | --- | --- | --- |
| `animated-bar-chart` | body | seekable | A theme-linked bar and trend card for a compact numeric series. |
| `anomaly-monitor` | body | seekable | Surface unexpected metric changes that need attention. |
| `bar-chart-race` | body | seekable | A ranked, theme-linked horizontal bar race with a clear period and source. |
| `benchmark-scorecard` | body | seekable | Compare performance against clear benchmarks. |
| `campaign-metric-hero` | body | seekable | Pair a campaign idea with its primary success measures. |
| `chart-story` | body | seekable | A theme-aware bar and line chart that turns a short series into one clear data story. |
| `china-map` | body | seekable | A theme-aware China map with accurate province-level boundaries, a South China Sea islands inset, editable values, proportional markers, and a regional ranking panel. |
| `cohort-retention` | body | seekable | Show retention patterns across a compact cohort matrix. |
| `conic-progress-ring` | body | seekable | A theme-linked progress ring with a synchronized center value. |
| `data-chart` | body | legacy metadata | Animated bar + line chart with staggered reveal, NYT-style typography, and value labels |
| `decline-chart` | body | seekable | A theme-linked metric decline with synchronized value and line motion. |
| `donut-breakdown` | body | seekable | Explain a compact proportional breakdown around one key total. |
| `editorial-number` | body | seekable | Give one number enough hierarchy to carry a scene. |
| `gauge-scorecard` | body | seekable | Compare a small set of operational scores. |
| `kpi-dashboard` | body | seekable | A four-metric executive dashboard with structured row editing and one highlighted KPI. |
| `live-leaderboard` | body | seekable | A live ranking board whose rows change position as start and finish scores update. |
| `medal-table` | body | seekable | A multi-series ranking table that reveals gold, silver and bronze counts before resolving the total order. |
| `metric-signal` | body | seekable | A single decisive metric with a compact trend signal for data-led storytelling. |
| `number-wheel` | body | seekable | A large theme-linked rolling number for metrics, prices, and scores. |
| `oscilloscope-trace` | body | seekable | A seekable oscilloscope trace driven by a small signal parameter set. |
| `podium-ranking` | body | seekable | A top-three ranking that grows into a podium with synchronized score counters and a highlighted winner. |
| `ranking-list` | body | seekable | An ordered data list with proportional bars, a highlighted entry and structured row editing. |
| `social-metrics-pulse` | body | seekable | Summarize social performance around one content moment. |
| `spain-map` | body | legacy metadata | Animated Spain choropleth by autonomous community with staggered reveals and gradient legend — D3 conic conformal projection |
| `sparkline-grid` | body | seekable | Compare several short-term trends in one frame. |
| `star-rating-fill` | body | seekable | A theme-linked fractional rating with a synchronized value reveal. |
| `territory-heat-map` | body | seekable | An abstract regional heat map that reveals local territories by intensity and emphasizes one selected region. |
| `us-map` | body | legacy metadata | Animated US choropleth map with staggered state reveals, value labels, and gradient legend — pure inline SVG with GSAP |
| `us-map-bubble` | body | legacy metadata | Animated US bubble map with proportional city markers, value callouts, and connection lines — composable with us-map |
| `us-map-hex` | body | legacy metadata | Animated hexagonal tile grid map — each state as an equal-weight hex with data fill and abbreviation label |
| `waterfall-impact` | body | seekable | Explain how several contributions build to a total impact. |
| `world-map` | body | seekable | A theme-aware world map with Natural Earth country boundaries, adjustable values, proportional markers, a selected market callout, and a compact ranking panel. |
| `x-poll` | body | seekable | An X-style audience poll with editable choices, percentages and a highlighted leader. |

## asset-exploration

Guide attention through media, an interface, a device, or social content.

| Component | Typical phase | Registry contract | Intended use |
| --- | --- | --- | --- |
| `browser-walkthrough` | body | seekable | A browser UI walkthrough with editable steps, selected state and deterministic cursor click. |
| `code-walkthrough` | body | seekable | A readable code window that reveals a small snippet and spotlights one important line. |
| `device-mockup` | body | seekable | A lightweight themed phone or laptop mockup with optional screen media. |
| `douyin-live-room` | body | seekable | A Douyin live-room promo panel with host, topic, viewer count and a featured offer. |
| `douyin-product-card` | body | seekable | A Douyin commerce card for a featured product, price, benefit and purchase call to action. |
| `douyin-video` | body | seekable | A vertical Douyin-style short-video frame with creator, caption, audio and engagement context. |
| `follow-card` | body | seekable | A creator follow prompt with a clear profile hierarchy and one animated action. |
| `instagram-carousel` | body | seekable | A saveable Instagram-style carousel with four editable slides and an active-card focus. |
| `instagram-post` | body | seekable | A polished Instagram-style feed post with profile context, visual media and engagement. |
| `instagram-reel` | body | seekable | A vertical Instagram-style reel frame with creator, caption, audio attribution and metrics. |
| `instagram-story` | body | seekable | A vertical Instagram-style story with progress, creator context, headline and sticker. |
| `media-hero` | body | seekable | A cinematic media-first hero with a readable headline and optional image source. |
| `mobile-walkthrough` | body | seekable | A phone-focused UI walkthrough with editable task steps and a selected interaction state. |
| `picture-in-picture` | overlay / any | seekable | Place a supporting view over a primary media surface. |
| `screenshot-zoom` | body | seekable | Frame a product screenshot and call attention to one area. |
| `social-post` | body | seekable | A platform-neutral social post card with author identity, message and engagement context. |
| `x-space` | body | seekable | An X Spaces-style live audio room card with host, speakers and listener context. |
| `x-status-post` | body | seekable | A focused X-style post card for concise statements, launch updates and social proof. |
| `x-thread` | body | seekable | A compact X-style thread that turns a short sequence of posts into a clear narrative. |
| `xiaohongshu-cover` | opening | seekable | A bold Xiaohongshu-style cover card for tips, lists, guides and editorial series. |
| `xiaohongshu-note` | body | seekable | A Xiaohongshu-style lifestyle note with author context, editorial copy and engagement. |
| `xiaohongshu-review` | body | seekable | A Xiaohongshu-style product review card with verdict, score breakdown and a concise takeaway. |

## Adaptation boundary

Do not force a component into its listed pattern when the user's content has another narrative verb. Prefer the closest component structure, select the correct temporal recipe separately, and extend the component's existing timeline. If no component fits, author a local scene and record `data-ipw-component-decision="custom:<specific structural reason>"`; visual preference or implementation convenience is not an exception. Run `media/video_component_check` before acceptance. Record a new catalog candidate only after repeated use and playback validation.

## Narrative capability overlays

These overlays are deliberately many-to-many. They do not add 148 duplicate components and do not override a component's spatial contract. When an overlay is the scene's narrative job, record that overlay as `data-motion-pattern`, follow its recipe, and retime or extend the selected component through the project timeline.

| Capability | Compatible component candidates | Boundary |
| --- | --- | --- |
| `montage` | `device-carousel`, `instagram-carousel`, `picture-in-picture`, `media-hero`, `split-screen`, `x-thread`, `instagram-story`, `xiaohongshu-note` | Requires at least three intentional shot or focus changes; a grid shown all at once is not montage. |
| `camera-journey` | `browser-walkthrough`, `mobile-walkthrough`, `screenshot-zoom`, `device-mockup`, `route-map`, `map-flow`, `metro-network-map`, `location-pulse-map`, `us-map-flow` | Requires a continuous path with stable orientation and a motivated landing point; unrelated zooms do not qualify. |
| `dialogue` | `speaker-intro`, `expert-panel`, `profile-quote`, `split-screen`, `comment-thread`, `douyin-comment-stack`, `social-comment-highlight`, `customer-quote-wall`, `testimonial-card`, `x-space`, `lt-clean-bar` | Requires timed turns and responses; a static collection of quotes is only `focus-transfer`. |
| `kinetic-type` | `kinetic-keyword`, `narrative-hook`, `brand-headline`, `brand-manifesto`, `quote-pullout`, `pull-quote`, `definition-highlight`, `chapter-countdown`, `chapter-divider`, `section-marker` | Text changes must follow meaning and reading order; decorative text motion alone does not qualify. |
| `audio-reactive` | `oscilloscope-trace`, `x-space`, `douyin-video`, `instagram-reel` | These are visual bases only. The finished scene qualifies only when its beat map references measured speech, music, or media cues and the timeline changes at those cues. |
