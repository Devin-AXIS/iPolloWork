import { describe, expect, test } from "bun:test";

import {
  type ArtifactInteractionContext,
  type ArtifactItem,
  artifactDirectoryPath,
  artifactPathMatchesTarget,
  canOpenArtifactInContext,
  selectTemplateEntryArtifacts,
} from "../src/lib/artifacts";
import {
  videoProjectEntryPath,
} from "../src/react-app/domains/session/video/video-project";

function htmlArtifact(path: string): ArtifactItem {
  const name = path.split("/").pop() ?? path;
  return {
    id: path,
    name,
    path,
    type: "html",
    messageId: "message",
    messageIndex: 0,
    legacy_target: {
      id: `file:${path}`,
      kind: "file",
      value: path,
      name,
      preview: "html",
      confidence: 100,
      reason: "test",
      exists: true,
    },
  };
}

function slidesArtifact(path: string): ArtifactItem {
  const artifact = htmlArtifact(path);
  return {
    ...artifact,
    type: "slides",
    legacy_target: {
      ...artifact.legacy_target,
      preview: "slides",
    },
  };
}

describe("video artifact entry routing", () => {
  test("derives one session-owned video entry", () => {
    expect(videoProjectEntryPath("ses/video 1")).toBe("video/ses_video_1/index.html");
  });

  test("matches only the current video entry across workspace path prefixes", () => {
    const entryPath = videoProjectEntryPath("ses_video");

    expect(artifactPathMatchesTarget(
      "workspaces/ws_local/video/ses_video/index.html",
      entryPath,
    )).toBe(true);
    expect(artifactPathMatchesTarget(
      "video/another_session/index.html",
      entryPath,
    )).toBe(false);
    expect(artifactPathMatchesTarget(
      "video/ses_video/preview.html",
      entryPath,
    )).toBe(false);
    expect(artifactPathMatchesTarget(
      "video/ses_video/design-tokens.css",
      entryPath,
    )).toBe(false);
  });

  test("selects the exact entry instead of another file with the same name", () => {
    const entryPath = videoProjectEntryPath("ses_video");
    const otherEntry = htmlArtifact("video/another_session/index.html");
    const currentEntry = htmlArtifact(entryPath);

    expect(selectTemplateEntryArtifacts(
      [otherEntry, currentEntry],
      entryPath,
    )).toEqual([currentEntry]);
  });

  test("keeps non-entry outputs visible but non-activatable in a video context", () => {
    const entryPath = videoProjectEntryPath("ses_video");
    const context: ArtifactInteractionContext = { kind: "video", entryPath };
    const currentEntry = htmlArtifact(entryPath);
    const unrelatedHtml = htmlArtifact("video/ses_video/preview.html");
    const stylesheet: ArtifactItem = {
      ...htmlArtifact("video/ses_video/design-tokens.css"),
      type: "text",
      legacy_target: {
        ...htmlArtifact("video/ses_video/design-tokens.css").legacy_target,
        preview: "text",
      },
    };

    expect(canOpenArtifactInContext(currentEntry, context)).toBe(true);
    expect(canOpenArtifactInContext(unrelatedHtml, context)).toBe(false);
    expect(canOpenArtifactInContext(stylesheet, context)).toBe(false);
    expect(canOpenArtifactInContext(stylesheet)).toBe(true);
  });

  test("opens only the presentation entry and slide files from its session directory", () => {
    const entryPath = "design/ses_slides/index.html";
    const context: ArtifactInteractionContext = { kind: "presentation", entryPath };

    expect(artifactDirectoryPath(entryPath)).toBe("design/ses_slides");
    expect(canOpenArtifactInContext(htmlArtifact(entryPath), context)).toBe(true);
    expect(canOpenArtifactInContext(slidesArtifact("design/ses_slides/final.pptx"), context)).toBe(true);
    expect(canOpenArtifactInContext(slidesArtifact("design/another/final.pptx"), context)).toBe(false);
    expect(canOpenArtifactInContext(htmlArtifact("design/ses_slides/preview.html"), context)).toBe(false);
  });
});
