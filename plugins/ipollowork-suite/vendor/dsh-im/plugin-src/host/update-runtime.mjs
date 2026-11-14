import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import semver from 'semver';

export const PACKAGE_NAME = '@xmanrui/dsh-im';
export const NPM_REGISTRY = 'https://registry.npmjs.org/';

const INSTALL_TIMEOUT_MS = 15 * 60_000;
const CONFIG_TIMEOUT_MS = 10_000;
const OUTPUT_LIMIT = 16 * 1024;

function failure(code, extra = {}) {
  return Object.assign(new Error(code), { code, ...extra });
}

// Cordis 4's get() is the supported optional-service lookup. Putting these
// Desktop-only services in the plugin's inject array would disable web Hosts.
function service(ctx, name) {
  return typeof ctx?.get === 'function' ? ctx.get(name) : ctx?.[name];
}

function inside(directory, filename) {
  const suffix = relative(directory, filename);
  return suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix);
}

async function readOptional(filename) {
  try {
    return await readFile(filename, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

async function packageAt(directory) {
  const contents = await readFile(join(directory, 'package.json'), 'utf8');
  return { directory: await realpath(directory), manifest: JSON.parse(contents), contents };
}

async function containingPackage(filename, name) {
  let directory = dirname(await realpath(filename));
  while (true) {
    try {
      const found = await packageAt(directory);
      return found.manifest?.name === name ? found : null;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

function profileNameValid(name) {
  return typeof name === 'string' && name.length > 0 && Buffer.byteLength(name) <= 255
    && !name.startsWith('-') && !['.', '..', 'node_modules'].includes(name)
    && !/[\\/\x00-\x1f\x7f<>:"|?*]/u.test(name);
}

function cliProfile(args) {
  if (args[0] === 'web') return 'web';
  let name;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--profile') name = args[++index];
    else if (token.startsWith('--profile=')) name = token.slice('--profile='.length);
    else if (token === '--patch') index += 1;
    else if (!token.startsWith('--patch=')) break;
  }
  return name;
}

function dshHome(env, osHome) {
  let selected = env.DSH_HOME?.trim() ? env.DSH_HOME : join(osHome, '.dsh');
  if (selected === '~') selected = osHome;
  else if (/^~[\\/]/u.test(selected)) selected = join(osHome, selected.slice(2));
  return resolve(selected);
}

function registrySpec(spec) {
  return typeof spec === 'string' && spec.trim().length > 0
    && (semver.validRange(spec) !== null || /^[A-Za-z][A-Za-z0-9._-]*$/u.test(spec));
}

async function validPackage(pkg) {
  if (pkg.manifest?.name !== PACKAGE_NAME || semver.valid(pkg.manifest.version) === null) return false;
  const entries = [
    pkg.manifest.main,
    pkg.manifest.exports?.['./client'],
    pkg.manifest.dsh?.bundle?.patch,
  ];
  for (const entry of entries) {
    if (typeof entry !== 'string' || !entry || isAbsolute(entry) || entry.includes('\0')) return false;
    const filename = resolve(pkg.directory, entry);
    if (!inside(pkg.directory, filename) || !inside(pkg.directory, await realpath(filename))) return false;
    if (!(await stat(filename)).isFile()) return false;
  }
  return true;
}

function officialRegistry(value) {
  if (value === undefined || value === null || value === '') return true;
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.href === NPM_REGISTRY;
  } catch {
    return false;
  }
}

/** Drain bounded output; raw subprocess diagnostics never cross the RPC boundary. */
async function run(start, { signal, timeoutMs, errorCode, capture = false }) {
  if (signal?.aborted) throw failure('install-interrupted');
  const controller = new AbortController();
  let interrupted;
  let operation;
  const cancel = (code) => {
    interrupted ??= code;
    controller.abort();
    operation?.cancel?.();
  };
  const onAbort = () => cancel('install-interrupted');
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => cancel('install-timeout'), timeoutMs);
  let stdout = '';
  let stderr = '';
  try {
    operation = start(controller.signal);
    // The Host services own process-tree termination and wait for actual exit.
    // Do not race their completion: a timed-out installer may still hold files.
    operation.stdout?.on('data', (chunk) => {
      if (capture) stdout = (stdout + chunk.toString()).slice(-OUTPUT_LIMIT);
    });
    operation.stderr?.on('data', (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-OUTPUT_LIMIT);
    });
    operation.stdout?.on('error', () => cancel(errorCode));
    operation.stderr?.on('error', () => cancel(errorCode));
    const outcome = await operation.done;
    if (interrupted) throw failure(interrupted);
    if (outcome.exitCode !== 0 || outcome.signal) {
      throw failure(errorCode, {
        exitCode: outcome.exitCode,
        diagnosticCode: stderr.match(/\bERR_PNPM_[A-Z0-9_]+\b/u)?.[0],
      });
    }
    return { exitCode: 0, signal: null, ...(capture ? { stdout } : {}) };
  } catch (error) {
    if (interrupted) throw failure(interrupted);
    if (error.code === errorCode) throw error;
    throw failure(errorCode);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Adapt the running Host's existing package-management capabilities. Options
 * replace process facts in tests only; no runtime path comes from RPC input.
 */
export function createUpdateRuntime(options = {}) {
  const ctx = options.ctx;
  const env = options.env ?? process.env;
  const argv = options.argv ?? process.argv;
  const execArgv = options.execArgv ?? process.execArgv;
  const execPath = options.execPath ?? process.execPath;
  const cwd = options.cwd ?? process.cwd();
  const platform = options.platform ?? process.platform;
  const osHome = options.osHome ?? homedir();
  const electron = options.electron ?? process.versions.electron;
  const moduleUrl = options.moduleUrl ?? import.meta.url;
  const loadedPackage = containingPackage(fileURLToPath(moduleUrl), PACKAGE_NAME).catch(() => null);
  let boundProfile;

  async function environment() {
    const profiles = service(ctx, 'desktopProfiles');
    const desktop = service(ctx, 'desktopPnpm');
    const bootstrap = service(ctx, 'desktopPnpmBootstrap');
    const isDesktop = Boolean(electron || profiles || desktop || bootstrap);
    const current = profiles?.current;
    const profileName = isDesktop ? current?.name : cliProfile(argv.slice(2));
    const homeDir = isDesktop && bootstrap?.homeDir ? resolve(bootstrap.homeDir) : dshHome(env, osHome);
    const result = { environmentKind: isDesktop ? 'desktop' : 'cli', homeDir, profileName };
    if (!profileNameValid(profileName)) return { ...result, blockedReason: 'unknown-profile' };
    const profileDir = await realpath(join(homeDir, 'profiles', profileName));
    const home = await realpath(homeDir);
    const base = { ...result, homeDir: home, profileDir };

    if (isDesktop) {
      try {
        if (typeof desktop?.runPlugin !== 'function' || typeof desktop?.run !== 'function' || !bootstrap
            || !current?.dir || bootstrap.activeProfileName !== profileName
            || await realpath(current.dir) !== profileDir
            || await realpath(bootstrap.activeProfileDir) !== profileDir
            || await realpath(bootstrap.appExecutable) !== await realpath(execPath)) {
          return { ...base, blockedReason: 'executor-unavailable' };
        }
        const desktopPackage = await containingPackage(bootstrap.dshBootstrapPath, 'dsh-plugin-desktop');
        if (!desktopPackage || basename(bootstrap.dshBootstrapPath) !== 'desktop-cli.js'
            || dirname(await realpath(bootstrap.dshBootstrapPath)) !== join(desktopPackage.directory, 'lib')) {
          return { ...base, blockedReason: 'executor-unavailable' };
        }
        return { ...base, desktop, executable: execPath, cliEntry: bootstrap.dshBootstrapPath };
      } catch {
        return { ...base, blockedReason: 'executor-unavailable' };
      }
    }

    const subprocess = service(ctx, 'subprocess');
    if (typeof subprocess?.spawn !== 'function' || typeof argv[1] !== 'string' || !isAbsolute(argv[1]) || platform === 'win32') {
      return { ...base, blockedReason: 'executor-unavailable' };
    }
    try {
      const cli = await containingPackage(argv[1], '@deepseek-ai/dsh');
      if (!cli) return { ...base, blockedReason: 'executor-unavailable' };
      const cliEntry = await realpath(argv[1]);
      const declared = typeof cli.manifest.bin === 'string' ? cli.manifest.bin : cli.manifest.bin?.dsh;
      const publishedEntry = typeof declared === 'string' ? resolve(cli.directory, declared) : '';
      if (cliEntry !== publishedEntry && cliEntry !== join(cli.directory, 'src', 'bin.ts')) {
        return { ...base, blockedReason: 'executor-unavailable' };
      }
      return { ...base, subprocess, executable: execPath, cliEntry };
    } catch {
      return { ...base, blockedReason: 'executor-unavailable' };
    }
  }

  function cliOperation(runtime, args, signal, directPnpm = false) {
    const child = runtime.subprocess.spawn({
      argv: directPnpm ? ['pnpm', ...args] : [execPath, ...execArgv, runtime.cliEntry, ...args],
      cwd: directPnpm ? runtime.profileDir : cwd,
      env: { DSH_HOME: runtime.homeDir, CI: 'true' },
      stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
      graceMs: 3_000,
      signal,
    });
    return {
      stdout: child.stdout,
      stderr: child.stderr,
      cancel: () => child.terminate(),
      done: (async () => {
        try { return await child.done; }
        finally { await child.waitForExit(); }
      })(),
    };
  }

  async function checkRegistry(runtime, signal) {
    const args = ['config', 'get', '@xmanrui:registry', '--json'];
    const result = await run(
      (childSignal) => runtime.desktop
        ? runtime.desktop.run(args, childSignal)
        : cliOperation(runtime, args, childSignal, true),
      { signal, timeoutMs: options.configTimeoutMs ?? CONFIG_TIMEOUT_MS, errorCode: 'registry-check-failed', capture: true },
    );
    const output = result.stdout.trim();
    let value;
    try { value = output === '' || output === 'undefined' ? undefined : JSON.parse(output); }
    catch { throw failure('registry-check-failed'); }
    if (!officialRegistry(value)) throw failure('registry-conflict');
  }

  async function inspect({ preflight = false } = {}) {
    let runtime;
    const result = { installedVersion: null, packageValid: false, eligible: false, installationKey: null };
    try {
      runtime = await environment();
      for (const key of ['homeDir', 'profileDir', 'profileName', 'environmentKind', 'executable', 'cliEntry']) {
        result[key] = runtime[key] ?? null;
      }
      if (!runtime.profileDir) return { ...result, blockedReason: runtime.blockedReason ?? 'unknown-profile' };

      const profile = await packageAt(runtime.profileDir);
      const installed = await packageAt(join(runtime.profileDir, 'node_modules', PACKAGE_NAME));
      result.sourceInstall = !registrySpec(profile.manifest.dependencies?.[PACKAGE_NAME])
        || !inside(join(runtime.profileDir, 'node_modules'), installed.directory);
      result.installedVersion = typeof installed.manifest.version === 'string' ? installed.manifest.version : null;
      result.packageValid = await validPackage(installed);
      const loaded = await loadedPackage;
      const identity = `${runtime.homeDir}\0${runtime.profileDir}\0${runtime.profileName}`;
      const sameLoadedPackage = loaded?.directory === installed.directory
        && loaded?.manifest.version === installed.manifest.version;
      if (boundProfile === undefined && sameLoadedPackage && result.packageValid) boundProfile = identity;

      const stateFiles = await Promise.all(['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'package-lock.json']
        .map((filename) => readOptional(join(runtime.profileDir, filename))));
      result.installationKey = createHash('sha256').update(JSON.stringify([
        identity, profile.contents, installed.directory, installed.contents,
        runtime.cliEntry, runtime.executable, ...stateFiles,
      ])).digest('hex');

      if (boundProfile !== undefined && boundProfile !== identity) result.blockedReason = 'installation-changed';
      else if (!sameLoadedPackage && boundProfile === undefined) result.blockedReason = 'installation-changed';
      else if (!result.packageValid) result.blockedReason = 'invalid-installation';
      else if (result.sourceInstall) result.blockedReason = 'source-install';
      else if (runtime.blockedReason) result.blockedReason = runtime.blockedReason;
      else if (!sameLoadedPackage) result.blockedReason = 'pending-restart';
      else if (preflight) await checkRegistry(runtime);

      result.eligible = !result.blockedReason;
      return { ...result, blockedReason: result.blockedReason ?? null };
    } catch (error) {
      const known = ['registry-conflict', 'registry-check-failed', 'install-timeout', 'install-interrupted'];
      return { ...result, blockedReason: known.includes(error.code) ? error.code : runtime?.profileDir ? 'invalid-installation' : 'unknown-profile' };
    }
  }

  async function install(version, { signal, expectedInstallationKey } = {}) {
    if (semver.valid(version) !== version || semver.prerelease(version)) throw failure('invalid-version');
    const before = await inspect();
    if (expectedInstallationKey !== undefined && before.installationKey !== expectedInstallationKey) {
      throw failure('installation-changed');
    }
    if (!before.eligible) throw failure(before.blockedReason);
    const runtime = await environment();
    await checkRegistry(runtime, signal);
    // Config validation is asynchronous: do not replace a package another
    // package manager changed while it ran.
    const checked = await inspect();
    if (!checked.eligible || checked.installationKey !== before.installationKey) throw failure('installation-changed');
    const args = ['add', '-w', '--save-exact', `${PACKAGE_NAME}@${version}`, `--registry=${NPM_REGISTRY}`];
    return run(
      (childSignal) => runtime.desktop
        ? runtime.desktop.runPlugin(args, runtime.profileDir, childSignal)
        : cliOperation(runtime, ['plugin', '--profile', runtime.profileName, ...args], childSignal),
      { signal, timeoutMs: options.installTimeoutMs ?? INSTALL_TIMEOUT_MS, errorCode: 'install-failed' },
    );
  }

  return Object.freeze({ inspect, install });
}
