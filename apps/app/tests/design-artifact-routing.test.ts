import { describe, expect, test } from "bun:test";

import { isDesignArtifact, isVideoStudioArtifact, type ArtifactItem } from "../src/lib/artifacts";

function artifact(path: string, type: ArtifactItem["type"]): ArtifactItem {
  return {
    id: path,
    name: path.split("/").pop() ?? path,
    path,
    type,
    messageId: "message-1",
    messageIndex: 0,
    legacy_target: {
      id: `file:${path}`,
      kind: "file",
      value: path,
      name: path.split("/").pop() ?? path,
      preview: type === "slides" ? "slides" : type === "video" ? "external" : "html",
      confidence: 100,
      reason: "test",
      exists: true,
    },
  };
}

describe("template artifact routing", () => {
  test("routes Design HTML and native slide outputs to Design", () => {
    expect(isDesignArtifact(artifact("design/session-1/entry.html", "html"))).toBe(true);
    expect(isDesignArtifact(artifact("design/session-1/export.pptx", "slides"))).toBe(true);
    expect(isDesignArtifact(artifact("design/session-1/design-tokens.css", "text"))).toBe(true);
  });

  test("routes video compositions and rendered videos to Video Studio", () => {
    expect(isVideoStudioArtifact(artifact("video/session-1/entry.html", "html"))).toBe(true);
    expect(isVideoStudioArtifact(artifact("video/session-1/render.mp4", "video"))).toBe(true);
    expect(isVideoStudioArtifact(artifact("video/session-1/design-tokens.css", "text"))).toBe(false);
  });

  test("does not steal ordinary workspace files", () => {
    expect(isDesignArtifact(artifact("src/design-notes.html", "html"))).toBe(false);
    expect(isVideoStudioArtifact(artifact("exports/render.mp4", "video"))).toBe(false);
  });
});
