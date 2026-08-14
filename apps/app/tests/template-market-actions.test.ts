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
  test("keeps package import but hides save-current controls", () => {
    expect(marketDialog).toContain('t("template_market.import_package")');
    expect(marketDialog).toContain("accept={TEMPLATE_PACKAGE_FILE_ACCEPT}");
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

  test("shows export only for local templates in the personal catalog", () => {
    expect(marketDialog).toContain('onExport={template.sourceType === "local" ? () => props.onExport(template) : undefined}');
    expect(marketDialog).toContain('template.sourceType === "local" && onExport');
    expect(marketDialog.match(/onExport=\{/g)?.length).toBe(1);
    expect(marketDialog).toContain('t("template_market.export_package")');
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

  test("keeps the template brief open unless its startup draft is accepted", () => {
    expect(sessionPage).toContain("const dispatched = await props.surface.onSendDraft({");
    expect(sessionPage).toContain("if (!dispatched) return;");
    expect(sessionPage.indexOf("const dispatched = await props.surface.onSendDraft({")).toBeLessThan(
      sessionPage.indexOf("setTemplateSessionData((current) => current?.sessionId === props.selectedSessionId ? { ...current, hasBrief: true } : current);"),
    );
  });

  test("recovers materialized template sessions when the startup draft is missing", () => {
    expect(sessionPage).toContain("const templateBriefRecoveryRef = useRef<string | null>(null)");
    expect(sessionPage).toContain("if (!hasTemplateBrief) return;");
    expect(sessionPage).toContain("if (settledSessionId !== props.selectedSessionId) return;");
    expect(sessionPage).toContain("if (conversationMessages.length > 0) return;");
    expect(sessionPage).toContain("templateBriefRecoveryRef.current = recoveryKey;");
    expect(sessionPage).toContain("templateBriefRecoveryRef.current = null;");
    expect(sessionPage).toContain("const dispatched = await props.surface.onSendDraft({");
  });
});
