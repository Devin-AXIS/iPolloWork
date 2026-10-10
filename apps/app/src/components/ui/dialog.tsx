import * as React from "react";
import { DialogContent as SharedContent, DialogFooter as SharedFooter } from "@ipollowork/ui/dialog";
import { t } from "@/i18n";
export { Dialog, DialogClose, DialogDescription, DialogHeader, DialogOverlay, DialogPortal, DialogTitle, DialogTrigger } from "@ipollowork/ui/dialog";
export function DialogContent(props: React.ComponentProps<typeof SharedContent>) { return <SharedContent closeLabel={t("common.close")} {...props} />; }
export function DialogFooter(props: React.ComponentProps<typeof SharedFooter>) { return <SharedFooter closeLabel={t("common.close")} {...props} />; }
