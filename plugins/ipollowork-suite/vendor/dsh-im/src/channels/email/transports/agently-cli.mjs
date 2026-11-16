/**
 * Runs the official `agently-cli` and returns its JSON.
 *
 * The CLI owns the Agent mailbox protocol, including OAuth and the token
 * refresh. A hand-written client could not refresh: the server issued an
 * access token that worked while the matching refresh token was rejected with
 * `invalid_grant` the moment it was used, so the mailbox died an hour after
 * every authorization. The CLI keeps credentials in the system keychain, tracks
 * `expires_at`, refreshes ahead of expiry, and re-authorizes a watcher that has
 * gone stale — none of which is reproducible from outside.
 *
 * Contract notes learned from the binary and its own schemas:
 *   - stdout carries the JSON document; the `tip:` lines go to stderr.
 *   - The exit code is 0 even for an error document, so `ok` is the only
 *     reliable success signal.
 *   - A `--print-output-schema` flag documents every command's fields.
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

/** Platform-specific binaries, mirroring the CLI's own packaging. */
const PLATFORM_PACKAGES = {
  'darwin-arm64': '@tencent-qqmail/agently-cli-darwin-arm64',
  'darwin-x64': '@tencent-qqmail/agently-cli-darwin-x64',
  'linux-arm64': '@tencent-qqmail/agently-cli-linux-arm64',
  'linux-x64': '@tencent-qqmail/agently-cli-linux-x64',
  'win32-arm64': '@tencent-qqmail/agently-cli-win32-arm64',
  'win32-x64': '@tencent-qqmail/agently-cli-win32-x64',
};

/** How long a single CLI invocation may run before it is abandoned. */
const DEFAULT_TIMEOUT_MS = 60_000;

export class AgentMailCliError extends Error {
  constructor(message, { code = 'cli-failed', status = null, detail = null, cause } = {}) {
    super(message, { cause });
    this.name = 'AgentMailCliError';
    this.code = code;
    if (status !== null) this.status = status;
    if (detail !== null) this.detail = detail;
  }
}

/**
 * Resolve the CLI binary.
 *
 * The bundled platform package is preferred so a working install never depends
 * on a global one; `agently-cli` on the PATH is the fallback for a user who
 * installed it themselves.
 */
export function resolveCliBinary() {
  const platformPackage = PLATFORM_PACKAGES[`${process.platform}-${process.arch}`];
  if (platformPackage) {
    try {
      const resolved = require.resolve(`${platformPackage}/package.json`);
      const name = process.platform === 'win32' ? 'agently-cli.exe' : 'agently-cli';
      return { command: join(dirname(resolved), 'bin', name), source: 'bundled' };
    } catch {
      // Fall through to the wrapper, then PATH.
    }
  }
  try {
    const wrapper = require.resolve('@tencent-qqmail/agently-cli/package.json');
    return { command: join(dirname(wrapper), 'scripts', 'run.js'), source: 'wrapper' };
  } catch {
    return { command: 'agently-cli', source: 'path' };
  }
}

/** Whether the CLI can be launched at all. */
export function isCliAvailable() {
  const { command, source } = resolveCliBinary();
  if (source === 'path') return false;
  return Boolean(command);
}

/**
 * Start `auth login` and resolve as soon as it prints the authorization URL.
 *
 * The command then blocks until the user completes the scan, so it is left
 * running rather than waited on; the caller polls `auth status` to observe the
 * outcome, and the process exits on its own once the scan lands or it expires.
 */
export function startCliLogin({ signal, timeoutMs = 30_000, env = {}, workspace } = {}) {
  const { command } = resolveCliBinary();
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, ['auth', 'login'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...cliEnv(workspace), ...env },
      });
    } catch (error) {
      reject(new AgentMailCliError(`unable to launch agently-cli: ${error.message}`, {
        code: 'cli-unavailable', cause: error,
      }));
      return;
    }

    let settled = false;
    let buffered = '';
    const stop = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
    };
    const timer = timeoutMs > 0
      ? setTimeout(() => {
        if (settled) return;
        stop();
        reject(new AgentMailCliError('agently-cli printed no authorization URL', {
          code: 'authorization-url-missing', detail: buffered.slice(0, 400),
        }));
      }, timeoutMs)
      : null;
    timer?.unref?.();

    const onAbort = () => {
      child.kill('SIGTERM');
      stop();
      reject(new AgentMailCliError('authorization aborted', { code: 'cli-aborted' }));
    };
    if (signal) {
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener?.('abort', onAbort, { once: true });
    }

    const scan = (chunk) => {
      buffered += chunk;
      const url = /https:\/\/agent\.qq\.com\/page\/oauth\S*/.exec(buffered)?.[0];
      if (!url) return;
      stop();
      // The process keeps running so the scan can complete; it is detached from
      // this promise on purpose.
      resolve({ browserUrl: url, inputCode: /user_code=([^&\s]+)/.exec(url)?.[1] ?? '', child });
    };
    child.stdout.on('data', (chunk) => scan(String(chunk)));
    child.stderr.on('data', (chunk) => scan(String(chunk)));
    child.on('error', (error) => {
      stop();
      reject(new AgentMailCliError(`agently-cli failed to start: ${error.message}`, {
        code: 'cli-unavailable', cause: error,
      }));
    });
    child.on('close', () => {
      if (settled) return;
      stop();
      reject(new AgentMailCliError('agently-cli exited before printing an authorization URL', {
        code: 'authorization-url-missing', detail: buffered.slice(0, 400),
      }));
    });
  });
}

/**
 * Run the CLI and parse its JSON document.
 *
 * `input` is written to stdin, which is how a body avoids both the argument
 * list and the shell.
 */
/**
 * The environment a CLI call runs with.
 *
 * The CLI isolates accounts by workspace, so a mailbox is addressed by its own
 * workspace name. Without this every Agent mailbox shared one login and the
 * second one always read the first one's account.
 */
export function cliEnv(workspace) {
  return workspace ? { AGENTLY_WORKSPACE: String(workspace) } : {};
}

export function runCli(args, {
  input = null, timeoutMs = DEFAULT_TIMEOUT_MS, signal, env = {},
} = {}) {
  const { command, source } = resolveCliBinary();
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...env },
      });
    } catch (error) {
      reject(new AgentMailCliError(`unable to launch agently-cli (${source}): ${error.message}`, {
        code: 'cli-unavailable', cause: error,
      }));
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      fn(value);
    };

    const timer = timeoutMs > 0
      ? setTimeout(() => {
        child.kill('SIGTERM');
        finish(reject, new AgentMailCliError(`agently-cli timed out after ${timeoutMs}ms`, {
          code: 'cli-timeout',
        }));
      }, timeoutMs)
      : null;
    timer?.unref?.();

    const onAbort = () => {
      child.kill('SIGTERM');
      finish(reject, new AgentMailCliError('agently-cli aborted', { code: 'cli-aborted' }));
    };
    if (signal) {
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener?.('abort', onAbort, { once: true });
    }

    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      finish(reject, new AgentMailCliError(`agently-cli failed to start: ${error.message}`, {
        code: 'cli-unavailable', cause: error,
      }));
    });
    child.on('close', (exitCode) => {
      // The exit code is 0 even for an error document, so `ok` decides.
      let document = null;
      const text = stdout.trim();
      if (text) {
        try {
          document = JSON.parse(text);
        } catch {
          finish(reject, new AgentMailCliError('agently-cli returned unparseable output', {
            code: 'cli-invalid-output', detail: text.slice(0, 400),
          }));
          return;
        }
      }
      if (document && document.ok === false) {
        const failure = document.error ?? {};
        finish(reject, new AgentMailCliError(
          String(failure.message ?? 'agently-cli reported a failure'),
          {
            code: String(failure.type ?? 'cli-failed'),
            status: typeof failure.status === 'number' ? failure.status : null,
            detail: failure,
          },
        ));
        return;
      }
      if (!document) {
        finish(reject, new AgentMailCliError(
          `agently-cli produced no output (exit ${exitCode})`,
          { code: 'cli-empty-output', detail: stderr.trim().slice(0, 400) },
        ));
        return;
      }
      finish(resolve, { document, stdout, stderr, exitCode });
    });

    if (input !== null) child.stdin.end(input);
    else child.stdin.end();
  });
}

/**
 * Run the CLI through an injected implementation.
 *
 * Exists so tests can drive the failure and confirmation paths without a real
 * binary; production always goes through `runCli`.
 */
export async function runCliDocumentForTests(args, { runCliImpl, input = null } = {}) {
  const result = await runCliImpl(args, { input });
  if (result.document && result.document.ok === false) {
    const failure = result.document.error ?? {};
    throw new AgentMailCliError(String(failure.message ?? 'agently-cli reported a failure'), {
      code: String(failure.type ?? 'cli-failed'), detail: failure,
    });
  }
  return result;
}
