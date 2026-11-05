import { spawn } from "node:child_process";
import { copyFile, lstat, mkdir, readlink, realpath, symlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;

type CommandResult = {
  code: number | null;
  stdout: Buffer;
  stderr: Buffer;
};

export type IsolatedWorkspace = {
  root: string;
  cwd: string;
  baseline: string;
};

function command(command: string, args: string[], cwd: string, input?: Buffer, acceptedExitCodes = [0]): Promise<CommandResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { cwd, stdio: "pipe" });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_GIT_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        reject(new Error(`${command} output exceeded ${MAX_GIT_OUTPUT_BYTES} bytes`));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= MAX_GIT_OUTPUT_BYTES) stderr.push(chunk);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== null && acceptedExitCodes.includes(code)) resolveResult({ code, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
      else reject(new Error(`${command} ${args.join(" ")} failed (${code ?? "unknown"}): ${Buffer.concat(stderr).toString("utf8").trim()}`));
    });
    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

function gitArguments(args: string[]): string[] {
  return process.platform === "win32" ? ["-c", "core.longpaths=true", ...args] : args;
}

async function git(cwd: string, args: string[], input?: Buffer): Promise<Buffer> {
  return (await command("git", gitArguments(args), cwd, input)).stdout;
}

async function gitRevision(cwd: string): Promise<string | null> {
  const result = await command("git", gitArguments(["rev-parse", "--verify", "--quiet", "HEAD"]), cwd, undefined, [0, 1]);
  return result.code === 0 ? result.stdout.toString("utf8").trim() : null;
}

function inside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

async function copyWorkspaceFiles(sourceRoot: string, targetRoot: string, includeTracked: boolean): Promise<void> {
  const paths = (await git(sourceRoot, ["ls-files", ...(includeTracked ? ["--cached"] : []), "--others", "--exclude-standard", "-z"]))
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  for (const path of paths) {
    if (isAbsolute(path)) throw new Error(`Git returned an absolute untracked path: ${path}`);
    const source = resolve(sourceRoot, path);
    const target = resolve(targetRoot, path);
    if (!inside(sourceRoot, source) || !inside(targetRoot, target)) throw new Error(`Untracked path escaped the repository: ${path}`);
    await mkdir(dirname(target), { recursive: true });
    const metadata = await lstat(source);
    if (metadata.isSymbolicLink()) await symlink(await readlink(source), target);
    else if (metadata.isFile()) await copyFile(source, target);
  }
}

export async function prepareIsolatedWorkspace(sourceDirectory: string, destination: string): Promise<IsolatedWorkspace> {
  const source = await realpath(resolve(sourceDirectory));
  const gitRoot = await realpath((await git(source, ["rev-parse", "--show-toplevel"])).toString("utf8").trim());
  const sourceRelative = relative(gitRoot, source);
  if (sourceRelative.startsWith("..") || isAbsolute(sourceRelative)) throw new Error("Current directory is outside its Git worktree");
  const revision = await gitRevision(gitRoot);
  await mkdir(dirname(destination), { recursive: true });
  if (revision) {
    await git(gitRoot, ["clone", "--shared", "--no-hardlinks", "--no-checkout", "--", gitRoot, destination]);
    await git(destination, ["checkout", "--detach", revision]);
    const dirtyPatch = await git(gitRoot, ["diff", "--binary", "--no-ext-diff", "HEAD", "--"]);
    if (dirtyPatch.length) await git(destination, ["apply", "--binary", "--whitespace=nowarn", "-"], dirtyPatch);
  } else {
    await mkdir(destination, { recursive: true });
    await git(destination, ["init"]);
  }
  if (process.platform === "win32") await git(destination, ["config", "core.longpaths", "true"]);
  await copyWorkspaceFiles(gitRoot, destination, revision === null);
  await git(destination, ["add", "-A"]);
  await git(destination, [
    "-c", "user.name=iPolloWork",
    "-c", "user.email=local@ipollowork.invalid",
    "commit", "--allow-empty", "-m", "iPolloWork DSH isolated baseline",
  ]);
  const baseline = (await git(destination, ["rev-parse", "HEAD"])).toString("utf8").trim();
  const cwd = sourceRelative ? join(destination, sourceRelative) : destination;
  await mkdir(cwd, { recursive: true });
  return {
    root: destination,
    cwd,
    baseline,
  };
}

export async function collectWorkspacePatch(workspace: IsolatedWorkspace): Promise<string> {
  await git(workspace.root, ["add", "-N", "-A"]);
  return (await git(workspace.root, ["diff", "--binary", "--no-ext-diff", workspace.baseline, "--"])).toString("utf8");
}
