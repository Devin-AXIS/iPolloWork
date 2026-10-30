import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const resources = process.env.IPOLLOWORK_EVAL_PACKAGED_RESOURCES?.trim()
  || path.join(root, "apps/desktop/dist-electron/win-unpacked/resources");
const requireDesktop = createRequire(path.join(root, "apps/desktop/package.json"));
const { listPackage } = requireDesktop("@electron/asar");

export default {
  id: "desktop-template-packaging",
  title: "Desktop templates have one installable packaged copy",
  kind: "internal",
  requiresApp: false,
  steps: [{
    name: "Packaged template directories stay available without duplicate archives",
    run: async (ctx) => {
      let evidence;
      await ctx.prove("The packaged app keeps installable templates only in its real resources directory", {
        voiceover: "内置模板只在可复制的资源目录保留一份，安装包不再包含重复归档。",
        action: async () => {
          const asar = path.join(resources, "app.asar");
          const templates = path.join(resources, "server/dist/bundled-templates");
          ctx.assert(existsSync(asar), `Missing ${asar}; build the desktop directory first.`);
          ctx.assert(existsSync(templates), `Missing ${templates}; build the desktop directory first.`);
          const asarEntries = listPackage(asar).map((entry) => entry.replaceAll("\\", "/"));
          const resourceEntries = readdirSync(templates, { withFileTypes: true });
          const templateDirectories = resourceEntries.filter((entry) => entry.isDirectory());
          evidence = {
            resources,
            asarTemplateEntries: asarEntries.filter((entry) => entry.includes("/server/dist/bundled-templates/")).length,
            serverCodeEntries: asarEntries.filter((entry) => entry.includes("/server/dist/") && entry.endsWith(".js")).length,
            templateDirectories: templateDirectories.length,
            directoriesWithManifest: templateDirectories.filter((entry) => existsSync(path.join(templates, entry.name, "manifest.json"))).length,
            redundantArchives: resourceEntries.filter((entry) => entry.isFile() && entry.name.endsWith(".ipwp")).length,
            indexPresent: existsSync(path.join(templates, "core-v1-index.md")),
          };
          ctx.output("packaged-template-layout", JSON.stringify(evidence, null, 2));
        },
        assert: async () => {
          ctx.assert(evidence.asarTemplateEntries === 0, "Template files remain in app.asar.");
          ctx.assert(evidence.serverCodeEntries > 0, "The server runtime is missing from app.asar.");
          ctx.assert(evidence.templateDirectories > 0, "No installable template directories were packaged.");
          ctx.assert(evidence.directoriesWithManifest === evidence.templateDirectories, "A packaged template has no manifest.json.");
          ctx.assert(evidence.redundantArchives === 0, "Generated .ipwp archives were packaged beside their directories.");
          ctx.assert(evidence.indexPresent, "The bundled template index is missing.");
        },
      });
    },
  }],
};
