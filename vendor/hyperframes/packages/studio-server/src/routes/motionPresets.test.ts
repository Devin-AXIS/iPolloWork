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

  it("isolates shared GSAP targets before one element is edited", async () => {
    writeFileSync(
      join(projectDir, "index.html"),
      `<!doctype html><html><body>
        <article class="card" data-hf-id="card-one"></article>
        <article class="card" data-hf-id="card-two"></article>
        <article class="card" data-hf-id="card-three"></article>
        <script>
          const tl = gsap.timeline({ paused: true });
          tl.to(".card", { x: 80, duration: 1, repeat: 2 }, 0);
          tl.to(".card", { scale: 1.1, duration: 0.4 }, 0.2);
        </script>
      </body></html>`,
    );
    const selectedSelector = '[data-hf-id="card-two"]';
    const remainderSelector = ':is(.card):not([data-hf-id="card-two"])';

    const response = await mutate({
      type: "isolate-selector-target",
      targetSelector: ".card",
      selectedSelector,
      remainderSelector,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(
      body.parsed.animations.filter(
        (animation: { targetSelector: string }) => animation.targetSelector === selectedSelector,
      ),
    ).toHaveLength(2);
    expect(
      body.parsed.animations.filter(
        (animation: { targetSelector: string }) => animation.targetSelector === remainderSelector,
      ),
    ).toHaveLength(2);
    expect(readFileSync(join(projectDir, "index.html"), "utf8")).toContain("repeat: 2");
  });

  it("adds, reloads and replaces one text preset on an element", async () => {
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
    expect(html).toContain("data-ipw-motion-source");
    expect(html).toContain("font-weight:inherit");
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

  it("keeps a manually placed element anchored when semantic motion is added", async () => {
    writeFileSync(
      join(projectDir, "index.html"),
      SOURCE.replace(
        "const tl = gsap.timeline({ paused: true });",
        'gsap.set("#headline", { x: 120, y: 240 });\n    const tl = gsap.timeline({ paused: true });',
      ),
    );

    const response = await mutate({
      type: "mutate-motion",
      operation: "upsert",
      targetSelector: "#headline",
      elementId: "headline",
      targetKind: "text",
      phase: "enter",
      presetId: "text.enter.rise",
      parameters: { unit: "whole", direction: "left", intensity: 1 },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    const motion = body.parsed.animations.find(
      (animation: { keyframes?: unknown; extras?: Record<string, unknown> }) =>
        animation.keyframes && readMotionInstanceFromExtras(animation.extras),
    );
    expect(motion.keyframes.keyframes[0].properties).toMatchObject({ x: 162, y: 240 });
    expect(motion.keyframes.keyframes.at(-1).properties).toMatchObject({ x: 120, y: 240 });
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
    expect(html.match(/data-ipw-motion-role="unit"/g) ?? []).toHaveLength(3);
    expect(html.match(/data-ipw-motion-role="background"/g) ?? []).toHaveLength(3);
    expect(html.match(/data-ipw-motion-role="text"/g) ?? []).toHaveLength(3);
    expect(html).toContain(">clear.</span>");
    expect(html).toContain('data-ipw-motion-structure="v1"');
    expect(html).toContain('data-ipw-motion-presentation="text-v1"');
    expect(html).toContain("font-weight:inherit");
    expect(html).toContain("line-height:inherit");
    expect(html).toContain("letter-spacing:inherit");
    expect(html).toContain('#headline [data-ipw-motion-role=\\"background\\"]');
    expect(html).toContain('#headline [data-ipw-motion-role=\\"unit\\"]');
    expect(html).toContain('#headline [data-ipw-motion-role=\\"text\\"]');
    expect(html).toContain("linear-gradient(135deg, #ff1745 0%, #df1238 100%)");
    expect(html).toContain("scaleX: 0");
    expect(html).toContain("power2.out");
    expect(html).toContain("power2.in");
    expect(html).toContain("stagger: 0.168604651163");
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
    expect(html.match(/data-ipw-motion-role="unit"/g) ?? []).toHaveLength(3);

    const removed = await mutate({ ...highlight, operation: "remove" });
    expect(removed.status).toBe(200);
    html = readFileSync(join(projectDir, "index.html"), "utf8");
    const removedDocument = parseHTML(html).document;
    expect(html).toContain(">Make motion clear.</h1>");
    expect(html).not.toContain("data-ipw-motion-structure");
    expect(html).not.toContain("data-ipw-motion-source");
    expect(removedDocument.querySelector("[data-ipw-motion-role]")).toBeNull();
    expect(removedDocument.querySelector("[data-ipw-motion-presentation]")).toBeNull();

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
    expect(html.match(/data-ipw-motion-role="unit"/g) ?? []).toHaveLength(3);
    expect(html).toContain('data-var-text="title"');
    expect(html).toContain('\\"unit\\":\\"word\\"');
  });

  it("replaces split character motion with a structured word animation", async () => {
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
    const appliedBody = await highlight.json();
    const appliedMotions = appliedBody.parsed.animations
      .map((animation: { extras?: Record<string, unknown> }) =>
        readMotionInstanceFromExtras(animation.extras),
      )
      .filter(Boolean);
    expect(new Set(appliedMotions.map((instance) => instance.presetId))).toEqual(
      new Set(["text.emphasis.highlight-sweep"]),
    );
    expect(document.querySelectorAll('[data-ipw-motion-role="text"]')).toHaveLength(3);
    expect(document.querySelector("#headline [data-ipw-motion-char]")).toBeNull();
    expect(document.querySelectorAll('#headline [data-ipw-motion-role="background"]')).toHaveLength(
      3,
    );
    expect(html).not.toContain("text.enter.typewriter");
    expect(html).not.toContain("#headline [data-ipw-motion-char]");
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
    expect(remainingMotions).toHaveLength(0);

    html = readFileSync(join(projectDir, "index.html"), "utf8");
    document = parseHTML(html).document;
    expect(html).not.toContain("data-ipw-motion-structure");
    expect(document.querySelector("[data-ipw-motion-role]")).toBeNull();
    expect(document.querySelector("#headline [data-ipw-motion-char]")).toBeNull();
    expect(document.querySelector("#headline")?.textContent).toBe("Make motion clear.");
  });

  it("replaces advanced text structures across phases", async () => {
    writeFileSync(
      join(projectDir, "index.html"),
      SOURCE.replace("\u4f60\u597d mixed AI", "Make motion clear."),
    );
    const matrix = await mutate({
      type: "mutate-motion",
      operation: "upsert",
      targetSelector: "#headline",
      elementId: "headline",
      targetKind: "text",
      phase: "enter",
      presetId: "text.enter.matrix-decode",
      parameters: { unit: "word", stagger: 0.05 },
    });
    expect(matrix.status).toBe(200);

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

    const html = readFileSync(join(projectDir, "index.html"), "utf8");
    const document = parseHTML(html).document;
    const response = await highlight.json();
    const instances = response.parsed.animations
      .map((animation: { extras?: Record<string, unknown> }) =>
        readMotionInstanceFromExtras(animation.extras),
      )
      .filter(Boolean);
    expect(new Set(instances.map((instance) => instance.presetId))).toEqual(
      new Set(["text.emphasis.highlight-sweep"]),
    );
    expect(document.querySelectorAll('#headline [data-ipw-motion-role="unit"]')).toHaveLength(3);
    expect(document.querySelectorAll('#headline [data-ipw-motion-role="background"]')).toHaveLength(
      3,
    );
    expect(document.querySelector('#headline [data-ipw-motion-role="clone-primary"]')).toBeNull();
    expect(document.querySelector('#headline [data-ipw-motion-role="clone-accent"]')).toBeNull();
    expect(document.querySelector("#headline")?.textContent).toBe("Make motion clear.");
    expect(html).not.toContain("text.enter.matrix-decode");
    expect(html).not.toContain('#headline [data-ipw-motion-role=\\"clone-primary\\"]');
    expect(html).toContain('#headline [data-ipw-motion-role=\\"background\\"]');
  });

  it("applies the new advanced text family through the real source mutation path", async () => {
    writeFileSync(
      join(projectDir, "index.html"),
      SOURCE.replace("\u4f60\u597d mixed AI", "Make motion clear."),
    );

    const visualLayers = await mutate({
      type: "mutate-motion",
      operation: "upsert",
      targetSelector: "#headline",
      elementId: "headline",
      targetKind: "text",
      phase: "enter",
      presetId: "text.enter.visual-layers",
      parameters: { unit: "word", stagger: 0.055, colorSource: "theme" },
    });
    expect(visualLayers.status).toBe(200);

    const karaoke = await mutate({
      type: "mutate-motion",
      operation: "upsert",
      targetSelector: "#headline",
      elementId: "headline",
      targetKind: "text",
      phase: "emphasis",
      presetId: "text.emphasis.karaoke-flow",
      parameters: { unit: "word", stagger: 0.12, colorSource: "theme" },
    });
    expect(karaoke.status).toBe(200);

    const response = await karaoke.json();
    const instances = response.parsed.animations
      .map((animation: { extras?: Record<string, unknown> }) =>
        readMotionInstanceFromExtras(animation.extras),
      )
      .filter(Boolean);
    expect(new Set(instances.map((instance) => instance.presetId))).toEqual(
      new Set(["text.emphasis.karaoke-flow"]),
    );

    const html = readFileSync(join(projectDir, "index.html"), "utf8");
    const document = parseHTML(html).document;
    expect(document.querySelectorAll('#headline [data-ipw-motion-role="unit"]')).toHaveLength(3);
    expect(document.querySelectorAll('#headline [data-ipw-motion-role="background"]')).toHaveLength(
      3,
    );
    expect(document.querySelector('#headline [data-ipw-motion-role="clone-primary"]')).toBeNull();
    expect(document.querySelector('#headline [data-ipw-motion-role="clone-accent"]')).toBeNull();
    expect(document.querySelector("#headline")?.textContent).toBe("Make motion clear.");
    expect(html).not.toContain("text.enter.visual-layers");
    expect(html).not.toContain('#headline [data-ipw-motion-role=\\"clone-primary\\"]');
    expect(html).toContain('#headline [data-ipw-motion-role=\\"background\\"]');
  });

  it("compiles generated captions with the same structured text path as body copy", async () => {
    writeFileSync(
      join(projectDir, "index.html"),
      `<!doctype html><html><body>
        <h1 id="headline" data-start="1" data-duration="5">Make motion clear.</h1>
        <section class="clip" data-ipw-caption="true" data-start="1" data-duration="5">
          <span id="caption-text" data-ipw-caption-text="true" style="font-weight:550;line-height:1.4;letter-spacing:.04em;color:white;text-shadow:0 2px 8px black">Make motion clear.</span>
        </section>
        <script>
          window.__timelines = window.__timelines || {};
          const tl = gsap.timeline({ paused: true });
          window.__timelines["main"] = tl;
        </script>
      </body></html>`,
    );
    const applyHighlight = (selector: string, elementId: string) =>
      mutate({
        type: "mutate-motion",
        operation: "upsert",
        targetSelector: selector,
        elementId,
        targetKind: "text",
        phase: "emphasis",
        presetId: "text.emphasis.highlight-sweep",
        parameters: { unit: "word", stagger: 0.05 },
      });

    expect((await applyHighlight("#headline", "headline")).status).toBe(200);
    const captionResponse = await applyHighlight("#caption-text", "caption-text");
    expect(captionResponse.status).toBe(200);
    const captionPayload = await captionResponse.json();
    const compiledShapeFor = (selector: string) =>
      captionPayload.parsed.animations
        .filter((animation: { targetSelector: string }) =>
          animation.targetSelector.startsWith(`${selector} [`),
        )
        .map(
          (animation: {
            targetSelector: string;
            position: number;
            duration: number;
            keyframes: unknown;
            extras?: { stagger?: number };
          }) => ({
            roleSelector: animation.targetSelector.slice(selector.length),
            position: animation.position,
            duration: animation.duration,
            keyframes: animation.keyframes,
            stagger: animation.extras?.stagger ?? 0,
          }),
        );
    expect(compiledShapeFor("#caption-text")).toEqual(compiledShapeFor("#headline"));

    const html = readFileSync(join(projectDir, "index.html"), "utf8");
    const document = parseHTML(html).document;
    for (const selector of ["#headline", "#caption-text"]) {
      expect(document.querySelectorAll(`${selector} [data-ipw-motion-role="unit"]`)).toHaveLength(
        3,
      );
      expect(
        document.querySelectorAll(`${selector} [data-ipw-motion-role="background"]`),
      ).toHaveLength(3);
      expect(document.querySelectorAll(`${selector} [data-ipw-motion-role="text"]`)).toHaveLength(
        3,
      );
      expect(html).toContain(`${selector} [data-ipw-motion-role=\\"background\\"]`);
      expect(html).toContain(`${selector} [data-ipw-motion-role=\\"text\\"]`);
    }
    const caption = document.querySelector<HTMLElement>("#caption-text")!;
    expect(caption.style.fontWeight).toBe("550");
    expect(caption.style.lineHeight).toBe("1.4");
    expect(caption.style.letterSpacing).toBe(".04em");
    expect(
      Array.from(caption.querySelectorAll<HTMLElement>('[data-ipw-motion-role="text"]')).every(
        (layer) =>
          layer.style.fontWeight === "inherit" &&
          layer.style.lineHeight === "inherit" &&
          layer.style.letterSpacing === "inherit",
      ),
    ).toBe(true);
  });

  it("restores materialized Highlight DOM when the structured writer cannot add a track", async () => {
    const unwritableSource = SOURCE.replace("\u4f60\u597d mixed AI", "Make motion clear.")
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
    expect(html).not.toContain("motion:.headline:emphasis");
    expect(html).toContain('data-ipw-animation-reference="text.emphasis.highlight"');
  });

  it("keeps the requested character motion on variable-bound generated text", async () => {
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
    expect(instance.parameters.unit).toBe("character");
    const html = readFileSync(join(projectDir, "index.html"), "utf8");
    expect(html).toContain('data-var-text="title"');
    expect(html).toContain("text.enter.fold-reveal");
    expect(html).toContain("data-ipw-motion-char");
    expect(html).toContain("font-weight:inherit");
  });

  it("keeps word motion shaped as whole words instead of splitting every character", async () => {
    writeFileSync(
      join(projectDir, "index.html"),
      SOURCE.replace("\u4f60\u597d mixed AI", "Office motion fidelity"),
    );
    const response = await mutate({
      type: "mutate-motion",
      operation: "upsert",
      targetSelector: "#headline",
      elementId: "headline",
      targetKind: "text",
      phase: "emphasis",
      presetId: "text.emphasis.bounce",
      parameters: { unit: "word", stagger: 0.05 },
    });

    expect(response.status).toBe(200);
    const html = readFileSync(join(projectDir, "index.html"), "utf8");
    const document = parseHTML(html).document;
    expect(document.querySelectorAll("#headline > [data-ipw-motion-word]")).toHaveLength(3);
    expect(document.querySelectorAll("#headline [data-ipw-motion-char]")).toHaveLength(0);
    expect(document.querySelector("#headline")?.textContent).toBe("Office motion fidelity");
  });

  it("keeps only the latest text animation across all phases", async () => {
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
        applicationKind: "text",
        phase,
        presetId,
      });
      expect(response.status).toBe(200);
    }

    let html = readFileSync(join(projectDir, "index.html"), "utf8");
    let document = parseHTML(html).document;
    expect(html).not.toContain("text.enter.rise");
    expect(html).not.toContain("text.emphasis.pulse");
    expect(html).toContain("text.exit.fade");
    expect(document.querySelector("#headline")?.getAttribute("data-ipw-animation-reference")).toBe(
      "text.exit.fade",
    );

    const removed = await mutate({
      type: "mutate-motion",
      operation: "remove",
      targetSelector: "#headline",
      targetKind: "text",
      phase: "exit",
    });
    const body = await removed.json();
    const phases = body.parsed.animations
      .map((animation: { extras?: Record<string, unknown> }) =>
        readMotionInstanceFromExtras(animation.extras),
      )
      .filter(Boolean)
      .map((instance: { phase: string }) => instance.phase);
    expect(phases).toEqual([]);
    html = readFileSync(join(projectDir, "index.html"), "utf8");
    document = parseHTML(html).document;
    expect(document.querySelector("#headline")?.hasAttribute("data-ipw-animation-reference")).toBe(
      false,
    );
  });

  it("keeps multiple general animations, including animations in the same phase", async () => {
    writeFileSync(
      join(projectDir, "index.html"),
      SOURCE.replace(
        '<h1 id="headline" data-start="1" data-duration="5">你好 mixed AI</h1>',
        '<div id="card" data-start="1" data-duration="5"><span>Nested</span></div>',
      ),
    );
    for (const [templateId, phase, presetId] of [
      ["general-slide-in", "enter", "element.enter.slide"],
      ["general-scale-in", "enter", "element.enter.scale"],
      ["general-soft-float", "emphasis", "motion.emphasis.soft-float"],
    ]) {
      const response = await mutate({
        type: "mutate-motion",
        operation: "upsert",
        targetSelector: "#card",
        elementId: "card",
        targetKind: "element",
        applicationKind: "general",
        templateId,
        phase,
        presetId,
      });
      expect(response.status).toBe(200);
    }

    let html = readFileSync(join(projectDir, "index.html"), "utf8");
    expect(html).toContain("element.enter.slide");
    expect(html).toContain("element.enter.scale");
    expect(html).toContain("motion.emphasis.soft-float");

    const replacement = await mutate({
      type: "mutate-motion",
      operation: "upsert",
      targetSelector: "#card",
      elementId: "card",
      targetKind: "element",
      applicationKind: "general",
      templateId: "general-slide-in",
      phase: "enter",
      presetId: "element.enter.slide",
      parameters: { direction: "right" },
    });
    expect(replacement.status).toBe(200);
    const replacementBody = await replacement.json();
    const presetIds = replacementBody.parsed.animations
      .map((animation: { extras?: Record<string, unknown> }) =>
        readMotionInstanceFromExtras(animation.extras),
      )
      .filter(Boolean)
      .map((instance: { presetId: string }) => instance.presetId);
    expect(presetIds).toEqual([
      "element.enter.scale",
      "motion.emphasis.soft-float",
      "element.enter.slide",
    ]);
    html = readFileSync(join(projectDir, "index.html"), "utf8");
    expect(html).toContain("element.enter.slide");
    expect(html).toContain("element.enter.scale");
    expect(html).toContain("motion.emphasis.soft-float");

    const removed = await mutate({
      type: "mutate-motion",
      operation: "remove",
      targetSelector: "#card",
      targetKind: "element",
      applicationKind: "general",
      templateId: "general-slide-in",
      phase: "enter",
    });
    expect(removed.status).toBe(200);
    html = readFileSync(join(projectDir, "index.html"), "utf8");
    expect(html).not.toContain("element.enter.slide");
    expect(html).toContain("element.enter.scale");
    expect(html).toContain("motion.emphasis.soft-float");
  });

  it("keeps one box animation while preserving general animations in other phases", async () => {
    writeFileSync(
      join(projectDir, "index.html"),
      SOURCE.replace(
        '<h1 id="headline" data-start="1" data-duration="5">\u4f60\u597d mixed AI</h1>',
        '<div id="card" data-start="1" data-duration="5"><span>Nested</span></div>',
      ),
    );
    for (const input of [
      {
        applicationKind: "general",
        templateId: "general-slide-in",
        phase: "enter",
        presetId: "element.enter.slide",
      },
      {
        applicationKind: "box",
        templateId: "box-lift",
        phase: "emphasis",
        presetId: "element.emphasis.lift",
      },
      {
        applicationKind: "box",
        templateId: "box-scale",
        phase: "enter",
        presetId: "element.enter.scale",
      },
    ]) {
      const response = await mutate({
        type: "mutate-motion",
        operation: "upsert",
        targetSelector: "#card",
        elementId: "card",
        targetKind: "element",
        ...input,
      });
      const error = response.status === 200 ? "" : await response.text();
      expect(response.status, error).toBe(200);
    }

    const html = readFileSync(join(projectDir, "index.html"), "utf8");
    expect(html).toContain("element.enter.slide");
    expect(html).not.toContain("element.emphasis.lift");
    expect(html).toContain("element.enter.scale");
    const instances = parseHTML(html)
      .document.querySelector("#card")
      ?.getAttribute("data-ipw-animation-reference");
    expect(instances).toBe("element.enter.slide,element.enter.scale");
  });

  it("makes text animations mutually exclusive with general and box animations", async () => {
    for (const input of [
      {
        targetKind: "text",
        applicationKind: "general",
        templateId: "general-fade-in",
        phase: "enter",
        presetId: "text.enter.fade",
      },
      {
        targetKind: "element",
        applicationKind: "box",
        templateId: "box-lift",
        phase: "emphasis",
        presetId: "element.emphasis.lift",
      },
    ]) {
      expect(
        (
          await mutate({
            type: "mutate-motion",
            operation: "upsert",
            targetSelector: "#headline",
            elementId: "headline",
            ...input,
          })
        ).status,
      ).toBe(200);
    }

    const textMotion = await mutate({
      type: "mutate-motion",
      operation: "upsert",
      targetSelector: "#headline",
      elementId: "headline",
      targetKind: "text",
      applicationKind: "text",
      templateId: "text-highlight-sweep",
      phase: "emphasis",
      presetId: "text.emphasis.highlight-sweep",
    });
    expect(textMotion.status).toBe(200);
    let html = readFileSync(join(projectDir, "index.html"), "utf8");
    expect(html).not.toContain("text.enter.fade");
    expect(html).not.toContain("element.emphasis.lift");
    expect(html).toContain("text.emphasis.highlight-sweep");

    const generalMotion = await mutate({
      type: "mutate-motion",
      operation: "upsert",
      targetSelector: "#headline",
      elementId: "headline",
      targetKind: "text",
      applicationKind: "general",
      templateId: "general-slide-in",
      phase: "enter",
      presetId: "text.enter.rise",
    });
    expect(generalMotion.status).toBe(200);
    html = readFileSync(join(projectDir, "index.html"), "utf8");
    expect(html).not.toContain("text.emphasis.highlight-sweep");
    expect(html).toContain("text.enter.rise");

    const secondGeneralMotion = await mutate({
      type: "mutate-motion",
      operation: "upsert",
      targetSelector: "#headline",
      elementId: "headline",
      targetKind: "text",
      applicationKind: "general",
      templateId: "general-fade-in",
      phase: "enter",
      presetId: "text.enter.fade",
    });
    expect(secondGeneralMotion.status).toBe(200);
    html = readFileSync(join(projectDir, "index.html"), "utf8");
    expect(html).toContain("text.enter.rise");
    expect(html).toContain("text.enter.fade");

    const replacementTextMotion = await mutate({
      type: "mutate-motion",
      operation: "upsert",
      targetSelector: "#headline",
      elementId: "headline",
      targetKind: "text",
      applicationKind: "text",
      templateId: "text-typewriter",
      phase: "enter",
      presetId: "text.enter.typewriter",
    });
    expect(replacementTextMotion.status).toBe(200);
    html = readFileSync(join(projectDir, "index.html"), "utf8");
    expect(html).not.toContain("text.enter.rise");
    expect(html).not.toContain("text.enter.fade");
    expect(html).toContain("text.enter.typewriter");
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
    expect(instance.start).toBe(9.6);
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
    expect(instance).toMatchObject({ loop: true, repeat: 5, duration: 0.5, end: 5 });
    expect(readFileSync(join(projectDir, "index.html"), "utf8")).toContain("repeat: 5");
  });

  it("aligns every advanced caption track to the selected loop window", async () => {
    const response = await mutate({
      type: "mutate-motion",
      operation: "upsert",
      targetSelector: "#headline",
      elementId: "headline",
      targetKind: "text",
      phase: "emphasis",
      presetId: "text.emphasis.gradient-fill",
      start: 1,
      end: 6,
      duration: 0.6,
      loop: true,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    const instances = body.parsed.animations
      .map((animation: { extras?: Record<string, unknown> }) =>
        readMotionInstanceFromExtras(animation.extras),
      )
      .filter(Boolean);
    expect(instances).toHaveLength(1);
    expect(instances[0]).toMatchObject({
      start: 1,
      end: 6,
      duration: 0.625,
      loop: true,
      repeat: 7,
    });
    const content = readFileSync(join(projectDir, "index.html"), "utf8");
    expect(content).toContain("repeat: 7");
    expect(content).toContain("repeatDelay: 0.125");
  });

  it("keeps delayed advanced-caption tracks on the same loop cadence", async () => {
    const response = await mutate({
      type: "mutate-motion",
      operation: "upsert",
      targetSelector: "#headline",
      elementId: "headline",
      targetKind: "text",
      phase: "emphasis",
      presetId: "text.emphasis.neon-glow",
      start: 1,
      end: 6,
      duration: 0.8,
      loop: true,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    const motionTracks = body.parsed.animations.filter(
      (animation: { extras?: Record<string, unknown> }) =>
        readMotionInstanceFromExtras(animation.extras),
    );
    const instance = readMotionInstanceFromExtras(motionTracks[0]?.extras);
    if (!instance) throw new Error("Expected a semantic motion instance on the delayed track");
    const delayedTrack = motionTracks.find(
      (animation: { position: number; targetSelector: string }) =>
        animation.position > instance.start && animation.targetSelector.includes('role="unit"'),
    );
    if (!delayedTrack) throw new Error("Expected a delayed zero-stagger structured track");
    const readRawNumber = (value: unknown) => Number(String(value).replace("__raw:", ""));
    expect(delayedTrack.position).toBeGreaterThan(instance.start);
    expect(readRawNumber(delayedTrack.extras.stagger)).toBe(0);
    expect(readRawNumber(delayedTrack.extras.repeatDelay)).toBeCloseTo(
      instance.duration - delayedTrack.duration,
      10,
    );
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
    expect(instance.start).toBe(15.6);
    expect(instance.parameters.intensity).toBe(1.4);
  });
});
