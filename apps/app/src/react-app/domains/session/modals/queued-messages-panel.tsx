/** @jsxImportSource react */
import { useEffect, useMemo, useState } from "react";
import { GripVertical, ListPlus, Trash2, X } from "lucide-react";

import { t } from "@/i18n";

export type QueuedMessagesPanelProps = {
  messages: string[];
  onRemove: (index: number) => void;
  onRemoveMany: (indices: number[]) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
};

/**
 * Shows the follow-up messages the user has queued while the agent is busy.
 * Rendered above the composer (mirrors the QuestionPanel header style). Each
 * entry can be removed with an X. The whole panel hides when the queue is
 * empty — callers should simply not render it in that case, but we also guard
 * here for safety.
 */
export function QueuedMessagesPanel(props: QueuedMessagesPanelProps) {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(() => new Set());
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  useEffect(() => {
    setSelectedIndices((current) => {
      const next = new Set<number>();
      current.forEach((index) => {
        if (index < props.messages.length) next.add(index);
      });
      return next;
    });
    if (props.messages.length === 0) setSelectionMode(false);
  }, [props.messages.length]);

  const selectedCount = selectedIndices.size;
  const allSelected = selectedCount > 0 && selectedCount === props.messages.length;
  const selectedList = useMemo(() => [...selectedIndices].sort((left, right) => left - right), [selectedIndices]);

  if (props.messages.length === 0) return null;

  const toggleSelection = (index: number) => {
    setSelectedIndices((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const removeSelected = () => {
    if (selectedList.length === 0) return;
    if (!window.confirm(t("composer.queued_delete_selected_confirm", { count: selectedList.length }))) return;
    props.onRemoveMany(selectedList);
    setSelectedIndices(new Set());
    setSelectionMode(false);
  };

  return (
    <div className="overflow-hidden border-b border-dls-border bg-transparent">
      <div className="border-b border-dls-border px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="flex size-5 shrink-0 items-center justify-center rounded-full border border-gray-7/40 bg-gray-3/40 text-gray-11">
              <ListPlus size={12} />
            </div>
            <div className="text-sm font-medium leading-5 text-gray-12">
              {t("composer.queued_count", { count: props.messages.length })}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {selectionMode ? (
              <>
                <button type="button" onClick={() => setSelectedIndices(allSelected ? new Set() : new Set(props.messages.map((_, index) => index)))} className="rounded-md px-2 py-1 text-xs text-gray-10 transition-colors hover:bg-gray-3 hover:text-gray-12">
                  {allSelected ? t("composer.queued_select_none") : t("composer.queued_select_all")}
                </button>
                <button type="button" onClick={removeSelected} disabled={selectedCount === 0} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-red-10 transition-colors hover:bg-red-3 hover:text-red-11 disabled:pointer-events-none disabled:opacity-45">
                  <Trash2 size={12} />
                  {t("composer.queued_delete_selected", { count: selectedCount })}
                </button>
              </>
            ) : null}
            <button type="button" onClick={() => { setSelectionMode((value) => !value); setSelectedIndices(new Set()); }} className="rounded-md px-2 py-1 text-xs text-gray-10 transition-colors hover:bg-gray-3 hover:text-gray-12">
              {selectionMode ? t("common.cancel") : t("composer.queued_select")}
            </button>
          </div>
        </div>
      </div>

      <div className="max-h-48 space-y-2 overflow-auto px-4 py-3">
        {props.messages.map((message, index) => (
          <div
            key={index}
            draggable
            onDragStart={(event) => {
              setDraggedIndex(index);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", String(index));
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => {
              event.preventDefault();
              const from = draggedIndex ?? Number(event.dataTransfer.getData("text/plain"));
              setDraggedIndex(null);
              if (Number.isFinite(from)) props.onReorder(from, index);
            }}
            onDragEnd={() => setDraggedIndex(null)}
            className={`flex items-start justify-between gap-3 rounded-xl border px-3 py-2.5 transition-colors ${draggedIndex === index ? "border-primary/40 bg-primary/5 opacity-70" : "border-gray-6 bg-gray-1"}`}
          >
            <span className="mt-0.5 flex size-5 shrink-0 cursor-grab items-center justify-center rounded-md text-gray-9 active:cursor-grabbing" title={t("composer.queued_drag_handle")}>
              <GripVertical size={13} />
            </span>
            {selectionMode ? (
              <input type="checkbox" checked={selectedIndices.has(index)} onChange={() => toggleSelection(index)} aria-label={t("composer.queued_select_item", { index: index + 1 })} className="mt-1 size-4 shrink-0 accent-primary" />
            ) : null}
            <div className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm leading-5 text-gray-11">
              {message}
            </div>
            <button
              type="button"
              onClick={() => props.onRemove(index)}
              className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md text-gray-10 transition-colors hover:bg-gray-3 hover:text-gray-12"
              title={t("common.remove")}
            >
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
