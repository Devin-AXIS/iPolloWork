/** @jsxImportSource react */
import { Sparkles } from "lucide-react";

import { t } from "../../../i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type CloudSignInComingSoonDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CloudSignInComingSoonDialog({ open, onOpenChange }: CloudSignInComingSoonDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-md gap-0 overflow-hidden border border-dls-border bg-dls-surface p-0 shadow-[0_24px_70px_rgba(28,30,34,0.16)] sm:max-w-md">
        <div className="relative isolate overflow-hidden px-7 pb-7 pt-8 sm:px-9 sm:pb-9 sm:pt-10">
          <div aria-hidden className="pointer-events-none absolute -right-24 -top-32 size-72 rounded-full border-[18px] border-dls-border/60" />
          <div aria-hidden className="pointer-events-none absolute -bottom-64 left-8 size-96 rounded-full border-[14px] border-dls-border/45" />

          <div className="relative">
            <div className="inline-flex items-center gap-2 rounded-full border border-dls-border bg-dls-surface/90 px-2.5 py-1 text-xs font-medium text-dls-secondary">
              <span className="grid size-5 place-items-center rounded-full bg-dls-hover text-dls-accent">
                <Sparkles className="size-3" />
              </span>
              iPolloWork Cloud
            </div>

            <DialogHeader className="mt-8 max-w-xs text-left">
              <DialogTitle className="text-[28px] font-semibold leading-tight tracking-[-0.035em] text-dls-text">
                {t("den.signin_coming_soon_title")}
              </DialogTitle>
              <DialogDescription className="mt-3 max-w-sm text-sm leading-6 text-dls-secondary">
                {t("den.signin_coming_soon_description")}
              </DialogDescription>
            </DialogHeader>

            <DialogFooter className="mt-8 border-dls-border/70 bg-transparent px-0 pb-0 pt-4 sm:justify-start">
              <DialogClose render={<Button size="lg" className="min-w-32 rounded-full" />}>
                {t("den.signin_coming_soon_action")}
              </DialogClose>
            </DialogFooter>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
