/** @jsxImportSource react */
import { Check, LogOut, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { useCloudSession } from "./cloud-session-provider";

export interface CloudAccountSectionProps {
  authBusy: boolean;
  sessionBusy: boolean;
  onSignOut: () => void | Promise<void>;
}

export function CloudAccountSection({ authBusy, sessionBusy, onSignOut }: CloudAccountSectionProps) {
  const { user } = useCloudSession();
  const controlsDisabled = authBusy || sessionBusy;

  return (
    <section className="flex flex-col gap-y-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-dls-hover text-dls-secondary">
            <UserRound size={17} />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-dls-text">{user?.name || user?.email}</div>
            {user?.name && user.email ? <div className="truncate text-xs text-dls-secondary">{user.email}</div> : null}
          </div>
        </div>
        <Button variant="outline" size="sm" className="shrink-0" onClick={() => void onSignOut()} disabled={controlsDisabled}>
          <LogOut className="size-3.5" />
          {authBusy ? t("den.signing_out") : t("den.sign_out")}
        </Button>
      </div>

      <div className="flex items-center gap-3 rounded-xl border border-dls-border bg-dls-surface px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-dls-text">个人账号</div>
          <div className="text-xs text-dls-secondary">连接会员、公共模板与扩展市场</div>
        </div>
        <Check size={16} className="shrink-0 text-green-11" />
      </div>
    </section>
  );
}
