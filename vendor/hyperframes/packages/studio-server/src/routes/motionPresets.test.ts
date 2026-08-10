import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readMotionInstanceFromExtras } from "@hyperframes/core/motion-presets";
import type { StudioApiAdapter } from "../types";
import { registerFileRoutes } from "./files";

const SOURCE = `<!doctype html>
<html><body>
  <h1 id="headline" data-start="1" data-duration="5">你好 mixed AI</h1>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    window.__timelines["main"] = tl;
  </script>
</body></html>`;

describe("semantic motion mutation route", () => {
  let projectDir: string;
  let app: Hono;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "hf-motion-test-"));
    writeFileSync(join(projectDir, "index.html"), SOURCE);
    const adapter: StudioApiAdapter = {
      listProjects: () => [{ id: "test", dir: projectDir }],
      resolveProject: (id) => (id === "test" ? { id, dir: projectDir } : null),
      bundle: async () => null,
      lint: () => ({ findings: [] }),
      runtimeUrl: "/runtime.js",
      rendersDir: () => projectDir,
      startRender: ({ jobId, outputPath }) => ({
        id: jobId,
        status: "complete",
        progress: 1,
        outputPath,
      }),
    };
    app = new Hono();
    registerFileRoutes(app, adapter);
  });

  afterEach(() => rmSync(projectDir, { recursive: true, force: true }));

  async function mutate(body: Record<string, unknown>) {
    return app.request("/projects/test/gsap-mutations/index.html", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("adds, reloads and replaces one text preset per phase", async () => {
    const first = await mutate({
      type: "mutate-motion",
      operation: "upsert",
      targetSelector: "#headline",
      elementId: "headline",
      targetKind: "text",
      phase: "enter",
      presetId: "text.enter.typewriter",
      parameters: { unit: "character", stagger: 0.05 },
    });
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    const firstMotions = firstBody.parsed.animations
      .map((animation: { extras?: Record<string, unknown> }) =>
        readMotionInstanceFromExtras(animation.extras),
      )
      .filter(Boolean);
    expect(firstMotions).toHaveLength(1);
    expect(firstMotions[0].presetId).toBe("text.enter.typewriter");

    let html = readFileSync(join(projectDir, "index.html"), "utf8");
    expect(html).toContain("data-ipw-motion-char");
    expect(html).toContain('data-ipw-animation-reference="text.enter.typewriter"');
    expect(html).toContain("ipw-motion:v1:");

    const replace = await mutate({
      type: "mutate-motion",
      operation: "upsert",
      targetSelector: "#headline",
      elementId: "headline",
      targetKind: "text",
      phase: "enter",
      presetId: "text.enter.fade",
      parameters: { unit: "whole" },
    });
    expect(replace.status).toBe(200);
    const replaceBody = await replace.json();
    const replaceMotions = replaceBody.parsed.animations
      .map((animation: { extras?: Record<string, unknown> }) =>
        readMotionInstanceFromExtras(animation.extras),
      )
      .filter(Boolean);
    expect(replaceMotions).toHaveLength(1);
    expect(replaceMotions[0].presetId).toBe("text.enter.fade");

    html = readFileSync(join(projectDir, "index.html"), "utf8");
    expect(html).not.toContain("data-ipw-motion-char");
    expect(html).toContain("你好 mixed AI");
    expect(html).not.toContain("text.enter.typewriter");
  });

  it("keeps phases independent and removes only the requested phase", async () => {
    for (const [phase, presetId] of [
      ["enter", "text.enter.rise"],
      ["emphasis", "text.emphasis.pulse"],
      ["exit", "text.exit.fade"],
    ]) {
      const response = await mutate({
        type: "mutate-motion",
        operation: "upsert",
        targetSelector: "#headline",
        elementId: "headline",
        targetKind: "text",
        phase,
        presetId,
      });
      expect(response.status).toBe(200);
    }

    const removed = await mutate({
      type: "mutate-motion",
      operation: "remove",
      targetSelector: "#headline",
      targetKind: "text",
      phase: "emphasis",
    });
    const body = await removed.json();
    const phases = body.parsed.animations
      .map((animation: { extras?: Record<string, unknown> }) =>
        readMotionInstanceFromExtras(animation.extras),
      )
      .filter(Boolean)
      .map((instance: { phase: string }) => instance.phase);
    expect(phases).toEqual(["enter", "exit"]);
    const html = readFileSync(join(projectDir, "index.html"), "utf8");
    expect(html).toContain("text.enter.rise");
    expect(html).toContain("text.exit.fade");
    expect(html).not.toContain("text.emphasis.pulse");
  });

  it("drops parameters unsupported by a replacement preset and clears the last marker", async () => {
    const added = await mutate({
      type: "mutate-motion",
      operation: "upsert",
      targetSelector: "#headline",
      targetKind: "text",
      phase: "emphasis",
      presetId: "text.emphasis.highlight",
      parameters: { color: "#ff0000" },
    });
    expect(added.status).toBe(200);

    const replaced = await mutate({
      type: "mutate-motion",
      operation: "upsert",
      targetSelector: "#headline",
      targetKind: "text",
      phase: "emphasis",
      presetId: "text.emphasis.pulse",
    });
    expect(replaced.status).toBe(200);
    const replacementBody = await replaced.json();
    const replacement = replacementBody.parsed.animations
      .map((animation: { extras?: Record<string, unknown> }) =>
        readMotionInstanceFromExtras(animation.extras),
      )
      .find(Boolean);
    expect(replacement.parameters).not.toHaveProperty("color");

    const removed = await mutate({
      type: "mutate-motion",
      operation: "remove",
      targetSelector: "#headline",
      targetKind: "text",
      phase: "emphasis",
    });
    expect(removed.status).toBe(200);
    const html = readFileSync(join(projectDir, "index.html"), "utf8");
    expect(html).not.toContain("data-ipw-motion-selector");
    expect(html).not.toContain("data-ipw-animation-reference");
  });

  it("rejects invalid presets and non-leaf text without modifying the file", async () => {
    const nested = SOURCE.replace(
      '<h1 id="headline" data-start="1" data-duration="5">你好 mixed AI</h1>',
      '<h1 id="headline" data-start="1" data-duration="5"><span>Nested</span></h1>',
    );
    writeFileSync(join(projectDir, "index.html"), nested);
    const response = await mutate({
      type: "mutate-motion",
      operation: "upsert",
      targetSelector: "#headline",
      targetKind: "text",
      phase: "enter",
      presetId: "text.enter.fade",
    });
    expect(response.status).toBe(400);
    expect(readFileSync(join(projectDir, "index.html"), "utf8")).toBe(nested);
  });

  it("applies a general element preset to a container without changing its layout", async () => {
    const nested = SOURCE.replace(
      '<h1 id="headline" data-start="1" data-duration="5">你好 mixed AI</h1>',
      '<div id="card" data-start="1" data-duration="5"><span>Nested</span></div>',
    );
    writeFileSync(join(projectDir, "index.html"), nested);
    const response = await mutate({
      type: "mutate-motion",
      operation: "upsert",
      targetSelector: "#card",
      elementId: "card",
      targetKind: "element",
      phase: "enter",
      presetId: "element.enter.slide",
      parameters: { direction: "left", intensity: 1 },
    });

    expect(response.status).toBe(200);
    const html = readFileSync(join(projectDir, "index.html"), "utf8");
    expect(html).toContain('<div data-ipw-animation-reference="element.enter.slide"');
    expect(html).toContain('<span>Nested</span>');
    expect(html).not.toContain("data-ipw-motion-char");
  });
});
