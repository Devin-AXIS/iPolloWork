import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lintHyperframeHtml } from "@hyperframes/lint";
import { readJsonAttr } from "../../lint/src/utils";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VALID_COMPOSITION = `
<html>
<body>
  <div id="root" data-composition-id="comp-1" data-width="1920" data-height="1080" data-start="0">
    <div id="stage"></div>
  </div>
  <script src="https://cdn.gsap.com/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#stage", { opacity: 1, duration: 1 }, 0);
    window.__timelines["comp-1"] = tl;
  </script>
</body>
</html>`;

async function testCleanFixturePasses() {
  const result = await lintHyperframeHtml(VALID_COMPOSITION, { filePath: "valid.html" });

  assert.equal(result.ok, true, "valid composition should pass without lint errors");
  assert.equal(result.errorCount, 0, "valid composition should have zero lint errors");
}

async function testDetectsMissingCompositionHostId() {
  const html = `
    <html>
      <body>
        <div id="root" data-width="1080" data-height="1920">
          <div data-composition-src="compositions/overlays.html"></div>
        </div>
        <script>
          window.__timelines = {};
          const tl = gsap.timeline({ paused: true });
          window.__timelines["root"] = tl;
        </script>
      </body>
    </html>
  `;

  const result = await lintHyperframeHtml(html);
  const codes = result.findings.map((finding) => finding.code);

  assert.equal(result.ok, false, "missing composition ids should fail lint");
  assert.ok(codes.includes("root_missing_composition_id"));
  assert.ok(codes.includes("host_missing_composition_id"));
}

async function testDetectsOverlappingGsapTweens() {
  const html = `
    <html>
      <body>
        <div id="main" data-composition-id="main" data-width="1080" data-height="1920">
          <div id="frame"></div>
        </div>
        <script>
          window.__timelines = {};
          const tl = gsap.timeline({ paused: true });
          tl.to("#frame", { y: 15, duration: 2.5, repeat: 1, yoyo: true }, 1.5);
          tl.to("#frame", { y: 400, duration: 1.2 }, 4.5);
          window.__timelines["main"] = tl;
        </script>
      </body>
    </html>
  `;

  const result = await lintHyperframeHtml(html);
  const overlapFinding = result.findings.find(
    (finding) => finding.code === "overlapping_gsap_tweens",
  );

  assert.ok(overlapFinding, "expected an overlapping GSAP tween warning");
  assert.equal(overlapFinding?.severity, "warning");
}

async function testJsonAttributeEntityDecoding() {
  const branches = JSON.stringify({ version: 1, kind: "category-value", rows: [
    { id: "branch-1", label: 'Sales "growth" & profit', sub: "literal &quot; and &amp;" },
    { id: "branch-2", label: "服务与支持", leaves: "输入、输出" },
  ] });
  const values = { title: 'Quoted "title" & literal &quot; <value>', branches, motionCueTimes: '{"step-1":0.3,"step-2":2}' };
  const json = JSON.stringify(values);
  const encoded = json.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const tag = `<div id="stage" data-variable-values="${encoded}"></div>`;
  assert.equal(readJsonAttr(tag, "data-variable-values"), json, "host-escaped nested JSON must be decoded exactly once");
  const parsed = JSON.parse(readJsonAttr(tag, "data-variable-values") ?? "null");
  assert.deepEqual(parsed, values, "literal quote and ampersand entities must survive one HTML decode");
  assert.deepEqual(JSON.parse(parsed.branches), JSON.parse(branches), "the nested row document must remain intact");
  assert.equal(readJsonAttr('<div data-variable-values=\'{"title":"Hello"}\'>', "data-variable-values"), '{"title":"Hello"}');
  assert.equal(readJsonAttr('<div data-variable-values="{&#34;title&#34;:&#x22;Hello&#x22;}">', "data-variable-values"), '{"title":"Hello"}');
  assert.equal(readJsonAttr('<div data-variable-values-extra="{}">', "data-variable-values"), null);

  const declarations = JSON.stringify(Object.keys(values).map(id => ({ id, type: "string", label: id, default: "" }))).replaceAll('"', "&quot;");
  const html = VALID_COMPOSITION.replace("<html>", `<html data-composition-variables="${declarations}">`).replace('<div id="stage"></div>', tag);
  const result = await lintHyperframeHtml(html);
  assert.equal(result.ok, true, JSON.stringify(result.findings));
  const invalid = await lintHyperframeHtml(VALID_COMPOSITION.replace('<div id="stage"></div>', '<div id="stage" data-variable-values="{&quot;title&quot;:"></div>'));
  assert.ok(invalid.findings.some(finding => finding.code === "invalid_variable_values_json"), "malformed JSON must still be rejected after entity decoding");
}

function testCliJsonOutput() {
  const tempDir = mkdtempSync(path.join(tmpdir(), "hf-core-lint-script-"));
  try {
    const fixturePath = path.join(tempDir, "index.html");
    writeFileSync(fixturePath, VALID_COMPOSITION, "utf8");
    const stdout = execFileSync("bun", ["run", "check:hyperframe-html", "--json", fixturePath], {
      cwd: ROOT,
      encoding: "utf8",
    });
    const payload = JSON.parse(stdout);

    assert.equal(payload.ok, true);
    assert.equal(typeof payload.errorCount, "number");
    assert.ok(Array.isArray(payload.findings));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  await testCleanFixturePasses();
  await testDetectsMissingCompositionHostId();
  await testDetectsOverlappingGsapTweens();
  await testJsonAttributeEntityDecoding();
  testCliJsonOutput();
  console.log("hyperframe linter tests passed");
}

await main();
