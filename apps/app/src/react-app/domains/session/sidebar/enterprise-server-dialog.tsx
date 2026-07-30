/** @jsxImportSource react */
import { useEffect, useState } from "react";

import {
  joinEnterpriseWithCode,
  type EnterpriseConnection,
} from "../../../../app/lib/enterprise-connections";
import { readDenSettings } from "../../../../app/lib/den";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TextInput } from "../../../design-system/text-input";
import { t } from "../../../../i18n";

type EnterpriseServerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected: (connection: EnterpriseConnection) => void;
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

export function EnterpriseServerDialog(props: EnterpriseServerDialogProps) {
  const [serverUrl, setServerUrl] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.open) return;
    setServerUrl("");
    setJoinCode("");
    setError(null);
  }, [props.open]);

  const submit = async () => {
    setConnecting(true);
    setError(null);
    try {
      const settings = readDenSettings();
      const connection = await joinEnterpriseWithCode({
        joinCode,
        enterpriseBaseUrl: serverUrl,
        cloudBaseUrl: settings.baseUrl,
        cloudToken: settings.authToken ?? "",
      });
      props.onConnected(connection);
      props.onOpenChange(false);
    } catch (connectError) {
      setError(connectionErrorMessage(connectError));
    } finally {
      setConnecting(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="w-full max-w-md sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("enterprise_connection.title")}</DialogTitle>
          <DialogDescription>{t("enterprise_connection.description")}</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!connecting && serverUrl.trim() && joinCode.trim()) void submit();
          }}
        >
          <TextInput
            label={t("enterprise_connection.url_label")}
            hint={t("enterprise_connection.url_hint")}
            value={serverUrl}
            onChange={(event) => setServerUrl(event.currentTarget.value)}
            placeholder={t("enterprise_connection.url_placeholder")}
            disabled={connecting}
            aria-invalid={error === t("enterprise_connection.error_url") ? true : undefined}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="url"
          />
          <TextInput
            label={t("enterprise_connection.code_label")}
            hint={t("enterprise_connection.code_hint")}
            value={joinCode}
            onChange={(event) => setJoinCode(event.currentTarget.value.toUpperCase())}
            placeholder={t("enterprise_connection.code_placeholder")}
            disabled={connecting}
            aria-invalid={error ? true : undefined}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
          {error ? (
            <p className="text-xs text-destructive" role="alert">{error}</p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => props.onOpenChange(false)}
              disabled={connecting}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={connecting || !serverUrl.trim() || !joinCode.trim()}>
              {connecting
                ? t("enterprise_connection.connecting")
                : t("enterprise_connection.connect")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
