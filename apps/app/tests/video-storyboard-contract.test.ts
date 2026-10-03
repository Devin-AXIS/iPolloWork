import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const videoSkill = readFileSync(new URL("../../../examples/plugin-packages/video-agent/skills/ipollowork-video-studio/references/video-storyboard.md", import.meta.url), "utf8");
const composeSkill = readFileSync(new URL("../../../examples/plugin-packages/video-agent/skills/ipollowork-video-studio/references/video-compose.md", import.meta.url), "utf8");
const voiceoverSkill = readFileSync(new URL("../../../examples/plugin-packages/video-agent/skills/ipollowork-video-studio/references/video-voiceover.md", import.meta.url), "utf8");
import { ENGINE_VIDEO_GENERATION_INSTRUCTION } from "../../server/src/engine-host-tools";
import { parseStoryboard } from "../../../vendor/hyperframes/packages/core/src/storyboard/parseStoryboard";
import { setFrameField, setFrameVoiceover, setStoryboardGlobal } from "../../../vendor/hyperframes/packages/core/src/storyboard/editStoryboard";
import { VIDEO_STORYBOARD_EXAMPLE, VIDEO_STORYBOARD_FORMAT_CONTRACT, videoProjectIdFromStoryboardPath } from "../src/react-app/domains/session/video/video-storyboard";
import { videoTaskSystemContext, hyperframesStudioUrl } from "../src/react-app/domains/session/video/video-project";

describe("video script contract", () => {
  test("production instructions do not override the client-owned gate or invite audio probing", () => {
    const context = videoTaskSystemContext("ses_example");
    expect(ENGINE_VIDEO_GENERATION_INSTRUCTION).toContain("prepared task contract owns final validation");
    expect(ENGINE_VIDEO_GENERATION_INSTRUCTION).toContain("Read ipollowork-video-studio once");
    for (const text of ["speech_synthesize_workspace_batch", "retry", "TTS"]) expect(voiceoverSkill).toContain(text);
    expect(ENGINE_VIDEO_GENERATION_INSTRUCTION).not.toContain("Before reporting an editable video complete, run its supplied HyperFrames check");
    expect(context).toContain("single aggregate delivery validator and one bounded repair continuation");
    expect(context.length).toBeLessThan(4500);
  });
  test("every video turn supplies a parseable native script even without loading any reference", () => {
    for (const requireStoryboardReview of [false, true]) for (const includeVoiceover of [false, true]) {
      const context = videoTaskSystemContext("ses_example", undefined, undefined, { requireStoryboardReview, includeVoiceover });
      expect(context).toContain(VIDEO_STORYBOARD_FORMAT_CONTRACT);
      expect(context).toContain("never a Markdown pipe table");
      const example = /```markdown\n([\s\S]+?)\n```/.exec(context)?.[1];
      expect(example).toBeDefined();
      const storyboard = parseStoryboard(example ?? "");
      expect(storyboard.warnings).toEqual([]);
      expect(storyboard.globals).toMatchObject({ theme: "ai-auto", musicPrompt: "Restrained instrumental pulse beneath narration" });
      expect(storyboard.frames).toHaveLength(1);
      expect(storyboard.frames[0]).toMatchObject({ scene: "An idea card becomes a three-step plan; the focus moves to the first task.", durationSeconds: 5, status: "outline" });
      expect(context.length).toBeLessThan(4700);
      if (requireStoryboardReview) {
        expect(context).toContain("then wait for the user's review");
        expect(context).not.toContain("speech_synthesize_workspace_batch");
      }
    }
    expect(parseStoryboard("## 视觉声音\n| 时间 | 画面 | 旁白 | 声音 |\n| 0–5s | Idea | Begin | Music |\n").frames).toEqual([]);
  });
  test("routes specialist stages while preserving content-led reuse and the direct editability contract", () => {
    const context = videoTaskSystemContext("ses_example");
    expect(context).toContain("load only the specialist needed by the current task or production stage");
    for (const stage of ["storyboard", "compose", "voiceover", "soundtrack"]) expect(context).toContain(`ipollowork-video-${stage}`);
    expect(context).toContain("Do not preload unrelated stages");
    expect(context).not.toContain("Creation/full regeneration must read");
    expect(context).not.toContain("video.md sections");
    expect(videoSkill).toContain("Plan content and storyboard");
    expect(videoSkill).toContain("Native editable script");
    expect(composeSkill).toContain("Recipes and components");
    expect(composeSkill).toContain("Composition and timing");
    expect(context).toContain("Use the prepared blank composition unless the user explicitly selected a template");
    expect(videoSkill).toContain("content first");
    expect(composeSkill).toContain("video_recipe_catalog");
    expect(composeSkill).toContain("Mount returned `instances[].snippet`");
    expect(composeSkill).toContain("custom_reason");
    expect(composeSkill).toContain("author editable custom work autonomously");
    expect(composeSkill).toContain("never distort the content, force a recipe match or impose a component proportion/scene count");
    for (const binding of ["design-tokens.css", "--ipw-*", "data-composition-variables", "stable IDs", "editable nodes/hooks", "inherit the active design system", "theme/token changes preserve variables, media and timeline"]) expect(context).toContain(binding);
  });
  test("the actual agent example parses into editable globals and frame fields", () => {
    const result = parseStoryboard(VIDEO_STORYBOARD_EXAMPLE);
    expect(result.warnings).toEqual([]);
    expect(result.globals).toMatchObject({ theme: "ai-auto", musicPrompt: "Restrained instrumental pulse beneath narration" });
    expect(result.frames).toHaveLength(1);
    expect(result.frames[0]).toMatchObject({
      scene: "An idea card becomes a three-step plan; the focus moves to the first task.",
      durationSeconds: 5,
      voiceover: "One idea becomes the next clear step.",
      camera: "fixed:progressive-build",
      assetSource: "code",
      status: "outline",
    });
    const savedSkillExample = /```markdown\n([\s\S]+?)\n```/.exec(videoSkill)?.[1];
    expect(savedSkillExample).toBeDefined();
    const skillStoryboard = parseStoryboard(savedSkillExample ?? "");
    expect(skillStoryboard.warnings).toEqual([]);
    expect(skillStoryboard.frames.length).toBeGreaterThan(0);
    for (const frame of skillStoryboard.frames) {
      expect(frame.scene).toBeTruthy();
      expect(frame.durationSeconds).toBeGreaterThan(0);
      expect(frame.status).toBe("outline");
    }
  });

  test("coverage and shot-fit notes remain native editable frame narrative", () => {
    const result = parseStoryboard(VIDEO_STORYBOARD_EXAMPLE);
    expect(result.warnings).toEqual([]);
    expect(result.frames[0]?.narrative).toContain("Coverage: C1 (brief:");
    expect(result.frames[0]?.narrative).toContain("Shot fit:");
    expect(result.frames[0]?.narrative).toContain("spatial fly-through would interrupt reading");
    expect(result.frames[0]?.narrative).toContain("4–5s hold the first action");
    expect(result.frames[0]?.narrative).toContain("Beat binding:");
    expect(result.frames[0]?.narrative).toContain("Continuity:");
    expect(result.frames[0]?.narrative).toContain("Rhythm:");
    expect(result.frames[0]?.voiceover).not.toContain("Narration:");
    const edited = setStoryboardGlobal(
      setFrameField(setFrameVoiceover(VIDEO_STORYBOARD_EXAMPLE, 1, "Begin with the first task."), 1, "duration", "6s"),
      "visual_style",
      "Quiet, readable task cards",
    );
    const saved = parseStoryboard(edited);
    expect(saved.warnings).toEqual([]);
    expect(saved.frames[0]?.narrative).toBe(result.frames[0]?.narrative);
    expect(saved.frames[0]?.voiceover).toBe("Begin with the first task.");
    expect(saved.frames[0]?.durationSeconds).toBe(6);
  });

  test("only canonical project scripts route to Studio", () => {
    expect(videoProjectIdFromStoryboardPath("video/ses_example-artifact-video/STORYBOARD.md")).toBe("ses_example-artifact-video");
    expect(videoProjectIdFromStoryboardPath(".\\video\\ses_example\\STORYBOARD.md")).toBe("ses_example");
    for (const path of ["STORYBOARD.md", "docs/STORYBOARD.md", "video/../STORYBOARD.md", "video/ses_example/notes/STORYBOARD.md", "/other/video/ses_example/STORYBOARD.md"]) {
      expect(videoProjectIdFromStoryboardPath(path)).toBeNull();
    }
  });

  test("paragraph-style metadata is preserved but never silently called a valid script", () => {
    const result = parseStoryboard("## Frame 1 — Idea\nscene: Idea becomes a plan；duration: 5s；voiceover: Begin");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.message).toContain("separate '- key: value'");
    expect(result.frames[0]?.narrative).toContain("Idea becomes a plan");
    expect(result.frames[0]?.durationSeconds).toBeUndefined();
  });

  test("script deep links use the existing table view without changing timeline defaults", () => {
    const url = new URL(hyperframesStudioUrl(3002, "ses_example", "zh", "light", 2, "storyboard"));
    expect(url.searchParams.get("view")).toBe("storyboard");
    expect(url.hash).toStartWith("#project/ses_example?");
    expect(new URL(hyperframesStudioUrl()).searchParams.has("view")).toBe(false);
  });
});
