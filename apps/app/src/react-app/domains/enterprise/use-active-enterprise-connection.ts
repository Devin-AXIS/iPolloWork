/** @jsxImportSource react */
import { useEffect, useState } from "react";

import {
  enterpriseConnectionsChangedEvent,
  enterpriseMembershipChangedEvent,
  refreshEnterpriseConnection,
  readEnterpriseConnections,
  saveEnterpriseConnection,
  type EnterpriseConnection,
  type EnterpriseMembershipChange,
} from "@/app/lib/enterprise-connections";
import { EnterpriseRequestError } from "@/app/lib/enterprise-client";
import { readActiveEnterpriseConnection, readActiveWorkContextId, enterpriseWorkContextId, workContextChangedEvent } from "@/app/lib/work-context";

import { t } from "@/i18n";
import { notifyEvent } from "@/react-app/shell/notifications";

function selectedConnection() {
  const context = readActiveWorkContextId();
  return readEnterpriseConnections().find(item => enterpriseWorkContextId(item.id) === context);
}

const pendingRefresh = new Map<string, Promise<EnterpriseConnection>>();

function refreshConnection(connection: EnterpriseConnection) {
  const connectionId = `${connection.id}:${connection.membership.id}:${connection.session.token}`;
  const pending = pendingRefresh.get(connectionId);
  if (pending) return pending;
  const promise = refreshEnterpriseConnection(connection).finally(() => {
    pendingRefresh.delete(connectionId);
  });
  pendingRefresh.set(connectionId, promise);
  return promise;
}

function membershipRoleLabels() {
  return {
    owner: t("enterprise_membership.role_owner"),
    admin: t("enterprise_membership.role_admin"),
    template_admin: t("enterprise_membership.role_template_admin"),
    extension_admin: t("enterprise_membership.role_extension_admin"),
    skill_admin: t("enterprise_membership.role_skill_admin"),
    mcp_admin: t("enterprise_membership.role_mcp_admin"),
    member: t("enterprise_membership.role_member"),
  } satisfies Record<EnterpriseConnection["membership"]["role"], string>;
}

function notifyMembershipChange(event: Event) {
  if (!(event instanceof CustomEvent)) return;
  const { name, before, after }: EnterpriseMembershipChange = event.detail;
  const state = after.removed ? "removed" : after.status ?? "active";
  const previous = before.removed ? "removed" : before.status ?? "active";
  const changes: string[] = [];
  if (previous !== state) {
    changes.push(t(state === "removed" ? "enterprise_membership.removed" : state === "suspended" ? "enterprise_membership.suspended"
      : state === "left" ? "enterprise_membership.left" : state === "invited" ? "enterprise_membership.invited"
      : "enterprise_membership.restored"));
  }
  if (before.role !== after.role) {
    const labels = membershipRoleLabels();
    changes.push(t("enterprise_membership.role_changed", {
      before: labels[before.role],
      after: labels[after.role],
    }));
  }
  const moved = before.departmentId !== undefined && before.departmentId !== after.departmentId;
  const renamed = before.departmentName && after.departmentName && before.departmentName !== after.departmentName;
  if (moved || renamed) {
    const unassigned = t("enterprise_membership.department_unassigned");
    const oldDepartment = before.departmentId === null ? unassigned : before.departmentName;
    const newDepartment = after.departmentId === null ? unassigned : after.departmentName;
    if (oldDepartment && newDepartment && oldDepartment !== newDepartment) {
      changes.push(t("enterprise_membership.department_changed", { before: oldDepartment, after: newDepartment }));
    } else if (newDepartment) {
      changes.push(t("enterprise_membership.department_current", { name: newDepartment }));
    } else {
      changes.push(t("enterprise_membership.department_name_unavailable"));
    }
  }
  if (!changes.length) return;
  notifyEvent({
    kind: "system",
    severity: state === "active" ? "info" : "warning",
    title: t(previous === state ? "enterprise_membership.details_title" : "enterprise_membership.notification_title", { name }),
    body: changes.join("\n"),
  });
}

export function useEnterpriseMembershipMonitor() {
  useEffect(() => {
    let backgroundIndex = 0;
    const refresh = (connection: EnterpriseConnection) => {
      if (Date.parse(connection.session.expiresAt) <= Date.now()) return;
      void refreshConnection(connection).catch((error: unknown) => {
        const current = readEnterpriseConnections().find(item => item.id === connection.id);
        if (error instanceof EnterpriseRequestError && error.status === 401 && current?.membership.id === connection.membership.id
          && current.session.token === connection.session.token) {
          saveEnterpriseConnection({ ...current, session: { ...current.session, expiresAt: new Date(0).toISOString() } });
          if (!current.membership.removed) notifyEvent({
            kind: "system",
            severity: "warning",
            title: t("enterprise_membership.notification_title", { name: current.name }),
            body: t("enterprise_membership.reconnect"),
          });
        }
      });
    };
    const refreshSelected = () => {
      const selected = selectedConnection();
      if (selected) refresh(selected);
    };
    const refreshVisible = () => {
      if (document.visibilityState !== "visible") return;
      refreshSelected();
      const selected = selectedConnection();
      const others = readEnterpriseConnections().filter(item => item.id !== selected?.id && Date.parse(item.session.expiresAt) > Date.now());
      const next = others[backgroundIndex % others.length];
      if (next) {
        backgroundIndex++;
        refresh(next);
      }
    };
    window.addEventListener(enterpriseMembershipChangedEvent, notifyMembershipChange);
    window.addEventListener(enterpriseConnectionsChangedEvent, refreshSelected);
    window.addEventListener(workContextChangedEvent, refreshSelected);
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    const interval = window.setInterval(refreshVisible, 15_000);
    refreshVisible();
    return () => {
      window.removeEventListener(enterpriseMembershipChangedEvent, notifyMembershipChange);
      window.removeEventListener(enterpriseConnectionsChangedEvent, refreshSelected);
      window.removeEventListener(workContextChangedEvent, refreshSelected);
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
      window.clearInterval(interval);
    };
  }, []);
}

export function useActiveEnterpriseConnection(): EnterpriseConnection | null {
  const [connection, setConnection] = useState<EnterpriseConnection | null>(() => readActiveEnterpriseConnection());
  useEffect(() => {
    const readStoredConnection = () => setConnection(readActiveEnterpriseConnection());
    window.addEventListener(enterpriseConnectionsChangedEvent, readStoredConnection);
    window.addEventListener(workContextChangedEvent, readStoredConnection);
    readStoredConnection();
    return () => {
      window.removeEventListener(enterpriseConnectionsChangedEvent, readStoredConnection);
      window.removeEventListener(workContextChangedEvent, readStoredConnection);
    };
  }, []);

  useEffect(() => {
    if (!connection) return;
    const delay = Math.max(0, Math.min(Date.parse(connection.session.expiresAt) - Date.now(), 2_147_483_647));
    const timer = window.setTimeout(() => setConnection(readActiveEnterpriseConnection()), delay);
    return () => window.clearTimeout(timer);
  }, [connection]);

  return connection;
}
