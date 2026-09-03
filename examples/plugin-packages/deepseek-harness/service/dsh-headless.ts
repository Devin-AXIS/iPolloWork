import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import type { HarnessTurnResult } from "./dsh-jsonrpc.ts";

const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_ERROR_DETAIL_CHARS = 16_000;
const MAX_WINDOWS_LINK_RETRIES = 8;
const MAX_TURN_DURATION_MS = 60 * 60 * 1_000;

type HeadlessTurnInput = {
  command: string;
  commandArgs: string[];
  script: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  patch: string;
  prompt: string;
  signal: AbortSignal;
};

type ProcessResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

function terminate(child: ChildProcessWithoutNullStreams): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }, 2_000).unref();
}

function runProcess(input: HeadlessTurnInput): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.command, [...input.commandArgs, input.script, "--profile", "headless", "--patch", input.patch, input.prompt], {
      cwd: input.cwd,
      env: {
        ...input.env,
        ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
      },
      windowsHide: true,
      stdio: "pipe",
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      input.signal.removeEventListener("abort", onAbort);
      operation();
    };
    const collect = (target: Buffer[], chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        terminate(child);
        finish(() => reject(new Error(`DeepSeek Harness output exceeded ${MAX_OUTPUT_BYTES} bytes`)));
        return;
      }
      target.push(chunk);
    };
    const onAbort = () => {
      terminate(child);
      finish(() => reject(new Error("DeepSeek Harness job was cancelled")));
    };
    const timeout = setTimeout(() => {
      terminate(child);
      finish(() => reject(new Error("DeepSeek Harness service did not respond within 60 minutes")));
    }, MAX_TURN_DURATION_MS);
    timeout.unref();
    input.signal.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
    child.once("error", (error) => finish(() => reject(error)));
    child.once("exit", (code) => finish(() => resolve({
      code,
      stdout: Buffer.concat(stdout).toString("utf8").trim(),
      stderr: Buffer.concat(stderr).toString("utf8").trim(),
    })));
  });
}

function retryableWindowsLinkFailure(result: ProcessResult): boolean {
  return process.platform === "win32"
    && result.code !== 0
    && result.stderr.includes("EBUSY")
    && result.stderr.includes("symlink");
}

function failureDetail(result: ProcessResult): string {
  const streams = [
    result.stderr ? `stderr:\n${result.stderr}` : "",
    result.stdout ? `stdout:\n${result.stdout}` : "",
  ].filter(Boolean);
  if (streams.length === 0) {
    return "DSH exited before producing a final response. The model may have reached its maxTokens limit or the provider may have rejected the request.";
  }
  return streams.join("\n").slice(-MAX_ERROR_DETAIL_CHARS);
}

export async function runHarnessHeadless(input: HeadlessTurnInput): Promise<HarnessTurnResult> {
  if (input.signal.aborted) throw new Error("DeepSeek Harness job was cancelled");
  for (let attempt = 0; attempt < MAX_WINDOWS_LINK_RETRIES; attempt += 1) {
    const result = await runProcess(input);
    if (result.code === 0) {
      if (!result.stdout) throw new Error("DeepSeek Harness completed without a final response");
      return { finalResponse: result.stdout, notificationCount: 0, subagentCount: 0 };
    }
    if (retryableWindowsLinkFailure(result) && attempt + 1 < MAX_WINDOWS_LINK_RETRIES) continue;
    throw new Error(`DeepSeek Harness headless runtime failed (${result.code ?? "unknown"})\n${failureDetail(result)}`);
  }
  throw new Error("DeepSeek Harness headless runtime could not initialize");
}
