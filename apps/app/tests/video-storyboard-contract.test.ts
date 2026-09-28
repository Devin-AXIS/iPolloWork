import { describe, expect, test } from "bun:test";
import { parseStoryboard } from "../../../vendor/hyperframes/packages/core/src/storyboard/parseStoryboard";
import { VIDEO_STORYBOARD_EXAMPLE, videoProjectIdFromStoryboardPath } from "../src/react-app/domains/session/video/video-storyboard";
import { videoTaskSystemContext, hyperframesStudioUrl } from "../src/react-app/domains/session/video/video-project";

describe("video script contract", () => {
  test("the actual agent example parses into editable globals and frame fields", () => {
    const result = parseStoryboard(VIDEO_STORYBOARD_EXAMPLE);
    expect(result.warnings).toEqual([]);
    expect(result.globals).toMatchObject({ theme: "ai-auto", musicPrompt: "Restrained instrumental pulse beneath narration" });
    expect(result.frames).toHaveLength(1);
    expect(result.frames[0]).toMatchObject({
      scene: "An idea card becomes a three-step plan; the focus moves to the first task.",
      durationSeconds: 5,
      voiceover: "One idea becomes the next clear step.",
      camera: "component:spatial-camera-suite#depth-layer-moves",
      assetSource: "code",
      status: "outline",
    });
    expect(videoTaskSystemContext("ses_example")).toContain(VIDEO_STORYBOARD_EXAMPLE.trimEnd());
  });

  test("only canonical project scripts route to Studio", () => {
    expect(videoProjectIdFromStoryboardPath("video/ses_example-artifact-video/STORYBOARD.md")).toBe("ses_example-artifact-video");
    expect(videoProjectIdFromStoryboardPath(".\\video\\ses_example\\STORYBOARD.md")).toBe("ses_example");
    for (const path of ["STORYBOARD.md", "docs/STORYBOARD.md", "video/../STORYBOARD.md", "video/ses_example/notes/STORYBOARD.md", "/other/video/ses_example/STORYBOARD.md"]) {
      expect(videoProjectIdFromStoryboardPath(path)).toBeNull();
    }
  });

  test("finished-video instructions resolve and synchronize the soundtrack and content revisions", () => {
    const context = videoTaskSystemContext("ses_example");
    expect(context).toContain("make an explicit soundtrack decision BEFORE assembly");
    expect(context).toContain("music_prompt: none");
    expect(context).toContain("MUST be written back");
    expect(context).toContain("not merely because a download works");
    expect(context).toContain("Regenerate changed spoken lines");
    expect(context).toContain("report partial delivery");
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
