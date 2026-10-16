/** @jsxImportSource react */
import type * as React from "react";
import { cn } from "@/lib/utils";
import { SettingsInset } from "./settings-section";
import { t } from "@/i18n";
import { SearchField, type SearchFieldProps } from "@/components/ui/search-field";

import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field"

export interface SettingsListProps {
  children: React.ReactNode;
  className?: string;
}

export function SettingsList({ children, className }: SettingsListProps) {
  return <div className={cn("flex flex-col gap-y-2", className)}>{children}</div>;
}

interface SettingsListEmptyStateProps {
  children: React.ReactNode;
  className?: string;
}

export function SettingsListEmptyState({ children, className }: SettingsListEmptyStateProps) {
  return (
    <SettingsInset className={cn("border-dashed py-6 text-center text-ui-control leading-5 text-muted-foreground", className)}>
      {children}
    </SettingsInset>
  );
}


export interface SettingsListTitleProps {
  children: React.ReactNode;
}

export function SettingsListTitle({ children }: SettingsListTitleProps) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

export interface SettingsListItemTitleProps {
  children: React.ReactNode;
}

export function SettingsListItemTitle({ children }: SettingsListItemTitleProps) {
  return <span className="truncate font-medium text-dls-text">{children}</span>;
}

export interface SettingsListItemProps {
  children: React.ReactNode;
  className?: string;
}

export function SettingsListItem({ children, className }: SettingsListItemProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between rounded-xl px-3 py-2 text-left text-ui-control transition-colors hover:bg-muted/10 hover:border-border border border-transparent",
        className,
      )}
    >
      {children}
    </div>
  );
}

interface SettingsListItemContentProps {
  children: React.ReactNode;
  className?: string;
}

export function SettingsListItemContent({ children, className }: SettingsListItemContentProps) {
  return <div className={cn("flex min-w-0 flex-col gap-y-1 pr-4", className)}>{children}</div>;
}

interface SettingsListItemActionsProps {
  children: React.ReactNode;
  className?: string;
}

export function SettingsListItemActions({ children, className }: SettingsListItemActionsProps) {
  return <div className={cn("flex shrink-0 items-center gap-2", className)}>{children}</div>;
}

interface SettingsListItemDescriptionProps {
  children: React.ReactNode;
  className?: string;
}

export function SettingsListItemDescription({ children, className }: SettingsListItemDescriptionProps) {
  return <div className={cn("mt-0.5 truncate text-ui-compact text-muted-foreground", className)}>{children}</div>;
}

export function SettingsListSearchInput({
  placeholder = "Search...",
  clearLabel = t("help.clear_search"),
  ...props
}: Omit<SearchFieldProps, "clearLabel"> & { clearLabel?: string }) {
  return <SearchField placeholder={placeholder} clearLabel={clearLabel} {...props} />;
}
