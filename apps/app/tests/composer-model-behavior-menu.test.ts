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
import { resolveModelDisplayName } from "../src/app/utils";
import {
  formatContextTokenCount,
  resolveConversationContextHealth,
} from "../src/react-app/domains/session/engine/conversation-engine";
import { getModelContextWindow } from "../src/react-app/infra/provider-list-query";

const modelSelectPath = resolve(import.meta.dir, "../src/components/model-select.tsx");
const composerPath = resolve(import.meta.dir, "../src/react-app/domains/session/surface/composer/composer.tsx");
const sessionPagePath = resolve(import.meta.dir, "../src/react-app/domains/session/chat/session-page.tsx");
const menuPath = resolve(import.meta.dir, "../src/components/model-behavior-menu.tsx");
const modelPickerHookPath = resolve(import.meta.dir, "../src/react-app/domains/session/modals/use-model-picker.ts");
const modelPickerModalPath = resolve(import.meta.dir, "../src/react-app/domains/session/modals/model-picker-modal.tsx");
const sessionRoutePath = resolve(import.meta.dir, "../src/react-app/shell/session-route.tsx");

describe("Composer model and reasoning menu", () => {
  test("shows current context against the selected model window and warns before compaction", () => {
    expect(getModelContextWindow({
      all: [{
        id: "provider",
        name: "Provider",
        source: "config",
        env: [],
        models: {
          model: { id: "model", name: "Model", contextWindow: 100_000, capabilities: {} },
        },
      }],
      connected: ["provider"],
      default: { provider: "model" },
    }, { providerID: "provider", modelID: "model" })).toBe(100_000);
    expect(getModelContextWindow({
      all: [
        {
          id: "deepseek-official",
          name: "DeepSeek",
          source: "config",
          env: [],
          models: {
            "deepseek-v4-flash": {
              id: "deepseek-v4-flash",
              name: "DeepSeek V4 Flash",
              capabilities: {},
            },
          },
        },
        {
          id: "deepseek",
          name: "DeepSeek catalog",
          source: "api",
          env: [],
          models: {
            "deepseek-v4-flash": {
              id: "deepseek-v4-flash",
              name: "DeepSeek V4 Flash",
              contextWindow: 1_000_000,
              capabilities: {},
            },
          },
        },
      ],
      connected: ["deepseek-official"],
      default: {},
    }, { providerID: "deepseek-official", modelID: "deepseek-v4-flash" })).toBe(1_000_000);
    expect(getModelContextWindow({
      all: [
        {
          id: "selected",
          name: "Selected",
          source: "config",
          env: [],
          models: { shared: { id: "shared", name: "Shared", capabilities: {} } },
        },
        {
          id: "catalog-a",
          name: "Catalog A",
          source: "api",
          env: [],
          models: { shared: { id: "shared", name: "Shared", contextWindow: 128_000, capabilities: {} } },
        },
        {
          id: "catalog-b",
          name: "Catalog B",
          source: "api",
          env: [],
          models: { shared: { id: "shared", name: "Shared", contextWindow: 256_000, capabilities: {} } },
        },
      ],
      connected: ["selected"],
      default: {},
    }, { providerID: "selected", modelID: "shared" })).toBeNull();
    expect(resolveConversationContextHealth({ usedTokens: 79_499 }, 100_000)).toEqual({
      usedTokens: 79_499,
      contextWindow: 100_000,
      percentage: 79,
      compressionWarning: false,
    });
    expect(resolveConversationContextHealth({ usedTokens: 80_000 }, 100_000)).toEqual({
      usedTokens: 80_000,
      contextWindow: 100_000,
      percentage: 80,
      compressionWarning: true,
    });
    expect(formatContextTokenCount(9_100)).toBe("9.1K");
    expect(formatContextTokenCount(1_000_000)).toBe("1M");
  });

  test("keeps the selected OpenCode model name consistent with the model directory", () => {
    expect(resolveModelDisplayName("x-preview-f-free")).toBe("Ox Alpha Free");
  });

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
    expect(route).toContain("{ supportsNativeAttachments: effectiveModelSupportsAttachments }");
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
    const modal = readFileSync(modelPickerModalPath, "utf8");

    expect(source).toContain("const pickerOpen = open || compactOpen;");
    expect(source).toContain("useMergedProviderListQuery({");
    expect(source).toContain("useProviderListQuery({");
    expect(source).toContain("catalogSources.length");
    expect(source).not.toContain("force: true");
    expect(source).not.toContain("await Promise.all");
    expect(source).not.toContain("mergeProviderListResponses([data, runtimeData])");
    expect(source).toContain("projectAccountProviderConnections(data, connectedProviderIds)");
    expect(source).toContain("filterProviderList(");
    expect(source).toContain("disabledProviderIds = EMPTY_PROVIDER_IDS");
    expect(source).toContain("getChatModelCatalogEntries(accountData)");
    expect(source).not.toContain("getEngineChatModelEntries({");
    expect(source).toContain("const runtimePending = runtime === null");
    expect(source).not.toContain('const runtimeReady = runtime?.status === "ready"');
    expect(source).toContain("isConnected: true");
    expect(source).toContain("disabled: false");
    expect(source).toContain("resolveModelRuntime(");
    expect(source).not.toContain("if (opt.runtimePending) return;");
    expect(modal).not.toContain("if (opt.runtimePending) return;");
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
    expect(menu).toContain("min-w-0 max-w-72 flex-[0_1_auto]");
    expect(menu).toContain("rounded-full bg-transparent px-2 text-[12px]");
    expect(menu).toContain("hover:bg-gray-3");
    expect(model).not.toContain("Connect TokenStar");
    expect(model).not.toContain("tokenstar-connect");
    expect(model).toContain("function groupByProvider(modelOptions: ModelOption[])");
    expect(model).toContain("useMergedProviderListQuery");
    expect(model).not.toContain("await refetch()");
    expect(model).not.toContain("refreshProviderListQueries");
    expect(model).not.toContain("getEngineChatModelEntries({");
    expect(model).toContain("getChatModelCatalogEntries(catalogValue)");
    expect(model).toContain("useProviderListQuery({");
    expect(model).toContain("projectAccountProviderConnections(");
    expect(model).toContain("catalogQuery.data");
    expect(model).toContain('t("settings.loading_providers")');
    expect(model).toContain('t("model_picker.no_models_available")');
    expect(model).toContain("isConnected: true");
    expect(model).toContain("disabled: false");
    expect(model).toContain("resolveModelRuntime(");
    expect(model).toContain("runtimePending");
    expect(model).not.toContain("if (option.runtimePending) return;");
    expect(model).toContain("if (option.disabled)");
    expect(model).toContain("onConfigureModels?.(option.providerID)");
    expect(model).not.toContain('option.providerID === "tokenstar") continue');
    expect(model).not.toContain('option.modelID.startsWith("gpt-")');
    expect(model).not.toContain('option.modelID.startsWith("kimi-")');
    expect(model).not.toContain("openCodeZen.items.unshift(tokenStarEntry)");
    expect(menu).toContain("onConfigureTokenStar");
    expect(menu).toContain('className="flex min-h-0 flex-1 flex-col overflow-hidden"');
  });

  test("Composer renders engine-native modes beside the model selector", () => {
    const composer = readFileSync(composerPath, "utf8");
    const modelIndex = composer.indexOf("<ModelBehaviorMenu");
    const modeIndex = composer.indexOf("open={workModeOpen}");

    expect(modelIndex).toBeGreaterThan(-1);
    expect(modeIndex).toBeGreaterThan(modelIndex);
    expect(composer).toContain("<PopoverTrigger");
    expect(composer).toContain("rounded-full bg-transparent px-2 text-[12px]");
    expect(composer).toContain("max-w-32 shrink-0");
    expect(composer).toContain('<span className="truncate">{activeWorkMode.label}</span>');
    expect(composer).toContain("hover:bg-gray-3");
    expect(composer).toContain("props.listModes()")
    expect(composer).toContain("workModes.map((mode)");
    expect(composer).toContain("data-work-mode-option={mode.id}");
    expect(composer).toContain("onClick={() => selectWorkMode(mode.id)}");
    expect(composer).toContain("if (props.busy || props.modeSelectionDisabled) return;");
    expect(composer).toContain("if (props.busy || props.modeSelectionDisabled) setWorkModeOpen(false);");
    expect(composer).toContain("disabled={props.busy || props.modeSelectionDisabled}");
    expect(composer.match(/"bg-gray-2 text-gray-10"/g)).toHaveLength(2);
    expect(composer).not.toContain("dark:bg-white/15");
    expect(composer).toContain("<ChevronDown");
    expect(composer).toContain("<WorkModeIcon");
    expect(composer).toContain("mode.description");
  });

  test("Composer renders the engine access selector immediately after the model selector", () => {
    const composer = readFileSync(composerPath, "utf8");
    const modelIndex = composer.indexOf("<ModelBehaviorMenu");
    const accessIndex = composer.indexOf("open={accessModeOpen}");
    const modeIndex = composer.indexOf("open={workModeOpen}");

    expect(modelIndex).toBeGreaterThan(-1);
    expect(accessIndex).toBeGreaterThan(modelIndex);
    expect(modeIndex).toBeGreaterThan(accessIndex);
    expect(composer).toContain("props.listAccessModes()");
    expect(composer).toContain("data-access-mode-option={mode.id}");
    expect(composer).toContain("pendingDangerousAccessMode");
    expect(composer).toContain("access_mode_full_access_confirm_title");
  });

  test("new-task composer carries its engine permission preset into the created session", () => {
    const sessionPage = readFileSync(sessionPagePath, "utf8");
    const sessionRoute = readFileSync(sessionRoutePath, "utf8");

    expect(sessionPage).toContain("listStarterAccessModes");
    expect(sessionPage).toContain("selectedAccessMode={starterAccessMode}");
    expect(sessionPage).toContain("...(starterAccessMode ? { accessMode: starterAccessMode } : {})");
    expect(sessionRoute).toContain("pending.draft.accessMode && surfaceProps.conversation.setAccessMode");
    expect(sessionRoute.indexOf("await surfaceProps.conversation.setAccessMode")).toBeLessThan(
      sessionRoute.indexOf("return surfaceProps.onSendDraft", sessionRoute.indexOf("await surfaceProps.conversation.setAccessMode")),
    );
  });

  test("derives model behavior catalog without an effect-driven render loop", () => {
    const source = readFileSync(
      new URL("../src/react-app/domains/session/surface/use-model-behavior.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("const providerCatalog = useMemo<ProviderCatalog>");
    expect(source).not.toContain("setProviderCatalog");
    expect(source).not.toContain("useEffect");
  });
});
