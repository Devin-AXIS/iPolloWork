/** @jsxImportSource react */
import * as React from "react";
import type { WorkBoardConfig } from "@ipollowork/types/work-items";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SearchField } from "@/components/ui/search-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableSortHead, TablePagination, TablePageSelection, TableBulkActions, type TableSortDirection } from "@/components/ui/table";
import { Alert, AlertDescription, AlertAction } from "@/components/ui/alert";
import { ConfirmModal } from "@/react-app/design-system/modals/confirm-modal";
import { t } from "@/i18n";
import type { ProjectBoardItem } from "./project-board";

type BulkFailure = { key: string; message: string };
// Automated and execution-bound records keep their existing lifecycle controls.
function selectableItem(entry: ProjectBoardItem) { return !entry.executionRecord && !entry.item.automation?.enabled && !entry.item.execution; }
export function WorkItemList({ items, board, refreshing, readError, onRefresh, onOpen, onStatus }: {
  items: ProjectBoardItem[]; board: WorkBoardConfig; refreshing: boolean; readError: boolean;
  onRefresh: () => void; onOpen: (key: string) => void;
  onStatus: (keys: string[], status: string) => Promise<BulkFailure[]>;
}) {
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [sort, setSort] = React.useState<{ column: "name" | "time"; direction: TableSortDirection }>({ column: "name", direction: "none" });
  const [page, setPage] = React.useState(0);
  const [size, setSize] = React.useState(10);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [target, setTarget] = React.useState(board.columns[0]?.id ?? "");
  const [confirmation, setConfirmation] = React.useState<{ keys: string[]; status: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const lock = React.useRef(false);
  const [receipt, setReceipt] = React.useState<{ success: number; failures: BulkFailure[] } | null>(null);
  const filtered = items.filter(entry => entry.item.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) && (!status || entry.item.status === status));
  if (sort.direction !== "none") filtered.sort((a, b) => {
    const comparison = sort.column === "name" ? a.item.title.localeCompare(b.item.title) : a.item.updatedAt - b.item.updatedAt;
    return (comparison || a.key.localeCompare(b.key)) * (sort.direction === "ascending" ? 1 : -1);
  });
  const pageIndex = Math.min(page, Math.max(0, Math.ceil(filtered.length / size) - 1));
  const rows = filtered.slice(pageIndex * size, (pageIndex + 1) * size);
  const selectable = rows.filter(entry => selectableItem(entry));
  const selectableKeys = new Set(items.filter(selectableItem).map(entry => entry.key));
  const selectedKeys = selected.filter(key => selectableKeys.has(key));
  const disabled = busy || refreshing || readError;
  const resetFilter = () => { setPage(0); setSelected([]); setReceipt(null); };
  const execute = async () => {
    if (!confirmation || lock.current || disabled) return;
    lock.current = true; setBusy(true);
    const snapshot = confirmation;
    try {
      const failures = await onStatus(snapshot.keys, snapshot.status);
      setSelected(failures.map(failure => failure.key));
      setReceipt({ success: snapshot.keys.length - failures.length, failures });
      setConfirmation(null);
    } catch (error) {
      setReceipt({ success: 0, failures: snapshot.keys.map(key => ({ key, message: error instanceof Error ? error.message : t("app.unknown_error") })) });
      setConfirmation(null);
    } finally { lock.current = false; setBusy(false); }
  };
  return <section data-testid="work-item-list" className="min-h-0 overflow-auto space-y-2 text-ui-body">
    <div role="group" aria-label={t("client_list.list")} className="flex flex-wrap items-center gap-2">
      <SearchField value={search} onValueChange={value => { setSearch(value); resetFilter(); }} clearLabel={t("client_list.reset")} aria-label={t("client_list.search")} placeholder={t("client_list.search")} disabled={busy} containerClassName="w-64 max-w-full" />
      <Select value={status} onValueChange={value => { setStatus(value ?? ""); resetFilter(); }} disabled={busy}>
        <SelectTrigger aria-label={t("work.field.status")} className="w-36"><SelectValue>{board.columns.find(column => column.id === status)?.label ?? t("client_list.all")}</SelectValue></SelectTrigger>
        <SelectContent><SelectItem value="">{t("client_list.all")}</SelectItem>{board.columns.map(column => <SelectItem key={column.id} value={column.id}>{column.label}</SelectItem>)}</SelectContent>
      </Select>
      <Button variant="ghost" size="sm" disabled={busy || refreshing} onClick={onRefresh}>{t("client_list.refresh")}</Button>
    </div>
    <p className="text-ui-meta text-muted-foreground">{t("client_list.loaded")}</p>
    {readError ? <Alert variant="destructive"><AlertDescription>{t("work.load_failed")}</AlertDescription><AlertAction><Button size="sm" onClick={onRefresh}>{t("common.retry")}</Button></AlertAction></Alert> : null}
    {receipt ? <Alert variant={receipt.failures.length ? "destructive" : "success"}>
      <AlertDescription>{t("client_list.result", { success: receipt.success, failed: receipt.failures.length })}{receipt.failures.length ? <p className="break-words">{receipt.failures[0]?.message}</p> : null}</AlertDescription>
    </Alert> : null}
    <TableBulkActions selectedCount={selectedKeys.length} label={t("client_list.selected", { count: selectedKeys.length })} clearLabel={t("client_list.clear")} busy={busy} onClear={() => { setSelected([]); setReceipt(null); }}>
      <Select value={target} onValueChange={value => { if (value !== null) { setTarget(value); setReceipt(null); } }} disabled={disabled}>
        <SelectTrigger aria-label={t("client_list.target_status")} className="w-32"><SelectValue>{board.columns.find(column => column.id === target)?.label}</SelectValue></SelectTrigger>
        <SelectContent>{board.columns.map(column => <SelectItem key={column.id} value={column.id}>{column.label}</SelectItem>)}</SelectContent>
      </Select>
      <Button size="sm" disabled={disabled || !board.columns.some(column => column.id === target)} onClick={() => setConfirmation({ keys: [...selectedKeys], status: target })}>{busy ? t("client_list.busy") : receipt?.failures.length ? t("client_list.retry_failed") : t("client_list.bulk_status")}</Button>
    </TableBulkActions>
    <Table aria-busy={refreshing || busy}>
      <TableHeader><TableRow>
        <TableHead className="w-10"><TablePageSelection selectableCount={selectable.length} selectedCount={selectable.filter(entry => selectedKeys.includes(entry.key)).length} label={t("client_list.select_page")} disabled={disabled} onCheckedChange={checked => { setReceipt(null); setSelected(current => checked ? [...new Set([...current, ...selectable.map(entry => entry.key)])] : current.filter(key => !selectable.some(entry => entry.key === key))); }} /></TableHead>
        <TableSortHead direction={sort.column === "name" ? sort.direction : "none"} label={t("client_list.sort_name")} onDirectionChange={direction => { setSort({ column: "name", direction }); setPage(0); }} disabled={busy}>{t("work.field.title")}</TableSortHead>
        <TableHead>{t("work.field.status")}</TableHead>
        <TableSortHead direction={sort.column === "time" ? sort.direction : "none"} label={t("client_list.sort_time")} onDirectionChange={direction => { setSort({ column: "time", direction }); setPage(0); }} disabled={busy}>{t("client_list.updated")}</TableSortHead>
      </TableRow></TableHeader>
      <TableBody>{rows.map(entry => <TableRow key={entry.key} data-row-id={entry.key} data-state={selectedKeys.includes(entry.key) ? "selected" : undefined}>
        <TableCell><Checkbox aria-label={t("client_list.select_row", { name: entry.item.title })} checked={selectedKeys.includes(entry.key)} disabled={disabled || !selectableItem(entry)} onCheckedChange={checked => { setReceipt(null); setSelected(current => checked ? [...new Set([...current, entry.key])] : current.filter(key => key !== entry.key)); }} /></TableCell>
        <TableCell className="max-w-80"><Button variant="link" className="h-auto max-w-full justify-start truncate p-0 text-ui-body" onClick={() => onOpen(entry.key)} disabled={busy}>{entry.item.title}</Button>{!selectableItem(entry) ? <p className="text-ui-meta text-muted-foreground">{t("client_list.readonly")}</p> : null}</TableCell>
        <TableCell>{board.columns.find(column => column.id === entry.item.status)?.label ?? entry.item.status}</TableCell>
        <TableCell className="text-ui-meta text-muted-foreground">{new Date(entry.item.updatedAt).toLocaleString()}</TableCell>
      </TableRow>)}</TableBody>
    </Table>
    {!rows.length ? <div className="py-6 text-center"><p>{t("client_list.empty")}</p>{search || status ? <Button variant="ghost" onClick={() => { setSearch(""); setStatus(""); resetFilter(); }}>{t("client_list.reset")}</Button> : null}</div> : null}
    <TablePagination pageIndex={pageIndex} pageSize={size} total={filtered.length} disabled={busy} onPageChange={setPage} onPageSizeChange={value => { setSize(value); setPage(0); }} labels={{ navigation: t("client_list.pagination"), previous: t("client_list.previous"), next: t("client_list.next"), pageSize: t("client_list.page_size"), status: (page, pages, total) => t("client_list.page_status", { page, pages, total }) }} />
    <ConfirmModal open={confirmation !== null} title={t("client_list.bulk_status")} message={<><p>{t("client_list.confirm_status", { count: confirmation?.keys.length ?? 0, status: board.columns.find(column => column.id === confirmation?.status)?.label ?? "" })}</p><p className="max-h-32 overflow-auto break-words">{confirmation?.keys.map(key => items.find(entry => entry.key === key)?.item.title).join("、")}</p></>} confirmLabel={busy ? t("client_list.busy") : t("common.save")} cancelLabel={t("common.cancel")} onConfirm={() => void execute()} onCancel={() => { if (!lock.current) setConfirmation(null); }} />
  </section>;
}
