import { useState, useRef, useId, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useMountEffect } from "../hooks/useMountEffect";
import { type AgentModalAnchorPoint, clampNumber } from "../utils/studioHelpers";
import { useDialogBehavior } from "./ui/useDialogBehavior";
import { useStudioI18n } from "../i18n";
import { copyTextToClipboard } from "../utils/clipboard";
import { ArrowUp, LoaderCircle, Sparkles } from "lucide-react";

function getAgentModalPositionStyle(
  anchorPoint: AgentModalAnchorPoint | null,
): CSSProperties | undefined {
  if (!anchorPoint || typeof window === "undefined") return undefined;

  const modalWidth = Math.min(480, window.innerWidth - 32);
  const estimatedModalHeight = Math.min(440, window.innerHeight - 32);
  const margin = 16;
  const left = clampNumber(
    anchorPoint.x,
    margin + modalWidth / 2,
    window.innerWidth - margin - modalWidth / 2,
  );
  const top = clampNumber(
    anchorPoint.y + 12,
    margin,
    window.innerHeight - margin - estimatedModalHeight,
  );

  return { left, top, maxHeight: `calc(100vh - ${top + margin}px)`, transform: "translateX(-50%)" };
}

export function AskAgentModal({
  selectionLabel,
  contextPreview,
  anchorPoint = null,
  allowEmptyInstruction = false,
  copyInstruction = false,
  onSubmit,
  onClose,
}: {
  selectionLabel: string;
  contextPreview?: string;
  anchorPoint?: AgentModalAnchorPoint | null;
  allowEmptyInstruction?: boolean;
  copyInstruction?: boolean;
  onSubmit: (instruction: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const { tx } = useStudioI18n();
  const instructionId = useId();
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedInstruction, setCopiedInstruction] = useState(false);
  const submittingRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const modalPositionStyle = getAgentModalPositionStyle(anchorPoint);
  // Keep a draft and in-flight request visible until the host accepts it.
  const { requestClose } = useDialogBehavior({
    open: true,
    onClose,
    containerRef,
    canClose: () => !value.trim() && !submittingRef.current,
  });

  useMountEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  });

  const handleSubmit = async () => {
    if ((!value.trim() && !allowEmptyInstruction) || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    try { await onSubmit(value.trim()); }
    catch (failure) {
      setError(failure instanceof Error ? failure.message : tx("Could not send request. Please retry."));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      className={
        anchorPoint
          ? "hf-backdrop-in fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm"
          : "hf-backdrop-in fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      }
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        requestClose();
      }}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-busy={submitting}
        data-preserve-studio-selection="true"
        aria-label={tx(window.parent === window ? "Copy prompt to AI agent" : "Ask AI")}
        tabIndex={-1}
        className={`w-[480px] max-w-[calc(100vw-32px)] max-h-[calc(100vh-32px)] overflow-auto rounded-2xl border border-panel-border bg-panel-bg shadow-2xl outline-none ${
          anchorPoint ? "fixed" : ""
        }`}
        style={modalPositionStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-studio-accent/10 text-studio-accent"><Sparkles size={20} aria-hidden="true" /></span>
            <div className="min-w-0">
            <h3 className="text-sm font-medium text-panel-text-1">{tx(window.parent === window ? "Copy prompt to AI agent" : "Ask AI")}</h3>
            <p className="mt-1 text-xs leading-5 text-panel-text-3">{tx(window.parent === window ? "Context included in prompt" : "Send to the current AI conversation on the left")}</p>
            </div>
          </div>
          <button
            type="button"
            disabled={submitting}
            className="p-1 rounded-md text-panel-text-3 hover:text-panel-text-1 hover:bg-panel-hover disabled:opacity-40 active:scale-[0.98]"
            onClick={onClose}
            aria-label={tx("Close")}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="rounded-xl border border-panel-border bg-panel-input px-3 py-2.5">
            <span className="text-[11px] text-panel-text-3">{tx("Annotation target")}</span>
            <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-panel-text-1">{selectionLabel}</p>
          </div>
          <label className="block text-xs font-medium text-panel-text-2" htmlFor={instructionId}>{tx("Describe what you want to change…")}</label>
          <textarea
            id={instructionId}
            ref={inputRef}
            className="w-full h-28 px-3 py-2.5 rounded-xl border border-panel-border-input bg-panel-input text-sm leading-6 text-panel-text-1 placeholder-panel-text-3 resize-y focus:outline-none focus:border-studio-accent/60 focus:ring-2 focus:ring-studio-accent/20 disabled:opacity-60"
            placeholder={tx("Describe what you want to change…")}
            aria-label={tx("Describe what you want to change…")}
            maxLength={4000}
            disabled={submitting}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
              setCopiedInstruction(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void handleSubmit();
              }
              // Escape is handled at the document level by useDialogBehavior,
              // guarded against discarding a dirty draft.
            }}
          />
          {error && <p role="alert" className="rounded-lg border border-panel-danger/20 bg-panel-danger/5 px-3 py-2 text-xs leading-5 text-panel-danger">{error}</p>}
          {contextPreview && (
            <details className="group">
              <summary className="text-[11px] text-panel-text-3 cursor-pointer select-none hover:text-panel-text-2">
                {tx("Context included in prompt")}
              </summary>
              <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-panel-input px-3 py-2 text-[11px] leading-relaxed text-panel-text-2 whitespace-pre-wrap break-words border border-panel-border">
                {contextPreview}
              </pre>
            </details>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-panel-border">
          <span className="text-[11px] text-panel-text-3">
            {navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}+
            {tx(window.parent === window ? "Enter to copy" : "Enter to send")}
          </span>
          {copyInstruction && (
            <button
              type="button"
              disabled={!value.trim() || submitting}
              className="ml-auto text-xs text-panel-text-2 disabled:opacity-40"
              onClick={async () => {
                try {
                  if (!await copyTextToClipboard(value.trim())) throw new Error(tx("Could not copy prompt to clipboard."));
                  setCopiedInstruction(true);
                } catch (failure) {
                  setError(failure instanceof Error ? failure.message : tx("Could not copy prompt to clipboard."));
                }
              }}
            >{tx(copiedInstruction ? "Copied" : "Copy Prompt")}</button>
          )}
          <button
            type="button"
            className="flex shrink-0 items-center gap-2 px-4 py-2 rounded-lg bg-studio-accent/90 text-xs font-medium text-neutral-950 hover:bg-studio-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent/40 disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={(!value.trim() && !allowEmptyInstruction) || submitting}
            onClick={() => void handleSubmit()}
          >
            {submitting ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <ArrowUp size={14} aria-hidden="true" />}
            {tx(submitting ? "Sending…" : window.parent === window ? "Copy prompt" : "Ask AI")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
