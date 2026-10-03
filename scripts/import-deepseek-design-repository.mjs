import { cp, lstat, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { deepSeekDesignSourceMappings } from "./export-deepseek-design-repository.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const publicRepository = "https://github.com/Devin-AXIS/deepseek-design";
const sourceRepository = "https://github.com/Devin-AXIS/iPolloWork";
const forbiddenDirectoryNames = new Set([".git", "dist", "lib", "node_modules"]);
const maximumFilesPerMapping = 2048;
const maximumFileBytes = 5 * 1024 * 1024;

function usage() {
  return "Usage: pnpm import:deepseek-design -- --source <deepseek-design-checkout>";
}

function parseArguments(argv) {
  if (argv[0] === "--") argv = argv.slice(1);
  if (argv.length !== 2 || argv[0] !== "--source" || !argv[1]) throw new Error(usage());
  return { source: resolve(argv[1]) };
}

function pathWithin(root, path) {
  const suffix = relative(root, path);
  return suffix && suffix !== ".." && !suffix.startsWith(`..${sep}`) && !suffix.startsWith(sep);
}

function mappedPath(root, value) {
  const path = resolve(root, value);
  if (!pathWithin(root, path)) throw new Error(`Mapped path escapes its repository: ${value}`);
  return path;
}

async function validateSource(path, label, type) {
  let files = 0;
  const visit = async (entryPath, relativePath) => {
    const metadata = await lstat(entryPath);
    if (metadata.isSymbolicLink()) throw new Error(`DeepSeek Design source may not contain symbolic links: ${label}/${relativePath}`);
    if (metadata.isFile()) {
      files += 1;
      if (files > maximumFilesPerMapping) throw new Error(`DeepSeek Design source has too many files under ${label}.`);
      if (metadata.size > maximumFileBytes) throw new Error(`DeepSeek Design source file is too large: ${label}/${relativePath}`);
      return;
    }
    if (!metadata.isDirectory()) throw new Error(`DeepSeek Design source must contain only regular files and directories: ${label}/${relativePath}`);
    for (const entry of await readdir(entryPath, { withFileTypes: true })) {
      if (entry.isDirectory() && forbiddenDirectoryNames.has(entry.name)) {
        throw new Error(`DeepSeek Design source contains a generated or unsafe directory: ${label}/${relativePath}${entry.name}`);
      }
      await visit(resolve(entryPath, entry.name), `${relativePath}${entry.name}${entry.isDirectory() ? "/" : ""}`);
    }
  };
  const rootMetadata = await lstat(path);
  if (rootMetadata.isSymbolicLink()) throw new Error(`DeepSeek Design source may not contain symbolic links: ${label}`);
  if (type === "file" && !rootMetadata.isFile()) throw new Error(`DeepSeek Design source must be a regular file: ${label}`);
  if (type === "directory" && !rootMetadata.isDirectory()) throw new Error(`DeepSeek Design source must be a directory: ${label}`);
  await visit(path, "");
  if (!files) throw new Error(`DeepSeek Design source is empty: ${label}`);
}

async function validateRepository(source) {
  const metadataPath = mappedPath(source, "repository.json");
  const metadataDetails = await lstat(metadataPath);
  if (metadataDetails.isSymbolicLink() || !metadataDetails.isFile() || metadataDetails.size > maximumFileBytes) {
    throw new Error("The DeepSeek Design repository metadata must be a regular file.");
  }
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  if (
    metadata.schemaVersion !== 1 ||
    metadata.repository !== publicRepository ||
    metadata.source?.repository !== sourceRepository ||
    !/^[0-9a-f]{40}$/.test(metadata.source.commit)
  ) {
    throw new Error("The source directory is not a supported DeepSeek Design repository snapshot.");
  }
}

export async function importDeepSeekDesignRepository({ source, destination = repositoryRoot }) {
  const sourceRoot = resolve(source);
  const destinationRoot = resolve(destination);
  if (sourceRoot === destinationRoot || pathWithin(sourceRoot, destinationRoot) || pathWithin(destinationRoot, sourceRoot)) {
    throw new Error("The DeepSeek Design checkout and iPolloWork checkout must be separate directories.");
  }
  await validateRepository(sourceRoot);

  for (const mapping of deepSeekDesignSourceMappings) {
    const sourcePath = mappedPath(sourceRoot, mapping.mirrorPath);
    await validateSource(sourcePath, mapping.mirrorPath, mapping.type);
  }

  for (const mapping of deepSeekDesignSourceMappings) {
    const sourcePath = mappedPath(sourceRoot, mapping.mirrorPath);
    const destinationPath = mappedPath(destinationRoot, mapping.ipolloWorkPath);
    await rm(destinationPath, { recursive: true, force: true });
    await mkdir(dirname(destinationPath), { recursive: true });
    await cp(sourcePath, destinationPath, { recursive: mapping.type === "directory", errorOnExist: true });
  }

  return deepSeekDesignSourceMappings.map(({ ipolloWorkPath }) => ipolloWorkPath);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const imported = await importDeepSeekDesignRepository({ source: options.source });
  console.log(`Imported ${imported.length} approved source mappings from DeepSeek Design.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
