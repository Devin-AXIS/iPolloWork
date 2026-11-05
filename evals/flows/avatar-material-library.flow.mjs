import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const filename = "avatar-long-fraimz-material.mp4";

function assetsUrl(raw) {
  const [base, hash = ""] = raw.split("#");
  const [route, query = ""] = hash.split("?");
  const params = new URLSearchParams(query);
  params.set("tab", "assets");
  return `${base}#${route}?${params}`;
}

export default {
  id: "avatar-material-library",
  title: "数字人成片在素材库中保持一个逻辑素材",
  kind: "user-facing",
  preserveTheme: true,
  requiredEnv: ["IPOLLOWORK_AVATAR_PROOF_DIR", "IPOLLOWORK_AVATAR_PROOF_URL"],
  steps: [{
    name: "Only the assembled two-minute avatar is visible",
    run: async (ctx) => {
      const project = resolve(process.env.IPOLLOWORK_AVATAR_PROOF_DIR);
      const url = assetsUrl(process.env.IPOLLOWORK_AVATAR_PROOF_URL);
      const fixture = join(repo, "vendor/hyperframes/packages/studio/tests/e2e/fixtures/design-panel-qa/assets/test.mp4");
      const manifest = join(project, ".media/manifest.jsonl");
      const previousManifest = await readFile(manifest, "utf8").catch(() => null);
      const files = [
        join(project, "assets", filename),
        join(project, "assets", "avatar-reference-fraimz-material.jpg"),
        join(project, "assets", "avatar-voice-fraimz-material.wav"),
        join(project, "renders", "avatar-fraimz-material-0-0.mp4"),
        join(project, "renders", "avatar-fraimz-material-1-0.mp4"),
        join(project, "renders", "avatar-fraimz-material-0.wav"),
        join(project, "renders", "avatar-cutouts", "avatar-long-fraimz-material-cutout.webm"),
      ];
      const originalUrl = await ctx.eval("location.href");
      try {
        await Promise.all([
          mkdir(join(project, "assets"), { recursive: true }),
          mkdir(join(project, "renders/avatar-cutouts"), { recursive: true }),
          mkdir(dirname(manifest), { recursive: true }),
        ]);
        await Promise.all([
          copyFile(fixture, files[0]),
          writeFile(files[1], "internal reference"),
          writeFile(files[2], "internal narration"),
          copyFile(fixture, files[3]),
          copyFile(fixture, files[4]),
          writeFile(files[5], "internal segment audio"),
          copyFile(fixture, files[6]),
        ]);
        const record = JSON.stringify({ path: `assets/${filename}`, duration: 120 });
        await writeFile(manifest, `${previousManifest?.trimEnd() ?? ""}${previousManifest?.trim() ? "\n" : ""}${record}\n`);

        await ctx.prove("A two-minute avatar contributes one material card, not its processing parts", {
          voiceover: "两分钟数字人生成完成后，素材库只显示一个两分钟成片；生成切片、配音切片和智能抠图前景都不会变成额外素材。",
          action: async () => {
            await ctx.client.send("Page.navigate", { url });
            await ctx.waitFor('Boolean(document.querySelector(\'button[aria-label="Assets"], button[aria-label="素材"]\'))', { label: "Studio assets" });
            await ctx.trustedClick('button[aria-label="Assets"], button[aria-label="素材"]');
            await ctx.fill('input[type="search"]', "fraimz-material");
            await ctx.waitFor('document.querySelectorAll("[data-testid=asset-card]").length === 1', { label: "one assembled avatar material" });
          },
          assert: async () => {
            const cards = await ctx.eval('([...document.querySelectorAll("[data-testid=asset-card]")].map(card => ({ path: card.getAttribute("data-asset-path"), text: card.textContent })))');
            ctx.assert(cards.length === 1, `Expected one material card, received ${JSON.stringify(cards)}`);
            ctx.assert(cards[0].path === `assets/${filename}`, `Expected the assembled avatar, received ${JSON.stringify(cards)}`);
            ctx.assert(cards[0].text.includes("02:00"), `Expected the two-minute duration, received ${JSON.stringify(cards)}`);
            ctx.recordEvidence({ type: "assertion", status: "passed", assertion: "Only the assembled 02:00 avatar is visible; segment, narration, reference, and cutout implementation files are absent", actual: cards });
          },
          screenshot: {
            name: "one-avatar-material",
            requireText: [filename, "02:00"],
            rejectText: ["avatar-fraimz-material-0-0.mp4", "avatar-reference-fraimz-material.jpg", "avatar-long-fraimz-material-cutout.webm"],
          },
        });
      } finally {
        await Promise.all(files.map((path) => rm(path, { force: true })));
        if (previousManifest === null) await rm(manifest, { force: true });
        else await writeFile(manifest, previousManifest);
        if (originalUrl !== url) await ctx.client.send("Page.navigate", { url: originalUrl });
      }
    },
  }],
};
