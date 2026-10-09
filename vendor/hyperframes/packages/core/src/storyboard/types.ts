/**
 * Storyboard data model.
 *
 * A storyboard is the plan for a video before any animation work happens: an
 * ordered set of frames (key moments) plus their narrative/script. It is
 * authored as a single canonical markdown file (`STORYBOARD.md`) and parsed
 * into this normalized shape for agents.
 *
 * See PRD: "Storyboarding in HyperFrames". The markdown stays canonical; this
 * is the derived structure the parser produces.
 */

/** Canonical filename for the storyboard manifest at a project root. */
export const STORYBOARD_FILENAME = "STORYBOARD.md";

/**
 * Canonical filename for the companion narration script. Holds the full
 * voiceover script (voice settings, per-line delivery + timing). Optional —
 * frames can also carry an inline `voiceover` line in {@link STORYBOARD_FILENAME}.
 */
export const SCRIPT_FILENAME = "SCRIPT.md";

/**
 * Lifecycle of a single frame. The agent advances each frame
 * `outline → built → animated`; scripts and the agent read progress from this.
 */
export type FrameStatus = "outline" | "built" | "animated";

/** The set of recognized {@link FrameStatus} values. */
export const FRAME_STATUSES: readonly FrameStatus[] = [
  "outline",
  "built",
  "animated",
];

/** Default status when a frame omits one (it is still just an outline). */
export const DEFAULT_FRAME_STATUS: FrameStatus = "outline";

/** Global direction for the whole video, parsed from the frontmatter. */
export interface StoryboardGlobals {
  /** Canvas format as authored, e.g. `"1920x1080"`. */
  format?: string;
  /** One-line message / thesis of the video. */
  message?: string;
  /** Narrative arc, e.g. `"Problem → Solution"`. */
  arc?: string;
  /** Target audience, e.g. `"indie devs on X"`. */
  audience?: string;
  /** Creative theme for the complete video. */
  theme?: string;
  /** Shared visual language for every shot. */
  visualStyle?: string;
  /** One music-generation direction shared by the complete video. */
  musicPrompt?: string;
  /** Project-relative music asset selected from the shared video asset library. */
  musicAsset?: string;
  /** Optional name or reference to a video template. */
  template?: string;
  /** Whether the selected template's visual rules should be followed. */
  alignToTemplate?: boolean;
  /** Any frontmatter keys outside the known set, preserved verbatim. */
  extra: Record<string, string>;
}

/** A single frame: one key moment in the video. */
export interface StoryboardFrame {
  /** 1-based order within the storyboard, assigned by document order. */
  index: number;
  /** Frame number as authored (the `N` in `Frame N`), when present. */
  number?: number;
  /** Frame title (the text after the number), when present. */
  title?: string;
  /** Lifecycle status; defaults to {@link DEFAULT_FRAME_STATUS}. */
  status: FrameStatus;
  /** Project-relative path to the frame's HTML sub-composition, when linked. */
  src?: string;
  /** Duration in seconds, parsed from e.g. `"6s"`. Undefined when unparseable. */
  durationSeconds?: number;
  /** Raw duration string as authored, e.g. `"6s"`. */
  duration?: string;
  /** Transition into this frame, e.g. `"crossfade"`. */
  transitionIn?: string;
  /** One-line description of the key moment (the contact-sheet caption). */
  scene?: string;
  /** Voiceover / narration line spoken over this frame. */
  voiceover?: string;
  /** Character or voice identity for this frame's narration. */
  speaker?: string;
  /** Stable voice-library id for this frame; `auto` delegates selection to the agent. */
  voiceId?: string;
  /** Voice model needed for a per-frame override, especially for cloned voices. */
  voiceModel?: string;
  /** Human-readable voice-library label shown in the script table. */
  voiceName?: string;
  /** Camera framing and movement, expressed as an editable production instruction. */
  camera?: string;
  /** How visual material will be obtained: code, existing, generate, or search. */
  assetSource?: string;
  /** Requested visual medium; omitted when the agent may choose. */
  assetKind?: string;
  /** Source URL / attribution, or an explicit generated-illustration description. */
  assetOrigin?: string;
  /** Asset requirement / generation brief, not a generated asset itself. */
  assetBrief?: string;
  /** An existing project asset path or external reference URL. */
  assetReference?: string;
  /** Background music direction and event-bound sound effects. */
  music?: string;
  soundEffects?: string;
  /** Project-relative sound-effect asset selected from the shared video asset library. */
  soundEffectReference?: string;
  /**
   * Representative time (seconds) to show this frame at in the contact sheet —
   * a "poster" frame past the intro animation. Falls back to a heuristic.
   */
  poster?: number;
  /** Narrative / script markdown for this frame (everything below the metadata). */
  narrative: string;
  /** Metadata keys outside the known set, preserved verbatim. */
  extra: Record<string, string>;
}

/** A non-fatal issue encountered while parsing. The parser never throws. */
export interface StoryboardWarning {
  message: string;
  /** 1-based source line number, when known. */
  line?: number;
  /** 1-based frame index the warning relates to, when applicable. */
  frameIndex?: number;
}

/** Fully parsed storyboard manifest. */
export interface StoryboardManifest {
  globals: StoryboardGlobals;
  frames: StoryboardFrame[];
  /** Non-fatal parse issues (unknown status, unparseable duration, etc.). */
  warnings: StoryboardWarning[];
}
