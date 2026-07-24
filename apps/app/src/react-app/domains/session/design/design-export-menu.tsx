/** @jsxImportSource react */
import { Check, Download, Ellipsis, Loader2, Monitor, Presentation, Share2, Smartphone } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { t } from "@/i18n";

type DesignExportMenuProps = {
  triggerClassName?: string;
  compact?: boolean;
  showExports?: boolean;
  publishing?: boolean;
  publishDisabled?: boolean;
  exportingPdf: boolean;
  exportingPptx: boolean;
  exportReady?: boolean;
  exportDisabledReason?: string;
  previewDevice?: "desktop" | "mobile";
  onPreviewDeviceChange?: (device: "desktop" | "mobile") => void;
  onPublish?: () => void;
  onExportPdf: () => void;
  onExportPptx: () => void;
};

export function DesignExportMenu({
  triggerClassName,
  compact = false,
  showExports = true,
  publishing = false,
  publishDisabled = false,
  exportingPdf,
  exportingPptx,
  exportReady = true,
  exportDisabledReason,
  previewDevice,
  onPreviewDeviceChange,
  onPublish,
  onExportPdf,
  onExportPptx,
}: DesignExportMenuProps) {
  const downloadLabel = t("design.export.download");
  const triggerDisabled = compact
    ? publishDisabled && !onPreviewDeviceChange && (!showExports || (exportingPdf && exportingPptx) || !exportReady)
    : (exportingPdf && exportingPptx) || !exportReady;
  const disabledReason = exportDisabledReason || "Preview is still preparing.";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(
          <Button
            variant="ghost"
            size="icon-sm"
            className={triggerClassName}
            disabled={triggerDisabled}
            aria-label={compact ? "More design actions" : downloadLabel}
            title={compact ? "More" : triggerDisabled && !exportReady ? disabledReason : downloadLabel}
          >
            {compact ? <Ellipsis /> : <Download />}
          </Button>
        )}
      />
      <DropdownMenuContent align="end" className="w-44">
        {compact && onPreviewDeviceChange ? (
          <>
            <DropdownMenuItem onClick={() => onPreviewDeviceChange("desktop")}>
              <Monitor />
              Desktop
              {previewDevice === "desktop" ? <Check className="ml-auto" /> : null}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onPreviewDeviceChange("mobile")}>
              <Smartphone />
              Mobile
              {previewDevice === "mobile" ? <Check className="ml-auto" /> : null}
            </DropdownMenuItem>
            {onPublish || showExports ? <DropdownMenuSeparator /> : null}
          </>
        ) : null}
        {compact && onPublish ? (
          <>
            <DropdownMenuItem disabled={publishDisabled} onClick={onPublish}>
              {publishing ? <Loader2 className="animate-spin" /> : <Share2 />}
              Publish
            </DropdownMenuItem>
            {showExports ? <DropdownMenuSeparator /> : null}
          </>
        ) : null}
        {showExports ? (
          <>
            <DropdownMenuItem disabled={exportingPdf || !exportReady} onClick={onExportPdf}>
              {exportingPdf ? <Loader2 className="animate-spin" /> : <Download />}
              {t("design.export.download_pdf")}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={exportingPptx || !exportReady} onClick={onExportPptx}>
              {exportingPptx ? <Loader2 className="animate-spin" /> : <Presentation />}
              {t("design.export.download_pptx")}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
