/** @jsxImportSource react */
import { Building2, Check, LogOut, Loader2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import type { DenOrgSummary } from "../../../../app/lib/den";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import {
  SettingsNotice,
  SettingsSectionHeaderDescription,
} from "../settings-section";
import { t } from "@/i18n";
import { useCloudSession } from "./cloud-session-provider";
import { useOrgListWindow } from "../../cloud/use-org-list-window";

export interface CloudAccountSectionProps {
  activeOrgId: string;
  authBusy: boolean;
  needsOrgSelection?: boolean;
  orgs: DenOrgSummary[];
  orgsBusy: boolean;
  orgsError: string | null;
  sessionBusy: boolean;
  onActiveOrgChange: (orgId: string) => void | Promise<void>;
  onCreateTeam: (name: string) => void | Promise<void>;
  onDeleteTeam: (orgId: string) => void | Promise<void>;
  onRefreshOrgs: () => void | Promise<void>;
  onSignOut: () => void | Promise<void>;
}

export function CloudAccountSection({
  activeOrgId,
  authBusy,
  needsOrgSelection,
  orgs,
  orgsBusy,
  orgsError,
  sessionBusy,
  onActiveOrgChange,
  onCreateTeam,
  onDeleteTeam,
  onRefreshOrgs,
  onSignOut,
}: CloudAccountSectionProps) {
  const { user } = useCloudSession();
  const activeOrg = orgs.find((org) => org.id === activeOrgId) ?? null;
  const controlsDisabled = authBusy || sessionBusy;

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

      {/* Org picker (stepper-style) or connected org display */}
      {needsOrgSelection || orgs.length > 1 ? (
        <OrgPicker
          activeOrgId={activeOrgId}
          orgs={orgs}
          orgsBusy={orgsBusy}
          disabled={controlsDisabled}
          onSelect={onActiveOrgChange}
          onDelete={onDeleteTeam}
          onRefresh={onRefreshOrgs}
        />
      ) : activeOrg ? (
        <ConnectedOrg org={activeOrg} />
      ) : orgsBusy ? (
        <div className="flex items-center gap-2 text-sm text-dls-secondary">
          <Loader2 size={14} className="animate-spin" />
          {t("settings.cloud.loading_organizations")}
        </div>
      ) : null}

      {orgsError ? <SettingsNotice tone="error">{orgsError}</SettingsNotice> : null}
      <CreateTeamForm disabled={controlsDisabled} onCreate={onCreateTeam} />
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

/* ------------------------------------------------------------------ */
/*  Org picker: card-per-org selection                                 */
/* ------------------------------------------------------------------ */

function OrgPicker({
  activeOrgId,
  orgs,
  orgsBusy,
  disabled,
  onSelect,
  onDelete,
  onRefresh,
}: {
  activeOrgId: string;
  orgs: DenOrgSummary[];
  orgsBusy: boolean;
  disabled: boolean;
  onSelect: (orgId: string) => void | Promise<void>;
  onDelete: (orgId: string) => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
}) {
  const { filtered, query, showMore, updateQuery, visible } = useOrgListWindow(orgs);
  const [deleteTarget, setDeleteTarget] = useState<DenOrgSummary | null>(null);
  const hasMore = visible.length < filtered.length;

  if (orgsBusy) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-sm text-dls-secondary">
        <Loader2 size={20} className="animate-spin" />
        {t("settings.cloud.loading_organizations")}
      </div>
    );
  }

  if (orgs.length === 0) {
    return (
      <div className="rounded-xl border border-dls-border bg-dls-surface px-4 py-6 text-center text-sm text-dls-secondary">
        {t("settings.cloud.no_organizations")}{" "}
        <button
          type="button"
          className="font-medium text-dls-text underline underline-offset-2"
          onClick={() => void onRefresh()}
        >
          {t("common.refresh")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm font-medium text-dls-text">
        切换工作站
      </div>
      <div className="text-xs text-dls-secondary">
        切换后聊天列表、当前会话、记录、草稿和文件都会随工作站变化。
      </div>
      {orgs.length > 10 ? (
        <Input
          aria-label={t("settings.cloud.search_organizations")}
          placeholder={t("settings.cloud.search_organizations")}
          value={query}
          className="h-auto rounded-xl border-dls-border bg-dls-surface px-4 py-2.5 text-sm text-dls-text shadow-none placeholder:text-dls-secondary focus-visible:border-dls-text/30 focus-visible:ring-0 dark:bg-dls-surface"
          onChange={(event) => updateQuery(event.target.value)}
        />
      ) : null}
      <div className="flex flex-col gap-2">
        {visible.map((org) => (
          <div
            key={org.id}
            className="flex items-center gap-2"
          >
            <button
              type="button"
              disabled={disabled || org.id === activeOrgId}
              className="flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-dls-border bg-dls-surface px-4 py-3 text-left transition-colors hover:border-dls-text/20 hover:bg-dls-hover disabled:cursor-default disabled:opacity-70"
              onClick={() => void onSelect(org.id)}
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-dls-hover text-dls-secondary">
                <Building2 size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-dls-text">{org.name}</div>
                <div className="text-xs text-dls-secondary">{org.kind === "personal" ? "个人工作站" : org.role === "owner" ? t("settings.cloud.role_owner") : t("settings.cloud.role_member")}</div>
              </div>
              {org.id === activeOrgId ? <Check size={16} className="text-green-11" /> : null}
            </button>
            {org.kind !== "personal" && org.role === "owner" ? (
              <Button type="button" size="icon-sm" variant="ghost" disabled={disabled} aria-label={`删除 ${org.name}`} onClick={() => setDeleteTarget(org)}>
                <Trash2 size={15} />
              </Button>
            ) : null}
          </div>
        ))}
      </div>
      {filtered.length === 0 && query.trim() ? (
        <div className="text-sm text-dls-secondary">
          {t("settings.cloud.no_organizations_match")}
        </div>
      ) : null}
      {hasMore ? (
        <div className="flex flex-col items-start gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-xl border-dls-border text-dls-text hover:bg-dls-hover"
            onClick={showMore}
          >
            {t("workspace_list.show_more_fallback")}
          </Button>
          <div className="text-xs text-dls-secondary">
            {t("settings.cloud.organizations_showing", { visible: visible.length, total: filtered.length })}
          </div>
        </div>
      ) : null}
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除“{deleteTarget?.name}”？</AlertDialogTitle>
            <AlertDialogDescription>该团队将从工作站列表移除。个人工作站和其他团队不会受影响。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => { if (deleteTarget) void onDelete(deleteTarget.id); }}>删除团队</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CreateTeamForm({ disabled, onCreate }: { disabled: boolean; onCreate: (name: string) => void | Promise<void> }) {
  const [name, setName] = useState("");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = name.trim();
    if (value.length < 2) return;
    await onCreate(value);
    setName("");
  };
  return (
    <form className="flex gap-2" onSubmit={(event) => void submit(event)}>
      <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="创建新的团队" minLength={2} maxLength={80} disabled={disabled} />
      <Button type="submit" variant="outline" disabled={disabled || name.trim().length < 2}><Plus size={15} />创建</Button>
    </form>
  );
}
