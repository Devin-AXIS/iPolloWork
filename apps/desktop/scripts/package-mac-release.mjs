import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopRoot, "../..");
const outputDir = path.join(desktopRoot, "dist-electron");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

if (process.platform !== "darwin") {
  throw new Error("macOS release packaging must run on macOS.");
}

function run(command, args, cwd = repoRoot, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit", shell: command.endsWith(".cmd") });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed.`);
}

function capture(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) throw result.error;
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for notarized macOS release packaging.`);
  return value;
}

function hasDeveloperIdIdentity() {
  const output = capture("security", ["find-identity", "-v", "-p", "codesigning"]);
  return /"Developer ID Application: [^"]+"/.test(output);
}

function resolveNotaryKeyPath(tempDir) {
  const existing = process.env.APPLE_API_KEY_PATH?.trim();
  if (existing) {
    if (!existsSync(existing)) throw new Error(`APPLE_API_KEY_PATH does not exist: ${existing}`);
    return existing;
  }

  const base64 = process.env.APPLE_NOTARY_API_KEY_P8_BASE64?.trim();
  if (!base64) {
    throw new Error("APPLE_API_KEY_PATH or APPLE_NOTARY_API_KEY_P8_BASE64 is required for notarization.");
  }

  const keyPath = path.join(tempDir, "AuthKey.p8");
  writeFileSync(keyPath, Buffer.from(base64, "base64"));
  return keyPath;
}

function assertSigningConfigured() {
  if (process.env.CSC_LINK?.trim()) {
    requireEnv("CSC_KEY_PASSWORD");
    return;
  }

  if (!hasDeveloperIdIdentity()) {
    throw new Error([
      "No Developer ID Application signing identity was found in this Mac keychain.",
      "For a package that other people can open normally, import an Apple Developer ID Application certificate,",
      "or provide CSC_LINK and CSC_KEY_PASSWORD from a Developer ID .p12 certificate.",
    ].join(" "));
  }
}

function validateGatekeeper(appPath) {
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath], desktopRoot);
  run("xcrun", ["stapler", "validate", appPath], desktopRoot);
  run("spctl", ["--assess", "--type", "execute", "--verbose=4", appPath], desktopRoot);
}

function notarizeDmg(dmgPath, env) {
  run("xcrun", [
    "notarytool",
    "submit",
    dmgPath,
    "--key",
    env.APPLE_API_KEY_PATH,
    "--key-id",
    env.APPLE_API_KEY,
    "--issuer",
    env.APPLE_API_ISSUER,
    "--wait",
  ], desktopRoot, env);
  run("xcrun", ["stapler", "staple", dmgPath], desktopRoot, env);
  run("xcrun", ["stapler", "validate", dmgPath], desktopRoot, env);
}

assertSigningConfigured();
const tempDir = mkdtempSync(path.join(os.tmpdir(), "ipollowork-mac-release-"));
try {
  const env = {
    ...process.env,
    MACOS_NOTARIZE: "true",
    APPLE_API_KEY: process.env.APPLE_API_KEY?.trim() || process.env.APPLE_NOTARY_API_KEY_ID?.trim() || "",
    APPLE_API_ISSUER: process.env.APPLE_API_ISSUER?.trim() || process.env.APPLE_NOTARY_API_ISSUER_ID?.trim() || "",
    APPLE_API_KEY_PATH: resolveNotaryKeyPath(tempDir),
  };
  if (!env.APPLE_API_KEY) throw new Error("APPLE_API_KEY or APPLE_NOTARY_API_KEY_ID is required for notarization.");
  if (!env.APPLE_API_ISSUER) throw new Error("APPLE_API_ISSUER or APPLE_NOTARY_API_ISSUER_ID is required for notarization.");

  rmSync(outputDir, { recursive: true, force: true });
  run(process.execPath, [path.join(desktopRoot, "scripts/electron-build.mjs")], repoRoot, env);
  run(pnpm, ["exec", "electron-builder", "--config", "electron-builder.yml", "--mac", "--arm64", "--publish", "never"], desktopRoot, env);

  const appPath = path.join(outputDir, "mac-arm64", "iPollo.app");
  if (!existsSync(appPath)) throw new Error(`Packaged app not found: ${appPath}`);
  validateGatekeeper(appPath);
  const dmgName = readdirSync(outputDir).find((name) => name.endsWith(".dmg") && name.includes("mac-arm64"));
  if (!dmgName) throw new Error("Packaged DMG not found.");
  notarizeDmg(path.join(outputDir, dmgName), env);
  console.log(`Notarized macOS release package ready in ${outputDir}`);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
