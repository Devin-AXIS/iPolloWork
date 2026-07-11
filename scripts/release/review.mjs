import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const args = process.argv.slice(2);
const outputJson = args.includes("--json");
const strict = args.includes("--strict");

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const readText = (path) => readFileSync(path, "utf8");


const appPkg = readJson(resolve(root, "apps", "app", "package.json"));
const desktopPkg = readJson(resolve(root, "apps", "desktop", "package.json"));
const orchestratorPkg = readJson(
  resolve(root, "apps", "orchestrator", "package.json"),
);
const pinnedOpencodeVersion = String(
  readJson(resolve(root, "constants.json")).opencodeVersion ?? "",
)
  .trim()
  .replace(/^v/, "");
const serverPkg = readJson(resolve(root, "apps", "server", "package.json"));
const versions = {
  app: appPkg.version ?? null,
  desktop: desktopPkg.version ?? null,
  server: serverPkg.version ?? null,
  orchestrator: orchestratorPkg.version ?? null,
  opencode: pinnedOpencodeVersion || null,
  orchestratoriPolloWalkServerRange:
    orchestratorPkg.dependencies?.["ipollowalk-server"] ?? null,
};

const checks = [];
const warnings = [];
let ok = true;

const addCheck = (label, pass, details) => {
  checks.push({ label, ok: pass, details });
  if (!pass) ok = false;
};

const addWarning = (message) => warnings.push(message);

addCheck(
  "App/desktop versions match",
  versions.app && versions.desktop && versions.app === versions.desktop,
  `${versions.app ?? "?"} vs ${versions.desktop ?? "?"}`,
);
addCheck(
  "App/ipollowalk-orchestrator versions match",
  versions.app &&
    versions.orchestrator &&
    versions.app === versions.orchestrator,
  `${versions.app ?? "?"} vs ${versions.orchestrator ?? "?"}`,
);
addCheck(
  "App/ipollowalk-server versions match",
  versions.app && versions.server && versions.app === versions.server,
  `${versions.app ?? "?"} vs ${versions.server ?? "?"}`,
);
if (versions.opencode) {
  addCheck(
    "OpenCode version pin exists",
    Boolean(versions.opencode),
    String(versions.opencode),
  );
} else {
  addWarning(
    "OpenCode version is not pinned in constants.json.",
  );
}

const ipollowalkServerRange = versions.orchestratoriPolloWalkServerRange ?? "";
const ipollowalkServerPinned = /^\d+\.\d+\.\d+/.test(ipollowalkServerRange);
if (!ipollowalkServerRange) {
  addWarning("ipollowalk-orchestrator is missing an ipollowalk-server dependency.");
} else if (!ipollowalkServerPinned) {
  addWarning(
    `ipollowalk-orchestrator ipollowalk-server dependency is not pinned (${ipollowalkServerRange}).`,
  );
} else {
  addCheck(
    "iPolloWalk-server dependency matches server version",
    versions.server && ipollowalkServerRange === versions.server,
    `${ipollowalkServerRange} vs ${versions.server ?? "?"}`,
  );
}

const sidecarManifestPath = resolve(
  root,
  "apps",
  "orchestrator",
  "dist",
  "sidecars",
  "ipollowalk-orchestrator-sidecars.json",
);
if (existsSync(sidecarManifestPath)) {
  const manifest = readJson(sidecarManifestPath);
  addCheck(
    "Sidecar manifest version matches ipollowalk-orchestrator",
    versions.orchestrator && manifest.version === versions.orchestrator,
    `${manifest.version ?? "?"} vs ${versions.orchestrator ?? "?"}`,
  );
  const serverEntry = manifest.entries?.["ipollowalk-server"]?.version;
  if (serverEntry) {
    addCheck(
      "Sidecar manifest ipollowalk-server version matches",
      versions.server && serverEntry === versions.server,
      `${serverEntry ?? "?"} vs ${versions.server ?? "?"}`,
    );
  }
} else {
  addWarning(
    "Sidecar manifest missing (run pnpm --filter ipollowalk-orchestrator build:sidecars).",
  );
}

if (!process.env.SOURCE_DATE_EPOCH) {
  addWarning(
    "SOURCE_DATE_EPOCH is not set (sidecar manifests will include current time).",
  );
}

const report = { ok, versions, checks, warnings };

if (outputJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("Release review");
  for (const check of checks) {
    const status = check.ok ? "ok" : "fail";
    console.log(`- ${status}: ${check.label} (${check.details})`);
  }
  if (warnings.length) {
    console.log("Warnings:");
    for (const warning of warnings) {
      console.log(`- ${warning}`);
    }
  }
}

if (strict && !ok) {
  process.exit(1);
}
