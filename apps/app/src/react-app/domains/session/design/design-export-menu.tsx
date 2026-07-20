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
  onExportPdf: () => void;
  onExportPptx: () => void;
};

export function DesignExportMenu({
  exportingPdf,
  exportingPptx,
  onExportPdf,
  onExportPptx,
}: DesignExportMenuProps) {
  const downloadLabel = t("design.export.download");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(
          <Button
            variant="outline"
            size="icon-sm"
            disabled={exportingPdf && exportingPptx}
            aria-label={downloadLabel}
            title={downloadLabel}
          >
            <Download />
          </Button>
        )}
      />
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem disabled={exportingPdf} onClick={onExportPdf}>
          {exportingPdf ? <Loader2 className="animate-spin" /> : <Download />}
          {t("design.export.download_pdf")}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={exportingPptx} onClick={onExportPptx}>
          {exportingPptx ? <Loader2 className="animate-spin" /> : <Presentation />}
          {t("design.export.download_pptx")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
