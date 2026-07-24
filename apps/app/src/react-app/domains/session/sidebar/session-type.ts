import type { TemplateManifestV1 } from "@ipollowork/types/templates";

export type iPolloWorkSessionType = "work" | "design" | "code" | "video";

const SESSION_TYPE_EVENT = "ipollowork:session-type";
const sessionTypes = new Map<string, iPolloWorkSessionType>();

export function sessionTypeForTemplate(manifest: Pick<TemplateManifestV1, "surface">): iPolloWorkSessionType {
  return manifest.surface === "video" ? "video" : "design";
}

export function readSessionType(sessionId: string): iPolloWorkSessionType {
  return sessionTypes.get(sessionId) ?? "work";
}

/**
 * This is an in-memory rendering cache only. Its persisted source is the
 * server's template-session record, which is loaded at workspace refresh and
 * immediately after a template is materialized.
 */
export function setSessionType(sessionId: string, type: iPolloWorkSessionType) {
  if (!sessionId) return;
  sessionTypes.set(sessionId, type);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SESSION_TYPE_EVENT, { detail: { sessionId, type } }));
  }
}

export function setTemplateSessionTypes(sessions: Array<{ sessionId: string; surface: "design" | "video" }>) {
  for (const session of sessions) setSessionType(session.sessionId, sessionTypeForTemplate(session));
}

export function subscribeToSessionType(listener: (sessionId: string, type: iPolloWorkSessionType) => void) {
  if (typeof window === "undefined") return () => undefined;
  const onChange = (event: Event) => {
    const detail = (event as CustomEvent<{ sessionId?: string; type?: iPolloWorkSessionType }>).detail;
    if (!detail?.sessionId || !detail.type) return;
    listener(detail.sessionId, detail.type);
  };
  window.addEventListener(SESSION_TYPE_EVENT, onChange);
  return () => window.removeEventListener(SESSION_TYPE_EVENT, onChange);
}
