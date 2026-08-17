import { describe, expect, test } from "bun:test";

import {
  type ArtifactInteractionContext,
  type ArtifactItem,
  artifactDirectoryPath,
  artifactPathMatchesTarget,
  canOpenArtifactInContext,
  getArtifactsFromMessages,
  selectArtifactContextOutputs,
  selectTemplateEntryArtifacts,
} from "../src/lib/artifacts";
import {
  createVideoArtifactCompletionRequirement,
  unchangedVideoArtifactIssue,
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

  test("requires a template video source to change before completion", () => {
    const requirement = createVideoArtifactCompletionRequirement(
      "video/ses_video/index.html",
      "<main>Template</main>",
      2,
    );

    expect(requirement).toMatchObject({
      sourcePath: "video/ses_video/index.html",
      assistantMessageBaseline: 2,
    });
    expect(unchangedVideoArtifactIssue(requirement.baselineFingerprint, "<main>Template</main>")).toMatchObject({
      code: "artifact_unchanged",
    });
    expect(unchangedVideoArtifactIssue(requirement.baselineFingerprint, "<main>Finished video</main>")).toBeNull();
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

  test("shows only the current entry in a video context", () => {
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
    expect(selectArtifactContextOutputs(
      [currentEntry, unrelatedHtml, stylesheet],
      context,
    )).toEqual([currentEntry]);
    expect(selectArtifactContextOutputs(
      [currentEntry, unrelatedHtml, stylesheet],
    )).toEqual([currentEntry, unrelatedHtml, stylesheet]);
  });

  test("shows one newest video entry when the same file is discovered through multiple paths", () => {
    const entryPath = videoProjectEntryPath("ses_video");
    const context: ArtifactInteractionContext = { kind: "video", entryPath };
    const earlierEntry = {
      ...htmlArtifact(`workspaces/ws_local/${entryPath}`),
      messageIndex: 1,
      updatedAt: 100,
    };
    const finalEntry = {
      ...htmlArtifact(entryPath),
      messageIndex: 2,
      updatedAt: 200,
    };

    expect(selectArtifactContextOutputs(
      [earlierEntry, finalEntry],
      context,
    )).toEqual([finalEntry]);
  });

  test("shows only the presentation entry and slide files from its session directory", () => {
    const entryPath = "design/ses_slides/index.html";
    const context: ArtifactInteractionContext = { kind: "presentation", entryPath };
    const entry = htmlArtifact(entryPath);
    const slides = slidesArtifact("design/ses_slides/final.pptx");
    const supportFile = htmlArtifact("design/ses_slides/preview.html");

    expect(artifactDirectoryPath(entryPath)).toBe("design/ses_slides");
    expect(canOpenArtifactInContext(entry, context)).toBe(true);
    expect(canOpenArtifactInContext(slides, context)).toBe(true);
    expect(canOpenArtifactInContext(slidesArtifact("design/another/final.pptx"), context)).toBe(false);
    expect(canOpenArtifactInContext(supportFile, context)).toBe(false);
    expect(selectArtifactContextOutputs(
      [entry, slides, supportFile],
      context,
    )).toEqual([entry, slides]);
  });

  test("ignores malformed engine tool inputs instead of crashing the conversation", () => {
    const messages = [{
      id: "assistant-1",
      role: "assistant" as const,
      parts: [{
        type: "dynamic-tool" as const,
        toolName: "edit",
        toolCallId: "edit-1",
        state: "output-available" as const,
        input: { file_path: "design/session/entry.html" },
        output: "done",
      }],
    }];

    expect(getArtifactsFromMessages(messages)).toEqual([]);
  });
});
