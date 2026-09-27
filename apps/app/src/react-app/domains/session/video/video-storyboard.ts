/** Executable-format example for the existing HyperFrames parser, not a second schema. */
export const VIDEO_STORYBOARD_EXAMPLE = `---
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
- camera: component:spatial-camera-suite#depth-layer-moves
- transition_in: cut
- asset_source: code
- asset_brief: Editable idea and task cards; no external visual required.
- sound_effects: A quiet click when the first task appears, if an actual effect is available.
- status: outline

0–1s establish the idea; 1–4s reveal and connect tasks; 4–5s hold the first action.
`;

export const VIDEO_STORYBOARD_FORMAT_CONTRACT = [
  "- STORYBOARD.md MUST use the native parser format shown below: whole-video settings inside the leading --- frontmatter; every frame field on its own physical line starting with `- key: value`. Never combine fields into a semicolon-separated paragraph, a Markdown pipe table, translated keys or a code fence around the saved file. Omit unknown optional lines entirely; never write literal `omit`, `null` or invented asset paths. Keep extra direction/beat maps in narrative paragraphs AFTER the metadata. Adapt the example content and shot count to the brief, not the syntax.",
  "```markdown",
  VIDEO_STORYBOARD_EXAMPLE.trimEnd(),
  "```",
  "- Before reporting the script ready, re-read the saved file and verify frontmatter, one Frame heading per shot, separate metadata list lines, non-empty scene content, and positive duration. For spatial recipes use the exact `component:spatial-camera-suite#<shotStyle>` ID, not `camera:<recipe>`. The user reviews this file in the existing Studio script table; link its exact project path as the editable script, not a generic planning document.",
].join("\n");

/** Only a project-owned canonical script should open the video editor. */
export function videoProjectIdFromStoryboardPath(path: string): string | null {
  const normalized = path.trim().replaceAll("\\", "/").replace(/^\.\//, "");
  const match = /^video\/([^/]+)\/STORYBOARD\.md$/i.exec(normalized);
  return match && match[1] !== "." && match[1] !== ".." ? match[1]! : null;
}
