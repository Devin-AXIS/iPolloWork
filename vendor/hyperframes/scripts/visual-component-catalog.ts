import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hyperframesCatalogItemSchema, hyperframesMotionRecipeSchema } from "../../../packages/types/src/hyperframes.ts";

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
 * Canonical manifest for 63 generated scenes in the 149-component catalog.
 * Screenshot Zoom, Device Carousel, and Spatial Camera Suite own their specialized camera choreography. Every entry
 * records its closest neighbor and a concrete visual/semantic distinction.
 */
export const VISUAL_COMPONENT_EXPANSION: ComponentDefinition[] = [
  define(4, "metric-signal", "Metric Signal", "data", "stack", "Compare nonnegative values on a shared zero baseline.", "measured quantities", "numeric bar growth", "analytical", "animated-bar-chart", "Retains exact values and a shared scale rather than decorative KPI bars.", "周一::120|周二::180|周三::90|周四::150", "示例数据 · 单位：次 · 零基线共享尺度"),
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


/** Executable native families. Numeric geometry and serial connectors have specialized renderers. */
const NATIVE_RECIPE_CONTENT: Record<string, { title: string; items: string; note: string; mode: "build" | "focus" | "compare" | "type" | "bars" | "gauge" | "funnel" | "series" | "matrix" | "flow" | "cycle" }> = {
  "metric-signal": { title: "同一口径下的请求量", items: "周一::120|周二::180|周三::90|周四::150", note: "示例数据 · 单位：次 · 零基线共享尺度", mode: "bars" },
  "gauge-scorecard": { title: "同一量表的四项得分", items: "清晰度::92|完整性::84|一致性::89|可读性::95", note: "示例评分 · 满分100 · 非客观质量证明", mode: "gauge" },
  "benchmark-scorecard": { title: "相对同一目标的完成度", items: "准备::92|交付::84|复核::89|归档::95", note: "示例数据 · 各项完成百分比 · 目标100%", mode: "gauge" },
  "conversion-funnel": { title: "同一批用户逐步转化", items: "访问::1000|注册::340|试用::120|购买::38", note: "示例数据 · 同一批用户 · 宽度相对初始人数", mode: "funnel" },
  "cohort-retention": { title: "同口径的三期留存", items: "一月组::92,81,74|二月组::94,84,77|三月组::91,86,79|四月组::96,89,82", note: "示例数据 · 第1/2/3期 · 百分比 · 同一口径", mode: "matrix" },
  "sparkline-grid": { title: "四组数据的变化轨迹", items: "组一::12,18,14|组二::8,16,20|组三::20,12,8|组四::10,15,19", note: "示例数据 · 同一单位 · 三期 · 共享零基线", mode: "series" },
  "process-handoff-map": { title: "每次交接传递什么", items: "需求交设计::目标与约束|设计交开发::规格与素材|开发交审阅::实现与证据|审阅交发布::决定与版本", note: "箭头表示交接顺序，不代表已完成", mode: "flow" },
  "deployment-pipeline": { title: "变更如何经过发布门槛", items: "提交::确定源代码版本|构建::产生可追溯产物|测试::验证用户操作|发布::部署已验证版本", note: "概念流程 · 不是实时部署状态", mode: "flow" },
  "feedback-loop": { title: "结果如何回到下一次行动", items: "观察::读取结果信号|调整::修改当前行动|执行::产生新的结果|复核::把结果带回观察", note: "概念反馈闭环 · 不模拟增益或振荡", mode: "cycle" },
  "agenda-opener": { title: "今天要弄清的四件事", items: "问题::哪里出了偏差|机制::变化如何传递|证据::哪些现象支持它|应用::怎样判断下一步", note: "按理解顺序建立路线", mode: "build" },
  "narrative-hook": { title: "忙碌为何没有带来进展", items: "现象::任务越来越多|矛盾::结果没有改善|转折::先看协作方式|问题::哪里可以减少等待", note: "引出问题，不先堆结论", mode: "focus" },
  "chapter-countdown": { title: "判断之前的三个问题", items: "目标::究竟想改变什么|反馈::能看见什么信号|行动::调整是否足够及时", note: "编号表示阅读顺序，不是假倒计时", mode: "build" },
  "speaker-intro": { title: "从不同视角理解问题", items: "研究者::解释机制与证据|实践者::说明具体操作|学习者::提出仍然不懂的地方", note: "示例角色，不冒充真实人物", mode: "focus" },
  "feature-spotlight-stack": { title: "把审阅集中到同一处", items: "上下文::先看到任务背景|批注::指出具体修改位置|确认::保留最终决定", note: "讲功能，不用空卡冒充产品截图", mode: "focus" },
  "definition-highlight": { title: "反馈不是评价", items: "反馈::结果重新影响输入|评价::表达好坏判断|区别::机制与态度不是一回事", note: "先定义，再澄清边界", mode: "type" },
  "faq-stack": { title: "反馈回路的常见问题", items: "正反馈好吗::正指变化被放大|负反馈坏吗::负指偏差被减小|都会稳定吗::延迟也会引起振荡", note: "按问题逐一回答", mode: "focus" },
  "expert-panel": { title: "同一个决策的三种视角", items: "研究视角::先核对证据来源|业务视角::确认实际约束|使用视角::检查操作是否清楚", note: "视角示例，不虚构专家背书", mode: "focus" },
  "founder-story": { title: "从一次失败到一个选择", items: "起点::反复等待审阅|困难::信息散落在多处|尝试::把背景和反馈放一起|选择::先解决最常见的阻塞", note: "示例叙事，不代表真实人物履历", mode: "build" },
  "brand-manifesto": { title: "让协作有清楚的依据", items: "先理解::保留任务背景|再行动::让过程可见|后复核::用证据确认结果", note: "价值主张对应具体行动", mode: "type" },
  "kinetic-keyword": { title: "反馈回路的三个动词", items: "观察::先读取变化信号|调整::再改变当前行动|复核::最后检查新的结果", note: "动词推进，不把每个字都做花字", mode: "type" },
  "quote-pullout": { title: "一句话里的重点", items: "原句::先看机制再评好坏|重点::正负不是价值判断|解释::它描述变化的方向", note: "示例句，真实引用需补作者与出处", mode: "type" },
  "customer-quote-wall": { title: "把反馈按问题归类", items: "定位::找不到当前进度|理解::不知道结果意味着什么|行动::不清楚下一步该做什么", note: "合成测试反馈，不冒充真实客户证言", mode: "focus" },
  "source-citation-card": { title: "结论背后需要什么来源", items: "结论::延迟可能引起振荡|依据::带延迟的温控模型|边界::模型不能代替所有现实情况", note: "示例论证，正式发布需可追溯引用", mode: "build" },
  "team-spotlight": { title: "一次审阅需要怎样配合", items: "作者::提供背景和初稿|审阅者::说明问题与依据|负责人::确认最终取舍", note: "角色依次聚焦，关系保持可见", mode: "focus" },
  "brand-system-board": { title: "同一品牌的一套表达", items: "文字::让标题与解释分工|颜色::只强调当前重点|动效::在信息改变时推进", note: "表达原则，不冒充完整品牌规范", mode: "build" },
  "partner-logo-feature": { title: "合作关系如何形成价值", items: "内容方::提供可靠信息|工具方::完成处理与呈现|使用方::确认内容是否有效", note: "角色示例；标志展示应选真实素材配方", mode: "focus" },
  "creator-profile-card": { title: "让创作者介绍更具体", items: "方向::关注知识讲解|方法::先举例再解释|作品::展示可核验的案例", note: "示例档案，不虚构身份或成绩", mode: "focus" },
  "feature-adoption-ladder": { title: "从看懂到真正使用", items: "认识::知道它解决什么|尝试::完成一次小任务|复用::找到稳定的使用场景|习惯::纳入原来的工作流程", note: "阶段不是转化率或用户数量", mode: "build" },
  "release-highlights": { title: "这次更新改变了什么", items: "编辑::信息位置更清楚|保存::修改状态更明确|验证::交付前检查实际效果", note: "示例更新，发布时替换为真实变更", mode: "focus" },
  "product-comparison-stage": { title: "两种协作方式的差别", items: "分散处理::背景在多个窗口|集中处理::背景与结果在同一处|分散处理::审阅时重新找资料|集中处理::直接核对相关内容", note: "比较具体体验，不虚构性能数字", mode: "compare" },
  "section-marker": { title: "接下来，看机制", items: "现象::先确认发生了什么|机制::再理解为什么变化|应用::最后判断如何应对", note: "节标签服务阅读，不抢过渡镜头", mode: "type" },
};

const NATIVE_RECIPE_FIT: Record<string, { useWhen: string; avoidWhen: string; items: string; readingOrder: string[]; acceptance: string }> = {
  "metric-signal": { useWhen: "比较2–4个同单位、同统计口径的非负数量。", avoidWhen: "混合单位、负数、双轴和分布不能使用；不推断因果或增长率。", items: "标签::非负数；条长按所有输入最大值共享归一化，保留零值和原始数。", readingOrder: ["交代单位与统计口径", "随旁白逐项展示数量", "保留共享基线比较差距"], acceptance: "条长比等于输入数值比；最大值与零值均不造假。" },
  "gauge-scorecard": { useWhen: "展示同一0–100量表下的2–4项评分。", avoidWhen: "没有量表依据的主观好坏判断、原始数量、负数或超过100的评分。", items: "标签::0到100的得分；填充相对固定满分100，不按当前最大分放大。", readingOrder: ["说明量表和评分来源", "逐项填充到实际得分", "比较相同满分下的差距"], acceptance: "92分只能填充92%，不能因为它是最大值而变成满格。" },
  "benchmark-scorecard": { useWhen: "展示相对各自明确目标、同口径归一化后的完成百分比。", avoidWhen: "原始单位不同而未归一化，目标不明，或超额完成超过100%。", items: "标签::0到100的完成百分比；原始目标与归一化口径必须在旁白或注释说明。", readingOrder: ["交代目标与完成口径", "逐项展示距100%的差距", "落到未完成部分"], acceptance: "固定100%基准可见，未完成区间保留；不能宣称这些数值证明质量通过。" },
  "conversion-funnel": { useWhen: "同一批对象依次经过2–4个有明确条件的转化阶段。", avoidWhen: "跨批次拼接、人数回升、第一阶段为0、不同单位或阶段之间没有包含关系。", items: "阶段::非负人数，首项大于0，后项不得大于前项；宽度相对首项而非固定减宽。", readingOrder: ["明确初始人群", "逐阶段显示剩余人数", "保留全漏斗解释损失发生在哪"], acceptance: "每段宽度严格对应人数/初始人数；0人不能画成非零转化。" },
  "cohort-retention": { useWhen: "2–4个可比队列，各有同口径的三期留存百分比。", avoidWhen: "不是同口径队列、缺期、原始人数或绝对计数；不用于滚动活跃率。", items: "队列::第1期百分比,第2期百分比,第3期百分比；每数0–100且依次不增。", readingOrder: ["说明队列与三期定义", "逐行呈现完整三期", "对照相同列解释留存差别"], acceptance: "三个独立格子显示输入百分比；色阶固定0–100，不按每行极值改色。" },
  "sparkline-grid": { useWhen: "2–4组同单位、同采样间隔的数据，各有三个非负观测值。", avoidWhen: "不同单位、负值、缺期；不能推断插值期间发生过什么或把曲线当物理模拟。", items: "组名::第1期值,第2期值,第3期值；全组共享最大值与零基线。", readingOrder: ["说明单位和三期定义", "按旁白绘制各组折线", "保留共同尺度比较方向"], acceptance: "折线端点来自真实三个输入，零基线和共享尺度一致；无装饰性随机波形。" },
  "process-handoff-map": { useWhen: "2–4次连续交接，每次说明交给谁以及传递内容。", avoidWhen: "分支、并行、循环或双向协议；这些需独立关系配方。", items: "交接双方::传递的实际内容；按真实交接顺序提供。", readingOrder: ["说明交接目标", "每次交接同步亮起连接箭头与内容", "保留整条交接链复核遗漏"], acceptance: "连接线依附相邻节点边界且不穿过文字；旁白说到交接时对应箭头出现。" },
  "deployment-pipeline": { useWhen: "解释2–4个串行工程门槛及每步产物，不冒充实时运行。", avoidWhen: "并行任务、失败回退和实际通过状态；没证据不能标成已通过。", items: "门槛名::验收条件或产物；不要用模拟成功状态替代条件。", readingOrder: ["建立工程目标", "依次连通门槛与产物", "保留完整安全发布路径"], acceptance: "节点与连接同步推进，文字清楚说明条件；不伪造运行状态。" },
  "feedback-loop": { useWhen: "说明2–4步首尾相接的概念反馈循环；恒温器等控制原理可合并为比较、执行、测量、回传四步，目标值放在标题或注释。", avoidWhen: "需要模拟真实物理温度变化、增益、延迟振荡或分支，而非解释概念回路。", items: "循环阶段::阶段作用；最后阶段必须逻辑上返回第一阶段。", readingOrder: ["建立观察对象", "逐步连通行动与结果", "沿返回箭头回到第一阶段"], acceptance: "最后有明确可见的返回路径；循环不是几张无关系的淡入卡。" },
  "agenda-opener": {
    "useWhen": "预告本片将回答的2–4个问题，给观众一条理解路线。",
    "avoidWhen": "不是结论总结或操作教程；操作顺序用 product-steps，结论回顾用 summary-resolve。",
    "items": "每项是一个将被实际回答的问题或章节，按理解依赖排序，不按文档页码。",
    "readingOrder": [
      "先明确主题",
      "逐一展示待回答的问题",
      "保留完整路线，进入第一个问题"
    ],
    "acceptance": "问题顺序与后续内容一致；每个问题都在片中得到回应。"
  },
  "narrative-hook": {
    "useWhen": "用现象、矛盾和待解问题建立观看动机。",
    "avoidWhen": "不适合直接解释机制或罗列证据；单一提问用 question-opener，因果说明用 cause-effect-chain。",
    "items": "各项组成同一矛盾的推进，不编造悬念或把相关现象写成因果。",
    "readingOrder": [
      "建立可核验的现象",
      "指出现象与预期的冲突",
      "把注意力落到一个待解问题"
    ],
    "acceptance": "观众能说出冲突和待解问题，而不是只记住入场特效。"
  },
  "chapter-countdown": {
    "useWhen": "依次提出判断前必须检查的2–4个条件或问题。",
    "avoidWhen": "不是计时器，不呈现倒计时或时间流逝；带日期的进程用 milestone-timeline。",
    "items": "编号表示阅读顺序；每项是不同检查条件，不虚构截止时间。",
    "readingOrder": [
      "说明判断任务",
      "按顺序检查条件",
      "保留全部条件作为判断依据"
    ],
    "acceptance": "编号与检查顺序一致；画面和旁白均不声称真实倒计时。"
  },
  "speaker-intro": {
    "useWhen": "用文字说明讲述者或参与角色与本片问题的关联。",
    "avoidWhen": "不展示人物头像或数字人；多人职责配合用 team-spotlight，多视角论证用 expert-panel。",
    "items": "使用可核验姓名与职责，匿名示例明确标注；不伪造资质或专家身份。",
    "readingOrder": [
      "说明介绍对象",
      "聚焦其角色与相关经历",
      "说明为什么由其讲这个问题"
    ],
    "acceptance": "身份、职责和资格有依据；不把示例角色当真实人物背书。"
  },
  "feature-spotlight-stack": {
    "useWhen": "逐一解释产品功能在同一任务中解决什么具体问题。",
    "avoidWhen": "不是操作演示或界面截图；真实画面用 media-hero，步骤用 product-steps。",
    "items": "每项写真实功能及用户收益，不使用不存在的功能或未测量的性能提升。",
    "readingOrder": [
      "建立用户任务",
      "逐项聚焦功能与作用",
      "回到任务得到的结果"
    ],
    "acceptance": "每项能对应真实功能；文字说明不被宣称为真实产品演示。"
  },
  "definition-highlight": {
    "useWhen": "澄清一个术语的定义、相邻概念与边界。",
    "avoidWhen": "不适合完整过程、公式推导或连续模拟；机制用 cause-effect-chain，分层关系用 concept-layers。",
    "items": "各项服务同一个术语；定义不循环解释，例子和例外不能冒充定义。",
    "readingOrder": [
      "提出术语",
      "解释定义和易混淆概念",
      "落到区别或适用边界"
    ],
    "acceptance": "观众能区分该术语与邻近概念，而不仅看到多个关键词。"
  },
  "faq-stack": {
    "useWhen": "逐个回答围绕同一主题的独立常见问题。",
    "avoidWhen": "不把强依赖的步骤拆成问答；学习路径用 learning-path，连续因果用 cause-effect-chain。",
    "items": "每项 label 是一个问题，detail 是直接回答；保留条件，不承诺无依据的确定性。",
    "readingOrder": [
      "呈现当前问题",
      "聚焦直接回答",
      "回看问题与答案的对应关系"
    ],
    "acceptance": "问题出现时对应答案可读；答案实际回答问题，不重复标题。"
  },
  "expert-panel": {
    "useWhen": "比较同一问题的不同专业视角和约束。",
    "avoidWhen": "不是专家头像面板或真实访谈；意见不等于证据，单一指标比较用 comparison-matrix。",
    "items": "每项是视角及依据，真实引用注明来源；无真实专家时用视角名称，不编造姓名或背书。",
    "readingOrder": [
      "明确共同问题",
      "逐项读取不同视角",
      "保留观点差异和共同约束"
    ],
    "acceptance": "各视角有不同依据；不以多张观点卡制造专家共识。"
  },
  "founder-story": {
    "useWhen": "讲清一个真实经历中的起点、阻碍、尝试与选择。",
    "avoidWhen": "不是人物肖像或档案素材；单纯日期进程用 milestone-timeline，价值宣言用 brand-manifesto。",
    "items": "同一人物或团队的一条经历；事件与选择必须有依据，不能补写虚构成功转折。",
    "readingOrder": [
      "建立起点",
      "推进阻碍与尝试",
      "落到有依据的选择"
    ],
    "acceptance": "选择由前面的经历解释；示例故事不被包装成真实履历。"
  },
  "brand-manifesto": {
    "useWhen": "用少量原则及具体行动表达品牌立场。",
    "avoidWhen": "不是品牌规范、产品功能说明或业绩证据；系统原则用 brand-system-board，功能用 feature-spotlight-stack。",
    "items": "每项原则对应可理解的行动，不使用空泛口号或无法兑现的保证。",
    "readingOrder": [
      "提出核心立场",
      "逐项解释原则如何行动",
      "收束为一致主张"
    ],
    "acceptance": "每条价值观有对应行动；没有无依据的唯一、领先或保证性宣称。"
  },
  "kinetic-keyword": {
    "useWhen": "把同一概念压缩成2–4个短关键词或动作词，依次强调。",
    "avoidWhen": "不是单词级字幕或单个全屏大词；逐词短句填色用 shotcraft-karaoke-fill，定义解释用 definition-highlight。",
    "items": "每项为短关键词和简短解释；顺序必须有意义，不把长段旁白切成花字。",
    "readingOrder": [
      "建立主题",
      "按语义顺序强调关键词",
      "保留完整短词组关系"
    ],
    "acceptance": "被强调的词对应当前发声内容；文字动效不替代机制表达。"
  },
  "quote-pullout": {
    "useWhen": "从一条有来源的原句中提炼重点并给出解释。",
    "avoidWhen": "不是多人证言墙或原始证据；反馈归类用 customer-quote-wall，论证来源用 source-citation-card。",
    "items": "保留原句意思和条件，注明作者或出处；示例句明确标注，不编造引文。",
    "readingOrder": [
      "展示原句",
      "聚焦原句中的重点",
      "给出与原意一致的解释"
    ],
    "acceptance": "提炼不改变原句含义；观众能区分引文与作者解释。"
  },
  "customer-quote-wall": {
    "useWhen": "将可追溯的用户反馈按同一问题归类并逐项聚焦。",
    "avoidWhen": "不适合证明统计比例或满意度；量化证据用 evidence-stack，单条引文用 quote-pullout。",
    "items": "每项是反馈主题及忠实摘要；匿名或合成测试内容注明，不伪造客户身份或样本代表性。",
    "readingOrder": [
      "明确反馈议题",
      "逐项查看反馈主题",
      "保留共同问题与差异"
    ],
    "acceptance": "摘要有原反馈依据；个别反馈未被包装成全体用户结论。"
  },
  "source-citation-card": {
    "useWhen": "按结论、依据、边界解释一个可追溯论证。",
    "avoidWhen": "不是自动生成参考文献或数字图表；核心量化证据用 evidence-stack，多数值比较用 bar-chart-race。",
    "items": "各项围绕同一结论，note 保留来源或限定；来源过长时拆镜，不删除可追溯信息。",
    "readingOrder": [
      "明确结论",
      "展示支持依据",
      "读到来源和适用边界"
    ],
    "acceptance": "依据支持所述结论；限定条件在最终画面保留，不被动效隐藏。"
  },
  "team-spotlight": {
    "useWhen": "说明同一任务中不同角色的职责与配合。",
    "avoidWhen": "不是人物肖像轮播或流程连线图；单人介绍用 speaker-intro，交接流程用 swimlane-workflow。",
    "items": "每项为真实角色和职责，必要时注明示例；不虚构成员身份或用职位替代具体责任。",
    "readingOrder": [
      "建立共同任务",
      "逐个聚焦角色职责",
      "回看角色如何共同承担任务"
    ],
    "acceptance": "职责可区分且不遗漏必要责任；文字卡不冒充人物素材或交接动画。"
  },
  "brand-system-board": {
    "useWhen": "说明品牌文字、颜色、动效等表达原则如何保持一致。",
    "avoidWhen": "不是色板、字体试样或完整品牌规范渲染；品牌立场用 brand-manifesto，真实规范截图用 media-hero。",
    "items": "每项是一个设计维度及可执行原则，不声称文本卡已经展示真实字体、色值或标志。",
    "readingOrder": [
      "说明统一表达目标",
      "解释各维度原则",
      "保留系统之间的一致关系"
    ],
    "acceptance": "观众看到的是明确原则；未渲染的视觉样本不被宣称为已展示。"
  },
  "partner-logo-feature": {
    "useWhen": "用文字说明合作方或合作角色的分工与价值。",
    "avoidWhen": "本实现不渲染合作方标志或资产；标志展示需真实素材配方，不将文字卡称为 logo 墙。",
    "items": "每项为已确认的合作方名称或明确标注的示例角色；detail 说明贡献，不暗示未授权合作。",
    "readingOrder": [
      "建立合作任务",
      "逐项说明参与方贡献",
      "回看共同结果"
    ],
    "acceptance": "合作关系可核验；画面只声称文字分工说明，不声称展示品牌标志。"
  },
  "creator-profile-card": {
    "useWhen": "用创作方向、方法和可核验作品介绍一个创作者。",
    "avoidWhen": "不是头像、平台主页或粉丝数据展示；讲述者角色用 speaker-intro，经历故事用 founder-story。",
    "items": "各项属于同一创作者，作品与成就需可核验；匿名样例标注，不填演示身份。",
    "readingOrder": [
      "建立创作者方向",
      "解释方法",
      "落到可核验作品"
    ],
    "acceptance": "介绍说明其实际创作特色；未显示的头像、作品画面或指标不被声称已展示。"
  },
  "feature-adoption-ladder": {
    "useWhen": "说明同一功能从认识、尝试到稳定使用的阶段变化。",
    "avoidWhen": "不是转化漏斗、用户数量或增长图；真实操作用 product-steps，学习前置关系用 learning-path。",
    "items": "每项为阶段及可观察行为；没有量化数据时不写转化率，阶段不保证所有用户都会完成。",
    "readingOrder": [
      "说明使用目标",
      "按阶段展示行为变化",
      "回看稳定使用的条件"
    ],
    "acceptance": "相邻阶段有行为差异；阶段卡不被解释成测量的转化统计。"
  },
  "release-highlights": {
    "useWhen": "聚焦一次真实发布中2–4项对用户有影响的变更。",
    "avoidWhen": "不是未来路线图或完整操作教程；具体操作用 product-steps，跨时间发布进程用 milestone-timeline。",
    "items": "每项是已交付变更和用户影响；计划中或实验性内容明确标注，不能写成已完成。",
    "readingOrder": [
      "说明发布范围",
      "逐项聚焦真实变化",
      "回顾本次用户得到什么"
    ],
    "acceptance": "每项对应实际发布状态；动画未暗示未经验证的性能或质量提升。"
  },
  "product-comparison-stage": {
    "useWhen": "按同一体验维度交替比较两种方式或状态。",
    "avoidWhen": "不是数据矩阵或多个产品排名；多维精确数值用 comparison-matrix，同一对象前后变化用 before-after-contrast。",
    "items": "仅2项或4项；每对依次为 A、B 在同一维度的描述，4项时顺序 A1、B1、A2、B2；条件与措辞公平。",
    "readingOrder": [
      "建立两个比较对象",
      "按同一维度读取 A 与 B",
      "保留差异与适用条件"
    ],
    "acceptance": "每对内容比较同一维度；不出现无配对第三项或虚构优劣。"
  },
  "section-marker": {
    "useWhen": "用全画面文字卡说明接下来要进入哪个理解阶段。",
    "avoidWhen": "本实现不是角落的小节标签；不能覆盖主体充当小标记，开场路线用 agenda-opener。",
    "items": "每项是接下来真实展开的小节或理解阶段；标题标明当前转折，不加入新证据。",
    "readingOrder": [
      "提示即将切换阶段",
      "展示新阶段的阅读方向",
      "落到下一幕实际内容"
    ],
    "acceptance": "章节提示与下一幕一致；全画面卡有阅读时间，不被当成角落叠加标签。"
  }
};

// The audience outcome is authored per executable recipe, including purely typographic treatments.
// A movement name or generic render-health check is not a narrative reason to select a recipe.
const RECIPE_INTENTS: Record<string, string> = {
  "agenda-opener": "把将回答的问题排成理解路线，让观众知道接下来为何依次观看这些内容。",
  "bar-chart-race": "把同口径数值映射成可比较的长度，让观众看出真实大小差距与排序。",
  "before-after-contrast": "并置同一对象的前后状态，让观众看清变化发生在哪里，而非误以为是两个对象。",
  "benchmark-scorecard": "把各项完成度对准明确目标，让观众看到距离目标还有多少，而非仅比较谁更大。",
  "brand-headline": "先给出品牌承诺及其支撑信息，让观众理解本片的表达立场。",
  "brand-manifesto": "把品牌原则接到具体行动，让观众理解立场如何兑现，而非只记住口号。",
  "brand-system-board": "把各表达维度的原则放在同一系统中，让观众理解它们如何保持一致。",
  "cause-effect-chain": "逐段显露有依据的因果连接，让观众能复述原因如何导致结果。",
  "chapter-countdown": "按判断顺序提出必要条件，让观众知道做决定前还要检查什么。",
  "checklist-reveal": "逐项呈现可执行的检查动作，让观众最后得到一张可复核的清单。",
  "code-diff-card": "在同一代码位置对照修改前后，让观众看出哪一行变化带来什么影响。",
  "code-walkthrough": "沿真实代码的阅读顺序聚焦关键行，让观众理解整体片段怎样工作。",
  "cohort-retention": "把同口径队列与时期排成矩阵，让观众比较留存如何随时间变化。",
  "comparison-matrix": "让两个选项始终按相同标准对齐，使观众基于条件而非视觉强调作比较。",
  "concept-layers": "自基础到应用逐层建立依赖，让观众理解上层为何需要下层。",
  "conversion-funnel": "按真实包含关系收窄各阶段人数，让观众定位损失发生在哪一步。",
  "creator-profile-card": "把创作方向、方法与作品连成证据链，让观众理解创作者的实际特色。",
  "customer-quote-wall": "把可追溯反馈按同一问题聚合，让观众看到共同点与分歧而非虚构共识。",
  "definition-highlight": "从定义推进到相邻概念和边界，让观众能正确区分这个术语。",
  "deployment-pipeline": "逐道呈现发布门槛及产物，让观众理解安全发布的依赖顺序。",
  "evidence-stack": "让主张、数值和来源同时可见，使观众能判断证据是否真的支持结论。",
  "expert-panel": "把不同专业视角对准同一问题，让观众理解其约束与分歧而非误认为一致结论。",
  "faq-stack": "使每个问题紧接可读的直接回答，让观众逐项解除独立疑问。",
  "feature-adoption-ladder": "从认识到稳定使用逐级呈现行为变化，让观众理解采纳需要哪些条件。",
  "feature-spotlight-stack": "把功能与同一用户任务中的具体作用配对，让观众理解它解决哪一步。",
  "feedback-loop": "从观察经行动到结果回传形成可见闭环，让观众理解下一次行动为何会改变。",
  "formula-breakdown": "拆开公式中的输入与关系再合成结果，让观众明白计算的含义而非只记住式子。",
  "founder-story": "沿真实经历中的阻碍与选择推进，让观众理解最后决定的来由。",
  "gauge-scorecard": "把多项评分固定在同一满分标尺上，让观众看清各项距满分的真实差距。",
  "kinetic-keyword": "按语义顺序强调少量关键词，让观众抓住同一概念的几个关键动作。",
  "learning-path": "按前置关系展开学习阶段，让观众知道下一步应建立在什么能力之上。",
  "media-hero": "沿真实素材的可见细节引导视线，让观众亲眼核对旁白所指的对象。",
  "metric-signal": "用共享零基线呈现数值，让观众比较数量而不受独立缩放误导。",
  "milestone-timeline": "沿真实时间顺序连接三个节点，让观众理解事件怎样走到当前状态。",
  "myth-fact-reveal": "先呈现常见误解再揭示证据与边界，让观众修正原有判断。",
  "narrative-hook": "用真实现象与预期冲突提出待解问题，让观众产生有依据的观看动机。",
  "next-step-outro": "把结论接到少量可执行动作，让观众知道离开视频后该做什么。",
  "partner-logo-feature": "用文字说明参与方各自贡献，让观众理解合作分工而不误认有标志素材。",
  "process-handoff-map": "让每次交接的双方、内容与方向同步出现，使观众追踪责任如何传递。",
  "product-comparison-stage": "在相同体验维度间交替对照两种方式，让观众理解差异及适用条件。",
  "product-steps": "把有顺序的操作逐一连到结果，让观众知道实际完成任务的路径。",
  "question-opener": "用一个可回答的问题和必要背景开场，让观众知道后续内容要解决什么。",
  "quote-pullout": "从有出处的原句提取重点并解释，让观众区分原话与作者解读。",
  "release-highlights": "逐项呈现已发布变化及用户影响，让观众知道这次更新具体改变了什么。",
  "section-marker": "用短暂全画面章节提示建立下一段方向，让观众意识到理解任务正在切换。",
  "shotcraft-blur-slide": "让短标题由模糊落到清晰，标示一个观点终于明确，而非承担事实证明。",
  "shotcraft-brace-expand": "用括号框定短概念的讨论范围，让观众知道随后展开的是哪一部分。",
  "shotcraft-card-stack": "把八张真实图像由堆叠展开，让观众先感到数量，再看见内容差异。",
  "shotcraft-dolly-zoom": "在真实素材中固定主体并扩张背景，让观众感到该主体的重要性与环境关系。",
  "shotcraft-drift-assembly": "让分散字符归拢成可读标题，传达多个线索正在汇成一个主题。",
  "shotcraft-error-retype": "先呈现不准确表述再删除改写，让观众看见认识如何被纠正。",
  "shotcraft-font-weight-pump": "按实测语义或音乐节拍改变同一短词字重，让观众感到这一次强调。",
  "shotcraft-glitch-cycle": "在四个状态间推进并锁定最终状态，让观众看清同一任务的阶段变化。",
  "shotcraft-gradient-word-sweep": "只给当前关键词一次渐变强调，让观众识别本段的核心概念。",
  "shotcraft-karaoke-fill": "按实际发声顺序填亮短句词组，让观众听到与看到的是同一段语言。",
  "shotcraft-lead-word-zoom-assemble": "先放大句首概念再退回完整标题，让观众由核心词走向完整论点。",
  "shotcraft-letter-drop": "让短标题字符轻快落位，为轻松内容建立语气，再停住供观众阅读。",
  "shotcraft-marker-title": "像手工批注一样划出短标题的一个重点词，让观众先读到真正的焦点。",
  "shotcraft-multiplane": "沿真实素材的空间层次推进视线，让观众理解前后景与主体的相对位置。",
  "shotcraft-outline-word-fill": "将当前关键词由轮廓填实，让观众在说到它时完成一次语义聚焦。",
  "shotcraft-pill-chip-slot-cycle-handled": "在固定句式中轮换四项真实职责，让观众理解同一主体覆盖的不同工作。",
  "shotcraft-pill-slot-cycle": "在固定句式中逐项替换六个功能，让观众理解范围，最后回到完整概括。",
  "shotcraft-scramble": "把未知短词逐步锁定为清晰标题，让观众经历一次有意义的揭晓。",
  "shotcraft-scramble-decode": "由乱码解码出真实标题，让观众从未知进入明确主题，关键事实只在落定后阅读。",
  "shotcraft-split-flap-title": "用机械翻牌揭示短标题，给新章节一个清楚的转折信号。",
  "shotcraft-split-text-stagger": "让短标题按字符错峰入场并落定，提示章节开始而不遮盖后续内容。",
  "shotcraft-terminal-typewriter": "先呈现真实命令再接对应截图，让观众理解命令与实际结果的联系。",
  "shotcraft-text-column-converge": "让多个短主题轮换后汇成最后的标题，使观众感到话题正在收束。",
  "shotcraft-text-on-path": "让短标题沿曲线进入再回到基线，为方向变化作提示而不把轨迹当数据。",
  "shotcraft-title-demote-to-label": "把真实页面的章节标题降为阅读标签，让观众保持位置感并进入具体内容。",
  "shotcraft-tracking-expand": "用平静的字距展开引入短概念，再补解释，让观众获得可读的章节起点。",
  "shotcraft-typing-code-block": "按真实代码的阅读顺序逐行或逐字呈现，让观众跟上代码结构。",
  "shotcraft-vertical-word-roll-blur-cycle": "在固定前缀下轮换短词并停在末项，让观众理解同一问题的几种方向。",
  "shotcraft-word-relay-filmstrip": "让同一真实页面与三个关联动词接力同步，让观众把动作映射到素材变化。",
  "shotcraft-word-relay-geometry": "以三个关键词的接力形成强调层级，让观众按正确顺序读出短概念。",
  "source-citation-card": "从主张推进到依据与来源边界，让观众知道结论凭什么成立、适用于何处。",
  "sparkline-grid": "用共同尺度连接各组三期观测值，让观众比较已发生的方向而不臆测中间过程。",
  "speaker-intro": "把讲述者的真实身份与问题关联起来，让观众知道此人为何参与叙述。",
  "summary-resolve": "把已解释的要点收束到一个有依据的判断，让观众带走清楚的结论。",
  "swimlane-workflow": "在角色泳道中逐一呈现动作与交接，让观众看清谁在何时负责哪一步。",
  "team-spotlight": "逐个说明同一任务中的角色职责，再回到协作关系，让观众理解如何分工。",
};

function nativeRecipe(definition: ComponentDefinition) {
  const content = NATIVE_RECIPE_CONTENT[definition.name];
  if (!content) return undefined;
  const fit = NATIVE_RECIPE_FIT[definition.name];
  if (!fit) throw new Error(`Missing narrative fit rules for ${definition.name}`);
  const labels = content.items.split("|").map(item => item.split("::")[0]);
  const actions = Array.from({ length: 4 }, (_, index) => `Explain supplied item ${index + 1} in narration order`);
  const events = actions.map((action, index) => ({ id: `step-${index + 1}`, target: `.vc-item:nth-child(${index + 1})${definition.name === "process-handoff-map" ? ", .vc-carrier" : ""}`, time: [1.2, 2.6, 4.1, 5.5][index], duration: .5, action }));
  events.push({ id: "resolve", target: ".vc-item", time: 6.6, duration: .55, action: "Restore the complete readable relationship" });
  const quantitative = ["bars", "gauge", "funnel", "series", "matrix"].includes(content.mode);
  const connected = content.mode === "flow" || content.mode === "cycle";
  return {
    version: 1, pattern: content.mode === "compare" ? "state-transformation" : content.mode === "type" ? "kinetic-type" : content.mode === "focus" ? "focus-transfer" : "progressive-build",
    minHoldSeconds: .7,
    capacity: { variable: "items", separator: "|", minItems: 2, maxItems: 4, fieldSeparator: "::", fieldsPerItem: 2, maxFieldLength: 24, ...(["bars", "gauge", "funnel"].includes(content.mode) ? { numericField: 1 } : {}) },
    textLimits: { title: { maxLines: 1, maxLineLength: 24 }, note: { maxLines: 1, maxLineLength: 40 } },
    events,
    usage: {
      intent: RECIPE_INTENTS[definition.name],
      useWhen: [fit.useWhen],
      avoidWhen: [fit.avoidWhen, quantitative ? "No fabricated or independently rescaled data; supply provenance and a common measurement basis." : connected ? "Only the stated serial topology; no arbitrary branching, spatial or physical simulation." : "This is a text-led treatment: not a measured chart, real screenshot, spatial camera or continuous simulation."],
      inputRules: { title: "One content-specific heading, at most 24 characters.", items: "2–4 label::detail entries separated by |; each field at most 24 characters. " + fit.items, highlight: "A real integer pointing to an existing item; it marks the final emphasis, not an inferred metric.", note: "One qualifier or source note, at most 40 characters. Retain uncertainty and evidence limitations." },
      readingOrder: fit.readingOrder,
      cueBindings: Object.fromEntries(events.map(event => [event.id, event.id === "resolve" ? "Bind to the concluding phrase that resolves the shown relationship." : "Bind to the exact measured phrase introducing this item, never its text-length estimate."])),
      fallback: { overflow: "Split at a semantic boundary or choose a suitable recipe; never truncate or shrink text.", missingInput: "Report the missing real content or evidence; do not substitute demo defaults.", timingMismatch: "Bind every active event to measured narration while preserving order, nonoverlap and a readable final hold.", inapplicable: "Choose another proven native recipe. Under recipes-only policy report the capability gap; do not create custom graphics." },
      example: { values: { title: content.title, items: content.items, highlight: 1, note: content.note }, narration: labels.join("，") + "，最后把它们放回同一个问题中理解。" },
      acceptance: [fit.acceptance, "Every active phrase changes its real visible target; forward and reverse seek reproduce the same state.", "Chinese content fits at minimum and maximum capacity without cropped or overlapping labels.", quantitative ? "Numeric geometry uses actual input values and the documented shared scale, not decorative bars." : connected ? "Connections carry the declared relationship and remain attached to their nodes." : "This text-led treatment communicates its declared purpose, without pretending to render charts, real media or physical simulations."],
    },
  };
}

function renderNativeMotion(definition: ComponentDefinition): string {
  const recipe = nativeRecipe(definition), content = NATIVE_RECIPE_CONTENT[definition.name];
  if (!recipe || !content) return "";
  return `<script data-ipw-motion-recipe="1">
(function(){
 const root=document.getElementById(${JSON.stringify(definition.name)}),id=root.dataset.compositionId,values=window.__hyperframes?.getVariables?.()??window.__hfVariablesByComp?.[id]??{};
 const recipe=${JSON.stringify(recipe)};
 const cues=JSON.parse(String(values.motionCueTimes??"{}")),events=recipe.events.filter(event=>root.querySelector(event.target));
 window.__timelines[id]?.kill();
 const tl=gsap.timeline({paused:true}),items=[...root.querySelectorAll(".vc-item")];
 tl.set(root.querySelectorAll("*"),{clearProps:"transform,opacity,clipPath"},0);
 tl.set(root.querySelectorAll("*"),{x:0,y:0,xPercent:0,yPercent:0,scale:1,rotation:0,rotationY:0,opacity:1,clipPath:"none"},0);
 tl.fromTo(root.querySelector(".vc-header"),{y:24,opacity:0},{y:0,opacity:1,duration:.65,ease:"power2.out"},0);
 tl.set(items,{opacity:.18},0);
 const steps=events.filter(event=>event.id!=="resolve");
 steps.forEach((event,index)=>{
   const at=cues[event.id]??event.time,target=root.querySelectorAll(event.target);
   ${content.mode === "focus" ? 'if(index>0)tl.to(root.querySelectorAll(steps[index-1].target),{opacity:.45,scale:1,duration:.2},at);tl.fromTo(target,{opacity:.18,scale:1},{opacity:1,scale:1.02,duration:event.duration,ease:"power2.out"},at);' : content.mode === "compare" ? 'tl.fromTo(target,{x:index%2?28:-28,opacity:.18},{x:0,opacity:1,duration:event.duration,ease:"power2.out"},at);' : content.mode === "type" ? 'tl.fromTo(target,{clipPath:"inset(0 0 100% 0)",opacity:.18},{clipPath:"inset(0 0 0% 0)",opacity:1,duration:event.duration,ease:"power3.out"},at);' : 'tl.fromTo(target,{clipPath:"inset(0 100% 0 0)",opacity:.18},{clipPath:"inset(0 0% 0 0)",opacity:1,duration:event.duration,ease:"power2.out"},at);'}
 });
 const resolve=events.find(event=>event.id==="resolve");
 tl.to(items,{opacity:1,scale:1.012,duration:resolve.duration,ease:"power2.inOut"},cues.resolve??resolve.time);
 tl.to({}, {duration:Math.max(${definition.duration},...events.map(event=>(cues[event.id]??event.time)+event.duration))},0);
 window.__timelines[id]=tl;tl.seek(0);
})();</script>`;
}

export async function auditNativeRecipeCoverage() {
  const entries = [];
  for (const entry of await readdir(blocksRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const raw: unknown = JSON.parse(await readFile(join(blocksRoot, entry.name, "registry-item.json"), "utf8"));
    if (!raw || typeof raw !== "object" || !("visualComponent" in raw) || "upstream" in raw) continue;
    const definition = VISUAL_COMPONENT_EXPANSION.find(value => value.name === entry.name);
    const ready = "motionRecipe" in raw;
    const reason = ready ? "Executable semantic contract; rendering acceptance is verified separately."
      : definition?.category === "data" ? "Needs real numeric binding and quantitative geometry; decorative bars are not data recipes."
      : definition?.category === "diagrams" ? "Needs measured nodes, connectors and state/path progression, not a card reveal."
      : definition?.category === "media" ? "Needs validated real assets, crops and camera/clip windows, not placeholder cards."
      : "Needs component-specific semantic events, validated input capacity and Chinese render acceptance; not counted as a recipe.";
    entries.push({ name: entry.name, status: ready ? "recipe" : "component-only", reason });
  }
  return { nativeComponents: entries.length, nativeRecipes: entries.filter(entry => entry.status === "recipe").length, componentOnly: entries.filter(entry => entry.status === "component-only").length, entries };
}

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
  const content = NATIVE_RECIPE_CONTENT[definition.name];
  if (content && !["build", "focus", "compare", "type"].includes(content.mode)) return renderMeasuredHtml(definition);
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
  if (nativeRecipe(definition)) declarations.push({ id: "motionCueTimes", label: "Semantic cue times", type: "string", default: "{}", maxLength: 2048 });
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
${nativeRecipe(definition) ? '      .vc-title{line-height:1.4;font-size:60px}.vc-note{font-size:24px;line-height:1.4}.vc-label{font-size:30px!important;line-height:1.4}.vc-meta{font-size:23px!important;line-height:1.4!important}[data-layout="stack"] .vc-item{flex:1;min-height:0;padding:12px 32px}[data-layout="stack"] .vc-index{margin-bottom:6px}[data-layout="stack"] .vc-meta{margin-top:6px}[data-layout="social"] .vc-item{padding:12px 32px}[data-layout="social"] .vc-index{margin-bottom:6px}[data-layout="social"] .vc-meta{margin-top:6px}.vc-bar{display:none}[data-layout="stack"] .vc-meta{position:static;text-align:left;max-width:none}[data-layout="profile"] .vc-item:first-child .vc-label{font-size:42px!important}[data-layout="editorial"] .vc-item{padding:24px}[data-layout="editorial"] .vc-label{font-size:32px!important}\n' : ''}    </style>
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
${nativeRecipe(definition) ? `    ${renderNativeMotion(definition)}\n` : ""}  </body>
</html>
`;
}

/** Quantitative geometry and serial connectors are distinct from text-card animation. */
function renderMeasuredHtml(definition: ComponentDefinition): string {
  const content = NATIVE_RECIPE_CONTENT[definition.name];
  const recipe = nativeRecipe(definition);
  if (!content || !recipe) throw new Error(`Missing executable contract: ${definition.name}`);
  const defaults = { title: content.title, items: content.items, note: content.note, highlight: 1, motionCueTimes: "{}" };
  const declarations = [...variableDeclarations.map(variable => ({ ...variable, default: defaults[variable.id === "title" ? "title" : variable.id === "items" ? "items" : variable.id === "note" ? "note" : "highlight"] })), { id: "motionCueTimes", label: "Semantic cue times", type: "string", default: "{}", maxLength: 2048 }];
  return `<!doctype html><html lang="zh" data-composition-variables='${JSON.stringify(declarations).replaceAll("&", "&amp;").replaceAll("'", "&#39;")}'><head>
<meta charset="UTF-8"><meta name="viewport" content="width=1920,height=1080"><title>${definition.title}</title>
<style>
*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden}
.vc-root{width:1920px;height:1080px;padding:86px 112px;background:var(--ipw-color-bg,#f4f6f8);color:var(--ipw-color-text,#172126);font-family:var(--ipw-font-body,Inter,sans-serif);--primary:var(--ipw-color-primary,#20bbc0);--border:var(--ipw-color-border,#d7dde1);--surface:var(--ipw-color-surface,#fff)}
h1{font-size:60px;line-height:1.4;margin:0}.vc-note{font-size:24px;line-height:1.4;color:var(--ipw-color-muted,#647078);margin:14px 0 0}.vc-axis{font-size:24px;line-height:1.4;margin:22px 0;color:var(--ipw-color-muted,#647078)}
.vc-items{display:flex;flex-direction:column;gap:24px;height:580px}.vc-item{position:relative;display:grid;grid-template-columns:340px 1fr 240px;align-items:center;gap:24px;flex:1;min-height:0}.vc-label,.vc-meta{font-size:30px;line-height:1.4;overflow-wrap:anywhere}.vc-meta{text-align:right;font-variant-numeric:tabular-nums}
.vc-track{height:48px;background:var(--border);position:relative;border-left:2px solid currentColor}.vc-fill{height:100%;background:var(--primary);transform-origin:left center}.vc-item.is-active .vc-fill{background:var(--ipw-color-accent,#ef6846)}
[data-mode="funnel"] .vc-fill{margin:auto}[data-mode="funnel"] .vc-track{border-left:0;background:transparent}
.vc-cells{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.vc-cell{height:90px;display:flex;align-items:center;justify-content:center;font-size:30px;line-height:1.4;background:color-mix(in srgb,var(--primary) var(--value),var(--surface));border:1px solid var(--border)}
.vc-chart{width:100%;height:100px;overflow:visible}.vc-line{fill:none;stroke:var(--primary);stroke-width:5}.vc-baseline{stroke:var(--border);stroke-width:2}.vc-point{fill:var(--primary)}
[data-mode="flow"] .vc-items,[data-mode="cycle"] .vc-items{position:relative;flex-direction:row;align-items:center;gap:60px;height:500px}
[data-mode="flow"] .vc-item,[data-mode="cycle"] .vc-item{display:flex;flex-direction:column;align-items:stretch;justify-content:center;gap:16px;flex:1;height:300px;border:2px solid var(--border);border-radius:16px;padding:24px;background:var(--surface)}
[data-mode="flow"] .vc-meta,[data-mode="cycle"] .vc-meta{text-align:left;font-size:26px}
.vc-link{position:absolute;left:-62px;top:50%;width:60px;height:3px;background:var(--primary);transform-origin:left}.vc-link:after{content:"";position:absolute;right:0;top:-7px;border-left:12px solid var(--primary);border-top:8px solid transparent;border-bottom:8px solid transparent}
.vc-return{position:absolute;left:0;top:0;pointer-events:none;display:block;width:100%;height:500px;overflow:visible}.vc-return path{fill:none;stroke:var(--primary);stroke-width:4}.vc-return text{font-size:24px;fill:currentColor}
${definition.name === "process-handoff-map" ? '.vc-carrier{position:absolute;left:0;top:0;width:280px;padding:8px 12px;border:2px solid var(--primary);border-radius:8px;background:var(--surface);color:inherit;font-size:18px;line-height:1.4;overflow-wrap:anywhere;pointer-events:none;z-index:2}\n' : ''}\
</style></head><body>
<main id="${definition.name}" class="vc-root" data-composition-id="${definition.name}" data-width="1920" data-height="1080" data-duration="${definition.duration}" data-mode="${content.mode}"><header class="vc-header"><h1></h1><p class="vc-note"></p></header><p class="vc-axis"></p><div class="vc-items"></div></main>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/gsap.min.js"></script>
<script data-ipw-motion-recipe="1">
(function(){
 const root=document.getElementById(${JSON.stringify(definition.name)}),id=root.dataset.compositionId,values={...${JSON.stringify(defaults)},...(window.__hyperframes?.getVariables?.()??window.__hfVariablesByComp?.[id]??{})};
 const recipe=${JSON.stringify(recipe)};
 const cues=JSON.parse(String(values.motionCueTimes??"{}"));
 const mode=${JSON.stringify(content.mode)},rows=String(values.items).split("|").map(item=>{const [label,detail]=item.split("::");return{label,detail,numbers:detail.split(",").map(Number)}});
 const connected=mode==="flow"||mode==="cycle",maximum=Math.max(...rows.flatMap(row=>row.numbers)),scale=mode==="gauge"||mode==="matrix"?100:mode==="funnel"?rows[0].numbers[0]:maximum;
 root.querySelector("h1").textContent=values.title;root.querySelector(".vc-note").textContent=values.note;
 root.querySelector(".vc-axis").textContent=connected?"箭头表示关系与阅读顺序":mode==="matrix"?"各列从左至右：第1期 / 第2期 / 第3期 · 固定0–100%色阶":mode==="series"?"第1期 → 第2期 → 第3期 · 共享零基线与最大值 "+scale:"0 → "+scale+(mode==="gauge"?" · 固定满分/目标":" · 共享基准");
 root.dataset.scale=String(scale);
 const container=root.querySelector(".vc-items");
 function element(tag,className,text){const node=document.createElement(tag);node.className=className;if(text!==undefined)node.textContent=text;return node}
 function svgElement(tag,attributes){const node=document.createElementNS("http://www.w3.org/2000/svg",tag);Object.entries(attributes).forEach(([key,value])=>node.setAttribute(key,String(value)));return node}
 rows.forEach((row,index)=>{
   const item=element("article","vc-item"+(index+1===Number(values.highlight)?" is-active":"")),label=element("strong","vc-label",row.label);item.append(label);
   if(connected){item.append(element("span","vc-meta",row.detail));if(index>0)item.append(element("i","vc-link"));}
   else if(mode==="matrix"){
     const cells=element("div","vc-cells");row.numbers.forEach(value=>{const cell=element("span","vc-cell",value+"%");cell.style.setProperty("--value",value+"%");cells.append(cell)});item.append(cells,element("span","vc-meta","三期留存"));
   }else if(mode==="series"){
     const chart=svgElement("svg",{class:"vc-chart",viewBox:"0 0 900 100",preserveAspectRatio:"none"});chart.append(svgElement("path",{class:"vc-baseline",d:"M0 100H900"}));
     const points=row.numbers.map((value,i)=>[i*450,100-(scale===0?0:value/scale)*90]);const path=svgElement("path",{class:"vc-line",d:points.map(([x,y],i)=>(i?"L":"M")+x+" "+y).join(" ")});chart.append(path);points.forEach(([cx,cy])=>chart.append(svgElement("circle",{class:"vc-point",cx,cy,r:5})));item.append(chart,element("span","vc-meta",row.numbers.join(" → ")));
   }else{
     const track=element("div","vc-track"),fill=element("div","vc-fill");fill.style.width=(scale===0?0:row.numbers[0]/scale*100)+"%";fill.dataset.value=String(row.numbers[0]);track.append(fill);item.append(track,element("span","vc-meta",row.detail+(mode==="gauge"?" / 100":"")));
   }container.append(item);
 });
 if(mode==="cycle"){
   const back=svgElement("svg",{class:"vc-return",viewBox:"0 0 1696 500"});const width=(1696-(rows.length-1)*60)/rows.length,left=width/2,right=1696-width/2;
   back.append(svgElement("path",{class:"vc-back",d:"M"+right+" 400V462H"+left+"V400l-8 14m8-14 8 14"}));const text=svgElement("text",{x:848,y:494,"text-anchor":"middle"});text.textContent="结果返回下一轮观察";back.append(text);container.append(back);
 }
 window.__timelines=window.__timelines||{};window.__timelines[id]?.kill();const tl=gsap.timeline({paused:true}),items=[...root.querySelectorAll(".vc-item")];
 tl.set(root.querySelectorAll("*"),{x:0,y:0,scale:1},0);tl.fromTo(root.querySelector(".vc-header"),{y:24,opacity:0},{y:0,opacity:1,duration:.65,ease:"power2.out"},0);tl.set(items,{opacity:.18},0);
 const events=recipe.events.filter(event=>root.querySelector(event.target${definition.name === "process-handoff-map" ? '.split(",")[0]' : ''}));
${definition.name === "process-handoff-map" ? ` const carrier=element("div","vc-carrier");container.append(carrier);
 tl.set(root.querySelectorAll(".vc-link"),{scaleX:0},0);
 const points=items.map(item=>({x:item.offsetLeft+24,y:item.offsetTop-76}));
 tl.set(carrier,{...points[0],opacity:0,textContent:rows[0].detail},0);
` : ''}\
 events.filter(event=>event.id!=="resolve").forEach(event=>{
   const target=root.querySelector(event.target),at=cues[event.id]??event.time;tl.to(target,{opacity:.85,duration:event.duration,ease:"power2.out"},at);
   const fill=target.querySelector(".vc-fill"),link=target.querySelector(".vc-link"),path=target.querySelector(".vc-line");
   if(fill||link)tl.${definition.name === "process-handoff-map" ? 'to(fill||link,' : 'fromTo(fill||link,{scaleX:0},'}{scaleX:1,duration:event.duration,ease:"power2.out"},at);
   if(path){const length=path.getTotalLength();tl.set(path,{strokeDasharray:length,strokeDashoffset:length},0);tl.to(path,{strokeDashoffset:0,duration:event.duration,ease:"power2.out"},at);}
   if(mode==="matrix")tl.fromTo(target.querySelectorAll(".vc-cell"),{scaleY:0},{scaleY:1,transformOrigin:"bottom",duration:event.duration,ease:"power2.out"},at);
${definition.name === "process-handoff-map" ? `   const index=items.indexOf(target);
   if(index===0)tl.to(carrier,{opacity:1,duration:event.duration,ease:"power2.out"},at);
   else {tl.fromTo(carrier,points[index-1],{...points[index],duration:event.duration,ease:"power2.inOut",immediateRender:false},at);tl.set(carrier,{textContent:rows[index].detail},at+event.duration);}
` : ''}\
 });
 const resolve=events.find(event=>event.id==="resolve");tl.to(items,{opacity:1,duration:resolve.duration,ease:"power2.inOut"},cues.resolve??resolve.time);
 const back=root.querySelector(".vc-back");if(back){const length=back.getTotalLength();tl.set(back,{strokeDasharray:length,strokeDashoffset:length},0);tl.to(back,{strokeDashoffset:0,duration:resolve.duration,ease:"power2.out"},cues.resolve??resolve.time);}
 tl.to({}, {duration:Math.max(${definition.duration},...events.map(event=>(cues[event.id]??event.time)+event.duration))},0);window.__timelines[id]=tl;tl.seek(0);
})();</script></body></html>`;
}

function renderManifest(definition: ComponentDefinition): string {
  const content = NATIVE_RECIPE_CONTENT[definition.name];
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
      ...(definition.name === "agenda-opener" ? {
        data: {
          version: 1, kind: "category-value", mode: "replace", rowId: "label",
          binding: { variable: "items", encoding: "label-detail-list" },
          columns: [
            { id: "label", label: "Label", labelZh: "编号", type: "string", role: "label", required: true },
            { id: "detail", label: "Detail", labelZh: "内容", type: "string", role: "value", required: true },
          ],
          minRows: 1, maxRows: 4, highlightVariable: "highlight",
        },
      } : {}),
      ai: {
        slots: parameters,
        instructions: NATIVE_RECIPE_FIT[definition.name]?.useWhen ?? `AI may rewrite the title, supporting note, and up to four ${definition.subject}. Keep pipe separators between items and preserve the ${definition.layout} layout.`,
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
      ...(Object.hasOwn(NATIVE_RECIPE_CONTENT, definition.name) ? [{ path: "recipe.md", target: `compositions/${definition.name}.recipe.md`, type: "hyperframes:asset" }] : []),
    ],
    variables: [
      {
        id: "title",
        label: "Title",
        type: "string",
        default: content?.title ?? definition.title,
        maxLength: 76,
        update: "live",
      },
      {
        id: "items",
        label: "Items (label::detail | ...)",
        type: "string",
        default: content?.items ?? definition.items,
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
        default: content?.note ?? definition.note,
        maxLength: 100,
        update: "live",
      },
    ],
  };
  const recipe = nativeRecipe(definition);
  return `${JSON.stringify(recipe ? { ...item, motionRecipe: recipe, variables: [...item.variables, { id: "motionCueTimes", label: "Semantic cue times", type: "string", default: "{}", maxLength: 2048, update: "reload" }] } : item, null, 2)}\n`;
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
  const desired = new Map(
    VISUAL_COMPONENT_EXPANSION.filter((definition) => definition.wave <= limitWave)
      .map((definition) => [definition.name, { name: definition.name, type: "hyperframes:block" }]),
  );
  for (const item of await visualComponentEntries()) desired.set(item.name, item);
  const missing = [...desired.values()].filter((item) => !names.has(item.name));
  if (missing.length === 0) return true;
  if (!write) return false;
  registry.items.push(...missing);
  await writeFile(registryIndexPath, `${JSON.stringify(registry, null, 2)}\n`);
  return true;
}

async function visualComponentEntries(): Promise<Array<{ name: string; type: string }>> {
  const entries: Array<{ name: string; type: string }> = [];
  for (const entry of await readdir(blocksRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const manifest: unknown = JSON.parse(
        await readFile(join(blocksRoot, entry.name, "registry-item.json"), "utf8"),
      );
      if (manifest && typeof manifest === "object" && "visualComponent" in manifest &&
        "name" in manifest && typeof manifest.name === "string" &&
        "type" in manifest && typeof manifest.type === "string") {
        entries.push({ name: manifest.name, type: manifest.type });
      }
    } catch {
      // Registry validation reports malformed or missing manifests separately.
    }
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

function assertManifest(): void {
  if (VISUAL_COMPONENT_EXPANSION.length !== 63) {
    throw new Error(`Expected 63 owned components, found ${VISUAL_COMPONENT_EXPANSION.length}`);
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
    const name = path.split("/").at(-2);
    if (!Object.hasOwn(NATIVE_RECIPE_CONTENT, name ?? "")) {
      const manifest = JSON.parse(await readFile(join(dirname(path), "registry-item.json"), "utf8"));
      if (manifest.motionRecipe) continue; // Preserve hand-authored recipes and their repaired layouts.
    }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
  await updateRegistryIndex(true, limitWave);
  await recipeCards(true);
  console.log(`Generated visual component waves 1-${limitWave}.`);
}


const recipeCardManifestSchema = hyperframesCatalogItemSchema.pick({
  name: true, title: true, description: true, duration: true, variables: true,
  engine: true, dimensions: true, source: true, preview: true,
}).extend({ motionRecipe: hyperframesMotionRecipeSchema }).strip();

function cardSourceField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const field = Object.entries<unknown>(value).find(([name]) => name === key)?.[1];
  return typeof field === "string" ? field : undefined;
}

function renderRecipeCard(raw: unknown): string {
  const manifest = recipeCardManifestSchema.parse(raw), recipe = manifest.motionRecipe, usage = recipe.usage;
  const list = (values: string[]) => values.map(value => "- " + value).join("\n");
  const upstream = raw && typeof raw === "object" && "upstream" in raw ? raw.upstream : undefined;
  const lines = [
    "<!-- Generated by visual-component-catalog.ts recipe-cards-generate. Edit the owning manifest/generator, not this file. -->",
    "# " + manifest.title, "", "Component ID: " + manifest.name, "",
    "## Narrative intent", "", usage.intent, "",
    "Select this recipe only when the current story event needs that audience outcome; the animation alone is not evidence that the outcome was delivered.", "",
    "## Purpose and selection", "", list(usage.useWhen), "", "Do not use:", "", list(usage.avoidWhen), "",
    "## Supported inputs", "",
    ...Object.entries(usage.inputRules).map(([key, rule]) => "- " + key + ": " + rule), "",
    ...(recipe.capacity ? ["Capacity contract:", "", "~~~json", JSON.stringify(recipe.capacity, null, 2), "~~~", ""] : []),
    ...(recipe.textLimits ? ["Text limits:", "", "~~~json", JSON.stringify(recipe.textLimits, null, 2), "~~~", ""] : []),
    "Editable variable contract (demo defaults are not user content; apply both variable limits and the stricter recipe text/capacity limits above):", "", "~~~json", JSON.stringify(manifest.variables, null, 2), "~~~", "",
    "## Reading order and motion", "", list(usage.readingOrder), "",
    "Pattern: " + recipe.pattern + ". Native default duration: " + manifest.duration + "s. Minimum final readable hold: " + recipe.minHoldSeconds + "s.", "",
    ...recipe.events.flatMap(event => ["### " + event.id, "", "- Target: " + event.target, "- Visible action: " + event.action,
      "- Authored start: " + event.time + "s; action duration: " + event.duration + "s.", "- Narration cue: " + usage.cueBindings[event.id], ""]),
    "These are authored event defaults, not measured speech alignment. Rebind active events to actual narration at project FPS; omitted capacity items must not acquire phantom cues. Preserve source easing, internal timing ratios and landing geometry. Source implementation is authoritative for curves not declared in the manifest; this card does not invent calibrated parameter ranges.", "",
    "## Sequence and adjacent handoff", "",
    "Choose the sequence by the audience task using the Video Studio Sequence templates, then verify this card's use/avoid rules for its assigned slot. Sequence membership is not proof of fit or a new rendering capability.", "",
    "- Entry reading state: " + usage.readingOrder[0],
    "- Landing reading state: " + usage.readingOrder.at(-1),
    "- Handoff: identify the outgoing result and next subject in the existing storyboard narrative. Preserve only labels, comparison anchors or direction actually supported by the paired recipes. Use a direct cut when the semantic connection is enough; unsupported object morphs/camera paths require a different pairing or a disclosed gap.",
    "- Budget: reserve readable Land time first; an incoming transition lives inside the next shot's Establish window. Do not duplicate narration or reset a developed object merely to replay an entrance.", "",
    "## Known failure modes and recovery", "",
    ...Object.entries(usage.fallback).map(([key, rule]) => "- " + key + ": " + rule), "",
    "Under recipes-only policy, missing capability means another validated recipe, a meaningful split or an explicit gap; not custom graphics disguised as reuse.", "",
    "## Example", "", "~~~json", JSON.stringify(usage.example.values, null, 2), "~~~", "", "Narration: " + usage.example.narration, "",
    "Example media, identities and quotations are demonstration inputs, not factual evidence or supplied assets.", "",
    "## Acceptance and verification status", "", list(usage.acceptance), "",
    "Executable recipe contract exists. Card generation verifies documentation consistency only; it does not certify this shot's factual content, ordinary-speed rhythm, audible synchronization or exported pixels. Run the existing frame/playback/audio acceptance on real project inputs and report observed evidence separately.", "",
    "## Implementation, references and preview", "",
    "- Local implementation: [" + manifest.name + ".html](" + manifest.name + ".html)",
    "- Rule source: registry-item.json in the owning registry directory; this card is its generated view, not an independent rule source.",
  ];
  if (manifest.source?.url) lines.push("- Source: " + manifest.source.url);
  for (const key of ["repository", "revision", "implementation", "rules", "adaptation", "referenceGallery"]) {
    const field = cardSourceField(upstream, key);
    if (field) lines.push("- Upstream " + key + ": " + field);
  }
  if (upstream) {
    lines.push("- Registry-only vendored reference: upstream-card.md (not copied into the project).");
    const repository = cardSourceField(upstream, "repository"), revision = cardSourceField(upstream, "revision");
    if (repository && revision) lines.push("- License: " + repository + "/blob/" + revision + "/LICENSE");
  }
  const preview = manifest.preview?.video;
  lines.push(preview ? "- Registered preview: " + preview : "- No local video preview registered in this manifest. For imports, resolve the exact variant preview through media/video_recipe_catalog; do not claim an audition or pixel parity from an available URL.");
  return lines.join("\n") + "\n";
}

async function recipeCards(write: boolean): Promise<void> {
  if (Object.keys(RECIPE_INTENTS).length !== 81) throw Error("Every executable recipe needs an authored narrative intent.");
  let count = 0;
  for (const entry of await readdir(blocksRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = join(blocksRoot, entry.name), path = join(directory, "registry-item.json");
    const raw: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!raw || typeof raw !== "object" || !("motionRecipe" in raw)) continue;
    const recipe = raw.motionRecipe;
    if (!recipe || typeof recipe !== "object" || !("usage" in recipe) || !recipe.usage || typeof recipe.usage !== "object") throw Error("Invalid recipe usage " + entry.name);
    const intent = RECIPE_INTENTS[entry.name];
    if (!intent) throw Error("Missing narrative intent " + entry.name);
    if (write) Object.assign(recipe.usage, { intent });
    else if (!("intent" in recipe.usage) || recipe.usage.intent !== intent) throw Error("Narrative intent stale: " + entry.name);
    const manifest = recipeCardManifestSchema.parse(raw);
    if (manifest.name !== entry.name || !("files" in raw) || !Array.isArray(raw.files)) throw Error("Invalid recipe card owner " + entry.name);
    const file = { path: "recipe.md", target: "compositions/" + entry.name + ".recipe.md", type: "hyperframes:asset" };
    const existing = raw.files.filter(item => item && typeof item === "object" && "path" in item && item.path === file.path);
    if (write) {
      raw.files = [...raw.files.filter(item => !existing.includes(item)), file];
      await writeFile(path, JSON.stringify(raw, null, 2) + "\n");
    } else if (existing.length !== 1 || JSON.stringify(existing[0]) !== JSON.stringify(file)) {
      throw Error("Recipe documentation entry missing or stale: " + entry.name);
    }
    const expected = renderRecipeCard(raw), destination = join(directory, "recipe.md");
    if (write) await writeFile(destination, expected);
    else if (await readFile(destination, "utf8") !== expected) throw Error("Recipe documentation stale: " + entry.name);
    count++;
  }
  if (count !== 81) throw Error("Expected 81 executable recipe cards, found " + count);
  console.log((write ? "Generated" : "Checked") + " " + count + " recipe cards from their owning manifests.");
}

async function check(): Promise<void> {
  await recipeCards(false);
  assertManifest();
  const mismatches: string[] = [];
  for (const [path, expected] of generatedFiles()) {
    try {
      const name = path.split("/").at(-2);
      const manifest = JSON.parse(await readFile(join(dirname(path), "registry-item.json"), "utf8"));
      if (manifest.motionRecipe && !Object.hasOwn(NATIVE_RECIPE_CONTENT, name ?? "")) continue;
      if ((await readFile(path, "utf8")) !== expected) mismatches.push(path);
    } catch {
      mismatches.push(path);
    }
  }
  if (!(await updateRegistryIndex(false))) mismatches.push(registryIndexPath);
  const total = (await visualComponentEntries()).length;
  if (total !== 185) mismatches.push(`visual-component-count:${total}`);
  if (mismatches.length > 0) {
    throw new Error(`Visual component catalog is stale:\n${mismatches.join("\n")}`);
  }
  console.log("Visual component catalog is current: 149 native components, 30 Shotcraft imports and 6 reusable personal components.");
}

// Refresh metadata only for reviewed local ports; never restore the unported reference archive.
async function importShotcraftReferences(): Promise<void> {
  const repository = "Vincentwei1021/video-shotcraft";
  const revision = "5ddbf521038b0a7accfb6dc1e0a9eb29c67277ab";
  const fork = "louiseliu/hyperFrames-video-shotcraft";
  const forkRevision = "1df77f1ab080323558f70a5fb880fad0f88f87fc";
  const raw = async (repo: string, ref: string, path: string): Promise<string> => {
    const response = await fetch(`https://raw.githubusercontent.com/${repo}/${ref}/${path}`);
    if (!response.ok) throw new Error(`${path}: ${response.status}`);
    return response.text();
  };
  const tree: { tree: { path: string }[] } = JSON.parse(await (await fetch(`https://api.github.com/repos/${repository}/git/trees/${revision}?recursive=1`)).text());
  const forkTree: { tree: { path: string }[] } = JSON.parse(await (await fetch(`https://api.github.com/repos/${fork}/git/trees/${forkRevision}?recursive=1`)).text());
  type Style = { key: string; label: string; description: string; use?: string; media?: { url: string }; implementationStatus?: string };
  type Card = { name: string; summary: string; use: string; duration: string; energy: string; intention: string; source: string; category: string; tags: string[]; styles: Style[] };
  const library: { cards: Card[]; stats: { cardCount: number; styleCount: number } } = JSON.parse(await raw(repository, revision, "gallery/api/library.json"));
  if (library.cards.length !== 157 || library.cards.reduce((sum, card) => sum + card.styles.length, 0) !== 214) throw new Error("Pinned Shotcraft inventory changed");
  const catalogPath = resolve(dirname(registryIndexPath), "shotcraft-references.json");
  const installedCatalog: { cards: { name: string; styles: { key: string }[] }[] } = JSON.parse(await readFile(catalogPath, "utf8"));
  const allowed = new Map(installedCatalog.cards.map(card => [card.name, new Set(card.styles.map(style => style.key))]));
  const installedCards = library.cards.filter(card => allowed.has(card.name)).map(card => ({
    ...card, styles: card.styles.filter(style => allowed.get(card.name)?.has(style.key)),
  }));
  const demoSources = tree.tree.filter(file => /^(?:demos|assets\/lib|template\/src)\/.*\.tsx$/.test(file.path)).map(file => file.path);
  const forkPaths = new Set(forkTree.tree.map(file => file.path));
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  // Aliases reviewed against each card's reference-implementation section; not fuzzy matches.
  const sourceAliases: Record<string, string> = {
    "panel-to-canvas": "PanelToCanvasMaterialize", "diagram-cascade": "DiagramCascadeBuild",
    "oscilloscope-stream": "OscilloscopeStreamV2", "unit-dot-swarm-regroup": "UnitDotSwarmRegroupV2", "axis-rescale-shock": "AxisRescaleShockV2",
    "dialogue-duet": "CursorDialogueDuet", "cast-ensemble": "CursorCastEnsemble",
    "multiplane": "MultiplaneReal", "dolly-zoom": "DollyZoomReal", "cursor-performance": "CursorPerformancePunchIn",
    "spotlight-sweep": "SpotlightSweepReveal", "sheen-sweep": "SheenSweepRetry",
    "misregistration-hit": "RisoMisregistrationHit", "beat-pump": "RisoBeatPump",
    "flash-cut": "FlashCut", "shot-transitions-4": "DarkTunnelTransition", "shot-transitions-5": "FocusHandoffTransition",
    "shot-transitions-6": "BlackCardTransition", "whip-pan": "WhipPanReal", "mask-wipe": "MaskWipeReal",
    "speed-ramp": "SpeedRampReal", "freeze-annotate": "FreezeAnnotateReal", "drift-assembly": "LetterformDriftAssembly",
    "tracking-expand": "TrackingExpandReveal", "error-retype": "TypewriterErrorRetype",
    "icon-flip-bloom": "IconFlipBloomLogo", "input-morph-assemble": "InputMorphsIntoLogo",
  };
  const sources = new Map<string, string>();
  const converted = new Map<string, string>();
  const cards = [];
  // A small worker batch bounds GitHub traffic; generated output remains deterministic.
  for (let offset = 0; offset < installedCards.length; offset += 8) {
    cards.push(...await Promise.all(installedCards.slice(offset, offset + 8).map(async card => {
      const rules = await raw(repository, revision, card.source);
      const references = [...rules.matchAll(/(?:demos|assets\/lib|template\/src)\/[A-Za-z0-9_./-]+/g)].map(match => match[0]);
      const candidates = demoSources.filter(path => references.some(reference => reference.endsWith(".tsx") ? path === reference : path.startsWith(reference.endsWith("/") ? reference : `${reference}/`)));
      const implementations = await Promise.all(candidates.map(async path => {
        let text = sources.get(path);
        if (text === undefined) { text = await raw(repository, revision, path); sources.set(path, text); }
        const dependencies = [...text.matchAll(/(?:from\s*|import\s*)["']([^"']+)["']/g)].map(match => match[1]);
        const htmlPath = path.replace(/\.tsx$/, "/index.html");
        const singlePath = `${path.slice(0, path.lastIndexOf("/"))}/index.html`;
        const pathInFork = forkPaths.has(htmlPath) ? htmlPath : candidates.length === 1 && forkPaths.has(singlePath) ? singlePath : null;
        let conversionStatus = "missing";
        if (pathInFork) {
          let html = converted.get(pathInFork);
          if (html === undefined) { html = await raw(fork, forkRevision, pathInFork); converted.set(pathInFork, html); }
          conversionStatus = html.includes("TODO: Port animation logic") ? "placeholder" : /\btl\.(?:to|from|fromTo|set|add|call)\s*\(/.test(html) ? "authored-unverified" : "no-timeline";
        }
        return { path, url: `https://github.com/${repository}/blob/${revision}/${path}`, dependencies,
          conversion: { status: conversionStatus, path: pathInFork, url: pathInFork ? `https://github.com/${fork}/blob/${forkRevision}/${pathInFork}` : null } };
      }));
      const styles = await Promise.all(card.styles.map(async style => {
        const matching = implementations.filter(item => normalize(item.path.split("/").at(-1)!.replace(/\.tsx$/, "")) === normalize(sourceAliases[style.key] ?? style.key));
        const demos = matching.filter(item => item.path.startsWith("demos/"));
        const implementation = matching.length === 1 ? matching[0] : demos.length === 1 ? demos[0] : card.styles.length === 1 && implementations.length === 1 ? implementations[0] : null;
        const previewUrl = style.media ? new URL(style.media.url, "https://vincentwei1021.github.io/video-shotcraft/").href : null;
        const previewStatus = previewUrl ? (await fetch(previewUrl, { method: "HEAD" })).status : null;
        return { key: style.key, label: style.label, description: style.description, use: style.use ?? card.use,
          upstreamStatus: style.implementationStatus ?? "preview-available",
          previewUrl, previewStatus, previewRevision: "live-gallery-not-pinned",
          implementationPath: implementation?.path ?? null,
          implementationPaths: implementation ? [implementation.path] : implementations.map(item => item.path),
          sourceResolution: implementation ? "resolved" : "read-card-to-resolve",
          conversion: implementation?.conversion ?? { status: "source-unresolved", path: null, url: null } };
      }));
      return { name: card.name, summary: card.summary, use: card.use, duration: card.duration, energy: card.energy,
        intention: card.intention, category: card.category, tags: card.tags, sourcePath: card.source,
        sourceUrl: `https://github.com/${repository}/blob/${revision}/${card.source}`, rules, implementations, styles };
    })));
  }
  const license = await raw(repository, revision, "LICENSE");
  const output = { schemaVersion: 1, repository: `https://github.com/${repository}`, revision,
    conversionRepository: `https://github.com/${fork}`, conversionRevision: forkRevision,
    license: "Apache-2.0", licenseFile: "shotcraft-reference-LICENSE.txt", stats: { cardCount: cards.length, styleCount: cards.reduce((sum, card) => sum + card.styles.length, 0) },
    methodology: { sourceUrl: `https://github.com/${repository}/blob/${revision}/references/pipeline.md`, rules: await raw(repository, revision, "references/pipeline.md") }, cards };
  await writeFile(catalogPath, JSON.stringify(output, null, 2) + "\n");
  await writeFile(resolve(dirname(registryIndexPath), "shotcraft-reference-LICENSE.txt"), license);
  console.log(`Refreshed ${output.stats.cardCount} installable Shotcraft cards and ${output.stats.styleCount} preview variants; unported entries remain excluded.`);
}

async function importShotcraftCameras(): Promise<void> {
  const revision = "5ddbf521038b0a7accfb6dc1e0a9eb29c67277ab";
  const repository = "https://github.com/Vincentwei1021/video-shotcraft";
  const raw = async (path: string) => {
    const response = await fetch("https://raw.githubusercontent.com/Vincentwei1021/video-shotcraft/" + revision + "/" + path);
    if (!response.ok) throw new Error(path + ": " + response.status);
    return response.text();
  };
  const rulesPath = "references/shots/camera/depth-layer-moves.md";
  const rules = await raw(rulesPath), license = await raw("LICENSE");
  const captureLayout = JSON.stringify({ width: 1920, height: 1080, pixelRatio: 1,
    regions: Array.from({ length: 6 }, (_, i) => ({ id: "region-" + i, x: 50 + i * 280, y: 300, width: 240, height: 240 })),
    heroId: "region-3", foregroundIds: ["region-0", "region-5"] });
  // Shared page-space construction, emitted into both self-contained registry compositions.
  const pageSpace = String.raw`
 const capture=JSON.parse(String(values.captureLayout));
 const source=new Image();source.src=String(values.mediaUrl);await source.decode();
 if(source.naturalWidth!==Math.round(capture.width*capture.pixelRatio)||source.naturalHeight!==Math.round(capture.height*capture.pixelRatio))throw Error('Screenshot dimensions differ from captureLayout');
 const layer=className=>{const element=document.createElement('div');element.className='sc-layer '+className;root.append(element);return element;};
 const page=(parent,width,top,opacity)=>{const image=source.cloneNode();Object.assign(image.style,{position:'absolute',left:'0px',top:Math.max(top,1080-capture.height*width/capture.width)+'px',width:width+'px',opacity:String(opacity)});parent.append(image);};
 const crop=(parent,region,width,x,y,className)=>{const scale=width/region.width,box=document.createElement('div');box.className='sc-crop '+className;box.dataset.captureRegion=region.id;Object.assign(box.style,{left:x+'px',top:y+'px',width:width+'px',height:region.height*scale+'px'});const image=source.cloneNode();Object.assign(image.style,{position:'absolute',width:capture.width*scale+'px',left:-region.x*scale+'px',top:-region.y*scale+'px'});box.append(image);parent.append(box);return box;};
 const region=id=>{const item=capture.regions.find(item=>item.id===id);if(!item)throw Error('Missing capture region '+id);return item;};
 const cubic=(x1,y1,x2,y2,t)=>{const coordinate=(a,b,p)=>3*(1-p)*(1-p)*p*a+3*(1-p)*p*p*b+p*p*p;let low=0,high=1;for(let i=0;i<24;i++){const p=(low+high)/2;if(coordinate(x1,x2,p)<t)low=p;else high=p;}return t<=0?0:t>=1?1:coordinate(y1,y2,(low+high)/2);};
 `;
  for (const spec of [
    { id: "shotcraft-multiplane", title: "真实页面多层视差", source: "MultiplaneReal", seconds: 115 / 30, key: "multiplane",
      use: "展示真实页面、图像或空间层次，沿同一方向探索真实内容。",
      avoid: "不用于必须固定对照的公式、代码或精确数值；前景不可遮挡主阅读对象。" },
    { id: "shotcraft-dolly-zoom", title: "主体固定背景变焦", source: "DollyZoomReal", seconds: 95 / 30, key: "dolly-zoom",
      use: "在真实素材上突出一个固定主体，背景膨胀形成一次戏剧性强调。",
      avoid: "不用于日常连续阅读或每幕重复；全片最多一次，不给主体增加运镜或模糊。" },
  ]) {
    const implementation = "demos/camera/depth-layer-moves/" + spec.source + ".tsx";
    const upstream = await raw(implementation);
    const variables = [
      { id: "title", label: "Short scene heading", type: "string", default: spec.title, maxLength: 12, update: "reload" },
      { id: "mediaUrl", label: "Real captured screenshot", type: "string", default: "assets/evidence.svg", maxLength: 2000, update: "reload" },
      { id: "captureLayout", label: "Measured CSS-page crop geometry", type: "string", default: captureLayout, maxLength: 4096, update: "reload" },
      { id: "motionCueTimes", label: "Measured semantic cues", type: "string", default: "{}", maxLength: 2048, update: "reload" },
    ];
    const recipe = { version: 1, pattern: "state-transformation", minHoldSeconds: .7,
      textLimits: { title: { maxLines: 1, maxLineLength: 12 } },
      events: [{ id: "camera", target: ".sc-layer", time: .65, duration: spec.seconds, action: spec.use }],
      usage: { intent: RECIPE_INTENTS[spec.id], useWhen: [spec.use], avoidWhen: [spec.avoid],
        inputRules: { title: "单行最多12字；不遮盖素材中的必要信息。", mediaUrl: "已有项目内真实页面截图；禁止用演示卡片或手绘假界面替代。",
          captureLayout: "JSON: width/height 是截图的 CSS 页面尺寸，pixelRatio 是像素倍率；regions 是6–8个实测 {id,x,y,width,height} 区域，heroId 与两个 foregroundIds 引用已有区域。图片像素尺寸必须一致。先核对裁切，过密或无适合主体时换配方，不猜坐标。" },
        readingOrder: ["建立真实页面和层次", spec.use, "保留主体和最终可读画面"],
        cueBindings: { camera: "绑定开始探索/强调主体的实测旁白短语；内部时值比例和各层运动关系不变。" },
        fallback: { overflow: "拆镜或选择合适配方，不缩小文字。", missingInput: "先取得真实截图和实测区域；素材不可用则报告缺口。",
          timingMismatch: "绑定实测短语并整体重排；过长旁白拆镜，不让相机漫无目的持续移动。", inapplicable: "换合适的已验证配方；仅配方模式下禁止自绘替代。" },
        example: { values: { title: spec.title, mediaUrl: "assets/evidence.svg", captureLayout }, narration: spec.use },
        acceptance: ["真实页面裁切与实测坐标一致，原图解码成功，高清主阅读层不模糊。",
          spec.key === "multiplane" ? "各层沿同一 drive 移动，系数保持0.35/0.7/1.4，中景无模糊。" : "主体屏幕矩形保持固定；背景从1放大到2.25，模糊从0增加到3.5。",
          "保持原曲线和动效关系，正反向拖动恢复同一画面；这不是像素完全相同的Remotion渲染。"] } };
    const motion = spec.key === "multiplane" ? String.raw`
 const background=layer('sc-background'),middle=layer('sc-middle'),foreground=layer('sc-foreground');
 background.style.cssText='opacity:.85;filter:blur(2px) saturate(.92)';foreground.style.filter='blur(3px)';page(background,2100,-300,1);
 capture.regions.slice(0,6).forEach((item,k)=>crop(middle,item,420,200+k*480,330+(k%2)*40,'sc-card'));
 crop(foreground,region(capture.foregroundIds[0]),700,900,150,'sc-front');crop(foreground,region(capture.foregroundIds[1]),380,2100,700,'sc-front');
 const apply=progress=>{const drive=progress*1000;background.style.transform='translateX('+(-drive*.35)+'px) scale(1.05)';middle.style.transform='translateX('+(-drive*.7)+'px)';foreground.style.transform='translateX('+(-drive*1.4)+'px)';root.dataset.ipwPageProgress=String(progress);};
 const ease=t=>cubic(.35,0,.25,1,t);
 ` : String.raw`
 const background=layer('sc-background');background.style.transformOrigin='960px 540px';page(background,1920,-400,.55);
 const xs=[180,1280,240,1220,700,760,60,1500],ys=[140,120,700,720,60,840,420,430];
 capture.regions.filter(item=>item.id!==capture.heroId).slice(0,8).forEach((item,k)=>{const card=crop(background,item,320,xs[k],ys[k],'sc-card');card.style.opacity='.9';});
 const subject=region(capture.heroId),hero=crop(root,subject,520,700,540-subject.height*520/subject.width/2,'sc-hero');
 const apply=progress=>{background.style.transform='scale('+(1+progress*1.25)+')';background.style.filter='blur('+(progress*3.5)+'px) saturate(.9)';hero.style.boxShadow='0 '+(12+progress*16)+'px '+(40+progress*28)+'px rgba(31,28,23,'+(.16+progress*.1)+')';root.dataset.ipwPageProgress=String(progress);};
 const ease=t=>cubic(.4,0,.3,1,t);
 `;
    const html = '<!doctype html>\n<html lang="zh" data-composition-variables=\'' + JSON.stringify(variables) + '\'><head><meta charset="utf-8"><title>' + spec.title + '</title><style>html,body{margin:0;width:1920px;height:1080px;overflow:hidden}*{box-sizing:border-box}.sc-root{position:relative;width:1920px;height:1080px;overflow:hidden;background:var(--ipw-color-bg,#efece6);color:var(--ipw-color-text,#191919);font-family:var(--ipw-font-display,-apple-system,"PingFang SC",sans-serif)}.sc-layer{position:absolute;inset:0}.sc-crop{position:absolute;overflow:hidden;border-radius:12px;box-shadow:0 8px 28px rgba(31,28,23,.14)}.sc-hero{border-radius:14px}.sc-front{border-radius:22px}.sc-context{position:absolute;left:120px;top:72px;z-index:5;margin:0;padding:12px 20px;font-size:48px;line-height:1.4;background:var(--ipw-color-bg,#efece6);border-radius:8px}</style></head>\n<body><main id="' + spec.id + '" class="sc-root" data-composition-id="' + spec.id + '" data-width="1920" data-height="1080" data-duration="5.2"><h1 class="sc-context" data-ipw-variable="title"></h1></main><script src="https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/gsap.min.js"></script>\n<!-- Derived from ' + repository + ' ' + revision + ' ' + implementation + '. Copyright 2026 WeiYihao. Apache-2.0. Modified: measured screenshot crops, content, narration cues, page extent clamp, theme and hold. See LICENSE. -->\n<script data-ipw-motion-recipe="1">\n(async function(){await document.fonts.ready;const root=document.getElementById(' + JSON.stringify(spec.id) + '),id=root.dataset.compositionId;const values={...' + JSON.stringify(recipe.usage.example.values) + ',...(window.__hyperframes?.getVariables?.()??{}),...(window.__hfVariablesByComp?.[id]??{})};const recipe=' + JSON.stringify(recipe) + ';\n const cues=JSON.parse(String(values.motionCueTimes??"{}"));\n root.querySelector("[data-ipw-variable=title]").textContent=String(values.title);\n' + pageSpace + motion + '\n const state={progress:0},event=recipe.events[0],tl=gsap.timeline({paused:true});apply(0);tl.fromTo(state,{progress:0},{progress:1,duration:event.duration,ease,onUpdate:()=>apply(state.progress)},cues.camera??event.time);tl.to({}, {duration:5.2},0);window.__timelines=window.__timelines||{};window.__timelines[id]=tl;tl.seek(0,false);})();\n</script></body></html>\n';
    const manifest = { $schema: "https://hyperframes.heygen.com/schema/registry-item.json", name: spec.id, version: "1.0.0", type: "hyperframes:block", title: spec.title, description: spec.use,
      tags: ["component", "shotcraft", "media", "camera", "theme"], author: "WeiYihao; iPolloWork integration", license: "Apache-2.0",
      upstream: { repository, revision, implementation, rules: rulesPath, license: "Apache-2.0", upstreamSha256: (await import("node:crypto")).createHash("sha256").update(upstream).digest("hex"),
        adaptation: "Preserves original bezier curves, layered motion coefficients and fixed-subject geometry. Adapted: real screenshot regions instead of hardcoded demo textures, page extent clamp, content variables, theme, measured phrase cues and final hold. Not pixel-identical Remotion rendering." },
      source: { provider: "video-shotcraft", label: "Video Shotcraft · Apache-2.0", url: repository + "/blob/" + revision + "/" + rulesPath },
      visualComponent: { version: 1, category: "media", surfaces: ["video"], themeMode: "inherit", ai: { slots: ["title", "mediaUrl", "captureLayout"], instructions: spec.use + " " + spec.avoid } },
      dimensions: { width: 1920, height: 1080 }, duration: 5.2, engine: { name: "gsap", version: "3.13.0", seekable: true },
      files: [{ path: spec.id + ".html", target: "compositions/" + spec.id + ".html", type: "hyperframes:composition" }, { path: "LICENSE", target: "compositions/licenses/video-shotcraft-LICENSE.txt", type: "hyperframes:asset" }], variables, motionRecipe: recipe };
    const directory = resolve(dirname(registryIndexPath), "blocks", spec.id);await mkdir(directory, { recursive: true });
    for (const [name, content] of [[spec.id + ".html", html], ["registry-item.json", JSON.stringify(manifest, null, 2) + "\n"], ["upstream.tsx", upstream], ["upstream-card.md", rules], ["LICENSE", license]]) await writeFile(join(directory, name), content);
  }
  const index = JSON.parse(await readFile(registryIndexPath, "utf8"));
  for (const name of ["shotcraft-multiplane", "shotcraft-dolly-zoom"]) if (!index.items.some((item: { name: string }) => item.name === name)) index.items.push({ name, type: "hyperframes:block" });
  await writeFile(registryIndexPath, JSON.stringify(index, null, 2) + "\n");
  console.log("Generated two source-preserving Shotcraft page-space recipes.");
}

const command = process.argv[2] ?? "check";
if (command === "shotcraft-camera-import") {
  await importShotcraftCameras();
} else if (command === "shotcraft-reference-import") {
  await importShotcraftReferences();
} else if (command === "recipes-audit") {
  console.log(JSON.stringify(await auditNativeRecipeCoverage(), null, 2));
} else if (command === "recipe-cards-generate") {
  await recipeCards(true);
} else if (command === "registry-index-generate") {
  await updateRegistryIndex(true);
  console.log("Updated the registry index from the owning visual component manifests.");
} else if (command === "recipes-generate") {
  for (const [path, content] of generatedFiles()) {
    if (!Object.hasOwn(NATIVE_RECIPE_CONTENT, path.split("/").at(-2) ?? "")) continue;
    await writeFile(path, content);
  }
  await recipeCards(true);
  console.log(JSON.stringify(await auditNativeRecipeCoverage(), null, 2));
} else if (command === "generate") {
  const limitWave = Math.max(1, Math.min(4, Number(process.argv[3] ?? 4) || 4));
  await generate(limitWave);
} else if (command === "check") {
  await check();
} else {
  throw new Error(`Unknown command: ${command}`);
}
