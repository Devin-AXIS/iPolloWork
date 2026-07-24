import { ApiError } from "../errors.js";
import type { EnvService } from "../env-file.js";
import {
  googleWorkspaceConnectGuidance,
  googleWorkspaceStatusConnectExtra,
  shouldGateLegacyGoogleWorkspace,
  type ConnectSnapshot,
} from "../connect-state.js";
import type { ServerConfig } from "../types.js";
import {
  callPluginServiceAction,
  listPluginServiceActions,
  workspaceIdForPluginContext,
} from "../plugin-service-runtime.js";
import {
  callGoogleWorkspaceExtensionAction,
  GOOGLE_WORKSPACE_EXTENSION_ACTIONS,
  GOOGLE_WORKSPACE_EXTENSION_ID,
} from "./google-workspace.js";
import {
  callOpenAiImageGenerationExtensionAction,
  OPENAI_IMAGE_GENERATION_EXTENSION_ACTIONS,
  OPENAI_IMAGE_GENERATION_EXTENSION_ID,
} from "./openai-image-generation.js";
import {
  MEDIA_EXTENSION_ACTIONS,
  MEDIA_EXTENSION_ID,
  callMediaExtensionAction,
} from "./media-center.js";
import {
  callStorageExtensionAction,
  STORAGE_EXTENSION_ACTIONS,
  STORAGE_EXTENSION_ID,
} from "./storage.js";

const IPOLLOWORK_EXPERIMENTAL_EXTENSION_ACTIONS = [
  ...GOOGLE_WORKSPACE_EXTENSION_ACTIONS,
  ...OPENAI_IMAGE_GENERATION_EXTENSION_ACTIONS,
  ...MEDIA_EXTENSION_ACTIONS,
  ...STORAGE_EXTENSION_ACTIONS,
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringField(value: unknown, key: string): string {
  if (!isRecord(value)) return "";
  const field = value[key];
  return typeof field === "string" ? field.trim() : "";
}

export async function listExperimentalExtensionActions(
  config: ServerConfig,
  extensionId: string,
  context: unknown,
  connectSnapshot?: ConnectSnapshot,
) {
  const filter = extensionId.trim();
  const builtInActions = filter
    ? IPOLLOWORK_EXPERIMENTAL_EXTENSION_ACTIONS.filter((action) => action.extensionId === filter)
    : IPOLLOWORK_EXPERIMENTAL_EXTENSION_ACTIONS;
  const actions = !connectSnapshot || !shouldGateLegacyGoogleWorkspace(connectSnapshot)
    ? builtInActions
    : builtInActions.filter((action) => action.extensionId !== GOOGLE_WORKSPACE_EXTENSION_ID || action.action === "status");
  if (!config.workspaces.length) return actions;
  const workspaceId = workspaceIdForPluginContext(config, context);
  return [...actions, ...await listPluginServiceActions(config, workspaceId, filter)];
}

export async function callExperimentalExtensionAction(config: ServerConfig, env: EnvService, input: unknown, connectSnapshot?: ConnectSnapshot) {
  if (!isRecord(input)) {
    throw new ApiError(400, "invalid_payload", "Expected extension action call payload");
  }
  const extensionId = readStringField(input, "extensionId");
  const action = readStringField(input, "action");
  const args = isRecord(input.args) ? input.args : {};
  const context = isRecord(input.context) ? input.context : {};
  if (!extensionId || !action) {
    throw new ApiError(400, "invalid_payload", "extensionId and action are required");
  }
  const registered = IPOLLOWORK_EXPERIMENTAL_EXTENSION_ACTIONS.find((item) => item.extensionId === extensionId && item.action === action);
  if (!registered) {
    return callPluginServiceAction({
      config,
      workspaceId: workspaceIdForPluginContext(config, context),
      pluginId: extensionId,
      action,
      args,
      context,
    });
  }

  if (
    extensionId === GOOGLE_WORKSPACE_EXTENSION_ID &&
    action !== "status" &&
    connectSnapshot &&
    shouldGateLegacyGoogleWorkspace(connectSnapshot)
  ) {
    return {
      ok: false,
      error: "use_ipollowork_cloud",
      message: googleWorkspaceConnectGuidance(connectSnapshot.cloudMcpPresent),
    };
  }

  if (extensionId === GOOGLE_WORKSPACE_EXTENSION_ID) {
    const result = await callGoogleWorkspaceExtensionAction(config, action, args, context, connectSnapshot ? googleWorkspaceStatusConnectExtra(connectSnapshot) : {});
    if (result) return result;
  }

  if (extensionId === OPENAI_IMAGE_GENERATION_EXTENSION_ID) {
    const result = await callOpenAiImageGenerationExtensionAction(config, env, action, args, context);
    if (result) return result;
  }

  if (extensionId === MEDIA_EXTENSION_ID) {
    const result = await callMediaExtensionAction(config, env, action, args, context);
    if (result) return result;
  }

  if (extensionId === STORAGE_EXTENSION_ID) {
    const result = await callStorageExtensionAction(config, env, action, args, context);
    if (result) return result;
  }

  throw new ApiError(501, "extension_action_not_implemented", `${registered.title} is registered but not implemented on ipollowork-server yet.`, { extensionId, action, args });
}
