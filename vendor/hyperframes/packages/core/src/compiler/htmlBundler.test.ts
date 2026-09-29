// @vitest-environment node
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { bundleToSingleHtml } from "./htmlBundler.js";

it("inlines versioned SVG assets without corrupting base64 and preserves fragment references", async () => {
  const project = await mkdtemp(join(tmpdir(), "hf-versioned-svg-"));
  try {
    await writeFile(join(project, "logo.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><path id="mark" d="M0 0h10v10z"/></svg>');
    await writeFile(join(project, "index.html"), '<html><body><main data-composition-id="root"><img src="logo.svg?v=2"><img src="logo.svg?v=3#mark"></main></body></html>');
    const html = await bundleToSingleHtml(project);
    expect(html).toContain("data:image/svg+xml;base64,");
    expect(html).not.toContain("?v=");
    expect(html).toContain("#mark");
  } finally { await rm(project, { recursive: true, force: true }); }
});

it("bundles a shared local animation library once across root and nested compositions", async () => {
  const project = await mkdtemp(join(tmpdir(), "hf-shared-animation-"));
  try {
    await mkdir(join(project, "compositions"));
    await writeFile(join(project, "shared.js"), "window.animationLibraryLoads = (window.animationLibraryLoads || 0) + 1;");
    await writeFile(join(project, "index.html"), `<!doctype html><html><head></head><body>
      <main data-composition-id="root" data-width="1920" data-height="1080" data-duration="8">
        <section data-composition-id="scene" data-composition-src="compositions/scene.html" data-start="0" data-duration="8"></section>
      </main><script src="./shared.js"></script><script src="shared.js"></script>
    </body></html>`);
    await writeFile(join(project, "compositions/scene.html"), `<!doctype html><html><head></head><body>
      <div data-composition-id="scene" data-width="1920" data-height="1080" data-duration="8">Shared motion</div>
      <script src="shared.js"></script><script>window.sceneLoaded = true;</script>
    </body></html>`);
    const html = await bundleToSingleHtml(project);
    expect(html.match(/animationLibraryLoads\s*=/g)).toHaveLength(1);
    expect(html).toContain("sceneLoaded");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
