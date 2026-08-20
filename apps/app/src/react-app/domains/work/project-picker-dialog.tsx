/** @jsxImportSource react */
import { ChevronDown, LayoutDashboard } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { t } from "@/i18n";

import type { WorkEndpoint } from "./work-endpoints";

type ProjectPickerDialogProps = {
  open: boolean;
  endpoints: WorkEndpoint[];
  onOpenChange: (open: boolean) => void;
  onSelect: (endpoint: WorkEndpoint) => void;
};

export function ProjectPickerDialog(props: ProjectPickerDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="rounded-2xl border-white/15 bg-dls-surface/95 backdrop-blur-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("work.choose_project")}</DialogTitle>
          <DialogDescription>{t("work.choose_project_description")}</DialogDescription>
        </DialogHeader>
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {props.endpoints.map((endpoint) => (
            <button
              key={endpoint.key}
              type="button"
              className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-dls-hover focus-visible:bg-dls-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => props.onSelect(endpoint)}
            >
              <span className="flex size-8 items-center justify-center rounded-lg bg-dls-hover"><LayoutDashboard className="size-4" /></span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{endpoint.projectName}</span>
              <ChevronDown className="size-4 -rotate-90 text-dls-tertiary" />
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
