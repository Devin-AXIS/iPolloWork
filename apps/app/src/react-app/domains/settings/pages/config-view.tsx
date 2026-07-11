/** @jsxImportSource react */
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { buildDiagnosticsBundleJson } from "../../../../app/lib/diagnostics-bundle";
import {
  buildiPolloWorkWorkspaceBaseUrl,
  parseiPolloWorkWorkspaceIdFromUrl,
  type iPolloWorkServerSettings,
  type iPolloWorkServerStatus,
} from "../../../../app/lib/ipollowork-server";
import type { iPolloWorkServerInfo } from "../../../../app/lib/desktop";
import { isDesktopRuntime } from "../../../../app/utils";
import { t } from "../../../../i18n";
import {
  ConfigDiagnosticsSection,
  ConfigEngineReloadSection,
  ConfigServerConnectionSection,
  ConfigServerSharingSection,
  ConfigWorkspaceSummary,
} from "./config-view-sections";
import { configLocalReducer, initialConfigLocalState } from "./config-view-state";

export type ConfigViewProps = {
  busy: boolean;
  clientConnected: boolean;
  anyActiveRuns: boolean;

  ipolloworkServerStatus: iPolloWorkServerStatus;
  ipolloworkServerUrl: string;
  ipolloworkServerSettings: iPolloWorkServerSettings;
  ipolloworkServerHostInfo: iPolloWorkServerInfo | null;
  runtimeWorkspaceId: string | null;

  updateiPolloWorkServerSettings: (next: iPolloWorkServerSettings) => void;
  resetiPolloWorkServerSettings: () => void;
  testiPolloWorkServerConnection: (
    next: iPolloWorkServerSettings,
  ) => Promise<boolean>;

  canReloadWorkspace: boolean;
  reloadWorkspaceEngine: () => Promise<void>;
  reloadBusy: boolean;

  developerMode: boolean;
};

export function ConfigView(props: ConfigViewProps) {
  const [localState, dispatchLocal] = useReducer(
    configLocalReducer,
    initialConfigLocalState,
  );
  const { ipolloworkConnection, tokenVisible, copyingField } = localState;
  const ipolloworkUrl = ipolloworkConnection.url;
  const ipolloworkToken = ipolloworkConnection.token;
  const ipolloworkTestState = ipolloworkConnection.testState;
  const ipolloworkTestMessage = ipolloworkConnection.testMessage;
  const copyTimeoutRef = useRef<number | undefined>(undefined);
  const [diagnosticsBundleJson, setDiagnosticsBundleJson] = useState("");

  useEffect(() => {
    dispatchLocal({
      type: "serverSettings",
      connection: {
        url: props.ipolloworkServerSettings.urlOverride ?? "",
        token: props.ipolloworkServerSettings.token ?? "",
        testState: "idle",
        testMessage: null,
      },
    });
  }, [props.ipolloworkServerSettings]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== undefined) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const ipolloworkStatusLabel = (() => {
    switch (props.ipolloworkServerStatus) {
      case "connected":
        return t("config.status_connected");
      case "limited":
        return t("config.status_limited");
      default:
        return t("config.status_not_connected");
    }
  })();

  const ipolloworkStatusStyle = (() => {
    switch (props.ipolloworkServerStatus) {
      case "connected":
        return "bg-green-7/10 text-green-11 border-green-7/20";
      case "limited":
        return "bg-amber-7/10 text-amber-11 border-amber-7/20";
      default:
        return "bg-gray-4/60 text-gray-11 border-gray-7/50";
    }
  })();

  const reloadAvailabilityReason = (() => {
    if (!props.clientConnected) return t("config.reload_connect_hint");
    if (!props.canReloadWorkspace) return t("config.reload_availability_hint");
    return null;
  })();

  const reloadButtonLabel = props.reloadBusy
    ? t("config.reloading")
    : t("config.reload_engine");
  const reloadButtonTone: "destructive" | "secondary" = props.anyActiveRuns
    ? "destructive"
    : "secondary";
  const reloadButtonDisabled =
    props.reloadBusy || Boolean(reloadAvailabilityReason);

  const buildiPolloWorkSettings = (): iPolloWorkServerSettings => ({
    ...props.ipolloworkServerSettings,
    urlOverride: ipolloworkUrl.trim() || undefined,
    token: ipolloworkToken.trim() || undefined,
  });

  const hasiPolloWorkChanges = (() => {
    const currentUrl = props.ipolloworkServerSettings.urlOverride ?? "";
    const currentToken = props.ipolloworkServerSettings.token ?? "";
    return (
      ipolloworkUrl.trim() !== currentUrl || ipolloworkToken.trim() !== currentToken
    );
  })();

  const resolvedWorkspaceId = (() => {
    const explicitId = props.runtimeWorkspaceId?.trim() ?? "";
    if (explicitId) return explicitId;
    return parseiPolloWorkWorkspaceIdFromUrl(ipolloworkUrl) ?? "";
  })();

  const resolvedWorkspaceUrl = (() => {
    const baseUrl = ipolloworkUrl.trim();
    if (!baseUrl) return "";
    return buildiPolloWorkWorkspaceBaseUrl(baseUrl, resolvedWorkspaceId) ?? baseUrl;
  })();

  const hostInfo = props.ipolloworkServerHostInfo;
  const hostRemoteAccessEnabled = hostInfo?.remoteAccessEnabled === true;
  const hostStatusLabel = !hostInfo?.running
    ? t("config.host_offline")
    : hostRemoteAccessEnabled
      ? t("config.host_remote_enabled")
      : t("config.host_local_only");
  const hostStatusStyle = !hostInfo?.running
    ? "bg-gray-4/60 text-gray-11 border-gray-7/50"
    : "bg-green-7/10 text-green-11 border-green-7/20";
  const hostConnectUrl =
    hostInfo?.connectUrl ??
    hostInfo?.mdnsUrl ??
    hostInfo?.lanUrl ??
    hostInfo?.baseUrl ??
    "";
  const hostConnectUrlUsesMdns = hostConnectUrl.includes(".local");

  const buildCurrentDiagnosticsBundle = useCallback(() => {
    return buildDiagnosticsBundleJson({
      anyActiveRuns: props.anyActiveRuns,
      canReloadWorkspace: props.canReloadWorkspace,
      clientConnected: props.clientConnected,
      developerMode: props.developerMode,
      hostConnectUrl,
      hostConnectUrlUsesMdns,
      hostInfo,
      ipolloworkServerStatus: props.ipolloworkServerStatus,
      ipolloworkServerUrl: props.ipolloworkServerUrl,
      runtimeWorkspaceId: props.runtimeWorkspaceId,
    });
  }, [
    hostConnectUrl,
    hostConnectUrlUsesMdns,
    hostInfo,
    props.anyActiveRuns,
    props.canReloadWorkspace,
    props.clientConnected,
    props.developerMode,
    props.ipolloworkServerSettings.hostToken,
    props.ipolloworkServerSettings.token,
    props.ipolloworkServerSettings.urlOverride,
    props.ipolloworkServerStatus,
    props.ipolloworkServerUrl,
    props.runtimeWorkspaceId,
  ]);

  useEffect(() => {
    let cancelled = false;
    void buildCurrentDiagnosticsBundle().then((json) => {
      if (!cancelled) {
        setDiagnosticsBundleJson(json);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [buildCurrentDiagnosticsBundle]);

  const handleCopy = async (value: string, field: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      dispatchLocal({ type: "copyingField", field });
      if (copyTimeoutRef.current !== undefined) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = window.setTimeout(() => {
        dispatchLocal({ type: "copyingField", field: null });
        copyTimeoutRef.current = undefined;
      }, 2000);
    } catch {
      // ignore
    }
  };

  const handleCopyDiagnostics = async (_value: string, field: string) => {
    const json = await buildCurrentDiagnosticsBundle();
    setDiagnosticsBundleJson(json);
    await handleCopy(json, field);
  };

  const handleTestConnection = async () => {
    if (ipolloworkTestState === "testing") return;
    const next = buildiPolloWorkSettings();
    props.updateiPolloWorkServerSettings(next);
    dispatchLocal({
      type: "testState",
      testState: "testing",
      testMessage: null,
    });
    try {
      const ok = await props.testiPolloWorkServerConnection(next);
      dispatchLocal({
        type: "testState",
        testState: ok ? "success" : "error",
        testMessage: ok
          ? t("config.connection_successful")
          : t("config.connection_failed"),
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t("config.connection_failed_check");
      dispatchLocal({
        type: "testState",
        testState: "error",
        testMessage: message,
      });
    }
  };

  return (
    <section className="space-y-6 max-w-3xl w-full">
      <ConfigWorkspaceSummary runtimeWorkspaceId={props.runtimeWorkspaceId} />
      <ConfigEngineReloadSection
        anyActiveRuns={props.anyActiveRuns}
        reloadBusy={props.reloadBusy}
        reloadAvailabilityReason={reloadAvailabilityReason}
        reloadButtonTone={reloadButtonTone}
        reloadButtonDisabled={reloadButtonDisabled}
        reloadButtonLabel={reloadButtonLabel}
        onReload={props.reloadWorkspaceEngine}
      />
      {props.developerMode ? (
        <ConfigDiagnosticsSection
          busy={props.busy}
          diagnosticsBundleJson={diagnosticsBundleJson}
          copyingField={copyingField}
          onCopy={handleCopyDiagnostics}
        />
      ) : null}
      {hostInfo ? (
        <ConfigServerSharingSection
          hostInfo={hostInfo}
          hostConnectUrl={hostConnectUrl}
          hostRemoteAccessEnabled={hostRemoteAccessEnabled}
          hostConnectUrlUsesMdns={hostConnectUrlUsesMdns}
          hostStatusLabel={hostStatusLabel}
          hostStatusStyle={hostStatusStyle}
          tokenVisible={tokenVisible}
          copyingField={copyingField}
          onCopy={handleCopy}
          onToggleToken={(key) => dispatchLocal({ type: "toggleToken", key })}
        />
      ) : null}
      <ConfigServerConnectionSection
        busy={props.busy}
        ipolloworkUrl={ipolloworkUrl}
        ipolloworkToken={ipolloworkToken}
        tokenVisible={tokenVisible.ipollowork}
        ipolloworkStatusLabel={ipolloworkStatusLabel}
        ipolloworkStatusStyle={ipolloworkStatusStyle}
        resolvedWorkspaceUrl={resolvedWorkspaceUrl}
        resolvedWorkspaceId={resolvedWorkspaceId}
        ipolloworkTestState={ipolloworkTestState}
        ipolloworkTestMessage={ipolloworkTestMessage}
        hasiPolloWorkChanges={hasiPolloWorkChanges}
        onUrlChange={(url) => dispatchLocal({ type: "url", url })}
        onTokenChange={(token) => dispatchLocal({ type: "token", token })}
        onToggleToken={() => dispatchLocal({ type: "toggleToken", key: "ipollowork" })}
        onTestConnection={handleTestConnection}
        onSave={() => props.updateiPolloWorkServerSettings(buildiPolloWorkSettings())}
        onReset={props.resetiPolloWorkServerSettings}
      />
      {!isDesktopRuntime() ? <div className="text-xs text-gray-9">{t("config.desktop_only_hint")}</div> : null}
    </section>
  );
}
