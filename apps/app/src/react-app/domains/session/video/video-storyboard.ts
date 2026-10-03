/** Executable-format example for the existing HyperFrames parser, not a second schema. */
const STORYBOARD_METADATA_EXAMPLE = `---
format: 1920x1080
message: Turn an idea into a working team
audience: Independent founders
theme: ai-auto
visual_style: Clear product UI, layered space, readable typography
music_prompt: Restrained instrumental pulse beneath narration
---

## Frame 1 — The idea takes shape
- scene: An idea card becomes a three-step plan; the focus moves to the first task.
- duration: 5s
- voiceover: One idea becomes the next clear step.
- voice_id: auto
- camera: fixed:progressive-build
- transition_in: cut
- asset_source: code
- asset_brief: Editable idea and task cards; no external visual required.
- sound_effects: A quiet click when the first task appears, if an actual effect is available.
- status: outline
`;

export const VIDEO_STORYBOARD_EXAMPLE = `${STORYBOARD_METADATA_EXAMPLE}
Coverage: C1 (brief: turn an idea into a next action) → Frame 1 narration and visible task cards. No source file supplied; this is an illustrative concept, not a factual case study.
Shot fit: The viewer follows one idea becoming actionable tasks. A fixed progressive build reveals their order and lands on the first task; a spatial fly-through would interrupt reading.
Rhythm: Orient with the idea, develop its three tasks, then resolve with a next action. Calm instructional pacing; no promotional climax required.
Beat binding: “One idea” → idea card; “becomes the next clear step” → reveal connected tasks and emphasize the first. Visual need: editable task cards; no footage search needed.
Continuity: Reuse the same idea card identity and palette through the transformation. Narration: natural phrase boundary after “idea”; keep this direction out of spoken text and do not claim an exact audio pause.
0–1s establish the idea; 1–4s reveal and connect tasks; 4–5s hold the first action.
`;

export const VIDEO_STORYBOARD_FORMAT_CONTRACT = [
  "STORYBOARD.md is the editable production source. Before media/assembly save leading --- frontmatter, then ## Frame N — Title with separate '- key: value' lines; never a Markdown pipe table, translated keys or a fenced saved file. Adapt this native example:",
  "```markdown",
  STORYBOARD_METADATA_EXAMPLE.trimEnd(),
  "```",
  "Re-read the saved script: every frame needs scene, positive duration and actual status. Apply its latest version and pinned choices; saving/reordering rows alone does not rebuild the video.",
].join("\n");

/** Only a project-owned canonical script should open the video editor. */
export function videoProjectIdFromStoryboardPath(path: string): string | null {
  const normalized = path.trim().replaceAll("\\", "/").replace(/^\.\//, "");
  const match = /^video\/([^/]+)\/STORYBOARD\.md$/i.exec(normalized);
  return match && match[1] !== "." && match[1] !== ".." ? match[1]! : null;
}
