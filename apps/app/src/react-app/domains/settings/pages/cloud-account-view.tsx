/** @jsxImportSource react */
import * as React from "react";
import { ArrowUpRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import { SignInFallbackNotice } from "@/react-app/domains/cloud/signin-fallback-notice";
import { CloudAccountSection } from "../cloud/cloud-account-section";
import { useCloudSession } from "../cloud/cloud-session-provider";
import { CloudDevMode } from "../cloud/dev-mode";
import type { useDenSession } from "../cloud/use-den-session";
import {
  SettingsInset,
  SettingsNotice,
  SettingsSection,
  SettingsSectionHeaderDescription,
  SettingsStack,
} from "../settings-section";

type CloudAccountSession = Pick<
  ReturnType<typeof useDenSession>,
  | "authBusy"
  | "authError"
  | "baseUrlBusy"
  | "baseUrlDraft"
  | "baseUrlError"
  | "orgs"
  | "orgsBusy"
  | "orgsError"
  | "sessionBusy"
  | "signinFallbackUrl"
  | "summaryLabel"
  | "summaryTone"
  | "onApplyBaseUrl"
  | "onBaseUrlDraftChange"
  | "onClearAuthError"
  | "onOpenBrowserAuth"
  | "onOpenControlPlane"
  | "onResetBaseUrl"
  | "onSignOut"
  | "onSubmitManualAuth"
>;

export type CloudAccountViewProps = {
  developerMode: boolean;
  session: CloudAccountSession;
};

type DenSignedOutPanelProps = Pick<
  CloudAccountSession,
  | "authBusy"
  | "authError"
  | "onOpenBrowserAuth"
  | "onSubmitManualAuth"
  | "sessionBusy"
  | "signinFallbackUrl"
> & {
  authPending: boolean;
  statusMessage: string | null;
};

function isTimeoutError(message: string) {
  return /(?:timed?\s*out|timeout)/i.test(message);
}

function CloudErrorDetails({ message }: { message: string }) {
  return (
    <details className="text-xs text-muted-foreground">
      <summary className="w-fit cursor-pointer select-none font-medium underline-offset-4 hover:underline">
        {t("den.error_details")}
      </summary>
      <div className="mt-2 rounded-lg bg-foreground/[0.04] px-3 py-2 font-mono text-[11px] leading-5">
        {message}
      </div>
    </details>
  );
}

function DenSignedOutPanel({
  authBusy,
  authError,
  authPending,
  onOpenBrowserAuth,
  onSubmitManualAuth,
  sessionBusy,
  signinFallbackUrl,
  statusMessage,
}: DenSignedOutPanelProps) {
  const [manualAuthOpen, setManualAuthOpen] = React.useState(false);
  const [manualAuthInput, setManualAuthInput] = React.useState("");
  const controlsDisabled = [authBusy, sessionBusy].some(Boolean);

  React.useEffect(() => {
    if (signinFallbackUrl) setManualAuthOpen(true);
  }, [signinFallbackUrl]);

  const submitManualAuth = async () => {
    const ok = await onSubmitManualAuth(manualAuthInput);
    if (!ok) return;
    setManualAuthInput("");
    setManualAuthOpen(false);
  };

  const authInterrupted = Boolean(authError || signinFallbackUrl);

  return (
    <Collapsible
      open={manualAuthOpen}
      onOpenChange={setManualAuthOpen}
      disabled={controlsDisabled}
      data-testid="cloud-account-state"
      className="flex flex-col gap-5"
    >
      {authInterrupted ? (
        <div className="flex flex-col gap-3" role="alert">
          <div className="space-y-1">
            <div className="text-sm font-medium text-dls-text">{t("den.needs_attention")}</div>
            <div className="max-w-[54ch] text-sm leading-5 text-muted-foreground">
              {authError && isTimeoutError(authError)
                ? t("den.error_signin_timeout")
                : t("den.error_signin_failed")}
            </div>
          </div>
          <Button className="w-fit" onClick={() => onOpenBrowserAuth("sign-in")} disabled={controlsDisabled}>
            {t("den.retry_signin")}
            <ArrowUpRight size={13} />
          </Button>
          {authError ? <CloudErrorDetails message={authError} /> : null}
        </div>
      ) : authPending ? (
        <div className="space-y-1" role="status" aria-live="polite">
          <div className="text-sm font-medium text-dls-text">{t("den.signing_in")}</div>
          <div className="max-w-[54ch] text-sm leading-5 text-muted-foreground">
            {statusMessage ?? t("den.auto_reconnect_hint")}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3">
          <SettingsSectionHeaderDescription className="max-w-[54ch]">
            {t("den.cloud_section_desc")}
          </SettingsSectionHeaderDescription>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => onOpenBrowserAuth("sign-in")} disabled={controlsDisabled}>
              {t("den.signin_button")}
              <ArrowUpRight size={13} />
            </Button>
            <CollapsibleTrigger
              render={<Button variant="outline" disabled={controlsDisabled} />}
            >
              {manualAuthOpen ? t("den.hide_signin_code") : t("den.use_signin_code")}
            </CollapsibleTrigger>
          </div>
          <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <span>{t("den.no_account")}</span>
            <Button
              variant="link"
              size="sm"
              className="h-auto px-0 text-xs"
              onClick={() => onOpenBrowserAuth("sign-up")}
            >
              {t("den.create_account")}
            </Button>
          </div>
        </div>
      )}

      {signinFallbackUrl ? <SignInFallbackNotice url={signinFallbackUrl} /> : null}

      {authPending || authInterrupted ? (
        <CollapsibleTrigger
          render={(
            <Button
              variant="link"
              size="sm"
              className="h-auto w-fit self-start px-0 text-xs"
              disabled={controlsDisabled}
            />
          )}
        >
          {manualAuthOpen ? t("den.hide_signin_code") : t("den.use_signin_code")}
        </CollapsibleTrigger>
      ) : null}

      <CollapsibleContent>
        <SettingsInset className="flex flex-col gap-y-3 bg-foreground/[0.02]">
          <Field data-disabled={controlsDisabled}>
            <FieldLabel htmlFor="den-signin-link">{t("den.signin_link_label")}</FieldLabel>
            <Input
              id="den-signin-link"
              value={manualAuthInput}
              onChange={(event) => setManualAuthInput(event.currentTarget.value)}
              placeholder={t("den.signin_link_placeholder")}
              disabled={controlsDisabled}
            />
            <FieldDescription className="text-xs">{t("den.signin_link_hint")}</FieldDescription>
          </Field>
          <Button
            className="w-fit"
            onClick={() => void submitManualAuth()}
            disabled={[controlsDisabled, !manualAuthInput.trim()].some(Boolean)}
          >
            {authBusy ? t("den.finishing") : t("den.finish_signin")}
          </Button>
        </SettingsInset>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function CloudAccountView({ developerMode, session }: CloudAccountViewProps) {
  const { isSignedIn, statusMessage } = useCloudSession();
  const browserAuthPending = [t("den.status_browser_signin"), t("den.status_browser_signup")].includes(
    statusMessage ?? "",
  );
  const authPending = session.authBusy || session.sessionBusy || browserAuthPending;
  const authInterrupted = Boolean(session.authError || session.signinFallbackUrl);
  const accountState = isSignedIn
    ? "signed-in"
    : authInterrupted
      ? "failed"
      : authPending
        ? "signing-in"
        : "signed-out";

  return (
    <SettingsStack className="max-w-[760px]">
      <div data-testid="cloud-account-content" data-state={accountState}>
        <SettingsSection className="gap-5">
          {developerMode ? (
            <CloudDevMode
              authBusy={session.authBusy}
              baseUrlBusy={session.baseUrlBusy}
              baseUrlDraft={session.baseUrlDraft}
              onApplyBaseUrl={session.onApplyBaseUrl}
              onBaseUrlDraftChange={session.onBaseUrlDraftChange}
              onOpenControlPlane={session.onOpenControlPlane}
              onResetBaseUrl={session.onResetBaseUrl}
              sessionBusy={session.sessionBusy}
            />
          ) : null}

          {session.baseUrlError ? <SettingsNotice tone="error">{session.baseUrlError}</SettingsNotice> : null}

          {isSignedIn && session.authError ? (
            <SettingsNotice tone="error" className="space-y-1">
              <div className="font-medium">{t("den.cloud_unavailable_title")}</div>
              <div>{t("den.cloud_unavailable_body")}</div>
              <CloudErrorDetails message={session.authError} />
            </SettingsNotice>
          ) : null}

          {!isSignedIn ? (
            <DenSignedOutPanel
              key="signed-out-account"
              authBusy={session.authBusy}
              authError={session.authError}
              authPending={authPending}
              onOpenBrowserAuth={session.onOpenBrowserAuth}
              onSubmitManualAuth={session.onSubmitManualAuth}
              sessionBusy={session.sessionBusy}
              signinFallbackUrl={session.signinFallbackUrl}
              statusMessage={statusMessage}
            />
          ) : null}

          <CloudAccountSection
            key="account-workspaces"
            authBusy={session.authBusy}
            sessionBusy={session.sessionBusy}
            statusLabel={session.summaryLabel}
            statusTone={session.summaryTone}
            onSignOut={session.onSignOut}
            onSignInRequired={() => session.onOpenBrowserAuth("sign-in")}
          />
        </SettingsSection>
      </div>
    </SettingsStack>
  );
}
