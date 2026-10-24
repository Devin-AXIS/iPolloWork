import * as React from "react";
import { Toaster as SharedToaster } from "@ipollowork/ui/sonner";
import { getResolvedThemeMode, subscribeToTheme } from "@/app/theme";
import { t } from "@/i18n";
export { toast } from "@ipollowork/ui/sonner";
export function Toaster(props: React.ComponentProps<typeof SharedToaster>) {
  const theme = React.useSyncExternalStore(subscribeToTheme, getResolvedThemeMode, getResolvedThemeMode);
  return <SharedToaster theme={theme} closeLabel={t("common.close")} {...props} />;
}
