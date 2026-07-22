/**
 * assertSwiftShader — verify Chrome's WebGL is rendered by SwiftShader.
 *
 * Distributed renders pixel-lock on the GPU backend: hardware GL is bitwise
 * unstable across worker machines (different drivers, driver versions, GL
 * extension sets, even differing fp32 rounding on the same vendor). Chunk
 * workers launch Chrome with `--use-gl=swiftshader --use-angle=swiftshader`
 * so every worker uses the same pure-software GL implementation.
 *
 * Those Chrome flags are advisory: a misconfigured base image, a missing
 * SwiftShader library, or a `chrome://gpu` blocklist override can silently
 * downgrade to system GL. The distributed pipeline cannot detect the
 * downgrade by sampling pixels (one machine = one render), so we read
 * `chrome://gpu` directly after launch and refuse to render if the active
 * GL renderer is anything other than SwiftShader.
 */

import type { Page } from "puppeteer-core";

/**
 * Error code classifying this failure as non-retryable for distributed
 * workflow adapters — a downgraded GPU on a worker will not heal on retry.
 */
export const BROWSER_GPU_NOT_SOFTWARE = "BROWSER_GPU_NOT_SOFTWARE";

/**
 * Error thrown when chrome://gpu reports a non-SwiftShader WebGL backend.
 *
 * Carries a `code` property so the adapter can match on it without parsing
 * the message string — Temporal/Step Functions retry policies key off the
 * code, not the message.
 */
export class SwiftShaderAssertionError extends Error {
  readonly code: typeof BROWSER_GPU_NOT_SOFTWARE = BROWSER_GPU_NOT_SOFTWARE;
  readonly vendor: string;
  readonly renderer: string;

  constructor(message: string, vendor: string, renderer: string) {
    super(message);
    this.name = "SwiftShaderAssertionError";
    this.vendor = vendor;
    this.renderer = renderer;
  }
}

/**
 * SwiftShader identifies itself on `chrome://gpu` and in
 * `WEBGL_debug_renderer_info` with this exact vendor string. Locking to
 * Google's own GL string (rather than a substring match on "swiftshader")
 * avoids false-positives from third-party ANGLE backends that incidentally
 * mention SwiftShader in unrelated diagnostic text.
 */
const SWIFTSHADER_VENDOR_SIGNATURE = "Google Inc. (Google)";
/**
 * Renderer string contains the literal "SwiftShader" token. We match
 * case-insensitively and only require the substring; Chrome occasionally
 * appends a build suffix (e.g. " Vulkan 1.3").
 */
const SWIFTSHADER_RENDERER_TOKEN = "swiftshader";

interface WebGlInfo {
  vendor: string;
  renderer: string;
}

/**
 * Read the WebGL vendor/renderer strings from a live `chrome://gpu` page.
 *
 * Extracted from `assertSwiftShader` so tests can stub the navigation +
 * extraction step. Returns the raw values; callers decide how to interpret
 * them. Both fields are best-effort — Chrome returns empty strings if the
 * GPU info table hasn't populated yet, which the caller treats as failure.
 */
export async function readWebGlVendorInfo(page: Page): Promise<WebGlInfo> {
  await page.goto("chrome://gpu", { waitUntil: "domcontentloaded", timeout: 30_000 });
  // The "GL_VENDOR" / "GL_RENDERER" rows live inside <info-view> shadow DOM
  // in modern Chrome. We pull the structured `info_log_` payload off the
  // page-level globals instead of querying the DOM, since the DOM layout has
  // drifted across versions.
  const info = await page.evaluate((): WebGlInfo => {
    type Row = { description?: string; value?: string };
    type InfoLog = { graphics_info?: { basic_info?: Row[] } };
    const w = window as unknown as { browserBridge?: { gpuInfo_?: InfoLog } };
    const rows: Row[] = w.browserBridge?.gpuInfo_?.graphics_info?.basic_info ?? [];
    let vendor = "";
    let renderer = "";
    for (const row of rows) {
      if (typeof row.description !== "string" || typeof row.value !== "string") continue;
      if (row.description === "GL_VENDOR") vendor = row.value;
      else if (row.description === "GL_RENDERER") renderer = row.value;
    }
    return { vendor, renderer };
  });
  return info;
}

/**
 * Validate that the active WebGL renderer is SwiftShader. Throws
 * `SwiftShaderAssertionError` otherwise.
 *
 * Pass an optional `readInfo` override for tests that don't have a real
 * Puppeteer `Page`. The default implementation navigates to `chrome://gpu`
 * and parses the GL_VENDOR / GL_RENDERER rows.
 */
export async function assertSwiftShader(
  page: Page,
  readInfo: (page: Page) => Promise<WebGlInfo> = readWebGlVendorInfo,
): Promise<void> {
  const { vendor, renderer } = await readInfo(page);

  const vendorMatches = vendor.trim() === SWIFTSHADER_VENDOR_SIGNATURE;
  const rendererMatches = renderer.toLowerCase().includes(SWIFTSHADER_RENDERER_TOKEN);

  if (vendorMatches && rendererMatches) return;

  throw new SwiftShaderAssertionError(
    `[assertSwiftShader] Chrome reported a non-SwiftShader WebGL backend. ` +
      `Distributed renders require pure-software GL for pixel-identical retries. ` +
      `Got vendor=${JSON.stringify(vendor)} renderer=${JSON.stringify(renderer)}; ` +
      `expected vendor=${JSON.stringify(SWIFTSHADER_VENDOR_SIGNATURE)} renderer to contain "SwiftShader". ` +
      `Ensure Chrome was launched with --use-gl=swiftshader --use-angle=swiftshader and that the ` +
      `SwiftShader libraries are present in the runtime image.`,
    vendor,
    renderer,
  );
}
