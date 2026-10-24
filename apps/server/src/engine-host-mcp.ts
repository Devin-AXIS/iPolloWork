import type { ServerConfig, WorkspaceInfo } from "./types.js";

export function engineHostMcp(
  config: ServerConfig,
  workspace: Pick<WorkspaceInfo, "id">,
) {
  return {
    type: "remote",
    url: `http://127.0.0.1:${config.port}/engine-tools/mcp?workspaceId=${encodeURIComponent(workspace.id)}`,
    headers: { Authorization: `Bearer ${config.token}` },
    // A bounded three-scene speech batch can include synthesis and download.
    timeout: 300_000,
  };
}
