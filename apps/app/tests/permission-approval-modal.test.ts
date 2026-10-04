import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ConversationPermission } from "../src/react-app/domains/session/engine/conversation-engine";

import {
  PermissionApprovalPanel,
  PermissionAllowMenu,
  PendingConfirmationNotice,
  permissionDetailRows,
} from "../src/react-app/domains/session/chat/permission-approval-modal";

const permissionPanelUrl = new URL(
  "../src/react-app/domains/session/chat/permission-approval-modal.tsx",
  import.meta.url,
);

function pendingPermission(overrides: Partial<ConversationPermission> = {}): ConversationPermission {
  return {
    id: "permission-1",
    sessionId: "session-1",
    kind: "bash",
    resources: ["rm -rf dist"],
    remember: [],
    metadata: {},
    receivedAt: 1,
    native: null,
    ...overrides,
  };
}

describe("permission approval modal helpers", () => {
  test("a missing approval has an explicit waiting notice and a stop action, never an allow action", () => {
    let stops = 0;
    const html = renderToStaticMarkup(React.createElement(PendingConfirmationNotice, { waitingFor: "approval", onStop: () => { stops += 1; } }));
    expect(html).toContain('role="status"');
    expect(html).toContain('data-testid="pending-confirmation-notice"');
    expect(html).toContain("Confirmation details unavailable");
    expect(html).toContain("Stop this run");
    expect(html).not.toContain("Allow once");
    expect(stops).toBe(0);
  });
  test("surfaces risk-bearing metadata as review rows", () => {
    expect(
      permissionDetailRows({
        command: "rm -rf dist",
        description: "Remove build output",
        cwd: "/workspace/project",
        filepath: "/workspace/project/src/app.ts",
        diff: "-old\n+new",
        output: "not shown before approval",
      }).map((row) => [row.label, row.value]),
    ).toEqual([
      ["Command", "rm -rf dist"],
      ["Description", "Remove build output"],
      ["Working directory", "/workspace/project"],
      ["File", "/workspace/project/src/app.ts"],
      ["Diff", "-old\n+new"],
    ]);
  });

  test("deduplicates alternate file metadata keys", () => {
    expect(
      permissionDetailRows({
        filepath: "/workspace/project/a.ts",
        filePath: "/workspace/project/b.ts",
      }).map((row) => [row.label, row.value]),
    ).toEqual([["File", "/workspace/project/a.ts"]]);
  });

  test("summarizes apply-patch file metadata", () => {
    expect(
      permissionDetailRows({
        files: [
          { type: "add", relativePath: "src/new.ts" },
          { type: "delete", filePath: "/workspace/project/src/old.ts" },
          { type: "", path: "src/update.ts" },
        ],
      }).map((row) => [row.label, row.value]),
    ).toEqual([
      ["Files", "add: src/new.ts\ndelete: /workspace/project/src/old.ts\nchange: src/update.ts"],
    ]);
  });

  test("keeps keyboard order on the safer one-shot approval before session approval", async () => {
    const html = renderToStaticMarkup(
      React.createElement(PermissionApprovalPanel, {
        permission: pendingPermission(),
        respondPermission: () => {},
      }),
    );

    const buttonLabels = Array.from(html.matchAll(/<button\b[\s\S]*?<\/button>/g)).map((match) =>
      match[0].replace(/<[^>]*>/g, "").trim(),
    );

    expect(buttonLabels).toEqual(["Deny", "Allow once", ""]);
    expect(html).not.toContain("Allow for session");
    expect(html).toContain('data-testid="permission-allow-once"');
    expect(html).toContain('data-testid="permission-allow-options"');
    const source = await Bun.file(permissionPanelUrl).text();
    expect(source).toContain('props.respondPermission?.(props.permissionId, "always")');
    expect(source).toContain('t("session.allow_for_session")');
    expect(source).toContain('t("session.permission_decision_hint")');
    expect(source).toContain("<DropdownMenuGroup>");
  });

  test("the primary action approves once directly while the separate menu trigger never approves", () => {
    const replies: Array<[string, "once" | "always" | "reject"]> = [];
    const element = PermissionAllowMenu({ permissionId: "native-permission", respondPermission: (id, reply) => { replies.push([id, reply]); } });
    const [primary, menu] = React.Children.toArray(element.props.children);
    if (!React.isValidElement<{ onClick: () => void; disabled: boolean }>(primary)) throw new Error("Missing primary permission button");
    if (!React.isValidElement<{ children: React.ReactNode }>(menu)) throw new Error("Missing independent permission menu");
    const [trigger] = React.Children.toArray(menu.props.children);
    if (!React.isValidElement<{ onClick?: () => void; render: React.ReactElement<{ onClick?: () => void }> }>(trigger)) throw new Error("Missing menu trigger");

    expect(trigger.props.onClick).toBeUndefined();
    trigger.props.render.props.onClick?.();
    expect(replies).toEqual([]);
    expect(primary.props.disabled).toBe(false);
    primary.props.onClick();
    expect(replies).toEqual([["native-permission", "once"]]);
  });

  test("both permission controls stay disabled while replying or when no reply handler exists", () => {
    for (const props of [{ busy: true, respondPermission: () => {} }, {}]) {
      const html = renderToStaticMarkup(React.createElement(PermissionAllowMenu, { permissionId: "permission", ...props }));
      const buttons = Array.from(html.matchAll(/<button\b[\s\S]*?<\/button>/g), (match) => match[0]);
      expect(buttons).toHaveLength(2);
      expect(buttons.every((button) => /\bdisabled=""/.test(button))).toBe(true);
    }
  });

  test("uses readable labels for generic permission titles", () => {
    const html = renderToStaticMarkup(
      React.createElement(PermissionApprovalPanel, {
        permission: pendingPermission({ kind: "todowrite" }),
        respondPermission: () => {},
      }),
    );

    expect(html).toContain("Approve Todo write?");
    expect(html).not.toContain("Approve todowrite?");
  });
});
