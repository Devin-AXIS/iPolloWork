/** @jsxImportSource react */
import { useEffect, useState } from "react";

import {
  discoverEnterpriseConnection,
  readEnterpriseConnections,
  saveEnterpriseConnection,
  type EnterpriseConnection,
} from "../../../../app/lib/enterprise-connections";
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
    error.message === "invalid_enterprise_discovery" ||
    error.message === "enterprise_manifest_mismatch"
  ) {
    return t("enterprise_connection.error_invalid_server");
  }
  return t("enterprise_connection.error_unreachable");
}

export function EnterpriseServerDialog(props: EnterpriseServerDialogProps) {
  const [serverUrl, setServerUrl] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.open) return;
    setServerUrl(readEnterpriseConnections()[0]?.origin ?? "");
    setError(null);
  }, [props.open]);

  const submit = async () => {
    setConnecting(true);
    setError(null);
    try {
      const connection = await discoverEnterpriseConnection(serverUrl);
      saveEnterpriseConnection(connection);
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
            if (!connecting && serverUrl.trim()) void submit();
          }}
        >
          <TextInput
            label={t("enterprise_connection.url_label")}
            hint={t("enterprise_connection.url_hint")}
            value={serverUrl}
            onChange={(event) => setServerUrl(event.currentTarget.value)}
            placeholder={t("enterprise_connection.url_placeholder")}
            disabled={connecting}
            aria-invalid={error ? true : undefined}
            autoCapitalize="none"
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
            <Button type="submit" disabled={connecting || !serverUrl.trim()}>
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
