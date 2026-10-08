import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { templateCategorySchema, type TemplateManifestV1, type TemplateSessionSnapshot } from "@ipollowork/types/templates";

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
  test.each(templateCategorySchema.options)("routes %s authoring to its installed type rules", (category) => {
    const context = templateAuthoringSystemContext(snapshot({ ...manifest, category, surface: category === "video" ? "video" : "design" }));
    if (category === "slides") {
      expect(context).toContain("follow ipollowork-presentations for the current task");
      expect(context).toContain("read only applicable references");
      expect(context).not.toContain("shared-guidelines.md, slides-ppt.md and layout.md");
      expect(context).not.toContain("design-slides.md");
    } else if (category === "video") {
      expect(context).toContain("active Video surface contract");
      expect(context).toContain("Read ipollowork-video-studio once");
      expect(context).toContain("references relative to the installed Skill");
      expect(context).toContain("copied template guides and catalogs only from exact paths inside the active project");
      expect(context).not.toContain("Read references/video.md only when");
      expect(context).toContain("Reuse unchanged guidance and completed checks");
      expect(context).toContain("do not search for missing template files");
      expect(context).not.toContain("design-video.md");
    } else {
      expect(context).toContain(`Follow ipollowork-design-studio for this ${category} task`);
      expect(context).toContain("read only affected references relative to the installed Skill");
      expect(context).not.toContain("references/shared-guidelines.md");
      if (category === "poster" || category === "cards") expect(context).toContain("scale fixed-canvas previews without reflowing");
    }
  });

  test("keeps the application-selected type while delegating reusable authoring to its plugin", () => {
    const pptManifest = { ...manifest, id: "ipollowork.authoring.pptx", pptxCompatibility: "native-editable" as const };
    const context = templateAuthoringSystemContext(snapshot(pptManifest), "Selected system rules");
    expect(templateAuthoringKickoff("slides", "native-editable").text).toBe("创建一个原生可编辑 PPT模板");
    expect(context).toContain("Do not guess or convert its category or surface");
    expect(context).toContain("reusable-template authoring section of shared-guidelines.md");
    expect(context).toContain("installed ipollowork-presentations Skill");
    expect(context).not.toContain("1. purpose and audience");
    const guide = readFileSync(new URL("../../../examples/plugin-packages/design-agent/skills/ipollowork-presentations/references/shared-guidelines.md", import.meta.url), "utf8");
    expect(guide).toContain("Reusable-template authoring only");
    expect(guide).toContain("Ordinary artifact creation, applying a template, script-only work and targeted edits keep their requested scope");
    expect(guide).toContain("one critical question at a time");
    expect(guide).toContain('`authoringGuide: "authoring.md"`');
    expect(context).toContain("--ipw-color-primary (color)");
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

  test("keeps session authoring and validation while removing creation from the template market", () => {
    const market = readFileSync(new URL("../src/react-app/domains/session/templates/template-market-dialog.tsx", import.meta.url), "utf8");
    const route = readFileSync(new URL("../src/react-app/shell/session-route.tsx", import.meta.url), "utf8");
    const page = readFileSync(new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url), "utf8");
    const design = readFileSync(new URL("../src/react-app/domains/session/design/design-panel.tsx", import.meta.url), "utf8");
    const video = readFileSync(new URL("../src/react-app/domains/session/video/video-panel.tsx", import.meta.url), "utf8");

    expect(market).not.toContain("AUTHORING_TYPES");
    expect(market).not.toContain("props.canCreate");
    expect(market).not.toContain("props.onCreate");
    expect(route).toContain("createTemplateAuthoringSession");
    expect(route).toContain("templateAuthoringKickoff");
    expect(route).toContain("synthetic: true");
    expect(route).toContain("templateAuthoringSystemContext");
    expect(route).toContain("loadDesignSystemAuthoringGuide");
    expect(page).toContain("validateTemplateFromSession");
    expect(page).toContain("hasTemplateSession && props.selectedWorkspaceDisplay.workspaceType === \"local\"");
    expect(page).toContain("repairCurrentTemplate");
    expect(design).toContain("onSaveAsTemplate={onSaveAsTemplate}");
    expect(video).toContain("saveAsTemplate: Boolean(onSaveAsTemplate)");
    expect(video).toContain('event.data.action === "save-as-template"');
  });
});
