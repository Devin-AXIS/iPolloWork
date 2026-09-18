import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Category =
  | "scene"
  | "product"
  | "data"
  | "diagrams"
  | "proof"
  | "knowledge"
  | "people"
  | "typography"
  | "media"
  | "social"
  | "developer"
  | "brand";

type Layout =
  | "grid"
  | "stack"
  | "radial"
  | "lanes"
  | "split"
  | "layers"
  | "profile"
  | "editorial"
  | "frame"
  | "social"
  | "network"
  | "spotlight"
  | "dashboard"
  | "orbit"
  | "flow"
  | "columns"
  | "cards"
  | "steps"
  | "compare"
  | "carousel"
  | "tree"
  | "matrix"
  | "funnel"
  | "path"
  | "cta";

interface ComponentDefinition {
  wave: number;
  name: string;
  title: string;
  category: Category;
  purpose: string;
  subject: string;
  mechanism: string[];
  rhythm: string;
  layout: Layout;
  phases: string[];
  duration: number;
  proofTimes: number[];
  parameters: string[];
  tags: string[];
  nearestExisting: string;
  difference: string;
  items: string;
  note: string;
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const blocksRoot = join(repositoryRoot, "registry", "blocks");
const registryIndexPath = join(repositoryRoot, "registry", "registry.json");
const parameters = ["title", "items", "highlight", "note"];

function define(
  wave: number,
  name: string,
  title: string,
  category: Category,
  layout: Layout,
  purpose: string,
  subject: string,
  mechanism: string,
  rhythm: string,
  nearestExisting: string,
  difference: string,
  items: string,
  note: string,
  duration = 8,
): ComponentDefinition {
  return {
    wave,
    name,
    title,
    category,
    purpose,
    subject,
    mechanism: [mechanism],
    rhythm,
    layout,
    phases: ["reveal", "proof", "settle", "hold"],
    duration,
    proofTimes: [0, 0.7, 1.6, duration - 0.5, duration],
    parameters,
    tags: ["component", category, layout, "theme"],
    nearestExisting,
    difference,
    items,
    note,
  };
}

/**
 * Canonical batch manifest for the 66 scene components that expand Studio's
 * reusable component catalog from 84 to exactly 150 entries. Every entry
 * records its closest neighbor and a concrete visual/semantic distinction.
 */
export const VISUAL_COMPONENT_EXPANSION: ComponentDefinition[] = [
  define(
    1,
    "agenda-opener",
    "Agenda Opener",
    "scene",
    "grid",
    "Open a structured explainer with a readable agenda.",
    "agenda cards",
    "ordered-card reveal",
    "measured",
    "brand-headline",
    "Turns the opening promise into four explicit chapters.",
    "01::Context|02::Signal|03::Decision|04::Action",
    "A clear route through the story",
  ),
  define(
    1,
    "feature-spotlight-stack",
    "Feature Spotlight Stack",
    "product",
    "stack",
    "Stage product benefits as a focused vertical stack.",
    "feature cards",
    "layered stack",
    "mechanical",
    "feature-grid",
    "Uses one advancing stack instead of an equal three-column grid.",
    "Capture::Bring context in|Compose::Shape the output|Review::Keep control|Share::Move work forward",
    "Four moments in one product flow",
  ),
  define(
    1,
    "donut-breakdown",
    "Donut Breakdown",
    "data",
    "radial",
    "Explain a compact proportional breakdown around one key total.",
    "category shares",
    "radial assembly",
    "analytical",
    "conic-progress-ring",
    "Compares several shares instead of displaying one progress value.",
    "Research::36%|Build::28%|Review::22%|Share::14%",
    "100% of the workflow, made visible",
  ),
  define(
    1,
    "swimlane-workflow",
    "Swimlane Workflow",
    "diagrams",
    "lanes",
    "Show responsibility moving across a multi-role workflow.",
    "role lanes",
    "lane traversal",
    "mechanical",
    "decision-flow",
    "Organizes steps by owner rather than by decision branch.",
    "You::Set intent|Agent::Draft output|Reviewer::Approve|System::Deliver",
    "One handoff per lane",
  ),
  define(
    1,
    "case-study-result",
    "Case Study Result",
    "proof",
    "split",
    "Connect a customer problem directly to a measurable result.",
    "before and result panels",
    "split reveal",
    "editorial",
    "before-after-contrast",
    "Adds evidence and outcome context to the comparison.",
    "Before::4 tools per task|After::1 reviewed flow|Result::42% faster|Proof::Team study",
    "From scattered work to one visible outcome",
  ),
  define(
    1,
    "concept-layers",
    "Concept Layers",
    "knowledge",
    "layers",
    "Teach a concept by revealing its dependent layers.",
    "knowledge layers",
    "layer build",
    "calm",
    "learning-pyramid",
    "Uses overlapping conceptual strata instead of a hierarchy pyramid.",
    "Foundation::Context|Model::Structure|Practice::Application|Outcome::Judgment",
    "Each layer makes the next one useful",
  ),
  define(
    1,
    "speaker-intro",
    "Speaker Intro",
    "people",
    "profile",
    "Introduce a speaker with role, perspective and topic.",
    "speaker profile",
    "profile lockup",
    "editorial",
    "profile-quote",
    "Prioritizes speaker identity and talk context over a quotation.",
    "Maya Chen::Product educator|Focus::Human-centered AI|Session::Designing with agents|Location::Hong Kong",
    "A concise on-screen introduction",
  ),
  define(
    1,
    "kinetic-keyword",
    "Kinetic Keyword",
    "typography",
    "editorial",
    "Build a text-first beat around one decisive keyword.",
    "oversized keyword",
    "masked type reveal",
    "snap",
    "chapter-divider",
    "Makes one keyword the full visual subject instead of marking a chapter.",
    "CLARITY::See the work|CONTROL::Shape the result|MOMENTUM::Keep moving|TRUST::Review every step",
    "One word carries the scene",
  ),
  define(
    1,
    "screenshot-zoom",
    "Screenshot Zoom",
    "media",
    "frame",
    "Frame a product screenshot and call attention to one area.",
    "interface frame",
    "camera approach",
    "cinematic",
    "media-hero",
    "Uses a UI viewport and focus callout rather than a full-bleed image.",
    "Canvas::Main workspace|Inspector::Safe controls|Timeline::Precise timing|Export::Ready output",
    "Focus the viewer before explaining the detail",
  ),
  define(
    1,
    "creator-profile-card",
    "Creator Profile Card",
    "social",
    "social",
    "Introduce a creator with platform identity and content pillars.",
    "creator card",
    "social card reveal",
    "friendly",
    "follow-card",
    "Explains creator positioning instead of showing only a follow action.",
    "@mayamakes::Design systems|128K::Followers|2.4M::Monthly views|Weekly::New explainers",
    "A reusable creator identity card",
  ),
  define(
    1,
    "agent-tool-trace",
    "Agent Tool Trace",
    "developer",
    "network",
    "Visualize how an agent selects and invokes tools.",
    "agent and tool nodes",
    "node traversal",
    "technical",
    "architecture-hub",
    "Shows a time-ordered tool trace instead of a static system topology.",
    "Prompt::Intent|Search::Evidence|Editor::Artifact|Check::Proof",
    "Every tool call has a visible purpose",
  ),
  define(
    1,
    "brand-manifesto",
    "Brand Manifesto",
    "brand",
    "spotlight",
    "Turn a brand belief into a strong editorial statement.",
    "manifesto lines",
    "spotlight reveal",
    "cinematic",
    "campaign-lockup",
    "Leads with a point of view instead of a campaign signature.",
    "Believe::Work should stay understandable|Build::Tools should feel human|Protect::Users keep control|Prove::Outcomes stay visible",
    "A brand is a promise repeated in practice",
  ),

  define(
    2,
    "narrative-hook",
    "Narrative Hook",
    "scene",
    "editorial",
    "Open with a tension-and-payoff story hook.",
    "hook statement",
    "editorial lift",
    "snap",
    "question-opener",
    "Pairs the opening question with an explicit payoff.",
    "Problem::Too much motion|Tension::Not enough meaning|Shift::Make every beat useful|Promise::A clearer story",
    "The first five seconds earn the next five",
  ),
  define(
    2,
    "product-benefit-orbit",
    "Product Benefit Orbit",
    "product",
    "orbit",
    "Connect product benefits to one central promise.",
    "benefit nodes",
    "orbital reveal",
    "fluid",
    "architecture-hub",
    "Frames nodes as customer benefits rather than system inputs and outputs.",
    "Faster::Less setup|Clearer::Visible context|Safer::Review gates|Reusable::Repeatable systems",
    "Benefits orbit one customer outcome",
  ),
  define(
    2,
    "gauge-scorecard",
    "Gauge Scorecard",
    "data",
    "dashboard",
    "Compare a small set of operational scores.",
    "score gauges",
    "meter fill",
    "analytical",
    "kpi-dashboard",
    "Uses normalized gauges and targets rather than raw KPI cards.",
    "Quality::92/100|Speed::84/100|Clarity::89/100|Trust::95/100",
    "Four scores against one operating standard",
  ),
  define(
    2,
    "feedback-loop",
    "Feedback Loop",
    "diagrams",
    "orbit",
    "Explain a repeatable review-and-improve cycle.",
    "cycle stages",
    "circular handoff",
    "fluid",
    "process-cycle",
    "Makes feedback ownership explicit at each return point.",
    "Observe::Read the signal|Draft::Make a move|Review::Test the result|Learn::Update the system",
    "A useful loop gets sharper every pass",
  ),
  define(
    2,
    "benchmark-scorecard",
    "Benchmark Scorecard",
    "proof",
    "dashboard",
    "Compare performance against clear benchmarks.",
    "benchmark meters",
    "benchmark fill",
    "analytical",
    "evidence-stack",
    "Shows several standards and gaps rather than one evidence point.",
    "Response::1.8× faster|Accuracy::+14 points|Handoffs::-38%|Adoption::86%",
    "Measured against the previous workflow",
  ),
  define(
    2,
    "cause-effect-chain",
    "Cause & Effect Chain",
    "knowledge",
    "flow",
    "Teach how one condition creates a sequence of effects.",
    "cause chain",
    "directional reveal",
    "measured",
    "decision-flow",
    "Explains causality rather than choice branches.",
    "Context::Better prompts|Constraint::Fewer guesses|Review::Earlier correction|Outcome::Stronger work",
    "Show the reason, not only the result",
  ),
  define(
    2,
    "expert-panel",
    "Expert Panel",
    "people",
    "grid",
    "Present several expert viewpoints in one balanced frame.",
    "expert cards",
    "panel stagger",
    "editorial",
    "team-grid",
    "Centers distinct perspectives instead of organizational roles.",
    "Amina::Policy|Diego::Design|Rin::Engineering|Leah::Research",
    "Four lenses on one question",
  ),
  define(
    2,
    "editorial-number",
    "Editorial Number",
    "typography",
    "spotlight",
    "Give one number enough hierarchy to carry a scene.",
    "hero number",
    "scale lockup",
    "bold",
    "metric-signal",
    "Treats the number as typography rather than a chart signal.",
    "42%::Less review time|3.2×::More approved ideas|18h::Saved per week|94::Quality score",
    "A number is strongest when its meaning arrives with it",
  ),
  define(
    2,
    "browser-feature-tour",
    "Browser Feature Tour",
    "media",
    "frame",
    "Walk through a browser product feature with named hotspots.",
    "browser viewport",
    "hotspot sequence",
    "guided",
    "browser-walkthrough",
    "Uses spatial hotspots instead of a fixed step list.",
    "Sidebar::Find projects|Canvas::Shape the story|Properties::Tune safely|Timeline::Control the beat",
    "A guided tour of the working surface",
  ),
  define(
    2,
    "social-comment-highlight",
    "Social Comment Highlight",
    "social",
    "stack",
    "Elevate one useful audience comment from a conversation.",
    "comment stack",
    "comment lift",
    "friendly",
    "comment-thread",
    "Promotes one response as the editorial takeaway.",
    "@lin::This saved our review|@omar::The workflow finally clicks|@sora::Can we reuse this?|@team::Yes — as a template",
    "Turn audience feedback into a story beat",
  ),
  define(
    2,
    "api-request-flow",
    "API Request Flow",
    "developer",
    "lanes",
    "Explain an API request from client through response.",
    "request stages",
    "lane traversal",
    "technical",
    "code-walkthrough",
    "Shows runtime boundaries instead of stepping through source code.",
    "Client::POST /render|Server::Validate input|Worker::Build frames|Response::Return artifact",
    "A request stays traceable end to end",
  ),
  define(
    2,
    "campaign-metric-hero",
    "Campaign Metric Hero",
    "brand",
    "dashboard",
    "Pair a campaign idea with its primary success measures.",
    "campaign metrics",
    "metric reveal",
    "energetic",
    "campaign-lockup",
    "Adds measurable outcomes to the campaign identity.",
    "Reach::4.2M|Completion::68%|Saves::142K|Lift::+18%",
    "A campaign idea with evidence attached",
  ),
  define(
    2,
    "chapter-countdown",
    "Chapter Countdown",
    "scene",
    "columns",
    "Count into a chapter while previewing its key beats.",
    "chapter beats",
    "column rise",
    "mechanical",
    "chapter-divider",
    "Previews the coming beats instead of showing only a chapter title.",
    "03::Frame the issue|02::Reveal the signal|01::Make the move|NOW::Begin",
    "A countdown that also sets expectations",
  ),
  define(
    2,
    "workflow-demo-cards",
    "Workflow Demo Cards",
    "product",
    "cards",
    "Demonstrate a product workflow as a sequence of state cards.",
    "workflow states",
    "card progression",
    "guided",
    "product-steps",
    "Shows interface states and outputs rather than generic step labels.",
    "Brief::Goal captured|Draft::Options generated|Review::Changes approved|Deliver::Video ready",
    "A product story told through changing states",
  ),
  define(
    2,
    "waterfall-impact",
    "Waterfall Impact",
    "data",
    "steps",
    "Explain how several contributions build to a total impact.",
    "waterfall values",
    "cumulative rise",
    "analytical",
    "animated-bar-chart",
    "Shows cumulative contribution instead of independent bars.",
    "Baseline::100|Automation::+24|Review::-8|Reuse::+31",
    "Net impact: 147",
  ),
  define(
    2,
    "dependency-graph",
    "Dependency Graph",
    "diagrams",
    "network",
    "Show which inputs unlock a final deliverable.",
    "dependency nodes",
    "network assembly",
    "technical",
    "architecture-hub",
    "Uses directional dependencies and gates instead of one central hub.",
    "Brief::Required|Assets::Required|Theme::Shared|Export::Unlocked",
    "The output is only as stable as its dependencies",
  ),
  define(
    2,
    "source-citation-card",
    "Source Citation Card",
    "proof",
    "split",
    "Present a claim together with a clear source citation.",
    "claim and citation",
    "paired reveal",
    "editorial",
    "evidence-stack",
    "Gives the source equal visual weight to the claim.",
    "Claim::Teams review earlier|Source::Workflow study 2026|Sample::42 projects|Confidence::High",
    "Evidence stays attached to the statement",
  ),
  define(
    2,
    "myth-fact-reveal",
    "Myth / Fact Reveal",
    "knowledge",
    "compare",
    "Correct a misconception with a concise explanation.",
    "myth and fact",
    "contrast flip",
    "snap",
    "before-after-contrast",
    "Explains a knowledge correction instead of a process change.",
    "Myth::More effects mean better video|Fact::Clear hierarchy wins|Why::Attention is limited|Use::One motion idea per beat",
    "Replace the assumption with a useful rule",
  ),

  define(
    3,
    "team-spotlight",
    "Team Spotlight",
    "people",
    "profile",
    "Feature one team member and their current contribution.",
    "team member profile",
    "profile focus",
    "friendly",
    "team-grid",
    "Creates a single-person focus instead of an equal team overview.",
    "Jordan Lee::Motion systems|Now::Component library|Strength::Turning rules into tools|Next::Scaling review",
    "One person, one contribution, one next step",
  ),
  define(
    3,
    "definition-highlight",
    "Definition Highlight",
    "typography",
    "editorial",
    "Define a key term in a highly readable editorial frame.",
    "term and definition",
    "type lockup",
    "calm",
    "definition-card",
    "Makes the term itself the typographic hero.",
    "AGENT::A system that chooses and uses tools|CONTEXT::The information shaping a decision|PROOF::Evidence a claim actually holds|CONTROL::The user's ability to direct outcomes",
    "Use the term the same way throughout the story",
  ),
  define(
    3,
    "device-carousel",
    "Device Carousel",
    "media",
    "carousel",
    "Compare how one product moment appears across devices.",
    "device frames",
    "carousel shift",
    "fluid",
    "device-mockup",
    "Shows several responsive contexts instead of one device.",
    "Desktop::Full workspace|Tablet::Review mode|Phone::Quick approval|Watch::Status glance",
    "One experience across four contexts",
  ),
  define(
    3,
    "social-metrics-pulse",
    "Social Metrics Pulse",
    "social",
    "radial",
    "Summarize social performance around one content moment.",
    "social metrics",
    "radial pulse",
    "energetic",
    "instagram-post",
    "Visualizes cross-platform response instead of recreating a post.",
    "Views::2.4M|Saves::84K|Shares::31K|Completion::72%",
    "Performance across the first 48 hours",
  ),
  define(
    3,
    "code-file-tree",
    "Code File Tree",
    "developer",
    "tree",
    "Reveal the files involved in a product change.",
    "file hierarchy",
    "tree expansion",
    "technical",
    "code-diff-card",
    "Explains ownership across files instead of line-level changes.",
    "app/::Interface|server/::API|packages/::Contracts|evals/::Proof",
    "A change map before the diff",
  ),
  define(
    3,
    "offer-countdown",
    "Offer Countdown",
    "brand",
    "spotlight",
    "Present a time-sensitive offer without visual clutter.",
    "offer and timer",
    "countdown lockup",
    "urgent",
    "offer-card",
    "Uses time pressure and one action instead of a pricing summary.",
    "48H::Launch window|20%::Team plan|BONUS::Template pack|CTA::Start now",
    "One offer, one deadline, one next action",
  ),
  define(
    3,
    "summary-resolve",
    "Summary Resolve",
    "scene",
    "split",
    "Close an explainer by resolving its core argument.",
    "summary points",
    "paired resolution",
    "calm",
    "end-screen",
    "Restates the reasoning before the final sign-off.",
    "Signal::What changed|Meaning::Why it matters|Action::What to do next|Proof::How we know",
    "End with a decision, not a fade",
  ),
  define(
    3,
    "release-highlights",
    "Release Highlights",
    "product",
    "columns",
    "Summarize the most useful changes in a product release.",
    "release columns",
    "column rise",
    "energetic",
    "feature-grid",
    "Groups changes by release impact rather than feature parity.",
    "CREATE::Faster scenes|EDIT::Safer controls|REVIEW::Clearer proof|SHIP::Stable export",
    "Release 2.6 · Built for repeatable video work",
  ),
  define(
    3,
    "sparkline-grid",
    "Sparkline Grid",
    "data",
    "dashboard",
    "Compare several short-term trends in one frame.",
    "trend cards",
    "sparkline draw",
    "analytical",
    "kpi-dashboard",
    "Prioritizes direction over absolute score cards.",
    "Demand::↗ 18%|Quality::↗ 7%|Latency::↘ 22%|Adoption::↗ 31%",
    "Four trends across the current quarter",
  ),
  define(
    3,
    "decision-branch-map",
    "Decision Branch Map",
    "diagrams",
    "tree",
    "Map a decision into bounded outcomes and next actions.",
    "decision branches",
    "tree expansion",
    "measured",
    "decision-flow",
    "Adds explicit outcomes and next steps to each branch.",
    "Evidence strong::Proceed|Evidence mixed::Test|Risk high::Review|Need unclear::Reframe",
    "Every branch ends with an action",
  ),
  define(
    3,
    "customer-quote-wall",
    "Customer Quote Wall",
    "proof",
    "grid",
    "Show several concise customer proof points together.",
    "quote tiles",
    "quote stagger",
    "friendly",
    "testimonial-card",
    "Uses multiple independent voices instead of one testimonial.",
    "Maya::Review finally feels fast|Noah::The timeline stays clear|Ari::Our brand carries through|Chen::Exports match preview",
    "Four teams, one repeated signal",
  ),
  define(
    3,
    "faq-stack",
    "FAQ Stack",
    "knowledge",
    "stack",
    "Answer a short sequence of common questions.",
    "question cards",
    "accordion stack",
    "guided",
    "definition-card",
    "Structures practical objections rather than defining one concept.",
    "Can I edit it?::Yes, every slot stays visible|Does it match theme?::It inherits your tokens|Can AI change it?::Only declared slots|Will it render?::The same timeline is used",
    "Answer the question before it slows the story",
  ),
  define(
    3,
    "founder-story",
    "Founder Story",
    "people",
    "editorial",
    "Tell a founder's motivation in a concise narrative frame.",
    "founder milestones",
    "editorial progression",
    "cinematic",
    "profile-quote",
    "Builds a short origin sequence instead of centering one quotation.",
    "Problem::Work became opaque|Belief::Tools should stay understandable|Build::A visible agent workspace|Mission::Help teams move with confidence",
    "An origin story grounded in the problem",
  ),
  define(
    3,
    "checklist-reveal",
    "Checklist Reveal",
    "typography",
    "steps",
    "Turn a practical checklist into a satisfying sequence.",
    "checklist rows",
    "checked-step reveal",
    "mechanical",
    "bullet-stack",
    "Adds completion state and sequence to the list.",
    "✓::Brief locked|✓::Theme applied|✓::Motion checked|✓::Export verified",
    "Four checks before delivery",
  ),
  define(
    3,
    "picture-in-picture",
    "Picture in Picture",
    "media",
    "frame",
    "Place a supporting view over a primary media surface.",
    "primary and inset frames",
    "nested frame reveal",
    "guided",
    "split-screen",
    "Preserves one dominant surface with a contextual inset.",
    "Main::Product walkthrough|Inset::Presenter context|Label::Live review|Moment::Approval",
    "Keep the supporting view secondary",
  ),
  define(
    3,
    "terminal-command-sequence",
    "Terminal Command Sequence",
    "developer",
    "lanes",
    "Explain a command workflow without exposing a full terminal log.",
    "command steps",
    "command traversal",
    "technical",
    "terminal-run",
    "Summarizes intent and result for several commands.",
    "init::Create project|check::Validate composition|snapshot::Inspect frames|render::Produce video",
    "Commands presented as a reproducible sequence",
  ),
  define(
    3,
    "partner-logo-feature",
    "Partner Logo Feature",
    "brand",
    "carousel",
    "Feature partner names with a clear collaboration message.",
    "partner marks",
    "carousel reveal",
    "calm",
    "logo-wall",
    "Gives each partner a short role instead of equal anonymous tiles.",
    "OpenAI::Intelligence|Figma::Design|GitHub::Code|Slack::Collaboration",
    "A connected ecosystem around the work",
  ),
  define(
    3,
    "integration-showcase",
    "Integration Showcase",
    "product",
    "network",
    "Show how integrations connect to the core product workflow.",
    "integration nodes",
    "network assembly",
    "technical",
    "architecture-hub",
    "Frames external tools as workflow entry and exit points.",
    "Docs::Bring context|Git::Track change|Chat::Coordinate|Cloud::Deliver",
    "Connect the tools without losing the workflow",
  ),

  define(
    4,
    "next-step-outro",
    "Next Step Outro",
    "scene",
    "cta",
    "End with one concrete next step and destination.",
    "call to action",
    "cta resolve",
    "calm",
    "brand-cta",
    "Explains the immediate action in a three-part close.",
    "01::Choose a template|02::Add your story|03::Review the result|GO::Create the video",
    "Make the next move obvious",
  ),
  define(
    4,
    "product-comparison-stage",
    "Product Comparison Stage",
    "product",
    "compare",
    "Compare two product approaches around customer outcomes.",
    "comparison panels",
    "stage swap",
    "editorial",
    "comparison-matrix",
    "Uses narrative outcomes instead of a feature matrix.",
    "Manual::More handoffs|Assisted::One visible flow|Manual::Late review|Assisted::Review in context",
    "Compare the experience, not only the checklist",
  ),
  define(
    4,
    "cohort-retention",
    "Cohort Retention",
    "data",
    "matrix",
    "Show retention patterns across a compact cohort matrix.",
    "cohort cells",
    "matrix fill",
    "analytical",
    "kpi-dashboard",
    "Displays persistence over periods rather than one current metric.",
    "Jan::92 · 81 · 74|Feb::94 · 84 · 77|Mar::91 · 86 · 79|Apr::96 · 89 · 82",
    "Four cohorts across three return periods",
  ),
  define(
    4,
    "sequence-diagram",
    "Sequence Diagram",
    "diagrams",
    "lanes",
    "Explain messages exchanged between systems over time.",
    "system messages",
    "sequence traversal",
    "technical",
    "swimlane-workflow",
    "Emphasizes message order between actors rather than task ownership.",
    "User→App::Request|App→Agent::Delegate|Agent→Tool::Execute|Tool→App::Return",
    "A readable message path across system boundaries",
  ),
  define(
    4,
    "validation-stamp",
    "Validation Stamp",
    "proof",
    "radial",
    "Turn completed quality checks into a final proof frame.",
    "validation marks",
    "stamp resolve",
    "mechanical",
    "evidence-stack",
    "Proves readiness through completed gates rather than research evidence.",
    "Schema::Passed|Runtime::Passed|Visual::Passed|Interaction::Passed",
    "Ready after every required gate passes",
  ),
  define(
    4,
    "formula-breakdown",
    "Formula Breakdown",
    "knowledge",
    "layers",
    "Explain a formula by revealing each input and its role.",
    "formula terms",
    "layer assembly",
    "measured",
    "concept-layers",
    "Uses quantitative terms and an explicit result relationship.",
    "Impact::Reach × Clarity|Reach::People exposed|Clarity::Message understood|Result::Action taken",
    "Make each term understandable before combining them",
  ),
  define(
    4,
    "process-handoff-map",
    "Process Handoff Map",
    "diagrams",
    "flow",
    "Show the critical handoffs in a delivery process.",
    "handoff stages",
    "directional handoff",
    "mechanical",
    "swimlane-workflow",
    "Focuses on the transfer moments where context can be lost.",
    "Brief→Design::Intent|Design→Build::Specification|Build→Review::Evidence|Review→Ship::Approval",
    "A stable process protects every handoff",
  ),
  define(
    4,
    "quote-pullout",
    "Quote Pullout",
    "typography",
    "editorial",
    "Pull one sentence from a longer narrative as a visual beat.",
    "quotation",
    "masked quote reveal",
    "editorial",
    "pull-quote",
    "Prioritizes the sentence itself with minimal attribution chrome.",
    "“The work should remain understandable.”::Product principle|“Review is part of creation.”::Team practice|“Clarity compounds.”::Design note|“Proof closes the loop.”::Release rule",
    "One line worth holding on screen",
  ),
  define(
    4,
    "media-before-after",
    "Media Before / After",
    "media",
    "split",
    "Compare two visual states with clear labels and context.",
    "media comparison",
    "split uncover",
    "cinematic",
    "before-after-contrast",
    "Reserves two image surfaces instead of text-only comparison panels.",
    "RAW::Unfocused frame|TREATED::Clear hierarchy|BEFORE::Default state|AFTER::Theme applied",
    "A visual comparison with room for real media",
  ),
  define(
    4,
    "deployment-pipeline",
    "Deployment Pipeline",
    "developer",
    "steps",
    "Explain how a change moves safely into production.",
    "pipeline stages",
    "pipeline progression",
    "technical",
    "project-roadmap",
    "Shows engineering gates and deployment status rather than project milestones.",
    "Commit::Source ready|Build::Packages pass|Test::Experience proven|Release::Artifact shipped",
    "Every stage produces evidence for the next",
  ),
  define(
    4,
    "brand-system-board",
    "Brand System Board",
    "brand",
    "grid",
    "Summarize the visual ingredients of a brand system.",
    "brand tokens",
    "board assembly",
    "editorial",
    "brand-palette",
    "Combines typography, voice and motion with color roles.",
    "COLOR::Signal and surface|TYPE::Hierarchy and tone|VOICE::Clear and direct|MOTION::Purposeful and brief",
    "A compact board for consistent video decisions",
  ),
  define(
    4,
    "anomaly-monitor",
    "Anomaly Monitor",
    "data",
    "dashboard",
    "Surface unexpected metric changes that need attention.",
    "anomaly cards",
    "alert pulse",
    "urgent",
    "metric-signal",
    "Compares several exceptions instead of presenting one trend.",
    "Latency::+38%|Drop-off::+12%|Errors::+4.6%|Recovery::-18m",
    "Exceptions ranked by impact",
  ),
  define(
    4,
    "feature-adoption-ladder",
    "Feature Adoption Ladder",
    "product",
    "columns",
    "Show how customers progress from discovery to mastery.",
    "adoption stages",
    "ladder rise",
    "measured",
    "product-steps",
    "Uses maturity levels and outcomes rather than a task sequence.",
    "Discover::See the value|Try::Complete one flow|Repeat::Build a habit|Scale::Share the system",
    "Four levels from awareness to adoption",
  ),
  define(
    4,
    "conversion-funnel",
    "Conversion Funnel",
    "data",
    "funnel",
    "Explain how an audience narrows toward a final action.",
    "funnel stages",
    "funnel collapse",
    "analytical",
    "decline-chart",
    "Preserves stage meaning rather than showing only decline over time.",
    "Views::100K|Qualified::34K|Trials::12K|Customers::3.8K",
    "Each stage names the next conversion opportunity",
  ),
  define(
    4,
    "capability-map",
    "Capability Map",
    "diagrams",
    "network",
    "Group related capabilities around a shared platform.",
    "capability clusters",
    "cluster assembly",
    "technical",
    "architecture-hub",
    "Maps several capability clusters rather than one input-core-output chain.",
    "Create::Video · Slides|Connect::Apps · APIs|Control::Review · Permissions|Deliver::Export · Share",
    "One platform, four capability groups",
  ),
  define(
    4,
    "learning-path",
    "Learning Path",
    "knowledge",
    "path",
    "Turn a learning objective into a progressive route.",
    "learning stages",
    "path travel",
    "guided",
    "learning-pyramid",
    "Uses a horizontal progression with practice checkpoints.",
    "Learn::Core idea|See::Worked example|Try::Guided task|Apply::Independent outcome",
    "A path from understanding to application",
  ),
  define(
    4,
    "section-marker",
    "Section Marker",
    "typography",
    "editorial",
    "Mark a new section with a compact editorial lockup.",
    "section label",
    "rule and type reveal",
    "snap",
    "chapter-divider",
    "Uses a small in-scene marker instead of a full chapter card.",
    "01::THE CONTEXT|02::THE SIGNAL|03::THE SHIFT|04::THE RESULT",
    "A restrained marker for fast-moving explainers",
  ),
  define(
    4,
    "interface-state-board",
    "Interface State Board",
    "media",
    "cards",
    "Compare important UI states before a walkthrough.",
    "interface states",
    "state-card reveal",
    "guided",
    "browser-walkthrough",
    "Previews several states at once instead of animating one path.",
    "EMPTY::Invite first action|LOADING::Confirm progress|SUCCESS::Show the result|ERROR::Offer recovery",
    "A state model for product storytelling",
  ),
];

const CATEGORY_LABELS: Record<Category, string> = {
  scene: "Story Scene",
  product: "Product",
  data: "Data Signal",
  diagrams: "System Diagram",
  proof: "Evidence",
  knowledge: "Knowledge",
  people: "People",
  typography: "Type",
  media: "Media",
  social: "Social",
  developer: "Developer",
  brand: "Brand",
};

const variableDeclarations = [
  { id: "title", label: "Title", type: "string", default: "", maxLength: 76 },
  { id: "items", label: "Items", type: "string", default: "", maxLength: 280 },
  {
    id: "highlight",
    label: "Highlighted item",
    type: "number",
    default: 1,
    min: 1,
    max: 4,
    step: 1,
  },
  { id: "note", label: "Supporting note", type: "string", default: "", maxLength: 100 },
];

function renderMotion(layout: Layout): string {
  if (layout === "radial" || layout === "orbit") {
    return 'tl.fromTo(items,{scale:.35,rotation:-18,opacity:0},{scale:1,rotation:0,opacity:1,duration:.7,stagger:.1,ease:"back.out(1.45)"},.3);';
  }
  if (layout === "lanes" || layout === "flow" || layout === "path") {
    return 'tl.fromTo(items,{x:-90,opacity:0},{x:0,opacity:1,duration:.62,stagger:.12,ease:"power3.out"},.3);';
  }
  if (layout === "columns" || layout === "funnel" || layout === "steps") {
    return 'tl.fromTo(items,{y:86,scaleY:.72,opacity:0},{y:0,scaleY:1,opacity:1,duration:.65,stagger:.1,ease:"power4.out"},.3);';
  }
  if (layout === "editorial") {
    return 'tl.fromTo(items,{yPercent:105,clipPath:"inset(0 0 100% 0)",opacity:0},{yPercent:0,clipPath:"inset(0 0 0% 0)",opacity:1,duration:.72,stagger:.09,ease:"power4.out"},.28);';
  }
  if (layout === "split" || layout === "compare") {
    return 'tl.fromTo(items,{xPercent:-18,opacity:0},{xPercent:0,opacity:1,duration:.68,stagger:.12,ease:"power3.out"},.3);';
  }
  if (layout === "network" || layout === "tree") {
    return 'tl.fromTo(items,{scale:.6,y:35,opacity:0},{scale:1,y:0,opacity:1,duration:.6,stagger:.12,ease:"back.out(1.3)"},.3);';
  }
  if (layout === "frame" || layout === "carousel") {
    return 'tl.fromTo(visual,{rotateY:-9,y:52,scale:.94,opacity:0},{rotateY:0,y:0,scale:1,opacity:1,duration:.8,ease:"power3.out"},.26).fromTo(items,{x:38,opacity:0},{x:0,opacity:1,duration:.45,stagger:.08,ease:"power2.out"},.52);';
  }
  if (layout === "spotlight" || layout === "cta") {
    return 'tl.fromTo(active,{scale:.82,clipPath:"inset(12% 12% 12% 12% round 42px)",opacity:0},{scale:1,clipPath:"inset(0% 0% 0% 0% round 24px)",opacity:1,duration:.78,ease:"power3.out"},.3).fromTo(items,{y:32,opacity:0},{y:0,opacity:1,duration:.48,stagger:.08,ease:"power2.out"},.48);';
  }
  return 'tl.fromTo(items,{y:54,scale:.94,opacity:0},{y:0,scale:1,opacity:1,duration:.58,stagger:.1,ease:"power3.out"},.3);';
}

function renderHtml(definition: ComponentDefinition): string {
  const declarations = variableDeclarations.map((variable) => ({
    ...variable,
    default:
      variable.id === "title"
        ? definition.title
        : variable.id === "items"
          ? definition.items
          : variable.id === "note"
            ? definition.note
            : variable.default,
  }));
  const defaults = Object.fromEntries(
    declarations.map((variable) => [variable.id, variable.default]),
  );
  const serializedDeclarations = JSON.stringify(declarations)
    .replaceAll("&", "&amp;")
    .replaceAll("'", "&#39;");
  return `<!doctype html>
<html lang="en" data-composition-variables='${serializedDeclarations}'>
  <head>
    <!-- Generated by scripts/visual-component-catalog.ts. -->
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920,height=1080" />
    <title>${definition.title}</title>
    <style>
      *{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:transparent}body{font-family:var(--ipw-font-body,Inter,sans-serif)}
      .vc-root{--vc-bg:var(--ipw-color-bg,#f4f6f8);--vc-text:var(--ipw-color-text,#172126);--vc-muted:var(--ipw-color-muted,#647078);--vc-primary:var(--ipw-color-primary,#20bbc0);--vc-accent:var(--ipw-color-accent,#ef6846);--vc-surface:var(--ipw-color-surface,#fff);--vc-border:var(--ipw-color-border,#d7dde1);position:relative;width:1920px;height:1080px;overflow:hidden;padding:86px 112px 82px;background:var(--vc-bg);color:var(--vc-text);font-family:var(--ipw-font-display,Inter,sans-serif)}
      .vc-root:before{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(90deg,color-mix(in srgb,var(--vc-border) 38%,transparent) 1px,transparent 1px),linear-gradient(color-mix(in srgb,var(--vc-border) 32%,transparent) 1px,transparent 1px);background-size:96px 96px;mask-image:linear-gradient(to bottom,rgba(0,0,0,.5),transparent 82%)}
      .vc-header{position:relative;z-index:2;display:grid;grid-template-columns:1fr auto;align-items:end;gap:60px}.vc-kicker{margin-bottom:18px;color:var(--vc-primary);font:800 18px/1 var(--ipw-font-body,Inter,sans-serif);letter-spacing:.2em;text-transform:uppercase}.vc-title{max-width:1180px;margin:0;font-size:72px;line-height:.98;letter-spacing:-.055em}.vc-note{max-width:430px;margin:0;color:var(--vc-muted);font:500 23px/1.35 var(--ipw-font-body,Inter,sans-serif);text-align:right}
      .vc-visual{position:relative;z-index:2;height:660px;margin-top:54px;perspective:1400px}.vc-items{display:grid;width:100%;height:100%;grid-template-columns:repeat(2,1fr);gap:22px}.vc-item{position:relative;min-width:0;overflow:hidden;padding:30px 32px;border:1px solid var(--vc-border);border-radius:24px;background:color-mix(in srgb,var(--vc-surface) 92%,transparent);box-shadow:var(--ipw-card-shadow,0 20px 55px rgba(17,32,40,.10));transform-origin:center bottom}.vc-item.is-active{border-color:var(--vc-primary);background:color-mix(in srgb,var(--vc-primary) 11%,var(--vc-surface));box-shadow:0 20px 58px color-mix(in srgb,var(--vc-primary) 20%,transparent)}.vc-index{display:block;margin-bottom:18px;color:var(--vc-primary);font:800 14px/1 var(--ipw-font-body,Inter,sans-serif);letter-spacing:.14em}.vc-label{display:block;font-size:36px;line-height:1.05;letter-spacing:-.035em}.vc-meta{display:block;margin-top:14px;color:var(--vc-muted);font:550 20px/1.3 var(--ipw-font-body,Inter,sans-serif)}.vc-bar{position:absolute;left:32px;right:32px;bottom:27px;height:5px;border-radius:10px;background:var(--vc-border);overflow:hidden}.vc-bar:after{content:"";display:block;width:var(--progress,65%);height:100%;background:var(--vc-primary)}
      [data-layout="stack"] .vc-items{display:flex;flex-direction:column;justify-content:center;padding:30px 120px}[data-layout="stack"] .vc-item{min-height:118px;padding:24px 32px}[data-layout="stack"] .vc-meta{position:absolute;right:34px;top:23px;max-width:52%;text-align:right}[data-layout="stack"] .vc-bar{bottom:17px}
      [data-layout="radial"] .vc-items,[data-layout="orbit"] .vc-items{position:relative;display:block}[data-layout="radial"] .vc-items:before,[data-layout="orbit"] .vc-items:before{content:"";position:absolute;left:50%;top:50%;width:320px;height:320px;border:2px solid var(--vc-primary);border-radius:50%;transform:translate(-50%,-50%);box-shadow:0 0 0 70px color-mix(in srgb,var(--vc-primary) 7%,transparent),0 0 0 140px color-mix(in srgb,var(--vc-primary) 4%,transparent)}[data-layout="radial"] .vc-item,[data-layout="orbit"] .vc-item{position:absolute;width:360px;min-height:170px}[data-layout="radial"] .vc-item:nth-child(1),[data-layout="orbit"] .vc-item:nth-child(1){left:32px;top:20px}[data-layout="radial"] .vc-item:nth-child(2),[data-layout="orbit"] .vc-item:nth-child(2){right:32px;top:20px}[data-layout="radial"] .vc-item:nth-child(3),[data-layout="orbit"] .vc-item:nth-child(3){left:32px;bottom:20px}[data-layout="radial"] .vc-item:nth-child(4),[data-layout="orbit"] .vc-item:nth-child(4){right:32px;bottom:20px}
      [data-layout="lanes"] .vc-items,[data-layout="flow"] .vc-items,[data-layout="path"] .vc-items{display:flex;flex-direction:column;justify-content:center;gap:22px;padding:24px 70px}[data-layout="lanes"] .vc-item,[data-layout="flow"] .vc-item,[data-layout="path"] .vc-item{min-height:124px;margin-left:calc((var(--i) - 1) * 105px);margin-right:calc((4 - var(--i)) * 105px)}
      [data-layout="split"] .vc-items,[data-layout="compare"] .vc-items{grid-template-columns:repeat(2,1fr);grid-template-rows:repeat(2,1fr);gap:28px}[data-layout="split"] .vc-item:nth-child(odd),[data-layout="compare"] .vc-item:nth-child(odd){border-left:8px solid var(--vc-primary)}[data-layout="split"] .vc-item:nth-child(even),[data-layout="compare"] .vc-item:nth-child(even){border-right:8px solid var(--vc-accent)}
      [data-layout="layers"] .vc-items{display:block;padding:40px 150px}[data-layout="layers"] .vc-item{position:absolute;left:calc(150px + (var(--i) - 1) * 110px);top:calc(35px + (var(--i) - 1) * 92px);width:990px;height:250px;background:color-mix(in srgb,var(--vc-surface) calc(96% - (var(--i) - 1) * 4%),var(--vc-primary))}
      [data-layout="profile"] .vc-items{grid-template-columns:1.35fr .65fr;grid-template-rows:repeat(3,1fr)}[data-layout="profile"] .vc-item:first-child{grid-row:1/4;padding:54px}[data-layout="profile"] .vc-item:first-child .vc-label{max-width:620px;font-size:66px}[data-layout="profile"] .vc-item:first-child .vc-meta{font-size:26px}[data-layout="profile"] .vc-item:nth-child(n+2) .vc-bar{display:none}
      [data-layout="editorial"] .vc-items{display:flex;align-items:flex-end;gap:18px}[data-layout="editorial"] .vc-item{flex:1;height:72%;border-width:0 0 5px;border-radius:0;background:transparent;box-shadow:none}[data-layout="editorial"] .vc-item.is-active{flex:1.8;height:100%;border-color:var(--vc-primary);background:color-mix(in srgb,var(--vc-primary) 8%,transparent)}[data-layout="editorial"] .vc-label{font-size:54px}[data-layout="editorial"] .vc-bar{display:none}
      [data-layout="frame"] .vc-visual{padding:64px 82px;border:16px solid color-mix(in srgb,var(--vc-text) 90%,var(--vc-bg));border-top-width:58px;border-radius:34px;background:var(--vc-surface);box-shadow:0 34px 90px rgba(12,24,32,.18)}[data-layout="frame"] .vc-visual:before{content:"";position:absolute;left:30px;top:-38px;width:14px;height:14px;border-radius:50%;background:var(--vc-accent);box-shadow:26px 0 0 var(--vc-primary),52px 0 0 var(--vc-border)}
      [data-layout="social"] .vc-visual{width:900px;margin-left:auto;margin-right:auto;padding:28px;border:2px solid var(--vc-border);border-radius:48px;background:var(--vc-surface)}[data-layout="social"] .vc-items{grid-template-columns:1fr;grid-template-rows:repeat(4,1fr)}[data-layout="social"] .vc-item{border-width:0 0 1px;border-radius:0;box-shadow:none}[data-layout="social"] .vc-bar{display:none}
      [data-layout="network"] .vc-items,[data-layout="tree"] .vc-items{position:relative;grid-template-columns:repeat(4,1fr);align-items:center;gap:48px;padding:110px 20px}[data-layout="network"] .vc-items:before,[data-layout="tree"] .vc-items:before{content:"";position:absolute;left:8%;right:8%;top:50%;height:4px;background:linear-gradient(90deg,var(--vc-border),var(--vc-primary),var(--vc-border))}[data-layout="network"] .vc-item,[data-layout="tree"] .vc-item{min-height:260px;background:var(--vc-surface)}
      [data-layout="spotlight"] .vc-items,[data-layout="cta"] .vc-items{grid-template-columns:1.8fr 1fr;grid-template-rows:repeat(3,1fr)}[data-layout="spotlight"] .vc-item.is-active,[data-layout="cta"] .vc-item.is-active{grid-row:1/4;padding:54px}[data-layout="spotlight"] .vc-item.is-active .vc-label,[data-layout="cta"] .vc-item.is-active .vc-label{font-size:68px}[data-layout="spotlight"] .vc-item:not(.is-active) .vc-bar,[data-layout="cta"] .vc-item:not(.is-active) .vc-bar{display:none}
      [data-layout="dashboard"] .vc-items,[data-layout="matrix"] .vc-items{grid-template-columns:repeat(4,1fr);align-items:stretch}[data-layout="dashboard"] .vc-item,[data-layout="matrix"] .vc-item{padding-top:58px}[data-layout="dashboard"] .vc-label,[data-layout="matrix"] .vc-label{font-size:44px}[data-layout="dashboard"] .vc-bar,[data-layout="matrix"] .vc-bar{height:170px;top:auto}[data-layout="dashboard"] .vc-bar:after,[data-layout="matrix"] .vc-bar:after{width:100%;height:var(--progress,65%);margin-top:calc(170px - var(--progress,65%))}
      [data-layout="columns"] .vc-items,[data-layout="funnel"] .vc-items,[data-layout="steps"] .vc-items{display:flex;align-items:flex-end;gap:22px;padding:20px 0}[data-layout="columns"] .vc-item,[data-layout="steps"] .vc-item{flex:1;height:calc(42% + var(--i) * 11%)}[data-layout="funnel"] .vc-items{flex-direction:column;align-items:center;justify-content:center}[data-layout="funnel"] .vc-item{width:calc(100% - (var(--i) - 1) * 190px);min-height:120px;padding:22px 34px}[data-layout="funnel"] .vc-meta{position:absolute;right:34px;top:20px}
      [data-layout="cards"] .vc-items,[data-layout="carousel"] .vc-items{display:flex;align-items:center;gap:24px;padding:60px 0}[data-layout="cards"] .vc-item,[data-layout="carousel"] .vc-item{flex:1;height:430px}[data-layout="cards"] .vc-item:nth-child(even),[data-layout="carousel"] .vc-item:nth-child(even){margin-top:90px}
    </style>
  </head>
  <body>
    <main id="${definition.name}" class="vc-root" data-composition-id="${definition.name}" data-width="1920" data-height="1080" data-start="0" data-duration="${definition.duration}" data-layout="${definition.layout}" data-ipw-ai-slot="highlight">
      <header class="vc-header"><div><div class="vc-kicker">${CATEGORY_LABELS[definition.category]}</div><h1 class="vc-title" data-ipw-variable="title" data-ipw-ai-slot="title"></h1></div><p class="vc-note" data-ipw-variable="note" data-ipw-ai-slot="note"></p></header>
      <section class="vc-visual"><div class="vc-items" data-ipw-ai-slot="items"></div></section>
    </main>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/gsap.min.js"></script>
    <script>
      window.__timelines=window.__timelines||{};
      (function(){
        const root=document.getElementById(${JSON.stringify(definition.name)}),id=root.dataset.compositionId;
        const defaults=${JSON.stringify(defaults)};
        const values={...defaults,...(window.__hyperframes?.getVariables?.()??{}),...(window.__hfVariablesByComp?.[id]??{})};
        root.querySelectorAll("[data-ipw-variable]").forEach(element=>{const key=element.getAttribute("data-ipw-variable");if(key)element.textContent=String(values[key]??"")});
        const parsed=String(values.items).split("|").map(value=>{const parts=value.split("::");return{label:(parts[0]||"").trim(),meta:(parts.slice(1).join("::")||"").trim()}}).filter(item=>item.label).slice(0,4);
        const fallback=[{label:"Context",meta:"Name the situation"},{label:"Signal",meta:"Show what changed"},{label:"Decision",meta:"Choose the move"},{label:"Result",meta:"Prove the outcome"}];
        const rows=parsed.length?parsed:fallback,highlight=Math.max(1,Math.min(rows.length,Number(values.highlight)||1)),container=root.querySelector(".vc-items");
        rows.forEach((row,index)=>{const item=document.createElement("article");item.className="vc-item"+(index+1===highlight?" is-active":"");item.style.setProperty("--i",String(index+1));item.style.setProperty("--progress",String(48+index*13)+"%");const number=document.createElement("span"),label=document.createElement("strong"),meta=document.createElement("span"),bar=document.createElement("i");number.className="vc-index";number.textContent="0"+String(index+1);label.className="vc-label";label.textContent=row.label;meta.className="vc-meta";meta.textContent=row.meta;bar.className="vc-bar";item.append(number,label,meta,bar);container.append(item)});
        const items=root.querySelectorAll(".vc-item"),visual=root.querySelector(".vc-visual"),active=root.querySelector(".vc-item.is-active")||items[0],tl=gsap.timeline({paused:true});
        tl.fromTo(root.querySelectorAll(".vc-header>*"),{y:34,opacity:0},{y:0,opacity:1,duration:.55,stagger:.1,ease:"power3.out"},.06);
        ${renderMotion(definition.layout)}
        tl.fromTo(root.querySelectorAll(".vc-bar"),{scaleX:0},{scaleX:1,transformOrigin:"left",duration:.48,stagger:.07,ease:"power2.out"},.86);
        window.__timelines[id]=tl;tl.seek(0);
      })();
    </script>
  </body>
</html>
`;
}

function renderManifest(definition: ComponentDefinition): string {
  const item = {
    $schema: "https://hyperframes.heygen.com/schema/registry-item.json",
    name: definition.name,
    version: "1.0.0",
    type: "hyperframes:block",
    title: definition.title,
    description: definition.purpose,
    tags: definition.tags,
    author: "iPolloWork",
    license: "Apache-2.0",
    visualComponent: {
      version: 1,
      category: definition.category,
      surfaces: ["video"],
      themeMode: "inherit",
      ai: {
        slots: parameters,
        instructions: `AI may rewrite the title, supporting note, and up to four ${definition.subject}. Keep pipe separators between items and preserve the ${definition.layout} layout.`,
      },
    },
    dimensions: { width: 1920, height: 1080 },
    duration: definition.duration,
    engine: { name: "gsap", version: "3.13.0", seekable: true },
    files: [
      {
        path: `${definition.name}.html`,
        target: `compositions/${definition.name}.html`,
        type: "hyperframes:composition",
      },
    ],
    variables: [
      {
        id: "title",
        label: "Title",
        type: "string",
        default: definition.title,
        maxLength: 76,
        update: "live",
      },
      {
        id: "items",
        label: "Items (label::detail | ...)",
        type: "string",
        default: definition.items,
        maxLength: 280,
        update: "live",
      },
      {
        id: "highlight",
        label: "Highlighted item",
        type: "number",
        default: 1,
        min: 1,
        max: 4,
        step: 1,
        update: "live",
      },
      {
        id: "note",
        label: "Supporting note",
        type: "string",
        default: definition.note,
        maxLength: 100,
        update: "live",
      },
    ],
  };
  return `${JSON.stringify(item, null, 2)}\n`;
}

function generatedFiles(limitWave = 4): Map<string, string> {
  const files = new Map<string, string>();
  for (const definition of VISUAL_COMPONENT_EXPANSION.filter((item) => item.wave <= limitWave)) {
    const root = join(blocksRoot, definition.name);
    files.set(join(root, "registry-item.json"), renderManifest(definition));
    files.set(join(root, `${definition.name}.html`), renderHtml(definition));
  }
  return files;
}

async function readRegistryIndex(): Promise<{
  $schema: string;
  name: string;
  homepage: string;
  items: Array<{ name: string; type: string }>;
}> {
  const parsed: unknown = JSON.parse(await readFile(registryIndexPath, "utf8"));
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("items" in parsed) ||
    !Array.isArray(parsed.items)
  ) {
    throw new Error("registry/registry.json has an invalid shape");
  }
  if (!("$schema" in parsed) || typeof parsed.$schema !== "string")
    throw new Error("registry schema is missing");
  if (!("name" in parsed) || typeof parsed.name !== "string")
    throw new Error("registry name is missing");
  if (!("homepage" in parsed) || typeof parsed.homepage !== "string")
    throw new Error("registry homepage is missing");
  const items = parsed.items.filter((item): item is { name: string; type: string } =>
    Boolean(
      item &&
      typeof item === "object" &&
      "name" in item &&
      typeof item.name === "string" &&
      "type" in item &&
      typeof item.type === "string",
    ),
  );
  return { $schema: parsed.$schema, name: parsed.name, homepage: parsed.homepage, items };
}

async function updateRegistryIndex(write: boolean, limitWave = 4): Promise<boolean> {
  const registry = await readRegistryIndex();
  const names = new Set(registry.items.map((item) => item.name));
  const missing = VISUAL_COMPONENT_EXPANSION.filter(
    (definition) => definition.wave <= limitWave && !names.has(definition.name),
  ).map((definition) => ({ name: definition.name, type: "hyperframes:block" }));
  if (missing.length === 0) return true;
  if (!write) return false;
  registry.items.push(...missing);
  await writeFile(registryIndexPath, `${JSON.stringify(registry, null, 2)}\n`);
  return true;
}

async function countVisualComponents(): Promise<number> {
  let count = 0;
  for (const entry of await readdir(blocksRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const manifest: unknown = JSON.parse(
        await readFile(join(blocksRoot, entry.name, "registry-item.json"), "utf8"),
      );
      if (manifest && typeof manifest === "object" && "visualComponent" in manifest) count += 1;
    } catch {
      // Registry validation reports malformed or missing manifests separately.
    }
  }
  return count;
}

function assertManifest(): void {
  if (VISUAL_COMPONENT_EXPANSION.length !== 66) {
    throw new Error(`Expected 66 expansion components, found ${VISUAL_COMPONENT_EXPANSION.length}`);
  }
  const names = new Set<string>();
  for (const definition of VISUAL_COMPONENT_EXPANSION) {
    if (names.has(definition.name)) throw new Error(`Duplicate component ${definition.name}`);
    names.add(definition.name);
    if (!definition.nearestExisting || !definition.difference) {
      throw new Error(`${definition.name} is missing its catalog distinction`);
    }
    if (definition.proofTimes.at(-1) !== definition.duration) {
      throw new Error(`${definition.name} proof times do not include the final frame`);
    }
  }
}

async function generate(limitWave: number): Promise<void> {
  assertManifest();
  for (const [path, content] of generatedFiles(limitWave)) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
  await updateRegistryIndex(true, limitWave);
  console.log(`Generated visual component waves 1-${limitWave}.`);
}

async function check(): Promise<void> {
  assertManifest();
  const mismatches: string[] = [];
  for (const [path, expected] of generatedFiles()) {
    try {
      if ((await readFile(path, "utf8")) !== expected) mismatches.push(path);
    } catch {
      mismatches.push(path);
    }
  }
  if (!(await updateRegistryIndex(false))) mismatches.push(registryIndexPath);
  const total = await countVisualComponents();
  if (total !== 150) mismatches.push(`visual-component-count:${total}`);
  if (mismatches.length > 0) {
    throw new Error(`Visual component catalog is stale:\n${mismatches.join("\n")}`);
  }
  console.log("Visual component catalog is current: 150 components.");
}

const command = process.argv[2] ?? "check";
if (command === "generate") {
  const limitWave = Math.max(1, Math.min(4, Number(process.argv[3] ?? 4) || 4));
  await generate(limitWave);
} else if (command === "check") {
  await check();
} else {
  throw new Error(`Unknown command: ${command}`);
}
