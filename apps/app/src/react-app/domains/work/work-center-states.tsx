/** @jsxImportSource react */
import { CircleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";

export function WorkCenterLoading() {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden p-4 lg:grid-cols-4">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="rounded-2xl border border-dls-border bg-dls-surface/70 p-3">
          <Skeleton className="h-5 w-24 rounded-lg" />
          <div className="mt-4 space-y-3">
            <Skeleton className="h-28 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function WorkCenterError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <CircleAlert className="mx-auto size-7 text-dls-tertiary" />
        <p className="mt-3 text-sm font-medium text-dls-text">{t("work.load_failed")}</p>
        <p className="mt-1 text-xs leading-5 text-dls-secondary">{t("work.load_failed_description")}</p>
        <Button type="button" variant="outline" size="sm" className="mt-4" onClick={onRetry}>{t("common.retry")}</Button>
      </div>
    </div>
  );
}
