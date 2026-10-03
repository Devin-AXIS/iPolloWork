/** @jsxImportSource react */
import { BookmarkPlus, Loader2, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { t } from "@/i18n";

type DesignSaveMenuProps = {
  triggerClassName?: string;
  expanded?: boolean;
  saving: boolean;
  saveDisabled: boolean;
  onSave: () => void;
  onSaveAsTemplate: () => void;
};

export function DesignSaveMenu({
  triggerClassName,
  expanded = false,
  saving,
  saveDisabled,
  onSave,
  onSaveAsTemplate,
}: DesignSaveMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(
          <Button
            variant="ghost"
            size="icon-sm"
            className={triggerClassName}
            disabled={saving}
            aria-label={t("design.toolbar.save")}
            title={t("design.toolbar.save")}
          >
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
          </Button>
        )}
      />
      <DropdownMenuContent
        align="end"
        positionerClassName={expanded ? "z-[70]" : undefined}
        className="w-48"
      >
        <DropdownMenuItem disabled={saveDisabled} onClick={onSave}>
          <Save />
          {t("design.toolbar.save")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onSaveAsTemplate}>
          <BookmarkPlus />
          {t("design.toolbar.save_to_templates")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
