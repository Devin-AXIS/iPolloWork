import { cp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { PluginOption } from "vite";
import { templateManifestV1Schema, type TemplateManifestV1 } from "../../../packages/types/src/templates";

export function createBundledTemplateCopyPlugin(options: {
  repositoryRoot: string;
  outputPluginRoot: string;
  allows: (manifest: TemplateManifestV1) => boolean;
  name: string;
  indexTitle?: string;
}): PluginOption {
  return {
    name: options.name,
    transformIndexHtml(html) {
      return options.indexTitle
        ? html.replace("iPolloWork Design Studio", options.indexTitle)
        : html;
    },
    async closeBundle() {
      const sourceRoot = resolve(options.repositoryRoot, "apps/server/bundled-templates");
      const destinationRoot = resolve(options.outputPluginRoot, "lib/templates");
      await rm(destinationRoot, { recursive: true, force: true });
      await mkdir(destinationRoot, { recursive: true });
      for (const name of await readdir(sourceRoot)) {
        const directory = resolve(sourceRoot, name);
        if (!(await stat(directory)).isDirectory()) continue;
        const parsed = templateManifestV1Schema.safeParse(JSON.parse(await readFile(resolve(directory, "manifest.json"), "utf8")));
        if (parsed.success && options.allows(parsed.data)) {
          await cp(directory, resolve(destinationRoot, name), { recursive: true, errorOnExist: true });
        }
      }
    },
  };
}
