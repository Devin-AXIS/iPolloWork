import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import createService from "../dist/package/service/recorder.ts";

const dataDir = resolve(process.env.IPOLLOWORK_RECORDER_DATA_DIR || ".runtime");
const manifest = JSON.parse(await readFile(new URL("../ipollowork.plugin.json", import.meta.url), "utf8"));
await mkdir(dataDir, { recursive: true, mode: 0o700 });
const service = await createService({
  plugin: { id: manifest.id, version: manifest.package.version },
  storage: { dataDir },
  workspace: { root: process.cwd() },
});
const workbench = await service.actions["open-workbench"]({}, {});
process.stdout.write(`${JSON.stringify(workbench)}\n`);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => { await service.dispose(); process.exit(0); });
}
