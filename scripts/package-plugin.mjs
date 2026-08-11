import { createHash, sign } from "node:crypto";
import { createRequire } from "node:module";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

const requireFromApp = createRequire(new URL("../apps/app/package.json", import.meta.url));
const JSZip = requireFromApp("jszip");

const MANIFEST_FILE = "ipollowork.plugin.json";
const PACKAGE_SIGNATURE_PREFIX = "ipollowork-plugin-package-v1\0";
const MAX_PACKAGE_BYTES = 10 * 1024 * 1024;
const MAX_PACKAGE_FILES = 512;

function usage() {
  return "Usage: node scripts/package-plugin.mjs --root <package-root> --out <archive.ipollowork-plugin> --private-key <ed25519.pem> --key-id <id>";
}

function options(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error(usage());
    values.set(key.slice(2), value);
  }
  const root = values.get("root");
  const out = values.get("out");
  const privateKey = values.get("private-key");
  const keyId = values.get("key-id");
  if (!root || !out || !privateKey || !keyId) throw new Error(usage());
  return { root: resolve(root), out: resolve(out), privateKey: resolve(privateKey), keyId };
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}

function compareRelativePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function pathWithin(root, path) {
  const suffix = relative(root, path);
  return suffix && !suffix.startsWith(`..${sep}`) && suffix !== ".." && !suffix.startsWith(sep);
}

function safeResourcePath(root, value) {
  if (typeof value !== "string" || !value || value.startsWith("/") || value.startsWith("\\")) {
    throw new Error(`Unsafe plugin resource path: ${String(value)}`);
  }
  const normalized = value.replaceAll("\\", "/");
  if (normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Unsafe plugin resource path: ${value}`);
  }
  const path = resolve(root, normalized);
  if (!pathWithin(root, path)) throw new Error(`Plugin resource escapes its root: ${value}`);
  return { path, relativePath: normalized };
}

async function resourceFiles(root, resourcePath) {
  const source = safeResourcePath(root, resourcePath);
  const metadata = await lstat(source.path);
  if (metadata.isSymbolicLink()) throw new Error(`Plugin resources may not be symbolic links: ${resourcePath}`);
  if (metadata.isFile()) return [source.relativePath];
  if (!metadata.isDirectory()) throw new Error(`Plugin resource must be a file or directory: ${resourcePath}`);
  const files = [];
  const visit = async (directory) => {
    const entries = await readdir(resolve(root, directory), { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = `${directory}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`Plugin resources may not be symbolic links: ${path}`);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
      else throw new Error(`Plugin resource must be a regular file: ${path}`);
    }
  };
  await visit(source.relativePath);
  if (!files.length) throw new Error(`Plugin resource directory is empty: ${resourcePath}`);
  return files;
}

function packageSha256(manifest, files) {
  const hash = createHash("sha256");
  const packageMetadata = manifest.package;
  const checksumFreeManifest = packageMetadata
    ? { ...manifest, package: { ...packageMetadata, checksum: undefined, signature: undefined } }
    : manifest;
  hash.update(MANIFEST_FILE);
  hash.update("\0");
  hash.update(createHash("sha256").update(canonicalJson(checksumFreeManifest)).digest("hex"));
  hash.update("\n");
  for (const file of [...files].sort((left, right) => compareRelativePaths(left.path, right.path))) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(file.sha256);
    hash.update("\n");
  }
  return hash.digest("hex");
}

async function main() {
  const input = options(process.argv.slice(2));
  const manifestPath = resolve(input.root, MANIFEST_FILE);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!manifest.package?.publisher) throw new Error("Plugin package publisher metadata is required for signing");
  if (!Array.isArray(manifest.resources)) throw new Error("Plugin package resources are required");

  const paths = new Set();
  for (const resource of manifest.resources) {
    if (!resource.path) continue;
    for (const path of await resourceFiles(input.root, resource.path)) paths.add(path);
  }
  const files = [];
  for (const path of [...paths].sort(compareRelativePaths)) {
    const content = await readFile(resolve(input.root, path));
    files.push({ path, content, sha256: createHash("sha256").update(content).digest("hex") });
  }

  const distributableManifest = {
    ...manifest,
    source: {
      ...manifest.source,
      format: "ipollowork-extension-manifest",
      origin: "local",
      trusted: false,
    },
    package: {
      ...manifest.package,
      checksum: undefined,
      signature: undefined,
    },
  };
  const digest = packageSha256(distributableManifest, files);
  const signature = sign(
    null,
    Buffer.from(`${PACKAGE_SIGNATURE_PREFIX}${digest}`, "utf8"),
    await readFile(input.privateKey),
  ).toString("base64");
  if (Buffer.from(signature, "base64").byteLength !== 64) throw new Error("Signing key did not produce an Ed25519 signature");
  distributableManifest.package.checksum = { algorithm: "sha256", value: digest };
  distributableManifest.package.signature = { algorithm: "ed25519", keyId: input.keyId, value: signature };

  const manifestContent = Buffer.from(`${JSON.stringify(distributableManifest, null, 2)}\n`, "utf8");
  const totalFiles = files.length + 1;
  const totalBytes = files.reduce((sum, file) => sum + file.content.byteLength, manifestContent.byteLength);
  if (totalFiles > MAX_PACKAGE_FILES) throw new Error(`Plugin package has ${totalFiles} files; maximum is ${MAX_PACKAGE_FILES}`);
  if (totalBytes > MAX_PACKAGE_BYTES) throw new Error(`Plugin package has ${totalBytes} bytes; maximum is ${MAX_PACKAGE_BYTES}`);

  const archive = new JSZip();
  archive.file(MANIFEST_FILE, manifestContent);
  for (const file of files) archive.file(file.path, file.content);
  const output = await archive.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
  await mkdir(dirname(input.out), { recursive: true });
  await writeFile(input.out, output, { mode: 0o644 });
  process.stdout.write(`${JSON.stringify({ output: input.out, pluginId: manifest.id, version: manifest.package.version, sha256: digest, files: totalFiles, bytes: totalBytes, archiveBytes: output.byteLength })}\n`);
}

await main();
