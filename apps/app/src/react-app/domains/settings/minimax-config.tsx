/** @jsxImportSource react */
import { useMemo, useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { registerExtensionConfig, type ExtensionConfigContext } from "./extension-registry";
import type { LocalProviderInstallInput } from "./openai-image-extension";
import {
  buildMiniMaxProviderConfig,
  buildMiniMaxRuntimeEnv,
  getMiniMaxEndpoint,
  MINIMAX_ENDPOINTS,
  MINIMAX_PROVIDER,
  type MiniMaxEndpointId,
} from "./minimax-provider";

const minimaxConfigFactory = (ctx: ExtensionConfigContext) => (
  <MiniMaxConfig
    busy={ctx.localProvider.busy}
    status={ctx.localProvider.status}
    error={ctx.localProvider.error}
    onInstall={ctx.localProvider.onInstall}
  />
);

registerExtensionConfig("ipollowork.minimax.settings", minimaxConfigFactory);
registerExtensionConfig("minimax", minimaxConfigFactory);

type MiniMaxConfigProps = {
  busy: boolean;
  status: string | null;
  error: string | null;
  onInstall: (input: LocalProviderInstallInput) => void | Promise<void>;
};

function isMiniMaxEndpointId(value: string): value is MiniMaxEndpointId {
  return MINIMAX_ENDPOINTS.some((endpoint) => endpoint.id === value);
}

function formatContextWindow(value: number) {
  return value.toLocaleString("en-US");
}

export function MiniMaxConfig(props: MiniMaxConfigProps) {
  const [apiKey, setApiKey] = useState("");
  const [endpointId, setEndpointId] = useState<MiniMaxEndpointId>("global-openai");
  const [defaultModelId, setDefaultModelId] = useState(MINIMAX_PROVIDER.models[0].id);
  const [setDefault, setSetDefault] = useState(true);
  const [localError, setLocalError] = useState<string | null>(null);

  const endpoint = useMemo(() => getMiniMaxEndpoint(endpointId), [endpointId]);
  const selectedModel = MINIMAX_PROVIDER.models.find((model) => model.id === defaultModelId) ?? MINIMAX_PROVIDER.models[0];

  const handleInstall = () => {
    const trimmedApiKey = apiKey.trim();
    if (!trimmedApiKey) {
      setLocalError("MiniMax API key is required.");
      return;
    }

    const provider = buildMiniMaxProviderConfig(endpointId);
    setLocalError(null);
    void props.onInstall({
      providerId: MINIMAX_PROVIDER.providerId,
      name: MINIMAX_PROVIDER.name,
      api: provider.api,
      npm: provider.npm,
      apiKey: trimmedApiKey,
      modelId: selectedModel.id,
      modelName: selectedModel.id,
      models: provider.models,
      userEnv: buildMiniMaxRuntimeEnv(endpointId, trimmedApiKey),
      setDefault,
    });
  };

  const error = localError ?? props.error;

  return (
    <Card variant="outline" size="sm">
      <CardHeader>
        <CardTitle>Configure MiniMax</CardTitle>
        <CardDescription>
          Add both current MiniMax models to OpenCode through a regional endpoint.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <XCircle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {props.status ? (
          <Alert>
            <CheckCircle2 />
            <AlertDescription>{props.status}</AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-2">
          <label htmlFor="minimax-api-key" className="text-sm font-medium">MiniMax API key</label>
          <Input
            id="minimax-api-key"
            type="password"
            value={apiKey}
            onChange={(event) => {
              setApiKey(event.currentTarget.value);
              setLocalError(null);
            }}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="Enter your MiniMax API key"
            disabled={props.busy}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="minimax-endpoint" className="text-sm font-medium">Endpoint</label>
          <Select
            value={endpointId}
            items={MINIMAX_ENDPOINTS.map((candidate) => ({ value: candidate.id, label: candidate.label }))}
            onValueChange={(value) => {
              if (value && isMiniMaxEndpointId(value)) setEndpointId(value);
            }}
            disabled={props.busy}
          >
            <SelectTrigger id="minimax-endpoint" className="w-full">
              <SelectValue placeholder={endpoint.label} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {MINIMAX_ENDPOINTS.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {candidate.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{endpoint.baseURL}</p>
        </div>

        <div className="space-y-2">
          <label htmlFor="minimax-default-model" className="text-sm font-medium">Default model</label>
          <Select
            value={defaultModelId}
            items={MINIMAX_PROVIDER.models.map((model) => ({ value: model.id, label: model.id }))}
            onValueChange={(value) => {
              if (value) setDefaultModelId(value);
            }}
            disabled={props.busy}
          >
            <SelectTrigger id="minimax-default-model" className="w-full">
              <SelectValue placeholder={selectedModel.id} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {MINIMAX_PROVIDER.models.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.id}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {MINIMAX_PROVIDER.models.map((model) => (
            <div key={model.id} className="rounded-md border border-border p-3 text-xs">
              <div className="font-medium text-foreground">{model.id}</div>
              <div className="mt-1 text-muted-foreground">
                Context: {formatContextWindow(model.contextWindow)} - Input: {model.inputModalities.join(", ")}
              </div>
              <div className="mt-1 text-muted-foreground">Thinking: {model.thinking.join(", ")}</div>
            </div>
          ))}
        </div>
      </CardContent>
      <CardFooter className="border-t border-border">
        <FieldGroup className="gap-3">
          <Field orientation="horizontal">
            <Checkbox
              id="minimax-set-default"
              name="minimax-set-default"
              checked={setDefault}
              onCheckedChange={(checked) => setSetDefault(checked === true)}
              nativeButton
              render={<button type="button" />}
            />
            <FieldLabel htmlFor="minimax-set-default">Use the selected model as the default</FieldLabel>
          </Field>
        </FieldGroup>
        <Button onClick={handleInstall} disabled={props.busy || !apiKey.trim()}>
          {props.busy ? <Loader2 className="size-4 animate-spin" /> : null}
          Add MiniMax
        </Button>
      </CardFooter>
    </Card>
  );
}
