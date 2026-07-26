/** @jsxImportSource react */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { BuildingOffice2Icon, ComputerDesktopIcon, PlusIcon } from "@heroicons/react/24/solid";

import {
  discoverEnterpriseConnection,
  readEnterpriseConnections,
  saveEnterpriseConnection,
  type EnterpriseConnection,
} from "../../../app/lib/enterprise-connections";
import {
  Page,
  PageBackground,
  PageContainer,
  PageContent,
  PageDescription,
  PageFooter,
  PageHeader,
  PageTitle,
  PageTitlebarRegion,
} from "../../../components/page";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { RadioGroup, RadioGroupItem } from "../../../components/ui/radio-group";
import { t } from "../../../i18n";
import { cn } from "../../../lib/utils";
import { useBootState } from "../../shell/boot-state";

const PERSONAL_CONTEXT = "personal";

function enterpriseContext(id: string) {
  return `enterprise:${id}`;
}

function connectionErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return t("work_context.enterprise_error_unreachable");
  if (error.message === "invalid_enterprise_url") return t("work_context.enterprise_error_url");
  if (
    error.message === "invalid_enterprise_discovery" ||
    error.message === "enterprise_manifest_mismatch"
  ) {
    return t("work_context.enterprise_error_invalid_server");
  }
  return t("work_context.enterprise_error_unreachable");
}

type ContextRowProps = {
  checked: boolean;
  description: string;
  icon: ReactNode;
  title: string;
  value: string;
  meta?: string;
};

function ContextRow(props: ContextRowProps) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition-colors",
        props.checked
          ? "border-foreground/20 bg-foreground/[0.035]"
          : "border-border bg-background hover:bg-muted/40",
      )}
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        {props.icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{props.title}</span>
          {props.meta ? (
            <span className="truncate text-xs text-muted-foreground">{props.meta}</span>
          ) : null}
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{props.description}</p>
      </div>
      <RadioGroupItem value={props.value} aria-label={props.title} />
    </label>
  );
}

function EnterpriseLogo({ connection }: { connection: EnterpriseConnection }) {
  if (connection.logoUrl) {
    return <img src={connection.logoUrl} alt="" className="size-5 rounded object-contain" />;
  }
  return <BuildingOffice2Icon className="size-5" />;
}

export function WorkContextEntryPage() {
  const navigate = useNavigate();
  const { markRouteReady } = useBootState();
  const [connections, setConnections] = useState(readEnterpriseConnections);
  const [selected, setSelected] = useState(PERSONAL_CONTEXT);
  const [showEnterpriseInput, setShowEnterpriseInput] = useState(connections.length === 0);
  const [serverUrl, setServerUrl] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedEnterprise = useMemo(
    () => connections.find((connection) => selected === enterpriseContext(connection.id)) ?? null,
    [connections, selected],
  );

  useEffect(() => {
    markRouteReady();
  }, [markRouteReady]);

  const connectEnterprise = async () => {
    setConnecting(true);
    setError(null);
    setNotice(null);
    try {
      const connection = await discoverEnterpriseConnection(serverUrl);
      saveEnterpriseConnection(connection);
      setConnections((current) => [connection, ...current.filter((item) => item.id !== connection.id)]);
      setSelected(enterpriseContext(connection.id));
      setServerUrl("");
      setShowEnterpriseInput(false);
      setNotice(t("work_context.enterprise_saved", { name: connection.name }));
    } catch (connectError) {
      setError(connectionErrorMessage(connectError));
    } finally {
      setConnecting(false);
    }
  };

  return (
    <Page>
      <PageBackground />
      <PageTitlebarRegion />
      <PageContainer>
        <PageHeader>
          <PageTitle>{t("work_context.title")}</PageTitle>
          <PageDescription>{t("work_context.description")}</PageDescription>
        </PageHeader>

        <PageContent className="gap-5">
          <RadioGroup value={selected} onValueChange={setSelected} className="gap-2">
            <ContextRow
              checked={selected === PERSONAL_CONTEXT}
              value={PERSONAL_CONTEXT}
              title={t("work_context.personal_title")}
              description={t("work_context.personal_description")}
              icon={<ComputerDesktopIcon className="size-5" />}
            />

            {connections.length ? (
              <div className="mt-2 space-y-2">
                <div className="px-1 text-xs font-medium text-muted-foreground">
                  {t("work_context.enterprise_list_title")}
                </div>
                {connections.map((connection) => (
                  <ContextRow
                    key={connection.id}
                    checked={selected === enterpriseContext(connection.id)}
                    value={enterpriseContext(connection.id)}
                    title={connection.name}
                    meta={connection.origin}
                    description={t("work_context.enterprise_requires_signin")}
                    icon={<EnterpriseLogo connection={connection} />}
                  />
                ))}
              </div>
            ) : null}
          </RadioGroup>

          {showEnterpriseInput ? (
            <div className="rounded-xl border border-border bg-muted/20 p-4">
              <div className="mb-3 flex items-center gap-2">
                <BuildingOffice2Icon className="size-4 text-muted-foreground" />
                <div className="text-sm font-medium text-foreground">
                  {t("work_context.enterprise_add_title")}
                </div>
              </div>
              <label className="grid gap-2 text-xs font-medium text-muted-foreground">
                {t("work_context.enterprise_url_label")}
                <Input
                  value={serverUrl}
                  onChange={(event) => setServerUrl(event.currentTarget.value)}
                  placeholder={t("work_context.enterprise_url_placeholder")}
                  disabled={connecting}
                  aria-invalid={error ? true : undefined}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </label>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {t("work_context.enterprise_url_hint")}
              </p>
              {error ? (
                <p className="mt-2 text-xs text-destructive" role="alert">{error}</p>
              ) : null}
              <div className="mt-3 flex justify-end gap-2">
                {connections.length ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setShowEnterpriseInput(false);
                      setError(null);
                    }}
                    disabled={connecting}
                  >
                    {t("common.cancel")}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void connectEnterprise()}
                  disabled={connecting || !serverUrl.trim()}
                >
                  {connecting ? t("work_context.enterprise_connecting") : t("work_context.enterprise_connect")}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              variant="ghost"
              className="self-start"
              onClick={() => {
                setShowEnterpriseInput(true);
                setNotice(null);
              }}
            >
              <PlusIcon className="size-4" />
              {t("work_context.enterprise_add_another")}
            </Button>
          )}

          {notice ? (
            <p className="text-xs leading-relaxed text-muted-foreground" role="status">{notice}</p>
          ) : null}
        </PageContent>

        <PageFooter>
          {selectedEnterprise ? (
            <p className="text-center text-xs leading-relaxed text-muted-foreground">
              {t("work_context.enterprise_auth_pending", { name: selectedEnterprise.name })}
            </p>
          ) : null}
          <Button
            size="lg"
            className="w-full"
            disabled={selectedEnterprise !== null}
            onClick={() => navigate("/session", { replace: true })}
          >
            {selectedEnterprise
              ? t("work_context.enterprise_auth_required")
              : t("work_context.continue_personal")}
          </Button>
        </PageFooter>
      </PageContainer>
    </Page>
  );
}
