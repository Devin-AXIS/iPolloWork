import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function fingerprint(paths, contents) {
  const hash = createHash("sha256");
  function visit(path) {
    hash.update(`${path}\0`);
    if (!existsSync(path)) {
      hash.update("missing\0");
      return;
    }
    const info = statSync(path);
    if (info.isDirectory()) {
      for (const entry of readdirSync(path).sort()) {
        if (contents && ["node_modules", "dist", ".git"].includes(entry)) continue;
        visit(resolve(path, entry));
      }
    } else {
      hash.update(contents ? readFileSync(path) : `${info.size}:${info.mtimeMs}`);
      hash.update("\0");
    }
  }
  for (const path of paths) visit(path);
  return hash.digest("hex");
}

// Development only: release builds continue to run their full validation path.
export function buildIfChanged({ name, cacheFile, inputs, outputs, build, force = false }) {
  const startedAt = Date.now();
  const key = fingerprint([
    fileURLToPath(import.meta.url),
    ...inputs,
  ], true);
  const target = `${process.platform}:${process.arch}:${process.version}`;
  let stamp;
  try {
    stamp = JSON.parse(readFileSync(cacheFile, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }
  if (!force && stamp?.key === key && stamp.target === target
    && outputs.every(existsSync) && stamp.outputs === fingerprint(outputs, false)) {
    console.log(`[electron-dev] ${name}: unchanged, skipped (${Date.now() - startedAt}ms)`);
    return false;
  }

  console.log(`[electron-dev] ${name}: building...`);
  build();
  if (!outputs.every(existsSync)) throw new Error(`${name} build did not produce its required outputs.`);
  mkdirSync(dirname(cacheFile), { recursive: true });
  writeFileSync(cacheFile, `${JSON.stringify({ key, target, outputs: fingerprint(outputs, false) })}\n`);
  console.log(`[electron-dev] ${name}: built (${Date.now() - startedAt}ms)`);
  return true;
}
