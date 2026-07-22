import type { TemplateSessionSnapshot } from "@ipollowork/types/templates";

import type { iPolloWorkServerClient } from "@/app/lib/ipollowork-server";
import type { iPolloWorkSessionType } from "../sidebar/session-type";

type TemplateSessionClient = Pick<iPolloWorkServerClient, "getTemplateSession" | "adoptLegacyVideoSession">;

type LoadTemplateSessionInput = {
  client: TemplateSessionClient;
  workspaceId: string;
  sessionId: string;
  knownSessionType: iPolloWorkSessionType | null;
};

/**
 * Template-session metadata is authoritative. The local session-type map is
 * only a rendering cache and can be empty for a session restored from history.
 */
export async function loadTemplateSession({
  client,
  workspaceId,
  sessionId,
  knownSessionType,
}: LoadTemplateSessionInput): Promise<TemplateSessionSnapshot | null> {
  try {
    return await client.getTemplateSession(workspaceId, sessionId);
  } catch {
    if (knownSessionType !== "video") return null;
    try {
      return await client.adoptLegacyVideoSession(workspaceId, sessionId);
    } catch {
      return null;
    }
  }
}
