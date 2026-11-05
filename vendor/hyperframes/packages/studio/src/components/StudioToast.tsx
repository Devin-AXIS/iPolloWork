import { CircleCheck, LoaderCircle, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@ipollowork/ui/alert";
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
  const StatusIcon =
    resolvedTone === "loading"
      ? LoaderCircle
      : resolvedTone === "success"
        ? CircleCheck
        : TriangleAlert;
  return (
    <div
      role={isError ? "alert" : "status"}
      className={`motion-reduce:animate-none ${leaving ? "hf-toast-exit" : "hf-toast-enter"}`}
    >
      <Alert
        data-testid="studio-toast-surface"
        data-tone={resolvedTone}
        variant={isError ? "destructive" : resolvedTone === "success" ? "success" : "default"}
        role={isError ? "alert" : "status"}
        className="min-w-[240px] max-w-[min(420px,calc(100vw-48px))]"
        onDismiss={onDismiss}
        closeLabel={tx("Dismiss")}
      >
        <StatusIcon
          aria-hidden="true"
          className={resolvedTone === "loading" ? "shrink-0 animate-spin" : "shrink-0"}
          size={17}
          strokeWidth={2.5}
        />
        <AlertDescription className="min-w-0 break-words">
          {message}
        </AlertDescription>
      </Alert>
    </div>
  );
}
