import { describe, expect, test } from "bun:test";

import {
  isModelReadableAttachment,
  MAX_MODEL_ATTACHMENT_BYTES,
  resolveModelAttachmentMimeType,
} from "../src/react-app/domains/session/sync/attachment-support";

describe("model attachment support", () => {
  test("uses a 25 MB per-file limit", () => {
    expect(MAX_MODEL_ATTACHMENT_BYTES).toBe(25 * 1024 * 1024);
  });

  test("accepts common document, spreadsheet, and presentation formats", () => {
    expect(isModelReadableAttachment("application/pdf", "brief.pdf")).toBe(true);
    expect(isModelReadableAttachment("", "brief.docx")).toBe(true);
    expect(isModelReadableAttachment("", "budget.xlsx")).toBe(true);
    expect(isModelReadableAttachment("application/vnd.ms-powerpoint", "deck.ppt")).toBe(true);
    expect(isModelReadableAttachment("", "deck.pptx")).toBe(true);
  });

  test("keeps unknown binary formats blocked", () => {
    expect(isModelReadableAttachment("application/zip", "archive.zip")).toBe(false);
  });

  test("infers a useful MIME type when Finder does not provide one", () => {
    expect(resolveModelAttachmentMimeType("deck.pptx", "application/octet-stream")).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
    expect(resolveModelAttachmentMimeType("notes.md", "")).toBe("text/plain");
  });
});
