import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import path from "node:path";

const cwd = process.cwd();
const tmpDir = path.join(cwd, "tmp");

const ensureTmp = async () => {
  await mkdir(tmpDir, { recursive: true });
};

const isPortFree = (port: number, host: string) =>
  new Promise<boolean>((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, host, () => {
      server.close(() => resolve(true));
    });
  });

const getFreePort = (host: string) =>
  new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Unable to resolve free port")));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });

const resolvePort = async (value: string | undefined, host: string) => {
  if (value) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      const free = await isPortFree(parsed, host);
      if (free) return parsed;
    }
  }
  return await getFreePort(host);
};

const logLine = (message: string) => {
  process.stdout.write(`${message}\n`);
};

const readBool = (value: string | undefined) => {
  const normalized = (value ?? "").trim().toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
};

const silent = process.argv.includes("--silent");

const autoBuildEnabled =
  process.env.IPOLLOWALK_DEV_HEADLESS_WEB_AUTOBUILD == null
    ? true
    : readBool(process.env.IPOLLOWALK_DEV_HEADLESS_WEB_AUTOBUILD);

const runCommand = (command: string, args: string[]) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: silent ? "ignore" : "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`,
        ),
      );
    });
  });

const spawnLogged = (
  command: string,
  args: string[],
  logPath: string,
  env: NodeJS.ProcessEnv,
) => {
  const logFd = openSync(logPath, "w");
  return spawn(command, args, {
    cwd,
    env,
    stdio: ["ignore", logFd, logFd],
  });
};

const shutdown = (
  label: string,
  code: number | null,
  signal: NodeJS.Signals | null,
) => {
  const reason =
    code !== null ? `code ${code}` : signal ? `signal ${signal}` : "unknown";
  logLine(`[dev:headless-web] ${label} exited (${reason})`);
  process.exit(code ?? 1);
};

await ensureTmp();

const remoteAccessEnabled = readBool(process.env.IPOLLOWALK_REMOTE_ACCESS);
const host = remoteAccessEnabled ? "0.0.0.0" : "127.0.0.1";
const viteHost = process.env.VITE_HOST ?? process.env.HOST ?? host;
const publicHost = process.env.IPOLLOWALK_PUBLIC_HOST ?? null;
const clientHost = publicHost ?? (host === "0.0.0.0" ? "127.0.0.1" : host);
const workspace = process.env.IPOLLOWALK_WORKSPACE ?? cwd;
const ipollowalkPort = await resolvePort(process.env.IPOLLOWALK_PORT, "127.0.0.1");
const webPort = await resolvePort(process.env.IPOLLOWALK_WEB_PORT, "127.0.0.1");
const ipollowalkToken = process.env.IPOLLOWALK_TOKEN ?? randomUUID();
const ipollowalkHostToken = process.env.IPOLLOWALK_HOST_TOKEN ?? randomUUID();
const ipollowalkServerBin = path.join(
  cwd,
  "apps/server/dist/bin/ipollowalk-server",
);

const ensureiPolloWalkServer = async () => {
  try {
    await access(ipollowalkServerBin);
  } catch {
    if (!autoBuildEnabled) {
      logLine(
        `[dev:headless-web] Missing iPolloWalk server binary at ${ipollowalkServerBin}`,
      );
      logLine(
        "[dev:headless-web] Auto-build disabled (IPOLLOWALK_DEV_HEADLESS_WEB_AUTOBUILD=0)",
      );
      logLine(
        "[dev:headless-web] Run: pnpm --filter ipollowalk-server build:bin",
      );
      logLine(
        "[dev:headless-web] Or unset/enable IPOLLOWALK_DEV_HEADLESS_WEB_AUTOBUILD to auto-build.",
      );
      process.exit(1);
    }

    logLine(
      `[dev:headless-web] Missing iPolloWalk server binary at ${ipollowalkServerBin}`,
    );
    logLine(
      "[dev:headless-web] Auto-building: pnpm --filter ipollowalk-server build:bin",
    );
    try {
      await runCommand("pnpm", ["--filter", "ipollowalk-server", "build:bin"]);
      await access(ipollowalkServerBin);
    } catch (error) {
      logLine(
        `[dev:headless-web] Auto-build failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(1);
    }
  }
};

const ipollowalkUrl = `http://${clientHost}:${ipollowalkPort}`;
const webUrl = `http://${clientHost}:${webPort}`;
const viteEnv = {
  ...process.env,
  HOST: viteHost,
  PORT: String(webPort),
  VITE_IPOLLOWALK_URL: process.env.VITE_IPOLLOWALK_URL ?? ipollowalkUrl,
  VITE_IPOLLOWALK_PORT: process.env.VITE_IPOLLOWALK_PORT ?? String(ipollowalkPort),
  VITE_IPOLLOWALK_TOKEN: process.env.VITE_IPOLLOWALK_TOKEN ?? ipollowalkToken,
};
const headlessEnv = {
  ...process.env,
  IPOLLOWALK_WORKSPACE: workspace,
  IPOLLOWALK_HOST: host,
  IPOLLOWALK_REMOTE_ACCESS: remoteAccessEnabled ? "1" : "0",
  IPOLLOWALK_PORT: String(ipollowalkPort),
  IPOLLOWALK_TOKEN: ipollowalkToken,
  IPOLLOWALK_HOST_TOKEN: ipollowalkHostToken,
  IPOLLOWALK_SERVER_BIN: ipollowalkServerBin,
  IPOLLOWALK_SIDECAR_SOURCE: process.env.IPOLLOWALK_SIDECAR_SOURCE ?? "external",
};

await ensureiPolloWalkServer();

logLine("[dev:headless-web] Starting services");
logLine(`[dev:headless-web] Workspace: ${workspace}`);
logLine(`[dev:headless-web] iPolloWalk server: ${ipollowalkUrl}`);
logLine(`[dev:headless-web] Web host: ${viteHost}`);
logLine(`[dev:headless-web] Web port: ${webPort}`);
logLine(`[dev:headless-web] Web URL: ${webUrl}`);
logLine("[dev:headless-web] IPOLLOWALK_TOKEN: [REDACTED]");
logLine("[dev:headless-web] IPOLLOWALK_HOST_TOKEN: [REDACTED]");
logLine(
  `[dev:headless-web] Web logs: ${path.relative(cwd, path.join(tmpDir, "dev-web.log"))}`,
);
logLine(
  `[dev:headless-web] Headless logs: ${path.relative(cwd, path.join(tmpDir, "dev-headless.log"))}`,
);

const webProcess = spawnLogged(
  "pnpm",
  [
    "--filter",
    "@ipollowalk/app",
    "exec",
    "vite",
    "--host",
    viteHost,
    "--port",
    String(webPort),
    "--strictPort",
  ],
  path.join(tmpDir, "dev-web.log"),
  viteEnv,
);

const headlessProcess = spawnLogged(
  "pnpm",
  [
    "--filter",
    "ipollowalk-orchestrator",
    "dev",
    "--",
    "start",
    "--workspace",
    workspace,
    "--approval",
    "auto",
    "--allow-external",
    ...(remoteAccessEnabled ? ["--remote-access"] : []),
    "--ipollowalk-port",
    String(ipollowalkPort),
  ],
  path.join(tmpDir, "dev-headless.log"),
  headlessEnv,
);

const stopAll = (signal: NodeJS.Signals) => {
  webProcess.kill(signal);
  headlessProcess.kill(signal);
};

process.on("SIGINT", () => {
  stopAll("SIGINT");
});
process.on("SIGTERM", () => {
  stopAll("SIGTERM");
});

webProcess.on("exit", (code, signal) => shutdown("web", code, signal));
headlessProcess.on("exit", (code, signal) =>
  shutdown("orchestrator", code, signal),
);
