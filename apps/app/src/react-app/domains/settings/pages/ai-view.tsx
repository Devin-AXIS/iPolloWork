/** @jsxImportSource react */
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardIcon, CardTitle, CardDescription, CardMeta } from "@/components/ui/card";
import { toast } from "@/components/ui/sonner";
import { useState, type ReactNode } from "react";
import { ArrowRight, CheckCircle2, KeyRound, X } from "lucide-react";

import { t } from "@/i18n";
import { ProviderIcon } from "../../../design-system/provider-icon";
import { ConfirmModal } from "../../../design-system/modals/confirm-modal";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { SettingsNotice } from "../settings-section";
import {
  LayoutSection,
  LayoutSectionItem,
  LayoutSectionItemFootnote,
  LayoutSectionItemHeader,
  LayoutSectionItemHeaderActions,
  LayoutSectionItemTitle,
  LayoutStack,
} from "../settings-layout";

type ConnectedProvider = {
  id: string;
  name: string;
  displayId?: string;
  source?: "env" | "api" | "config" | "custom" | "engine";
};

export type AiSettingsViewProps = {
  busy: boolean;
  providerAuthBusy: boolean;
  providerStatusLabel: string;
  providerStatusStyle: string;
  providerSummary: string;
  connectedProviders: ConnectedProvider[];
  disconnectingProviderId: string | null;
  providerConnectError: string | null;
  providerDisconnectStatus: string | null;
  providerDisconnectError: string | null;
  onOpenProviderAuth: (preferredProviderId?: string) => void | Promise<void>;
  onDisconnectProvider: (providerId: string) => void | Promise<string | void>;
  canDisconnectProvider: (source?: ConnectedProvider["source"]) => boolean;
  /** Set of local provider IDs that were imported from cloud. */
  cloudProviderIds?: Set<string>;
  showiPolloWorkModelsSubscribe?: boolean;
  /** Subtle fallback row when iPolloWork Models is not connected and the banner was dismissed. */
  showiPolloWorkModelsConnect?: boolean;
  onSubscribeiPolloWorkModels?: () => void | Promise<void>;
  onDismissiPolloWorkModels?: () => void | Promise<void>;
  cloudProvidersView?: ReactNode;
};

function providerSourceLabel(source?: ConnectedProvider["source"]) {
  if (source === "env") return t("settings.provider_source_env");
  if (source === "api") return t("providers.api_key_label");
  if (source === "config") return t("settings.provider_source_config");
  if (source === "custom") return t("settings.provider_source_custom");
  return null;
}


export function AiSettingsView(props: AiSettingsViewProps) {
  const [disconnectTarget, setDisconnectTarget] = useState<ConnectedProvider | null>(null);
  const [localDisconnectingProviderId, setLocalDisconnectingProviderId] = useState<string | null>(null);
  const disconnectingProviderId = localDisconnectingProviderId ?? props.disconnectingProviderId;

  const confirmDisconnect = async () => {
    const target = disconnectTarget;
    if (!target || disconnectingProviderId !== null) return;

    setDisconnectTarget(null);
    setLocalDisconnectingProviderId(target.id);
    try {
      const message = await props.onDisconnectProvider(target.id);
      toast.success(message?.trim() || `${t("providers.disconnected_prefix")} ${target.name}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("providers.disconnect_failed"));
    } finally {
      setLocalDisconnectingProviderId(null);
    }
  };

  return (
    <div data-testid="ai-providers">
      <LayoutStack>
      {/* ---- Providers ---- */}
      <LayoutSection>
        <LayoutSectionItem>
          <LayoutSectionItemHeader>
            <LayoutSectionItemTitle>
              {t("status.providers_connected", { count: props.connectedProviders.length })}
            </LayoutSectionItemTitle>
            <LayoutSectionItemHeaderActions>
              <Button
                onClick={() => void props.onOpenProviderAuth()}
                disabled={props.providerAuthBusy}
              >
                {props.providerAuthBusy
                  ? t("settings.loading_providers")
                  : t("settings.connect_provider")}
              </Button>
            </LayoutSectionItemHeaderActions>
          </LayoutSectionItemHeader>
        </LayoutSectionItem>

        {props.showiPolloWorkModelsSubscribe ? (
          <LayoutSectionItem className="relative overflow-hidden rounded-2xl border border-blue-6 bg-blue-2/30 px-4 py-4">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute right-3 top-3 text-blue-11 hover:bg-blue-3/70"
              onClick={() => void props.onDismissiPolloWorkModels?.()}
              aria-label={t("settings.ai.dismiss_models_banner")}
            >
              <X className="size-3.5" />
            </Button>
            <div className="flex flex-col gap-4 pr-8 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 gap-3">
                <ProviderIcon providerId="ipollowork" size={22} className="mt-0.5 shrink-0 text-blue-11" />
                <div className="min-w-0 space-y-2">
                  <div>
                    <div className="text-sm font-medium text-dls-text">iPolloWork Models</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {t("settings.ai.models_subscribe_description")}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 text-[11px] text-blue-11">
                    <span className="inline-flex items-center gap-1 rounded-full border border-blue-6 bg-blue-3 px-2 py-0.5">
                      <CheckCircle2 className="size-3" /> {t("settings.ai.managed_by_cloud")}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full border border-blue-6 bg-blue-3 px-2 py-0.5">
                      <KeyRound className="size-3" /> {t("settings.ai.no_api_key_setup")}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("settings.ai.models_pricing_description")}
                  </p>
                </div>
              </div>
              <Button
                className="shrink-0"
                onClick={() => void props.onSubscribeiPolloWorkModels?.()}
                disabled={props.busy || props.providerAuthBusy}
              >
                {t("settings.ai.subscribe")}
                <ArrowRight className="ml-1.5 size-3.5" />
              </Button>
            </div>
          </LayoutSectionItem>
        ) : null}

        {props.connectedProviders.length > 0 ? (
          <div data-testid="connected-provider-list" className="space-y-2">
            {props.connectedProviders.map((provider) => (
              <Card variant="resource" key={provider.id} data-testid="connected-provider-row" data-provider-id={provider.id} className="h-[72px] min-w-0 flex-row items-center justify-between">
                <CardHeader className="min-w-0 flex-1 items-center">
                  <CardIcon><ProviderIcon
                    providerId={provider.id}
                    providerName={provider.name}
                    size={20}
                    className="shrink-0 text-dls-text"
                  /></CardIcon>
                  <div className="min-w-0 flex-1">
                    <CardTitle title={provider.displayId ?? provider.id} className="truncate">{provider.name}</CardTitle>
                    <CardMeta className="mt-1 truncate">
                      {props.cloudProviderIds?.has(provider.id) ? "Cloud" : providerSourceLabel(provider.source) ?? t("status.connected")}
                    </CardMeta>
                  </div>
                </CardHeader>
                <div className="flex w-24 shrink-0 justify-end">
                  {!props.cloudProviderIds?.has(provider.id) && provider.id !== "opencode" ? (
                    <Button data-testid="provider-disconnect" variant="ghost" size="sm" className="text-destructive hover:text-destructive" title={!props.canDisconnectProvider(provider.source) ? t("settings.managed_by_env") : undefined} onClick={() => setDisconnectTarget(provider)} disabled={props.busy || props.providerAuthBusy || disconnectingProviderId !== null || !props.canDisconnectProvider(provider.source)}>
                      {disconnectingProviderId === provider.id ? t("settings.disconnecting") : t("settings.disconnect")}
                    </Button>
                  ) : null}
                </div>
              </Card>
            ))}
          </div>
        ) : <Empty variant="ghost" className="py-6"><EmptyDescription>{t("settings.no_providers_connected")}</EmptyDescription></Empty>}

        {props.showiPolloWorkModelsConnect ? (
          <Card variant="resource" className="flex-row flex-wrap items-center justify-between">
            <CardHeader className="min-w-0 flex-1 items-center">
              <CardIcon><ProviderIcon providerId="ipollowork" size={20} className="text-muted-foreground" /></CardIcon>
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <CardTitle className="truncate">iPolloWork Models</CardTitle>
                  <span className="shrink-0 rounded-full border border-dls-border bg-dls-sidebar/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {t("settings.ai.not_connected")}
                  </span>
                </div>
                <CardDescription className="truncate">{t("settings.ai.models_connect_description")}</CardDescription>
              </div>
            </CardHeader>
            <Button
              variant="outline"
              onClick={() => void props.onSubscribeiPolloWorkModels?.()}
              disabled={props.busy || props.providerAuthBusy}
            >
              {t("connect.row_action_connect")}
              <ArrowRight className="ml-1.5 size-3.5" />
            </Button>
          </Card>
        ) : null}

        {props.providerConnectError ? (
          <SettingsNotice tone="error">{props.providerConnectError}</SettingsNotice>
        ) : null}
        {props.providerDisconnectStatus ? (
          <SettingsNotice>{props.providerDisconnectStatus}</SettingsNotice>
        ) : null}
        {props.providerDisconnectError ? (
          <SettingsNotice tone="error">{props.providerDisconnectError}</SettingsNotice>
        ) : null}

        <LayoutSectionItemFootnote className="text-ui-caption text-dls-secondary">{t("settings.api_keys_info")}</LayoutSectionItemFootnote>
      </LayoutSection>

      {props.cloudProvidersView}

      </LayoutStack>
      <ConfirmModal
        open={disconnectTarget !== null}
        title={t("providers.disconnect_confirm_title", { provider: disconnectTarget?.name ?? "" })}
        message={t("providers.disconnect_confirm_message")}
        confirmLabel={t("settings.disconnect")}
        cancelLabel={t("common.cancel")}
        variant="danger"
        onConfirm={() => void confirmDisconnect()}
        onCancel={() => setDisconnectTarget(null)}
      />
    </div>
  );
}
