/** @jsxImportSource react */
import * as React from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

type AppErrorBoundaryState = {
  failed: boolean;
};

export class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error("[app] unrecoverable render error", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
        <section
          role="alert"
          className="w-full max-w-md rounded-lg border border-border bg-card p-6 text-center shadow-sm"
        >
          <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <TriangleAlert className="size-5" />
          </div>
          <h1 className="mt-4 text-base font-semibold">{t("app.crash_title")}</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{t("app.crash_description")}</p>
          <Button className="mt-5" onClick={() => window.location.reload()}>
            <RefreshCw data-icon="inline-start" />
            {t("app.reload_now")}
          </Button>
        </section>
      </main>
    );
  }
}
