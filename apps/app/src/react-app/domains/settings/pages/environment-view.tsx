/** @jsxImportSource react */
import { useEffect, useId, useState, useRef, type SetStateAction } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, X } from "lucide-react";
import { toast } from "@/components/ui/sonner";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import { SearchField } from "@/components/ui/search-field";
import { TablePagination, TablePageSelection, TableBulkActions, type TableSortDirection } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { iPolloWorkServerClient } from "@/app/lib/ipollowork-server";
import { t } from "@/i18n";
import {
  EnvironmentVariableProvider,
  environmentUserEnvQueryKey,
  type ApplyEnvironmentChangesResult,
  type EnvironmentEditorDraft,
  useEnvironmentVariableApplyChanges,
  useEnvironmentVariableMarkChangesPending,
  useEnvironmentVariableList,
  useEnvironmentVariableModify,
  useEnvironmentVariableRemove,
  useIsEnvironmentVariableChangesPending,
} from "./environment-variable-provider";
import { SettingsNotice, Spinner } from "@/react-app/domains/settings/settings-section";
import {
  EnvironmentVariableTableItem,
  EnvironmentVariableTable,
  EnvironmentVariableTableBody,
  EnvironmentVariableTableEmpty,
  EnvironmentVariableTableHeader,
  EnvironmentVariableTableLoading,
  type EnvironmentVariableItem,
} from "./environment-variable-table";
import {
  LayoutSection,
  LayoutSectionDescription,
  LayoutSectionHeader,
  LayoutSectionItemFootnote,
  LayoutSectionTitle,
  LayoutStack,
} from "@/react-app/domains/settings/settings-layout";
import { ConfirmModal } from "@/react-app/design-system/modals/confirm-modal";

type EnvItem = EnvironmentVariableItem;
type EnvironmentEditorState = EnvironmentEditorDraft | null;

export type EnvironmentViewProps = {
  client: iPolloWorkServerClient | null;
  isRemoteWorkspace: boolean;
  onApplyChanges?: () => Promise<ApplyEnvironmentChangesResult>;
  applyBlocked?: boolean;
  applyBlockedReason?: string | null;
  runtimeKey?: string | null;
};

export function EnvironmentView(props: EnvironmentViewProps) {
  return (
    <EnvironmentVariableProvider
      client={props.client}
      runtimeKey={props.runtimeKey}
      onApplyChanges={props.onApplyChanges}
    >
      <EnvironmentViewContent {...props} />
    </EnvironmentVariableProvider>
  );
}

function EnvironmentViewContent(props: EnvironmentViewProps) {
  const { client, isRemoteWorkspace } = props;
  const canEdit = !isRemoteWorkspace && client !== null;
  const applyBlockedReason = props.applyBlocked
    ? props.applyBlockedReason ?? t("settings.environment.apply_blocked_active_tasks")
    : null;

  const [editor, setEditor] = useState<EnvironmentEditorState>(null);

  useEffect(() => {
    if (canEdit) {
      return;
    }
    setEditor(null);
  }, [canEdit]);

  return (
    <LayoutStack>
      <EnvironmentSettingsPanel
        client={client}
        isRemoteWorkspace={isRemoteWorkspace}
        canEdit={canEdit}
        runtimeKey={props.runtimeKey}
        onApplyChanges={props.onApplyChanges}
        applyBlocked={props.applyBlocked}
        applyBlockedReason={applyBlockedReason}
        editor={editor}
        onEditorChange={setEditor}
      />
    </LayoutStack>
  );
}

type EnvironmentSettingsPanelProps = {
  client: iPolloWorkServerClient | null;
  isRemoteWorkspace: boolean;
  canEdit: boolean;
  runtimeKey?: string | null;
  onApplyChanges?: () => Promise<ApplyEnvironmentChangesResult>;
  applyBlocked?: boolean;
  applyBlockedReason: string | null;
  editor: EnvironmentEditorState;
  onEditorChange: (value: SetStateAction<EnvironmentEditorState>) => void;
};

function EnvironmentSettingsPanel(props: EnvironmentSettingsPanelProps) {
  const isPendingChanges = useIsEnvironmentVariableChangesPending();
  const queryClient = useQueryClient();
  const markChangesPending = useEnvironmentVariableMarkChangesPending();
  const { data, error, isLoading, isFetching, refetch } = useEnvironmentVariableList({
    client: props.client,
    isRemoteWorkspace: props.isRemoteWorkspace,
    runtimeKey: props.runtimeKey,
  });

  const readEnvironmentValue = async (item: EnvItem) => {
    if (typeof item.value === "string") return item.value;
    if (!item.hasValue) {
      queryClient.setQueryData<{ items: EnvItem[] }>(
        environmentUserEnvQueryKey(props.runtimeKey),
        (current) => {
          if (!current) return current;
          return {
            items: current.items.map((entry) =>
              entry.key === item.key ? { ...entry, value: "" } : entry,
            ),
          };
        },
      );
      return "";
    }
    if (!props.client) throw new Error(t("app.unknown_error"));

    const response = await props.client.getUserEnv(item.key);
    queryClient.setQueryData<{ items: EnvItem[] }>(
      environmentUserEnvQueryKey(props.runtimeKey),
      (current) => {
        if (!current) return current;
        return {
          items: current.items.map((entry) =>
            entry.key === item.key
              ? {
                  ...entry,
                  value: response.item.value,
                  hasValue: response.item.hasValue,
                  updatedAt: response.item.updatedAt,
                }
              : entry,
          ),
        };
      },
    );
    return response.item.value;
  };

  const openAdd = () => {
    if (!props.canEdit) {
      return;
    }
    props.onEditorChange({ mode: "add", key: "", value: "" });
  };

  const openEdit = (item: EnvItem) => {
    if (!props.canEdit) {
      return;
    }
    void readEnvironmentValue(item)
      .then((value) => props.onEditorChange({ mode: "edit", key: item.key, value }))
      .catch((readError) => {
        toast.error(readError instanceof Error ? readError.message : t("app.unknown_error"));
      });
  };

  return (
    <LayoutSection>
      <LayoutSectionHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <LayoutSectionTitle>{t("settings.environment.title")}</LayoutSectionTitle>
            <LayoutSectionDescription className="max-w-[52ch]">
              {t("settings.environment.description")}
            </LayoutSectionDescription>
          </div>
          {props.canEdit ? (
            <Button className="shrink-0" onClick={openAdd}>
              <Plus className="size-4" />
              {t("settings.environment.add_button")}
            </Button>
          ) : null}
        </div>
      </LayoutSectionHeader>

      {props.isRemoteWorkspace ? (
        <SettingsNotice>{t("settings.environment.remote_workspace_hint")}</SettingsNotice>
      ) : null}

      {error ? <Alert variant="destructive"><AlertDescription>{error.message}</AlertDescription><AlertAction><Button size="sm" onClick={() => void refetch()}>{t("common.retry")}</Button></AlertAction></Alert> : null}

      {isPendingChanges && !props.isRemoteWorkspace ? (
        <EnvironmentPendingChanges
          onApplyChanges={props.onApplyChanges}
          applyBlocked={props.applyBlocked}
          applyBlockedReason={props.applyBlockedReason}
        />
      ) : null}

      {!props.isRemoteWorkspace ? (
        <EnvironmentItemsTable
          loading={isLoading}
          refreshing={isFetching}
          readError={Boolean(error)}
          onRefresh={() => void refetch()}
          onRemoveMany={async keys => {
            const client = props.client;
            if (!client || !props.canEdit) throw new Error(t("app.unknown_error"));
            const failures: { key: string; message: string }[] = [];
            let changed = false;
            for (let start = 0; start < keys.length; start += 5) {
              await Promise.all(keys.slice(start, start + 5).map(async key => {
                try {
                  await client.deleteUserEnv(key);
                  changed = true;
                  queryClient.setQueryData<{ items: EnvItem[] }>(environmentUserEnvQueryKey(props.runtimeKey), current => current ? { items: current.items.filter(item => item.key !== key) } : current);
                } catch (error) { failures.push({ key, message: error instanceof Error ? error.message : t("app.unknown_error") }); }
              }));
            }
            if (changed) markChangesPending();
            await queryClient.invalidateQueries({ queryKey: environmentUserEnvQueryKey(props.runtimeKey) });
            return failures;
          }}
          items={data?.items ?? []}
          canEdit={props.canEdit}
          onAdd={openAdd}
          onEdit={openEdit}
          onRevealValue={readEnvironmentValue}
        />
      ) : null}

      {!props.isRemoteWorkspace ? (
        <>
          <LayoutSectionItemFootnote>{t("settings.environment.footer_hint")}</LayoutSectionItemFootnote>
          <LayoutSectionItemFootnote>{t("settings.environment.override_hint")}</LayoutSectionItemFootnote>
        </>
      ) : null}

      {props.editor ? (
        <EnvironmentEditorModal
          editor={props.editor}
          onClose={() => props.onEditorChange(null)}
          onChange={props.onEditorChange}
        />
      ) : null}
    </LayoutSection>
  );
}

type EnvironmentPendingChangesProps = {
  onApplyChanges?: () => Promise<ApplyEnvironmentChangesResult>;
  applyBlocked?: boolean;
  applyBlockedReason: string | null;
};

function EnvironmentPendingChanges(props: EnvironmentPendingChangesProps) {
  const [applyConfirmOpen, setApplyConfirmOpen] = useState(false);
  const { isApplying, error } = useEnvironmentVariableApplyChanges();

  return (
    <>
      <Alert variant="warning">
        <RefreshCw />
        <AlertTitle>{t("settings.environment.apply_pending_title")}</AlertTitle>
        <AlertDescription className="max-w-[54ch]">
          {props.onApplyChanges
            ? t("settings.environment.apply_pending_body")
            : t("settings.environment.apply_pending_body_manual")}
        </AlertDescription>
        {props.applyBlockedReason ? (
          <AlertDescription>{props.applyBlockedReason}</AlertDescription>
        ) : error ? (
          <SettingsNotice tone="error">{error.message}</SettingsNotice>
        ) : null}
        {props.onApplyChanges ? (
          <AlertAction>
            <Button
              size="sm"
              onClick={() => {
                if (props.applyBlocked) {
                  toast.warning(props.applyBlockedReason ?? t("settings.environment.apply_blocked_active_tasks"));
                  return;
                }
                setApplyConfirmOpen(true);
              }}
              disabled={isApplying || props.applyBlocked}
              title={props.applyBlockedReason ?? undefined}
            >
              <Spinner spinning={isApplying} />
              {isApplying ? t("settings.environment.applying") : t("settings.environment.apply_button")}
            </Button>
          </AlertAction>
        ) : null}
      </Alert>

      <EnvironmentApplyModal
        open={applyConfirmOpen}
        onCancel={() => setApplyConfirmOpen(false)}
        onSuccess={() => setApplyConfirmOpen(false)}
      />
    </>
  );
}

type EnvironmentItemsTableProps = {
  loading: boolean;
  refreshing: boolean;
  readError: boolean;
  onRefresh: () => void;
  onRemoveMany: (keys: string[]) => Promise<{ key: string; message: string }[]>;
  items: EnvItem[];
  canEdit: boolean;
  onAdd: () => void;
  onEdit: (item: EnvItem) => void;
  onRevealValue: (item: EnvItem) => Promise<string>;
};

function EnvironmentItemsTable(props: EnvironmentItemsTableProps) {
  const [search, setSearch] = useState("");
  const [direction, setDirection] = useState<TableSortDirection>("none");
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(10);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmation, setConfirmation] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [receipt, setReceipt] = useState<{ success: number; failures: { key: string; message: string }[] } | null>(null);
  const filtered = props.items.filter(item => item.key.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  if (direction !== "none") filtered.sort((a, b) => a.key.localeCompare(b.key) * (direction === "ascending" ? 1 : -1));
  const pageIndex = Math.min(page, Math.max(0, Math.ceil(filtered.length / size) - 1));
  const rows = filtered.slice(pageIndex * size, (pageIndex + 1) * size);
  const itemKeys = new Set(props.items.map(item => item.key));
  const selectedKeys = selected.filter(key => itemKeys.has(key));
  const disabled = busy || props.refreshing || props.readError;
  const execute = async () => {
    if (!confirmation || lock.current || disabled || !props.canEdit) return;
    lock.current = true; setBusy(true);
    const keys = confirmation;
    try {
      const failures = await props.onRemoveMany(keys);
      setSelected(failures.map(failure => failure.key));
      setReceipt({ success: keys.length - failures.length, failures });
    } catch (error) {
      setReceipt({ success: 0, failures: keys.map(key => ({ key, message: error instanceof Error ? error.message : t("app.unknown_error") })) });
    } finally { setConfirmation(null); lock.current = false; setBusy(false); }
  };
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [revealing, setRevealing] = useState<Record<string, boolean>>({});
  const [deleteCandidate, setDeleteCandidate] = useState<EnvItem | null>(null);
  const { isRemoving } = useEnvironmentVariableRemove();

  const toggleReveal = async (key: string) => {
    const item = props.items.find((entry) => entry.key === key);
    if (revealed[key] && typeof item?.value === "string") {
      setRevealed((current) => ({ ...current, [key]: false }));
      return;
    }
    if (!item) return;
    setRevealing((current) => ({ ...current, [key]: true }));
    try {
      await props.onRevealValue(item);
      setRevealed((current) => ({ ...current, [key]: true }));
    } catch (readError) {
      toast.error(readError instanceof Error ? readError.message : t("app.unknown_error"));
    } finally {
      setRevealing((current) => ({ ...current, [key]: false }));
    }
  };

  if (props.loading && props.items.length === 0) {
    return <EnvironmentVariableTableLoading />;
  }
  if (props.items.length === 0 && !search && !receipt && !props.readError) {
    return <EnvironmentVariableTableEmpty canAdd={props.canEdit} onAdd={props.onAdd} />;
  }
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <SearchField value={search} onValueChange={value => { setSearch(value); setPage(0); setSelected([]); setReceipt(null); }} clearLabel={t("client_list.reset")} aria-label={t("client_list.search")} placeholder={t("client_list.search")} disabled={busy} containerClassName="w-64 max-w-full" />
        <Button variant="ghost" size="sm" disabled={busy || props.refreshing} onClick={props.onRefresh}>{t("client_list.refresh")}</Button>
      </div>
      {receipt ? <Alert variant={receipt.failures.length ? "destructive" : "success"}><AlertDescription>{t("client_list.result", { success: receipt.success, failed: receipt.failures.length })}{receipt.failures.length ? <p className="break-words">{receipt.failures[0]?.key}: {receipt.failures[0]?.message}</p> : null}</AlertDescription></Alert> : null}
      {props.canEdit ? <TableBulkActions selectedCount={selectedKeys.length} label={t("client_list.selected", { count: selectedKeys.length })} clearLabel={t("client_list.clear")} busy={busy} onClear={() => { setSelected([]); setReceipt(null); }}>
        <Button variant="destructive" size="sm" disabled={disabled || isRemoving} onClick={() => setConfirmation([...selectedKeys])}>{busy ? t("client_list.busy") : receipt?.failures.length ? t("client_list.retry_failed") : t("client_list.bulk_delete")}</Button>
      </TableBulkActions> : null}
      <EnvironmentVariableTable>
        <EnvironmentVariableTableHeader direction={direction} onSort={value => { setDirection(value); setPage(0); }} selection={props.canEdit ? <TablePageSelection selectableCount={rows.length} selectedCount={rows.filter(item => selectedKeys.includes(item.key)).length} label={t("client_list.select_page")} disabled={disabled || isRemoving} onCheckedChange={checked => { setReceipt(null); setSelected(current => checked ? [...new Set([...current, ...rows.map(item => item.key)])] : current.filter(key => !rows.some(item => item.key === key))); }} /> : undefined} />
        <EnvironmentVariableTableBody>
          {rows.map((item) => (
            <EnvironmentVariableTableItem
              key={item.key}
              item={item}
              isRevealed={Boolean(revealed[item.key]) && typeof item.value === "string"}
              selection={props.canEdit ? <Checkbox aria-label={t("client_list.select_row", { name: item.key })} checked={selectedKeys.includes(item.key)} disabled={disabled || isRemoving} onCheckedChange={checked => { setReceipt(null); setSelected(current => checked ? [...new Set([...current, item.key])] : current.filter(key => key !== item.key)); }} /> : undefined}
              canEdit={props.canEdit && !busy}
              deleting={isRemoving && deleteCandidate?.key === item.key}
              revealing={Boolean(revealing[item.key])}
              onEdit={props.onEdit}
              onToggleReveal={(key) => void toggleReveal(key)}
              onDelete={setDeleteCandidate}
            />
          ))}
        </EnvironmentVariableTableBody>
      </EnvironmentVariableTable>
      {!rows.length && !props.readError ? <div className="py-4 text-center"><p>{t("client_list.empty")}</p>{search ? <Button variant="ghost" onClick={() => { setSearch(""); setPage(0); setSelected([]); }}>{t("client_list.reset")}</Button> : null}</div> : null}
      <TablePagination pageIndex={pageIndex} pageSize={size} total={filtered.length} disabled={busy} onPageChange={setPage} onPageSizeChange={value => { setSize(value); setPage(0); }} labels={{ navigation: t("client_list.pagination"), previous: t("client_list.previous"), next: t("client_list.next"), pageSize: t("client_list.page_size"), status: (page, pages, total) => t("client_list.page_status", { page, pages, total }) }} />
      <ConfirmModal open={confirmation !== null} title={t("client_list.bulk_delete")} message={<><p>{t("client_list.confirm_delete", { count: confirmation?.length ?? 0 })}</p><p className="max-h-32 overflow-auto break-words font-mono">{confirmation?.join("、")}</p></>} variant="danger" confirmLabel={busy ? t("client_list.busy") : t("common.delete")} cancelLabel={t("common.cancel")} onConfirm={() => void execute()} onCancel={() => { if (!lock.current) setConfirmation(null); }} />
      <EnvironmentDeleteModal
        candidate={deleteCandidate}
        onCancel={() => setDeleteCandidate(null)}
        onSuccess={() => setDeleteCandidate(null)}
      />
    </>
  );
}

type EnvironmentEditorModalProps = {
  editor: EnvironmentEditorDraft;
  onClose: () => void;
  onChange: (value: SetStateAction<EnvironmentEditorState>) => void;
};

type EnvironmentEditorFieldsProps = {
  editor: EnvironmentEditorDraft;
  onChange: (value: SetStateAction<EnvironmentEditorDraft>) => void;
  disabled?: boolean;
  error?: Error | null;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
};

export function EnvironmentEditorFields(props: EnvironmentEditorFieldsProps) {
  const keyFieldId = useId();
  const valueFieldId = useId();

  return (
    <FieldGroup>
      <Field data-invalid={props.error ? true : undefined}>
        <FieldLabel htmlFor={keyFieldId}>{t("settings.environment.key_label")}</FieldLabel>
        <Input
          id={keyFieldId}
          value={props.editor.key}
          onChange={(event) =>
            props.onChange((current) => ({ ...current, key: event.target.value }))
          }
          disabled={props.editor.mode === "edit" || props.disabled}
          placeholder={props.keyPlaceholder ?? "ANTHROPIC_API_KEY"}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={props.error ? true : undefined}
        />
        <FieldDescription>{t("settings.environment.key_hint")}</FieldDescription>
      </Field>
      <Field data-invalid={props.error ? true : undefined}>
        <FieldLabel htmlFor={valueFieldId}>{t("settings.environment.value_label")}</FieldLabel>
        <Textarea
          id={valueFieldId}
          value={props.editor.value}
          onChange={(event) =>
            props.onChange((current) => ({ ...current, value: event.target.value }))
          }
          disabled={props.disabled}
          rows={3}
          spellCheck={false}
          autoComplete="off"
          placeholder={props.valuePlaceholder}
          className="font-mono"
          aria-invalid={props.error ? true : undefined}
        />
        {props.error ? <FieldError>{props.error.message}</FieldError> : null}
      </Field>
    </FieldGroup>
  );
}

function EnvironmentEditorModal(props: EnvironmentEditorModalProps) {
  const { modifyAsync, isModifying, error } = useEnvironmentVariableModify();
  const titleId = useId();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        props.onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [props.onClose]);

  const submitEditor = () => {
    if (isModifying) {
      return;
    }

    void modifyAsync(props.editor, { onSuccess: props.onClose });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          props.onClose();
        }
      }}
    >
      <DialogContent
        data-testid="environment-editor-dialog"
        showCloseButton={false}
        className="max-w-[520px] gap-0 ring-0 dark:ring-1 dark:ring-border sm:max-w-[520px]"
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="absolute end-3 top-3"
          aria-label={t("common.close")}
          onClick={props.onClose}
        >
          <X className="size-4" />
        </Button>

        <DialogHeader className="pb-4 pe-8 text-left">
          <DialogTitle id={titleId}>
            {props.editor.mode === "add" ? t("settings.environment.add_title") : t("settings.environment.edit_title")}
          </DialogTitle>
        </DialogHeader>

        <EnvironmentEditorFields
          editor={props.editor}
          onChange={(value) => {
            props.onChange((current) => {
              if (!current) return current;
              return typeof value === "function" ? value(current) : value;
            });
          }}
          disabled={isModifying}
          error={error}
        />

        <DialogFooter className="mx-0 mb-0 flex-row gap-2 rounded-none border-0 bg-transparent p-0 pt-4 sm:justify-end">
          <DialogClose render={<Button variant="outline" size="sm" />}>
            {t("settings.environment.cancel")}
          </DialogClose>
          <Button size="sm" onClick={submitEditor} disabled={isModifying}>
            {isModifying ? t("settings.environment.saving") : t("settings.environment.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type EnvironmentDeleteModalProps = {
  candidate: EnvironmentVariableItem | null;
  onCancel: () => void;
  onSuccess: () => void;
};

export function EnvironmentDeleteModal(props: EnvironmentDeleteModalProps) {
  const { removeAsync, isRemoving } = useEnvironmentVariableRemove();

  return (
    <ConfirmModal
      open={props.candidate !== null}
      title={t("settings.environment.delete_title")}
      message={
        props.candidate
          ? t("settings.environment.confirm_delete").replace("{key}", props.candidate.key)
          : ""
      }
      confirmLabel={
        isRemoving ? t("settings.environment.deleting") : t("settings.environment.delete")
      }
      cancelLabel={t("settings.environment.cancel")}
      variant="danger"
      confirmButtonVariant="destructive"
      onConfirm={() => {
        if (!props.candidate) {
          return;
        }

        void removeAsync(props.candidate.key, { onSuccess: props.onSuccess });
      }}
      onCancel={() => {
        if (!isRemoving) {
          props.onCancel();
        }
      }}
    />
  );
}

type EnvironmentApplyModalProps = {
  open: boolean;
  onCancel: () => void;
  onSuccess: () => void;
};

export function EnvironmentApplyModal(props: EnvironmentApplyModalProps) {
  const { applyAsync, isApplying } = useEnvironmentVariableApplyChanges();

  return (
    <ConfirmModal
      open={props.open}
      title={t("settings.environment.apply_title")}
      message={t("settings.environment.apply_confirm_body")}
      confirmLabel={
        isApplying ? t("settings.environment.applying") : t("settings.environment.apply_button")
      }
      cancelLabel={t("settings.environment.cancel")}
      variant="warning"
      onConfirm={() => {
        void applyAsync(undefined, { onSuccess: props.onSuccess });
      }}
      onCancel={() => {
        if (!isApplying) {
          props.onCancel();
        }
      }}
    />
  );
}
