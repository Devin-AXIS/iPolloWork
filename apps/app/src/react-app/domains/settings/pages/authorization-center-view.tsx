/** @jsxImportSource react */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AudioLines,
  CheckCircle2,
  Clapperboard,
  Cloud,
  FolderCog,
  Image,
  KeyRound,
  Loader2,
  PlugZap,
  RefreshCw,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { toast } from "@/components/ui/sonner";

import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type {
  iPolloWorkAuthorizationService,
  iPolloWorkAuthorizationServiceId,
  iPolloWorkAuthorizationServiceTestResult,
  iPolloWorkServerClient,
} from "@/app/lib/ipollowork-server";
import { t } from "@/i18n";
import { ConfirmModal } from "@/react-app/design-system/modals/confirm-modal";
import { LayoutSection, LayoutSectionDescription, LayoutSectionHeader, LayoutSectionTitle, LayoutStack } from "@/react-app/domains/settings/settings-layout";
import { SettingsNotice, SettingsStatusBadge, Spinner } from "@/react-app/domains/settings/settings-section";
import {
  EnvironmentVariableProvider,
  environmentUserEnvQueryKey,
  type ApplyEnvironmentChangesResult,
  useEnvironmentVariableApplyChanges,
  useEnvironmentVariableMarkChangesPending,
  useIsEnvironmentVariableChangesPending,
} from "./environment-variable-provider";

type AuthorizationCenterViewProps = {
  client: iPolloWorkServerClient | null;
  isRemoteWorkspace: boolean;
  onApplyChanges?: () => Promise<ApplyEnvironmentChangesResult>;
  applyBlocked?: boolean;
  applyBlockedReason?: string | null;
  runtimeKey?: string | null;
};

type ServicePresentation = {
  icon: LucideIcon;
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

const SERVICES: Record<iPolloWorkAuthorizationServiceId, ServicePresentation> = {
  "openai-images": {
    icon: Image,
    titleKey: "settings.authorization.service.openai_images.title",
    descriptionKey: "settings.authorization.service.openai_images.description",
    fields: [{ key: "OPENAI_API_KEY", label: "OpenAI API key", placeholder: "sk-..." }],
  },
  "aliyun-bailian": {
    icon: AudioLines,
    titleKey: "settings.authorization.service.aliyun_bailian.title",
    descriptionKey: "settings.authorization.service.aliyun_bailian.description",
    fields: [{ key: "DASHSCOPE_API_KEY", label: "DashScope API key", placeholder: "sk-..." }],
  },
  "volcengine-video": {
    icon: Clapperboard,
    titleKey: "settings.authorization.service.volcengine_video.title",
    descriptionKey: "settings.authorization.service.volcengine_video.description",
    fields: [{ key: "ARK_API_KEY", label: "Ark API key", placeholder: "your Ark API key" }],
  },
  "aliyun-oss": {
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
  return (
    <EnvironmentVariableProvider
      client={props.client}
      runtimeKey={props.runtimeKey}
      onApplyChanges={props.onApplyChanges}
    >
      <AuthorizationCenterContent {...props} />
    </EnvironmentVariableProvider>
  );
}

function AuthorizationCenterContent(props: AuthorizationCenterViewProps) {
  const canEdit = props.client !== null && !props.isRemoteWorkspace;
  const queryClient = useQueryClient();
  const markChangesPending = useEnvironmentVariableMarkChangesPending();
  const isPendingChanges = useIsEnvironmentVariableChangesPending();
  const { applyAsync, isApplying, error: applyError } = useEnvironmentVariableApplyChanges();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, iPolloWorkAuthorizationServiceTestResult>>({});

  const servicesQuery = useQuery({
    queryKey: authorizationQueryKey(props.runtimeKey),
    queryFn: async () => {
      if (!props.client || props.isRemoteWorkspace) return { items: [] };
      return props.client.listAuthorizationServices();
    },
    enabled: canEdit,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!canEdit) setEditor(null);
  }, [canEdit]);

  const saveMutation = useMutation({
    mutationFn: async (draft: EditorState) => {
      if (!props.client) throw new Error(t("app.unknown_error"));
      const fields = SERVICES[draft.service.id].fields;
      const current = new Map(draft.service.fields.map((field) => [field.key, field.configured]));
      const missing = fields.find((field) => field.required !== false && !current.get(field.key) && !draft.values[field.key]?.trim());
      if (missing) {
        throw new Error(t("settings.authorization.validation_required", { field: missing.label }));
      }
      const entries = fields
        .map((field) => ({ key: field.key, value: draft.values[field.key]?.trim() ?? "" }))
        .filter((entry) => entry.value.length > 0);
      if (entries.length === 0) return;
      await props.client.upsertUserEnv(entries);
    },
    onSuccess: async () => {
      markChangesPending();
      setEditor(null);
      toast.success(t("settings.authorization.saved"));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: authorizationQueryKey(props.runtimeKey) }),
        queryClient.invalidateQueries({ queryKey: environmentUserEnvQueryKey(props.runtimeKey) }),
      ]);
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

        {isPendingChanges && !props.isRemoteWorkspace ? (
          <>
            <Alert variant="warning">
              <RefreshCw />
              <AlertTitle>{t("settings.authorization.apply_pending_title")}</AlertTitle>
              <AlertDescription>{t("settings.authorization.apply_pending_body")}</AlertDescription>
              {props.applyBlocked ? <AlertDescription>{props.applyBlockedReason}</AlertDescription> : null}
              {applyError ? <AlertDescription>{applyError.message}</AlertDescription> : null}
              {props.onApplyChanges ? (
                <AlertAction>
                  <Button
                    size="sm"
                    disabled={isApplying || props.applyBlocked}
                    onClick={() => setApplyOpen(true)}
                    title={props.applyBlockedReason ?? undefined}
                  >
                    <Spinner spinning={isApplying} />
                    {isApplying ? t("settings.authorization.applying") : t("settings.authorization.apply")}
                  </Button>
                </AlertAction>
              ) : null}
            </Alert>
            <ConfirmModal
              open={applyOpen}
              title={t("settings.authorization.apply_title")}
              message={t("settings.authorization.apply_confirm")}
              confirmLabel={isApplying ? t("settings.authorization.applying") : t("settings.authorization.apply")}
              cancelLabel={t("settings.authorization.cancel")}
              variant="warning"
              onConfirm={() => {
                void applyAsync(undefined, { onSuccess: () => setApplyOpen(false) });
              }}
              onCancel={() => {
                if (!isApplying) setApplyOpen(false);
              }}
            />
          </>
        ) : null}

        {servicesQuery.isLoading ? (
          <div className="flex min-h-40 items-center justify-center rounded-2xl border border-dls-border bg-dls-hover/40">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid gap-3 @md/settings:grid-cols-2">
            {services.map((service) => (
              <AuthorizationServiceCard
                key={service.id}
                service={service}
                canEdit={canEdit}
                testResult={testResults[service.id]}
                testing={testMutation.isPending && testMutation.variables === service.id}
                onConfigure={() => openEditor(service)}
                onTest={() => testMutation.mutate(service.id)}
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
}) {
  const presentation = SERVICES[props.service.id];
  const Icon = presentation.icon;
  const requiredFields = presentation.fields.filter((field) => field.required !== false).length;
  const configuredFields = props.service.fields.filter((field) =>
    field.configured && presentation.fields.find((presentationField) => presentationField.key === field.key)?.required !== false,
  ).length;

  return (
    <Card variant="outline" size="sm" className="flex min-h-52 flex-col">
      <CardHeader className="gap-3">
        <div className="flex items-start justify-between gap-3">
          <span className="flex size-9 items-center justify-center rounded-xl border border-border bg-muted/40 text-muted-foreground">
            <Icon className="size-4" />
          </span>
          <SettingsStatusBadge
            tone={props.service.configured ? "ready" : "neutral"}
            label={props.service.configured ? t("settings.authorization.connected") : t("settings.authorization.not_configured")}
            className="min-h-7 px-0 text-[11px]"
          />
        </div>
        <div>
          <CardTitle className="text-sm">{t(presentation.titleKey)}</CardTitle>
          <CardDescription className="mt-1 min-h-10 text-xs leading-5">
            {t(presentation.descriptionKey)}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex-1">
        <p className="text-xs text-muted-foreground">
          {t("settings.authorization.fields_configured", {
            configured: configuredFields,
            total: requiredFields,
          })}
        </p>
        {props.testResult ? (
          <div className={`mt-3 flex gap-2 rounded-xl px-3 py-2 text-xs ${props.testResult.ok ? "bg-green-3/40 text-green-11" : "bg-red-3/40 text-red-11"}`}>
            {props.testResult.ok ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" /> : <XCircle className="mt-0.5 size-3.5 shrink-0" />}
            <span>{props.testResult.detail}</span>
          </div>
        ) : null}
      </CardContent>
      <CardFooter className="justify-between gap-2 border-t border-border">
        <Button variant="ghost" size="sm" onClick={props.onConfigure} disabled={!props.canEdit}>
          <KeyRound className="size-3.5" />
          {props.service.configured ? t("settings.authorization.edit") : t("settings.authorization.configure")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={props.onTest}
          disabled={!props.canEdit || !props.service.configured || props.testing}
        >
          {props.testing ? <Loader2 className="size-3.5 animate-spin" /> : <PlugZap className="size-3.5" />}
          {props.testing ? t("settings.authorization.testing") : t("settings.authorization.test")}
        </Button>
      </CardFooter>
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
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("settings.authorization.configure_title", { service: title })}</DialogTitle>
          <DialogDescription>{t("settings.authorization.configure_description")}</DialogDescription>
        </DialogHeader>
        <FieldGroup className="gap-4">
          {presentation.fields.map((field) => {
            const configured = props.editor.service.fields.find((item) => item.key === field.key)?.configured === true;
            return (
              <Field key={field.key}>
                <FieldLabel>{field.label}</FieldLabel>
                {field.options ? (
                  <Select
                    value={props.editor.values[field.key] ?? undefined}
                    onValueChange={(value) => props.onChange({
                      ...props.editor.values,
                      [field.key]: value ?? "",
                    })}
                    disabled={props.saving}
                  >
                    <SelectTrigger className="w-full" aria-label={field.label}>
                      <SelectValue placeholder={configured ? t("settings.authorization.value_saved") : field.placeholder} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {field.options.map((option) => (
                          <SelectItem key={option.value} value={option.value}>{t(option.labelKey)}</SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    type={field.secret === false ? "text" : "password"}
                    value={props.editor.values[field.key] ?? ""}
                    onChange={(event) => props.onChange({
                      ...props.editor.values,
                      [field.key]: event.currentTarget.value,
                    })}
                    placeholder={configured ? t("settings.authorization.value_saved") : field.placeholder}
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono"
                    disabled={props.saving}
                  />
                )}
                {field.hintKey ? <FieldDescription>{t(field.hintKey)}</FieldDescription> : null}
              </Field>
            );
          })}
        </FieldGroup>
        {props.error ? <SettingsNotice tone="error">{props.error.message}</SettingsNotice> : null}
        <DialogFooter>
          <DialogClose render={<Button size="sm" variant="outline" disabled={props.saving} />}>
            {t("settings.authorization.cancel")}
          </DialogClose>
          <Button size="sm" onClick={props.onSave} disabled={props.saving}>
            {props.saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {props.saving ? t("settings.authorization.saving") : t("settings.authorization.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
