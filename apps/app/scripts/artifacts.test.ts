import { describe, expect, it } from "bun:test";
import type { UIMessage } from "ai";

import type { OpenTarget } from "../src/react-app/domains/session/artifacts/open-target";
import {
  canOpenArtifact,
  canPreviewArtifact,
  getArtifactsFromMessages,
  groupConversationOutputArtifacts,
  isConversationOutputArtifact,
  selectTemplateEntryArtifacts,
} from "../src/lib/artifacts";

describe("getArtifactsFromMessages", () => {
  it("includes persisted Studio outputs without inserting chat messages or duplicating transcript images", () => {
    const messages: UIMessage[] = [{ id: "chat", role: "assistant", parts: [{ type: "text", text: "Generated artifacts/sun.png" }] }];
    const before = JSON.stringify(messages);
    const files = [
      { path: "artifacts/sun.png", size: 10, updatedAt: 100 },
      { path: "artifacts/sun-edited.png", size: 20, updatedAt: 200 },
    ];
    const outputs = getArtifactsFromMessages(messages, [], { includeTargetFallbacks: false, registeredFiles: files });
    expect(outputs).toHaveLength(2);
    expect(outputs[0]).toMatchObject({ path: "artifacts/sun-edited.png", type: "image", target: { exists: true, size: 20, updatedAt: 200 } });
    expect(getArtifactsFromMessages([], [], { registeredFiles: files })).toHaveLength(2);
    expect(getArtifactsFromMessages([], [], { includeTargetFallbacks: false })).toEqual([]);
    expect(JSON.stringify(messages)).toBe(before);
  });

  it("shows an image card from a completed Codex MCP result without prose or an open workbench", () => {
    const messages: UIMessage[] = [{
      id: "image-result",
      role: "assistant",
      parts: [{
        type: "dynamic-tool",
        toolName: "ipollowork.ipollowork_extension_call",
        toolCallId: "image-call",
        state: "output-available",
        input: { extensionId: "openai-image-generation", action: "image_generate" },
        output: { content: [{ type: "text", text: JSON.stringify({ ok: true, path: "artifacts/sunrise.png" }) }] },
      }],
    }];
    const artifacts = getArtifactsFromMessages(messages, [], { includeTargetFallbacks: false });
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      path: "artifacts/sunrise.png",
      type: "image",
      messageId: "image-result",
      target: { exists: true, preview: "image" },
    });
    expect(canOpenArtifact(artifacts[0]!)).toBe(true);
  });

  it("lists a Design template entry when the completion omits its path", () => {
    const messages: UIMessage[] = [{
      id: "msg_done",
      role: "assistant",
      parts: [{ type: "text", text: "The presentation is complete.", state: "done" }],
    }];
    const targets: OpenTarget[] = [{
      id: "file:design/ses_deck/entry.html",
      kind: "file",
      value: "design/ses_deck/entry.html",
      name: "entry.html",
      preview: "html",
      confidence: 100,
      reason: "template entry",
      exists: true,
    }];

    expect(getArtifactsFromMessages(messages, targets, {
      includeTargetFallbacks: false,
      supplementalFiles: ["design/ses_deck/entry.html"],
    })[0]).toMatchObject({
      path: "design/ses_deck/entry.html",
      type: "html",
      target: { exists: true, preview: "html" },
    });
  });

  it("keeps only the canonical Design entry when a completion also names template assets", () => {
    const entryPath = "design/ses_deck/entry.html";
    const messages: UIMessage[] = [{
      id: "msg_done",
      role: "assistant",
      parts: [{
        type: "text",
        text: "Created design/ses_deck/entry.html, design/ses_deck/assets/ipollowork-logo.svg, and entry.html.",
        state: "done",
      }],
    }];
    const targets: OpenTarget[] = [{
      id: `file:${entryPath}`,
      kind: "file",
      value: entryPath,
      name: "entry.html",
      preview: "html",
      confidence: 100,
      reason: "template entry",
      exists: true,
    }];

    const artifacts = getArtifactsFromMessages(messages, targets, {
      includeTargetFallbacks: false,
      supplementalFiles: [entryPath],
    });

    expect(selectTemplateEntryArtifacts(artifacts, entryPath)).toEqual([
      expect.objectContaining({
        path: entryPath,
        target: expect.objectContaining({ reason: "template entry", exists: true }),
      }),
    ]);
  });

  it("includes verified slide deck targets mentioned in assistant summaries", () => {
    const messages: UIMessage[] = [{
      id: "msg_deck",
      role: "assistant",
      parts: [{ type: "text", text: "Updated file: decks/ipollowork-vertebrae-deck.pptx", state: "done" }],
    }];
    const targets: OpenTarget[] = [{
      id: "file:decks/ipollowork-vertebrae-deck.pptx",
      kind: "file",
      value: "decks/ipollowork-vertebrae-deck.pptx",
      name: "ipollowork-vertebrae-deck.pptx",
      preview: "slides",
      confidence: 65,
      reason: "message",
      exists: true,
    }];

    expect(getArtifactsFromMessages(messages, targets)[0]).toMatchObject({
      name: "ipollowork-vertebrae-deck.pptx",
      path: "decks/ipollowork-vertebrae-deck.pptx",
      type: "slides",
      target: { preview: "slides", exists: true },
    });
  });

  it("uses verified relative targets for absolute attachment paths", () => {
    const messages: UIMessage[] = [{
      id: "msg_attachment",
      role: "assistant",
      parts: [{
        type: "source-document",
        sourceId: "attachment-source",
        mediaType: "text/csv",
        title: "customers.csv",
        filename: "/Users/test/workspace/customers.csv",
      }],
    }];
    const targets: OpenTarget[] = [{
      id: "file:customers.csv",
      kind: "file",
      value: "customers.csv",
      name: "customers.csv",
      preview: "sheet",
      confidence: 95,
      reason: "attachment source",
      exists: true,
    }];

    expect(getArtifactsFromMessages(messages, targets)[0]?.target).toMatchObject({
      value: "customers.csv",
      exists: true,
    });
  });

  it("turns an explicit absolute image link into the verified workspace artifact", () => {
    const absolutePath = "/Users/test/Application Support/workspace/design/ses_card/reddit-post-card.png";
    const messages: UIMessage[] = [{
      id: "msg_image",
      role: "assistant",
      parts: [{
        type: "text",
        text: `可以，已导出为 PNG：\n[下载 Reddit Post Card 图片](<${absolutePath}>)`,
        state: "done",
      }],
    }];
    const targets: OpenTarget[] = [{
      id: "file:design/ses_card/reddit-post-card.png",
      kind: "file",
      value: "design/ses_card/reddit-post-card.png",
      name: "reddit-post-card.png",
      preview: "image",
      confidence: 65,
      reason: "message",
      exists: true,
    }];

    expect(getArtifactsFromMessages(messages, targets, { includeTargetFallbacks: false })).toEqual([
      expect.objectContaining({
        name: "reddit-post-card.png",
        path: "design/ses_card/reddit-post-card.png",
        type: "image",
        target: expect.objectContaining({ value: "design/ses_card/reddit-post-card.png", exists: true }),
      }),
    ]);
  });

  it("keeps verified exports beside a template editor entry", () => {
    const entry = {
      id: "design/ses_card/entry.html",
      name: "entry.html",
      path: "design/ses_card/entry.html",
      type: "html" as const,
      messageId: "msg_image",
      messageIndex: 0,
      target: {
        id: "file:design/ses_card/entry.html",
        kind: "file" as const,
        value: "design/ses_card/entry.html",
        name: "entry.html",
        preview: "html" as const,
        confidence: 100,
        reason: "template entry",
        exists: true,
      },
    };
    const image = {
      ...entry,
      id: "design/ses_card/reddit-post-card.png",
      name: "reddit-post-card.png",
      path: "design/ses_card/reddit-post-card.png",
      type: "image" as const,
      target: {
        ...entry.target,
        id: "file:design/ses_card/reddit-post-card.png",
        value: "design/ses_card/reddit-post-card.png",
        name: "reddit-post-card.png",
        preview: "image" as const,
        confidence: 65,
        reason: "message",
      },
    };
    const unrelatedImage = {
      ...image,
      id: "design/ses_other/unrelated.png",
      name: "unrelated.png",
      path: "design/ses_other/unrelated.png",
      target: {
        ...image.target,
        id: "file:design/ses_other/unrelated.png",
        value: "design/ses_other/unrelated.png",
        name: "unrelated.png",
      },
    };

    expect(selectTemplateEntryArtifacts([unrelatedImage, image, entry], entry.path)).toEqual([entry, image]);
  });

  it("can list artifacts from assistant text without target fallbacks", () => {
    const messages: UIMessage[] = [{
      id: "msg_text",
      role: "assistant",
      parts: [{ type: "text", text: "Created reports/artifact-eval.md, decks/update.pptx, and src/widget.tsx", state: "done" }],
    }];

    expect(getArtifactsFromMessages(messages, [], { includeTargetFallbacks: false }).map((artifact) => artifact.path)).toEqual([
      "src/widget.tsx",
      "decks/update.pptx",
      "reports/artifact-eval.md",
    ]);
  });

  it("orders verified artifacts by newest update time and marks unsupported previews", () => {
    const messages: UIMessage[] = [{
      id: "msg_order",
      role: "assistant",
      parts: [{ type: "text", text: "Created reports/old.md and reports/new.md and src/widget.tsx", state: "done" }],
    }];
    const targets: OpenTarget[] = [
      {
        id: "file:reports/old.md",
        kind: "file",
        value: "reports/old.md",
        name: "old.md",
        preview: "markdown",
        confidence: 65,
        reason: "message",
        exists: true,
        updatedAt: 1,
      },
      {
        id: "file:reports/new.md",
        kind: "file",
        value: "reports/new.md",
        name: "new.md",
        preview: "markdown",
        confidence: 65,
        reason: "message",
        exists: true,
        updatedAt: 2,
      },
    ];

    const artifacts = getArtifactsFromMessages(messages, targets, { includeTargetFallbacks: false });

    expect(artifacts.map((artifact) => artifact.path)).toEqual(["reports/new.md", "reports/old.md", "src/widget.tsx"]);
    expect(canPreviewArtifact(artifacts[0])).toBe(true);
    expect(canPreviewArtifact(artifacts[2])).toBe(false);
  });

  it("lets verified unsupported file artifacts open outside the sidebar", () => {
    const messages: UIMessage[] = [{
      id: "msg_unsupported",
      role: "assistant",
      parts: [{ type: "text", text: "Created src/widget.tsx", state: "done" }],
    }];
    const targets: OpenTarget[] = [{
      id: "file:src/widget.tsx",
      kind: "file",
      value: "src/widget.tsx",
      name: "widget.tsx",
      preview: "text",
      confidence: 65,
      reason: "message",
      exists: true,
    }];

    const artifact = getArtifactsFromMessages(messages, targets, { includeTargetFallbacks: false })[0];

    expect(artifact).toMatchObject({ path: "src/widget.tsx", target: { exists: true, preview: "text" } });
    expect(artifact ? canPreviewArtifact(artifact) : true).toBe(false);
    expect(artifact ? canOpenArtifact(artifact) : false).toBe(true);
  });

  it("lets markdown artifacts created by write tools open before target resolution finishes", () => {
    const messages: UIMessage[] = [{
      id: "msg_tool_created",
      role: "assistant",
      parts: [{
        type: "dynamic-tool",
        toolName: "write",
        state: "output-available",
        input: { filePath: "reports/generated.md", content: "# Generated" },
        output: { filepath: "reports/generated.md", exists: true },
      }],
    }];

    const artifact = getArtifactsFromMessages(messages, [], { includeTargetFallbacks: false })[0];

    expect(artifact).toMatchObject({
      path: "reports/generated.md",
      type: "markdown",
      target: { exists: true, preview: "markdown" },
    });
    expect(artifact ? canPreviewArtifact(artifact) : false).toBe(true);
    expect(artifact ? canOpenArtifact(artifact) : false).toBe(true);
  });

  it("lists every file returned by an array-shaped write tool result", () => {
    const messages: UIMessage[] = [{
      id: "msg_patch_created",
      role: "assistant",
      parts: [{
        type: "dynamic-tool",
        toolName: "apply_patch",
        toolCallId: "patch_tool",
        state: "output-available",
        input: {},
        output: [
          { path: "video/ses_launch/index.html", kind: "update", diff: "@@" },
          { path: "reports/launch.xlsx", kind: "add", diff: "@@" },
        ],
      }],
    }];

    const artifacts = getArtifactsFromMessages(messages, [], { includeTargetFallbacks: false });

    expect(artifacts.map((artifact) => artifact.path)).toEqual([
      "reports/launch.xlsx",
      "video/ses_launch/index.html",
    ]);
    expect(artifacts.every(canOpenArtifact)).toBe(true);
  });

  it("uses a uniquely resolved nested path for a bare filename", () => {
    const messages: UIMessage[] = [{
      id: "msg_nested_file",
      role: "assistant",
      parts: [{ type: "text", text: "已完成，可以打开 account_monthly.csv。", state: "done" }],
    }];
    const targets: OpenTarget[] = [{
      id: "file:analysis/data/account_monthly.csv",
      kind: "file",
      value: "analysis/data/account_monthly.csv",
      name: "account_monthly.csv",
      preview: "sheet",
      confidence: 65,
      reason: "message",
      exists: true,
    }];

    const artifact = getArtifactsFromMessages(messages, targets, { includeTargetFallbacks: false })[0];

    expect(artifact).toMatchObject({
      path: "analysis/data/account_monthly.csv",
      type: "sheet",
      target: { exists: true, value: "analysis/data/account_monthly.csv" },
    });
    expect(artifact ? canOpenArtifact(artifact) : false).toBe(true);
  });

  it("keeps internal skill files out of the user-facing output list", () => {
    const messages: UIMessage[] = [{
      id: "msg_outputs",
      role: "assistant",
      parts: [{
        type: "text",
        text: "Created reports/trends.md, sheets/summary.csv, video/scene.html, .opencode/skills/deep-research/SKILL.md, and sources/references.md",
        state: "done",
      }],
    }];

    const outputs = getArtifactsFromMessages(messages, [], { includeTargetFallbacks: false })
      .filter(isConversationOutputArtifact);

    expect(outputs.map((artifact) => artifact.path)).toEqual([
      "video/scene.html",
      "sheets/summary.csv",
      "reports/trends.md",
    ]);
    expect(outputs.some((artifact) => artifact.name === "SKILL.md")).toBe(false);
  });

  it("bundles multi-file outputs around the final entry file", () => {
    const messages: UIMessage[] = [{
      id: "msg_hyperframes",
      role: "assistant",
      parts: [{
        type: "text",
        text: "Created hyperframes/launch/index.html, hyperframes/launch/src/scene.tsx, hyperframes/launch/package.json, hyperframes/launch/public/logo.png, and hyperframes/recap/index.html",
        state: "done",
      }],
    }];

    const outputs = getArtifactsFromMessages(messages, [], { includeTargetFallbacks: false })
      .filter(isConversationOutputArtifact);
    const groups = groupConversationOutputArtifacts(outputs);

    expect(groups).toHaveLength(3);
    const project = groups.find((group) => group.primary.path === "hyperframes/launch/index.html");
    expect(project?.bundled).toBe(true);
    expect(project?.artifacts.map((artifact) => artifact.path)).toContain("hyperframes/launch/src/scene.tsx");
    expect(groups.find((group) => group.primary.type === "image")?.bundled).toBe(false);
    expect(groups.some((group) => group.primary.path === "hyperframes/recap/index.html")).toBe(true);
  });

  it("keeps all 18 media outputs independently reachable in one session directory", () => {
    const paths = Array.from({ length: 18 }, (_, index) => `video/session/renders/output-${index}.${index % 2 ? "mp4" : "png"}`);
    const outputs = getArtifactsFromMessages([], [], { registeredFiles: paths.map((path) => ({ path, size: 10, updatedAt: 100 })) });
    const groups = groupConversationOutputArtifacts(outputs);
    expect(groups).toHaveLength(18);
    expect(groups.every((group) => !group.bundled && group.artifacts.length === 1)).toBe(true);
    expect(new Set(groups.map((group) => group.primary.path))).toEqual(new Set(paths));
  });
});
