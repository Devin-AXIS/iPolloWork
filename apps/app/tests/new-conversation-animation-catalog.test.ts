import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const starter = readFileSync(resolve(root, "src/components/chat/new-conversation-starter.tsx"), "utf8");
const surface = readFileSync(resolve(root, "src/react-app/domains/session/surface/session-surface.tsx"), "utf8");

describe("new conversation animation catalog", () => {
  test("keeps video template code but hides its picker", () => {
    expect(starter).toContain("const VIDEO_TEMPLATE_PICKER_ENABLED = false");
    expect(starter).toContain('selectedMode === "video" && VIDEO_TEMPLATE_PICKER_ENABLED');
    expect(starter).toContain("function TemplateStrip");
  });

  test("supports multi-select animation references", () => {
    expect(starter).toContain("function AnimationCatalogStrip");
    expect(starter).toContain("selectedNames.has(item.name)");
    expect(surface).toContain("selectedAnimations.map");
    expect(surface).toContain("animationSelectionInstruction(selectedAnimations)");
    expect(surface).toContain("registry: ${item.name}");
  });

  test("surfaces recent-selection and error copy", () => {
    expect(starter).toContain("RECENT_ANIMATION_STORAGE_KEY");
    expect(starter).toContain('new_conversation.animations.recent');
    expect(starter).toContain('new_conversation.animations.empty_catalog_title');
    expect(starter).toContain('new_conversation.animations.error_title');
    expect(starter).toContain('shrink-0 rounded-full px-2 py-1 text-[11px] font-medium');
  });
});
