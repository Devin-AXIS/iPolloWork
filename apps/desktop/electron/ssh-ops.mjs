// SSH ops terminal support: shared pty spawn (used by the in-session dock
// and the ops panel) plus ~/.ssh/config host discovery. Extracted from
// main.mjs into a factory so it can be unit-tested in isolation.
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function createSshOps({ pty, homedir = () => os.homedir() }) {
  function defaultTerminalShell() {
    if (process.platform === "win32") return process.env.COMSPEC || "powershell.exe";
    return process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash");
  }

  // Shared terminal spawn used by both the in-session dock and the SSH ops
  // panel. When `command` is provided it runs the executable directly instead
  // of dropping into an interactive shell — e.g. ["ssh", "user@host"].
  // Spawning the command itself (not `shell -c ...`) keeps the pty on the
  // executable so interactive prompts behave like a real ssh client.
  function spawnTerminalProcess({ cwd, cols, rows, command, shellPath }) {
    const program = Array.isArray(command) && command.length > 0
      ? command[0]
      : (shellPath ?? defaultTerminalShell());
    const args = Array.isArray(command) && command.length > 1 ? command.slice(1) : [];
    return pty.spawn(program, args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        IPOLLOWORK_TERMINAL: "1",
      },
    });
  }

  // Parse ~/.ssh/config into a lightweight host list for the ops panel.
  // Mirrors OpenSSH semantics for the Host directive without shelling out to
  // `ssh -G`, keeping the operation local and dependency-free.
  function readSshConfigHosts() {
    const configPath = path.join(homedir(), ".ssh", "config");
    let raw;
    try {
      raw = readFileSync(configPath, "utf8");
    } catch {
      return { hosts: [], configPath };
    }
    const hosts = [];
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = /^Host\s+(.+)$/.exec(trimmed);
      if (!match) continue;
      const entries = match[1].split(/\s+/).filter(Boolean);
      for (const entry of entries) {
        if (entry.includes("*") || entry.includes("?")) continue;
        hosts.push(entry);
      }
    }
    return { hosts: [...new Set(hosts)], configPath };
  }

  return { spawnTerminalProcess, readSshConfigHosts, defaultTerminalShell };
}
