import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  IPOLLOWORK_PACKAGE_MEDIA_TYPE,
  LEGACY_TEMPLATE_PACKAGE_MEDIA_TYPE,
  TEMPLATE_PACKAGE_FILE_ACCEPT,
  templatePackageMediaTypeForFilename,
} from "@ipollowork/types/templates";
import { createiPolloWorkServerClient } from "../src/app/lib/ipollowork-server";

const marketDialog = readFileSync(
  new URL("../src/react-app/domains/session/templates/template-market-dialog.tsx", import.meta.url),
  "utf8",
);
const saveDialog = readFileSync(
  new URL("../src/react-app/domains/session/templates/template-save-dialog.tsx", import.meta.url),
  "utf8",
);
const sessionPage = readFileSync(
  new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
  "utf8",
);
const desktopMain = readFileSync(
  new URL("../../desktop/electron/main.mjs", import.meta.url),
  "utf8",
);

describe("template market actions", () => {
  test("keeps package import but removes create and save-current controls", () => {
    expect(marketDialog).toContain('t("template_market.import")');
    expect(marketDialog).toContain('t("template_market.import_tooltip")');
    expect(marketDialog).toContain("accept={TEMPLATE_PACKAGE_FILE_ACCEPT}");
    expect(marketDialog).not.toContain('t("template_authoring.create")');
    expect(marketDialog).not.toContain("onCreate:");
    expect(marketDialog).not.toContain('t("template_market.save_current")');
    expect(marketDialog).not.toContain("onSaveCurrent");
    expect(marketDialog).not.toContain("canSaveCurrent");
  });

  test("treats .ipwp as canonical while preserving the .ipwt import contract", () => {
    expect(TEMPLATE_PACKAGE_FILE_ACCEPT).toBe(".ipwp,.ipwt");
    expect(templatePackageMediaTypeForFilename("new-template.ipwp")).toBe(IPOLLOWORK_PACKAGE_MEDIA_TYPE);
    expect(templatePackageMediaTypeForFilename("legacy-template.IPWT")).toBe(LEGACY_TEMPLATE_PACKAGE_MEDIA_TYPE);
  });

  test("exports canonical packages through the authenticated binary route", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";
    let requestedScope = "";
    globalThis.fetch = async (input, init) => {
      requestedUrl = String(input);
      requestedScope = new Headers(init?.headers).get("x-ipollowork-resource-scope") ?? "";
      return new Response(new Uint8Array([80, 75]), {
        headers: {
          "Content-Disposition": "attachment; filename=personal-video-1.0.0.ipwp",
          "Content-Type": IPOLLOWORK_PACKAGE_MEDIA_TYPE,
        },
      });
    };

    try {
      const client = createiPolloWorkServerClient({ baseUrl: "https://worker.example", token: "client-token" });
      const exported = await client.exportTemplatePackage("workspace one", "personal.video", "personal");
      expect(requestedUrl).toBe("https://worker.example/workspace/workspace%20one/templates/personal.video/package");
      expect(requestedScope).toBe("personal");
      expect(exported.filename).toBe("personal-video-1.0.0.ipwp");
      expect(exported.contentType).toBe(IPOLLOWORK_PACKAGE_MEDIA_TYPE);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("exports the current session without calling the personal-template save route", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";
    let requestedMethod = "";
    let requestedBody = "";
    globalThis.fetch = async (input, init) => {
      requestedUrl = String(input);
      requestedMethod = init?.method ?? "GET";
      requestedBody = typeof init?.body === "string" ? init.body : "";
      return new Response(new Uint8Array([80, 75]), {
        headers: {
          "Content-Disposition": "attachment; filename=personal-video-1.0.0.ipwp",
          "Content-Type": IPOLLOWORK_PACKAGE_MEDIA_TYPE,
        },
      });
    };

    try {
      const client = createiPolloWorkServerClient({ baseUrl: "https://worker.example", token: "client-token" });
      await client.exportTemplateFromSession("workspace one", {
        sessionId: "video-session",
        category: "video",
        title: "Personal video",
      });
      expect(requestedUrl).toBe("https://worker.example/workspace/workspace%20one/templates/from-session/package");
      expect(requestedMethod).toBe("POST");
      expect(JSON.parse(requestedBody)).toEqual({ sessionId: "video-session", category: "video", title: "Personal video" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("keeps template cards focused on source, style, use, and favorites", () => {
    expect(marketDialog).toContain("FAVORITE_TEMPLATE_IDS_STORAGE_KEY");
    expect(marketDialog).toContain("writeFavoriteTemplateIds(next)");
    expect(marketDialog).toContain("templateFormatLabel(template)");
    expect(marketDialog).toContain("favorite && \"fill-current\"");
    expect(marketDialog).not.toContain("onExport:");
    expect(marketDialog).not.toContain("onUninstall:");
    expect(marketDialog).not.toContain('t("template_market.preview")');
  });

  test("keeps the template dialog stationary, resizable, and above its popup controls", () => {
    expect(marketDialog).not.toContain("template-market-drag-region");
    expect(marketDialog).not.toContain("setPointerCapture");
    expect(marketDialog).not.toContain("setDialogPosition");
    expect(marketDialog).not.toContain("electron:titlebar-drag");
    expect(marketDialog).toContain("<DialogContent showCloseButton className=");
    expect(marketDialog).toContain("max-h-[calc(100dvh-32px)] max-w-[calc(100dvw-32px)] resize");
    expect(marketDialog).toContain("[&>[data-slot=dialog-close]]:top-[29px]");
    expect(marketDialog).toContain('className="mt-4 w-full shrink-0 px-6"');
    expect(marketDialog).toContain('className="relative mt-4 w-full"');
    expect(marketDialog).toContain('className="mt-3 flex h-9 items-center gap-4 overflow-x-auto"');
    expect(marketDialog).toContain('className="mt-3 min-h-0 w-full flex-1 overflow-y-auto px-6 pb-6"');
    expect(marketDialog).not.toContain("showCloseButton={false}");
    expect(marketDialog.match(/positionerClassName="z-\[90\]"/g)).toHaveLength(6);
  });

  test("matches the Figma three-column template card layout", () => {
    expect(marketDialog.match(/grid grid-cols-3 gap-4 max-\[800px\]:grid-cols-2 max-\[540px\]:grid-cols-1/g)).toHaveLength(3);
    expect(marketDialog).toContain('border-2 border-transparent bg-muted/50 pb-4 transition-colors duration-150 hover:border-[var(--project-dialog-accent)]');
    expect(marketDialog).toContain('className="relative block h-[137px] w-full shrink-0');
    expect(marketDialog).toContain('t("template_market.favorite")');
    expect(marketDialog).toContain('category === id ? "bg-foreground text-background" : "text-foreground hover:bg-muted"');
    expect(marketDialog).toContain('t("template_market.all_types")');
    expect(marketDialog).toContain("items-center justify-center gap-1.5 whitespace-nowrap");
    expect(marketDialog).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(marketDialog).not.toContain("rgba(");
    expect(marketDialog).not.toContain("widthClass");
    expect(marketDialog).not.toContain("max-w-[763px]");
    expect(marketDialog).not.toContain("w-[calc(100%-48px)]");
    expect(marketDialog.match(/w-full[^\"]*px-6/g)).toHaveLength(3);
    expect(marketDialog).not.toContain("ml-[57px]");
    expect(marketDialog).toContain('t("template_market.type_label")');
    expect(marketDialog).toContain("bg-transparent px-4 font-['PingFang_SC',sans-serif]");
    expect(marketDialog).toContain('className="ml-auto flex shrink-0 items-center gap-2"');
    expect(marketDialog).not.toContain('view === "my" ? "mt-4" : "mt-5"');
  });

  test("reuses the HTML cover and preview flow for installed enterprise templates", () => {
    expect(marketDialog).toContain("if (installedTemplate) {");
    expect(marketDialog).toContain("<TemplateCard template={installedTemplate} getCover={getCover}");
    expect(marketDialog).toContain("onPreview={(template) => setPreviewSelection({ template, enterpriseResourceId: resource.id })}");
    expect(marketDialog).toContain("previewEnterpriseResource.latestVersion.version === previewTemplate?.installedVersion");
    expect(marketDialog).toContain("props.onInstallEnterprise(enterpriseResource)");
  });

  test("keeps preview metadata separated from long descriptions and cover edges", () => {
    expect(marketDialog).toContain('className="relative z-10 flex flex-col gap-5 border-t border-border bg-popover px-6 pb-5 pt-8 sm:flex-row sm:items-end sm:justify-between"');
    expect(marketDialog).toContain('className="min-w-0 flex-1"');
    expect(marketDialog).toContain('className="flex min-h-7 flex-wrap items-center gap-2"');
    expect(marketDialog).toContain('className="mt-2 line-clamp-2 max-w-2xl text-xs leading-5"');
    expect(marketDialog).toContain('className="flex shrink-0 items-center gap-2"');
    expect(sessionPage).toContain('className="relative z-10 flex flex-col gap-5 border-t border-dls-border bg-dls-surface px-6 pb-5 pt-8 sm:flex-row sm:items-end sm:justify-between"');
    expect(sessionPage).toContain('className="flex min-h-7 items-center"');
    expect(sessionPage).toContain('className="mt-2 line-clamp-2 max-w-2xl text-xs leading-5"');
    expect(sessionPage).not.toContain("border-t border-dls-border px-6 py-5");
  });

  test("offers typed save and export actions through one dialog", () => {
    expect(saveDialog).toContain('export type TemplateSaveMode = "save" | "export"');
    expect(saveDialog).toContain('mode: "save"');
    expect(saveDialog).toContain('mode: "export"');
    expect(saveDialog).toContain('t("template_authoring.export")');
    expect(sessionPage).toContain('if (input.mode === "export")');
    expect(sessionPage).toContain("exportTemplateFromSession(props.runtimeWorkspaceId, templateRequest)");
    expect(sessionPage).toContain("return saveFile({");
    expect(sessionPage).toContain("}, packageFile.data)");
    expect(sessionPage).not.toContain("downloadBlobAsFile(packageFile.filename");
    expect(sessionPage).not.toContain('input.mode === "save-and-export"');
    expect(sessionPage).not.toContain('t("template_authoring.saved_and_exported")');
    expect(sessionPage).not.toContain('t("template_authoring.saved_export_failed")');
    expect(saveDialog).not.toContain("categoryLabel");
    expect(saveDialog).not.toContain('t("template_authoring.ready")');
    expect(saveDialog).toContain('className="mx-0 mb-0 mt-4 flex-wrap border-t border-border px-6 py-5"');
  });

  test("writes exported package bytes after the native save dialog resolves", () => {
    expect(desktopMain).toContain("dialog.showSaveDialog(activeWindowFromEvent(event)");
    expect(desktopMain).toContain("await writeFile(filePath, new Uint8Array(data))");
    expect(desktopMain).toContain("ArrayBuffer.isView(data)");
  });

  test("clears a selected package only after a successful install", () => {
    expect(marketDialog).toContain("if (await props.onImport(pendingImport)) setPendingImport(null)");
    expect(sessionPage).toContain("if (await onImport(pendingImport, serverCategory)) setPendingImport(null)");
  });

  test("surfaces reference warnings and template brief submission failures", () => {
    expect(sessionPage).toContain("reference.ingestion?.warnings[0]");
    expect(sessionPage).toContain('t("templates.brief.submit_failed")');
    expect(sessionPage).toContain("sentOriginal: reference.sendOriginal && canSendOriginalReference(reference.file)");
  });
});
