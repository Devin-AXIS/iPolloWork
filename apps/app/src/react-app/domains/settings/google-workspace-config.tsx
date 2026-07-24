/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { CalendarDays, CheckCircle2, FileText, Loader2, MailPlus, ShieldCheck, XCircle } from "lucide-react";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import type { GoogleWorkspaceAuthStatus, iPolloWorkServerClient } from "../../../app/lib/ipollowork-server";
import { usePlatform } from "../../kernel/platform";
import type { ExtensionConfigContext } from "./extension-registry";
import { registerExtensionRuntime } from "./extension-registry";

type BusyAction = "status" | "connect" | "disconnect" | "set-active" | "test" | "smoke-test" | "save-secret";
type OptionalFeature = "gmailRead" | "driveFull" | "calendarWrite" | "chat";

const OPTIONAL_FEATURES: OptionalFeature[] = ["gmailRead", "driveFull", "calendarWrite", "chat"];
const optionalFeatureCopy = (feature: OptionalFeature) => ({
  gmailRead: {
    label: t("settings.integration.google.gmail_read"),
    description: t("settings.integration.google.gmail_read_description"),
  },
  driveFull: {
    label: t("settings.integration.google.drive_full"),
    description: t("settings.integration.google.drive_full_description"),
  },
  calendarWrite: {
    label: t("settings.integration.google.calendar_write"),
    description: t("settings.integration.google.calendar_write_description"),
  },
  chat: {
    label: t("settings.integration.google.chat"),
    description: t("settings.integration.google.chat_description"),
  },
})[feature];
type GoogleWorkspaceCommand = () => Promise<unknown>;
const DESKTOP_ACTION_TIMEOUT_MS = 6 * 60 * 1000;
const CONNECT_POLL_INTERVAL_MS = 1_000;
// Must match GOOGLE_WORKSPACE_DESKTOP_CLIENT_ID in apps/server/src/extensions/google-workspace.ts.
const IPOLLOWORK_BUILTIN_GOOGLE_CLIENT_ID = "929071212606-pmkqimjhm2tnp68kbklnout0irllj99h.apps.googleusercontent.com";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function normalizeGoogleWorkspaceAccount(value: unknown): GoogleWorkspaceAuthStatus["account"] {
  if (!isRecord(value)) return null;
  return {
    accountId: typeof value.accountId === "string" ? value.accountId : null,
    email: typeof value.email === "string" ? value.email : null,
    name: typeof value.name === "string" ? value.name : null,
    picture: typeof value.picture === "string" ? value.picture : null,
    sub: typeof value.sub === "string" ? value.sub : null,
    scopes: normalizeStringList(value.scopes),
    connectedAt: typeof value.connectedAt === "string" ? value.connectedAt : null,
  };
}

function normalizeGoogleWorkspaceAccounts(value: unknown): GoogleWorkspaceAuthStatus["accounts"] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeGoogleWorkspaceAccount).filter((item): item is NonNullable<GoogleWorkspaceAuthStatus["account"]> => item !== null);
}

function normalizeGoogleWorkspaceSmokeTest(value: unknown): GoogleWorkspaceAuthStatus["smokeTest"] {
  if (!isRecord(value)) return null;
  return {
    driveFileId: typeof value.driveFileId === "string" ? value.driveFileId : null,
    driveFileName: typeof value.driveFileName === "string" ? value.driveFileName : null,
    gmailDraftId: typeof value.gmailDraftId === "string" ? value.gmailDraftId : null,
  };
}

function normalizeGoogleWorkspaceAuthStatus(value: unknown): GoogleWorkspaceAuthStatus {
  const record = isRecord(value) ? value : {};
  const vault = record.vault === "encrypted" || record.vault === "plaintext-dev" ? record.vault : "unavailable";
  return {
    configured: record.configured === true,
    missing: normalizeStringList(record.missing),
    customClient: record.customClient === true,
    vault,
    connected: record.connected === true,
    account: normalizeGoogleWorkspaceAccount(record.account),
    accounts: normalizeGoogleWorkspaceAccounts(record.accounts),
    activeAccountId: typeof record.activeAccountId === "string" ? record.activeAccountId : null,
    scopes: normalizeStringList(record.scopes),
    connectedAt: typeof record.connectedAt === "string" ? record.connectedAt : null,
    error: typeof record.error === "string" ? record.error : null,
    testStatus: typeof record.testStatus === "string" ? record.testStatus : null,
    smokeTest: normalizeGoogleWorkspaceSmokeTest(record.smokeTest),
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitForGoogleWorkspaceConnection(client: iPolloWorkServerClient, flowId: string, expiresAt: number) {
  while (Date.now() < expiresAt + 5_000) {
    const result = await client.googleWorkspaceConnectStatus(flowId);
    if (result.status === "connected" && result.googleWorkspace) return result.googleWorkspace;
    if (result.status === "failed" || result.status === "expired") {
      throw new Error(result.error ?? "Google Workspace connection did not complete.");
    }
    await sleep(CONNECT_POLL_INTERVAL_MS);
  }
  throw new Error("Google Workspace OAuth timed out.");
}

function GoogleWorkspaceConfig({ ipolloworkServerClient, hostiPolloWorkServerClient, onExtensionConnectionChange, restartLocalServer }: ExtensionConfigContext) {
  const platform = usePlatform();
  const [status, setStatus] = useState<GoogleWorkspaceAuthStatus | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState("");
  const [customClientId, setCustomClientId] = useState("");
  const [customClientSecret, setCustomClientSecret] = useState("");
  const [optionalFeatures, setOptionalFeatures] = useState<Record<OptionalFeature, boolean>>({ gmailRead: false, driveFull: false, calendarWrite: false, chat: false });
  const serverAvailable = Boolean(ipolloworkServerClient);
  const hostServerAvailable = Boolean(hostiPolloWorkServerClient);
  const canConnect = serverAvailable && status?.configured === true && status.vault !== "unavailable";
  const canTest = serverAvailable && status?.connected === true;

  const loadStatus = async (options: { clearError?: boolean } = {}) => {
    if (!ipolloworkServerClient) return;
    setBusyAction("status");
    if (options.clearError !== false) setError(null);
    try {
      const result = normalizeGoogleWorkspaceAuthStatus(await ipolloworkServerClient.googleWorkspaceStatus());
      setStatus(result);
      onExtensionConnectionChange?.("google-workspace", result.connected);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read Google Workspace status.");
    } finally {
      setBusyAction(null);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, [ipolloworkServerClient]);

  const runDesktopAction = async (action: Exclude<BusyAction, "status">, command: GoogleWorkspaceCommand) => {
    if (!ipolloworkServerClient) return;
    setBusyAction(action);
    setError(null);
    try {
      const result = await Promise.race([
        command(),
        new Promise<never>((_, reject) => {
          window.setTimeout(() => reject(new Error("Google Workspace connection is taking too long. Try again, or restart iPolloWork if the browser already said authorization was received.")), DESKTOP_ACTION_TIMEOUT_MS);
        }),
      ]);
      const next = normalizeGoogleWorkspaceAuthStatus(result);
      setStatus(next);
      onExtensionConnectionChange?.("google-workspace", next.connected);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Google Workspace ${action} failed.`);
      await loadStatus({ clearError: false });
    } finally {
      setBusyAction(null);
    }
  };

  const connectGoogleWorkspace = async () => {
    if (!ipolloworkServerClient) return null;
    const features = status?.customClient === true ? OPTIONAL_FEATURES.filter((feature) => optionalFeatures[feature]) : [];
    const flow = await ipolloworkServerClient.googleWorkspaceConnectStart({ features });
    platform.openLink(flow.authUrl);
    return waitForGoogleWorkspaceConnection(ipolloworkServerClient, flow.flowId, flow.expiresAt);
  };

  const saveOauthEnv = async (entries: { key: string; value: string }[], onSaved: () => void) => {
    if (!hostiPolloWorkServerClient) {
      setError("Google OAuth settings can only be saved from the local desktop app.");
      return;
    }
    setBusyAction("save-secret");
    setError(null);
    try {
      await hostiPolloWorkServerClient.upsertUserEnv(entries);
      await hostiPolloWorkServerClient.setUserEnvPendingChanges(true);
      onSaved();
      if (restartLocalServer) {
        const restarted = await restartLocalServer();
        if (!restarted) setError("Saved Google OAuth settings. Restart iPolloWork to apply them.");
      } else {
        setError("Saved Google OAuth settings. Restart iPolloWork to apply them.");
      }
      await loadStatus({ clearError: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save Google OAuth settings.");
    } finally {
      setBusyAction(null);
    }
  };

  const saveGoogleClientSecret = async () => {
    const value = clientSecret.trim();
    if (!value) {
      setError("Enter the client secret from your Google OAuth desktop client.");
      return;
    }
    await saveOauthEnv([{ key: "GOOGLE_WORKSPACE_OAUTH_CLIENT_SECRET", value }], () => setClientSecret(""));
  };

  const saveCustomOauthClient = async () => {
    const id = customClientId.trim();
    const secret = customClientSecret.trim();
    if (!id || !secret) {
      setError("Enter both the client ID and client secret from your own Google OAuth desktop client.");
      return;
    }
    if (id === IPOLLOWORK_BUILTIN_GOOGLE_CLIENT_ID) {
      setError("That is the built-in iPolloWork client ID, which cannot unlock Gmail read access. Create your own OAuth client in Google Cloud Console (APIs & Services > Credentials > Create OAuth client ID > Desktop app) and paste its client ID here.");
      return;
    }
    await saveOauthEnv(
      [
        { key: "GOOGLE_WORKSPACE_OAUTH_CLIENT_ID", value: id },
        { key: "GOOGLE_WORKSPACE_OAUTH_CLIENT_SECRET", value: secret },
      ],
      () => {
        setCustomClientId("");
        setCustomClientSecret("");
      },
    );
  };

  const connectedAccounts = status?.accounts.length ? status.accounts : status?.account ? [status.account] : [];

  return (
    <div className="space-y-4">
      {!serverAvailable ? (
        <Alert variant="warning">
          <ShieldCheck />
          <AlertTitle>{t("settings.integration.google.server_required_title")}</AlertTitle>
          <AlertDescription>{t("settings.integration.google.server_required_description")}</AlertDescription>
        </Alert>
      ) : null}

      {status?.connected ? (
        <Alert>
          <CheckCircle2 />
          <AlertTitle>{t("settings.integration.google.connected_title")}</AlertTitle>
          <AlertDescription>
            {connectedAccounts.length === 1 && connectedAccounts[0]?.email
              ? t("settings.integration.google.signed_in_as", { email: connectedAccounts[0].email })
              : t("settings.integration.google.accounts_connected", { count: connectedAccounts.length })}
            {status.testStatus ? ` ${status.testStatus}` : ""}
          </AlertDescription>
        </Alert>
      ) : (
        <Alert variant="warning">
          <ShieldCheck />
          <AlertTitle>{t("settings.integration.google.connect_title")}</AlertTitle>
          <AlertDescription>
            {t("settings.integration.google.connect_description")}
          </AlertDescription>
        </Alert>
      )}

      {status && !status.configured ? (
        <Alert variant="warning">
          <XCircle />
          <AlertTitle>{t("settings.integration.google.oauth_unconfigured_title")}</AlertTitle>
          <AlertDescription>{t("settings.integration.google.oauth_unconfigured_description")}</AlertDescription>
        </Alert>
      ) : null}

      {status && !status.configured ? (
        <Card variant="outline" size="sm">
          <CardHeader>
            <CardTitle>{t("settings.integration.google.setup_title")}</CardTitle>
            <CardDescription>
              {t("settings.integration.google.setup_description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              type="password"
              value={clientSecret}
              onChange={(event) => setClientSecret(event.target.value)}
              placeholder={t("settings.integration.google.client_secret_placeholder")}
              autoComplete="off"
            />
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("settings.integration.google.secret_saved_hint")}
            </p>
          </CardContent>
          <CardFooter>
            <Button disabled={busyAction === "save-secret" || !clientSecret.trim() || !hostServerAvailable} onClick={() => void saveGoogleClientSecret()}>
              {busyAction === "save-secret" ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("settings.integration.google.save_and_apply")}
            </Button>
          </CardFooter>
        </Card>
      ) : null}

      {status?.vault === "unavailable" ? (
        <Alert variant="destructive">
          <XCircle />
          <AlertTitle>{t("settings.integration.google.vault_unavailable_title")}</AlertTitle>
          <AlertDescription>{t("settings.integration.google.vault_unavailable_description")}</AlertDescription>
        </Alert>
      ) : null}

      {error || status?.error ? (
        <Alert variant="destructive">
          <XCircle />
          <AlertTitle>{t("settings.integration.google.error_title")}</AlertTitle>
          <AlertDescription>{error ?? status?.error}</AlertDescription>
        </Alert>
      ) : null}

      {status?.smokeTest ? (
        <Alert>
          <CheckCircle2 />
          <AlertTitle>{t("settings.integration.google.diagnostic_complete_title")}</AlertTitle>
          <AlertDescription>{t("settings.integration.google.diagnostic_complete_description")}</AlertDescription>
        </Alert>
      ) : null}

      <Card variant="outline" size="sm">
        <CardHeader>
          <CardTitle>{t("settings.integration.google.capabilities_title")}</CardTitle>
          <CardDescription>
            {t("settings.integration.google.capabilities_description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-border bg-card p-3">
            <CalendarDays className="mb-2 size-4 text-blue-11" />
            <div className="text-sm font-medium text-card-foreground">{t("settings.integration.google.calendar_read")}</div>
            <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("settings.integration.google.calendar_read_description")}</div>
          </div>
          <div className="rounded-2xl border border-border bg-card p-3">
            <MailPlus className="mb-2 size-4 text-red-11" />
            <div className="text-sm font-medium text-card-foreground">{t("settings.integration.google.gmail_drafts")}</div>
            <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("settings.integration.google.gmail_drafts_description")}</div>
          </div>
          <div className="rounded-2xl border border-border bg-card p-3">
            <FileText className="mb-2 size-4 text-green-11" />
            <div className="text-sm font-medium text-card-foreground">{t("settings.integration.google.selected_drive_files")}</div>
            <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("settings.integration.google.selected_drive_files_description")}</div>
          </div>
        </CardContent>
      </Card>

      <Card variant="outline" size="sm">
        {connectedAccounts.length > 0 ? (
          <CardContent className="space-y-2 pt-6">
            {connectedAccounts.map((account) => (
              <div key={account.accountId ?? account.email ?? account.sub ?? "google-account"} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-card-foreground">{account.email ?? account.name ?? t("settings.integration.google.account_fallback")}</div>
                  <div className="text-xs text-muted-foreground">{account.accountId === status?.activeAccountId ? t("settings.integration.google.default_account") : t("status.connected")}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {account.accountId && account.accountId !== status?.activeAccountId ? (
                    <Button variant="outline" size="sm" disabled={Boolean(busyAction)} onClick={() => {
                      const accountId = account.accountId;
                      if (!accountId) return;
                      void runDesktopAction("set-active", () => ipolloworkServerClient?.googleWorkspaceSetActiveAccount(accountId) ?? Promise.resolve(null));
                    }}>
                      {busyAction === "set-active" ? <Loader2 className="size-4 animate-spin" /> : null}
                      {t("settings.integration.google.make_default")}
                    </Button>
                  ) : null}
                  <Button variant="destructive" size="sm" disabled={Boolean(busyAction)} onClick={() => void runDesktopAction("disconnect", () => ipolloworkServerClient?.googleWorkspaceDisconnect(account.accountId) ?? Promise.resolve(null))}>
                    {t("settings.integration.google.disconnect")}
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        ) : null}
        <CardFooter className="flex-wrap gap-2 justify-between">
          <div className="flex flex-wrap gap-2">
            <Button disabled={Boolean(busyAction) || !canConnect} onClick={() => void runDesktopAction("connect", connectGoogleWorkspace)}>
              {busyAction === "connect" ? <Loader2 className="size-4 animate-spin" /> : null}
              {status?.connected ? t("settings.integration.google.add_account") : t("settings.integration.google.connect_action")}
            </Button>
            {connectedAccounts.length > 1 ? (
              <Button variant="destructive" disabled={Boolean(busyAction)} onClick={() => void runDesktopAction("disconnect", () => ipolloworkServerClient?.googleWorkspaceDisconnect() ?? Promise.resolve(null))}>
                {busyAction === "disconnect" ? <Loader2 className="size-4 animate-spin" /> : null}
                {t("settings.integration.google.disconnect_all")}
              </Button>
            ) : null}
            <Button variant="outline" disabled={Boolean(busyAction) || !canTest} onClick={() => void runDesktopAction("test", () => ipolloworkServerClient?.googleWorkspaceTestConnection() ?? Promise.resolve(null))}>
              {busyAction === "test" ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("config.test_connection")}
            </Button>
            <Button variant="outline" disabled={Boolean(busyAction) || !canTest} onClick={() => void runDesktopAction("smoke-test", () => ipolloworkServerClient?.googleWorkspaceRunScopeSmokeTest() ?? Promise.resolve(null))}>
              {busyAction === "smoke-test" ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("settings.integration.google.run_diagnostic")}
            </Button>
          </div>
        </CardFooter>
      </Card>

      <Accordion>
        <AccordionItem value="advanced">
          <AccordionTrigger>{t("settings.integration.google.advanced")}</AccordionTrigger>
          <AccordionContent className="space-y-4">
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("settings.integration.google.advanced_description")}
            </p>
            {status?.customClient ? (
              <Alert>
                <CheckCircle2 />
                <AlertTitle>{t("settings.integration.google.custom_client_title")}</AlertTitle>
                <AlertDescription>{t("settings.integration.google.custom_client_description")}</AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-3">
                <Input
                  value={customClientId}
                  onChange={(event) => setCustomClientId(event.target.value)}
                  placeholder={t("settings.integration.google.client_id_placeholder")}
                  autoComplete="off"
                />
                <Input
                  type="password"
                  value={customClientSecret}
                  onChange={(event) => setCustomClientSecret(event.target.value)}
                  placeholder={t("settings.integration.google.client_secret_placeholder")}
                  autoComplete="off"
                />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {t("settings.integration.google.custom_client_hint")}
                </p>
                <Button disabled={busyAction === "save-secret" || !customClientId.trim() || !customClientSecret.trim() || !hostServerAvailable} onClick={() => void saveCustomOauthClient()}>
                  {busyAction === "save-secret" ? <Loader2 className="size-4 animate-spin" /> : null}
                  {t("settings.integration.google.save_and_apply")}
                </Button>
              </div>
            )}
            <div className="space-y-3">
              <p className="text-xs leading-relaxed text-muted-foreground">
                {status?.customClient
                  ? t("settings.integration.google.permissions_enabled_hint")
                  : t("settings.integration.google.permissions_disabled_hint")}
              </p>
              {OPTIONAL_FEATURES.map((feature) => {
                const copy = optionalFeatureCopy(feature);
                return (
                <label key={feature} className="flex items-start gap-2.5">
                  <Checkbox
                    checked={optionalFeatures[feature]}
                    onCheckedChange={(checked) => setOptionalFeatures((current) => ({ ...current, [feature]: checked === true }))}
                    disabled={Boolean(busyAction) || status?.customClient !== true}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-card-foreground">{copy.label}</span>
                    <span className="block text-xs leading-relaxed text-muted-foreground">{copy.description}</span>
                  </span>
                </label>
                );
              })}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

registerExtensionRuntime({
  id: "google-workspace",
  settingsPanelRefs: ["ipollowork.googleWorkspace.settings"],
  settingsPanel: (ctx) => <GoogleWorkspaceConfig {...ctx} />,
  isConnected: (_entry, ctx) => ctx.extensionConnections?.["google-workspace"] === true,
});
