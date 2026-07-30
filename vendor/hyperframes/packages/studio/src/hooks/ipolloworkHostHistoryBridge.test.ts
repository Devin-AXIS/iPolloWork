import { describe, expect, test } from "vitest";

import {
  acceptsIPolloWorkHostHistoryOrigin,
  parseIPolloWorkHostHistoryMessage,
} from "./useIPolloWorkHostHistoryBridge";
import {
  buildEditHistoryEntry,
  createEmptyEditHistory,
  hashEditHistoryContent,
  pushEditHistoryEntry,
  redoEditHistory,
  undoEditHistory,
} from "../utils/editHistory";

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

  test("keeps a token-only theme edit undoable and redoable", () => {
    const command = parseIPolloWorkHostHistoryMessage({
      ...recordMessage,
      files: {
        "index.html": { before: "<main />", after: "<main />" },
        "design-tokens.css": { before: "theme-a", after: "theme-b" },
      },
    }, "video-session");
    if (command?.type !== "record") throw new Error("Expected a record command");
    const entry = buildEditHistoryEntry({
      ...command.input,
      id: "theme-edit",
      projectId: "video-session",
      now: 1,
    });
    const state = pushEditHistoryEntry(createEmptyEditHistory(), entry);

    expect(Object.keys(entry.files)).toEqual(["design-tokens.css"]);
    const undone = undoEditHistory(state, {
      "design-tokens.css": hashEditHistoryContent("theme-b"),
    }, 2);
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(undone.filesToWrite).toEqual({ "design-tokens.css": "theme-a" });

    const redone = redoEditHistory(undone.state, {
      "design-tokens.css": hashEditHistoryContent("theme-a"),
    }, 3);
    expect(redone.ok).toBe(true);
    if (!redone.ok) return;
    expect(redone.filesToWrite).toEqual({ "design-tokens.css": "theme-b" });
  });
});
