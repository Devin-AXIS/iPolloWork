const { spawnSync } = require("node:child_process");
const { existsSync, mkdtempSync, readdirSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const computerUseHelperAppName = "iPolloWork Computer Use.app";

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}`);
  }
}

function capture(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed with status ${result.status}`);
  }
  return result.stdout;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required to notarize the Electron macOS app`);
  }
  return value;
}

function computerUseHelperPath(appPath) {
  return path.join(appPath, "Contents", "Resources", "helpers", computerUseHelperAppName);
}

function assertMacEngineTrustFiles(appPath) {
  const enginePacksPath = path.join(appPath, "Contents", "Resources", "engine-packs");
  if (!existsSync(enginePacksPath)) {
    throw new Error(`macOS engine checksums are missing from packaged app: ${enginePacksPath}`);
  }
  const entries = readdirSync(enginePacksPath);
  const archives = entries.filter((name) => name.endsWith(".tar.gz"));
  if (archives.length > 0) {
    throw new Error(`macOS packaged app must not contain native engine archives: ${archives.join(", ")}`);
  }
  for (const engineId of ["deepseek-harness", "codex-harness"]) {
    if (!entries.some((name) => name.startsWith(`ipollowork-engine-${engineId}-macos-`) && name.endsWith(".tar.gz.sha256"))) {
      throw new Error(`macOS packaged app is missing the ${engineId} engine checksum.`);
    }
  }
}

function verifyComputerUseHelper(appPath, requireDistributionSignature) {
  const helperPath = computerUseHelperPath(appPath);
  if (!existsSync(helperPath)) {
    throw new Error(`Computer Use helper app is missing from packaged app: ${helperPath}`);
  }

  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", helperPath]);

  if (!requireDistributionSignature) return;
  const result = spawnSync("codesign", ["--display", "--verbose=4", helperPath], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`codesign --display failed for Computer Use helper with status ${result.status}`);
  }
  if (result.stderr.includes("Signature=adhoc")) {
    throw new Error("Computer Use helper app is ad-hoc signed; notarized builds require a Developer ID signature.");
  }
}

async function afterSign(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);
  assertMacEngineTrustFiles(appPath);

  if (process.env.MACOS_NOTARIZE !== "true") {
    console.warn("[electron-after-sign] MACOS_NOTARIZE is not true; skipping notarization.");
    return;
  }

  verifyComputerUseHelper(appPath, process.env.MACOS_NOTARIZE === "true");

  const notaryTempDir = mkdtempSync(path.join(tmpdir(), "ipollowork-electron-notary-"));
  const notaryZipPath = path.join(notaryTempDir, `${context.packager.appInfo.productFilename}-notary.zip`);
  const keyPath = requireEnv("APPLE_API_KEY_PATH");
  const keyId = requireEnv("APPLE_API_KEY");
  const issuer = requireEnv("APPLE_API_ISSUER");
  const credentials = ["--key", keyPath, "--key-id", keyId, "--issuer", issuer];

  try {
    run("ditto", ["-c", "-k", "--keepParent", appPath, notaryZipPath]);
    const submission = JSON.parse(capture("xcrun", [
      "notarytool",
      "submit",
      notaryZipPath,
      ...credentials,
      "--wait",
      "--output-format",
      "json",
    ]));
    if (submission.status !== "Accepted") {
      if (submission.id) {
        run("xcrun", ["notarytool", "log", submission.id, ...credentials]);
      }
      throw new Error(`Apple notarization returned ${submission.status ?? "an unknown status"}.`);
    }
    run("xcrun", ["stapler", "staple", appPath]);
    run("xcrun", ["stapler", "validate", appPath]);
  } finally {
    rmSync(notaryTempDir, { recursive: true, force: true });
  }
}

module.exports = afterSign;
module.exports.default = afterSign;
module.exports.assertMacEngineTrustFiles = assertMacEngineTrustFiles;
