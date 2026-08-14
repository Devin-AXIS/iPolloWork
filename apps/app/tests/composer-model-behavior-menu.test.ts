import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  modelSupportsAttachments,
  type ProviderCatalog,
} from "../src/react-app/domains/session/surface/use-model-behavior";

const modelSelectPath = resolve(import.meta.dir, "../src/components/model-select.tsx");
const composerPath = resolve(import.meta.dir, "../src/react-app/domains/session/surface/composer/composer.tsx");
const menuPath = resolve(import.meta.dir, "../src/react-app/domains/session/surface/composer/model-behavior-menu.tsx");
const sessionRoutePath = resolve(import.meta.dir, "../src/react-app/shell/session-route.tsx");

describe("Composer model and reasoning menu", () => {
  test("only enables attachments for models that declare attachment support", () => {
    const catalog = {
      provider: {
        multimodal: { capabilities: { attachment: true } },
        textOnly: { capabilities: { attachment: false } },
      },
    } as unknown as ProviderCatalog;

    expect(modelSupportsAttachments(catalog, { providerID: "provider", modelID: "multimodal" })).toBe(true);
    expect(modelSupportsAttachments(catalog, { providerID: "provider", modelID: "textOnly" })).toBe(false);
    expect(modelSupportsAttachments(catalog, { providerID: "provider", modelID: "missing" })).toBe(false);
    expect(modelSupportsAttachments(catalog, null)).toBe(false);
  });

  test("uses the selected model capability for both the attachment entry and send boundary", () => {
    const route = readFileSync(sessionRoutePath, "utf8");

    expect(route).toContain("attachmentsEnabled: selectedModelSupportsAttachments");
    expect(route).toContain("draft.attachments.length > 0 && !selectedModelSupportsAttachments");
    expect(route).toContain('t("composer.attachments_require_multimodal")');
  });

  test("exports reusable Composer model-list content", () => {
    const source = readFileSync(modelSelectPath, "utf8");

    expect(source).toContain("export function ModelListContent");
    expect(source).toContain("onChange: (model: ModelRef) => void");
  });

  test("Composer uses one combined model and reasoning menu", () => {
    const composer = readFileSync(composerPath, "utf8");
    const menu = readFileSync(menuPath, "utf8");
    const model = readFileSync(modelSelectPath, "utf8");

    expect(composer).toContain("<ModelBehaviorMenu");
    expect(composer).not.toContain("<ModelSelect");
    expect(composer).not.toContain("<ModelBehaviorSelect");
    expect(menu).toContain('type MenuView = "root" | "model" | "behavior"');
    expect(menu).toContain("modelVariantLabel");
    expect(menu).toContain("onModelVariantChange");
    expect(model).toContain('kind: "tokenstar-connect"');
    expect(model).toContain("Connect TokenStar");
    expect(model).toContain('grouped.push({ value: "TokenStar", items: [tokenStarEntry] })');
    expect(model).not.toContain('option.providerID === "tokenstar") continue');
    expect(model).not.toContain('option.modelID.startsWith("gpt-")');
    expect(model).not.toContain('option.modelID.startsWith("kimi-")');
    expect(model).not.toContain("openCodeZen.items.unshift(tokenStarEntry)");
    expect(menu).toContain("onConfigureTokenStar");
  });

  test("Composer keeps execute and plan in a model-style selector", () => {
    const composer = readFileSync(composerPath, "utf8");
    const modelIndex = composer.indexOf("<ModelBehaviorMenu");
    const modeIndex = composer.indexOf("open={workModeOpen}");

    expect(modelIndex).toBeGreaterThan(-1);
    expect(modeIndex).toBeGreaterThan(modelIndex);
    expect(composer).toContain("<PopoverTrigger");
    expect(composer).toContain("rounded-full bg-gray-3 px-3 py-1.5 text-sm");
    expect(composer).toContain('data-work-mode-option="execute"');
    expect(composer).toContain('data-work-mode-option="plan"');
    expect(composer).toContain('onClick={() => selectWorkMode("build")}');
    expect(composer).toContain('onClick={() => selectWorkMode("plan")}');
    expect(composer).toContain("<ChevronDown");
    expect(composer).toContain("<ListTodo");
    expect(composer).toContain('t("composer.work_mode_execute")');
    expect(composer).toContain('t("composer.work_mode_plan")');
  });
});
