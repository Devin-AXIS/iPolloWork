import { useStudioI18n } from "../i18n";

interface StudioToastProps {
  message: string;
  tone?: "error" | "info" | "notice";
  /** Plays the exit animation when true (owner removes the node after ~160ms). */
  leaving?: boolean;
  onDismiss?: () => void;
}

export function StudioToast({ message, tone, leaving, onDismiss }: StudioToastProps) {
  const { tx } = useStudioI18n();
  const isError = tone === "error";
  const isNotice = tone === "notice";
  return (
    <div
      role={isError ? "alert" : "status"}
      className={`motion-reduce:animate-none ${leaving ? "hf-toast-exit" : "hf-toast-enter"}`}
    >
      <div
        data-testid="studio-toast-surface"
        className={`relative flex max-w-[min(420px,calc(100vw-48px))] items-center gap-3 overflow-hidden py-3 pl-4 pr-2 text-[12px] ${
          isNotice ? "rounded-[6px] font-sans" : "rounded-2xl"
        }`}
        style={{
          background: isError
            ? "linear-gradient(135deg, rgba(127,29,29,0.55), rgba(80,10,10,0.45))"
            : isNotice
              ? "#FFFFFF"
              : "linear-gradient(135deg, rgba(38,38,38,0.88), rgba(23,23,23,0.82))",
          backdropFilter: isNotice ? undefined : "blur(16px) saturate(1.6)",
          WebkitBackdropFilter: isNotice ? undefined : "blur(16px) saturate(1.6)",
          border: isNotice
            ? "none"
            : `1px solid ${isError ? "rgba(239,68,68,0.18)" : "rgba(255,255,255,0.08)"}`,
          boxShadow: isNotice
            ? "0 8px 32px rgba(0,0,0,0.35)"
            : [
                "0 8px 32px rgba(0,0,0,0.35)",
                `inset 0 1px 0 ${
                  isError ? "rgba(239,68,68,0.12)" : "rgba(255,255,255,0.06)"
                }`,
                "inset 0 -1px 0 rgba(0,0,0,0.15)",
              ].join(", "),
        }}
      >
        <span
          className={`min-w-0 break-words leading-5 ${
            isError ? "text-red-200" : isNotice ? "text-black" : "text-neutral-200"
          }`}
        >
          {message}
        </span>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md transition-colors ${
              isNotice
                ? "text-black/45 hover:bg-black/5 hover:text-black"
                : "text-neutral-500 hover:bg-white/10 hover:text-neutral-300"
            }`}
            aria-label={tx("Dismiss")}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M2 2l6 6M8 2l-6 6" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
