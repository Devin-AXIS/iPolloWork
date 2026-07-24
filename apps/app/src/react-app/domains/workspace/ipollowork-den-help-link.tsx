/** @jsxImportSource react */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const SUPPORT_EMAIL = "team@ipolloworklabs.com";
const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}?subject=iPolloWork%20Den%20remote%20worker%20upgrade`;

/**
 * Small inline link rendered inside the remote-worker error card. When clicked,
 * it opens a dialog explaining the iPolloWork Den upgrade situation and how to
 * reach support.
 */
export function IPolloWorkDenHelpLink() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="mt-2 inline-flex items-center text-[11px] font-medium text-blue-11 underline-offset-2 hover:underline"
        onClick={() => setOpen(true)}
      >
        {t("den.remote_worker_help_link")}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("den.remote_worker_help_title")}</DialogTitle>
            <DialogDescription>
              {t("den.remote_worker_help_description")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-[13px] leading-5 text-gray-11">
            <p>{t("den.remote_worker_help_options")}</p>
            <ul className="ml-4 list-disc space-y-2">
              <li>
                {t("den.remote_worker_help_email_prefix")}{" "}
                <a
                  href={SUPPORT_MAILTO}
                  className="font-medium text-blue-11 hover:underline"
                >
                  {SUPPORT_EMAIL}
                </a>{" "}
                {t("den.remote_worker_help_email_suffix")}
              </li>
              <li>
                {t("den.remote_worker_help_feedback_prefix")}{" "}
                <span className="font-medium text-dls-text">{t("status.feedback")}</span>{" "}
                {t("den.remote_worker_help_feedback_suffix")}
              </li>
            </ul>
          </div>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              {t("common.close")}
            </DialogClose>
            <Button
              type="button"
              onClick={() => {
                window.location.href = SUPPORT_MAILTO;
              }}
            >
              {t("den.remote_worker_help_email_support")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
