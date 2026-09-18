import {
  CheckCircleIcon,
  SpinnerGap,
  WarningIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useStudioI18n } from "../i18n";
import type { ToastTone } from "../utils/studioHelpers";

interface StudioToastProps {
  message: string;
  tone?: ToastTone;
  /** Plays the exit animation when true (owner removes the node after ~160ms). */
  leaving?: boolean;
  onDismiss?: () => void;
}

export function StudioToast({ message, tone, leaving, onDismiss }: StudioToastProps) {
  const { tx } = useStudioI18n();
  const resolvedTone = tone ?? "error";
  const isError = resolvedTone === "error";
  const statusColor = `var(--hf-toast-${resolvedTone})`;
  const StatusIcon =
    resolvedTone === "loading"
      ? SpinnerGap
      : resolvedTone === "success"
        ? CheckCircleIcon
        : WarningIcon;
  return (
    <div
      role={isError ? "alert" : "status"}
      className={`motion-reduce:animate-none ${leaving ? "hf-toast-exit" : "hf-toast-enter"}`}
    >
      <div
        data-testid="studio-toast-surface"
        data-tone={resolvedTone}
        className="relative flex min-w-[240px] max-w-[min(420px,calc(100vw-48px))] items-center gap-3 overflow-hidden rounded-xl border px-3 py-2.5 font-sans text-[12px]"
        style={{
          background: "var(--hf-toast-bg)",
          borderColor: "var(--hf-toast-border)",
          boxShadow: "var(--hf-toast-shadow)",
        }}
      >
        <StatusIcon
          aria-hidden="true"
          className={resolvedTone === "loading" ? "shrink-0 animate-spin" : "shrink-0"}
          color={statusColor}
          size={17}
          weight="bold"
        />
        <span className="min-w-0 flex-1 break-words leading-5 text-[var(--hf-toast-text)]">
          {message}
        </span>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md text-[var(--hf-toast-muted)] transition-colors hover:bg-[var(--hf-panel-hover)] hover:text-[var(--hf-toast-text)]"
            aria-label={tx("Dismiss")}
          >
            <XIcon size={11} weight="bold" />
          </button>
        )}
      </div>
    </div>
  );
}
