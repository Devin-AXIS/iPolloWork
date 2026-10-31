/** @jsxImportSource react */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AudioLines,
  CheckCircle2,
  Cloud,
  ChevronDown,
  FolderCog,
  Globe,
  Image,
  KeyRound,
  Loader2,
  PlugZap,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { openDesktopUrl } from "@/app/lib/desktop";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { publicAssetUrl } from "@/app/lib/public-asset";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardHeader, CardIcon, CardTitle, CardDescription, CardMeta, CardFooter } from "@/components/ui/card";
import type {
  iPolloWorkAuthorizationService,
  iPolloWorkAuthorizationServiceId,
  iPolloWorkAuthorizationServiceTestResult,
  iPolloWorkServerClient,
} from "@/app/lib/ipollowork-server";
import { t } from "@/i18n";
import { LayoutSection, LayoutSectionDescription, LayoutSectionHeader, LayoutSectionTitle, LayoutStack } from "@/react-app/domains/settings/settings-layout";
import { SettingsNotice, SettingsStatusBadge, Spinner } from "@/react-app/domains/settings/settings-section";
import { AuthorizationFormDialog } from "@/components/authorization-form-dialog";
type AuthorizationCenterViewProps = {
  client: iPolloWorkServerClient | null;
  isRemoteWorkspace: boolean;
  runtimeKey?: string | null;
  onOpenOpenAiLogin: () => void;
  providerAuthOpen: boolean;
};

type ServicePresentation = {
  icon: LucideIcon;
  logo?: string;
  titleKey: string;
  descriptionKey: string;
  fields: Array<{
    key: string;
    label: string;
    placeholder: string;
    secret?: boolean;
    required?: boolean;
    hintKey?: string;
    options?: Array<{ value: string; labelKey: string }>;
  }>;
};

// Local favicons: fal.ai, heygen.com, runninghub.ai, volcengine.com, aliyun.com, wasabi.com. OpenAI reuses the existing SVG.
const SERVICES: Record<iPolloWorkAuthorizationServiceId, ServicePresentation> = {
  "fal-images": {
    logo: "ext-fal.png",
    icon: Image,
    titleKey: "settings.authorization.service.fal_images.title",
    descriptionKey: "settings.authorization.service.fal_images.description",
    fields: [{ key: "FAL_KEY", label: "fal API key", placeholder: "Key ID:Key Secret", hintKey: "settings.authorization.fal_key_hint" }],
  },
  "minimax-images": {
    icon: Image,
    titleKey: "settings.authorization.service.minimax_images.title",
    descriptionKey: "settings.authorization.service.minimax_images.description",
    fields: [{ key: "MINIMAX_API_KEY", label: "MiniMax API key", placeholder: "Your MiniMax API key" }],
  },
  "openai-images": {
    logo: "ext-openai.svg",
    icon: Image,
    titleKey: "settings.authorization.service.openai_images.title",
    descriptionKey: "settings.authorization.service.openai_images.description",
    fields: [{ key: "OPENAI_API_KEY", label: "OpenAI API key", placeholder: "sk-..." }],
  },
  "aliyun-bailian": {
    logo: "ext-aliyun.png",
    icon: AudioLines,
    titleKey: "settings.authorization.service.aliyun_bailian.title",
    descriptionKey: "settings.authorization.service.aliyun_bailian.description",
    fields: [
      { key: "DASHSCOPE_API_KEY", label: "DashScope API key", placeholder: "sk-..." },
      { key: "DASHSCOPE_BASE_URL", label: "API base URL", placeholder: "https://dashscope.aliyuncs.com", secret: false, required: false },
    ],
  },
  "volcengine-video": {
    logo: "ext-volcengine.png",
    icon: Image,
    titleKey: "settings.authorization.service.volcengine_video.title",
    descriptionKey: "settings.authorization.service.volcengine_video.description",
    fields: [{ key: "ARK_API_KEY", label: "Ark API key", placeholder: "your Ark API key" }],
  },
  "runninghub-video": {
    logo: "ext-runninghub.ico",
    icon: AudioLines,
    titleKey: "settings.authorization.service.runninghub_video.title",
    descriptionKey: "settings.authorization.service.runninghub_video.description",
    fields: [{ key: "RUNNINGHUB_API_KEY", label: "RunningHub API key", placeholder: "Enterprise-Shared API key", hintKey: "settings.authorization.runninghub_key_hint" }],
  },
  "heygen-video": {
    logo: "ext-heygen.ico",
    icon: AudioLines,
    titleKey: "settings.authorization.service.heygen_video.title",
    descriptionKey: "settings.authorization.service.heygen_video.description",
    fields: [{ key: "HEYGEN_API_KEY", label: "HeyGen API key", placeholder: "HeyGen API key" }],
  },
  "aliyun-oss": {
    logo: "ext-aliyun.png",
    icon: Cloud,
    titleKey: "settings.authorization.service.aliyun_oss.title",
    descriptionKey: "settings.authorization.service.aliyun_oss.description",
    fields: [
      { key: "ALIYUN_OSS_ACCESS_KEY_ID", label: "AccessKey ID", placeholder: "LTAI..." },
      { key: "ALIYUN_OSS_ACCESS_KEY_SECRET", label: "AccessKey Secret", placeholder: "AccessKey Secret" },
      { key: "ALIYUN_OSS_BUCKET", label: "Bucket", placeholder: "my-bucket", secret: false },
      { key: "ALIYUN_OSS_REGION", label: "Region", placeholder: "cn-hangzhou", secret: false, hintKey: "settings.authorization.oss_region_hint" },
      { key: "ALIYUN_OSS_PUBLIC_BASE_URL", label: "Public URL", placeholder: "https://files.example.com", secret: false, hintKey: "settings.authorization.oss_public_url_hint" },
    ],
  },
  "wasabi": {
    logo: "ext-wasabi.ico",
    icon: Cloud,
    titleKey: "settings.authorization.service.wasabi.title",
    descriptionKey: "settings.authorization.service.wasabi.description",
    fields: [
      { key: "WASABI_ACCESS_KEY_ID", label: "Access key ID", placeholder: "Wasabi access key" },
      { key: "WASABI_SECRET_ACCESS_KEY", label: "Secret access key", placeholder: "Wasabi secret access key" },
      { key: "WASABI_BUCKET", label: "Bucket", placeholder: "my-wasabi-bucket", secret: false },
      { key: "WASABI_REGION", label: "Region", placeholder: "us-east-1", secret: false, hintKey: "settings.authorization.wasabi_region_hint" },
    ],
  },
  "storage-routing": {
    icon: FolderCog,
    titleKey: "settings.authorization.service.storage_routing.title",
    descriptionKey: "settings.authorization.service.storage_routing.description",
    fields: [
      {
        key: "STORAGE_DEFAULT_PROVIDER",
        label: "Default provider",
        placeholder: "Select a provider",
        secret: false,
        options: [
          { value: "auto", labelKey: "settings.authorization.option.auto" },
          { value: "aliyun-oss", labelKey: "settings.authorization.option.aliyun_oss" },
          { value: "wasabi", labelKey: "settings.authorization.option.wasabi" },
        ],
      },
    ],
  },
};

type EditorState = {
  service: iPolloWorkAuthorizationService;
  values: Record<string, string>;
  error: string | null;
};

function authorizationQueryKey(runtimeKey?: string | null) {
  return ["settings", "authorization-center", runtimeKey];
}

export function AuthorizationCenterView(props: AuthorizationCenterViewProps) {
  return <AuthorizationCenterContent {...props} />;
}

function AuthorizationCenterContent(props: AuthorizationCenterViewProps) {
  const canEdit = props.client !== null && !props.isRemoteWorkspace;
  const queryClient = useQueryClient();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [testResults, setTestResults] = useState<Record<string, iPolloWorkAuthorizationServiceTestResult>>({});
  const [heygenLoginExpiresAt, setHeygenLoginExpiresAt] = useState(0);

  const servicesQuery = useQuery({
    queryKey: authorizationQueryKey(props.runtimeKey),
    queryFn: async () => {
      if (!props.client || props.isRemoteWorkspace) return { items: [] };
      return props.client.listAuthorizationServices();
    },
    enabled: canEdit,
    refetchOnWindowFocus: true,
    refetchInterval: () => heygenLoginExpiresAt > Date.now() ? 2000 : false,
  });

  useEffect(() => {
    if (servicesQuery.data?.items.some(service => service.id === "heygen-video" && service.subscription?.connected)) setHeygenLoginExpiresAt(0);
  }, [servicesQuery.data]);

  useEffect(() => {
    if (!heygenLoginExpiresAt) return;
    const timer = setTimeout(() => setHeygenLoginExpiresAt(0), Math.max(0, heygenLoginExpiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [heygenLoginExpiresAt]);

  const heygenMutation = useMutation({
    mutationFn: async (action: "connect" | "disconnect" | "use-subscription" | "use-api-key") => {
      if (!props.client) throw new Error(t("app.unknown_error"));
      const result = await props.client.updateHeygenSubscription(action);
      if (result.authorizationUrl) {
        const url = new URL(result.authorizationUrl);
        if (url.protocol !== "https:" || !["api2.heygen.com", "app.heygen.com"].includes(url.hostname)) throw new Error(t("app.unknown_error"));
        await openDesktopUrl(result.authorizationUrl);
        setHeygenLoginExpiresAt(result.expiresAt ?? 0);
      } else setHeygenLoginExpiresAt(0);
    },
    onSuccess: async () => {
      setTestResults(current => ({ ...current, "heygen-video": { ok: true, detail: t("settings.authorization.heygen.updated") } }));
      await queryClient.invalidateQueries({ queryKey: authorizationQueryKey(props.runtimeKey) });
    },
    onError: async error => {
      setTestResults(current => ({ ...current, "heygen-video": { ok: false, detail: error.message } }));
      await queryClient.invalidateQueries({ queryKey: authorizationQueryKey(props.runtimeKey) });
    },
  });

  useEffect(() => {
    if (!canEdit) setEditor(null);
  }, [canEdit]);

  useEffect(() => {
    if (!props.providerAuthOpen && canEdit) {
      void queryClient.invalidateQueries({ queryKey: authorizationQueryKey(props.runtimeKey) });
    }
  }, [props.providerAuthOpen, props.runtimeKey, canEdit, queryClient]);

  const saveMutation = useMutation({
    mutationFn: async (draft: EditorState) => {
      if (!props.client) throw new Error(t("app.unknown_error"));
      const fields = SERVICES[draft.service.id].fields;
      const current = new Map(draft.service.fields.map((field) => [field.key, field.configured]));
      const missing = fields.find((field) => field.required !== false && !current.get(field.key) && !draft.values[field.key]?.trim());
      if (missing) {
        throw new Error(t("settings.authorization.validation_required", { field: missing.label }));
      }
      const values = Object.fromEntries(fields
        .map((field) => [field.key, draft.values[field.key]?.trim() ?? ""] as const)
        .filter(([, value]) => value.length > 0));
      if (Object.keys(values).length === 0) return;
      await props.client.saveAuthorizationService(draft.service.id, values);
    },
    onSuccess: async () => {
      setEditor(null);
      toast.success(t("settings.authorization.saved"));
      await queryClient.invalidateQueries({ queryKey: authorizationQueryKey(props.runtimeKey) });
    },
  });

  const testMutation = useMutation({
    mutationFn: async (serviceId: iPolloWorkAuthorizationServiceId) => {
      if (!props.client) throw new Error(t("app.unknown_error"));
      return props.client.testAuthorizationService(serviceId);
    },
    onSuccess: (result, serviceId) => {
      setTestResults((current) => ({ ...current, [serviceId]: result }));
    },
    onError: (error, serviceId) => {
      setTestResults((current) => ({
        ...current,
        [serviceId]: { ok: false, detail: error.message },
      }));
    },
  });

  const services = useMemo(
    () => servicesQuery.data?.items ?? [],
    [servicesQuery.data?.items],
  );

  const openEditor = (service: iPolloWorkAuthorizationService) => {
    if (!canEdit) return;
    setEditor({ service, values: {}, error: null });
  };

  return (
    <LayoutStack>
      <LayoutSection>
        <LayoutSectionHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <LayoutSectionTitle>
                <KeyRound className="size-4 text-muted-foreground" />
                {t("settings.authorization.title")}
              </LayoutSectionTitle>
              <LayoutSectionDescription className="mt-1 max-w-[60ch]">
                {t("settings.authorization.description")}
              </LayoutSectionDescription>
            </div>
          </div>
        </LayoutSectionHeader>

        {props.isRemoteWorkspace ? (
          <SettingsNotice>{t("settings.authorization.remote_workspace_hint")}</SettingsNotice>
        ) : null}
        {servicesQuery.error ? <SettingsNotice tone="error">{servicesQuery.error.message}</SettingsNotice> : null}

        {servicesQuery.isLoading ? (
          <div className="flex min-h-40 items-center justify-center rounded-xl border border-dls-border">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid items-start gap-3 @md/settings:grid-cols-2">
            {services.map((service) => (
              <AuthorizationServiceCard
                key={service.id}
                service={service}
                canEdit={canEdit}
                testResult={testResults[service.id]}
                testing={testMutation.isPending && testMutation.variables === service.id}
                onConfigure={() => openEditor(service)}
                onTest={() => testMutation.mutate(service.id)}
                onOpenBrowserLogin={service.id === "openai-images" ? props.onOpenOpenAiLogin : undefined}
                onHeygenAction={service.id === "heygen-video" ? action => heygenMutation.mutate(action) : undefined}
                heygenBusy={heygenMutation.isPending}
                heygenWaiting={heygenLoginExpiresAt > Date.now()}
              />
            ))}
          </div>
        )}
      </LayoutSection>

      {editor ? (
        <AuthorizationEditor
          editor={editor}
          saving={saveMutation.isPending}
          error={saveMutation.error}
          onChange={(values) => setEditor((current) => current ? { ...current, values } : current)}
          onClose={() => !saveMutation.isPending && setEditor(null)}
          onSave={() => saveMutation.mutate(editor)}
        />
      ) : null}
    </LayoutStack>
  );
}

function AuthorizationServiceCard(props: {
  service: iPolloWorkAuthorizationService;
  canEdit: boolean;
  testing: boolean;
  testResult?: iPolloWorkAuthorizationServiceTestResult;
  onConfigure: () => void;
  onTest: () => void;
  onOpenBrowserLogin?: () => void;
  onHeygenAction?: (action: "connect" | "disconnect" | "use-subscription" | "use-api-key") => void;
  heygenBusy?: boolean;
  heygenWaiting?: boolean;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const presentation = SERVICES[props.service.id];
  const Icon = presentation.icon;
  const subscription = props.service.subscription;
  const ready = subscription?.mode === "subscription" ? subscription.connected : props.service.configured || props.service.browserLogin?.connected;
  const requiredFields = presentation.fields.filter((field) => field.required !== false).length;
  const configuredFields = props.service.fields.filter((field) =>
    field.configured && presentation.fields.find((presentationField) => presentationField.key === field.key)?.required !== false,
  ).length;

  const statusLabel = props.onOpenBrowserLogin
    ? t(props.service.browserLogin?.connected ? "settings.authorization.browser_connected" : "settings.authorization.browser_disconnected")
    : props.onHeygenAction && subscription?.mode === "subscription"
      ? t(subscription.connected ? "settings.authorization.heygen.connected" : "settings.authorization.heygen.disconnected")
      : t(props.service.configured ? "settings.authorization.connected" : "settings.authorization.not_configured");
  const statusReady = props.onOpenBrowserLogin ? Boolean(props.service.browserLogin?.connected) : ready;

  return (
    <Card variant="resource" data-testid="authorization-service-row" data-service-id={props.service.id} className="min-w-0">
    <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen} className="flex min-h-[156px] flex-col gap-3">
        <CardHeader>
          <CardIcon>
            {presentation.logo ? <img src={publicAssetUrl(presentation.logo)} alt={t(presentation.titleKey)} className={cn("size-7 object-contain", props.service.id === "openai-images" && "dark:invert")} /> : <Icon className="size-6" />}
          </CardIcon>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <CardTitle as="h3" title={t(presentation.titleKey)}>{t(presentation.titleKey)}</CardTitle>
            <CardDescription className="min-h-9 line-clamp-2">{t(presentation.descriptionKey)}</CardDescription>
            <CardMeta data-testid="authorization-service-status"><SettingsStatusBadge tone={statusReady ? "ready" : "neutral"} label={statusLabel} className="min-h-0 justify-start px-0 text-ui-caption" /></CardMeta>
          </div>
        </CardHeader>
        <CardFooter data-testid="authorization-service-actions"><div className="ml-auto flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={props.onConfigure} disabled={!props.canEdit}>
            <KeyRound className="size-3.5" />
            {props.onOpenBrowserLogin || props.onHeygenAction ? t("settings.authorization.api_key") : props.service.configured ? t("settings.authorization.edit") : t("settings.authorization.configure")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setDetailsOpen(true); props.onTest(); }} disabled={!props.canEdit || !ready || props.testing}>
            {props.testing ? <Loader2 className="size-3.5 animate-spin" /> : <PlugZap className="size-3.5" />}
            {props.testing ? t("settings.authorization.testing") : props.onOpenBrowserLogin ? t("settings.authorization.test_api") : t("settings.authorization.test")}
          </Button>
        </div></CardFooter>
        <CollapsibleTrigger data-testid="authorization-service-more" render={<Button variant="ghost" size="sm" className="h-auto justify-between px-0 py-0 text-muted-foreground hover:bg-transparent active:bg-transparent aria-expanded:bg-transparent data-[state=open]:bg-transparent dark:hover:bg-transparent dark:active:bg-transparent" />}>
          {t("settings.authorization.help")}<ChevronDown className={cn("size-3.5 transition-transform", detailsOpen && "rotate-180")} />
        </CollapsibleTrigger>
      <CollapsibleContent data-testid="authorization-service-details" className="space-y-3">
      {props.onHeygenAction ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("settings.authorization.heygen.billing")}>
            <Button size="sm" variant={subscription?.mode === "subscription" ? "default" : "outline"} disabled={!props.canEdit || props.heygenBusy} onClick={() => props.onHeygenAction?.("use-subscription")} aria-pressed={subscription?.mode === "subscription"}>{t("settings.authorization.heygen.subscription")}</Button>
            <Button size="sm" variant={subscription?.mode !== "subscription" ? "default" : "outline"} disabled={!props.canEdit || props.heygenBusy} onClick={() => props.onHeygenAction?.("use-api-key")} aria-pressed={subscription?.mode !== "subscription"}>{t("settings.authorization.heygen.api")}</Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            {subscription?.mode !== "subscription" ? <span className="text-ui-caption text-dls-secondary">{t(subscription?.connected ? "settings.authorization.heygen.connected" : "settings.authorization.heygen.disconnected")}</span> : null}
            <Button variant="outline" size="sm" disabled={!props.canEdit || props.heygenBusy} onClick={() => props.onHeygenAction?.(subscription?.connected ? "disconnect" : "connect")}>
              {props.heygenBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Globe className="size-3.5" />}
              {t(subscription?.connected ? "settings.authorization.heygen.disconnect" : "settings.authorization.heygen.connect")}
            </Button>
          </div>
          <p className="text-ui-caption leading-5 text-muted-foreground">{t(subscription?.mode === "subscription" ? "settings.authorization.heygen.subscription_limit" : "settings.authorization.heygen.api_requirement")}</p>
          {props.heygenWaiting ? <p role="status" className="text-ui-caption text-muted-foreground">{t("settings.authorization.heygen.waiting")}</p> : null}
        </div>
      ) : null}
      {props.onOpenBrowserLogin ? <div className="space-y-2"><Button variant="outline" size="sm" onClick={props.onOpenBrowserLogin} disabled={!props.canEdit}><Globe className="size-3.5" />{t("settings.authorization.browser_login")}</Button><p className="text-ui-caption leading-5 text-muted-foreground">{t("settings.authorization.browser_billing")}</p></div> : null}
        <div className="space-y-2 text-ui-caption leading-5 text-muted-foreground">
          <p>{props.onHeygenAction || props.onOpenBrowserLogin ? "API Key · " : null}{t("settings.authorization.fields_configured", { configured: configuredFields, total: requiredFields })}</p>
          {props.onHeygenAction || props.onOpenBrowserLogin ? <p>{t(props.onHeygenAction ? "settings.authorization.heygen.hint" : "settings.authorization.browser_hint")}</p> : null}
        </div>
        {props.testResult ? <div role="status" className={cn("flex gap-2 text-ui-caption", props.testResult.ok ? "text-green-11" : "text-red-11")}>
          {props.testResult.ok ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" /> : <XCircle className="mt-0.5 size-3.5 shrink-0" />}
          <span>{props.testResult.detail}</span>
        </div> : null}
      </CollapsibleContent>
    </Collapsible>
    </Card>
  );
}

function AuthorizationEditor(props: {
  editor: EditorState;
  saving: boolean;
  error: Error | null;
  onChange: (values: Record<string, string>) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const presentation = SERVICES[props.editor.service.id];
  const title = t(presentation.titleKey);

  return (
    <AuthorizationFormDialog
      open
      title={t("settings.authorization.configure_title", { service: title })}
      description={t("settings.authorization.configure_description")}
      fields={presentation.fields.map((field) => ({
        id: field.key,
        label: field.label,
        placeholder: field.placeholder,
        secret: field.secret,
        description: field.hintKey ? t(field.hintKey) : undefined,
        saved: props.editor.service.fields.find((item) => item.key === field.key)?.configured === true,
        options: field.options?.map((option) => ({ value: option.value, label: t(option.labelKey) })),
      }))}
      values={props.editor.values}
      saving={props.saving}
      error={props.error?.message ?? null}
      cancelLabel={t("settings.authorization.cancel")}
      savedLabel={t("settings.authorization.value_saved")}
      submitLabel={t("settings.authorization.save")}
      savingLabel={t("settings.authorization.saving")}
      onValuesChange={props.onChange}
      onClose={props.onClose}
      onSubmit={props.onSave}
    />
  );
}
