import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const FLOW_ID = "ipollowork-video-template";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILL_ROOT = join(ROOT, ".opencode", "skills", "ipollowork-video-template");
const VALIDATOR = join(SKILL_ROOT, "scripts", "validate-video-template.mjs");
const vo = await loadVoiceoverParagraphs(FLOW_ID);

const exists = (filePath) => access(filePath).then(() => true, () => false);

function witness(ctx, condition, assertion, actual) {
  ctx.recordEvidence({
    type: "assertion",
    status: condition ? "passed" : "failed",
    assertion,
    actual,
  });
  if (!condition) ctx.assert(false, `${assertion}${actual ? ` (actual: ${actual})` : ""}`);
}

export default {
  id: FLOW_ID,
  title: "Kimi can build importable HTML video templates from one production contract",
  kind: "internal",
  requiresApp: false,
  steps: [
    {
      name: "The skill establishes the current video architecture",
      run: async (ctx) => {
        await ctx.prove("The skill identifies the session project, HTML source of truth, clips, scenes, tracks, and paused timeline", {
          voiceover: vo[0],
          assert: async () => {
            const skillPath = join(SKILL_ROOT, "SKILL.md");
            const architecturePath = join(SKILL_ROOT, "references", "architecture.md");
            witness(ctx, await exists(skillPath), "The project-level video-template Skill exists");
            witness(ctx, await exists(architecturePath), "The current video architecture reference exists");
            const architecture = await readFile(architecturePath, "utf8");
            for (const term of ["index.html", "HyperFrames", "Scenes", "Tracks", "Clips", "window.__timelines"]) {
              witness(ctx, architecture.includes(term), `Architecture documents ${term}`);
            }
            ctx.output("architecture.md", architecture);
          },
        });
      },
    },
    {
      name: "Narrative and components are selected before effects",
      run: async (ctx) => {
        await ctx.prove("The workflow maps video goals to scene sequences and reusable scene, content, and motion components", {
          voiceover: vo[1],
          assert: async () => {
            const reference = await readFile(join(SKILL_ROOT, "references", "narrative-and-components.md"), "utf8");
            for (const term of ["product launch", "educational", "data proof", "Scene components", "Content components", "Motion components", "Component contract"]) {
              witness(ctx, reference.includes(term), `Narrative and component guide includes ${term}`);
            }
            ctx.output("narrative-and-components.md", reference);
          },
        });
      },
    },
    {
      name: "Variables are public contracts rather than incidental values",
      run: async (ctx) => {
        await ctx.prove("The Skill distinguishes current V1 fields, global/scene/component scope, variable domains, bindings, and locked internals", {
          voiceover: vo[2],
          assert: async () => {
            const reference = await readFile(join(SKILL_ROOT, "references", "variables.md"), "utf8");
            for (const term of ["Current manifest V1", "global", "scene", "component", "content", "visual", "media", "timing", "audio", "behavior", "data-var-text", "data-var-src", "Keep these locked"]) {
              witness(ctx, reference.includes(term), `Variable guide includes ${term}`);
            }
            witness(ctx, reference.includes("Do not write `scope`"), "The guide prevents unsupported V2 fields from entering strict V1 manifests");
            ctx.output("variables.md", reference);
          },
        });
      },
    },
    {
      name: "The output is an importable, local-first package",
      run: async (ctx) => {
        await ctx.prove("The package contract requires a manifest, HTML entry, cover, local assets, license metadata, and deterministic validation", {
          voiceover: vo[3],
          assert: async () => {
            const reference = await readFile(join(SKILL_ROOT, "references", "quality-and-packaging.md"), "utf8");
            for (const term of ["manifest.json", "index.html", "cover.png", "assets/", "license", "CDN", "Deterministic checks"]) {
              witness(ctx, reference.includes(term), `Packaging guide includes ${term}`);
            }
            witness(ctx, await exists(VALIDATOR), "The deterministic package validator exists");
            ctx.output("quality-and-packaging.md", reference);
          },
        });
      },
    },
    {
      name: "The validator accepts a valid package and rejects broken contracts",
      run: async (ctx) => {
        await ctx.prove("A current local HyperFrames template passes while a remote, unbound legacy frame fails with actionable errors", {
          voiceover: vo[4],
          assert: async () => {
            const validTemplate = join(ROOT, "apps", "server", "bundled-templates", "ipollowork.hyperframes.app-device-launch");
            const invalidTemplate = join(ROOT, "apps", "server", "bundled-templates", "ipollowork.html-anything.frame-glitch-title");
            const valid = spawnSync(process.execPath, [VALIDATOR, validTemplate], { encoding: "utf8" });
            const invalid = spawnSync(process.execPath, [VALIDATOR, invalidTemplate], { encoding: "utf8" });
            witness(ctx, valid.status === 0, "A valid local video package exits zero", valid.stderr.trim());
            witness(ctx, valid.stdout.includes("PASS:"), "The valid package reports PASS");
            witness(ctx, invalid.status === 1, "A broken video package exits non-zero", String(invalid.status));
            witness(ctx, invalid.stderr.includes("no image binding"), "The validator reports an unbound public variable");
            witness(ctx, invalid.stderr.includes("Remote runtime assets"), "The validator reports remote runtime dependencies");
            ctx.output("Valid package", valid.stdout.trim());
            ctx.output("Invalid package", invalid.stderr.trim());
          },
        });
      },
    },
  ],
};
