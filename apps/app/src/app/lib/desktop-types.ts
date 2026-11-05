// Type definitions for the desktop bridge.
// The payload shapes and the per-command contract live in
// packages/types/src/desktop-ipc.ts (shared with the Electron main process);
// this module re-exports them as the app-side import path.

import type { WorkspaceWire } from "@ipollowork/types/workspace";

export type {
  AppBuildInfo,
  BrandIconApplyResult,
  BrandIconState,
  BrowserActivity,
  BrowserController,
  BrowserDecisionEngine,
  BrowserPanelTab,
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
  EnginePackageInfo,
  EnginePackageSource,
  EnginePackageStatus,
  EvalRelaunchResult,
  ExecResult,
  LocalSkillCard,
  LocalSkillContent,
  OpencodeCommandDraft,
  OpencodeConfigFile,
  OpencodeExecutionEnvEntry,
  OpencodeExecutionSnapshot,
  iPolloWorkDockerCleanupResult,
  iPolloWorkServerInfo,
  OrchestratorDetachedHost,
  SandboxDebugProbeResult,
  SandboxDoctorResult,
  UpdaterEnvironment,
  WorkspaceCreateInput,
  WorkspaceCreateRemoteInput,
  WorkspaceExportSummary,
  WorkspaceList,
  WorkspaceiPolloWorkConfig,
  WorkspaceUpdateRemoteInput,
} from "@ipollowork/types/desktop-ipc";

// Canonical wire shape shared with ipollowork-server and the desktop bridge.
// Single source of truth: packages/types/src/workspace.ts.
export type WorkspaceInfo = WorkspaceWire;
