import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("background-removal/manager — selectProviders", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env["HYPERFRAMES_CUDA"];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns CPU explicitly when --device cpu", async () => {
    vi.doMock("node:os", () => ({
      platform: () => "darwin",
      arch: () => "arm64",
      homedir: () => "/tmp",
    }));
    const { selectProviders } = await import("./manager.js");
    const choice = selectProviders("cpu");
    expect(choice.providers).toEqual(["cpu"]);
    expect(choice.label).toBe("CPU");
  });

  it("auto picks CoreML on darwin-arm64", async () => {
    vi.doMock("node:os", () => ({
      platform: () => "darwin",
      arch: () => "arm64",
      homedir: () => "/tmp",
    }));
    const { selectProviders } = await import("./manager.js");
    const choice = selectProviders("auto");
    expect(choice.providers).toEqual(["coreml", "cpu"]);
    expect(choice.label).toBe("CoreML");
  });

  it("auto falls back to CPU on linux without HYPERFRAMES_CUDA", async () => {
    vi.doMock("node:os", () => ({
      platform: () => "linux",
      arch: () => "x64",
      homedir: () => "/tmp",
    }));
    const { selectProviders } = await import("./manager.js");
    const choice = selectProviders("auto");
    expect(choice.providers).toEqual(["cpu"]);
    expect(choice.label).toBe("CPU");
  });

  it("auto picks CUDA on linux when HYPERFRAMES_CUDA=1", async () => {
    process.env["HYPERFRAMES_CUDA"] = "1";
    vi.doMock("node:os", () => ({
      platform: () => "linux",
      arch: () => "x64",
      homedir: () => "/tmp",
    }));
    const { selectProviders } = await import("./manager.js");
    const choice = selectProviders("auto");
    expect(choice.providers).toEqual(["cuda", "cpu"]);
    expect(choice.label).toBe("CUDA");
  });

  it("--device coreml on linux throws", async () => {
    vi.doMock("node:os", () => ({
      platform: () => "linux",
      arch: () => "x64",
      homedir: () => "/tmp",
    }));
    const { selectProviders } = await import("./manager.js");
    expect(() => selectProviders("coreml")).toThrow(/CoreML execution provider not available/);
  });

  it("--device cuda without env var throws", async () => {
    vi.doMock("node:os", () => ({
      platform: () => "linux",
      arch: () => "x64",
      homedir: () => "/tmp",
    }));
    const { selectProviders } = await import("./manager.js");
    expect(() => selectProviders("cuda")).toThrow(/CUDA execution provider not available/);
  });
});
