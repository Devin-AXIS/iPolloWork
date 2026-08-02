#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const directoryArg = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
if (!directoryArg) {
  console.error("Usage: node audit-template.mjs <template-directory>");
  process.exit(2);
}

const directory = resolve(directoryArg);
if (!existsSync(directory)) {
  console.error(`Template directory does not exist: ${directory}`);
  process.exit(2);
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const validatorUrl = pathToFileURL(join(repositoryRoot, "apps/server/src/templates.ts")).href;
const validationProgram = `
  import { validateTemplatePackageDirectory } from ${JSON.stringify(validatorUrl)};
  const report = await validateTemplatePackageDirectory(process.argv[1]);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ready ? 0 : 1);
`;
const result = spawnSync("bun", ["-e", validationProgram, directory], {
  cwd: repositoryRoot,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) {
  console.error(`Unable to run the product template validator: ${result.error.message}`);
  process.exit(2);
}
process.exit(result.status ?? 2);
