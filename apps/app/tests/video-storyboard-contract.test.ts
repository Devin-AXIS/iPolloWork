import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const videoSkill = readFileSync(new URL("../../../.codex/skills/ipollowork-template-generation/references/video.md", import.meta.url), "utf8");
import { ENGINE_VIDEO_GENERATION_INSTRUCTION } from "../../server/src/engine-host-tools";
import { parseStoryboard } from "../../../vendor/hyperframes/packages/core/src/storyboard/parseStoryboard";
import { setFrameField, setFrameVoiceover, setStoryboardGlobal } from "../../../vendor/hyperframes/packages/core/src/storyboard/editStoryboard";
import { VIDEO_STORYBOARD_EXAMPLE, videoProjectIdFromStoryboardPath } from "../src/react-app/domains/session/video/video-storyboard";
import { videoTaskSystemContext, hyperframesStudioUrl } from "../src/react-app/domains/session/video/video-project";

describe("video script contract", () => {
  test("production instructions do not override the client-owned gate or invite audio probing", () => {
    const context = videoTaskSystemContext("ses_example");
    expect(ENGINE_VIDEO_GENERATION_INSTRUCTION).toContain("prepared task contract owns final validation");
    expect(ENGINE_VIDEO_GENERATION_INSTRUCTION).toContain("ipollowork-video-studio skill once");
    for (const text of ["speech_synthesize_workspace_batch", "retry", "TTS"]) expect(videoSkill).toContain(text);
    expect(ENGINE_VIDEO_GENERATION_INSTRUCTION).not.toContain("Before reporting an editable video complete, run its supplied HyperFrames check");
    expect(context).toContain("Do not add your own validation or review render");
  });
  test("draft planning is bounded without weakening approval, coverage or measured timing", () => {
    for (const requireStoryboardReview of [true, false]) {
      const context = videoTaskSystemContext("ses_example", undefined, undefined, { requireStoryboardReview, includeVoiceover: true });
      for (const requirement of [
        "one rough narration-duration estimate per shot",
        "single counting calculation",
        "Approximate targets are not strict caps",
        "before media acquisition or production",
        "do not calculate per-word, per-phrase or frame-accurate timestamps before synthesis",
        "one post-save review",
        "reopen only affected shots",
        "Preserve required facts and explicit user caps",
        "never character-proportional word timestamps",
        "not a runtime timeout",
        "reuse the storyboard's rough narration estimate before synthesis",
        "calculate it once only if absent or spoken text changed",
      ]) expect(context).toContain(requirement);
      if (requireStoryboardReview) expect(context).toContain("and STOP");
    }
  });

  test("event-driven recipe selection precedes the script, while installation and precise timing follow it", () => {
    const context = videoTaskSystemContext("ses_example", undefined, undefined, { requireStoryboardReview: true });
    const eventStage = context.indexOf("define each intended audience change and observable event");
    const catalogStage = context.indexOf("shortlist executable recipes by intent, inputs, and capacity");
    const scriptStage = context.indexOf("save the complete native STORYBOARD.md with rough scene durations");
    const installStage = context.indexOf("install fitting recipes");
    const customGate = context.indexOf("Before drawing any new scene graphics, query media/video_recipe_catalog");
    expect(eventStage).toBeGreaterThan(-1);
    expect(catalogStage).toBeGreaterThan(eventStage);
    expect(scriptStage).toBeGreaterThan(catalogStage);
    expect(installStage).toBeGreaterThan(scriptStage);
    expect(customGate).toBeGreaterThan(installStage);
    expect(context).toContain("speech, dialogue, visible action, music, footage, or silent reading");
    expect(context).toContain("do not force it onto visual- or music-led work");
    expect(context).toContain("do not draw SVG paths, calculate element coordinates, write a JS/Python timeline builder, or schedule motion every four seconds");
    expect(context).toContain("the considered component IDs, each concrete semantic/input/capacity mismatch");
    expect(context).toContain("A missing catalog/install action is a capability gap to report");
    expect(videoSkill).toContain("shortlist executable recipes by intent, input and capacity");
    expect(context).toContain("JS/Python timeline builder");
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
    expect(videoTaskSystemContext("ses_example")).toContain(VIDEO_STORYBOARD_EXAMPLE.trimEnd());
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

  test("generation requires source coverage and motivated shot selection before approval", () => {
    const context = videoTaskSystemContext("ses_example");
    for (const requirement of [
      "point ID → source heading/page/paragraph → frame(s)",
      "never invent source anchors",
      "meaningful parentheses/qualifiers",
      "user choice, not silent deletion",
      "intended audience change → observable event/evidence",
      "matching viewpoints and scales",
      "Decide readable holds before motion",
      "re-read the source and saved storyboard",
      "agent semantic self-review, not a deterministic parser",
    ]) expect(context).toContain(requirement);
  });

  test("only canonical project scripts route to Studio", () => {
    expect(videoProjectIdFromStoryboardPath("video/ses_example-artifact-video/STORYBOARD.md")).toBe("ses_example-artifact-video");
    expect(videoProjectIdFromStoryboardPath(".\\video\\ses_example\\STORYBOARD.md")).toBe("ses_example");
    for (const path of ["STORYBOARD.md", "docs/STORYBOARD.md", "video/../STORYBOARD.md", "video/ses_example/notes/STORYBOARD.md", "/other/video/ses_example/STORYBOARD.md"]) {
      expect(videoProjectIdFromStoryboardPath(path)).toBeNull();
    }
  });

  test("visual needs and search queries stay bound to semantic narration beats", () => {
    const context = videoTaskSystemContext("ses_example");
    for (const requirement of [
      "exact spoken phrase",
      "Keep events in causal or viewing order",
      "one concrete query per distinct visual need",
      "date/location when factual",
      "exclusion criteria",
      "no fixed keyword quota",
      "source relevance, provenance and license",
      "editable graphics instead of loosely related B-roll",
    ]) expect(context).toContain(requirement);
  });

  test("generated briefs and reference roles preserve continuity without assuming a provider", () => {
    const context = videoTaskSystemContext("ses_example");
    for (const requirement of [
      "subject/identity + environment + action/change",
      "model's actual capabilities and duration limits",
      "Each supplied reference must have an explicit role",
      "what to preserve and what may change",
      "Resolve conflicting references from user priorities",
      "location geometry, palette and screen direction",
      "invent @reference syntax",
    ]) expect(context).toContain(requirement);
  });

  test("pause direction is not spoken text or a fabricated audio capability", () => {
    const context = videoTaskSystemContext("ses_example");
    for (const requirement of [
      "pronunciation of names/abbreviations/numbers",
      "Keep stage directions and pause markers out of voiceover spoken text",
      "do not invent pauseSeconds or SSML support",
      "A visual hold is not an inserted audio pause",
      "real provider word timings and measured audio",
      "not evenly divided word timestamps",
      "unsupported, disclose the gap",
      "after narration edits",
    ]) expect(context).toContain(requirement);
  });

  test("genre-led rhythm uses existing recipes without enforcing a promotional template", () => {
    const context = videoTaskSystemContext("ses_example");
    for (const requirement of [
      "relative energy and information density",
      "dependency order and reading time",
      "quiet stories need not end in a sales CTA",
      "entry state, focal subject, content change, resolved state",
      "existing temporal-pattern/component map",
      "once-per-preset quotas",
      "real measured audio cues",
    ]) expect(context).toContain(requirement);
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
