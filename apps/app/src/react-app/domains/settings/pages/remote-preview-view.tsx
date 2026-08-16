/** @jsxImportSource react */
import { useCallback, useEffect, useState } from "react";
import { Copy, Loader2, MonitorSmartphone, RefreshCw, ShieldAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { LanPreviewState } from "@/app/lib/desktop";
import { isDesktopRuntime } from "@/app/utils";
import { t } from "@/i18n";
import {
  LayoutSectionItem,
  LayoutSectionItemDescription,
  LayoutSectionItemHeader,
  LayoutSectionItemHeaderActions,
  LayoutSectionItemTitle,
  LayoutStack,
} from "../settings-layout";

function formatCountdown(expiresAt: number) {
  const remaining = Math.max(0, expiresAt - Date.now());
  const totalSeconds = Math.floor(remaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function RemotePreviewView() {
  const [state, setState] = useState<LanPreviewState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const readState = useCallback(async () => {
    const bridge = window.__IPOLLOWORK_ELECTRON__?.lanPreview;
    if (!bridge?.getState) {
      setState(null);
      setLoading(false);
      return;
    }
    try {
      const next = await bridge.getState();
      setState(next);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    readState();
    const bridge = window.__IPOLLOWORK_ELECTRON__?.lanPreview;
    const unsubscribe = bridge?.onStateChanged?.((next) => setState(next));
    return () => unsubscribe?.();
  }, [readState]);

  const runAction = useCallback(async (action: () => Promise<LanPreviewState>) => {
    setBusy(true);
    try {
      const next = await action();
      setState(next);
    } finally {
      setBusy(false);
    }
  }, []);

  const toggleEnabled = useCallback(() => {
    const next = !state?.enabled;
    void runAction(() => {
      const setEnabled = window.__IPOLLOWORK_ELECTRON__?.lanPreview?.setEnabled;
      if (!setEnabled) return Promise.resolve(state ?? { enabled: false, port: 0, addresses: [], code: null, codeExpiresAt: 0, sessionCount: 0 });
      return setEnabled(next);
    });
  }, [runAction, state]);

  const regenerate = useCallback(() => {
    void runAction(async () => {
      const regenerateCode = window.__IPOLLOWORK_ELECTRON__?.lanPreview?.regenerateCode;
      if (!regenerateCode) return state ?? { enabled: false, port: 0, addresses: [], code: null, codeExpiresAt: 0, sessionCount: 0 };
      return regenerateCode();
    });
  }, [runAction, state]);

  const disconnectAll = useCallback(() => {
    void runAction(async () => {
      const disconnectAll = window.__IPOLLOWORK_ELECTRON__?.lanPreview?.disconnectAll;
      if (!disconnectAll) return state ?? { enabled: false, port: 0, addresses: [], code: null, codeExpiresAt: 0, sessionCount: 0 };
      return disconnectAll();
    });
  }, [runAction, state]);

  const copyText = useCallback((value: string) => {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(value);
      window.setTimeout(() => setCopied(null), 1500);
    });
  }, []);

  const countdown = state?.codeExpiresAt ? formatCountdown(state.codeExpiresAt) : "–";

  return (
    <LayoutStack>
      <Alert variant={state?.enabled ? "default" : "default"}>
        <MonitorSmartphone />
        <AlertTitle>{t("settings.remote_preview_alert_title")}</AlertTitle>
        <AlertDescription>{t("settings.remote_preview_alert_desc")}</AlertDescription>
      </Alert>

      {!isDesktopRuntime() && (
        <Alert>
          <ShieldAlert />
          <AlertTitle>{t("settings.remote_preview_desktop_title")}</AlertTitle>
          <AlertDescription>{t("settings.remote_preview_desktop_desc")}</AlertDescription>
        </Alert>
      )}

      <LayoutSectionItem>
        <LayoutSectionItemHeader>
          <LayoutSectionItemTitle>{t("settings.remote_preview_enable_title")}</LayoutSectionItemTitle>
          <LayoutSectionItemDescription>{t("settings.remote_preview_enable_desc")}</LayoutSectionItemDescription>
        </LayoutSectionItemHeader>
        <div className="mt-3 flex items-center gap-3">
          <Switch
            checked={state?.enabled === true}
            disabled={!isDesktopRuntime() || loading || busy}
            onCheckedChange={toggleEnabled}
            aria-label={t("settings.remote_preview_enable_title")}
          />
          {busy ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
        </div>
      </LayoutSectionItem>

      {state?.enabled ? (
        <>
          <LayoutSectionItem>
            <LayoutSectionItemHeader>
              <LayoutSectionItemTitle>{t("settings.remote_preview_address_title")}</LayoutSectionItemTitle>
              <LayoutSectionItemDescription>{t("settings.remote_preview_address_desc")}</LayoutSectionItemDescription>
            </LayoutSectionItemHeader>
            <div className="mt-3 space-y-2">
              {(state.addresses?.length ?? 0) > 0 ? (
                state.addresses.map((address) => {
                  const url = `http://${address}:${state.port}`;
                  return (
                    <div key={url} className="flex items-center gap-2">
                      <code className="flex-1 truncate rounded-md bg-muted px-2 py-1.5 font-mono text-sm">{url}</code>
                      <Button variant="outline" size="sm" onClick={() => copyText(url)}>
                        {copied === url ? "已复制" : <><Copy className="size-3.5" /> 复制</>}
                      </Button>
                    </div>
                  );
                })
              ) : (
                <p className="text-sm text-muted-foreground">{t("settings.remote_preview_no_address")}</p>
              )}
            </div>
          </LayoutSectionItem>

          <LayoutSectionItem>
            <LayoutSectionItemHeader>
              <LayoutSectionItemTitle>{t("settings.remote_preview_code_title")}</LayoutSectionItemTitle>
              <LayoutSectionItemDescription>
                {t("settings.remote_preview_code_desc")}（{countdown}）
              </LayoutSectionItemDescription>
              <LayoutSectionItemHeaderActions>
                <Button variant="outline" size="sm" onClick={regenerate} disabled={busy}>
                  <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
                  {t("settings.remote_preview_regenerate")}
                </Button>
              </LayoutSectionItemHeaderActions>
            </LayoutSectionItemHeader>
            <div className="mt-3">
              <div className="inline-flex items-center gap-3 rounded-xl border border-border bg-background px-6 py-4">
                <span className="font-mono text-3xl font-bold tracking-[0.4em] text-foreground">
                  {state.code ?? "------"}
                </span>
                <Button variant="ghost" size="icon-sm" aria-label="Copy pair code" onClick={() => state.code && copyText(state.code)}>
                  <Copy className="size-4" />
                </Button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {t("settings.remote_preview_code_hint")}
              </p>
            </div>
          </LayoutSectionItem>

          <LayoutSectionItem>
            <LayoutSectionItemHeader>
              <LayoutSectionItemTitle>{t("settings.remote_preview_sessions_title")}</LayoutSectionItemTitle>
              <LayoutSectionItemDescription>
                {state.sessionCount > 0
                  ? `${t("settings.remote_preview_sessions_connected")}（${state.sessionCount}）`
                  : t("settings.remote_preview_sessions_none")}
              </LayoutSectionItemDescription>
            </LayoutSectionItemHeader>
            <div className="mt-3">
              <Button variant="destructive" size="sm" onClick={disconnectAll} disabled={busy || state.sessionCount === 0}>
                {t("settings.remote_preview_disconnect_all")}
              </Button>
            </div>
          </LayoutSectionItem>
        </>
      ) : null}

      {state?.error ? (
        <Alert variant="destructive">
          <ShieldAlert />
          <AlertTitle>{t("settings.remote_preview_error_title")}</AlertTitle>
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
    </LayoutStack>
  );
}
