import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const plugin = JSON.parse(await readFile(resolve(root, "external-plugins/deepseek-harness/video-studio/package.json"), "utf8"));
const upstream = JSON.parse(await readFile(resolve(root, "vendor/hyperframes/packages/cli/package.json"), "utf8"));
const contract = await readFile(resolve(root, "packages/video-studio/src/project.ts"), "utf8");
const contractVersion = /HYPERFRAMES_VERSION\s*=\s*"([^"]+)"/.exec(contract)?.[1];
const pluginVersion = plugin.dependencies?.hyperframes;
const upstreamVersion = upstream.version;

if (!contractVersion || pluginVersion !== contractVersion || upstreamVersion !== contractVersion) {
  throw new Error(`HyperFrames version drift: contract=${contractVersion ?? "missing"}, deepseek-ivideo=${pluginVersion ?? "missing"}, iPolloWork=${upstreamVersion ?? "missing"}.`);
}

console.log(`HyperFrames versions are synchronized at ${contractVersion}.`);
