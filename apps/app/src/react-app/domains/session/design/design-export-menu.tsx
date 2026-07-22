/** @jsxImportSource react */
import { Download, Loader2, Presentation } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { t } from "@/i18n";

type DesignExportMenuProps = {
  exportingPdf: boolean;
  exportingPptx: boolean;
  exportReady?: boolean;
  exportDisabledReason?: string;
  onExportPdf: () => void;
  onExportPptx: () => void;
};

export function DesignExportMenu({
  exportingPdf,
  exportingPptx,
  exportReady = true,
  exportDisabledReason,
  onExportPdf,
  onExportPptx,
}: DesignExportMenuProps) {
  const downloadLabel = t("design.export.download");
  const triggerDisabled = exportingPdf || exportingPptx || !exportReady;
  const disabledReason = exportDisabledReason || "Preview is still preparing.";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(
          <Button
            variant="outline"
            size="icon-sm"
            disabled={triggerDisabled}
            aria-label={downloadLabel}
            title={triggerDisabled && !exportReady ? disabledReason : downloadLabel}
          >
            <Download />
          </Button>
        )}
      />
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem disabled={exportingPdf || !exportReady} onClick={onExportPdf}>
          {exportingPdf ? <Loader2 className="animate-spin" /> : <Download />}
          {t("design.export.download_pdf")}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={exportingPptx || !exportReady} onClick={onExportPptx}>
          {exportingPptx ? <Loader2 className="animate-spin" /> : <Presentation />}
          {t("design.export.download_pptx")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
