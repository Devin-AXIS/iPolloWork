import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const templatesRoot = resolve("apps/server/bundled-templates");
const templateIds = [
  "ipollowork.pptx-compatible-brief",
  "ipollowork.pptx-compatible-pitch",
  "ipollowork.pptx-compatible-report",
];
const electron = resolve("node_modules/.pnpm/electron@35.7.5/node_modules/electron/dist/electron.exe");

async function main() {
  const jobs = await Promise.all(templateIds.map(async (id) => {
    const directory = join(templatesRoot, id);
    const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
    return { preview: join(directory, ".cover-preview.html"), entry: manifest.entry, directory, cover: join(directory, manifest.cover) };
  }));
  const runnerDirectory = await mkdtemp(join(tmpdir(), "ipw-pptx-cover-"));
  const runner = join(runnerDirectory, "main.cjs");

  try {
    await Promise.all(jobs.map((job) => writeFile(job.preview, `<!doctype html><html><head><meta charset="utf-8"><style>html,body,iframe{width:960px;height:540px;margin:0;border:0;overflow:hidden}iframe{display:block}</style></head><body><iframe src="./${job.entry}"></iframe></body></html>`)));
    await writeFile(runner, `const { app, BrowserWindow } = require("electron");
const { writeFile } = require("node:fs/promises");
const jobs = JSON.parse(process.env.IPW_PPTX_COVER_JOBS);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 960, height: 540, useContentSize: true, webPreferences: { offscreen: true, backgroundThrottling: false, webSecurity: false } });
  window.setContentSize(960, 540);
  for (const job of jobs) {
    await window.loadFile(job.preview);
    await window.webContents.executeJavaScript("document.querySelector('iframe').contentDocument.fonts.ready");
    await delay(120);
    const image = await window.webContents.capturePage({ x: 0, y: 0, width: 960, height: 540 });
    await writeFile(job.cover, image.toPNG());
  }
  window.destroy();
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
`);
    await new Promise((resolveProcess, reject) => {
      let stderr = "";
      const child = spawn(electron, [runner], { env: { ...process.env, IPW_PPTX_COVER_JOBS: JSON.stringify(jobs) }, stdio: ["ignore", "ignore", "pipe"] });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.once("error", reject);
      child.once("exit", (code) => code === 0 ? resolveProcess() : reject(new Error(`Cover render exited with ${code}: ${stderr.trim()}`)));
    });
  } finally {
    await Promise.all(jobs.map((job) => rm(job.preview, { force: true })));
    await rm(runnerDirectory, { recursive: true, force: true });
  }
}

await main();
