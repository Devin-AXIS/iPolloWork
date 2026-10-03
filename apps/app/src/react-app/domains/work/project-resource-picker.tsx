/** @jsxImportSource react */
import * as React from "react";
import { Check, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandHeader,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

export type ProjectResourceOption = {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
};

export function ProjectResourcePicker({ label, searchLabel, emptyLabel, testId, items, onAdd }: {
  label: string;
  searchLabel: string;
  emptyLabel: string;
  testId: string;
  items: ProjectResourceOption[];
  onAdd: (ids: string[]) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const setPickerOpen = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) setSelectedIds([]);
  };
  const toggle = (id: string) => setSelectedIds((current) => current.includes(id)
    ? current.filter((selectedId) => selectedId !== id)
    : [...current, id]);
  const confirm = () => {
    if (!selectedIds.length) return;
    onAdd(selectedIds);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setPickerOpen}>
      <PopoverTrigger
        type="button"
        data-testid={testId}
        className="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2 text-[11px] font-medium text-dls-secondary transition-colors hover:bg-dls-hover hover:text-dls-text"
      >
        <Plus className="size-3.5" />{label}
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" sideOffset={6} className="h-80 w-[min(22rem,calc(100vw-2rem))] gap-0 overflow-hidden p-px">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Command items={items}>
            <CommandHeader>
              <CommandInput placeholder={searchLabel} />
            </CommandHeader>
            <CommandEmpty>{emptyLabel}</CommandEmpty>
            <CommandList>
              {(item: ProjectResourceOption) => (
                <CommandItem
                  key={item.id}
                  value={`${item.label} ${item.description}`}
                  className="gap-2.5 rounded-lg px-2.5 py-2"
                  aria-selected={selectedIds.includes(item.id)}
                  data-checked={selectedIds.includes(item.id)}
                  onClick={() => toggle(item.id)}
                >
                  {item.icon}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-medium text-dls-text">{item.label}</span>
                    <span className="block truncate text-[10px] text-dls-tertiary">{item.description}</span>
                  </span>
                  <span className={cn(
                    "grid size-4 shrink-0 place-items-center rounded border transition-colors",
                    selectedIds.includes(item.id)
                      ? "border-dls-text bg-dls-text text-dls-surface"
                      : "border-dls-border bg-dls-surface text-transparent",
                  )} aria-hidden="true">
                    <Check className="size-3" />
                  </span>
                </CommandItem>
              )}
            </CommandList>
          </Command>
        </div>
        <div className="flex h-11 shrink-0 items-center justify-between border-t border-dls-border px-3">
          <span className="text-[10px] text-dls-tertiary">{t("project_overview.selected_count", { count: selectedIds.length })}</span>
          <Button type="button" size="sm" className="h-7 rounded-lg px-3 text-[11px]" disabled={!selectedIds.length} onClick={confirm}>
            {t("common.add")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
