/** @jsxImportSource react */
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, RefreshCcw } from "lucide-react";

import type { McpDirectoryInfo } from "@/app/constants";
import type { iPolloWorkServerClient } from "@/app/lib/ipollowork-server";
import { openDesktopUrl } from "@/app/lib/desktop";
import { validateMcpServerName } from "@/app/mcp";
import { isDesktopRuntime } from "@/app/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { t } from "@/i18n";

const POLL_INTERVAL_MS = 1_500;
const AUTHORIZATION_TIMEOUT_MS = 2 * 60_000;

type AuthorizationState = "idle" | "starting" | "waiting" | "connected" | "error";

export type McpAuthModalProps = {
  open: boolean;
  onClose: () => void;
  onComplete: () => void | Promise<void>;
  serverClient: iPolloWorkServerClient | null;
  workspaceId: string | null;
  entry: McpDirectoryInfo | null;
};

export function McpAuthModal(props: McpAuthModalProps) {
  const [state, setState] = useState<AuthorizationState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
  const startedAt = useRef(0);

  const serverName = props.entry
    ? validateMcpServerName(props.entry.name).toLowerCase().replace(/[^a-z0-9]+/g, "-")
    : "";

  const openAuthorizationUrl = useCallback(async (url: string) => {
    if (isDesktopRuntime()) await openDesktopUrl(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  const start = useCallback(async () => {
    if (!props.serverClient || !props.workspaceId || !serverName) {
      setError(t("mcp.connect_server_first"));
      setState("error");
      return;
    }
    setState("starting");
    setError(null);
    setAuthorizationUrl(null);
    try {
      const result = await props.serverClient.startMcpAuthorization(props.workspaceId, serverName);
      startedAt.current = Date.now();
      setAuthorizationUrl(result.authorizationUrl);
      setState("waiting");
      await openAuthorizationUrl(result.authorizationUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("mcp.auth.failed_to_start_oauth"));
      setState("error");
    }
  }, [openAuthorizationUrl, props.serverClient, props.workspaceId, serverName]);

  useEffect(() => {
    if (!props.open) {
      setState("idle");
      setError(null);
      setAuthorizationUrl(null);
      return;
    }
    void start();
  }, [props.open, start]);

  useEffect(() => {
    if (state !== "waiting" || !props.serverClient || !props.workspaceId || !serverName) return;
    const poll = window.setInterval(async () => {
      if (Date.now() - startedAt.current > AUTHORIZATION_TIMEOUT_MS) {
        window.clearInterval(poll);
        setError(t("mcp.auth.request_timed_out"));
        setState("error");
        return;
      }
      try {
        const status = await props.serverClient!.getMcpAuthorizationStatus(props.workspaceId!, serverName);
        if (!status.connected) return;
        window.clearInterval(poll);
        setState("connected");
        await props.onComplete();
      } catch {
        return;
      }
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(poll);
  }, [props, serverName, state]);

  const title = props.entry ? t("mcp.auth.connect_server", { server: props.entry.name }) : t("mcp.auth.failed_to_start_oauth");

  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {state === "connected"
              ? t("mcp.auth.already_connected_description", { server: props.entry?.name ?? "MCP" })
              : t("mcp.auth.open_browser_signin")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-28 items-center gap-3 rounded-xl border border-dls-border bg-dls-hover/30 px-4 py-3">
          {state === "starting" || state === "waiting" ? <Loader2 className="size-5 shrink-0 animate-spin text-dls-accent" /> : null}
          {state === "connected" ? <CheckCircle2 className="size-5 shrink-0 text-emerald-500" /> : null}
          {state === "error" ? <RefreshCcw className="size-5 shrink-0 text-amber-500" /> : null}
          <div className="min-w-0 text-sm text-dls-text">
            {state === "starting" ? t("mcp.auth.applying_changes_title") : null}
            {state === "waiting" ? t("mcp.auth.waiting_authorization") : null}
            {state === "connected" ? t("mcp.auth.already_connected") : null}
            {state === "error" ? error : null}
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            {state === "connected" ? t("mcp.auth.done") : t("mcp.auth.cancel")}
          </DialogClose>
          {authorizationUrl && state === "waiting" ? (
            <Button variant="outline" onClick={() => void openAuthorizationUrl(authorizationUrl)}>
              <ExternalLink className="size-4" />
              {t("mcp.auth.reopen_browser_link")}
            </Button>
          ) : null}
          {state === "error" ? (
            <Button onClick={() => void start()}>
              <RefreshCcw className="size-4" />
              {t("mcp.auth.retry")}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
