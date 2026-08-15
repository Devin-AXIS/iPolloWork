import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { TemplateManifestV1, TemplateSessionSnapshot } from "@ipollowork/types/templates";

import { templateAuthoringKickoff, templateAuthoringSystemContext } from "../src/react-app/domains/session/templates/template-authoring";

const manifest: TemplateManifestV1 = {
  schemaVersion: 1,
  id: "ipollowork.authoring.slides",
  version: "1.0.0",
  kind: "design",
  category: "slides",
  subcategory: "authoring",
  style: "minimal",
  tags: ["authoring"],
  surface: "design",
  title: "Presentation template draft",
  description: "A presentation template draft.",
  cover: "cover.svg",
  entry: "entry.html",
  source: { name: "iPolloWork template authoring", license: "Private" },
  designSystem: {
    tokenVersion: 1,
    tokens: "design-tokens.css",
    editableGroups: ["theme", "background", "typography", "components"],
    variables: [{ id: "--ipw-color-primary", label: "Primary", type: "color", group: "theme" }],
  },
  applyChecklist: ["Keep slide roots stable."],
  minimumAppVersion: "0.18.0",
};

function snapshot(nextManifest: TemplateManifestV1 = manifest, authoring = true): TemplateSessionSnapshot {
  return {
    sessionId: "ses_authoring",
    surface: nextManifest.surface,
    authoring,
    state: {
      schemaVersion: 1,
      template: { id: nextManifest.id, version: nextManifest.version, sourceType: "local" },
      entry: `${nextManifest.surface === "video" ? "video" : "design"}/ses_authoring/${nextManifest.entry}`,
      briefPath: `${nextManifest.surface === "video" ? "video" : "design"}/ses_authoring/brief.json`,
      createdAt: 1,
    },
    manifest: nextManifest,
  };
}

describe("template authoring", () => {
  test("keeps the application-selected type and asks one ordered question at a time", () => {
    const pptManifest = { ...manifest, id: "ipollowork.authoring.pptx", pptxCompatibility: "native-editable" as const };
    const context = templateAuthoringSystemContext(snapshot(pptManifest), "Selected system rules");
    expect(templateAuthoringKickoff("slides", "native-editable").text).toBe("创建一个原生可编辑 PPT模板");
    expect(context).toContain("Do not guess or convert its category or surface");
    expect(context).toContain("one critical question at a time");
    expect(context).toContain("1. purpose and audience");
    expect(context).toContain("3. reusable variables");
    expect(context).toContain("data-pptx-text");
    expect(context).toContain("Selected system rules");
    expect(templateAuthoringSystemContext(snapshot(pptManifest, false))).toBeNull();
  });

  test("injects deterministic HyperFrames rules only for Video authoring", () => {
    const videoManifest: TemplateManifestV1 = {
      ...manifest,
      id: "ipollowork.authoring.video",
      category: "video",
      subcategory: "authoring",
      surface: "video",
      title: "Video template draft",
      description: "A video template draft.",
      entry: "index.html",
      designSystem: {
        ...manifest.designSystem,
        variables: [{ id: "title", label: "Title", type: "text", group: "content" }],
      },
    };
    const context = templateAuthoringSystemContext(snapshot(videoManifest));
    expect(context).toContain("one HyperFrames composition");
    expect(context).toContain("data-composition-variables");
    expect(context).toContain("seek-safe and deterministic");
  });

  test("wires personal-only creation, automatic kickoff, validation, and both save menus", () => {
    const market = readFileSync(new URL("../src/react-app/domains/session/templates/template-market-dialog.tsx", import.meta.url), "utf8");
    const route = readFileSync(new URL("../src/react-app/shell/session-route.tsx", import.meta.url), "utf8");
    const page = readFileSync(new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url), "utf8");
    const design = readFileSync(new URL("../src/react-app/domains/session/design/design-panel.tsx", import.meta.url), "utf8");
    const video = readFileSync(new URL("../src/react-app/domains/session/video/video-panel.tsx", import.meta.url), "utf8");

    expect(market).toContain("AUTHORING_TYPES");
    expect(market).toContain('pptxCompatibility: "native-editable"');
    expect(market).toContain("!enterpriseMode && props.canCreate");
    expect(route).toContain("createTemplateAuthoringSession");
    expect(route).toContain("templateAuthoringKickoff");
    expect(route).toContain("synthetic: true");
    expect(route).toContain("templateAuthoringSystemContext");
    expect(route).toContain("loadDesignSystemAuthoringGuide");
    expect(page).toContain("validateTemplateFromSession");
    expect(page).toContain("hasTemplateSession && props.selectedWorkspaceDisplay.workspaceType === \"local\"");
    expect(page).toContain("repairCurrentTemplate");
    expect(page).toContain('manifest.id.startsWith("personal.")');
    expect(design).toContain("onSaveAsTemplate={onSaveAsTemplate}");
    expect(video).toContain("saveAsTemplate: Boolean(onSaveAsTemplate)");
    expect(video).toContain('event.data.action === "save-as-template"');
  });
});
