import * as React from "react"

import { Button } from "./controls"
import { Checkbox } from "./checkbox"
import { Icon } from "./icon"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select"
import { cn } from "../common/control-styles"

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-ui-body", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-8 px-2.5 text-start align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pe-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "px-2.5 py-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pe-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-ui-body text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}


export type TableSortDirection = "none" | "ascending" | "descending";

export function TableSortHead({ direction, onDirectionChange, label, disabled, children, ...props }:
  Omit<React.ComponentProps<typeof TableHead>, "aria-sort"> & {
    direction: TableSortDirection; onDirectionChange: (direction: TableSortDirection) => void;
    label: string; disabled?: boolean;
  }) {
  const next = direction === "none" ? "ascending" : direction === "ascending" ? "descending" : "none";
  return <TableHead {...props} aria-sort={direction}>
    <Button type="button" variant="ghost" size="sm" disabled={disabled} aria-label={label}
      className="-ml-2 h-8" onClick={() => onDirectionChange(next)}>
      {children}<Icon name={direction === "ascending" ? "ChevronUp" : "ChevronDown"} size="s" className={direction === "none" ? "opacity-40" : undefined} />
    </Button>
  </TableHead>;
}

export function TablePageSelection({ selectableCount, selectedCount, label, onCheckedChange, disabled }:
  {selectableCount: number; selectedCount: number; label: string; onCheckedChange: (checked: boolean) => void; disabled?: boolean}) {
  return <Checkbox aria-label={label} disabled={disabled || selectableCount === 0}
    checked={selectableCount > 0 && selectedCount === selectableCount}
    indeterminate={selectedCount > 0 && selectedCount < selectableCount}
    onCheckedChange={onCheckedChange} />;
}

export function TablePagination({ pageIndex, pageSize, total, pageSizes = [10, 20, 50], disabled, onPageChange, onPageSizeChange, labels }:
  {pageIndex: number; pageSize: number; total: number; pageSizes?: readonly number[]; disabled?: boolean;
    onPageChange: (index: number) => void; onPageSizeChange: (size: number) => void;
    labels: {navigation: string; previous: string; next: string; pageSize: string; status: (page: number, pages: number, total: number) => string}}) {
  const pages = Math.ceil(total / pageSize);
  return <nav data-slot="table-pagination" aria-label={labels.navigation} className="flex min-w-0 flex-wrap items-center gap-2 py-2 text-ui-meta">
    <span role="status" className="mr-auto">{labels.status(pages ? pageIndex + 1 : 0, pages, total)}</span>
    <Select value={String(pageSize)} onValueChange={value => { if (value !== null) onPageSizeChange(Number(value)); }} disabled={disabled}>
      <SelectTrigger aria-label={labels.pageSize} className="w-20"><SelectValue>{pageSize}</SelectValue></SelectTrigger>
      <SelectContent>{pageSizes.map(size => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}</SelectContent>
    </Select>
    <Button type="button" variant="outline" size="icon-sm" aria-label={labels.previous} disabled={disabled || pageIndex <= 0 || pages === 0} onClick={() => onPageChange(pageIndex - 1)}><Icon name="ChevronLeft" size="s" /></Button>
    <Button type="button" variant="outline" size="icon-sm" aria-label={labels.next} disabled={disabled || pageIndex >= pages - 1} onClick={() => onPageChange(pageIndex + 1)}><Icon name="ChevronRight" size="s" /></Button>
  </nav>;
}

export function TableBulkActions({ selectedCount, label, clearLabel, onClear, busy = false, children }:
  {selectedCount: number; label: string; clearLabel: string; onClear: () => void; busy?: boolean; children?: React.ReactNode}) {
  if (selectedCount === 0) return null;
  return <div data-slot="table-bulk-actions" role="group" aria-label={label} aria-busy={busy}
    className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg bg-muted/40 p-2 text-ui-control">
    <span role="status" className="mr-auto">{label}</span>
    <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onClear}>{clearLabel}</Button>
    {children}
  </div>;
}
