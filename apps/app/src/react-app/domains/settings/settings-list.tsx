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

export const settingsResourceGridClassName = "grid gap-x-8 gap-y-2 lg:grid-cols-2";

export function SettingsResourceListItem({ title, description, icon, badge, metadata, actions, onOpen, testId, copyTestId }: {
  title: string;
  description: string;
  icon: React.ReactNode;
  badge?: React.ReactNode;
  metadata?: React.ReactNode;
  actions: React.ReactNode;
  onOpen?: () => void;
  testId?: string;
  copyTestId?: string;
}) {
  const content = <>
    <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-[#f3f3f4] text-dls-secondary dark:bg-dls-hover">{icon}</span>
    <span data-testid={copyTestId} className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"><span title={title} className="max-w-full truncate text-ui-section-title font-semibold leading-5 tracking-[0.1px] text-dls-text">{title}</span>{badge}</span>
      <span className="line-clamp-2 text-ui-caption leading-[15px] text-dls-secondary">{description || t("connect.marketplace_no_description")}</span>
      {metadata ? <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-ui-caption text-dls-secondary">{metadata}</span> : null}
    </span>
  </>;
  const contentClassName = "flex min-w-0 flex-1 basis-48 items-center gap-4 rounded-lg text-left";
  return <article data-testid={testId} className="flex min-h-[74px] min-w-0 flex-wrap items-center gap-x-4 gap-y-3 rounded-[8px] bg-transparent px-4 py-2 transition-colors hover:bg-[#f6f7fb] focus-within:bg-[#f6f7fb] dark:hover:bg-dls-hover dark:focus-within:bg-dls-hover">
    {onOpen ? <button type="button" className={cn(contentClassName, "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30")} onClick={onOpen}>{content}</button> : <div className={contentClassName}>{content}</div>}
    <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2">{actions}</div>
  </article>;
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
