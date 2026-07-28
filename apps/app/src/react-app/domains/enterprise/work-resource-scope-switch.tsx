/** @jsxImportSource react */
import { Building2, UserRound } from "lucide-react";

import {
  enterpriseWorkContextId,
  PERSONAL_WORK_CONTEXT_ID,
  type WorkContextId,
} from "@/app/lib/work-context";
import type { EnterpriseConnection } from "@/app/lib/enterprise-connections";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

type WorkResourceScopeSwitchProps = {
  enterprise: EnterpriseConnection | null;
  value: WorkContextId;
  onChange: (value: WorkContextId) => void;
};

export function WorkResourceScopeSwitch(props: WorkResourceScopeSwitchProps) {
  if (!props.enterprise) return null;
  const enterpriseScope = enterpriseWorkContextId(props.enterprise.id);

  return (
    <div className="inline-flex w-fit items-center gap-1 rounded-xl border border-dls-border bg-dls-surface p-1" aria-label={t("enterprise_connection.resource_scope")}>
      <span className="px-2 text-[11px] font-medium text-dls-secondary">{t("enterprise_connection.resource_scope")}</span>
      <Button
        type="button"
        variant={props.value === PERSONAL_WORK_CONTEXT_ID ? "secondary" : "ghost"}
        size="sm"
        onClick={() => props.onChange(PERSONAL_WORK_CONTEXT_ID)}
      >
        <UserRound className="size-3.5" />
        {t("enterprise_connection.personal")}
      </Button>
      <Button
        type="button"
        variant={props.value === enterpriseScope ? "secondary" : "ghost"}
        size="sm"
        onClick={() => props.onChange(enterpriseScope)}
      >
        <Building2 className="size-3.5" />
        {props.enterprise.shortName}
      </Button>
    </div>
  );
}
