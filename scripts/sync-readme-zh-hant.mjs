#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import OpenCC from "opencc-js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(root, "translated_readmes/README_ZH.md");
const targetPath = resolve(root, "translated_readmes/README_ZH_hk.md");
const checkOnly = process.argv.slice(2).includes("--check");
const unsupportedArgs = process.argv.slice(2).filter((arg) => arg !== "--check");

if (unsupportedArgs.length > 0) {
  console.error(`Unsupported arguments: ${unsupportedArgs.join(", ")}`);
  process.exit(1);
}

const sourceLanguageBar = `<p align="center">
  <a href="../README.md">English</a> · 简体中文 · <a href="./README_ZH_hk.md">繁體中文</a> · <a href="./README_JA.md">日本語</a>
</p>`;

const traditionalLanguageBar = `<p align="center">
  <a href="../README.md">English</a> · <a href="./README_ZH.md">简体中文</a> · 繁體中文 · <a href="./README_JA.md">日本語</a>
</p>`;

const generatedNotice = "<!-- Generated from README_ZH.md by `pnpm readme:zh-hant`; do not edit directly. -->";
const convert = OpenCC.Converter({ from: "cn", to: "hk" });
const source = await readFile(sourcePath, "utf8");
const convertedLanguageBar = convert(sourceLanguageBar);

if (!source.includes(sourceLanguageBar)) {
  console.error("Could not find the Simplified Chinese README language bar.");
  process.exit(1);
}

const converted = convert(source);
if (!converted.includes(convertedLanguageBar)) {
  console.error("Could not replace the generated Traditional Chinese README language bar.");
  process.exit(1);
}

const expected = `${generatedNotice}\n\n${converted.replace(convertedLanguageBar, traditionalLanguageBar)}`;
const current = await readFile(targetPath, "utf8").catch(() => "");

if (checkOnly) {
  if (current === expected) {
    console.log("Traditional Chinese README is synchronized.");
    process.exit(0);
  }

  console.error("Traditional Chinese README is out of date. Run: pnpm readme:zh-hant");
  process.exit(1);
}

if (current !== expected) {
  await writeFile(targetPath, expected, "utf8");
  console.log("Updated translated_readmes/README_ZH_hk.md from README_ZH.md.");
} else {
  console.log("Traditional Chinese README is already synchronized.");
}
