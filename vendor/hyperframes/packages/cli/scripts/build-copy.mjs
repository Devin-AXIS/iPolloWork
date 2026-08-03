// Cross-platform replacement for the previous `mkdir -p … && cp -r …` shell
// chain, which failed on Windows because `cp` doesn't accept `-r` there.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, "..");
const REPO_ROOT = resolve(CLI_ROOT, "..", "..");
const DIST = join(CLI_ROOT, "dist");

// Studio's vite build clears its dist before rewriting it; don't start the
// copy until both sentinels are present so we never observe a partial tree.
const STUDIO_WAIT_TIMEOUT_MS = 30_000;
const STUDIO_POLL_INTERVAL_MS = 250;

// fallow-ignore-next-line complexity
async function waitForStudioDist(dir) {
  const deadline = Date.now() + STUDIO_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const entries = new Set(readdirSync(dir));
      // vite emits `assets/` before rewriting `index.html` at the end of the
      // build — so once both are present, the tree is complete.
      if (entries.has("index.html") && entries.has("assets")) return;
    } catch {
      // dir doesn't exist yet — vite will create it
    }
    await sleep(STUDIO_POLL_INTERVAL_MS);
  }
  throw new Error(`[build-copy] timed out waiting for studio dist at ${dir}`);
}

function copyDir(src, dest) {
  cpSync(src, dest, { recursive: true, force: true });
}

function copyMdFiles(srcDir, destDir) {
  if (!existsSync(srcDir)) return;
  for (const name of readdirSync(srcDir)) {
    if (name.endsWith(".md")) {
      cpSync(join(srcDir, name), join(destDir, name));
    }
  }
}

// fallow-ignore-next-line complexity
async function main() {
  // tsup intentionally preserves dist because a running Windows preview can
  // hold fixed CLI files open. Clean copied trees here, immediately before
  // restaging them, so hashed Studio assets from previous builds never ship.
  for (const sub of ["studio", "docs", "templates", "docker"]) {
    rmSync(join(DIST, sub), { recursive: true, force: true });
    mkdirSync(join(DIST, sub), { recursive: true });
  }
  mkdirSync(join(DIST, "commands"), { recursive: true });

  const studioDist = resolve(CLI_ROOT, "..", "studio", "dist");
  await waitForStudioDist(studioDist);
  // Studio's build directory also contains its library bundle, declarations,
  // and source maps. The CLI server only serves the Vite browser application,
  // so keep those development artifacts out of npm and desktop packages.
  for (const entry of ["index.html", "assets", "icons", "favicon.svg"]) {
    const source = join(studioDist, entry);
    if (existsSync(source)) copyDir(source, join(DIST, "studio", entry));
  }

  for (const tmpl of ["blank", "_shared"]) {
    const source = join(CLI_ROOT, "src", "templates", tmpl);
    if (existsSync(source)) {
      copyDir(source, join(DIST, "templates", tmpl));
    }
  }

  // Bundle warm-grain from the repo registry so the built CLI can scaffold it
  // offline and CI smoke tests pick up PR-branch changes before merge to main.
  const warmGrainSrc = join(REPO_ROOT, "registry", "examples", "warm-grain");
  if (existsSync(warmGrainSrc)) {
    copyDir(warmGrainSrc, join(DIST, "templates", "warm-grain"));
  }

  const dockerfile = join(CLI_ROOT, "src", "docker", "Dockerfile.render");
  if (existsSync(dockerfile)) {
    cpSync(dockerfile, join(DIST, "docker", "Dockerfile.render"));
  }

  const layoutAuditScript = join(CLI_ROOT, "src", "commands", "layout-audit.browser.js");
  if (existsSync(layoutAuditScript)) {
    cpSync(layoutAuditScript, join(DIST, "commands", "layout-audit.browser.js"));
  }

  const contrastAuditScript = join(CLI_ROOT, "src", "commands", "contrast-audit.browser.js");
  if (existsSync(contrastAuditScript)) {
    cpSync(contrastAuditScript, join(DIST, "commands", "contrast-audit.browser.js"));
  }

  const motionSampleScript = join(CLI_ROOT, "src", "commands", "motion-sample.browser.js");
  if (existsSync(motionSampleScript)) {
    cpSync(motionSampleScript, join(DIST, "commands", "motion-sample.browser.js"));
  }

  // Player bundles for the standalone browser player used by `present` and
  // `play`. resolvePlayerPath/resolveSlideshowPath look for these alongside the
  // built CLI (dist/<name>.global.js), so they must ship in the package — the
  // monorepo-dev fallback paths don't exist once installed from npm. Without
  // this, `npx hyperframes present` fails with "@hyperframes/player not found".
  const playerDist = join(REPO_ROOT, "packages", "player", "dist");
  const playerGlobals = [
    [join(playerDist, "hyperframes-player.global.js"), join(DIST, "hyperframes-player.global.js")],
    [
      join(playerDist, "slideshow", "hyperframes-slideshow.global.js"),
      join(DIST, "hyperframes-slideshow.global.js"),
    ],
  ];
  for (const [src, dest] of playerGlobals) {
    if (existsSync(src)) {
      cpSync(src, dest);
    } else {
      console.warn(`[build-copy] player bundle not found, skipping: ${src}`);
    }
  }

  copyMdFiles(join(CLI_ROOT, "src", "docs"), join(DIST, "docs"));

  console.log("[build-copy] done");
}

await main();
