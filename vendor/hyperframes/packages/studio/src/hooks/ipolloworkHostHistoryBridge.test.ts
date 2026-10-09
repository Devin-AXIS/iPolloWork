import { describe, expect, test } from "vitest";

import {
  acceptsIPolloWorkHostHistoryOrigin,
  parseIPolloWorkHostHistoryMessage,
} from "./useIPolloWorkHostHistoryBridge";

const recordMessage = {
  type: "ipollowork:studio-record-host-edit",
  projectId: "video-session",
  operationId: "apply-neon",
  label: "Apply Neon design system",
  files: {
    "index.html": { before: "<main />", after: '<main data-ipw-theme="neon" />' },
    "design-tokens.css": { before: ":root{--bg:white}", after: ":root{--bg:black}" },
  },
};

describe("iPolloWork host history bridge", () => {
  test("accepts only the actual HTTP or Electron file parent origin", () => {
    expect(acceptsIPolloWorkHostHistoryOrigin("http://localhost:5173", "http://localhost:5173")).toBe(true);
    expect(acceptsIPolloWorkHostHistoryOrigin("https://example.com", "http://localhost:5173")).toBe(false);
    expect(acceptsIPolloWorkHostHistoryOrigin("http://localhost:9999", "http://localhost:9999")).toBe(false);
    expect(acceptsIPolloWorkHostHistoryOrigin("null", "file://")).toBe(true);
    expect(acceptsIPolloWorkHostHistoryOrigin("https://example.com", "file://")).toBe(false);
  });

  test("maps a fixed two-file host edit into Studio history", () => {
    expect(parseIPolloWorkHostHistoryMessage(recordMessage, "video-session")).toEqual({
      type: "record",
      operationId: "apply-neon",
      input: {
        label: "Apply Neon design system",
        kind: "source",
        files: recordMessage.files,
      },
    });
  });

  test("accepts matching undo and redo actions", () => {
    expect(parseIPolloWorkHostHistoryMessage({
      type: "ipollowork:studio-history-action",
      projectId: "video-session",
      action: "undo",
    }, "video-session")).toEqual({ type: "undo" });
    expect(parseIPolloWorkHostHistoryMessage({
      type: "ipollowork:studio-history-action",
      projectId: "video-session",
      action: "redo",
    }, "video-session")).toEqual({ type: "redo" });
  });

  test("rejects another project, arbitrary files, and malformed snapshots", () => {
    expect(parseIPolloWorkHostHistoryMessage(recordMessage, "another-project")).toBeNull();
    expect(parseIPolloWorkHostHistoryMessage({
      ...recordMessage,
      files: { "secrets.txt": { before: "", after: "changed" } },
    }, "video-session")).toBeNull();
    expect(parseIPolloWorkHostHistoryMessage({
      ...recordMessage,
      files: { "index.html": { before: "<main />" } },
    }, "video-session")).toBeNull();
  });

  test("forwards token-only snapshots to the shared project history owner", () => {
    const command = parseIPolloWorkHostHistoryMessage({
      ...recordMessage,
      files: {
        "index.html": { before: "<main />", after: "<main />" },
        "design-tokens.css": { before: "theme-a", after: "theme-b" },
      },
    }, "video-session");
    if (command?.type !== "record") throw new Error("Expected a record command");
    expect(command.input.files["design-tokens.css"]).toEqual({ before: "theme-a", after: "theme-b" });
  });
});
