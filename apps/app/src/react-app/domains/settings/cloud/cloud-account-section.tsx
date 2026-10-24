/** @jsxImportSource react */
import * as React from "react";
import { CircleAlert, Building2, Check, LogOut, Loader2, MoreHorizontal, Plus, UserRound } from "lucide-react";

import { cn } from "@/lib/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { t } from "@/i18n";
import {
  enterpriseConnectionsChangedEvent,
  leaveEnterpriseConnection,
  readEnterpriseConnections,
  removeEnterpriseConnection,
  type EnterpriseConnection,
} from "@/app/lib/enterprise-connections";
import {
  activateEnterpriseWorkContext,
  activatePersonalWorkContext,
  readActiveEnterpriseConnection,
  workContextChangedEvent,
} from "@/app/lib/work-context";
import { ConfirmModal } from "@/react-app/design-system/modals/confirm-modal";
import { EnterpriseServerDialog } from "@/react-app/domains/session/sidebar/enterprise-server-dialog";
import {
  SettingsStatusBadge,
  type SettingsStatusBadgeProps,
} from "../settings-section";
import { useCloudSession } from "./cloud-session-provider";

export interface CloudAccountSectionProps {
  authBusy: boolean;
  sessionBusy: boolean;
  statusLabel: string;
  statusTone: SettingsStatusBadgeProps["tone"];
  onSignOut: () => void | Promise<void>;
  onSignInRequired: () => void;
}

export function CloudAccountSection({
  authBusy,
  sessionBusy,
  statusLabel,
  statusTone,
  onSignOut,
  onSignInRequired,
}: CloudAccountSectionProps) {
  const { isSignedIn, user } = useCloudSession();
  const controlsDisabled = authBusy || sessionBusy;
  const [connections, setConnections] = React.useState<EnterpriseConnection[]>(() => readEnterpriseConnections());
  const [activeConnection, setActiveConnection] = React.useState<EnterpriseConnection | null>(
    () => readActiveEnterpriseConnection(),
  );
  const [joinOpen, setJoinOpen] = React.useState(false);
  const [switchingId, setSwitchingId] = React.useState<string | null>(null);
  const [leavingId, setLeavingId] = React.useState<string | null>(null);
  const [pendingLeave, setPendingLeave] = React.useState<EnterpriseConnection | null>(null);
  const [enterpriseError, setEnterpriseError] = React.useState<string | null>(null);

  const refreshConnections = React.useCallback(() => {
    setConnections(readEnterpriseConnections());
    setActiveConnection(readActiveEnterpriseConnection());
  }, []);

  React.useEffect(() => {
    window.addEventListener(enterpriseConnectionsChangedEvent, refreshConnections);
    window.addEventListener(workContextChangedEvent, refreshConnections);
    return () => {
      window.removeEventListener(enterpriseConnectionsChangedEvent, refreshConnections);
      window.removeEventListener(workContextChangedEvent, refreshConnections);
    };
  }, [refreshConnections]);

  const selectConnection = async (connection: EnterpriseConnection | null) => {
    setSwitchingId(connection?.id ?? "personal");
    setEnterpriseError(null);
    try {
      const workspaceId = connection
        ? await activateEnterpriseWorkContext(connection)
        : await activatePersonalWorkContext();
      window.location.hash = workspaceId
        ? `#/workspace/${encodeURIComponent(workspaceId)}/session`
        : "#/session";
    } catch {
      setEnterpriseError(t("enterprise_connection.switch_error"));
    } finally {
      setSwitchingId(null);
    }
  };

  const requestLeave = (connection: EnterpriseConnection) => {
    if (connection.membership.role === "owner") {
      setEnterpriseError(t("enterprise_connection.owner_transfer_required"));
      return;
    }
    setPendingLeave(connection);
  };

  const leaveConnection = async (connection: EnterpriseConnection) => {
    setPendingLeave(null);
    setLeavingId(connection.id);
    setEnterpriseError(null);
    try {
      if (activeConnection?.id !== connection.id) {
        removeEnterpriseConnection(connection.id);
        return;
      }

      const personalWorkspaceId = await activatePersonalWorkContext();
      window.location.hash = personalWorkspaceId
        ? `#/workspace/${encodeURIComponent(personalWorkspaceId)}/session`
        : "#/session";
      await leaveEnterpriseConnection(connection);
    } catch (error) {
      setEnterpriseError(
        error instanceof Error && error.message === "owner_transfer_required"
          ? t("enterprise_connection.owner_transfer_required")
          : t("enterprise_connection.leave_error"),
      );
    } finally {
      setLeavingId(null);
    }
  };

  return (
    <section className="flex flex-col gap-y-6">
      {isSignedIn ? (
        <>
          <div
            data-testid="cloud-account-identity"
            className="flex min-h-16 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-dls-hover text-sm font-semibold text-dls-text">
                {(user?.name ?? user?.email ?? "?").charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-dls-text">
                  {user?.name || user?.email}
                </div>
                {user?.name && user.email ? (
                  <div className="truncate text-xs text-dls-secondary">{user.email}</div>
                ) : null}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <SettingsStatusBadge
                className="px-2"
                tone={statusTone}
                label={t("den.cloud_status", { status: statusLabel })}
              />
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => void onSignOut()}
                disabled={controlsDisabled}
              >
                <LogOut className="size-3.5" />
                {authBusy ? t("den.signing_out") : t("den.sign_out")}
              </Button>
            </div>
          </div>

          <p className="text-xs leading-5 text-dls-secondary">{t("den.cloud_signed_in_desc")}</p>
        </>
      ) : null}

      <Separator />

      <div data-testid="cloud-workspaces" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-dls-text">{t("enterprise_connection.sources_title")}</div>
            <div className="text-xs leading-5 text-dls-secondary">{t("enterprise_connection.sources_hint")}</div>
          </div>
          <Button variant="outline" size="sm" data-testid="join-enterprise-workspace" disabled={controlsDisabled} onClick={() => setJoinOpen(true)}>
            <Plus className="size-3.5" />{t("enterprise_connection.join")}
          </Button>
        </div>

        <div data-testid="workspace-options" className="divide-y divide-dls-border overflow-hidden rounded-xl border border-dls-border">
          <Button
            type="button"
            variant="ghost"
            aria-pressed={!activeConnection}
            className={cn("h-auto min-h-16 w-full justify-start gap-3 rounded-none border-0 px-4 py-3 text-left whitespace-normal shadow-none focus-visible:ring-inset before:shadow-none", !activeConnection ? "bg-feedback-success hover:bg-feedback-success active:bg-feedback-success aria-pressed:bg-feedback-success aria-pressed:hover:bg-feedback-success aria-pressed:active:bg-feedback-success" : "bg-transparent hover:bg-dls-border active:bg-dls-border")}
            onClick={() => void selectConnection(null)}
            disabled={switchingId !== null}
          >
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-black text-white dark:bg-black dark:text-white">
              <UserRound size={15} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-dls-text">
                {t(isSignedIn
                  ? "enterprise_connection.personal"
                  : "enterprise_connection.local_personal")}
              </div>
              <div className="text-xs text-dls-secondary">
                {t(isSignedIn
                  ? "enterprise_connection.personal_hint"
                  : "enterprise_connection.local_personal_hint")}
              </div>
            </div>
            {switchingId === "personal"
              ? <Loader2 size={16} className="shrink-0 animate-spin text-dls-secondary" />
              : !isSignedIn || !activeConnection
                ? <Check size={16} className="shrink-0 text-green-11" />
                : null}
          </Button>

          {isSignedIn ? connections.map((connection) => {
            const active = activeConnection?.id === connection.id;
            const leaving = leavingId === connection.id;
            return (
              <div
                key={connection.id}
                className={cn("flex min-h-16 items-center gap-3 px-4 py-3 transition-colors", active ? "bg-feedback-success" : "hover:bg-dls-border")}
              >
                <Button
                  type="button"
                  variant="ghost"
                  aria-pressed={active}
                  className="h-auto min-w-0 flex-1 justify-start gap-3 border-0 bg-transparent p-0 text-left whitespace-normal shadow-none before:shadow-none hover:bg-transparent active:bg-transparent aria-pressed:bg-transparent aria-pressed:hover:bg-transparent aria-pressed:active:bg-transparent"
                  onClick={() => void selectConnection(connection)}
                  disabled={leaving || switchingId !== null}
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-black text-white dark:bg-black dark:text-white">
                    <Building2 size={15} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-dls-text">{connection.name}</div>
                    <div className="text-xs text-dls-secondary">
                      {t("enterprise_connection.enterprise_hint")}
                    </div>
                  </div>
                  {switchingId === connection.id
                    ? <Loader2 size={16} className="shrink-0 animate-spin text-dls-secondary" />
                    : active ? <Check size={16} className="shrink-0 text-green-11" /> : null}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" data-testid="workspace-actions" aria-label={t("enterprise_connection.workspace_actions", { name: connection.name })} disabled={leaving} />}>
                    <MoreHorizontal className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem variant="destructive" disabled={leaving || connection.membership.role === "owner"} onClick={() => requestLeave(connection)} title={connection.membership.role === "owner" ? t("enterprise_connection.owner_transfer_required") : undefined}>
                      <LogOut className="size-3.5" />{leaving ? t("enterprise_connection.leaving") : t("enterprise_connection.leave")}
                    </DropdownMenuItem>
                    {connection.membership.role === "owner" ? <p className="max-w-60 px-2 py-1 text-ui-caption leading-5 text-muted-foreground">{t("enterprise_connection.owner_transfer_required")}</p> : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          }) : null}

        </div>

        {enterpriseError ? <Alert variant="destructive"><CircleAlert aria-hidden="true" /><AlertDescription>{enterpriseError}</AlertDescription></Alert> : null}
      </div>

      <EnterpriseServerDialog
        key="join-enterprise-dialog"
        open={joinOpen}
        onOpenChange={setJoinOpen}
        onSignInRequired={onSignInRequired}
        onConnected={(connection) => {
          refreshConnections();
          void selectConnection(connection);
        }}
      />
      <ConfirmModal
        key="leave-enterprise-dialog"
        open={pendingLeave !== null}
        title={t("enterprise_connection.leave_title")}
        message={pendingLeave ? t("enterprise_connection.leave_confirm", { name: pendingLeave.name }) : ""}
        confirmLabel={t("enterprise_connection.leave")}
        cancelLabel={t("common.cancel")}
        variant="danger"
        onConfirm={() => {
          if (pendingLeave) void leaveConnection(pendingLeave);
        }}
        onCancel={() => setPendingLeave(null)}
      />
    </section>
  );
}
