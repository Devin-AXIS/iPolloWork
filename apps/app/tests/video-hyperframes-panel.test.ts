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
    expect(panelSource).toContain("onExpandedChange?.(!expanded)");
    expect(panelSource).not.toContain("requestFullscreen()");
    expect(panelSource).not.toContain("document.exitFullscreen()");
  });

  test("keeps the application sidebar visible while Video Studio is expanded", () => {
    const sessionPageSource = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    );

    expect(sessionPageSource).toContain("videoStudioExpanded");
    expect(sessionPageSource).toContain('left: shellConfig.sidebar && sidebarOpen ? `${effectiveLeftSidebarWidth}px` : "0"');
    expect(sessionPageSource).toContain("onExpandedChange={setVideoStudioExpanded}");
  });

  test("prevents automatic browser activity from replacing Video Studio", () => {
    const sessionPageSource = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    );

    expect(sessionPageSource).toContain("if (isVideoSession && activeSidePanel !== \"panel\")");
    expect(sessionPageSource).toContain("void browser.hide?.()");
    expect(sessionPageSource).toContain("if (isVideoSession && options?.auto) return;");
    expect(sessionPageSource).toContain("if (!isVideoSession) setCurrentSidePanel(\"panel\")");
  });

  test("keeps a collapsed-sidebar title clear of its expand button", () => {
    const sessionPageSource = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    );

    expect(sessionPageSource).toContain('sidebarVisuallyCollapsed && shellConfig.sidebar ? "!pl-16 mac:!pl-32" : ""');
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
    expect(contract).toContain("Never stop all Node processes");
    expect(contract).toContain("Do not restart, replace, or health-check the embedded Studio server");
    expect(contract).toContain("Never add example clips");
    expect(contract).toContain("another conversation's project");
    expect(contract).toContain("npx hyperframes check");
    expect(contract).toContain("never leave two `.scene` windows overlapping");
    expect(contract).toContain("seconds-based `data-start`");
    expect(contract).toContain('Do not use legacy `class="frame"` sections');
    expect(contract).toContain("root composition `data-duration` must be the real HyperFrames timeline duration");
    expect(contract).toContain("assets/ipollowork-logo.svg?v=20260721");
    expect(contract).toContain("Never redraw, inline, or regenerate an older iPolloWork logo");
  });

  test("gives video agents the selected Studio voice without forcing narration", () => {
    const contract = videoTaskSystemContext("ses/current video", "/workspace/current");
    expect(contract).toContain("/workspace/current/video/ses_current_video/voiceover.json");
    expect(contract).toContain("ipollowork_extension_list_actions");
    expect(contract).toContain("ipollowork_extension_call");
    expect(contract).toContain("speech_synthesize_workspace_file");
    expect(contract).toContain("Never call generic `speech_synthesize`");
    expect(contract).toContain("voiceId");
    expect(contract).toContain("assets/voiceover-<unique-revision>.mp3");
    expect(contract).toContain("direct child of the root composition");
    expect(contract).toContain("immutable filename");
    expect(contract).toContain("actual `durationSeconds`");
    expect(contract).toContain("sceneDuration");
    expect(contract).toContain("compositionPath");
    expect(contract).toContain("audioElementHtml");
    expect(contract).toContain("timelinePatch");
    expect(contract).toContain("shiftFollowingBySeconds");
    expect(contract).toContain("cumulative shift");
    expect(contract).toContain("remain visibly present for the entire narration window");
    expect(contract).toContain("must not animate out");
    expect(contract).toContain("voiceover_timeline_validate");
    expect(contract).toContain("Do not finish the task while `valid` is false");
    expect(contract).toContain("fix every reported issue and run both checks again");
    expect(contract).toContain('data-ipw-voiceover="true"');
    expect(contract).toContain("data-ipw-scene-id");
    expect(contract).toContain("data-ipw-narration-text");
    expect(contract).toContain("do not hand-author a different narration tag");
    expect(contract).toContain("Never create a single `assets/voiceover.mp3`");
    expect(contract).toContain("voiceover.src = ...");
    expect(contract).toContain("voiceover_*.mp3");
    expect(contract).toContain("a JavaScript array such as");
    expect(contract).toContain("assets/vo_*.mp3");
    expect(contract).toContain("data-ipw-scene-text");
    expect(contract).toContain("same scene's visible text");
    expect(contract).toContain("exact scene start");
    expect(contract).toContain("visible text verbatim in the same order");
    expect(contract).toContain("must be identical");
    expect(contract).toContain("must never overlap");
    expect(contract).toContain("extend that same visual scene");
    expect(contract).toContain("root `data-duration`");
    expect(contract).toContain("GSAP");
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
