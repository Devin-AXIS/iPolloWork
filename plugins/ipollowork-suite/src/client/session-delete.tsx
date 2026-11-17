import { useSyncExternalStore } from "react";
import { ConfirmDialog } from "./enterprise-ui.tsx";
import { enterpriseCopy, enterpriseLabels, format } from "./enterprise-locale.ts";
import type { ClientContext } from "./native.ts";

/** Recoverable deletion uses the same idle, stop, and list handling as native Archive. */
export function mountSessionDelete(ctx: ClientContext): void {
  ctx.inject(["remoteAccess"], scope => {
    type Target = { id: Parameters<ClientContext["uiWorkspace"]["archiveSession"]>[0]; title: string };
    let selected: Target | null = null;
    const listeners = new Set<() => void>();
    const read = () => selected;
    const subscribe = (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    };
    const set = (target: Target | null) => {
      selected = target;
      for (const listener of listeners) listener();
    };
    const labels = enterpriseLabels(scope);
    function DeleteDialog() {
      const item = useSyncExternalStore(subscribe, read, read);
      const t = useSyncExternalStore(labels.subscribe, labels.getSnapshot, labels.getSnapshot);
      if (!item) return null;
      return <ConfirmDialog t={t} key={item.id}
        title={item.title ? format(t.deleteSessionTitle, { name: item.title }) : t.deleteSession}
        description={t.deleteSessionBody} confirmLabel={t.deleteSession}
        run={() => scope.uiWorkspace.archiveSession(item.id, { stopActivity: true })} close={() => set(null)} />;
    }
    scope.slots.inject("shell.overlay", () => scope.slots.register({
      name: "shell.overlay", id: "ipollowork-delete-session",
    }, DeleteDialog));
    const access = (id: string) => scope.remoteAccess.source("session", id, "workspace/archiveSession");
    for (const target of ["session", "sessionHeader"] as const) {
      scope.effect(() => scope.contextMenus.register({
        id: "ipollowork.delete-" + target, target, order: 700,
        observe: ({ sessionId }) => sessionId ? [scope.workspaces.list, scope.locale, access(sessionId)] : [],
        resolve: ({ sessionId, displayTitle }) => {
          if (!sessionId || !access(sessionId).getSnapshot() ||
              scope.workspaces.list.getSnapshot().archivedSessionIds.includes(sessionId)) return [];
          return [{
            id: "delete", label: enterpriseCopy(scope).deleteSession,
            icon: { key: "workspace.delete" }, danger: true, separatorBefore: true,
            run: () => set({ id: sessionId, title: displayTitle ?? "" }),
          }];
        },
      }), "ipollowork-suite: delete conversation");
    }
  });
}
