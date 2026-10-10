import type * as React from "react";
import { Alert as SharedAlert } from "@ipollowork/ui/alert";
import { t } from "@/i18n";
export { AlertTitle, AlertDescription, AlertAction } from "@ipollowork/ui/alert";
export function Alert(props: React.ComponentProps<typeof SharedAlert>) { return <SharedAlert closeLabel={t("common.close")} {...props} />; }
