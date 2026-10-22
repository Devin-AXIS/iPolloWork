/** @jsxImportSource react */
import { useCallback, useEffect, useId, useState } from "react";
import { ChevronDown, CircleAlert } from "lucide-react";

import {
  joinEnterpriseWithCode,
  type EnterpriseConnection,
} from "../../../../app/lib/enterprise-connections";
import { readDenSettings } from "../../../../app/lib/den";
import { denSessionUpdatedEvent } from "../../../../app/lib/den-session-events";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, ButtonStyleScopeProvider } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { t } from "../../../../i18n";

type EnterpriseServerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected: (connection: EnterpriseConnection) => void;
  onSignInRequired: () => void;
};

function connectionErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return t("enterprise_connection.error_unreachable");
  if (error.message === "invalid_enterprise_url") return t("enterprise_connection.error_url");
  if (
    error.message === "JOIN_CODE_NOT_FOUND" ||
    error.message === "invalid_join_code" ||
    error.message === "invalid_join_request"
  ) {
    return t("enterprise_connection.error_code");
  }
  if (
    error.message === "cloud_signin_required" ||
    error.message === "enterprise_identity_token_missing"
  ) {
    return t("enterprise_connection.error_signin");
  }
  if (
    error.message === "invalid_identity_token"
  ) {
    return t("enterprise_connection.error_identity");
  }
  if (
    error.message === "invalid_enterprise_discovery" ||
    error.message === "enterprise_manifest_mismatch"
  ) {
    return t("enterprise_connection.error_invalid_server");
  }
  return t("enterprise_connection.error_unreachable");
}

export function EnterpriseServerDialog({
  open,
  onConnected,
  onOpenChange,
  onSignInRequired,
}: EnterpriseServerDialogProps) {
  const fieldId = useId();
  const [serverUrl, setServerUrl] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [awaitingSignIn, setAwaitingSignIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setServerUrl("");
    setJoinCode("");
    setAwaitingSignIn(false);
    setError(null);
  }, [open]);

  const submit = useCallback(async () => {
    const settings = readDenSettings();
    if (!settings.authToken?.trim()) {
      setAwaitingSignIn(true);
      setError(null);
      onSignInRequired();
      return;
    }

    setAwaitingSignIn(false);
    setConnecting(true);
    setError(null);
    try {
      const connection = await joinEnterpriseWithCode({
        joinCode,
        enterpriseBaseUrl: serverUrl,
        cloudBaseUrl: settings.baseUrl,
        cloudToken: settings.authToken ?? "",
      });
      onConnected(connection);
      onOpenChange(false);
    } catch (connectError) {
      setError(connectionErrorMessage(connectError));
    } finally {
      setConnecting(false);
    }
  }, [joinCode, onConnected, onOpenChange, onSignInRequired, serverUrl]);

  useEffect(() => {
    if (!open || !awaitingSignIn) return;

    const resumeJoin = (event: WindowEventMap[typeof denSessionUpdatedEvent]) => {
      if (event.detail?.status === "success") {
        void submit();
        return;
      }
      if (event.detail?.status !== "error") return;
      setAwaitingSignIn(false);
      setError(t("enterprise_connection.error_signin"));
    };

    window.addEventListener(denSessionUpdatedEvent, resumeJoin);
    return () => window.removeEventListener(denSessionUpdatedEvent, resumeJoin);
  }, [awaitingSignIn, open, submit]);

  return (
    <ButtonStyleScopeProvider value="settings" flat><Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="enterprise-connect-dialog">
        <DialogHeader>
          <DialogTitle>{t("enterprise_connection.title")}</DialogTitle>
          <DialogDescription>{t("enterprise_connection.description")}</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!connecting && !awaitingSignIn && serverUrl.trim() && joinCode.trim()) void submit();
          }}
        >
          <Field data-invalid={error === t("enterprise_connection.error_url") || undefined}>
          <FieldLabel htmlFor={`${fieldId}-url`}>{t("enterprise_connection.url_label")}</FieldLabel>
          <Input id={`${fieldId}-url`} required
            aria-describedby={error === t("enterprise_connection.error_url") ? `${fieldId}-error` : undefined}
            value={serverUrl}
            onChange={(event) => setServerUrl(event.currentTarget.value)}
            placeholder={t("enterprise_connection.url_placeholder")}
            disabled={connecting || awaitingSignIn}
            aria-invalid={error === t("enterprise_connection.error_url") ? true : undefined}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="url"
          />
          </Field>
          <Field data-invalid={Boolean(error) || undefined}>
          <FieldLabel htmlFor={`${fieldId}-code`}>{t("enterprise_connection.code_label")}</FieldLabel>
          <Input id={`${fieldId}-code`} required
            aria-describedby={error ? `${fieldId}-error` : undefined}
            value={joinCode}
            onChange={(event) => setJoinCode(event.currentTarget.value.toUpperCase())}
            placeholder={t("enterprise_connection.code_placeholder")}
            disabled={connecting || awaitingSignIn}
            aria-invalid={error ? true : undefined}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
          </Field>
          {awaitingSignIn ? (
            <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
              {t("enterprise_connection.signin_to_continue")}
            </p>
          ) : error ? (
            <Alert id={`${fieldId}-error`} variant="destructive"><CircleAlert aria-hidden="true" /><AlertDescription>{error}</AlertDescription></Alert>
          ) : null}

          <Collapsible>
            <CollapsibleTrigger data-testid="enterprise-connect-help" render={<Button type="button" variant="ghost" size="sm" className="-ml-2" />}><ChevronDown className="size-3.5" aria-hidden="true" />{t("enterprise_connection.join_details")}</CollapsibleTrigger>
            <CollapsibleContent className="pt-2 text-ui-body text-muted-foreground">{t("enterprise_connection.code_hint")} {t("enterprise_connection.url_hint")}</CollapsibleContent>
          </Collapsible>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={connecting}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={connecting || awaitingSignIn || !serverUrl.trim() || !joinCode.trim()}
            >
              {awaitingSignIn
                ? t("enterprise_connection.waiting_for_signin")
                : connecting
                ? t("enterprise_connection.connecting")
                : t("enterprise_connection.connect")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog></ButtonStyleScopeProvider>
  );
}
