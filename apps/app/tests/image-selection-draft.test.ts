import { describe, expect, test } from "bun:test";
import type { ComposerDraft } from "../src/app/types";
import type { ImageSelectionSnapshot } from "@ipollowork/types/plugins";
import { withImageSelection } from "../src/react-app/domains/session/surface/image-selection-draft";

const snapshot: ImageSelectionSnapshot = {
  selectionId: "82d7082b-1064-4218-a6c7-b70fe1a389f2",
  sourcePath: "artifacts/source.png",
  model: "volcengine/seedream-5",
  size: "2K",
  selectionBlend: "natural",
  guidance: "Lighting: soft",
  previewDataUrl: "data:image/png;base64,aW1hZ2Utc2VsZWN0aW9u",
};
const draft: ComposerDraft = { mode: "prompt", parts: [{ type: "text", text: "Make the selected sun blue" }], text: "Make the selected sun blue", attachments: [] };

describe("chat image selection", () => {
  test("freezes a selection for send/queue and attaches its preview to a multimodal chat", async () => {
    const result = await withImageSelection(draft, { key: "selection", sessionId: "s1", sourcePath: snapshot.sourcePath, capture: async () => snapshot }, true);
    expect(result.text).toBe(draft.text);
    expect(result.capability?.instruction).toContain(snapshot.selectionId);
    expect(result.capability?.instruction).toContain('"model":"volcengine/seedream-5"');
    expect(result.capability?.instruction).toContain('"size":"2K"');
    expect(result.capability?.instruction).toContain('"selectionBlend":"natural"');
    expect(result.capability?.instruction).toContain("Lighting: soft");
    expect(result.capability?.instruction).not.toContain(snapshot.previewDataUrl);
    expect(result.attachments).toHaveLength(1);
    expect(await result.attachments[0]?.file.text()).toBe("image-selection");
    expect(draft.attachments).toHaveLength(0);
  });
  test("preserves existing capability and attachments when chat cannot see images", async () => {
    const result = await withImageSelection({ ...draft, capability: { id: "custom", instruction: "Existing context" } }, {
      key: "selection", sessionId: "s1", sourcePath: snapshot.sourcePath, capture: async () => snapshot,
    }, false);
    expect(result.capability?.id).toBe("custom+image-selection");
    expect(result.capability?.instruction).toStartWith("Existing context");
    expect(result.capability?.instruction).toContain(snapshot.selectionId);
    expect(result.attachments).toEqual([]);
  });
  test("fails closed if the live selection changed or the workbench was closed before capture", async () => {
    await expect(withImageSelection(draft, {
      key: "stale", sessionId: "s1", sourcePath: snapshot.sourcePath, capture: async () => { throw new Error("Selection changed"); },
    }, true)).rejects.toThrow("Selection changed");
  });
  test("does not let later model/source changes rewrite an already queued instruction", async () => {
    const mutable = { ...snapshot };
    const result = await withImageSelection(draft, { key: "selection", sessionId: "s1", sourcePath: snapshot.sourcePath, capture: async () => mutable }, true);
    mutable.sourcePath = "another.png";
    mutable.model = "another-model";
    mutable.selectionBlend = "strict";
    expect(result.capability?.instruction).toContain('"selectionBlend":"natural"');
    expect(result.capability?.instruction).toContain(snapshot.sourcePath);
    expect(result.capability?.instruction).not.toContain("another");
  });
});
