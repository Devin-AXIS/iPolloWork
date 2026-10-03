/** @jsxImportSource react */
import type * as React from "react";
import { RefreshCcw } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type SettingsContentProps = {
  children: React.ReactNode;
};

export function SettingsContent(props: SettingsContentProps) {
  return (
    <div data-settings-content className="min-h-0 min-w-0 flex-1 overflow-y-auto px-8 py-4 md:py-6 lg:py-8 min-[1600px]:px-12 min-[1920px]:px-16">
      <div data-settings-safe-area className="mx-auto flex w-full max-w-[1280px] flex-col items-center gap-6 md:gap-8 [&>*]:w-full">
        {props.children}
      </div>
    </div>
  );
}

export const settingsStandardContentClass = "mx-auto w-full max-w-[960px]";

type SettingsPanelProps = {
  children: React.ReactNode;
};

export function SettingsPanel(props: SettingsPanelProps) {
  return (
    <div
      className={cn(
        settingsStandardContentClass,
        "flex flex-col gap-3 md:flex-row md:items-center md:justify-between",
      )}
    >
      {props.children}
    </div>
  );
}

type SettingsPanelHeadingProps = {
  children: React.ReactNode;
  className?: string;
};

export function SettingsPanelHeading(props: SettingsPanelHeadingProps) {
  return <div className={cn("flex flex-col gap-y-1", props.className)}>{props.children}</div>;
}

type SettingsPanelTitleProps = {
  children: React.ReactNode;
  className?: string;
};

export const settingsPageTitleClass = "text-2xl font-semibold leading-8 text-dls-text";
export const settingsPageDescriptionClass = "settings-description mt-1.5 text-ui-control leading-5 text-dls-secondary";
export const settingsSectionTitleClass = "text-ui-body font-semibold text-dls-text";

export function SettingsPanelTitle(props: SettingsPanelTitleProps) {
  return <h2 className={cn(settingsPageTitleClass, props.className)}>{props.children}</h2>;
}

type SettingsPanelDescriptionProps = {
  children: React.ReactNode;
};

export function SettingsPanelDescription(props: SettingsPanelDescriptionProps) {
  return <p className="settings-description text-ui-control leading-5 text-muted-foreground">{props.children}</p>;
}

type SettingsPanelToolbarProps = {
  children: React.ReactNode;
};

export function SettingsPanelToolbar(props: SettingsPanelToolbarProps) {
  return <div className="mt-4 flex flex-col gap-y-2 md:mt-0 md:max-w-sm md:text-right">{props.children}</div>;
}

type SettingsPanelToolbarActionsProps = {
  children: React.ReactNode;
};

export function SettingsPanelToolbarActions(props: SettingsPanelToolbarActionsProps) {
  return <div className="flex flex-wrap items-center gap-2 md:justify-end">{props.children}</div>;
}

type SettingsPanelToolbarStatusProps = {
  tone?: string;
  title?: string;
  spinning?: boolean;
  children: React.ReactNode;
};

export function SettingsPanelToolbarStatus(props: SettingsPanelToolbarStatusProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-full border px-3 py-1.5 text-ui-compact shadow-sm",
        props.tone ?? "bg-gray-4/60 text-gray-11 border-gray-7/50",
      )}
      title={props.title}
    >
      {props.spinning ? <RefreshCcw size={12} className="animate-spin" /> : null}
      <span className="tabular-nums whitespace-nowrap">{props.children}</span>
    </div>
  );
}

type SettingsPanelToolbarButtonProps = {
  disabled?: boolean;
  title?: string;
  onClick?: () => void;
  children: React.ReactNode;
};

export function SettingsPanelToolbarButton(props: SettingsPanelToolbarButtonProps) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.title}
    >
      {props.children}
    </Button>
  );
}

type SettingsPanelToolbarMessageProps = {
  children: React.ReactNode;
};

export function SettingsPanelToolbarMessage(props: SettingsPanelToolbarMessageProps) {
  return <div className="text-ui-compact text-amber-11/90 md:max-w-sm">{props.children}</div>;
}
