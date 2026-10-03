import type { ComposerDraft } from "@/app/types";

const STORAGE_KEY = "ipollowork.project-builder-sessions.v1";
const MAX_SESSIONS = 100;
const activeSessions = new Set<string>();

type ProjectBuilderSession = {
  workspaceId: string;
  sessionId: string;
};

function sessionKey(workspaceId: string, sessionId: string): string {
  return `${workspaceId.trim()}:${sessionId.trim()}`;
}

function readStoredSessions(): ProjectBuilderSession[] {
  if (typeof window === "undefined") return [];
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const workspaceId = Reflect.get(item, "workspaceId");
      const sessionId = Reflect.get(item, "sessionId");
      return typeof workspaceId === "string" && workspaceId.trim()
        && typeof sessionId === "string" && sessionId.trim()
        ? [{ workspaceId: workspaceId.trim(), sessionId: sessionId.trim() }]
        : [];
    });
  } catch {
    return [];
  }
}

function writeStoredSessions(sessions: ProjectBuilderSession[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.slice(-MAX_SESSIONS)));
  } catch {
    // The in-memory set still keeps the active desktop session scoped.
  }
}

export function markProjectBuilderSession(workspaceId: string, sessionId: string): void {
  const normalized = { workspaceId: workspaceId.trim(), sessionId: sessionId.trim() };
  if (!normalized.workspaceId || !normalized.sessionId) return;
  activeSessions.add(sessionKey(normalized.workspaceId, normalized.sessionId));
  const sessions = readStoredSessions().filter((item) => item.workspaceId !== normalized.workspaceId);
  writeStoredSessions([...sessions, normalized]);
}

export function projectBuilderSessionId(workspaceId: string): string | null {
  const normalizedWorkspaceId = workspaceId.trim();
  if (!normalizedWorkspaceId) return null;
  return readStoredSessions().findLast((item) => item.workspaceId === normalizedWorkspaceId)?.sessionId ?? null;
}

export function forgetProjectBuilderSession(workspaceId: string, sessionId: string): void {
  activeSessions.delete(sessionKey(workspaceId, sessionId));
  writeStoredSessions(readStoredSessions().filter((item) => sessionKey(item.workspaceId, item.sessionId) !== sessionKey(workspaceId, sessionId)));
}

export function isProjectBuilderSession(workspaceId: string, sessionId: string | null | undefined): boolean {
  if (!workspaceId.trim() || !sessionId?.trim()) return false;
  const key = sessionKey(workspaceId, sessionId);
  if (activeSessions.has(key)) return true;
  const stored = readStoredSessions().some((item) => sessionKey(item.workspaceId, item.sessionId) === key);
  if (stored) activeSessions.add(key);
  return stored;
}

export function projectBuilderInstruction(projectName: string): string {
  return [
    `You are in the explicit Project Builder conversation for the iPolloWork project "${projectName}".`,
    "This mode is scoped to this project only. Help the user plan and refine its Agents, responsibilities, runtime choices, installed skills/app references, dashboard settings, and orchestration relations.",
    "Read the current project first with ipollowork_project_read. Preserve every field the user did not ask to change.",
    "The project has exactly one task board. Configure that canonical board and its Agents; never create parallel project boards or treat a normal conversation as another board.",
    "When the project has multiple Agents, define schema-valid orchestration.relations for every intended dependency or parallel branch. Do not leave configured Agents visually disconnected unless the user explicitly asks for an independent Agent.",
    "Discuss and explain the proposed structure before changing it. Call ipollowork_project_apply only after the user clearly confirms the change. The apply tool accepts one complete schema-valid project config and performs its own validation and approval gate.",
    "Do not edit arbitrary workspace files or treat this as a global assistant configuration task.",
  ].join("\n");
}

export function scopeProjectBuilderDraft(draft: ComposerDraft, projectName: string): ComposerDraft {
  const instruction = projectBuilderInstruction(projectName);
  const currentId = draft.capability?.id;
  const alreadyScoped = currentId?.split("+").includes("project-builder") === true;
  return {
    ...draft,
    capability: {
      id: alreadyScoped ? currentId : currentId ? `${currentId}+project-builder` : "project-builder",
      instruction: draft.capability?.instruction?.includes(instruction)
        ? draft.capability.instruction
        : [draft.capability?.instruction, instruction].filter(Boolean).join("\n\n"),
    },
  };
}
