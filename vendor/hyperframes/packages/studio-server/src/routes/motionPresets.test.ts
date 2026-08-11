import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import { readMotionInstanceFromExtras } from "@hyperframes/core/motion-presets";
import type { StudioApiAdapter } from "../types";
import { registerFileRoutes } from "./files";

const structuredRestoreCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock("@hyperframes/core/motion-presets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hyperframes/core/motion-presets")>();
  return {
    ...actual,
    restoreStructuredText(...args: Parameters<typeof actual.restoreStructuredText>) {
      structuredRestoreCalls.count += 1;
      return actual.restoreStructuredText(...args);
    },
  };
});

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
    structuredRestoreCalls.count = 0;
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

  async function removeElement(target: Record<string, unknown>) {
    return app.request("/projects/test/file-mutations/remove-element/index.html", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target }),
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

  it("removes semantic motion when its target element is deleted", async () => {
    const applied = await mutate({
      type: "mutate-motion",
      operation: "upsert",
      targetSelector: "#headline",
      elementId: "headline",
      targetKind: "text",
      phase: "emphasis",
      presetId: "text.emphasis.pulse",
    });
    expect(applied.status).toBe(200);

    const removed = await removeElement({ id: "headline" });
    expect(removed.status).toBe(200);

    const html = readFileSync(join(projectDir, "index.html"), "utf8");
    expect(html).not.toContain('id="headline"');
    expect(html).not.toContain("ipw-motion:v1:");
    expect(html).not.toContain("motion:#headline:emphasis");
  });

  it("does not delete a selector fallback when a stable target id is stale", async () => {
    writeFileSync(
      join(projectDir, "index.html"),
      SOURCE.replace('id="headline"', 'id="headline" data-hf-id="hf-live"'),
    );

    const removed = await removeElement({
      hfId: "hf-deleted",
      id: "headline",
      selector: "#headline",
    });
    expect(removed.status).toBe(404);
    expect(await removed.json()).toMatchObject({ error: "element not found in source file" });

    const html = readFileSync(join(projectDir, "index.html"), "utf8");
    expect(html).toContain('data-hf-id="hf-live"');
    expect(html).toContain('id="headline"');
  });

  it("persists a reversible legacy Highlight sweep as structured role tracks", async () => {
    writeFileSync(
      join(projectDir, "index.html"),
      SOURCE.replace("\u4f60\u597d mixed AI", "Make motion clear."),
    );
    const highlight = {
      type: "mutate-motion",
      operation: "upsert",
      targetSelector: "#headline",
      elementId: "headline",
      targetKind: "text",
      phase: "emphasis",
      presetId: "text.emphasis.highlight-sweep",
      parameters: { unit: "word", stagger: 0.05 },
    };

    const applied = await mutate(highlight);
    expect(applied.status).toBe(200);
    const appliedBody = await applied.json();
    const appliedAnimations = appliedBody.parsed.animations.filter(
      (animation: { extras?: Record<string, unknown> }) =>
        readMotionInstanceFromExtras(animation.extras) !== null,
    );
    const appliedMotions = appliedAnimations
      .map((animation: { extras?: Record<string, unknown> }) =>
        readMotionInstanceFromExtras(animation.extras),
      )
      .filter(Boolean);
    expect(appliedMotions).toHaveLength(5);
    expect(new Set(appliedMotions.map((motion: { id: string }) => motion.id))).toEqual(
      new Set(["motion:#headline:emphasis"]),
    );
    let html = readFileSync(join(projectDir, "index.html"), "utf8");
    const runtimeIds = Array.from(
      html.matchAll(/id: "(motion:#headline:emphasis:\d+:(?:background|unit|text))"/g),
      (match) => match[1],
    );
    expect(runtimeIds).toEqual([
      "motion:#headline:emphasis:0:background",
      "motion:#headline:emphasis:1:background",
      "motion:#headline:emphasis:2:background",
      "motion:#headline:emphasis:3:unit",
      "motion:#headline:emphasis:4:text",
    ]);
    expect(new Set(runtimeIds).size).toBe(5);
    expect((html.match(/data-ipw-motion-role="unit"/g) ?? [])).toHaveLength(3);
    expect((html.match(/data-ipw-motion-role="background"/g) ?? [])).toHaveLength(3);
    expect((html.match(/data-ipw-motion-role="text"/g) ?? [])).toHaveLength(3);
    expect(html).toContain(">clear.</span>");
    expect(html).toContain('data-ipw-motion-structure="v1"');
    expect(html).toContain('#headline [data-ipw-motion-role=\\"background\\"]');
    expect(html).toContain('#headline [data-ipw-motion-role=\\"unit\\"]');
    expect(html).toContain('#headline [data-ipw-motion-role=\\"text\\"]');
    expect(html).toContain("linear-gradient(135deg, #ff1745 0%, #df1238 100%)");
    expect(html).toContain("scaleX: 0");
    expect(html).toContain("power2.out");
    expect(html).toContain("power2.in");
    expect(html).toContain("stagger: 0.05");
    expect(html).toContain("duration: 0");
    const structuredTweenLines = html
      .split("\n")
      .filter((line) => line.includes('tl.to("#headline [data-ipw-motion-role'));
    expect(structuredTweenLines).toHaveLength(5);
    for (const line of structuredTweenLines) {
      expect(line).not.toMatch(/}, duration: [^,]+, ease:/);
    }

    const repeated = await mutate(highlight);
    expect(repeated.status).toBe(200);
    html = readFileSync(join(projectDir, "index.html"), "utf8");
    expect((html.match(/data-ipw-motion-role="unit"/g) ?? [])).toHaveLength(3);

    const removed = await mutate({ ...highlight, operation: "remove" });
    expect(removed.status).toBe(200);
    html = readFileSync(join(projectDir, "index.html"), "utf8");
    expect(html).toContain(">Make motion clear.</h1>");
    expect(html).not.toContain("data-ipw-motion-structure");
    expect(html).not.toContain("data-ipw-motion-source");
    expect(html).not.toContain("data-ipw-motion-role");

    const whole = await mutate({
      type: "mutate-motion",
      operation: "upsert",
      targetSelector: "#headline",
      targetKind: "text",
      phase: "enter",
      presetId: "text.enter.fade",
      parameters: { unit: "whole" },
    });
    expect(whole.status).toBe(200);
    const character = await mutate({
      type: "mutate-motion",
      operation: "upsert",
      targetSelector: "#headline",
      targetKind: "text",
      phase: "enter",
      presetId: "text.enter.typewriter",
      parameters: { unit: "character" },
    });
    expect(character.status).toBe(200);
    html = readFileSync(join(projectDir, "index.html"), "utf8");
    expect(html).toContain("data-ipw-motion-char");
    expect(html).not.toContain("data-ipw-motion-structure");
  });

  it("keeps structured word units on variable-bound text", async () => {
    writeFileSync(
      join(projectDir, "index.html"),
      SOURCE.replace("\u4f60\u597d mixed AI", "Make motion clear.").replace(
        '<h1 id="headline"',
        '<h1 id="headline" data-var-text="title"',
      ),
    );

    const applied = await mutate({
      type: "mutate-motion",
      operation: "upsert",
      targetSelector: "#headline",
      targetKind: "text",
      phase: "emphasis",
      presetId: "text.emphasis.highlight-sweep",
      parameters: { unit: "word", stagger: 0.05 },
    });

    expect(applied.status).toBe(200);
    const html = readFileSync(join(projectDir, "index.html"), "utf8");
    expect((html.match(/data-ipw-motion-role="unit"/g) ?? [])).toHaveLength(3);
    expect(html).toContain('data-var-text="title"');
    expect(html).toContain('\\"unit\\":\\"word\\"');
  });

  it("keeps character motion addressable while Highlight is structured", async () => {
    writeFileSync(
      join(projectDir, "index.html"),
      SOURCE.replace("\u4f60\u597d mixed AI", "Make motion clear."),
    );
    const typewriter = await mutate({
      type: "mutate-motion",
      operation: "upsert",
      targetSelector: "#headline",
      elementId: "headline",
      targetKind: "text",
      phase: "enter",
      presetId: "text.enter.typewriter",
      parameters: { unit: "character", stagger: 0.04 },
    });
    expect(typewriter.status).toBe(200);

    const highlight = await mutate({
      type: "mutate-motion",
      operation: "upsert",
      targetSelector: "#headline",
      elementId: "headline",
      targetKind: "text",
      phase: "emphasis",
      presetId: "text.emphasis.highlight-sweep",
      parameters: { unit: "word", stagger: 0.05 },
    });
    expect(highlight.status).toBe(200);

    let html = readFileSync(join(projectDir, "index.html"), "utf8");
    let document = parseHTML(html).document;
    expect(document.querySelectorAll('[data-ipw-motion-role="text"]')).toHaveLength(3);
    expect(document.querySelectorAll('[data-ipw-motion-role="text"] [data-ipw-motion-char]').length)
      .toBeGreaterThan(0);
    expect(document.querySelectorAll('#headline [data-ipw-motion-char]').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('#headline [data-ipw-motion-role="background"]')).toHaveLength(3);
    expect(html).toContain('#headline [data-ipw-motion-char]');
    expect(html).toContain('#headline [data-ipw-motion-role=\\"background\\"]');

    const removed = await mutate({
      type: "mutate-motion",
      operation: "remove",
      targetSelector: "#headline",
      targetKind: "text",
      phase: "emphasis",
    });
    expect(removed.status).toBe(200);
    const removedBody = await removed.json();
    const remainingMotions = removedBody.parsed.animations
      .map((animation: { extras?: Record<string, unknown> }) =>
        readMotionInstanceFromExtras(animation.extras),
      )
      .filter(Boolean);
    expect(remainingMotions).toHaveLength(1);
    expect(remainingMotions[0].presetId).toBe("text.enter.typewriter");

    html = readFileSync(join(projectDir, "index.html"), "utf8");
    document = parseHTML(html).document;
    expect(html).not.toContain("data-ipw-motion-structure");
    expect(html).not.toContain("data-ipw-motion-role");
    expect(document.querySelectorAll("#headline [data-ipw-motion-char]").length).toBeGreaterThan(0);
    expect(document.querySelector("#headline")?.textContent).toBe("Make motion clear.");
  });

  it("restores materialized Highlight DOM when the structured writer cannot add a track", async () => {
    const unwritableSource = SOURCE
      .replace("\u4f60\u597d mixed AI", "Make motion clear.")
      .replace(
        "const tl = gsap.timeline({ paused: true });",
        "const timelines = [gsap.timeline({ paused: true })];",
      )
      .replace('window.__timelines["main"] = tl;', "void timelines;");
    writeFileSync(join(projectDir, "index.html"), unwritableSource);
    const before = readFileSync(join(projectDir, "index.html"), "utf8");

    const response = await mutate({
      type: "mutate-motion",
      operation: "upsert",
      targetSelector: "#headline",
      elementId: "headline",
      targetKind: "text",
      phase: "emphasis",
      presetId: "text.emphasis.highlight-sweep",
      parameters: { unit: "word", stagger: 0.05 },
    });

    expect(response.status).toBe(400);
    expect(structuredRestoreCalls.count).toBe(1);
    const after = readFileSync(join(projectDir, "index.html"), "utf8");
    expect(after).toBe(before);
    expect(after).not.toContain("data-ipw-motion-structure");
    expect(after).not.toContain("data-ipw-motion-source");
    expect(after).not.toContain("data-ipw-motion-role");
    const target = parseHTML(after).document.querySelector("#headline");
    expect(target?.textContent).toBe("Make motion clear.");
    expect(target?.getAttribute("id")).toBe("headline");
    expect(target?.getAttribute("data-start")).toBe("1");
    expect(target?.getAttribute("data-duration")).toBe("5");
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
