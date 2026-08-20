export const ENGINE_HOST_TOOL_NAMES = {
  extensionListActions: "ipollowork_extension_list_actions",
  extensionCall: "ipollowork_extension_call",
  projectRead: "ipollowork_project_read",
  projectApply: "ipollowork_project_apply",
  workspaceAppListTools: "ipollowork_workspace_app_list_tools",
  workspaceAppCallTool: "ipollowork_workspace_app_call_tool",
} as const;

export type EngineHostToolName = (typeof ENGINE_HOST_TOOL_NAMES)[keyof typeof ENGINE_HOST_TOOL_NAMES];

export type EngineHostToolDescriptor = {
  name: EngineHostToolName;
  description: string;
  parameters: Record<string, unknown>;
};

const objectParameters = (
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

export const ENGINE_HOST_TOOLS: readonly EngineHostToolDescriptor[] = [
  {
    name: ENGINE_HOST_TOOL_NAMES.extensionListActions,
    description: "List the actions currently exposed by installed and enabled iPolloWork extensions.",
    parameters: objectParameters({
      extensionId: {
        type: "string",
        description: "Optional extension ID used to filter the action catalog.",
      },
    }),
  },
  {
    name: ENGINE_HOST_TOOL_NAMES.extensionCall,
    description: "Call an iPolloWork extension action after inspecting it with ipollowork_extension_list_actions.",
    parameters: objectParameters({
      extensionId: { type: "string", description: "Extension ID returned by the action catalog." },
      action: { type: "string", description: "Action ID returned by the action catalog." },
      args: { type: "object", additionalProperties: true, description: "Action arguments." },
    }, ["extensionId", "action"]),
  },
  {
    name: ENGINE_HOST_TOOL_NAMES.projectRead,
    description: "Read the schema-validated iPolloWork project configuration for the current workspace. Use only in an explicitly opened Project Builder conversation.",
    parameters: objectParameters({}),
  },
  {
    name: ENGINE_HOST_TOOL_NAMES.projectApply,
    description: "Apply one complete schema-validated iPolloWork project configuration after the user explicitly confirms the proposal in Project Builder.",
    parameters: objectParameters({
      config: {
        type: "object",
        additionalProperties: true,
        description: "Complete ProjectWorkspaceConfig document returned from a confirmed Project Builder proposal.",
      },
      summary: {
        type: "string",
        description: "Short human-readable summary of the confirmed project change.",
      },
    }, ["config", "summary"]),
  },
  {
    name: ENGINE_HOST_TOOL_NAMES.workspaceAppListTools,
    description: "List the tools exposed by the Workspace App currently open in the iPolloWork right pane.",
    parameters: objectParameters({}),
  },
  {
    name: ENGINE_HOST_TOOL_NAMES.workspaceAppCallTool,
    description: "Call a tool exposed by the Workspace App currently open in the iPolloWork right pane.",
    parameters: objectParameters({
      name: { type: "string", description: "Workspace App tool name returned by ipollowork_workspace_app_list_tools." },
      arguments: { type: "object", additionalProperties: true, description: "Workspace App tool arguments." },
    }, ["name"]),
  },
] as const;

export function engineHostTool(name: string): EngineHostToolDescriptor | undefined {
  return ENGINE_HOST_TOOLS.find((tool) => tool.name === name);
}
