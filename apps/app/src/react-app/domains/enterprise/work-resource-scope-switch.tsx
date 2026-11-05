/** @jsxImportSource react */
import { Building2, UserRound } from "lucide-react";

import {
  enterpriseWorkContextId,
  PERSONAL_WORK_CONTEXT_ID,
} from "@/app/lib/work-context";
import type { EnterpriseConnection } from "@/app/lib/enterprise-connections";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { t } from "@/i18n";

type WorkResourceScopeSwitchProps = {
  enterprise: EnterpriseConnection | null;
};

export function WorkResourceScopeSwitch(props: WorkResourceScopeSwitchProps) {
  if (!props.enterprise) return null;
  const enterpriseScope = enterpriseWorkContextId(props.enterprise.id);

  return (
    <TabsList aria-label={t("enterprise_connection.resource_scope")} className="max-w-full">
      <TabsTrigger value={PERSONAL_WORK_CONTEXT_ID} className="flex-none shrink-0">
        <UserRound className="size-3.5" />
        {t("enterprise_connection.personal")}
      </TabsTrigger>
      <TabsTrigger value={enterpriseScope} className="min-w-0 flex-initial" title={props.enterprise.name}>
        <Building2 className="size-3.5" />
        <span className="max-w-48 truncate">{props.enterprise.name}</span>
      </TabsTrigger>
    </TabsList>
  );
}
