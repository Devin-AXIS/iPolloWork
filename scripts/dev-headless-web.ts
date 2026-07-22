import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import path from "node:path";

const cwd = process.cwd();
const tmpDir = path.join(cwd, "tmp");
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

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
  process.env.IPOLLOWORK_DEV_HEADLESS_WEB_AUTOBUILD == null
    ? true
    : readBool(process.env.IPOLLOWORK_DEV_HEADLESS_WEB_AUTOBUILD);

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

const remoteAccessEnabled = readBool(process.env.IPOLLOWORK_REMOTE_ACCESS);
const host = remoteAccessEnabled ? "0.0.0.0" : "127.0.0.1";
const viteHost = process.env.VITE_HOST ?? process.env.HOST ?? host;
const publicHost = process.env.IPOLLOWORK_PUBLIC_HOST ?? null;
const clientHost = publicHost ?? (host === "0.0.0.0" ? "127.0.0.1" : host);
const workspace = process.env.IPOLLOWORK_WORKSPACE ?? cwd;
const ipolloworkPort = await resolvePort(process.env.IPOLLOWORK_PORT, "127.0.0.1");
const webPort = await resolvePort(process.env.IPOLLOWORK_WEB_PORT, "127.0.0.1");
const ipolloworkToken = process.env.IPOLLOWORK_TOKEN ?? randomUUID();
const ipolloworkHostToken = process.env.IPOLLOWORK_HOST_TOKEN ?? randomUUID();
const ipolloworkServerBin = path.join(
  cwd,
  `apps/server/dist/bin/ipollowork-server${process.platform === "win32" ? ".exe" : ""}`,
);
const bundledTemplatesDir = path.join(cwd, "apps/server/dist/bundled-templates");

const ensureiPolloWorkServer = async () => {
  try {
    await access(ipolloworkServerBin);
  } catch {
    if (!autoBuildEnabled) {
      logLine(
        `[dev:headless-web] Missing iPolloWork server binary at ${ipolloworkServerBin}`,
      );
      logLine(
        "[dev:headless-web] Auto-build disabled (IPOLLOWORK_DEV_HEADLESS_WEB_AUTOBUILD=0)",
      );
      logLine(
        "[dev:headless-web] Run: pnpm --filter ipollowork-server build:bin",
      );
      logLine(
        "[dev:headless-web] Or unset/enable IPOLLOWORK_DEV_HEADLESS_WEB_AUTOBUILD to auto-build.",
      );
      process.exit(1);
    }

    logLine(
      `[dev:headless-web] Missing iPolloWork server binary at ${ipolloworkServerBin}`,
    );
    logLine(
      "[dev:headless-web] Auto-building: pnpm --filter ipollowork-server build:bin",
    );
    try {
      await runCommand(pnpmCommand, ["--filter", "ipollowork-server", "build:bin"]);
      await access(ipolloworkServerBin);
    } catch (error) {
      logLine(
        `[dev:headless-web] Auto-build failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(1);
    }
  }
};

const ipolloworkUrl = `http://${clientHost}:${ipolloworkPort}`;
const webUrl = `http://${clientHost}:${webPort}`;
const viteEnv = {
  ...process.env,
  HOST: viteHost,
  PORT: String(webPort),
  VITE_IPOLLOWORK_URL: process.env.VITE_IPOLLOWORK_URL ?? ipolloworkUrl,
  VITE_IPOLLOWORK_PORT: process.env.VITE_IPOLLOWORK_PORT ?? String(ipolloworkPort),
  VITE_IPOLLOWORK_TOKEN: process.env.VITE_IPOLLOWORK_TOKEN ?? ipolloworkToken,
};
const headlessEnv = {
  ...process.env,
  IPOLLOWORK_WORKSPACE: workspace,
  IPOLLOWORK_HOST: host,
  IPOLLOWORK_REMOTE_ACCESS: remoteAccessEnabled ? "1" : "0",
  IPOLLOWORK_PORT: String(ipolloworkPort),
  IPOLLOWORK_TOKEN: ipolloworkToken,
  IPOLLOWORK_HOST_TOKEN: ipolloworkHostToken,
  IPOLLOWORK_SERVER_BIN: ipolloworkServerBin,
  IPOLLOWORK_BUNDLED_TEMPLATES_DIR: bundledTemplatesDir,
  IPOLLOWORK_SIDECAR_SOURCE: process.env.IPOLLOWORK_SIDECAR_SOURCE ?? "external",
};

await ensureiPolloWorkServer();

logLine("[dev:headless-web] Starting services");
logLine(`[dev:headless-web] Workspace: ${workspace}`);
logLine(`[dev:headless-web] iPolloWork server: ${ipolloworkUrl}`);
logLine(`[dev:headless-web] Web host: ${viteHost}`);
logLine(`[dev:headless-web] Web port: ${webPort}`);
logLine(`[dev:headless-web] Web URL: ${webUrl}`);
logLine("[dev:headless-web] IPOLLOWORK_TOKEN: [REDACTED]");
logLine("[dev:headless-web] IPOLLOWORK_HOST_TOKEN: [REDACTED]");
logLine(
  `[dev:headless-web] Web logs: ${path.relative(cwd, path.join(tmpDir, "dev-web.log"))}`,
);
logLine(
  `[dev:headless-web] Headless logs: ${path.relative(cwd, path.join(tmpDir, "dev-headless.log"))}`,
);

const webProcess = spawnLogged(
  pnpmCommand,
  [
    "--filter",
    "@ipollowork/app",
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
  pnpmCommand,
  [
    "--filter",
    "ipollowork-orchestrator",
    "dev",
    "--",
    "start",
    "--workspace",
    workspace,
    "--approval",
    "auto",
    "--allow-external",
    ...(remoteAccessEnabled ? ["--remote-access"] : []),
    "--ipollowork-port",
    String(ipolloworkPort),
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
