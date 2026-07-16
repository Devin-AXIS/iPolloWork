/** @jsxImportSource react */
import { useState } from "react";
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
import { t } from "@/i18n";
import { registerExtensionConfig, type ExtensionConfigContext } from "./extension-registry";

export type IPolloWorkVoiceConfigProps = {
  busy: boolean;
  status: string | null;
  error: string | null;
  envKeyDetected: boolean;
  onSaveApiKey: (apiKey: string) => void | Promise<void>;
  onTestSession: () => void | Promise<void>;
};

const IPolloWorkVoiceConfigFactory = (ctx: ExtensionConfigContext) => (
  <IPolloWorkVoiceConfig
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
  const canSave = Boolean(apiKey.trim());

  return (
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
  );
}
