/** @jsxImportSource react */
import * as React from "react";
import { CheckCircle2, ExternalLink, KeyRound, Loader2, RefreshCcw } from "lucide-react";

import type { iPolloWorkPluginAuthorizationMethod } from "@/app/extensions";
import type {
  iPolloWorkPluginAuthorizationFlow,
  iPolloWorkPluginAuthorizationState,
  iPolloWorkPluginPackageItem,
  iPolloWorkServerClient,
} from "@/app/lib/ipollowork-server";
import { openDesktopUrl } from "@/app/lib/desktop";
import { isDesktopRuntime } from "@/app/utils";
import { AuthorizationFormDialog } from "@/components/authorization-form-dialog";
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

type ExternalAuthorizationState = "idle" | "starting" | "waiting" | "connected" | "error";

export function resolvePluginAuthorizationMethod(
  item: iPolloWorkPluginPackageItem,
  authorization: iPolloWorkPluginAuthorizationState | undefined,
  preferredMethodId?: string,
): iPolloWorkPluginAuthorizationMethod | null {
  const methods = item.manifest.authorization?.methods ?? [];
  const preferred = preferredMethodId ? methods.find((method) => method.id === preferredMethodId) : undefined;
  if (preferred) return preferred;

  const connectedMethodIds = new Set(authorization?.connections.map((connection) => connection.methodId) ?? []);
  const requiredMethodIds = authorization?.requiredMethodIds.length
    ? authorization.requiredMethodIds
    : methods.map((method) => method.id);
  return methods.find((method) => requiredMethodIds.includes(method.id) && !connectedMethodIds.has(method.id))
    ?? methods.find((method) => !connectedMethodIds.has(method.id))
    ?? methods[0]
    ?? null;
}

export function PluginAuthorizationDialog(props: {
  open: boolean;
  item: iPolloWorkPluginPackageItem | null;
  authorization: iPolloWorkPluginAuthorizationState | undefined;
  client: iPolloWorkServerClient | null;
  workspaceId: string | null;
  methodId?: string;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => void | Promise<void>;
}) {
  const method = props.item
    ? resolvePluginAuthorizationMethod(props.item, props.authorization, props.methodId)
    : null;
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const [externalState, setExternalState] = React.useState<ExternalAuthorizationState>("idle");
  const [flow, setFlow] = React.useState<iPolloWorkPluginAuthorizationFlow | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const startedKey = React.useRef<string | null>(null);
  const completedKey = React.useRef<string | null>(null);

  const item = props.item;
  const workspaceId = props.workspaceId;
  const client = props.client;
  const onUpdated = props.onUpdated;

  const openAuthorizationUrl = React.useCallback(async (url: string) => {
    if (isDesktopRuntime()) await openDesktopUrl(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  const complete = React.useCallback(async () => {
    const key = item && method ? `${item.pluginId}:${method.id}` : null;
    if (!key || completedKey.current === key) return;
    completedKey.current = key;
    setExternalState("connected");
    await onUpdated();
  }, [item, method, onUpdated]);

  const startExternalAuthorization = React.useCallback(async () => {
    if (!client || !workspaceId || !item || !method || method.kind === "secret-form") {
      setError(t("plugin_platform.error.operation"));
      setExternalState("error");
      return;
    }
    setExternalState("starting");
    setError(null);
    setFlow(null);
    try {
      const result = await client.startPluginAuthorization(workspaceId, item.pluginId, method.id);
      setFlow(result.flow);
      setExternalState("waiting");
      const url = result.flow.authorizationUrl ?? result.flow.verificationUrl;
      if (url) await openAuthorizationUrl(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("plugin_platform.error.operation"));
      setExternalState("error");
    }
  }, [client, item, method, openAuthorizationUrl, workspaceId]);

  React.useEffect(() => {
    if (!props.open) {
      setValues({});
      setSaving(false);
      setExternalState("idle");
      setFlow(null);
      setError(null);
      startedKey.current = null;
      completedKey.current = null;
      return;
    }
    if (!item || !method || method.kind === "secret-form") return;
    const key = `${item.pluginId}:${method.id}`;
    if (startedKey.current === key) return;
    startedKey.current = key;
    void startExternalAuthorization();
  }, [item, method, props.open, startExternalAuthorization]);

  React.useEffect(() => {
    if (externalState !== "waiting" || !flow || !client || !workspaceId || !item || !method) return;
    const delay = Math.max(1_000, flow.pollIntervalMs ?? 2_000);
    let polling = false;
    const poll = async () => {
      if (polling) return;
      if (Date.now() >= flow.expiresAt) {
        setError(t("mcp.auth.request_timed_out"));
        setExternalState("error");
        return;
      }
      polling = true;
      try {
        if (flow.kind === "device-code") {
          const result = await client.pollPluginDeviceAuthorization(workspaceId, item.pluginId, flow.flowId);
          if (result.status.status === "connected") await complete();
          return;
        }
        const authorization = await client.getPluginAuthorization(workspaceId, item.pluginId);
        if (authorization.connections.some((connection) => connection.methodId === method.id)) await complete();
      } catch {
        return;
      } finally {
        polling = false;
      }
    };
    const timer = window.setInterval(() => void poll(), delay);
    return () => window.clearInterval(timer);
  }, [client, complete, externalState, flow, item, method, workspaceId]);

  if (!item || !method) return null;

  if (method.kind === "secret-form") {
    const connection = props.authorization?.connections.find((candidate) => candidate.methodId === method.id);
    return (
      <AuthorizationFormDialog
        open={props.open}
        title={method.label}
        description={method.description}
        fields={method.fields.map((field) => ({
          id: field.id,
          label: field.label,
          placeholder: field.placeholder,
          secret: field.secret,
          description: field.description,
          saved: connection?.fields[field.id] === true,
        }))}
        values={values}
        saving={saving}
        error={error}
        cancelLabel={t("plugin_platform.cancel")}
        savedLabel={t("settings.authorization.value_saved")}
        submitLabel={t("plugin_platform.connect")}
        savingLabel={t("settings.authorization.saving")}
        onValuesChange={setValues}
        onClose={() => props.onOpenChange(false)}
        onSubmit={() => void (async () => {
          if (!client || !workspaceId) return;
          setSaving(true);
          setError(null);
          try {
            await client.savePluginAuthorization(workspaceId, item.pluginId, method.id, values);
            await onUpdated();
            props.onOpenChange(false);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : t("plugin_platform.error.operation"));
          } finally {
            setSaving(false);
          }
        })()}
      />
    );
  }

  const authorizationUrl = flow?.authorizationUrl ?? flow?.verificationUrl;
  const cancel = async () => {
    if (client && workspaceId && flow) {
      await client.cancelPluginAuthorization(workspaceId, item.pluginId, flow.flowId).catch(() => undefined);
    }
    props.onOpenChange(false);
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="plugin-authorization-dialog">
        <DialogHeader>
          <DialogTitle>{method.label}</DialogTitle>
          <DialogDescription>{method.description ?? item.manifest.description}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-28 items-center gap-3 rounded-xl border border-dls-border bg-dls-hover/30 px-4 py-3">
          {externalState === "idle" || externalState === "starting" || externalState === "waiting" ? <Loader2 className="size-5 shrink-0 animate-spin text-dls-accent" /> : null}
          {externalState === "connected" ? <CheckCircle2 className="size-5 shrink-0 text-emerald-500" /> : null}
          {externalState === "error" ? <RefreshCcw className="size-5 shrink-0 text-amber-500" /> : null}
          <div className="min-w-0 text-sm text-dls-text">
            {externalState === "idle" || externalState === "starting" ? t("mcp.auth.applying_changes_title") : null}
            {externalState === "waiting" ? t("mcp.auth.waiting_authorization") : null}
            {externalState === "connected" ? t("plugin_platform.status.connected") : null}
            {externalState === "error" ? error : null}
            {externalState === "waiting" && flow?.kind === "device-code" && flow.userCode ? (
              <span className="mt-2 block w-fit rounded-md bg-dls-surface px-2 py-1 font-mono text-xs">{flow.userCode}</span>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          {externalState === "connected" ? (
            <DialogClose render={<Button variant="outline" />}>
              {t("mcp.auth.done")}
            </DialogClose>
          ) : (
            <Button variant="outline" onClick={() => void cancel()}>{t("plugin_platform.cancel")}</Button>
          )}
          {authorizationUrl && externalState === "waiting" ? (
            <Button variant="outline" onClick={() => void openAuthorizationUrl(authorizationUrl)}>
              <ExternalLink className="size-4" />
              {t("mcp.auth.reopen_browser_link")}
            </Button>
          ) : null}
          {externalState === "error" ? (
            <Button onClick={() => void startExternalAuthorization()}>
              <RefreshCcw className="size-4" />
              {t("mcp.auth.retry")}
            </Button>
          ) : null}
          {externalState === "idle" ? <KeyRound className="size-4 text-dls-secondary" /> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
