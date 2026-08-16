import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createSshOps } from "./ssh-ops.mjs";

function fakePty() {
  const spawned = [];
  return {
    spawned,
    spawn(program, args, options) {
      const proc = { program, args, options, write() {}, resize() {}, kill() {} };
      spawned.push(proc);
      return proc;
    },
  };
}

function sshOpsWithConfig(configBody) {
  const home = mkdtempSync(path.join(tmpdir(), "ipw-ssh-test-"));
  if (configBody !== null) {
    const sshDir = path.join(home, ".ssh");
    mkdirSync(sshDir, { recursive: true });
    writeFileSync(path.join(sshDir, "config"), configBody, "utf8");
  }
  const pty = fakePty();
  const ops = createSshOps({ pty, homedir: () => home });
  return { ops, pty, home };
}

test("spawnTerminalProcess spawns the shell with no args by default", () => {
  const { ops, pty } = sshOpsWithConfig(null);
  const child = ops.spawnTerminalProcess({ cwd: "/", cols: 80, rows: 24 });
  assert.equal(pty.spawned.length, 1);
  assert.equal(pty.spawned[0].args.length, 0);
  assert.equal(child, pty.spawned[0]);
  assert.equal(pty.spawned[0].options.env.IPOLLOWORK_TERMINAL, "1");
});

test("spawnTerminalProcess runs an explicit command directly (not via shell)", () => {
  const { ops, pty } = sshOpsWithConfig(null);
  ops.spawnTerminalProcess({ cwd: "/", cols: 80, rows: 24, command: ["ssh", "-t", "user@host"] });
  assert.equal(pty.spawned.length, 1);
  assert.equal(pty.spawned[0].program, "ssh");
  assert.deepEqual(pty.spawned[0].args, ["-t", "user@host"]);
});

test("spawnTerminalProcess honors an explicit shellPath when no command", () => {
  const { ops, pty } = sshOpsWithConfig(null);
  ops.spawnTerminalProcess({ cwd: "/", cols: 80, rows: 24, shellPath: "/bin/zsh" });
  assert.equal(pty.spawned[0].program, "/bin/zsh");
});

test("readSshConfigHosts parses simple and multi-host entries, skipping wildcards", () => {
  const body = `# comment
Host github.com
  HostName github.com
  User git

Host web-01 web-02
  User root

Host *.example.com
  HostName proxy.example.com
`;
  const { ops, home } = sshOpsWithConfig(body);
  const result = ops.readSshConfigHosts();
  assert.deepEqual(result.hosts, ["github.com", "web-01", "web-02"]);
  assert.equal(result.configPath, path.join(home, ".ssh", "config"));
});

test("readSshConfigHosts handles malformed/empty config gracefully", () => {
  const { ops } = sshOpsWithConfig(`\n# only a comment\n   \n`);
  const result = ops.readSshConfigHosts();
  assert.deepEqual(result.hosts, []);
});

test("readSshConfigHosts returns empty when config is missing", () => {
  const { ops } = sshOpsWithConfig(null);
  const result = ops.readSshConfigHosts();
  assert.deepEqual(result.hosts, []);
});
