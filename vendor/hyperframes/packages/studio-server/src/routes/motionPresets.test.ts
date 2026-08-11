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

  it("replaces a legacy selector animation when the same element gains a stable hf id", async () => {
    writeFileSync(
      join(projectDir, "index.html"),
      SOURCE.replace(
        '<h1 id="headline" data-start="1" data-duration="5">',
        '<h1 id="headline" class="headline" data-hf-id="hf-headline" data-start="1" data-duration="5">',
      ),
    );

    const legacy = await mutate({
      type: "mutate-motion",
      operation: "upsert",
      targetSelector: ".headline",
      elementId: "headline",
      targetKind: "text",
      phase: "emphasis",
      presetId: "text.emphasis.pulse",
    });
    expect(legacy.status).toBe(200);

    const replacement = await mutate({
      type: "mutate-motion",
      operation: "upsert",
      targetSelector: '[data-hf-id="hf-headline"]',
      elementId: "headline",
      hfId: "hf-headline",
      targetKind: "text",
      phase: "emphasis",
      presetId: "text.emphasis.highlight",
      parameters: { color: "#ff0000" },
    });
    expect(replacement.status).toBe(200);
    const body = await replacement.json();
    const motions = body.parsed.animations
      .map((animation: { extras?: Record<string, unknown> }) =>
        readMotionInstanceFromExtras(animation.extras),
      )
      .filter(Boolean);
    expect(motions).toHaveLength(1);
    expect(motions[0].presetId).toBe("text.emphasis.highlight");
    expect(motions[0].target.hfId).toBe("hf-headline");

    const html = readFileSync(join(projectDir, "index.html"), "utf8");
    expect(html).not.toContain('motion:.headline:emphasis');
    expect(html).toContain('data-ipw-animation-reference="text.emphasis.highlight"');
  });

  it("keeps variable-bound text unsplit while preserving the requested motion", async () => {
    const variableSource = SOURCE.replace(
      '<h1 id="headline" data-start="1" data-duration="5">',
      '<h1 id="headline" data-var-text="title" data-start="1" data-duration="5">',
    );
    writeFileSync(join(projectDir, "index.html"), variableSource);

    const response = await mutate({
      type: "mutate-motion",
      operation: "upsert",
      targetSelector: "#headline",
      elementId: "headline",
      targetKind: "text",
      phase: "enter",
      presetId: "text.enter.fold-reveal",
      parameters: { unit: "character" },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    const instance = body.parsed.animations
      .map((animation: { extras?: Record<string, unknown> }) =>
        readMotionInstanceFromExtras(animation.extras),
      )
      .find(Boolean);
    expect(instance.parameters.unit).toBe("whole");
    const html = readFileSync(join(projectDir, "index.html"), "utf8");
    expect(html).toContain('data-var-text="title"');
    expect(html).toContain("text.enter.fold-reveal");
    expect(html).not.toContain("data-ipw-motion-char");
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
    expect(html).toContain("<span>Nested</span>");
    expect(html).not.toContain("data-ipw-motion-char");
  });

  it("times nested element presets inside their nearest visible clip", async () => {
    const nested = SOURCE.replace(
      '<h1 id="headline" data-start="1" data-duration="5">你好 mixed AI</h1>',
      '<section class="clip" data-start="9.6" data-duration="3"><article id="card"><span>Nested</span></article></section>',
    );
    writeFileSync(join(projectDir, "index.html"), nested);

    const response = await mutate({
      type: "mutate-motion",
      operation: "upsert",
      targetSelector: "#card",
      elementId: "card",
      targetKind: "element",
      phase: "emphasis",
      presetId: "element.emphasis.lift",
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    const instance = body.parsed.animations
      .map((animation: { extras?: Record<string, unknown> }) =>
        readMotionInstanceFromExtras(animation.extras),
      )
      .find(Boolean);
    expect(instance.start).toBe(10.7);
    expect(instance.duration).toBe(0.8);
  });

  it("persists looped motion with a finite repeat count that fits its clip", async () => {
    const nested = SOURCE.replace(
      '<h1 id="headline" data-start="1" data-duration="5">你好 mixed AI</h1>',
      '<section class="clip" data-start="2" data-duration="3"><article id="card">Card</article></section>',
    );
    writeFileSync(join(projectDir, "index.html"), nested);

    const response = await mutate({
      type: "mutate-motion",
      operation: "upsert",
      targetSelector: "#card",
      elementId: "card",
      targetKind: "element",
      phase: "enter",
      presetId: "element.enter.fade",
      duration: 0.5,
      loop: true,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    const instance = body.parsed.animations
      .map((animation: { extras?: Record<string, unknown> }) =>
        readMotionInstanceFromExtras(animation.extras),
      )
      .find(Boolean);
    expect(instance).toMatchObject({ loop: true, repeat: 5, duration: 0.5 });
    expect(readFileSync(join(projectDir, "index.html"), "utf8")).toContain("repeat: 5");
  });

  it("repairs an older semantic position when its owner timing changed", async () => {
    const nested = SOURCE.replace(
      '<h1 id="headline" data-start="1" data-duration="5">你好 mixed AI</h1>',
      '<section class="clip" data-start="15.6" data-duration="3"><article id="card"><span>Nested</span></article></section>',
    );
    writeFileSync(join(projectDir, "index.html"), nested);

    const response = await mutate({
      type: "mutate-motion",
      operation: "upsert",
      targetSelector: "#card",
      elementId: "card",
      targetKind: "element",
      phase: "emphasis",
      presetId: "element.emphasis.lift",
      start: 0.1,
      duration: 0.8,
      parameters: { intensity: 1.4 },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    const instance = body.parsed.animations
      .map((animation: { extras?: Record<string, unknown> }) =>
        readMotionInstanceFromExtras(animation.extras),
      )
      .find(Boolean);
    expect(instance.start).toBe(16.7);
    expect(instance.parameters.intensity).toBe(1.4);
  });
});
