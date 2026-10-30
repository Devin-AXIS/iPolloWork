// Provisioning only: inference never calls this script or downloads files.
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(process.env.IPOLLOWORK_VIDEO_MODELS_PATH || fileURLToPath(new URL("../models", import.meta.url)));
const models = JSON.parse(await readFile(new URL("../src/extensions/video-enhancement-models.json", import.meta.url), "utf8"));
for (const model of models) {
  for (const file of model.files) {
    const destination = resolve(root, model.id, file.path);
    const current = await readFile(destination).catch(() => null);
    if (current?.length && (!file.sha256 || createHash("sha256").update(current).digest("hex") === file.sha256)) continue;
    const response = await fetch(`https://huggingface.co/${model.id}/resolve/${model.revision}/${file.path}`, { signal: AbortSignal.timeout(300_000) });
    if (!response.ok) throw new Error(`${model.id}/${file.path}: ${response.status}`);
    const data = Buffer.from(await response.arrayBuffer());
    if (file.sha256 && createHash("sha256").update(data).digest("hex") !== file.sha256) throw new Error(`Model checksum mismatch: ${file.path}`);
    await mkdir(dirname(destination), { recursive: true });
    const partial = destination + ".partial";
    try { await writeFile(partial, data); await rename(partial, destination); }
    finally { await rm(partial, { force: true }); }
    process.stdout.write(`Prepared ${model.id}/${file.path}\n`);
  }
}
await writeFile(resolve(root, "THIRD_PARTY_NOTICES.json"), JSON.stringify(models.map(({ id, revision, license, source }) => ({ id, revision, license, source })), null, 2));
await copyFile(new URL("../node_modules/@huggingface/transformers/LICENSE", import.meta.url), resolve(root, "Apache-2.0.txt"));
process.stdout.write(`Local video models ready: ${root}\n`);
