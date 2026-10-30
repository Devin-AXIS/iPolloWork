import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioServer, closeThumbnailBrowser, type StudioServer } from "./studioServer.js";

const mocks = vi.hoisted(() => ({
  resolveRenderBrowser: vi.fn(),
  acquireBrowser: vi.fn(),
  ensureBrowser: vi.fn(),
  createRenderJob: vi.fn(() => ({ id: "job", perfSummary: undefined })),
  executeRenderJob: vi.fn(async () => {}),
}));

vi.mock("@hyperframes/engine", () => ({
  acquireBrowser: mocks.acquireBrowser,
  buildChromeArgs: vi.fn(() => []),
}));
vi.mock("../browser/manager.js", async importOriginal => ({
  ...(await importOriginal<typeof import("../browser/manager.js")>()),
  ensureBrowser: mocks.ensureBrowser,
}));

vi.mock("../browser/preflight.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../browser/preflight.js")>()),
  resolveRenderBrowser: mocks.resolveRenderBrowser,
}));

// Under vitest the module is a .ts file, which would take the dev-mode producer load.
vi.mock("../utils/env.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/env.js")>()),
  isDevMode: () => false,
}));

// Not importOriginal: loading the real producer takes longer than a wait timeout on a cold Windows runner.
vi.mock("@hyperframes/producer", () => ({
  createRenderJob: mocks.createRenderJob,
  executeRenderJob: mocks.executeRenderJob,
}));

vi.mock("./studioRenderTelemetry.js", () => ({
  emitStudioRenderComplete: vi.fn(),
  emitStudioRenderError: vi.fn(),
}));

const dirs: string[] = [];
let server: StudioServer | undefined;

afterEach(async () => {
  await closeThumbnailBrowser();
  server?.watcher.close();
  server = undefined;
  delete process.env.PRODUCER_HEADLESS_SHELL_PATH;
  vi.clearAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function startStudioRender() {
  const dir = mkdtempSync(join(tmpdir(), "hf-studio-render-browser-"));
  dirs.push(dir);
  server = createStudioServer({ projectDir: dir });
  return server.adapter.startRender({
    project: { dir, id: "p", title: "p" },
    outputPath: join(dir, "out.mp4"),
    format: "mp4",
    fps: { num: 30, den: 1 },
    quality: "draft",
    jobId: "job",
  } as never);
}

describe("Studio render browser resolution", () => {
  it("refuses the render with the resolver's message instead of continuing without a browser", async () => {
    mocks.resolveRenderBrowser.mockRejectedValue(
      new Error("Chrome not found Chrome Headless Shell is required for local rendering."),
    );

    const state = startStudioRender();
    await vi.waitFor(() => expect(state.status).toBe("failed"), { timeout: 10_000 });

    expect(state.error).toBe(
      "Chrome not found Chrome Headless Shell is required for local rendering.",
    );
    expect(mocks.createRenderJob).not.toHaveBeenCalled();
  });

  it("hands the resolved browser to the producer before the job is created", async () => {
    mocks.resolveRenderBrowser.mockResolvedValue({
      executablePath: "/opt/chrome",
      source: "cache",
    });

    startStudioRender();
    await vi.waitFor(() => expect(mocks.createRenderJob).toHaveBeenCalledTimes(1), {
      timeout: 10_000,
    });

    expect(process.env.PRODUCER_HEADLESS_SHELL_PATH).toBe("/opt/chrome");
  });
});


describe("Studio thumbnail screenshot boundary", () => {
  it("serves Puppeteer's Uint8Array pixels through the Buffer thumbnail adapter contract", async () => {
    const pixels=new Uint8Array([255,216,255,217]);
    const page={setViewport:vi.fn(async()=>{}),goto:vi.fn(async()=>{}),
      waitForFunction:vi.fn(async()=>{}),evaluate:vi.fn(async()=>{}),
      screenshot:vi.fn(async()=>pixels),close:vi.fn(async()=>{})};
    const release=vi.fn(async()=>{});
    mocks.ensureBrowser.mockResolvedValue({executablePath:"/opt/chrome"});
    mocks.acquireBrowser.mockResolvedValue({browser:{connected:true,newPage:vi.fn(async()=>page),on:vi.fn()},release});
    const dir=mkdtempSync(join(tmpdir(),"hf-thumbnail-bytes-"));dirs.push(dir);
    writeFileSync(join(dir,"index.html"),'<main data-width="1280" data-height="720"></main>');
    server=createStudioServer({projectDir:dir,projectName:"workspace"});
    const response=await server.app.request("http://localhost/api/projects/workspace/thumbnail/index.html");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(pixels);
    expect(page.screenshot).toHaveBeenCalledOnce();expect(page.close).toHaveBeenCalledOnce();
    await closeThumbnailBrowser();expect(release).toHaveBeenCalledOnce();
  });
});
