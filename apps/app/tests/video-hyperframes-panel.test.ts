import { describe, expect, test } from "bun:test";

import { hyperframesPreviewCommand, hyperframesStudioPort, hyperframesStudioUrl, videoProjectDirectory, videoProjectId, videoProjectPath, videoTaskSystemContext } from "../src/react-app/domains/session/video/video-project";

describe("HyperFrames Video Studio", () => {
  test("opens the native Studio on a hydrated first frame", () => {
    expect(hyperframesStudioUrl()).toBe("http://localhost:3002/#project/video?v=1&t=0&tab=design&rc=1&tv=1");
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

  test("starts the embedded Studio without opening an external browser", () => {
    const command = hyperframesPreviewCommand("ses_video_a");
    expect(command).toContain("cd video/ses_video_a");
    expect(command).toContain("--example blank");
    expect(command).not.toContain("warm-grain");
    expect(command).not.toContain("HYPERFRAMES_SKIP_SKILLS");
    expect(command).toContain(`--port ${hyperframesStudioPort("ses_video_a")}`);
    expect(command).toContain("--no-open");
  });

  test("gives the agent the same session-scoped project as the Studio", () => {
    const contract = videoTaskSystemContext("ses/current video", "/workspace/current");
    expect(contract).toContain("/workspace/current/video/ses_current_video/index.html");
    expect(contract).toContain("HyperFrames skill is installed automatically");
    expect(contract).toContain("opens automatically for this video task");
    expect(contract).toContain("exact writable path");
    expect(contract).toContain("Never create a `videos/` directory");
    expect(contract).toContain("Do not run `npx hyperframes preview`");
    expect(contract).toContain("Never add example clips");
    expect(contract).toContain("another conversation's project");
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
