import {
  engineInfo,
  engineStart,
  ipollowalkServerInfo,
  type EngineInfo,
  type iPolloWalkServerInfo,
} from "../../app/lib/desktop";
import { readiPolloWalkServerSettings, writeiPolloWalkServerSettings } from "../../app/lib/ipollowalk-server";
import { safeStringify } from "../../app/utils";
import { recordInspectorEvent } from "../../app/lib/app-inspector";

type LocalWorkspaceLike = {
  id: string;
  name?: string | null;
  displayNameResolved?: string | null;
  path?: string | null;
  workspaceType?: "local" | "remote" | string | null;
};

type EnsureDesktopLocaliPolloWalkOptions = {
  route: "session" | "settings";
  workspace: LocalWorkspaceLike | null | undefined;
  allWorkspaces: LocalWorkspaceLike[];
};

function emitiPolloWalkSettingsChanged() {
  try {
    window.dispatchEvent(new CustomEvent("ipollowalk-server-settings-changed"));
  } catch {
    // ignore browser event dispatch failures
  }
}

function describeError(error: unknown) {
  if (error instanceof Error) return error.message;
  const serialized = safeStringify(error);
  return serialized && serialized !== "{}" ? serialized : "Unknown error";
}

export async function ensureDesktopLocaliPolloWalkConnection(
  options: EnsureDesktopLocaliPolloWalkOptions,
) {
  const workspace = options.workspace;
  const workspaceRoot = workspace?.path?.trim() ?? "";
  if (!workspace || workspace.workspaceType !== "local" || !workspaceRoot) {
    return null;
  }

  const workspacePaths = Array.from(
    new Set(
      options.allWorkspaces.flatMap((item) => {
        const path = item.workspaceType === "local" ? item.path?.trim() ?? "" : "";
        return path ? [path] : [];
      }),
    ),
  );
  if (!workspacePaths.includes(workspaceRoot)) {
    workspacePaths.unshift(workspaceRoot);
  }

  recordInspectorEvent("route.local_ipollowalk.ensure.start", {
    route: options.route,
    workspaceId: workspace.id,
    workspaceRoot,
  });

  try {
    const engine = await engineInfo().catch(() => null) as EngineInfo | null;
    if (!engine?.running || !engine.baseUrl) {
      await engineStart(workspaceRoot, {
        runtime: "direct",
        workspacePaths,
        ipollowalkRemoteAccess: readiPolloWalkServerSettings().remoteAccessEnabled === true,
      });
    }

    const info = await ipollowalkServerInfo() as iPolloWalkServerInfo | null;
    if (!info?.baseUrl) {
      throw new Error("iPolloWalk server did not report a base URL after activation.");
    }

    writeiPolloWalkServerSettings({
      urlOverride: info.baseUrl,
      token: info.ownerToken?.trim() || info.clientToken?.trim() || undefined,
      hostToken: info.hostToken?.trim() || undefined,
      portOverride: info.port ?? undefined,
      remoteAccessEnabled: info.remoteAccessEnabled === true,
    });
    emitiPolloWalkSettingsChanged();

    recordInspectorEvent("route.local_ipollowalk.ensure.success", {
      route: options.route,
      workspaceId: workspace.id,
      workspaceRoot,
      baseUrl: info.baseUrl,
    });

    return info;
  } catch (error) {
    const message = describeError(error);
    console.error(`[${options.route}-route] local workspace reconnect failed`, error);
    recordInspectorEvent("route.local_ipollowalk.ensure.error", {
      route: options.route,
      workspaceId: workspace.id,
      workspaceRoot,
      message,
    });
    throw new Error(message);
  }
}
