/** @jsxImportSource react */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Mic2, XCircle } from "lucide-react";

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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { iPolloWorkServerClient } from "@/app/lib/ipollowork-server";
import { t } from "@/i18n";
import { registerExtensionConfig, type ExtensionConfigContext } from "./extension-registry";
import { getSpeechInputProvider, setSpeechInputProvider, type SpeechInputProvider } from "./state/speech-input-preferences";

export type IPolloWorkVoiceConfigProps = {
  authorizationClient: iPolloWorkServerClient | null;
  busy: boolean;
  status: string | null;
  error: string | null;
  envKeyDetected: boolean;
  onSaveApiKey: (apiKey: string) => void | Promise<void>;
  onTestSession: () => void | Promise<void>;
};

const IPolloWorkVoiceConfigFactory = (ctx: ExtensionConfigContext) => (
  <IPolloWorkVoiceConfig
    authorizationClient={ctx.hostiPolloWorkServerClient ?? ctx.ipolloworkServerClient ?? null}
    busy={ctx.voiceExtension.busy}
    status={ctx.voiceExtension.status}
    error={ctx.voiceExtension.error}
    envKeyDetected={ctx.voiceExtension.envKeyDetected}
    onSaveApiKey={ctx.voiceExtension.onSaveApiKey}
    onTestSession={ctx.voiceExtension.onTestSession}
  />
);

registerExtensionConfig("ipollowork.voice.settings", IPolloWorkVoiceConfigFactory);
registerExtensionConfig("ipollowork-voice", IPolloWorkVoiceConfigFactory);

export function IPolloWorkVoiceConfig(props: IPolloWorkVoiceConfigProps) {
  const [apiKey, setApiKey] = useState("");
  const [speechInputProvider, setSpeechInputProviderState] = useState<SpeechInputProvider>(() => getSpeechInputProvider());
  const [speechInputSaved, setSpeechInputSaved] = useState(false);
  const canSave = Boolean(apiKey.trim());
  const authorizationQuery = useQuery({
    queryKey: ["settings", "speech-input", "authorization"],
    queryFn: async () => props.authorizationClient?.listAuthorizationServices() ?? { items: [] },
    enabled: props.authorizationClient !== null,
    refetchOnWindowFocus: false,
  });
  const configuredProviderIds = useMemo(
    () => new Set((authorizationQuery.data?.items ?? []).filter((item) => item.configured).map((item) => item.id)),
    [authorizationQuery.data?.items],
  );
  const providerOptions = useMemo(() => [
    { value: "auto" as const, label: t("settings.integration.speech_input.auto") },
    ...(configuredProviderIds.has("openai-images") ? [{ value: "openai" as const, label: t("settings.authorization.option.openai") }] : []),
    ...(configuredProviderIds.has("aliyun-bailian") ? [{ value: "aliyun-bailian" as const, label: t("settings.authorization.option.aliyun_bailian") }] : []),
    ...(configuredProviderIds.has("baidu-speech") ? [{ value: "baidu-speech" as const, label: t("settings.authorization.option.baidu_speech") }] : []),
  ], [configuredProviderIds]);
  const effectiveSpeechInputProvider = providerOptions.some((option) => option.value === speechInputProvider)
    ? speechInputProvider
    : "auto";

  useEffect(() => {
    if (effectiveSpeechInputProvider !== speechInputProvider) {
      setSpeechInputProviderState(effectiveSpeechInputProvider);
      setSpeechInputProvider(effectiveSpeechInputProvider);
    }
  }, [effectiveSpeechInputProvider, speechInputProvider]);

  const handleSpeechInputProviderChange = (value: string | null) => {
    if (!value) return;
    if (!providerOptions.some((option) => option.value === value)) return;
    const nextProvider = value as SpeechInputProvider;
    setSpeechInputProviderState(nextProvider);
    setSpeechInputProvider(nextProvider);
    setSpeechInputSaved(true);
  };

  return (
    <div className="space-y-3">
      <Card variant="outline" size="sm">
        <CardHeader>
          <CardTitle>{t("settings.integration.voice.title")}</CardTitle>
          <CardDescription>
            {t("settings.integration.voice.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {props.envKeyDetected ? (
            <Alert>
              <Mic2 />
              <AlertTitle>{t("settings.integration.voice.key_detected_title")}</AlertTitle>
              <AlertDescription>
                {t("settings.integration.voice.key_detected_description")}
              </AlertDescription>
            </Alert>
          ) : null}

          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="ipollowork-voice-api-key">{t("settings.integration.openai_api_key")}</FieldLabel>
              <Input
                id="ipollowork-voice-api-key"
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.currentTarget.value)}
                placeholder="sk-..."
              />
              <FieldDescription>
                {t("settings.integration.voice.key_description")}
              </FieldDescription>
            </Field>
          </FieldGroup>

          {props.status ? (
            <Alert>
              <CheckCircle2 />
              <AlertDescription>{props.status}</AlertDescription>
            </Alert>
          ) : null}
          {props.error ? (
            <Alert variant="destructive">
              <XCircle />
              <AlertDescription>{props.error}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
        <CardFooter className="flex-wrap gap-2 border-t border-border justify-between">
          <Button onClick={() => void props.onSaveApiKey(apiKey)} disabled={props.busy || !canSave}>
            {props.busy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}
            {t("settings.integration.save_key")}
          </Button>
          <Button variant="outline" onClick={() => void props.onTestSession()} disabled={props.busy || !props.envKeyDetected}>
            {t("settings.integration.voice.test")}
          </Button>
        </CardFooter>
      </Card>

      <Card variant="outline" size="sm">
        <CardHeader>
          <CardTitle>{t("settings.integration.speech_input.title")}</CardTitle>
          <CardDescription>{t("settings.integration.speech_input.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field>
            <FieldLabel htmlFor="ipollowork-speech-input-provider">{t("settings.integration.speech_input.provider_label")}</FieldLabel>
            <Select
              value={effectiveSpeechInputProvider}
              onValueChange={handleSpeechInputProviderChange}
              disabled={authorizationQuery.isLoading || providerOptions.length === 1}
            >
              <SelectTrigger id="ipollowork-speech-input-provider" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {providerOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {providerOptions.length === 1 ? <FieldDescription>{t("settings.integration.speech_input.none")}</FieldDescription> : null}
          </Field>
          {speechInputSaved ? (
            <Alert>
              <CheckCircle2 />
              <AlertDescription>{t("settings.integration.speech_input.saved")}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
