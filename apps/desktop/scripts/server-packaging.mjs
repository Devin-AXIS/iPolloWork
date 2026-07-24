import { copyFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_CONSTANTS_IMPORT = /from\s+["']\.\.\/\.\.\/\.\.\/constants\.json["']/g;

export function stageServerConstants({ serverDistDir, constantsSrc }) {
  copyFileSync(constantsSrc, resolve(serverDistDir, "constants.json"));

  const patchedFiles = [];
  for (const entry of readdirSync(serverDistDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
    const filePath = resolve(serverDistDir, entry.name);
    const source = readFileSync(filePath, "utf8");
    const patched = source.replace(REPO_CONSTANTS_IMPORT, 'from "./constants.json"');
    if (patched === source) continue;
    writeFileSync(filePath, patched, "utf8");
    patchedFiles.push(entry.name);
  }

  return patchedFiles;
}
