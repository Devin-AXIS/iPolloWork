import { afterEach, describe, expect, it } from "vitest";
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
