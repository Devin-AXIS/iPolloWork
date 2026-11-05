// Shared Puppeteer browser management and thumbnail generation for Studio dev server.

import { existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { join, win32 as pathWin32 } from "node:path";
import {
  getElementScreenshotClip,
  reviewVideoRuntime,
  type VideoRuntimeReview,
  thumbnailDeviceScaleFactor,
  type ScreenshotClip,
} from "@hyperframes/studio-server";
import { createStudioDevRenderBodyScripts } from "./vite.studioMotion";
import { seekThumbnailPreview } from "./vite.thumbnail";
import { reviewComponentVariables } from "@hyperframes/studio-server/screenshot-clip";
import { resolveHeadlessShellPath } from "../engine/src/index";

let browser: import("puppeteer-core").Browser | null = null;
let browserLaunch: Promise<import("puppeteer-core").Browser | null> | null = null;
let browserDescription = "unknown browser";

function systemChromePaths(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  if (platform === "win32") {
    const programFiles = env["PROGRAMFILES"] ?? "C:\\Program Files";
    const programFilesX86 = env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)";
    const localAppData = env["LOCALAPPDATA"];
    return [
      pathWin32.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      pathWin32.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      ...(localAppData
        ? [pathWin32.join(localAppData, "Google", "Chrome", "Application", "chrome.exe")]
        : []),
    ];
  }
  if (platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ];
  }
  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
}

function findPuppeteerCacheChrome(
  env: NodeJS.ProcessEnv,
  pathExists: (path: string) => boolean,
  platform: NodeJS.Platform,
  readDirectories: (path: string) => string[] = readdirSync,
): string | undefined {
  const chromeRoot = join(
    env["PUPPETEER_CACHE_DIR"] ?? join(homedir(), ".cache", "puppeteer"),
    "chrome",
  );
  let versionDirs: string[];
  try {
    versionDirs = readDirectories(chromeRoot);
  } catch {
    return undefined;
  }
  const buildOrder = (directory: string): number =>
    (directory.split("-").pop() ?? "")
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0)
      .reduce((order, part) => order * 100000 + part, 0);
  const relativeCandidates =
    platform === "win32"
      ? ["chrome-win64/chrome.exe"]
      : [
          "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
          "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
          "chrome-linux64/chrome",
        ];
  for (const directory of versionDirs.sort((left, right) => buildOrder(right) - buildOrder(left))) {
    for (const relativePath of relativeCandidates) {
      const executable = join(chromeRoot, directory, relativePath);
      if (pathExists(executable)) return executable;
    }
  }
  return undefined;
}


function browserVersion(
  executable: string,
  run: (file: string) => string = (file) => {
    // Windows GUI Chrome does not reliably exit for --version. Never start it
    // synchronously; the launched browser supplies its version through CDP.
    if (process.platform === "win32") return "";
    return execFileSync(file, ["--version"], { encoding: "utf8", timeout: 2000, windowsHide: true });
  },
): string | undefined {
  try {
    return run(executable).trim() || undefined;
  } catch {
    return undefined;
  }
}

function supportedSystemChrome(
  candidates: string[],
  versionOf: (path: string) => string | undefined,
  platform: NodeJS.Platform,
): string | undefined {
  return candidates.find((candidate) => {
    const match = versionOf(candidate)?.match(/(?:Chrome|Chromium)[ /](\d+)/i);
    return match ? Number(match[1]) >= 134 : platform === "win32";
  });
}

/** Resolve explicit overrides, Puppeteer's managed browser, then compatible system installs. */
export function findSystemChrome(
  env: NodeJS.ProcessEnv = process.env,
  pathExists: (path: string) => boolean = existsSync,
  platform: NodeJS.Platform = process.platform,
  versionOf: (path: string) => string | undefined = browserVersion,
  readDirectories: (path: string) => string[] = readdirSync,
): string | undefined {
  const override = [
    env["HYPERFRAMES_BROWSER_PATH"],
    env["PRODUCER_HEADLESS_SHELL_PATH"],
    env["PUPPETEER_EXECUTABLE_PATH"],
    env["CHROME_PATH"],
    env["CHROME_BIN"],
  ].find((candidate): candidate is string => Boolean(candidate) && pathExists(candidate));
  return (
    override ??
    resolveHeadlessShellPath() ??
    findPuppeteerCacheChrome(env, pathExists, platform, readDirectories) ??
    supportedSystemChrome(systemChromePaths(env, platform).filter(pathExists), versionOf, platform)
  );
}

async function getSharedBrowser(): Promise<import("puppeteer-core").Browser | null> {
  if (browser?.connected) return browser;
  if (browserLaunch) return browserLaunch;
  const launch = (async () => {
    const puppeteer = await import("puppeteer-core");
    const executablePath = findSystemChrome();
    if (!executablePath) return null;
    browserDescription = executablePath;
    let launched: import("puppeteer-core").Browser | null = null;
    try {
      launched = await puppeteer.default.launch({
        headless: true,
        executablePath,
        args: [
          "--no-sandbox",
          "--disable-dev-shm-usage",
          "--enable-webgl",
          "--ignore-gpu-blocklist",
          "--use-gl=angle",
          "--use-angle=swiftshader",
          "--enable-unsafe-swiftshader",
        ],
      });
      const version = await launched.version();
      browserDescription = `${executablePath}, ${version}`;
      const major = version.match(/(?:Chrome|Chromium)[ /](\d+)/i)?.[1];
      if (major && Number(major) < 134) {
        throw new Error(`Chrome ${major} is older than the supported major 134`);
      }
      browser = launched;
    } catch (error) {
      await launched?.close().catch(() => {});
      console.warn(
        `[Studio] Thumbnail browser launch failed (${browserDescription}):`,
        error instanceof Error ? error.message : error,
      );
      throw error;
    }
    return browser;
  })();
  browserLaunch = launch;
  try {
    return await launch;
  } finally {
    if (browserLaunch === launch) browserLaunch = null;
  }
}

async function applyStudioRenderBodyScriptsToThumbnailPage(
  page: import("puppeteer-core").Page,
  projectDir: string,
  activeCompositionPath: string,
): Promise<void> {
  const scripts = createStudioDevRenderBodyScripts(projectDir, { activeCompositionPath });
  for (const script of scripts) await page.addScriptTag({ content: script });
}

async function reapplyStudioRenderBodyScriptsToThumbnailPage(
  page: import("puppeteer-core").Page,
): Promise<void> {
  await page.evaluate(() => {
    const runtimeWindow = window as Window & {
      __hfStudioManualEditsApply?: () => number;
      __hfStudioMotionApply?: () => number;
    };
    runtimeWindow.__hfStudioManualEditsApply?.();
    runtimeWindow.__hfStudioMotionApply?.();
  });
}

export interface GenerateThumbnailOptions {
  runtimeReview?: boolean;
  componentVariables?: { elementId: string; values: Record<string, string | number | boolean> };
  project: { dir: string };
  compPath: string;
  seekTime: number;
  previewUrl: string;
  width: number;
  height: number;
  outputWidth: number;
  outputHeight: number;
  format?: "jpeg" | "png";
  selector?: string;
  selectorIndex?: number;
  signal: AbortSignal;
}

async function prepareThumbnailPage(
  page: import("puppeteer-core").Page,
  opts: GenerateThumbnailOptions,
): Promise<void> {
  await page.setViewport({
    width: opts.width,
    height: opts.height,
    deviceScaleFactor: thumbnailDeviceScaleFactor(opts),
  });
  await page.goto(opts.previewUrl, { waitUntil: "domcontentloaded", timeout: 10000 });
  await page.evaluate(() => {
    document.documentElement.style.background = "#1c2028";
    document.body.style.background = "#1c2028";
    document.body.style.margin = "0";
    document.body.style.overflow = "hidden";
  });
  await page
    .waitForFunction(`!!(window.__timelines && Object.keys(window.__timelines).length > 0)`, {
      timeout: 5000,
    })
    .catch(() => {});
  await seekThumbnailPreview(page, opts.seekTime);
  await page.evaluate("window.__hfWaitForSeekCompletion?.()");
  await applyStudioRenderBodyScriptsToThumbnailPage(page, opts.project.dir, opts.compPath);
  await page.evaluate("document.fonts?.ready");
  await new Promise((resolve) => setTimeout(resolve, 200));
  await reapplyStudioRenderBodyScriptsToThumbnailPage(page);
}

async function captureThumbnail(
  page: import("puppeteer-core").Page,
  format: GenerateThumbnailOptions["format"],
  clip: ScreenshotClip | undefined,
): Promise<Buffer> {
  const clipOption = clip ? { clip } : {};
  const screenshot = await page.screenshot(
    format === "png"
      ? { type: "png", ...clipOption }
      : { type: "jpeg", quality: 75, ...clipOption },
  );
  return Buffer.from(screenshot);
}

export async function generateThumbnail(opts: GenerateThumbnailOptions): Promise<Buffer | VideoRuntimeReview | null> {
  if (opts.signal.aborted) return null;
  let page: import("puppeteer-core").Page | null = null;
  const closePage = () => void page?.close().catch(() => {});
  opts.signal.addEventListener("abort", closePage, { once: true });
  try {
    const sharedBrowser = await getSharedBrowser();
    if (!sharedBrowser || opts.signal.aborted) return null;
    page = await sharedBrowser.newPage();
    if (opts.signal.aborted) return null;
    await prepareThumbnailPage(page, opts);
    if (opts.componentVariables) return await page.evaluate(reviewComponentVariables, opts.componentVariables);
    if (opts.runtimeReview) return await page.evaluate(reviewVideoRuntime);
    const clip = opts.selector
      ? await page.evaluate(getElementScreenshotClip, opts.selector, opts.selectorIndex)
      : undefined;
    if (opts.signal.aborted) return null;
    return await captureThumbnail(page, opts.format, clip);
  } catch (error) {
    if (!opts.signal.aborted) {
      console.warn(
        `[Studio] Thumbnail generation failed (${browserDescription}):`,
        error instanceof Error ? error.message : error,
      );
    }
    return null;
  } finally {
    opts.signal.removeEventListener("abort", closePage);
    await page?.close().catch(() => {});
  }
}
