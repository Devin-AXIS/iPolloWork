import { describe, expect, test } from "bun:test";

import type { ComposerDraft, ModelRef } from "../src/app/types";
import {
  draftHasImageAttachment,
  modelSupportsImageInput,
  validateDraftAttachmentsForModel,
} from "../src/react-app/domains/session/sync/model-attachment-guard";
import type { ProviderListResponse } from "@opencode-ai/sdk/v2/client";

function draftWithAttachments(attachments: Array<{ mimeType: string; kind?: "image" | "file" }>): ComposerDraft {
  return {
    mode: "prompt",
    parts: [{ type: "text", text: "describe this" }],
    attachments: attachments.map((attachment, index) => ({
      id: `att-${index}`,
      name: `attachment-${index}`,
      mimeType: attachment.mimeType,
      size: 123,
      kind: attachment.kind ?? (attachment.mimeType.startsWith("image/") ? "image" : "file"),
      file: new File(["x"], `attachment-${index}`),
    })),
    text: "describe this",
    resolvedText: "describe this",
  };
}

function providerList(model: ModelRef, input: { image?: boolean; modalities?: string[] } = {}): ProviderListResponse {
  return {
    connected: [model.providerID],
    default: {},
    all: [
      {
        id: model.providerID,
        name: model.providerID,
        source: "config",
        env: [],
        options: {},
        models: {
          [model.modelID]: {
            id: model.modelID,
            providerID: model.providerID,
            name: model.modelID,
            capabilities: {
              temperature: true,
              reasoning: true,
              attachment: true,
              toolcall: true,
              input: {
                text: true,
                audio: false,
                image: input.image ?? false,
                video: false,
                pdf: true,
              },
              output: {
                text: true,
                audio: false,
                image: false,
                video: false,
                pdf: false,
              },
              interleaved: false,
            },
            cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
            limit: { context: 128000, output: 8192 },
            status: "active",
            options: {},
            headers: {},
            release_date: "2026-01-01",
            ...(input.modalities ? { modalities: { input: input.modalities, output: ["text"] } } : {}),
          },
        },
      },
    ],
  } as ProviderListResponse;
}

describe("model attachment guard", () => {
  const model = { providerID: "deepseek", modelID: "deepseek-v4-pro" };

  test("detects image attachments", () => {
    expect(draftHasImageAttachment(draftWithAttachments([{ mimeType: "image/png" }]))).toBe(true);
    expect(draftHasImageAttachment(draftWithAttachments([{ mimeType: "application/pdf", kind: "file" }]))).toBe(false);
  });

  test("blocks image attachments for models without image input capability", () => {
    const result = validateDraftAttachmentsForModel(
      draftWithAttachments([{ mimeType: "image/png" }]),
      providerList(model, { image: false }),
      model,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("image_input_unsupported");
      expect(result.modelLabel).toBe("deepseek-v4-pro");
    }
  });

  test("allows image attachments for image-capable models", () => {
    expect(
      validateDraftAttachmentsForModel(
        draftWithAttachments([{ mimeType: "image/png" }]),
        providerList(model, { image: true }),
        model,
      ),
    ).toEqual({ ok: true });
  });

  test("allows non-image drafts even when model metadata is missing", () => {
    expect(validateDraftAttachmentsForModel(draftWithAttachments([]), null, model)).toEqual({ ok: true });
  });

  test("treats missing image metadata as unsupported", () => {
    const result = validateDraftAttachmentsForModel(draftWithAttachments([{ mimeType: "image/png" }]), null, model);

    expect(result.ok).toBe(false);
  });

  test("falls back to legacy modalities metadata", () => {
    expect(modelSupportsImageInput(providerList(model, { modalities: ["text", "image"] }), model)).toBe(true);
    expect(modelSupportsImageInput(providerList(model, { modalities: ["text"] }), model)).toBe(false);
  });
});
