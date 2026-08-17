import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  modelSupportsAttachments,
  type ProviderCatalog,
} from "../src/react-app/domains/session/surface/use-model-behavior";
import { attachmentRequiresNativeModelSupport } from "../src/react-app/domains/session/sync/attachment-support";
import { draftToParts } from "../src/react-app/shell/session-prompt";
import type { ComposerDraft } from "../src/app/types";

const modelSelectPath = resolve(import.meta.dir, "../src/components/model-select.tsx");
const composerPath = resolve(import.meta.dir, "../src/react-app/domains/session/surface/composer/composer.tsx");
const menuPath = resolve(import.meta.dir, "../src/react-app/domains/session/surface/composer/model-behavior-menu.tsx");
const modelPickerHookPath = resolve(import.meta.dir, "../src/react-app/domains/session/modals/use-model-picker.ts");
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

  test("keeps file attachment available while guarding native media at the send boundary", () => {
    const route = readFileSync(sessionRoutePath, "utf8");
    const composer = readFileSync(composerPath, "utf8");

    expect(route).toContain("supportsNativeAttachments: selectedModelSupportsAttachments");
    expect(route).toContain("attachmentRequiresNativeModelSupport(attachment.mimeType)");
    expect(route).toContain("{ supportsNativeAttachments: selectedModelSupportsAttachments }");
    expect(route).toContain('t("composer.attachments_require_multimodal")');
    expect(composer).not.toContain("attachmentsEnabled");
  });

  test("uses text fallback for ordinary files on text-only models", async () => {
    const attachment = new File(["export const answer = 42;"], "answer.ts", { type: "text/plain" });
    const draft: ComposerDraft = {
      mode: "prompt",
      text: "Review this file",
      parts: [{ type: "text", text: "Review this file" }],
      attachments: [{
        id: "attachment-1",
        name: attachment.name,
        mimeType: attachment.type,
        size: attachment.size,
        kind: "file",
        file: attachment,
      }],
    };

    const parts = await draftToParts(draft, "", undefined, undefined, { supportsNativeAttachments: false });

    expect(parts).toEqual([
      { type: "text", text: "Review this file" },
      {
        type: "text",
        text: "Attached file: answer.ts\n\nexport const answer = 42;",
        synthetic: true,
      },
    ]);
  });

  test("requires native model support only for images and PDFs", () => {
    expect(attachmentRequiresNativeModelSupport("image/png")).toBe(true);
    expect(attachmentRequiresNativeModelSupport("application/pdf")).toBe(true);
    expect(attachmentRequiresNativeModelSupport("text/plain")).toBe(false);
    expect(attachmentRequiresNativeModelSupport("application/json")).toBe(false);
  });

  test("exports reusable Composer model-list content", () => {
    const source = readFileSync(modelSelectPath, "utf8");

    expect(source).toContain("export function ModelListContent");
    expect(source).toContain("onChange: (model: ModelRef) => void");
  });

  test("loads model options when the compact Composer picker opens", () => {
    const source = readFileSync(modelPickerHookPath, "utf8");

    expect(source).toContain("if ((!open && !compactOpen) || !client) return;");
    expect(source).toContain("ensureMergedProviderListQuery");
    expect(source).toContain("catalogSources.length ? catalogSources : [activeSource]");
    expect(source).toContain("disabled: !isModelAvailableInConnectedProviders");
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
    expect(model).toContain("includeTokenStar &&");
    expect(model).toContain("ensureMergedProviderListQuery");
    expect(model).toContain("getSelectableChatProviderItems(catalog ?? data)");
    expect(model).toContain("disabled={option.disabled}");
    expect(model).not.toContain('option.providerID === "tokenstar") continue');
    expect(model).not.toContain('option.modelID.startsWith("gpt-")');
    expect(model).not.toContain('option.modelID.startsWith("kimi-")');
    expect(model).not.toContain("openCodeZen.items.unshift(tokenStarEntry)");
    expect(menu).toContain("onConfigureTokenStar");
  });

  test("Composer renders engine-native modes beside the model selector", () => {
    const composer = readFileSync(composerPath, "utf8");
    const modelIndex = composer.indexOf("<ModelBehaviorMenu");
    const modeIndex = composer.indexOf("open={workModeOpen}");

    expect(modelIndex).toBeGreaterThan(-1);
    expect(modeIndex).toBeGreaterThan(modelIndex);
    expect(composer).toContain("<PopoverTrigger");
    expect(composer).toContain("rounded-full bg-gray-3 px-3 py-1.5 text-sm");
    expect(composer).toContain("props.listModes()")
    expect(composer).toContain("workModes.map((mode)");
    expect(composer).toContain("data-work-mode-option={mode.id}");
    expect(composer).toContain("onClick={() => selectWorkMode(mode.id)}");
    expect(composer).toContain("if (props.busy || props.modeSelectionDisabled) return;");
    expect(composer).toContain("if (props.busy || props.modeSelectionDisabled) setWorkModeOpen(false);");
    expect(composer).toContain("disabled={props.busy || props.modeSelectionDisabled}");
    expect(composer).toContain("<ChevronDown");
    expect(composer).toContain("<WorkModeIcon");
    expect(composer).toContain("mode.description");
  });
});
