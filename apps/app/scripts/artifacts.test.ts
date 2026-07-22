import { describe, expect, it } from "bun:test";
import type { UIMessage } from "ai";

import type { OpenTarget } from "../src/react-app/domains/session/artifacts/open-target";
import {
  canOpenArtifact,
  canPreviewArtifact,
  getArtifactsFromMessages,
  groupConversationOutputArtifacts,
  isConversationOutputArtifact,
  isVideoHtmlArtifact,
} from "../src/lib/artifacts";

describe("getArtifactsFromMessages", () => {
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
      legacy_target: { exists: true, preview: "html" },
    });
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
      legacy_target: { preview: "slides", exists: true },
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

    expect(getArtifactsFromMessages(messages, targets)[0]?.legacy_target).toMatchObject({
      value: "customers.csv",
      exists: true,
    });
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

    expect(artifact).toMatchObject({ path: "src/widget.tsx", legacy_target: { exists: true, preview: "text" } });
    expect(artifact ? canPreviewArtifact(artifact) : true).toBe(false);
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
    expect(isVideoHtmlArtifact(outputs.find((artifact) => artifact.path === "video/scene.html")!)).toBe(true);
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

    expect(groups).toHaveLength(2);
    expect(groups[0]?.bundled).toBe(true);
    expect(groups[0]?.primary.path).toBe("hyperframes/launch/index.html");
    expect(groups[0]?.artifacts.map((artifact) => artifact.path)).toContain("hyperframes/launch/src/scene.tsx");
    expect(groups[1]?.primary.path).toBe("hyperframes/recap/index.html");
  });
});
