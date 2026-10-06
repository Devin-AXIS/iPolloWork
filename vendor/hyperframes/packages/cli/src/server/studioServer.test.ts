import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioServer } from "./studioServer";

const temporaryProjects: string[] = [];

afterEach(() => {
  for (const projectDir of temporaryProjects.splice(0)) {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

function createProject(withLocalGsap: boolean, referenceLocalGsap = withLocalGsap): string {
  const projectDir = mkdtempSync(join(tmpdir(), "hyperframes-registry-install-"));
  temporaryProjects.push(projectDir);
  const localGsapScript = referenceLocalGsap ? '<script src="assets/gsap.min.js"></script>' : "";
  writeFileSync(
    join(projectDir, "index.html"),
    `${localGsapScript}<main data-composition-id="main" data-width="1280" data-height="720"></main>`,
  );
  if (withLocalGsap) {
    mkdirSync(join(projectDir, "assets"), { recursive: true });
    writeFileSync(join(projectDir, "assets", "gsap.min.js"), "window.gsap = window.gsap || {};");
  }
  return projectDir;
}

async function installRouteMap(projectDir: string): Promise<string> {
  const server = createStudioServer({
    projectDir,
    projectName: "registry-install-test",
  });
  try {
    const install = server.adapter.installRegistryBlock;
    if (!install) throw new Error("Bundled registry installation is unavailable");
    const project = {
      id: "registry-install-test",
      dir: projectDir,
      title: "Registry install test",
    };
    const result = await install({
      project,
      blockName: "route-map",
    });
    const installedPath = result.written[0];
    if (!installedPath) throw new Error("Registry install did not write a composition");
    return readFileSync(join(projectDir, installedPath), "utf-8");
  } finally {
    server.watcher.close();
  }
}

describe("bundled registry installation", () => {
  it("removes a redundant GSAP CDN script when the project owns GSAP", async () => {
    const installed = await installRouteMap(createProject(true));

    expect(installed).not.toContain("cdn.jsdelivr.net/npm/gsap");
    expect(installed).toContain('content="width=1280, height=720"');
  });

  it("keeps the GSAP CDN fallback when the project has no local runtime", async () => {
    const installed = await installRouteMap(createProject(false));

    expect(installed).toContain("cdn.jsdelivr.net/npm/gsap");
  });

  it("keeps the GSAP CDN fallback when a local runtime exists but is not referenced", async () => {
    const installed = await installRouteMap(createProject(true, false));

    expect(installed).toContain("cdn.jsdelivr.net/npm/gsap");
  });
});

describe("studio file events", () => {
  it("opens the event stream immediately and removes its listener when closed", async () => {
    const server = createStudioServer({
      projectDir: createProject(false),
      projectName: "events-test",
    });
    const removeListener = vi.spyOn(server.watcher, "removeListener");
    try {
      const response = await server.app.request("/api/events");
      const reader = response.body!.getReader();
      const first = await reader.read();
      expect(new TextDecoder().decode(first.value)).toBe(": connected\n\n");
      await reader.cancel();
      expect(removeListener).toHaveBeenCalledOnce();
    } finally {
      server.watcher.close();
    }
  });

  it("cleans up file events when the HTTP request is aborted", async () => {
    const server = createStudioServer({
      projectDir: createProject(false),
      projectName: "events-test",
    });
    const removeListener = vi.spyOn(server.watcher, "removeListener");
    const controller = new AbortController();
    try {
      const response = await server.app.request("/api/events", { signal: controller.signal });
      const reader = response.body!.getReader();
      await reader.read();
      controller.abort();
      expect(removeListener).toHaveBeenCalledOnce();
      await reader.cancel();
    } finally {
      server.watcher.close();
    }
  });
});

import { patchElementInHtml } from "@hyperframes/studio-server/source-mutation";
import { parseCompositionVariables } from "@hyperframes/parsers/composition";
import { parseHTML } from "linkedom";

describe("native text variable persistence", () => {
  it("saves canvas text and its shared data default together", () => {
    const defaults = [{ id: "items", label: "Data", type: "string", default: JSON.stringify({ version: 1, kind: "category-value", rows: [{ id: "a", value: 3, label: "指标" }] }) }];
    const source = `<html data-composition-variables='${JSON.stringify(defaults)}'><body><template><main data-composition-id="diagram"><span data-hf-id="metric" data-var-text="/items/rows/0/value">3</span><i data-hf-id="animated"></i></main></template></body></html>`;
    const patched = patchElementInHtml(source, { hfId: "metric" }, [{ type: "text-content", property: "textContent", value: "8.5" }]);
    expect(patched.matched).toBe(true);
    expect(patched.html).toContain('>8.5</span>');
    expect(patched.html).toContain('data-hf-id="animated"');
    const document = parseHTML(patched.html).document;
    const data = JSON.parse(String(parseCompositionVariables(document.documentElement as unknown as Element)[0]?.default));
    expect(data.rows).toEqual([{ id: "a", value: 8.5, label: "指标" }]);
    expect(() => patchElementInHtml(source, { hfId: "metric" }, [{ type: "text-content", property: "textContent", value: "bad" }])).toThrow("有效数字");
  });
});
