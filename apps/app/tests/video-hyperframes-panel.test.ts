import { describe, expect, test } from "bun:test";

import { hyperframesPreviewCommand, hyperframesStudioPort, hyperframesStudioUrl, videoProjectDirectory, videoProjectId, videoTaskSystemContext } from "../src/react-app/domains/session/video/video-project";

describe("HyperFrames Video Studio", () => {
  test("opens the native Studio on a hydrated first frame", () => {
    expect(hyperframesStudioUrl()).toBe("http://localhost:3002/#project/video?v=1&t=0&tab=design&rc=1&tv=1");
  });

  test("isolates each video task in a shell-safe project directory", () => {
    expect(videoProjectId("ses/current video")).toBe("ses_current_video");
    expect(videoProjectDirectory("ses_current-video")).toBe("video/ses_current-video");
    expect(videoProjectDirectory("ses/current video")).toBe("video/ses_current_video");
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
    const contract = videoTaskSystemContext("ses/current video");
    expect(contract).toContain("video/ses_current_video/index.html");
    expect(contract).toContain("HyperFrames skill is installed automatically");
    expect(contract).toContain("Never add example clips");
    expect(contract).toContain("another conversation's project");
  });
});
