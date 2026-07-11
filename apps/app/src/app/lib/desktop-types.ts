// Type definitions for the desktop bridge.
// The payload shapes and the per-command contract live in
// packages/types/src/desktop-ipc.ts (shared with the Electron main process);
// this module re-exports them as the app-side import path.

import type { WorkspaceWire } from "@ipollowalk/types/workspace";

export type {
  AppBuildInfo,
  BrandIconApplyResult,
  BrandIconState,
  CacheResetResult,
  DesktopBootstrapConfig,
  DesktopCommandArgs,
  DesktopCommandInvokers,
  DesktopCommandMap,
  DesktopCommandName,
  DesktopCommandResult,
  DesktopFetchInit,
  DesktopFetchResult,
  EngineDoctorResult,
  EngineInfo,
  EvalRelaunchResult,
  ExecResult,
  LocalSkillCard,
  LocalSkillContent,
  OpencodeCommandDraft,
  OpencodeConfigFile,
  OpencodeExecutionEnvEntry,
  OpencodeExecutionSnapshot,
  iPolloWalkDockerCleanupResult,
  iPolloWalkServerInfo,
  OrchestratorDetachedHost,
  SandboxDebugProbeResult,
  SandboxDoctorResult,
  UpdaterEnvironment,
  WorkspaceCreateInput,
  WorkspaceCreateRemoteInput,
  WorkspaceExportSummary,
  WorkspaceList,
  WorkspaceiPolloWalkConfig,
  WorkspaceUpdateRemoteInput,
} from "@ipollowalk/types/desktop-ipc";

// Canonical wire shape shared with ipollowalk-server and the desktop bridge.
// Single source of truth: packages/types/src/workspace.ts.
export type WorkspaceInfo = WorkspaceWire;

// Browser tab state mirrored across the desktop IPC bridge. Owned here (the
// framework-agnostic layer); the session panel store re-exports it.
export type BrowserPanelTab = {
  id: string;
  type: "browser";
  label: string;
  url: string;
  favicon: string | null;
  status: "loading" | "ready";
  canGoBack: boolean;
  canGoForward: boolean;
};
