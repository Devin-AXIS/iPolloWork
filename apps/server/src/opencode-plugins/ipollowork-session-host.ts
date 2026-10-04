import { z } from "zod";
import { ENGINE_HOST_TOOL_NAMES } from "../engine-host-tools.js";

type OpenCodeToolContext = {
  sessionID?: string;
  directory?: string;
  worktree?: string;
};

const toolNames = [
  ENGINE_HOST_TOOL_NAMES.conversationRead,
  ENGINE_HOST_TOOL_NAMES.conversationApply,
  ENGINE_HOST_TOOL_NAMES.workTemplateSave,
  ENGINE_HOST_TOOL_NAMES.extensionListActions,
  ENGINE_HOST_TOOL_NAMES.extensionCall,
  ENGINE_HOST_TOOL_NAMES.browserListTabs,
  ENGINE_HOST_TOOL_NAMES.browserDecide,
  ENGINE_HOST_TOOL_NAMES.browserOpenUrl,
  ENGINE_HOST_TOOL_NAMES.browserSnapshot,
  ENGINE_HOST_TOOL_NAMES.browserRead,
  ENGINE_HOST_TOOL_NAMES.browserScreenshot,
  ENGINE_HOST_TOOL_NAMES.browserAct,
  ENGINE_HOST_TOOL_NAMES.browserSetProxy,
] as const;

const callSchema = z.object({
  name: z.enum(toolNames).describe("iPolloWork host tool name, for example ipollowork_extension_call."),
  args: z.record(z.string(), z.unknown()).describe("Arguments for the named host tool."),
});

/** OpenCode supplies sessionID to native tools, unlike its shared workspace MCP connection. */
export const iPolloWorkSessionHost = async () => ({
  tool: {
    ipollowork_session_call: {
      description: "Call an iPolloWork conversation, work-template, publisher or browser host tool with this OpenCode task's own session identity. Use this for conversation work updates and social publishing so concurrent tasks remain independently scoped.",
      args: callSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeToolContext) {
        const { name, args } = callSchema.parse(rawArgs);
        const sessionId = context.sessionID?.trim() ?? "";
        if (!/^ses_[a-zA-Z0-9_-]{1,196}$/.test(sessionId)) {
          throw new Error("The current OpenCode session identity is unavailable; host actions were not sent.");
        }
        const url = process.env.IPOLLOWORK_SERVER_URL?.replace(/\/$/, "");
        const token = process.env.IPOLLOWORK_SERVER_TOKEN;
        const workspaceId = process.env.IPOLLOWORK_WORKSPACE_ID?.trim();
        const directory = context.directory?.trim();
        const worktree = context.worktree?.trim();
        if (!url || !token || (!workspaceId && !directory && !worktree)) {
          throw new Error("The iPolloWork host connection or current workspace is unavailable.");
        }
        const response = await fetch(`${url}/engine-tools/call`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            args,
            context: {
              ...(workspaceId ? { workspaceId } : {}),
              sessionId,
              ...(directory ? { directory } : {}),
              ...(worktree ? { worktree } : {}),
            },
          }),
        });
        const payload: unknown = await response.json();
        if (!response.ok) {
          const message = payload && typeof payload === "object" && "message" in payload
            ? String(payload.message)
            : `iPolloWork host returned HTTP ${response.status}`;
          throw new Error(message);
        }
        return JSON.stringify(payload);
      },
    },
  },
});
