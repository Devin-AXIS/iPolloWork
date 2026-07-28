/** @jsxImportSource react */
import * as React from "react";
import { Building2, Check, LogOut, Loader2, Plus, UserRound } from "lucide-react";

import type { DenOrgSummary } from "../../../../app/lib/den";
import { Button } from "@/components/ui/button";
import {
  SettingsNotice,
} from "../settings-section";
import { t } from "@/i18n";
import {
  enterpriseConnectionsChangedEvent,
  leaveEnterpriseConnection,
  readEnterpriseConnections,
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
import { useCloudSession } from "./cloud-session-provider";

export interface CloudAccountSectionProps {
  activeOrgId: string;
  authBusy: boolean;
  orgs: DenOrgSummary[];
  orgsBusy: boolean;
  orgsError: string | null;
  sessionBusy: boolean;
  onSignOut: () => void | Promise<void>;
}

export function CloudAccountSection({
  activeOrgId,
  authBusy,
  orgs,
  orgsBusy,
  orgsError,
  sessionBusy,
  onSignOut,
}: CloudAccountSectionProps) {
  const { user } = useCloudSession();
  const activeOrg = orgs.find((org) => org.id === activeOrgId) ?? null;
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
      if (activeConnection?.id === connection.id) await activatePersonalWorkContext();
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
      {/* User identity */}
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-dls-hover text-sm font-semibold text-dls-text">
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

      {activeOrg ? (
        <ConnectedOrg org={activeOrg} />
      ) : orgsBusy ? (
        <div className="flex items-center gap-2 text-sm text-dls-secondary">
          <Loader2 size={14} className="animate-spin" />
          {t("settings.cloud.loading_organizations")}
        </div>
      ) : null}

      {orgsError ? <SettingsNotice tone="error">{orgsError}</SettingsNotice> : null}

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-dls-text">{t("enterprise_connection.sources_title")}</div>
            <div className="text-xs text-dls-secondary">{t("enterprise_connection.sources_hint")}</div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setJoinOpen(true)} disabled={controlsDisabled}>
            <Plus className="size-3.5" />
            {t("enterprise_connection.join")}
          </Button>
        </div>

        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-xl border border-dls-border bg-dls-surface px-4 py-3 text-left transition-colors hover:bg-dls-hover"
          onClick={() => void selectConnection(null)}
          disabled={switchingId !== null}
        >
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-dls-hover text-dls-secondary">
            <UserRound size={15} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-dls-text">{t("enterprise_connection.personal")}</div>
            <div className="text-xs text-dls-secondary">{t("enterprise_connection.personal_hint")}</div>
          </div>
          {switchingId === "personal"
            ? <Loader2 size={16} className="shrink-0 animate-spin text-dls-secondary" />
            : !activeConnection ? <Check size={16} className="shrink-0 text-green-11" /> : null}
        </button>

        {connections.map((connection) => {
          const active = activeConnection?.id === connection.id;
          const leaving = leavingId === connection.id;
          return (
            <div
              key={connection.id}
              className="flex items-center gap-3 rounded-xl border border-dls-border bg-dls-surface px-4 py-3"
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
                onClick={() => void selectConnection(connection)}
                disabled={leaving || switchingId !== null}
              >
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-dls-hover text-dls-secondary">
                  <Building2 size={15} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-dls-text">{connection.name}</div>
                  <div className="text-xs capitalize text-dls-secondary">{connection.membership.role}</div>
                </div>
                {switchingId === connection.id
                  ? <Loader2 size={16} className="shrink-0 animate-spin text-dls-secondary" />
                  : active ? <Check size={16} className="shrink-0 text-green-11" /> : null}
              </button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => requestLeave(connection)}
                disabled={leaving || connection.membership.role === "owner"}
                title={connection.membership.role === "owner" ? t("enterprise_connection.owner_transfer_required") : undefined}
              >
                <LogOut className="size-3.5" />
                {leaving ? t("enterprise_connection.leaving") : t("enterprise_connection.leave")}
              </Button>
            </div>
          );
        })}

        {connections.length === 0 ? (
          <div className="rounded-xl border border-dashed border-dls-border px-4 py-5 text-center text-xs text-dls-secondary">
            {t("enterprise_connection.empty")}
          </div>
        ) : null}
        {enterpriseError ? <p className="text-xs text-destructive" role="alert">{enterpriseError}</p> : null}
      </div>

      <EnterpriseServerDialog
        open={joinOpen}
        onOpenChange={setJoinOpen}
        onConnected={(connection) => {
          refreshConnections();
          void selectConnection(connection);
        }}
      />
      <ConfirmModal
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

/* ------------------------------------------------------------------ */
/*  Connected org: read-only display                                   */
/* ------------------------------------------------------------------ */

function ConnectedOrg({ org }: { org: DenOrgSummary }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-dls-border bg-dls-surface px-4 py-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-green-3 text-green-11">
        <Building2 size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-dls-text">{org.name}</div>
        <div className="text-xs text-dls-secondary">
          {org.role === "owner" ? t("settings.cloud.role_owner") : t("settings.cloud.role_member")} &middot; {t("status.connected")}
        </div>
      </div>
      <Check size={16} className="shrink-0 text-green-11" />
    </div>
  );
}
