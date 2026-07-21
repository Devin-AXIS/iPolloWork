/** @jsxImportSource react */
import { Download, FileCode2, Loader2, Presentation } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { t } from "@/i18n";

type DesignExportMenuProps = {
  canExportPresentation: boolean;
  exportingHtml: boolean;
  exportingPdf: boolean;
  exportingPptx: boolean;
  onExportHtml: () => void;
  onExportPdf: () => void;
  onExportPptx: () => void;
};

export function DesignExportMenu({
  canExportPresentation,
  exportingHtml,
  exportingPdf,
  exportingPptx,
  onExportHtml,
  onExportPdf,
  onExportPptx,
}: DesignExportMenuProps) {
  const downloadLabel = t("design.export.download");
  const allExportsBusy = exportingHtml && (!canExportPresentation || (exportingPdf && exportingPptx));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(
          <Button
            variant="outline"
            size="icon-sm"
            disabled={allExportsBusy}
            aria-label={downloadLabel}
            title={downloadLabel}
          >
            <Download />
          </Button>
        )}
      />
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem disabled={exportingHtml} onClick={onExportHtml}>
          {exportingHtml ? <Loader2 className="animate-spin" /> : <FileCode2 />}
          {t("design.export.download_html")}
        </DropdownMenuItem>
        {canExportPresentation ? (
          <>
            <DropdownMenuItem disabled={exportingPdf} onClick={onExportPdf}>
              {exportingPdf ? <Loader2 className="animate-spin" /> : <Download />}
              {t("design.export.download_pdf")}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={exportingPptx} onClick={onExportPptx}>
              {exportingPptx ? <Loader2 className="animate-spin" /> : <Presentation />}
              {t("design.export.download_pptx")}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
