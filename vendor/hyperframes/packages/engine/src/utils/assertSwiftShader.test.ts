/**
 * Tests for assertSwiftShader and its companion readWebGlVendorInfo helper.
 *
 * We don't spin up a real Chrome here — the assertion's contract is "given a
 * WebGL info pair, accept SwiftShader and reject anything else." Tests inject
 * the info pair through the optional `readInfo` override that the
 * production code path leaves as a default.
 */

import { describe, expect, it } from "vitest";
import type { Page } from "puppeteer-core";
import {
  BROWSER_GPU_NOT_SOFTWARE,
  SwiftShaderAssertionError,
  assertSwiftShader,
} from "./assertSwiftShader.js";

// Minimal Page stub. Only assertSwiftShader's default `readInfo` ever touches
// `page.goto` / `page.evaluate`; when we inject a custom `readInfo` the page
// object is never used, so an empty cast is safe.
const stubPage = {} as unknown as Page;

describe("assertSwiftShader", () => {
  it("accepts the canonical SwiftShader vendor + renderer pair", async () => {
    await assertSwiftShader(stubPage, async () => ({
      vendor: "Google Inc. (Google)",
      renderer:
        "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)",
    }));
  });

  it("accepts SwiftShader regardless of trailing whitespace on vendor", async () => {
    await assertSwiftShader(stubPage, async () => ({
      vendor: "  Google Inc. (Google)  ",
      renderer: "SwiftShader",
    }));
  });

  it("accepts case-insensitive renderer token", async () => {
    await assertSwiftShader(stubPage, async () => ({
      vendor: "Google Inc. (Google)",
      renderer: "ANGLE (Google, swiftshader Device, swiftshader driver)",
    }));
  });

  it("throws SwiftShaderAssertionError when vendor is hardware-accelerated", async () => {
    let caught: unknown;
    try {
      await assertSwiftShader(stubPage, async () => ({
        vendor: "Google Inc. (NVIDIA Corporation)",
        renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4090, OpenGL 4.6)",
      }));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SwiftShaderAssertionError);
    expect((caught as SwiftShaderAssertionError).code).toBe(BROWSER_GPU_NOT_SOFTWARE);
    expect((caught as Error).message).toContain("non-SwiftShader");
    expect((caught as Error).message).toContain("--use-gl=swiftshader");
    expect((caught as SwiftShaderAssertionError).vendor).toBe("Google Inc. (NVIDIA Corporation)");
  });

  it("throws when the renderer string lacks SwiftShader even if vendor matches", async () => {
    // Google Inc. is the umbrella vendor for many ANGLE backends — vendor
    // alone is not enough; the renderer must actually mention SwiftShader.
    let caught: unknown;
    try {
      await assertSwiftShader(stubPage, async () => ({
        vendor: "Google Inc. (Google)",
        renderer: "ANGLE (Google, Vulkan 1.3.0 (Intel(R) UHD Graphics 630), OpenGL ES 3.0)",
      }));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SwiftShaderAssertionError);
    expect((caught as SwiftShaderAssertionError).code).toBe(BROWSER_GPU_NOT_SOFTWARE);
  });

  it("throws when both vendor and renderer are empty", async () => {
    // Some chrome:// pages return empty strings before the GPU info table
    // populates. We treat that as failure rather than silently passing.
    let caught: unknown;
    try {
      await assertSwiftShader(stubPage, async () => ({ vendor: "", renderer: "" }));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SwiftShaderAssertionError);
    expect((caught as SwiftShaderAssertionError).code).toBe(BROWSER_GPU_NOT_SOFTWARE);
  });

  it("propagates errors from the info reader without wrapping", async () => {
    const upstream = new Error("simulated CDP failure");
    let caught: unknown;
    try {
      await assertSwiftShader(stubPage, async () => {
        throw upstream;
      });
    } catch (err) {
      caught = err;
    }
    // Reader errors should not be masked by SwiftShaderAssertionError —
    // they are a separate failure class (probably retryable).
    expect(caught).toBe(upstream);
  });

  it("rejects an unrelated vendor that happens to contain the SwiftShader token in the renderer", async () => {
    // Defensive: if some future ANGLE build uses a non-Google vendor string
    // but still mentions SwiftShader in the renderer for some reason, we
    // still want to require the exact Google vendor signature.
    let caught: unknown;
    try {
      await assertSwiftShader(stubPage, async () => ({
        vendor: "Mesa/X.org",
        renderer: "llvmpipe (SwiftShader compatible)",
      }));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SwiftShaderAssertionError);
  });
});

describe("SwiftShaderAssertionError", () => {
  it("exposes the BROWSER_GPU_NOT_SOFTWARE typed-failure code", () => {
    const err = new SwiftShaderAssertionError("test", "v", "r");
    expect(err.code).toBe(BROWSER_GPU_NOT_SOFTWARE);
    expect(err.code).toBe("BROWSER_GPU_NOT_SOFTWARE");
  });
});
