/** @jsxImportSource react */
import * as React from "react";
import type { WorkspaceConnectionState } from "../../../../app/types";
import type { WorkContextId } from "../../../../app/lib/work-context";
import type { Language } from "../../../../i18n";
import type { iPolloWorkSessionType } from "./session-type";

export type { iPolloWorkSessionType } from "./session-type";
export type iPolloWorkTemplateId = string;

export type SidebarDragPayload =
  | { kind: "project"; id: string }
  | { kind: "session"; key: string; sourceWorkspaceId: string; sessionId: string };

export type SidebarDropTarget =
  | { kind: "project"; id: string }
  | { kind: "session"; key: string }
  | null;

export type SidebarContextValue = {
  selectedWorkspaceId: string;
  selectedSessionId: string | null;
  language: Language;
  developerMode: boolean;
  showSessionActions?: boolean;
  sessionStatusById?: Record<string, string>;
  newTaskDisabled: boolean;
  connectingWorkspaceId: string | null;
  workspaceConnectionStateById: Record<string, WorkspaceConnectionState>;
  onOpenSession: (workspaceId: string, sessionId: string) => void;
  onPrefetchSession?: (workspaceId: string, sessionId: string) => void;
  onCreateTaskInWorkspace: (
    workspaceId: string,
    type?: iPolloWorkSessionType,
    templateId?: iPolloWorkTemplateId,
    templateScope?: WorkContextId,
  ) => Promise<string | null> | string | null | void;
  onOpenRenameSession?: (sessionId: string) => void;
  onOpenDeleteSession?: (sessionId: string) => void;
  onArchiveSession?: (sessionId: string, archived: boolean) => void;
  onRecoverWorkspace: (workspaceId: string) => Promise<boolean> | boolean | void;
  onTestWorkspaceConnection: (workspaceId: string) => Promise<boolean> | boolean | void;
  onEditWorkspaceConnection: (workspaceId: string) => void;
  toggleSessionExpanded: (sessionId: string) => void;
  expandedSessionIds: Set<string>;
  draggingItem: SidebarDragPayload | null;
  dropTarget: SidebarDropTarget;
  onDragStart: (payload: SidebarDragPayload) => void;
  onDragEnd: () => void;
  onDragOver: (target: Exclude<SidebarDropTarget, null>, event: React.DragEvent<HTMLElement>) => void;
  onDrop: (target: Exclude<SidebarDropTarget, null>, event: React.DragEvent<HTMLElement>) => void;
};

export const SidebarContext = React.createContext<SidebarContextValue | null>(null);

export function useSidebarContext() {
  const context = React.use(SidebarContext);
  if (!context) throw new Error("useSidebarContext must be used within SidebarProvider");
  return context;
}
