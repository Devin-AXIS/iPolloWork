import { execFile } from "node:child_process";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const publicRepository = "https://github.com/Devin-AXIS/deepseek-design";
const sourceRepository = "https://github.com/Devin-AXIS/iPolloWork";

export const deepSeekDesignSourceMappings = [
  {
    ipolloWorkPath: "external-plugins/deepseek-harness/README.md",
    mirrorPath: "README.md",
    type: "file",
  },
  {
    ipolloWorkPath: "external-plugins/deepseek-harness/design-studio",
    mirrorPath: "source/plugins/deepseek-idesign",
    type: "directory",
  },
  {
    ipolloWorkPath: "external-plugins/deepseek-harness/ppt-studio",
    mirrorPath: "source/plugins/deepseek-ippt",
    type: "directory",
  },
  {
    ipolloWorkPath: "packages/design-studio",
    mirrorPath: "source/shared/design-studio",
    type: "directory",
  },
  {
    ipolloWorkPath: "packages/types/src/templates.ts",
    mirrorPath: "source/shared/types/templates.ts",
    type: "file",
  },
];

function usage() {
  return `Usage: pnpm export:deepseek-design -- --output <directory> --idesign <tarball> --ippt <tarball>`;
}

function parseArguments(argv) {
  if (argv[0] === "--") argv = argv.slice(1);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(usage());
    }
    values.set(key.slice(2), value);
  }
  for (const required of ["output", "idesign", "ippt"]) {
    if (!values.has(required)) throw new Error(usage());
  }
  return {
    output: resolve(values.get("output")),
    packages: [
      { name: "deepseek-idesign", tarball: resolve(values.get("idesign")) },
      { name: "deepseek-ippt", tarball: resolve(values.get("ippt")) },
    ],
  };
}

async function assertSafeOutput(output) {
  await mkdir(dirname(output), { recursive: true });
  const resolvedHome = await realpath(homedir());
  const resolvedRoot = resolve("/");
  const resolvedRepository = await realpath(repositoryRoot);
  const candidateParent = await realpath(dirname(output));
  const candidate = join(candidateParent, basename(output));
  const repositoryRelative = relative(resolvedRepository, candidate);

  if (
    candidate === resolvedRoot ||
    candidate === resolvedHome ||
    candidate === resolvedRepository ||
    (repositoryRelative !== ".." && !repositoryRelative.startsWith(`..${sep}`))
  ) {
    throw new Error(`Refusing to replace unsafe output directory: ${candidate}`);
  }
}

async function resetOutput(output) {
  await assertSafeOutput(output);
  await mkdir(output, { recursive: true });
  for (const entry of await readdir(output)) {
    if (entry === ".git") continue;
    await rm(join(output, entry), { recursive: true, force: true });
  }
}

async function copyFile(source, destination) {
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination);
}

async function copySourceDirectory(source, destination) {
  await cp(source, destination, {
    recursive: true,
    filter(path) {
      const suffix = relative(source, path).split(sep);
      return !suffix.some((part) => part === "node_modules" || part === "lib" || part === "dist");
    },
  });
}

async function extractPackage({ name, tarball }, output) {
  await access(tarball);
  const staging = await mkdtemp(join(tmpdir(), `deepseek-design-${name}-`));
  try {
    await run("tar", ["-xzf", tarball, "-C", staging]);
    const extracted = join(staging, "package");
    const metadata = JSON.parse(await readFile(join(extracted, "package.json"), "utf8"));
    if (metadata.name !== name) {
      throw new Error(`Expected ${name} tarball, received ${metadata.name ?? "an unnamed package"}.`);
    }
    await cp(extracted, join(output, "packages", name), { recursive: true });
    return { name, version: metadata.version };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function assertRunnablePackage(output, name) {
  for (const path of ["package.json", "lib/index.js", "studio/dist/index.html", "cordis.patch.yml", "LICENSE"]) {
    const target = join(output, "packages", name, path);
    const details = await stat(target).catch(() => null);
    if (!details?.isFile()) throw new Error(`Generated package is missing ${name}/${path}.`);
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  await resetOutput(options.output);

  const { stdout } = await run("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot });
  const sourceCommit = stdout.trim();

  for (const [source, destination] of [
    ["CONTRIBUTING.md", "CONTRIBUTING.md"],
    ["LICENSE", "LICENSE"],
    ["LICENSES/MIT-legacy.txt", "LICENSES/MIT-legacy.txt"],
    ["CODE_OF_CONDUCT.md", "CODE_OF_CONDUCT.md"],
    ["SECURITY.md", "SECURITY.md"],
  ]) {
    await copyFile(join(repositoryRoot, source), join(options.output, destination));
  }

  for (const mapping of deepSeekDesignSourceMappings) {
    const source = join(repositoryRoot, mapping.ipolloWorkPath);
    const destination = join(options.output, mapping.mirrorPath);
    if (mapping.type === "directory") await copySourceDirectory(source, destination);
    else await copyFile(source, destination);
  }

  const packages = [];
  for (const packageEntry of options.packages) {
    packages.push(await extractPackage(packageEntry, options.output));
    await assertRunnablePackage(options.output, packageEntry.name);
  }

  await writeFile(
    join(options.output, "source/README.md"),
    `# Source map\n\nThis directory mirrors the thin DeepSeek Harness adapters and shared Studio contract from [iPolloWork](${sourceRepository}/tree/${sourceCommit}). The complete, directly installable runtime is in \`packages/\`.\n\nSource pull requests are welcome in this repository. After a source change is merged here, iPolloWork imports it as a reviewable upstream pull request. When that upstream pull request is merged, the Studio and packages are rebuilt and synchronized back here. Do not edit generated files under \`packages/\` directly.\n\nThe Design and PPT interface remains single-sourced in [iPolloWork Design Studio](${sourceRepository}/tree/${sourceCommit}/apps/app/src/react-app/domains/session/design), and the curated templates remain in [bundled-templates](${sourceRepository}/tree/${sourceCommit}/apps/server/bundled-templates). Changes to those paths should be proposed directly in the main repository.\n`,
  );
  await writeFile(join(options.output, ".gitignore"), "node_modules/\n*.tgz\n.DS_Store\n");
  await writeFile(join(options.output, "SOURCE_COMMIT"), `${sourceCommit}\n`);
  await writeFile(
    join(options.output, "repository.json"),
    `${JSON.stringify({ schemaVersion: 1, repository: publicRepository, source: { repository: sourceRepository, commit: sourceCommit }, contributions: { mode: "upstream-pull-request", upstream: sourceRepository }, packages }, null, 2)}\n`,
  );

  console.log(`Exported ${packages.map(({ name, version }) => `${name}@${version}`).join(" and ")} from ${sourceCommit}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
