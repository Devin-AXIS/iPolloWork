import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const sessionPageSource = readFileSync(
  new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");

const routeWorkspacesSource = readFileSync(
  new URL("../src/react-app/shell/route-workspaces.ts", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");

describe("session error repair actions", () => {
  test("shows automatic repair and repair script actions on workspace errors", () => {
    expect(sessionPageSource).toContain("buildWorkspaceRepairScript");
    expect(sessionPageSource).toContain("Auto repair");
    expect(sessionPageSource).toContain("Copy repair script");
    expect(sessionPageSource).toContain("navigator.clipboard.writeText(workspaceRepairScript)");
  });

  test("keeps automatic repair on the safe workspace recovery path", () => {
    expect(sessionPageSource).toContain("props.sidebar.onRecoverWorkspace(props.selectedWorkspaceId)");
    expect(sessionPageSource).toContain("props.sidebar.onTestWorkspaceConnection(props.selectedWorkspaceId)");
    expect(sessionPageSource).toContain("props.sidebar.onCreateTaskInWorkspace(props.selectedWorkspaceId)");
    expect(sessionPageSource).not.toContain("child_process");
    expect(sessionPageSource).not.toContain("exec(");
  });

  test("generates engine-aware launch recovery without installing a second Codex CLI", () => {
    expect(routeWorkspacesSource).toContain("export function isSidecarLaunchBlockedError");
    expect(routeWorkspacesSource).toContain("export function describeSidecarLaunchBlockedError");
    expect(sessionPageSource).toContain("isSidecarLaunchBlockedError(input.message)");
    expect(sessionPageSource).toContain("input.engineId?.trim() === CODEX_HARNESS_ENGINE_ID");
    expect(sessionPageSource).toContain("[Environment]::SetEnvironmentVariable('IPOLLOWORK_CODEX_CLI', $null, 'User')");
    expect(sessionPageSource).toContain("select a verified local or managed Codex runtime on restart");
    expect(sessionPageSource).not.toContain("npm install -g @openai/codex");
  });
});
