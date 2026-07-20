/** @jsxImportSource react */

import { WorkspaceLoadingState } from "../../shell/workspace-loading-state";

/**
 * First-run full-screen loader shown while the first session is created,
 * styled to match the boot LoadingOverlay.
 */
export function FirstRunLoader() {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-dls-surface"
      aria-live="polite"
      aria-busy={true}
      role="status"
    >
      <div className="flex w-full max-w-[320px] flex-col items-center gap-4 px-6 text-center">
        <WorkspaceLoadingState message="Preparing workspace" />
      </div>
    </div>
  );
}
