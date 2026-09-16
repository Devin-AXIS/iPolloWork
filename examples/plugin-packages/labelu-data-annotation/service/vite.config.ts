import { cp, mkdir } from "node:fs/promises";
import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const serviceRoot = fileURLToPath(new URL(".", import.meta.url));
const serviceDist = resolve(serviceRoot, "dist");
const pdfjsRoot = resolve(serviceRoot, "../node_modules/pdfjs-dist");

export default defineConfig({
  plugins: [{
    name: "copy-pdfjs-text-assets",
    async closeBundle() {
      const target = resolve(serviceDist, "pdfjs");
      await mkdir(target, { recursive: true });
      await cp(resolve(pdfjsRoot, "cmaps"), resolve(target, "cmaps"), { recursive: true });
      await cp(resolve(pdfjsRoot, "standard_fonts"), resolve(target, "standard_fonts"), { recursive: true });
      await cp(resolve(pdfjsRoot, "legacy/build/pdf.worker.mjs"), resolve(serviceDist, "pdf.worker.mjs"));
    },
  }],
  ssr: {
    noExternal: ["pdfjs-dist", "word-extractor", "yauzl", "saxes", "xmlchars", "fd-slicer", "buffer-crc32", "pend"],
  },
  build: {
    emptyOutDir: true,
    minify: false,
    outDir: serviceDist,
    rollupOptions: {
      external: [...builtinModules, /^node:/, "canvas", "path2d"],
      input: resolve(serviceRoot, "data-annotation.ts"),
      output: {
        entryFileNames: "data-annotation.mjs",
        format: "es",
      },
    },
    ssr: true,
    target: "node20",
  },
});
