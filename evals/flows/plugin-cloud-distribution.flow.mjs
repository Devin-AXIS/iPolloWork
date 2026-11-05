import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";
const execute = promisify(execFile);
const repository = fileURLToPath(new URL("../../", import.meta.url));
const narration = await loadVoiceoverParagraphs("plugin-cloud-distribution");
export default {
  id: "plugin-cloud-distribution", kind: "internal", requiresApp: false,
  title: "Twenty independent plugin packages retain complete files and reject an untrusted signer",
  steps: [{ name: "Round-trip all independent distributions", run: async ctx => {
    let report;
    await ctx.prove("Twenty independent packages pass the real archive and host integrity checks", {
      voiceover: narration[0],
      action: async () => {
        const result = await execute("bun", ["evals/support/plugin-collection-verifier.mjs"], { cwd: repository, timeout: 120000, maxBuffer: 1024 * 1024 });
        await ctx.output("package-roundtrip", result.stdout);
        report = JSON.parse(await readFile(new URL("../results/plugin-cloud-collection/roundtrip.json", import.meta.url), "utf8"));
      },
      assert: async () => {
        ctx.assert(report.passed === 20, "Expected twenty verified plugin packages");
        ctx.assert(report.results.every(item => item.integrity === "verified" && item.untrustedSigner === "rejected"), "Resource closure or signature trust checks failed");
      },
    });
  } }],
};
