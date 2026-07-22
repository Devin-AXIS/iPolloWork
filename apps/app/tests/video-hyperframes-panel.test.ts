import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { hyperframesStudioPort, hyperframesStudioUrl, shouldInjectVideoTaskContext, videoProjectDirectory, videoProjectId, videoProjectPath, videoTaskSystemContext } from "../src/react-app/domains/session/video/video-project";

describe("HyperFrames Video Studio", () => {
  test("keeps a visible fullscreen control in the iPolloWork Video Studio header", () => {
    const panelSource = readFileSync(
      new URL("../src/react-app/domains/session/video/video-panel.tsx", import.meta.url),
      "utf8",
    );

    expect(panelSource).toContain('aria-label="Toggle Video Studio fullscreen"');
    expect(panelSource).toContain("videoPanelRef.current?.requestFullscreen()");
    expect(panelSource).toContain("document.exitFullscreen()");
  });

  test("opens the native Studio on a hydrated first frame", () => {
    expect(hyperframesStudioUrl()).toBe("http://localhost:3002/#project/video?v=1&t=0&tab=design&rc=1&tv=1");
  });

  test("passes the app locale through the Studio hash route", () => {
    expect(hyperframesStudioUrl(3002, "video", "zh")).toBe("http://localhost:3002/#project/video?v=1&t=0&tab=design&rc=1&tv=1&locale=zh");
  });

  test("isolates each video task in a shell-safe project directory", () => {
    expect(videoProjectId("ses/current video")).toBe("ses_current_video");
    expect(videoProjectDirectory("ses_current-video")).toBe("video/ses_current-video");
    expect(videoProjectDirectory("ses/current video")).toBe("video/ses_current_video");
    expect(videoProjectPath("ses/current video", "/workspace/current/")).toBe("/workspace/current/video/ses_current_video");
    expect(videoProjectPath("ses/current video", "/")).toBe("/video/ses_current_video");
    expect(videoProjectPath("ses/current video", "C:\\workspace\\current\\")).toBe("C:\\workspace\\current\\video\\ses_current_video");
  });

  test("assigns a stable session-specific Studio port", () => {
    expect(hyperframesStudioPort("ses_video_a")).toBe(hyperframesStudioPort("ses_video_a"));
    expect(hyperframesStudioPort("ses_video_a")).not.toBe(hyperframesStudioPort("ses_video_b"));
    expect(hyperframesStudioUrl(hyperframesStudioPort("ses_video_a"), videoProjectId("ses_video_a"))).toBe(
      `http://localhost:${hyperframesStudioPort("ses_video_a")}/#project/ses_video_a?v=1&t=0&tab=design&rc=1&tv=1`,
    );
  });

  test("keeps legacy Video Studio sessions on the video task contract", () => {
    expect(shouldInjectVideoTaskContext("video", "work")).toBe(true);
    expect(shouldInjectVideoTaskContext(null, "video")).toBe(true);
    expect(shouldInjectVideoTaskContext("design", "video")).toBe(false);
    expect(shouldInjectVideoTaskContext(null, "work")).toBe(false);
  });

  test("gives the agent the same session-scoped project as the Studio", () => {
    const contract = videoTaskSystemContext("ses/current video", "/workspace/current");
    expect(contract).toContain("/workspace/current/video/ses_current_video/index.html");
    expect(contract).toContain("HyperFrames skill is installed automatically");
    expect(contract).toContain("opens after the project brief is confirmed");
    expect(contract).toContain("exact writable path");
    expect(contract).toContain("Never create, inspect, render, validate, preview, or report a `videos/` directory");
    expect(contract).toContain("A rendered MP4 or narration outside the exact path above");
    expect(contract).toContain("Do not run `npx hyperframes preview`");
    expect(contract).toContain("Never add example clips");
    expect(contract).toContain("another conversation's project");
    expect(contract).toContain("npx hyperframes check");
  });

  test("gives video agents the selected Studio voice without forcing narration", () => {
    const contract = videoTaskSystemContext("ses/current video", "/workspace/current");
    expect(contract).toContain("/workspace/current/video/ses_current_video/voiceover.json");
    expect(contract).toContain("ipollowork_extension_list_actions");
    expect(contract).toContain("ipollowork_extension_call");
    expect(contract).toContain("speech_synthesize");
    expect(contract).toContain("voiceId");
    expect(contract).toContain("assets/voiceover-<unique-revision>.mp3");
    expect(contract).toContain("direct child of the root composition");
    expect(contract).toContain("immutable filename");
    expect(contract).toContain("Decide whether narration helps the confirmed brief");
    expect(contract).toContain("Do not use an unrelated TTS provider");
  });

  test("keeps an imported video template as the agent's editing source", () => {
    const contract = videoTaskSystemContext("ses_video_a", "/workspace/current", {
      id: "personal.launch-film",
      title: "Launch Film",
      entry: "index.html",
      applyChecklist: ["Replace inherited copy", "Keep the visual language"],
    });
    expect(contract).toContain("created from the `Launch Film` video template");
    expect(contract).toContain("do not start a blank project");
    expect(contract).toContain("Apply the user's request by editing this template");
    expect(contract).toContain("Replace inherited copy; Keep the visual language");
  });
});
