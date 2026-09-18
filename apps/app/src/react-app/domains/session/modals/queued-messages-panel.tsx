/** @jsxImportSource react */
import { useState } from "react";
import { CornerDownRight, LoaderCircle, Send, Trash2 } from "lucide-react";

import { t } from "@/i18n";

export type QueuedMessagesPanelProps = {
  messages: string[];
  steerable: boolean[];
  onSteer?: (index: number) => Promise<void>;
  onRemove: (index: number) => void;
};

/** Compact follow-up list shown while the current task is running. */
export function QueuedMessagesPanel(props: QueuedMessagesPanelProps) {
  const [steeringIndex, setSteeringIndex] = useState<number | null>(null);

  if (props.messages.length === 0) return null;

  const steer = async (index: number) => {
    if (!props.onSteer || steeringIndex !== null) return;
    setSteeringIndex(index);
    try {
      await props.onSteer(index);
    } finally {
      setSteeringIndex(null);
    }
  };

  return (
    <div data-testid="queued-messages-panel" className="max-h-52 overflow-auto border-b border-dls-border/70 bg-transparent">
      {props.messages.map((message, index) => {
        const steering = steeringIndex === index;
        const canSteer = Boolean(props.onSteer && props.steerable[index]);
        return (
          <div
            key={index}
            data-queued-message-index={index}
            className="group flex min-h-12 items-center gap-3 border-b border-dls-border/50 px-4 py-2.5 last:border-b-0"
          >
            <CornerDownRight size={16} strokeWidth={1.75} className="shrink-0 text-gray-9" aria-hidden="true" />
            <div className="min-w-0 flex-1 truncate text-sm font-medium text-gray-12" title={message}>
              {message}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {canSteer ? (
                <button
                  type="button"
                  data-testid="queued-message-steer"
                  disabled={steeringIndex !== null}
                  onClick={() => { void steer(index); }}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-gray-11 transition-colors hover:bg-gray-3 hover:text-gray-12 disabled:opacity-50"
                  title={t("composer.steer_queued_hint")}
                >
                  {steering
                    ? <LoaderCircle size={14} strokeWidth={1.75} className="animate-spin" aria-hidden="true" />
                    : <Send size={14} strokeWidth={1.75} aria-hidden="true" />}
                  {t("composer.steer_queued")}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => props.onRemove(index)}
                className="flex size-8 items-center justify-center rounded-lg text-gray-9 transition-colors hover:bg-gray-3 hover:text-gray-12"
                title={t("common.remove")}
                aria-label={t("common.remove")}
              >
                <Trash2 size={15} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
