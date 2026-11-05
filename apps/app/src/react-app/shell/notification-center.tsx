/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bell,
  CircleCheck,
  Info,
  OctagonX,
  RefreshCw,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";
import { formatRelativeTime } from "@/app/utils";
import type { EnterpriseMessage } from "@ipollowork/types/enterprise";
import {
  useNotificationStore,
  type AppNotification,
  type NotificationSeverity,
} from "@/react-app/kernel/notification-store";
import { useNavigate } from "react-router-dom";
import { requestOpenModelPicker } from "./new-providers-listener";
import { useControlAction, type iPolloWorkControlAction } from "./control/control-provider";
import { openNotificationCenterEvent, requestOpenMarketplacePlugin } from "./notifications";
import { useReloadCoordinator } from "./reload-coordinator";
import { useShellConfig } from "./shell-config";
import { useActiveEnterpriseConnection } from "@/react-app/domains/enterprise";
import { EnterpriseMessageList, useEnterpriseMessages } from "@/react-app/domains/enterprise";

const SEVERITY_ICONS: Record<NotificationSeverity, LucideIcon> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  error: OctagonX,
};

const SEVERITY_CLASSES: Record<NotificationSeverity, string> = {
  info: "text-sky-11",
  success: "text-emerald-11",
  warning: "text-amber-11",
  error: "text-red-11",
};

type NotificationEntry =
  | { type: "local"; notification: AppNotification; timestamp: number }
  | { type: "enterprise"; message: EnterpriseMessage; timestamp: number };

/**
 * Notification bell with unread badge + popover panel. Mounted in the
 * session and settings headers; hidden via the `notifications` shell flag.
 * Closing the panel marks everything read.
 */
export function NotificationBell({ className }: { className?: string }) {
  const { config } = useShellConfig();
  const [open, setOpen] = useState(false);
  const notifications = useNotificationStore((state) => state.notifications);
  const markAllRead = useNotificationStore((state) => state.markAllRead);
  const clearAll = useNotificationStore((state) => state.clearAll);
  const reloadCoordinator = useReloadCoordinator();
  const navigate = useNavigate();
  const enterprise = useActiveEnterpriseConnection();
  const enterpriseInbox = useEnterpriseMessages(enterprise);
  const entries = useMemo<NotificationEntry[]>(() => [
    ...notifications.map<NotificationEntry>((notification) => ({ type: "local", notification, timestamp: notification.updatedAt })),
    ...enterpriseInbox.items.map<NotificationEntry>((message) => ({ type: "enterprise", message, timestamp: Date.parse(message.createdAt) })),
  ].sort((a, b) => b.timestamp - a.timestamp), [notifications, enterpriseInbox.items]);

  const notificationsListAction = useMemo<iPolloWorkControlAction>(() => ({
    id: "notifications.list",
    label: "List notifications",
    description: "Return the current notification center entries.",
    sideEffect: "none",
    execute: () => entries.map((entry) => {
      if (entry.type === "enterprise") return {
        id: entry.message.id, kind: entry.message.kind, severity: "info", title: entry.message.title,
        body: null, count: 1, readAt: entry.message.readAt, source: enterprise?.shortName,
        actionType: "open-enterprise-message", actionLabel: null,
      };
      const n = entry.notification;
      return {
        id: n.id, kind: n.kind, severity: n.severity, title: n.title, body: n.body,
        count: n.count, readAt: n.readAt, source: n.kind === "cloud" ? "iPolloCloud" : "iPolloWork",
        actionType: n.action?.type ?? null, actionLabel: n.actionLabel ?? null,
      };
    }),
  }), [entries, enterprise?.shortName]);
  useControlAction(notificationsListAction);

  const unreadCount = useMemo(
    () => notifications.filter((notification) => notification.readAt === null).length + enterpriseInbox.unread,
    [notifications, enterpriseInbox.unread],
  );

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener(openNotificationCenterEvent, handler);
    return () => window.removeEventListener(openNotificationCenterEvent, handler);
  }, []);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (!next) markAllRead();
    },
    [markAllRead],
  );

  const runAction = useCallback(
    (notification: AppNotification) => {
      const action = notification.action;
      if (!action) return;
      setOpen(false);
      markAllRead();
      if (action.type === "open-model-picker") {
        requestOpenModelPicker(action.providerIds);
      } else if (action.type === "reload-engine") {
        void reloadCoordinator.reloadWorkspaceEngine();
      } else if (action.type === "open-extensions-marketplace") {
        if (action.pluginName) {
          requestOpenMarketplacePlugin(action.pluginName);
        }
        navigate("/settings/cloud-marketplaces");
      } else if (action.type === "install-marketplace-plugin") {
        requestOpenMarketplacePlugin(action.pluginName);
        navigate("/settings/cloud-marketplaces");
      }
    },
    [markAllRead, navigate, reloadCoordinator],
  );

  if (!config.notifications) return null;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button
            data-testid="notification-center-trigger"
            variant="ghost"
            size="icon-sm"
            className={cn("rounded-xl text-gray-10 transition-colors hover:bg-muted hover:text-foreground", className)}
            title={t("notifications.title")}
            aria-label={
              unreadCount > 0
                ? `${t("notifications.title")} (${unreadCount})`
                : t("notifications.title")
            }
          >
            <Bell size={17} />
            {unreadCount > 0 ? (
              <span className="absolute right-0.5 top-0.5 flex min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold leading-3 text-primary-foreground">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            ) : null}
          </Button>
        }
      />
      <PopoverContent data-testid="notification-center" align="end" sideOffset={8} className="w-96 max-w-[calc(100vw-2rem)] gap-0 p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <p className="text-sm font-semibold">{t("notifications.title")}</p>
          <div className="flex items-center gap-1">
          {enterprise?.features?.messaging ? <Button variant="ghost" size="icon-sm" disabled={enterpriseInbox.loading} aria-label={t("notifications.refresh")} onClick={enterpriseInbox.refresh}><RefreshCw className="size-3.5" /></Button> : null}
          {entries.length > 0 ? (
            <Button
              data-testid="notification-clear-all"
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground"
              onClick={() => clearAll(enterpriseInbox.clearBoundary())}
            >
              {t("notifications.clear_all")}
            </Button>
          ) : null}
          </div>
        </div>
        <div className="max-h-96 overflow-y-auto py-1">
          {enterprise ? <EnterpriseMessageList key={`${enterprise.origin}:${enterprise.id}:${enterprise.membership.id}`} connection={enterprise} inbox={enterpriseInbox} onExit={() => setOpen(false)} renderMessages={(renderMessage) => entries.map((entry) => entry.type === "enterprise" ? renderMessage(entry.message) : <NotificationRow key={`local:${entry.notification.id}`} notification={entry.notification} onAction={runAction} />)} /> : notifications.map((notification) => <NotificationRow key={notification.id} notification={notification} onAction={runAction} />)}
        {entries.length === 0 && !enterpriseInbox.loading && !enterpriseInbox.error ? (
          <div className="flex flex-col items-center gap-1 px-6 py-10 text-center">
            <Bell className="mb-2 size-5 text-muted-foreground/60" />
            <p className="text-sm font-medium">{t("notifications.empty")}</p>
            <p className="text-xs text-muted-foreground">{t("notifications.empty_hint")}</p>
          </div>
        ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function NotificationRow({
  notification,
  onAction,
}: {
  notification: AppNotification;
  onAction: (notification: AppNotification) => void;
}) {
  const Icon = SEVERITY_ICONS[notification.severity];
  const unread = notification.readAt === null;
  const showCount =
    notification.count > 1 &&
    (notification.severity === "warning" || notification.severity === "error");

  return (
    <div
      data-notification-source={notification.kind === "cloud" ? "iPolloCloud" : "iPolloWork"}
      className={cn(
        "flex items-start gap-3 px-4 py-3",
        unread ? "bg-primary/5" : "opacity-80",
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", SEVERITY_CLASSES[notification.severity])} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-baseline justify-between gap-2">
          <p className="min-w-0 truncate text-sm font-medium">
            {notification.title}
            {showCount ? (
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                ×{notification.count}
              </span>
            ) : null}
          </p>
          <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
            {formatRelativeTime(notification.updatedAt)}
            {unread ? <span className="size-1.5 rounded-full bg-primary" /> : null}
          </span>
        </div>
        {notification.body ? (
          <p className="line-clamp-2 text-xs text-muted-foreground">{notification.body}</p>
        ) : null}
        <p className="text-xs text-muted-foreground">{t("notifications.source")}: {notification.kind === "cloud" ? "iPolloCloud" : "iPolloWork"}</p>
        {notification.action && notification.actionLabel ? (
          <div className="mt-1.5">
            <Button variant="outline" size="sm" onClick={() => onAction(notification)}>
              {notification.actionLabel}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
