import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";
const id = "plugin-development-release";
const vo = await loadVoiceoverParagraphs(id);
const repo = fileURLToPath(new URL("../../", import.meta.url));
function command(ctx, program, args) {
  const result = spawnSync(program, args, { cwd: repo, encoding: "utf8", windowsHide: true, timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  ctx.output(args.join(" "), (result.stdout + result.stderr).trim());
  ctx.assert(result.status === 0, "Command must complete successfully: " + args.join(" "));
  ctx.recordEvidence({ type: "assertion", status: "passed", assertion: args.join(" ") + " exits 0" });
}
export default {
  id, title: "Local development plugins and independently signed cloud releases", kind: "internal", requiresApp: false,
  steps: [
    { name: "Local source refresh and production isolation", run: async ctx => {
      await ctx.prove("Real dev/prod servers preserve local edits, switches and data with separate inventories", {
        voiceover: vo[0], assert: async () => command(ctx, "bun", ["test", "--timeout", "60000", "./apps/server/src/plugin-package-development.test.ts"]),
      });
    } },
    { name: "One-command release boundaries", run: async ctx => {
      await ctx.prove("The packaging CLI supports single-plugin releases and rejects invalid or untrusted input", {
        voiceover: vo[1], assert: async () => command(ctx, process.execPath, ["--test", "scripts/package-plugin-collection.test.mjs"]),
      });
    } },
    { name: "Production desktop and twenty signed artifacts", run: async ctx => {
      await ctx.prove("Only internal core ships, and every exported business plugin has an independently verified artifact", {
        voiceover: vo[2], assert: async () => {
          command(ctx, process.execPath, ["--test", "apps/desktop/electron/runtime.test.mjs", "apps/desktop/electron/sidecar-packaging.test.mjs"]);
          const output = process.env.IPOLLOWORK_PLUGIN_RELEASE_PROOF_DIR;
          ctx.assert(Boolean(output), "Set IPOLLOWORK_PLUGIN_RELEASE_PROOF_DIR to the completed twenty-plugin release directory");
          const collection = JSON.parse(await readFile(join(output, "collection.json"), "utf8"));
          ctx.assert(collection.signed === true && collection.cloudPublished === false && collection.plugins.length === 20, "Twenty signed plugins were prepared locally without publication");
          for (const plugin of collection.plugins) {
            const bytes = await readFile(join(output, plugin.artifact.file));
            ctx.assert(plugin.verification === "host-signature-and-original-files-verified", "Installer and original resource verification: " + plugin.pluginId);
            ctx.assert(createHash("sha256").update(bytes).digest("hex") === plugin.artifact.sha256, "Unmodified signed archive: " + plugin.pluginId);
          }
          ctx.recordEvidence({ type: "assertion", status: "passed", assertion: "All twenty release archives match their host-verified collection digests" });
          ctx.output("Verified release inventory", JSON.stringify(collection.plugins.map(plugin => ({ pluginId: plugin.pluginId, version: plugin.version, sha256: plugin.artifact.sha256 })), null, 2));
        },
      });
    } },
  ],
};
