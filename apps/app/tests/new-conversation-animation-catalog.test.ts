import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const starter = readFileSync(resolve(root, "src/components/chat/new-conversation-starter.tsx"), "utf8");
const surface = readFileSync(resolve(root, "src/react-app/domains/session/surface/session-surface.tsx"), "utf8");

describe("new conversation animation catalog", () => {
  test("restores the video template picker and hides the animation catalog", () => {
    expect(starter).toContain("const VIDEO_TEMPLATE_PICKER_ENABLED = true");
    expect(starter).toContain("const VIDEO_ANIMATION_PICKER_ENABLED = false");
    expect(starter).toContain('selectedMode === "video" && VIDEO_TEMPLATE_PICKER_ENABLED');
    expect(starter).toContain('selectedMode === "video" && VIDEO_ANIMATION_PICKER_ENABLED');
    expect(starter).toContain('mode === "video" && VIDEO_TEMPLATE_PICKER_ENABLED');
    expect(surface).toContain("if (!VIDEO_ANIMATION_PICKER_ENABLED");
    expect(starter).toContain("function TemplateStrip");
  });

  test("gives the video template empty state a recovery action", () => {
    expect(starter).toContain('new_conversation.templates.video_empty_hint');
    expect(starter).toContain('new_conversation.templates.retry');
    expect(starter).toContain("onRequestTemplates?: () => void");
    expect(starter).toContain('category === "video"');
    expect(starter).toContain("onClick={onRequestTemplates}");
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

  test("edits validated effect variables and sends structured configuration", () => {
    expect(starter).toContain("function AnimationParameterDialog");
    expect(starter).toContain("updateHyperframesEffectVariableOverride");
    expect(starter).toContain("new_conversation.animations.update_${lastUpdate}");
    expect(surface).toContain("hyperframesSelectionPayload(selection)");
    expect(surface).toContain("data-variable-values/getVariables");
  });

  test("routes template launches through the current session materializer first", () => {
    expect(surface).toContain("onMaterializeTemplate?: (templateId: string, surface: \"design\" | \"video\") => void | Promise<void>");
    expect(surface).toContain("onUseTemplate={props.onMaterializeTemplate ? (templateId, surface) => void props.onMaterializeTemplate?.(templateId, surface) : props.onCreateSession ?");
    expect(surface).toContain("props.onCreateSession?.(surface === \"video\" ? \"video\" : \"design\", templateId)");
  });
});
