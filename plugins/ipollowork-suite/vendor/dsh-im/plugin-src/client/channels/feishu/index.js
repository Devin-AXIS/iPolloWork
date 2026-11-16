import { ConnectionError, normalizeConnectionError } from '../../connection-error.js';
import { BotName } from '../../bot-alias.js';
import * as React from "react";

import { FeishuLogoGlyph } from "../../channel-logos.js";
import { CredentialActionIcon, CredentialBindingPanel, QrActionIcon } from "../../credential-binding.js";
import { AccountSettingsToggle, CollapsibleAccountSection } from "../shared/collapsible-account.js";
import { h, localizeTemplate, localizeText } from "../../i18n.js";
import {
  FEISHU_ENDPOINTS,
  FEISHU_REGISTRATION_OPERATIONS,
  formatRemaining,
  normalizeBotsSnapshot,
  normalizePollResult,
  normalizeProvisioning,
  presentError,
  unwrapRpcResult,
} from "./api.js";
import { useAnimationFrameScheduler } from "../../lifecycle.js";
import { WorkspaceEditor } from "../../workspace-editor.js";
import { ContextEnhancementEditor } from "../../context-enhancement.js";
import {
  AgentPresetCatalogContext,
  AgentPresetEditor,
  EMPTY_AGENT_PRESET_CATALOG,
} from "../../agent-preset.js";
import {
  EMPTY_MODEL_CATALOG,
  ModelCatalogContext,
  ModelEditor,
} from "../../model-setting.js";
import { useWorkspaceSnapshotFence } from "../../workspace-snapshot-fence.js";
import {
  BotSettingsButton,
  BotStatusMeta,
  ChannelListHeading,
  LastMessageErrorSummary,
} from "../../channel-card-meta.js";
const CALLBACK_REPAIR_OPERATION = FEISHU_REGISTRATION_OPERATIONS.CALLBACK_REPAIR;
const GROUP_MESSAGE_PERMISSION_OPERATION = FEISHU_REGISTRATION_OPERATIONS.GROUP_MESSAGE_PERMISSION;

function isCallbackRepair(value) {
  return value?.operation === CALLBACK_REPAIR_OPERATION;
}

function isGroupMessagePermission(value) {
  return value?.operation === GROUP_MESSAGE_PERMISSION_OPERATION;
}

function isTargetedAppUpdate(value) {
  return isCallbackRepair(value) || isGroupMessagePermission(value);
}

function SvgIcon({ children, size = 18, className, viewBox = "0 0 24 24" }) {
  return h("svg", {
    width: size,
    height: size,
    viewBox,
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    "aria-hidden": "true",
    focusable: "false",
    className,
  }, children);
}

function ShieldIcon({ size = 18 }) {
  return h(SvgIcon, { size },
    h("path", {
      d: "M12 3 5.5 5.8v5.1c0 4.25 2.72 7.87 6.5 9.1 3.78-1.23 6.5-4.85 6.5-9.1V5.8L12 3Z",
      stroke: "currentColor", strokeWidth: "1.7", strokeLinejoin: "round",
    }),
    h("path", {
      d: "m9.3 11.8 1.7 1.7 3.8-4", stroke: "currentColor",
      strokeWidth: "1.7", strokeLinecap: "round", strokeLinejoin: "round",
    }),
  );
}

function RobotIcon({ size = 26 }) {
  return h(SvgIcon, { size },
    h("rect", {
      x: "5", y: "7.5", width: "14", height: "11", rx: "4",
      stroke: "currentColor", strokeWidth: "1.7",
    }),
    h("path", {
      d: "M12 4.5v3M8.7 12h.01M15.3 12h.01M9.2 15.3c1.67 1.08 3.93 1.08 5.6 0M3.5 11.5v3M20.5 11.5v3",
      stroke: "currentColor", strokeWidth: "1.7", strokeLinecap: "round",
    }),
  );
}

function SparkIcon({ size = 18 }) {
  return h(SvgIcon, { size },
    h("path", {
      d: "M12 2.8c.75 3.67 2.7 5.62 6.4 6.4-3.7.77-5.65 2.72-6.4 6.4-.75-3.68-2.7-5.63-6.4-6.4 3.7-.78 5.65-2.73 6.4-6.4Z",
      stroke: "currentColor", strokeWidth: "1.55", strokeLinejoin: "round",
    }),
    h("path", {
      d: "M5.2 15.8c.35 1.7 1.28 2.63 3 3-1.72.36-2.65 1.29-3 3-.36-1.71-1.29-2.64-3-3 1.71-.37 2.64-1.3 3-3ZM18.7 2.7c.22 1.06.79 1.63 1.85 1.85-1.06.22-1.63.79-1.85 1.85-.22-1.06-.79-1.63-1.85-1.85 1.06-.22 1.63-.79 1.85-1.85Z",
      fill: "currentColor",
    }),
  );
}

function RefreshIcon({ size = 16 }) {
  return h(SvgIcon, { size }, h("path", {
    d: "M19 7.5V4m0 0h-3.5M19 4l-2.1 2.1A7 7 0 1 0 19 13",
    stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round",
    strokeLinejoin: "round",
  }));
}

function ExternalIcon({ size = 15 }) {
  return h(SvgIcon, { size }, h("path", {
    d: "M13 5h6v6M19 5l-8.5 8.5M18 13.5V18a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4.5",
    stroke: "currentColor", strokeWidth: "1.7", strokeLinecap: "round",
    strokeLinejoin: "round",
  }));
}

function AlertIcon({ size = 22 }) {
  return h(SvgIcon, { size },
    h("path", {
      d: "M12 3.4 21 19H3L12 3.4Z", stroke: "currentColor",
      strokeWidth: "1.7", strokeLinejoin: "round",
    }),
    h("path", {
      d: "M12 9v4.4M12 16.6v.01", stroke: "currentColor",
      strokeWidth: "1.9", strokeLinecap: "round",
    }),
  );
}

function QrIcon({ size = 58 }) {
  return h(SvgIcon, { size }, h("path", {
    d: "M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h2v2h-2v-2Zm4 0h2v4h-2v-4Zm-4 4h4v2h-4v-2Z",
    fill: "currentColor",
  }));
}

const Button = React.forwardRef(function Button(
  { children, kind = "secondary", size, icon, className = "", ...props },
  ref,
) {
  return h("button", {
    ...props,
    ref,
    type: "button",
    className: `bxf-button ${className}`.trim(),
    "data-kind": kind,
    "data-size": size,
  }, icon, h("span", null, children));
});

function BrandMark() {
  return h("div", { className: "bxf-brandMark" }, h(RobotIcon, { size: 34 }));
}

function Heading({ totals, onAdd, onCredential, credentialOpen, adding, busy, addButtonRef }) {
  const hasBots = totals.configured > 0;
  return h("div", { className: "bxf-heading" },
    h("div", { className: "bxf-headingTools" },
      h("div", { className: "dim-bindActions" },
        h(Button, {
          kind: "primary",
          size: "small",
          className: "bxf-bindButton dim-scanButton",
          onClick: onAdd,
          disabled: adding || busy,
          ref: addButtonRef,
          "aria-busy": busy ? "true" : undefined,
          "aria-label": "扫码接入飞书机器人",
          icon: h(QrActionIcon),
        }, adding ? "正在接入" : "扫码接入机器人"),
        h(Button, {
          kind: "credential",
          size: "small",
          className: "dim-credentialButton",
          onClick: onCredential,
          disabled: adding || busy,
          "aria-pressed": credentialOpen,
          "aria-label": "使用 App ID 和 App Secret 绑定飞书机器人",
          icon: h(CredentialActionIcon),
        }, credentialOpen ? "收起凭据" : "手动接入")),
      hasBots
        ? h("div", {
            className: "bxf-totalBadge dim-onlineBadge",
            "aria-label": localizeTemplate('已接入 {configured} 个机器人，其中 {connected} 个在线', {
              configured: totals.configured,
              connected: totals.connected,
            }),
          }, h("span", null, localizeTemplate('{connected} / {configured} 在线', {
            connected: totals.connected,
            configured: totals.configured,
          })))
        : null,
    ),
  );
}

function LoadingView() {
  return h("div", {
    className: "bxf-card dim-surfaceCard dim-loadingView",
    "aria-busy": "true",
    "aria-label": "正在读取飞书机器人列表",
  },
    h("div", { className: "dim-spinner", "aria-hidden": "true" }),
    h("span", null, "正在读取飞书连接状态…"),
  );
}

function EmptyView({ onStart, busy }) {
  return h("div", { className: "bxf-card dim-surfaceCard" },
    h("div", { className: "bxf-cardBody bxf-intro dim-surfaceBody dim-emptyView" },
      h("div", { className: "bxf-introCopy dim-emptyCopy" },
        h("div", { className: "bxf-stateLabel dim-stateLabel" },
          h("span", { className: "bxf-dot dim-stateDot" }), h("span", null, "尚未接入机器人")),
        h("h3", null, "扫码，创建第一个飞书入口"),
        h("p", null, "无需手动填写 App ID。以后还可以继续添加机器人，分别服务不同团队或飞书租户。"),
        h("div", { className: "bxf-actions dim-viewActions" },
          h(Button, {
            kind: "primary", onClick: onStart,
            disabled: busy, "aria-busy": busy ? "true" : undefined,
          }, busy ? "正在生成二维码…" : "生成飞书二维码")),
      ),
      h("div", { className: "bxf-markStage dim-emptyBrand", "aria-hidden": "true" }, h(BrandMark)),
    ),
  );
}

function safeVerificationHref(value) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && [
        "accounts.feishu.cn",
        "accounts.larksuite.com",
        "open.feishu.cn",
        "open.larksuite.com",
      ].includes(url.hostname)
      && !url.port
      && !url.username
      && !url.password
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function safeQrSource(value) {
  if (!value) return undefined;
  return /^data:image\/(?:png|webp|svg\+xml)(?:;charset=[^;,]+)?;base64,/i.test(value)
    ? value
    : undefined;
}

function QrPane({ provision, now, onRefresh, onCancel, busy }) {
  const [imageFailed, setImageFailed] = React.useState(false);
  const qrSource = safeQrSource(provision.qrCodeDataUrl);
  const href = safeVerificationHref(provision.verificationUrl);
  const remaining = Math.max(0, provision.expiresAt - now);
  const expired = provision.expired === true || remaining === 0;
  const progress = Math.min(1, remaining / Math.max(1, provision.durationMs ?? remaining));
  const repairing = isCallbackRepair(provision);
  const grantingGroupMessages = isGroupMessagePermission(provision);
  const botName = provision.botName ?? "此机器人";

  React.useEffect(() => setImageFailed(false), [qrSource]);

  return h("div", { className: "bxf-card bxf-provisionCard dim-surfaceCard" },
    h("div", { className: "bxf-cardBody bxf-qrLayout dim-surfaceBody dim-qrLayout" },
      h("div", { className: "bxf-qrColumn dim-qrColumn" },
        h("div", { className: "bxf-qrFrame dim-qrFrame" },
          qrSource && !imageFailed
              ? h("img", {
                src: qrSource,
                alt: repairing
                  ? localizeTemplate('用于为{bot}补全权限与回调的一次性授权二维码', { bot: botName })
                  : grantingGroupMessages
                    ? localizeTemplate('用于为{bot}开通群消息权限的一次性授权二维码', { bot: botName })
                    : "用于新增 DeepSeek Harness 飞书机器人的一次性授权二维码",
                onError: () => setImageFailed(true),
              })
            : h("div", { className: "bxf-qrFallback dim-qrFallback" },
                h("div", null, h(QrIcon), h("span", null, "二维码未就绪，请打开授权链接"))),
          expired
            ? h("div", { className: "bxf-expiredOverlay dim-qrExpired", role: "status" },
                h("div", null, "二维码已失效", h("br"), "请刷新后重新扫码"))
            : null,
        ),
        h("div", {
          className: "bxf-countdown dim-countdown",
          "aria-label": expired
            ? "二维码已失效"
            : localizeTemplate('二维码剩余 {remaining}', { remaining: formatRemaining(remaining) }),
        },
          h("div", { className: "bxf-countdownTop dim-countdownTop", "aria-hidden": "true" },
            h("span", null, expired ? "等待刷新" : "二维码有效时间"),
            h("strong", null, formatRemaining(remaining))),
          h("div", { className: "bxf-progress dim-progress", "aria-hidden": "true" },
            h("span", { style: { "--bxf-progress": `${Math.round(progress * 100)}%` } })),
        ),
      ),
      h("div", { className: "bxf-qrCopy dim-qrCopy" },
        h("div", { className: "bxf-stateLabel dim-stateLabel" },
          h("span", { className: "bxf-dot dim-stateDot", "data-tone": "warning" }),
          h("span", null, repairing
            ? localizeTemplate('正在为「{bot}」补全权限与回调', { bot: botName })
            : grantingGroupMessages
              ? localizeTemplate('正在为「{bot}」开通群消息权限', { bot: botName })
              : "正在添加新机器人")),
        h("h3", null, expired
          ? "刷新二维码后继续"
          : repairing
            ? "使用飞书扫码补全权限"
            : grantingGroupMessages
              ? "使用飞书确认群消息权限"
              : "使用飞书扫码创建机器人"),
        h("p", null, repairing
          ? "扫码会更新现有飞书应用，增量补充当前缺少的卡片按钮回调、接收未 @ 群消息所需的 im:message.group_msg、读取用户消息内图片或文件所需的 im:message:readonly（飞书显示为“获取单聊、群组消息”）、上传机器人图片或文件所需的 im:resource、接收群内其他机器人 @ 当前机器人所需的 im:message.group_at_msg.include_bot:readonly，以及原生命令面板所需的 application:app_slash_command:read / write；不会创建新应用，群回复方式保持不变，实际收到的群消息和文件会自动保存。确认页只显示当前缺少项，完成后此机器人会短暂重连，其他机器人不受影响。"
          : grantingGroupMessages
            ? "扫码会更新现有飞书应用，只增量开通“获取群组中所有消息”权限；不会创建新应用。确认后会自动启用“响应所有群消息”，其他机器人不受影响。"
            : "扫码会新增一个机器人，并申请 im:message.group_msg（接收未 @ 的群消息）、im:message:readonly（读取消息中的图片或文件）等所需权限。新机器人默认仅 @ 时回复，实际收到的群消息和文件会自动保存；已接入的机器人继续正常收发消息。"),
        h("ol", { className: "bxf-steps dim-steps" },
          h("li", null, "打开飞书移动端，使用扫一扫读取二维码"),
          h("li", null, repairing
            ? "核对现有应用名称，并确认只新增当前缺少的上述配置"
            : grantingGroupMessages
              ? "核对现有应用，并确认“获取群组中所有消息”权限"
              : "核对应用名称与权限范围，并确认创建"),
          h("li", null, repairing
            ? "保持本页打开，等待权限与回调补全完成"
            : grantingGroupMessages
              ? "保持本页打开，等待权限生效并自动切换响应方式"
              : "保持本页打开，等待新机器人的长连接就绪")),
        h("div", { className: "bxf-actions dim-viewActions" },
          expired
            ? h(Button, {
                kind: "primary", onClick: onRefresh, disabled: busy,
              }, busy ? "刷新中…" : "刷新二维码")
            : href
              ? h("a", {
                  className: "bxf-button bxf-link", "data-kind": "secondary",
                  href, target: "_blank", rel: "noopener noreferrer",
                }, h("span", null, "在飞书中打开"))
              : null,
          !expired
            ? h(Button, { onClick: onRefresh, disabled: busy }, "换一个二维码")
            : null,
          h(Button, { onClick: onCancel, disabled: busy }, repairing
            ? "取消补全"
            : grantingGroupMessages ? "取消授权" : "取消添加")),
      ),
    ),
  );
}

function ProvisionProgress({ phase, provision, onCancel, busy }) {
  const connecting = phase === "connecting";
  const repairing = isCallbackRepair(provision);
  const grantingGroupMessages = isGroupMessagePermission(provision);
  return h("div", {
    className: "bxf-card bxf-provisionCard dim-surfaceCard dim-loadingView",
    "aria-busy": "true",
  },
    h("div", { className: "dim-spinner", "aria-hidden": "true" }),
    h("h3", null, connecting
      ? repairing
        ? "已确认，正在完成权限与回调配置"
        : grantingGroupMessages
          ? "已确认，正在启用全部消息模式"
          : "已确认，正在连接新机器人"
      : repairing
        ? "正在准备权限补全二维码"
        : grantingGroupMessages ? "正在准备权限授权二维码" : "正在准备授权二维码"),
    h("p", null, connecting
      ? repairing
        ? "配置已提交，正在保存权限、验证卡片回调并重连此机器人；此阶段无法取消，其他机器人不会中断。"
        : grantingGroupMessages
          ? "权限配置已提交，正在保存设置并重连此机器人；此阶段无法取消，其他机器人不会中断。"
          : "正在安全保存凭据并检查新机器人的消息通道，其他机器人不会中断。"
      : repairing
        ? "正在为现有飞书应用申请一次性更新二维码，请稍候。"
        : grantingGroupMessages
          ? "正在为现有飞书应用申请群消息权限二维码，请稍候。"
          : "正在向飞书申请一次性授权二维码，请稍候。"),
    connecting && onCancel
      ? h("div", { className: "bxf-actions dim-viewActions", style: { justifyContent: "center" } },
          h(Button, { onClick: onCancel, disabled: busy }, repairing
            ? "取消补全"
            : grantingGroupMessages ? "取消授权" : "取消添加"))
      : null,
  );
}

function ProvisionError({ error, provision, onRetry, onCancel, busy }) {
  const repairing = isCallbackRepair(provision);
  const grantingGroupMessages = isGroupMessagePermission(provision);
  return h("div", { className: "bxf-card bxf-provisionCard dim-surfaceCard" },
    h("div", { className: "bxf-inlineError dim-inlineError", role: "alert" },
      h("div", null,
        h("h3", null, repairing
          ? "权限与回调没有补全完成"
          : grantingGroupMessages ? "群消息权限没有开通完成" : "新机器人没有添加完成"),
        h(ConnectionError, { error: error }),
        error.code ? h("span", { className: "bxf-errorCode" }, error.code) : null,
        h("div", { className: "bxf-actions dim-viewActions" },
          h(Button, { kind: "primary", onClick: onRetry, disabled: busy },
            busy ? "重试中…" : "重新生成二维码"),
          h(Button, { onClick: onCancel, disabled: busy }, "关闭")),
      ),
    ),
  );
}

const HEALTH_LABELS = {
  connected: "运行正常",
  connecting: "正在连接",
  offline: "连接中断",
  error: "需要处理",
};

function formatCheckedTime(timestamp) {
  if (!timestamp) return "尚未检查";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).format(new Date(timestamp));
  } catch {
    return "刚刚";
  }
}

function connectionTestNotice(value) {
  if (value?.testMessage?.sent === true) {
    return '测试消息已发送，请到飞书会话中确认。';
  }
  if (value?.testMessage?.code === 'test-target-unavailable') {
    return '连接检查完成。机器人尚未收到可用于测试的私聊消息。';
  }
  return value?.testMessage ? '连接检查完成，但测试消息发送失败。' : null;
}

function RemoveConfirmation({ bot, busy, onConfirm, onCancel }) {
  const cancelRef = React.useRef(null);
  const idPart = bot.botId.replace(/[^a-zA-Z0-9_-]/g, "-");
  const titleId = `bxf-remove-title-${idPart}`;
  const descriptionId = `bxf-remove-description-${idPart}`;

  React.useEffect(() => cancelRef.current?.focus(), []);

  return h("div", {
    className: "bxf-confirm dim-confirm",
    role: "alertdialog",
    "aria-labelledby": titleId,
    "aria-describedby": descriptionId,
    onKeyDown: (event) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onCancel();
      }
    },
  },
    h("h4", { id: titleId }, localizeTemplate('从 DeepSeek Harness 移除“{name}”？', { name: bot.bot.name })),
    h("p", { id: descriptionId },
      "此操作会停止这个机器人的连接，并删除保存在本机的接入配置和凭据。飞书开放平台中的应用不会被自动删除，其他机器人也不受影响。"),
    h("div", { className: "bxf-actions dim-viewActions" },
      h(Button, { ref: cancelRef, onClick: onCancel, disabled: busy }, "保留机器人"),
      h(Button, { kind: "danger", onClick: onConfirm, disabled: busy },
        busy ? "正在移除…" : "确认移除接入")),
  );
}

/** One select for the step-push presentation. */
function StepPushEditor({ value = false, mode = "post", disabled = false, onSave, onModeSave }) {
  const titleId = React.useId();
  const helpId = `${titleId}-help`;
  const current = value === true ? mode : "off";
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState(null);

  const save = async (run) => {
    if (saving || disabled) return;
    setSaving(true);
    setError(null);
    try {
      await run();
    } catch (cause) {
      setError(cause?.message ?? "分步直推设置保存失败，请重试。");
    } finally {
      setSaving(false);
    }
  };

  const change = (event) => {
    const next = event.target.value;
    if (next === current) return;
    void save(async () => {
      if (next === "off") {
        // Turning off only needs the flag when it was on.
        if (value === true) await onSave?.(false);
        return;
      }
      const nextMode = ["streaming_card", "live_cot"].includes(next) ? next : "post";
      // Enabling (or switching presentation) may need both writes; the flag
      // must land before the mode so the runtime never sees a mode without
      // step push enabled.
      if (value !== true) await onSave?.(true);
      if (nextMode !== mode) await onModeSave?.(nextMode);
    });
  };

  const helpText = current === "off"
    ? "适合日常问答：执行过程中不显示工具调用等中间步骤，只回复最终结果"
    : current === "live_cot"
      ? "使用飞书原生思考过程展示推理、工具调用与结果，最终答案单独发送"
      : current === "streaming_card"
      ? "推荐长任务使用：过程与最终答案都在同一张卡片里实时更新，不刷屏"
      : "每一步都单独发一条消息（含工具调用和过程说明）；注意长任务会连续发送较多消息";

  return h("section", {
    className: "dim-feishuGroupControl",
    "aria-labelledby": titleId,
  },
  h("div", { className: "dim-feishuGroupControlHeader" },
    h("div", { className: "dim-presetTitle" },
      h("h3", { id: titleId }, "任务过程展示"),
      h("span", { className: "dim-presetHelp" },
        h("button", {
          type: "button",
          className: "dim-presetHelpButton",
          "aria-label": "查看分步直推说明",
          "aria-describedby": helpId,
        }, h("span", { "aria-hidden": "true" }, "?")),
        h("span", {
          id: helpId,
          className: "dim-presetTooltip",
          role: "tooltip",
        }, "设置任务执行过程的呈现方式：不显示、原生直播、实时卡片或逐步消息"))),
    saving
      ? h("span", { className: "dim-feishuGroupControlStatus", role: "status" }, "保存中…")
      : null),
  h("select", {
    className: "dim-feishuGroupSelect",
    value: current,
    disabled: disabled || saving,
    "aria-label": "任务过程展示",
    onChange: change,
  },
  h("option", { value: "off" }, "不显示过程（只发送最终答案）"),
  h("option", { value: "live_cot" }, "实时直播（飞书原生思考过程）"),
  h("option", { value: "streaming_card" }, "实时过程卡（全程一张卡片动态更新）"),
  h("option", { value: "post" }, "逐步直播（每一步单独发一条消息）")),
  h("p", { className: "dim-feishuGroupHelp" }, helpText),
  error ? h("p", {
    className: "dim-feishuGroupError",
    role: "alert",
  }, error) : null);
}

export function BotCard({
  connection,
  busy,
  repairDisabled,
  provisionContent,
  provisionRef,
  actionError,
  testNotice,
  removing,
  onReconnect,
  onRepairCallback,
  onWorkspaceSave,
  onAliasSave,
  onModelSave,
  onAgentPresetSave,
  onContextEnhancementSave,
  onStepPushSave,
  onStepPushModeSave,
  onRequestRemove,
  onConfirmRemove,
  onCancelRemove,
  cardRef,
  removeButtonRef,
}) {
  const { bot, health, state, connected } = connection;
  const repairTooltipId = React.useId();
  const stateForDisplay = busy === "reconnect"
    ? "connecting"
    : state;
  const tone = stateForDisplay === "connected"
    ? "success"
    : stateForDisplay === "connecting"
      ? "warning"
      : "error";
  const summary = actionError?.message
    ?? connection.error?.message
    ?? (connected ? null : health.summary);
  const titleId = `bxf-bot-${connection.botId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  return h("article", {
    className: "bxf-card bxf-botCard dim-botCard",
    "aria-labelledby": titleId,
    "data-bot-id": connection.botId,
    tabIndex: -1,
    ref: cardRef,
  },
    h("div", { className: "bxf-cardBody dim-botCardBody" },
      h(CollapsibleAccountSection, {
        settings: h(BotSettingsButton, {
          channel: "feishu",
          botId: connection.botId,
          botName: bot.name,
          connected,
          accessPolicy: connection.accessPolicy,
          channelSettings: {
            groupResponseMode: connection.groupResponseMode,
            mentionTopicReply: connection.mentionTopicReply,
            slashPanel: connection.slashPanel,
            groupMessagePermissionGranted: connection.groupMessagePermissionGranted,
          },
        }),
        id: `bxf-settings-${connection.botId.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
        header: h("div", { className: "bxf-connectedTop dim-botCardTop" },
          h("div", { className: "bxf-botIdentity dim-botIdentity" },
            h("div", { className: "bxf-avatar dim-botAvatar", "aria-hidden": "true" },
              h(FeishuLogoGlyph, { size: 34 })),
            h("div", { className: "bxf-botName dim-botName" },
              h(BotName, { bot, id: titleId, disabled: Boolean(busy), onSave: onAliasSave }),
              h("p", { title: bot.appIdMasked }, bot.appIdMasked ?? "应用标识已安全保存")),
          ),
          h("div", {
            className: "dim-botCardTools",
            // The header is the collapse toggle; keep inner controls clickable.
            onClick: (event) => { event.stopPropagation(); },
            onKeyDown: (event) => { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); },
          },
            h(BotStatusMeta, {
              className: "bxf-healthPill",
              dotClassName: "bxf-dot",
              tone,
              stateLabel: HEALTH_LABELS[stateForDisplay] ?? "状态未知",
              lastCheckedAt: health.lastCheckedAt,
              formatCheckedTime,
              healthState: stateForDisplay,
            }),
            h(AccountSettingsToggle))),
      },
        h(WorkspaceEditor, {
          workspace: connection.workspace,
          locked: connection.conversationDirectory?.enabled === true,
          disabled: Boolean(busy),
          onSave: onWorkspaceSave,
        }),
      h(ModelEditor, {
        model: connection.model,
        disabled: Boolean(busy),
        onSave: onModelSave,
      }),
      h(AgentPresetEditor, {
        agentPreset: connection.agentPreset,
        disabled: Boolean(busy),
        onSave: onAgentPresetSave,
      }),
      h(ContextEnhancementEditor, {
        config: connection.contextEnhancement,
        disabled: Boolean(busy),
        onSave: onContextEnhancementSave,
      }),
      h(StepPushEditor, {
        value: connection.stepPush,
        mode: connection.stepPushMode,
        disabled: Boolean(busy),
        onSave: onStepPushSave,
        onModeSave: onStepPushModeSave,
      }),
      provisionContent
        ? h("section", {
            className: "bxf-botProvision dim-botProvision",
            "aria-label": localizeTemplate('{bot}的飞书授权流程', { bot: bot.name }),
            "data-provision-for": connection.botId,
            ref: provisionRef,
            tabIndex: -1,
          }, provisionContent)
        : null,
      h("div", { className: "bxf-connectedFooter dim-cardFooter" },
        h("div", { className: "dim-cardFooterLayout" },
          h("div", { className: "bxf-actions bxf-botActions dim-cardActions" },
            h(Button, {
              className: "dim-cardAction", onClick: onReconnect,
              disabled: Boolean(busy), "aria-busy": busy === "reconnect" ? "true" : undefined,
              "aria-label": localizeTemplate(connected ? '检查连接{name}' : '重试连接{name}', { name: bot.name }),
            }, busy === "reconnect" ? (connected ? "检查中…" : "正在连接…") : connected ? "检查连接" : "重试连接"),
            h("span", { className: "bxf-repairAction" },
              h(Button, {
                className: "bxf-repairButton dim-cardAction",
                onClick: onRepairCallback,
                disabled: Boolean(busy) || repairDisabled,
                "aria-busy": busy === "callback-repair" ? "true" : undefined,
                "aria-label": localizeTemplate('为{bot}补全权限与回调', { bot: bot.name }),
                "aria-describedby": repairTooltipId,
              }, busy === "callback-repair" ? "等待扫码…" : "补全权限"),
              h("span", {
                id: repairTooltipId,
                className: "bxf-repairTooltip",
                role: "tooltip",
              },
                h("strong", null, "补全范围"),
                h("span", null, "增量添加当前缺少的卡片回调 card.action.trigger、接收未 @ 群消息所需的 im:message.group_msg、读取消息内图片或文件所需的 im:message:readonly（飞书显示为“获取单聊、群组消息”）、上传机器人图片或文件所需的 im:resource，以及原生命令面板所需的 application:app_slash_command:read / write；确认页只显示当前缺少项，不会创建新应用，群回复方式保持不变，实际收到的群消息和文件会自动保存。"))),
            h(Button, {
              className: "dim-cardAction", kind: "danger", onClick: onRequestRemove,
              disabled: Boolean(busy), ref: removeButtonRef,
              "aria-label": localizeTemplate('从 DeepSeek Harness 移除{name}', { name: bot.name }),
            }, "移除接入")),
          summary ? h("div", { className: "bxf-healthSummary dim-cardSummary", "data-error": actionError || connection.error ? "true" : undefined },
            summary) : null,
          (actionError || connection.error) ? h(ConnectionError, { error: actionError || connection.error, showMessage: false }) : null,
          connection.lastMessageError ? h(LastMessageErrorSummary, {
            className: "bxf-healthSummary",
            error: connection.lastMessageError,
          }) : null,
          testNotice ? h("div", {
            className: "bxf-healthSummary dim-cardFeedback",
            role: "status",
          }, testNotice) : null),
        ),
      ),
    ),
    removing
      ? h(RemoveConfirmation, {
          bot: connection,
          busy: busy === "delete",
          onConfirm: onConfirmRemove,
          onCancel: onCancelRemove,
        })
      : null,
  );
}

function BotList(props) {
  return h("section", { className: "bxf-listSection dim-listSection", "aria-labelledby": "bxf-bot-list-title" },
    h(ChannelListHeading, {
      className: "bxf-listHeading",
      id: "bxf-bot-list-title",
      title: "已接入的机器人",
      connectionLabel: "长连接",
    }),
    h("ul", { className: "bxf-botList dim-botList", role: "list" },
      props.bots.map((bot) => h("li", { key: bot.botId },
        h(BotCard, {
          connection: bot,
          busy: props.busyByBot[bot.botId]
            ?? (isTargetedAppUpdate(props.provisioning)
              && props.provisioning.botId === bot.botId ? props.provisioning.operation : undefined),
          repairDisabled: Boolean(props.provisioning),
          provisionContent: isTargetedAppUpdate(props.provisioning)
            && props.provisioning.botId === bot.botId
            ? props.provisionContent
            : null,
          provisionRef: props.provisionRef,
          actionError: props.errorsByBot[bot.botId],
          testNotice: props.testNoticesByBot[bot.botId],
          removing: props.removeTargetId === bot.botId,
          onReconnect: () => props.onReconnect(bot),
          onRepairCallback: () => props.onRepairCallback(bot),
          onWorkspaceSave: (workspace) => props.onWorkspaceSave(bot, workspace),
          onAliasSave: (alias) => props.onAliasSave(bot, alias),
          onModelSave: (model) => props.onModelSave(bot, model),
          onAgentPresetSave: (agentPreset) => props.onAgentPresetSave(bot, agentPreset),
          onContextEnhancementSave: (config) => props.onContextEnhancementSave(bot, config),
          onStepPushSave: (stepPush) => props.onStepPushSave(bot, stepPush),
          onStepPushModeSave: (stepPushMode) => props.onStepPushModeSave(bot, stepPushMode),
          onRequestRemove: () => props.onRequestRemove(bot),
          onConfirmRemove: () => props.onConfirmRemove(bot),
          onCancelRemove: props.onCancelRemove,
          cardRef: (node) => props.setCardRef(bot.botId, node),
          removeButtonRef: (node) => props.setRemoveButtonRef(bot.botId, node),
        }),
      ))),
  );
}

function PageError({ error, onRetry, busy }) {
  return h("div", { className: "bxf-card dim-surfaceCard" },
    h("div", { className: "bxf-error dim-inlineError", role: "alert" },
      h("div", null,
        h("h3", null, "无法读取飞书机器人"),
        h(ConnectionError, { error: error }),
        error.code ? h("span", { className: "bxf-errorCode" }, error.code) : null,
        h("div", { className: "bxf-actions dim-viewActions" },
          h(Button, { kind: "primary", onClick: onRetry, disabled: busy },
            busy ? "重试中…" : "重新读取"))),
    ),
  );
}

const EMPTY_TOTALS = Object.freeze({ configured: 0, connected: 0 });

export function mergeFeishuSnapshotState(
  current,
  snapshot,
  { restoreProvisioning = false, now = Date.now() } = {},
) {
  if (snapshot.revision > 0 && current.revision > snapshot.revision) return current;
  let provisioning = current.provisioning;
  if (!provisioning && restoreProvisioning && snapshot.provisioning) {
    const submitted = snapshot.provisioning.submitted === true;
    provisioning = {
      phase: submitted || snapshot.state === "connecting" ? "connecting" : "qr",
      ...snapshot.provisioning,
      durationMs: Math.max(1, snapshot.provisioning.expiresAt - now),
      expired: !submitted && snapshot.provisioning.expiresAt <= now,
    };
  }
  return {
    ...current,
    phase: "ready",
    revision: snapshot.revision,
    bots: snapshot.bots,
    totals: snapshot.totals,
    provisioning,
    pageError: null,
    statusError: null,
    agentPresetCatalog: snapshot.agentPresetCatalog ?? current.agentPresetCatalog,
    modelCatalog: snapshot.modelCatalog ?? current.modelCatalog,
  };
}

export function FeishuSettingsTab({ rpcCall }) {
  const [operationError, setOperationError] = React.useState(null);
  const [model, setModel] = React.useState({
    phase: "loading",
    revision: 0,
    bots: [],
    totals: EMPTY_TOTALS,
    provisioning: null,
    pageError: null,
    statusError: null,
    agentPresetCatalog: EMPTY_AGENT_PRESET_CATALOG,
    modelCatalog: EMPTY_MODEL_CATALOG,
  });
  const [pageBusy, setPageBusy] = React.useState(false);
  const [provisionBusy, setProvisionBusy] = React.useState(false);
  const [credentialOpen, setCredentialOpen] = React.useState(false);
  const [credentialDomain, setCredentialDomain] = React.useState("feishu");
  const [credentialBusy, setCredentialBusy] = React.useState(false);
  const [credentialError, setCredentialError] = React.useState(null);
  const [busyByBot, setBusyByBot] = React.useState({});
  const [errorsByBot, setErrorsByBot] = React.useState({});
  const [testNoticesByBot, setTestNoticesByBot] = React.useState({});
  const [removeTargetId, setRemoveTargetId] = React.useState(null);
  const [announcement, setAnnouncement] = React.useState("");
  const [now, setNow] = React.useState(() => Date.now());
  const [focusBotId, setFocusBotId] = React.useState(null);
  const cardRefs = React.useRef(new Map());
  const removeButtonRefs = React.useRef(new Map());
  const targetedProvisionRef = React.useRef(null);
  const addButtonRef = React.useRef(null);
  const mountedRef = React.useRef(true);
  const workspaceFence = useWorkspaceSnapshotFence();
  const scheduleAnimationFrame = useAnimationFrameScheduler();

  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const announce = React.useCallback((message) => {
    setAnnouncement("");
    scheduleAnimationFrame(() => {
      if (message) setAnnouncement(message);
    }, "announcement");
  }, [scheduleAnimationFrame]);

  const invoke = React.useCallback(async (endpoint, payload = {}, signal) => {
    const operation = !['connection.status', 'provision.poll', 'provision.begin', 'provision.cancel'].includes(endpoint);
    if (operation && mountedRef.current) setOperationError(null);
    try {
      const value = unwrapRpcResult(await rpcCall(endpoint, payload, signal));
      if (operation && mountedRef.current) setOperationError(value?.testMessage?.error ?? value?.warnings?.[0] ?? null);
      return value;
    } catch (error) {
      if (endpoint === 'bot.delete' && mountedRef.current && !signal?.aborted && error?.name !== 'AbortError') setOperationError(normalizeConnectionError(error));
      throw error;
    }
  }, [rpcCall]);

  const mergeSnapshot = React.useCallback((snapshot, { restoreProvisioning = false } = {}) => {
    const now = Date.now();
    setModel((current) => mergeFeishuSnapshotState(
      current,
      snapshot,
      { restoreProvisioning, now },
    ));
  }, []);

  const loadStatus = React.useCallback(async ({ signal, silent = false, restoreProvisioning = false } = {}) => {
    const workspaceVersion = workspaceFence.beginStatus();
    if (workspaceVersion === null || !mountedRef.current) return undefined;
    if (!silent) setPageBusy(true);
    try {
      const snapshot = normalizeBotsSnapshot(await invoke(FEISHU_ENDPOINTS.status, {}, signal));
      if (signal?.aborted || !mountedRef.current
        || !workspaceFence.canCommitStatus(workspaceVersion)) return undefined;
      mergeSnapshot(snapshot, { restoreProvisioning });
      return snapshot;
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError" || !mountedRef.current
        || !workspaceFence.canCommitStatus(workspaceVersion)) return undefined;
      const presented = presentError(error);
      setModel((current) => current.phase === "loading" || !silent
        ? { ...current, phase: "error", pageError: presented }
        : { ...current, statusError: presented });
      return undefined;
    } finally {
      if (!silent && !signal?.aborted && mountedRef.current) setPageBusy(false);
    }
  }, [invoke, mergeSnapshot, workspaceFence]);

  React.useEffect(() => {
    const controller = new AbortController();
    void loadStatus({ signal: controller.signal, restoreProvisioning: true });
    return () => controller.abort();
  }, [loadStatus]);

  // One list request refreshes every bot. This continues while a new bot is
  // being provisioned so existing connections never disappear from the UI.
  React.useEffect(() => {
    if (model.phase !== "ready") return undefined;
    const controller = new AbortController();
    let inFlight = false;
    const timer = window.setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      await loadStatus({
        signal: controller.signal,
        silent: true,
        restoreProvisioning: false,
      });
      inFlight = false;
    }, 15_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [loadStatus, model.phase]);

  React.useEffect(() => {
    if (!focusBotId) return;
    const node = cardRefs.current.get(focusBotId);
    if (!node) return;
    node.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    node.focus({ preventScroll: true });
    setFocusBotId(null);
  }, [focusBotId, model.bots]);

  const targetedProvisionFocusKey = isTargetedAppUpdate(model.provisioning)
    ? `${model.provisioning.botId}:${model.provisioning.attemptId ?? "preparing"}:${model.provisioning.phase}`
    : null;
  React.useEffect(() => {
    if (!targetedProvisionFocusKey) return;
    scheduleAnimationFrame(() => {
      const node = targetedProvisionRef.current;
      if (!node) return;
      node.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
      node.focus?.({ preventScroll: true });
    }, "targeted-provision-focus");
  }, [scheduleAnimationFrame, targetedProvisionFocusKey]);

  const startProvisioning = React.useCallback(async ({
    replace = false,
    operation = FEISHU_REGISTRATION_OPERATIONS.PROVISION,
    bot,
  } = {}) => {
    const repairing = operation === CALLBACK_REPAIR_OPERATION;
    const grantingGroupMessages = operation === GROUP_MESSAGE_PERMISSION_OPERATION;
    const targetedUpdate = repairing || grantingGroupMessages;
    const botId = targetedUpdate ? bot?.botId ?? model.provisioning?.botId : undefined;
    const botName = targetedUpdate ? bot?.bot?.name ?? model.provisioning?.botName : undefined;
    if (targetedUpdate && !botId) return;
    setCredentialOpen(false);
    setCredentialError(null);
    setProvisionBusy(true);
    announce("");
    const previousAttemptId = model.provisioning?.attemptId;
    setModel((current) => ({
      ...current,
      phase: current.phase === "loading" ? "ready" : current.phase,
      provisioning: {
        phase: "creating",
        operation,
        ...(botId ? { botId } : {}),
        ...(botName ? { botName } : {}),
      },
    }));
    try {
      if (replace && previousAttemptId) {
        // A Host restart intentionally drops its in-memory registration map.
        // Replacing a stale browser attempt must still be able to start a new
        // authoritative attempt; both controller start paths already
        // supersede/deduplicate a still-live registration safely.
        try {
          await invoke(FEISHU_ENDPOINTS.cancelProvisioning, { attemptId: previousAttemptId });
        } catch {
          // Continue with begin. It is the source of truth for the new attempt.
        }
      }
      const endpoint = repairing
        ? FEISHU_ENDPOINTS.beginCallbackRepair
        : grantingGroupMessages
          ? FEISHU_ENDPOINTS.beginGroupMessagePermission
          : FEISHU_ENDPOINTS.beginProvisioning;
      const provision = normalizeProvisioning(await invoke(
        endpoint,
        targetedUpdate ? { botId } : { locale: "zh-CN" },
      ));
      if (targetedUpdate
        && (provision.operation !== operation || provision.botId !== botId)) {
        throw new Error(grantingGroupMessages
          ? "飞书服务返回了不匹配的群消息权限二维码"
          : "飞书服务返回了不匹配的权限补全二维码");
      }
      const timestamp = Date.now();
      setNow(timestamp);
      setModel((current) => ({
        ...current,
        provisioning: {
          phase: "qr",
          ...provision,
          ...(botName ? { botName } : {}),
          durationMs: Math.max(1, provision.expiresAt - timestamp),
          expired: false,
        },
      }));
      announce(repairing
        ? localizeTemplate('{bot}的权限补全二维码已生成，请使用飞书扫码。', { bot: botName ?? "机器人" })
        : grantingGroupMessages
          ? localizeTemplate('{bot}的群消息权限二维码已生成，请使用飞书确认。', { bot: botName ?? "机器人" })
          : "授权二维码已生成，请使用飞书扫码。");
    } catch (error) {
      setModel((current) => ({
        ...current,
        provisioning: {
          phase: "error",
          operation,
          ...(botId ? { botId } : {}),
          ...(botName ? { botName } : {}),
          ...(replace && previousAttemptId ? { attemptId: previousAttemptId } : {}),
          error: presentError(error),
        },
      }));
    } finally {
      setProvisionBusy(false);
    }
  }, [
    announce,
    invoke,
    model.provisioning?.attemptId,
    model.provisioning?.botId,
    model.provisioning?.botName,
  ]);

  const bindCredentials = React.useCallback(async ({ identity, secret }) => {
    const snapshotVersion = workspaceFence.beginMutation();
    setCredentialBusy(true);
    setCredentialError(null);
    try {
      const snapshot = normalizeBotsSnapshot(await invoke(
        FEISHU_ENDPOINTS.bindCredentials,
        { appId: identity, appSecret: secret, domain: credentialDomain },
      ));
      if (mountedRef.current && workspaceFence.canCommitMutation(snapshotVersion)) {
        mergeSnapshot(snapshot);
      }
      setCredentialOpen(false);
      announce(credentialDomain === "lark" ? "Lark 机器人凭据已绑定。" : "飞书机器人凭据已绑定。");
    } catch (error) {
      setCredentialError(presentError(error));
    } finally {
      const shouldRefresh = workspaceFence.endMutation();
      if (shouldRefresh && mountedRef.current) void loadStatus({ silent: true });
      setCredentialBusy(false);
    }
  }, [announce, credentialDomain, invoke, loadStatus, mergeSnapshot, workspaceFence]);

  const cancelProvisioning = React.useCallback(async () => {
    const activeProvision = model.provisioning;
    const attemptId = activeProvision?.attemptId;
    const repairing = isCallbackRepair(activeProvision);
    const grantingGroupMessages = isGroupMessagePermission(activeProvision);
    const targetedUpdate = isTargetedAppUpdate(activeProvision);
    const targetBot = targetedUpdate
      ? model.bots.find((bot) => bot.botId === activeProvision?.botId)
      : undefined;
    setProvisionBusy(true);
    try {
      const result = attemptId
        ? normalizePollResult(await invoke(FEISHU_ENDPOINTS.cancelProvisioning, { attemptId }))
        : null;
      if (targetedUpdate && result) {
        if (result.operation !== activeProvision.operation
          || result.botId !== activeProvision.botId) {
          throw new Error("飞书服务返回了不匹配的注册进度");
        }
        if (result.status === "connecting") {
          setModel((current) => current.provisioning?.attemptId === attemptId
            ? {
                ...current,
                provisioning: {
                  ...current.provisioning,
                  ...(result.provisioning ?? {}),
                  phase: "connecting",
                  submitted: true,
                  expired: false,
                },
              }
            : current);
          announce(grantingGroupMessages
            ? "权限配置已提交，正在启用全部消息模式并重连此机器人；此阶段无法取消，其他机器人不会中断。"
            : "配置已提交，正在保存权限、验证卡片回调并重连此机器人；此阶段无法取消，其他机器人不会中断。");
          return;
        }
        if (result.status === "connected") {
          const targetBotName = targetBot?.bot.name ?? activeProvision.botName ?? "机器人";
          setModel((current) => ({ ...current, provisioning: null }));
          announce(grantingGroupMessages
            ? localizeTemplate('{bot}已开通群消息权限，并启用“响应所有群消息”。', { bot: targetBotName })
            : localizeTemplate('{bot}的权限与回调已补全。', { bot: targetBotName }));
          if (activeProvision.botId) setFocusBotId(activeProvision.botId);
          await loadStatus({ silent: true, restoreProvisioning: false });
          return;
        }
      }
      setModel((current) => ({ ...current, provisioning: null }));
      announce(repairing
        ? "已取消补全权限与回调。"
        : grantingGroupMessages ? "已取消群消息权限授权。" : "已取消添加机器人。");
      await loadStatus({ silent: true, restoreProvisioning: false });
      scheduleAnimationFrame(() => {
        if (targetedUpdate && activeProvision.botId) {
          cardRefs.current.get(activeProvision.botId)?.focus();
        } else {
          addButtonRef.current?.focus();
        }
      }, "focus");
    } catch (error) {
      setModel((current) => ({
        ...current,
        provisioning: {
          ...activeProvision,
          phase: "error",
          attemptId,
          error: presentError(error),
        },
      }));
    } finally {
      setProvisionBusy(false);
    }
  }, [announce, invoke, loadStatus, model.bots, model.provisioning, scheduleAnimationFrame]);

  const countdownAttemptId = model.provisioning?.attemptId;
  const countdownPhase = model.provisioning?.phase;
  const countdownExpiresAt = model.provisioning?.expiresAt;
  const countdownExpired = model.provisioning?.expired;
  React.useEffect(() => {
    if (!countdownAttemptId || countdownPhase !== "qr" || countdownExpired) return undefined;
    const tick = () => {
      const timestamp = Date.now();
      setNow(timestamp);
      if (timestamp >= countdownExpiresAt) {
        setModel((current) => current.provisioning?.attemptId === countdownAttemptId
          ? { ...current, provisioning: { ...current.provisioning, expired: true } }
          : current);
      }
    };
    tick();
    const timer = window.setInterval(tick, 1_000);
    return () => window.clearInterval(timer);
  }, [countdownAttemptId, countdownPhase, countdownExpiresAt, countdownExpired]);

  React.useEffect(() => {
    const provision = model.provisioning;
    if (!provision
      || !["qr", "connecting"].includes(provision.phase)
      || !provision.attemptId
      || provision.expired) return undefined;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const result = normalizePollResult(await invoke(
          FEISHU_ENDPOINTS.pollProvisioning,
          { attemptId: provision.attemptId },
          controller.signal,
        ));
        if (result.operation !== provision.operation
          || (isTargetedAppUpdate(provision) && result.botId !== provision.botId)) {
          throw new Error("飞书服务返回了不匹配的注册进度");
        }
        if (result.status === "connected") {
          const snapshot = await loadStatus({ signal: controller.signal, silent: true, restoreProvisioning: false });
          const targetBot = snapshot?.bots.find((bot) => bot.botId === result.botId);
          if (!snapshot) {
            throw new Error(isCallbackRepair(provision)
              ? "权限与回调已更新，但暂时无法确认机器人连接状态"
              : isGroupMessagePermission(provision)
                ? "群消息权限已更新，但暂时无法确认机器人连接状态"
                : "机器人已经创建，但暂时无法确认连接状态");
          }
          if (!targetBot?.connected) {
            setModel((current) => current.provisioning?.attemptId === provision.attemptId
              ? { ...current, provisioning: { ...current.provisioning, phase: "connecting" } }
              : current);
            return;
          }
          setModel((current) => ({ ...current, provisioning: null }));
          announce(isCallbackRepair(provision)
            ? localizeTemplate('{bot}的权限与回调已补全。', { bot: targetBot.bot.name })
            : isGroupMessagePermission(provision)
              ? localizeTemplate('{bot}已开通群消息权限，并启用“响应所有群消息”。', { bot: targetBot.bot.name })
              : targetBot
                ? localizeTemplate('{bot}已连接，可以在飞书中开始聊天。', { bot: targetBot.bot.name })
                : "新飞书机器人已连接，可以开始聊天。");
          if (result.botId) setFocusBotId(result.botId);
          return;
        }
        if (result.status === "failed") {
          const error = new Error(result.message
            ?? (isCallbackRepair(provision)
              ? "飞书权限与回调补全失败"
              : isGroupMessagePermission(provision)
                ? "飞书群消息权限开通失败"
                : "飞书应用创建失败"));
          error.code = "FEISHU_PROVISION_FAILED";
          throw error;
        }
        if (result.status === "expired") {
          setModel((current) => current.provisioning?.attemptId === provision.attemptId
            ? { ...current, provisioning: { ...current.provisioning, phase: "qr", expired: true } }
            : current);
          return;
        }
        setModel((current) => {
          if (current.provisioning?.attemptId !== provision.attemptId) return current;
          const next = result.provisioning ?? current.provisioning;
          return {
            ...current,
            provisioning: {
              ...current.provisioning,
              ...next,
              phase: ["scanned", "connecting"].includes(result.status) ? "connecting" : "qr",
            },
          };
        });
      } catch (error) {
        if (error?.name === "AbortError") return;
        setModel((current) => current.provisioning?.attemptId === provision.attemptId
          ? {
              ...current,
              provisioning: {
                ...current.provisioning,
                phase: "error",
                attemptId: provision.attemptId,
                error: presentError(error),
              },
            }
          : current);
      }
    }, provision.pollIntervalMs);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [announce, invoke, loadStatus, model.provisioning]);

  const setBotBusy = React.useCallback((botId, value) => {
    setBusyByBot((current) => {
      const next = { ...current };
      if (value) next[botId] = value;
      else delete next[botId];
      return next;
    });
  }, []);

  const setBotError = React.useCallback((botId, error) => {
    setErrorsByBot((current) => {
      const next = { ...current };
      if (error) next[botId] = presentError(error);
      else delete next[botId];
      return next;
    });
  }, []);

  const repairCallback = React.useCallback((connection) => {
    if (model.provisioning) return;
    setRemoveTargetId(null);
    setBotError(connection.botId, null);
    setTestNoticesByBot((current) => {
      const next = { ...current };
      delete next[connection.botId];
      return next;
    });
    void startProvisioning({
      operation: CALLBACK_REPAIR_OPERATION,
      bot: connection,
    });
  }, [model.provisioning, setBotError, startProvisioning]);

  const reconnectOneBot = React.useCallback(async (connection) => {
    const { botId, bot } = connection;
    const snapshotVersion = workspaceFence.beginMutation();
    setBotBusy(botId, "reconnect");
    setBotError(botId, null);
    setTestNoticesByBot((current) => {
      const next = { ...current };
      delete next[botId];
      return next;
    });
    try {
      const value = await invoke(FEISHU_ENDPOINTS.reconnectBot, { botId, sendTest: true });
      const snapshot = normalizeBotsSnapshot(value);
      if (mountedRef.current && workspaceFence.canCommitMutation(snapshotVersion)) {
        mergeSnapshot(snapshot);
      }
      const refreshed = snapshot.bots.find((item) => item.botId === botId);
      if (!refreshed?.connected) {
        const error = new Error(
          refreshed?.error?.message ?? refreshed?.health.summary ?? "机器人仍未连接",
        );
        error.code = refreshed?.error?.code ?? "FEISHU_BOT_OFFLINE";
        throw error;
      }
      const testNotice = connectionTestNotice(value);
      if (mountedRef.current && workspaceFence.canCommitMutation(snapshotVersion)) {
        setTestNoticesByBot((current) => ({ ...current, [botId]: testNotice }));
      }
      announce(testNotice ?? (connection.connected
        ? localizeTemplate('{bot}连接检查完成。', { bot: bot.name })
        : localizeTemplate('{bot}已重新连接。', { bot: bot.name })));
    } catch (error) {
      const failure = new Error("连接检查失败，请稍后重试。");
      failure.code = error?.code;
      setBotError(botId, failure);
      announce(failure.message);
    } finally {
      const shouldRefresh = workspaceFence.endMutation();
      if (shouldRefresh && mountedRef.current) void loadStatus({ silent: true });
      setBotBusy(botId, null);
    }
  }, [announce, invoke, loadStatus, mergeSnapshot, setBotBusy, setBotError, workspaceFence]);

  const saveWorkspace = React.useCallback(async (connection, workspace) => {
    const { botId } = connection;
    const workspaceVersion = workspaceFence.beginMutation();
    setBotBusy(botId, "workspace");
    setBotError(botId, null);
    try {
      const snapshot = normalizeBotsSnapshot(await invoke(
        FEISHU_ENDPOINTS.setWorkspace,
        { botId, workspace },
      ));
      if (mountedRef.current && workspaceFence.canCommitMutation(workspaceVersion)) {
        mergeSnapshot(snapshot);
      }
    } finally {
      const shouldRefresh = workspaceFence.endMutation();
      if (shouldRefresh && mountedRef.current) void loadStatus({ silent: true });
      if (mountedRef.current) setBotBusy(botId, null);
    }
  }, [invoke, loadStatus, mergeSnapshot, setBotBusy, setBotError, workspaceFence]);

  const saveBotSetting = React.useCallback(async (connection, operation, endpoint, payload) => {
    const { botId } = connection;
    const snapshotVersion = workspaceFence.beginMutation();
    setBotBusy(botId, operation);
    setBotError(botId, null);
    try {
      const snapshot = normalizeBotsSnapshot(await invoke(
        endpoint,
        { botId, ...payload },
      ));
      if (mountedRef.current && workspaceFence.canCommitMutation(snapshotVersion)) {
        mergeSnapshot(snapshot);
      }
    } finally {
      const shouldRefresh = workspaceFence.endMutation();
      if (shouldRefresh && mountedRef.current) void loadStatus({ silent: true });
      if (mountedRef.current) setBotBusy(botId, null);
    }
  }, [invoke, loadStatus, mergeSnapshot, setBotBusy, setBotError, workspaceFence]);

  const requestRemove = React.useCallback((connection) => {
    setRemoveTargetId(connection.botId);
  }, []);

  const cancelRemove = React.useCallback(() => {
    const botId = removeTargetId;
    setRemoveTargetId(null);
    scheduleAnimationFrame(() => removeButtonRefs.current.get(botId)?.focus(), "focus");
  }, [removeTargetId, scheduleAnimationFrame]);

  const confirmRemove = React.useCallback(async (connection) => {
    const { botId, bot } = connection;
    const snapshotVersion = workspaceFence.beginMutation();
    setBotBusy(botId, "delete");
    setBotError(botId, null);
    try {
      const snapshot = normalizeBotsSnapshot(await invoke(
        FEISHU_ENDPOINTS.deleteBot,
        { botId, confirm: true },
      ));
      setRemoveTargetId(null);
      if (mountedRef.current && workspaceFence.canCommitMutation(snapshotVersion)) {
        mergeSnapshot(snapshot);
      }
      announce(localizeTemplate('{bot}已从此 DeepSeek Harness 移除；飞书开放平台中的应用未被删除。', { bot: bot.name }));
      scheduleAnimationFrame(() => addButtonRef.current?.focus(), "focus");
    } catch (error) {
      setBotError(botId, error);
      announce(localizeTemplate('{bot}移除失败，请重试。', { bot: bot.name }));
    } finally {
      const shouldRefresh = workspaceFence.endMutation();
      if (shouldRefresh && mountedRef.current) void loadStatus({ silent: true });
      setBotBusy(botId, null);
    }
  }, [announce, invoke, loadStatus, mergeSnapshot, scheduleAnimationFrame, setBotBusy, setBotError, workspaceFence]);

  const provision = model.provisioning;
  const targetedProvisioning = isTargetedAppUpdate(provision);
  const provisionBot = provision?.botId
    ? model.bots.find((bot) => bot.botId === provision.botId)
      ?? { botId: provision.botId, bot: { name: provision.botName ?? "此机器人" } }
    : undefined;
  const restartProvisioning = ({ replace = false } = {}) => startProvisioning({
    replace,
    operation: provision?.operation ?? FEISHU_REGISTRATION_OPERATIONS.PROVISION,
    bot: provisionBot,
  });
  let provisionContent = null;
  if (provision?.phase === "creating") {
    provisionContent = h(ProvisionProgress, {
      phase: "creating", provision, busy: provisionBusy,
    });
  } else if (provision?.phase === "qr") {
    provisionContent = h(QrPane, {
      provision, now,
      onRefresh: () => void restartProvisioning({ replace: true }),
      onCancel: () => void cancelProvisioning(),
      busy: provisionBusy || model.phase !== "ready",
    });
  } else if (provision?.phase === "connecting") {
    provisionContent = h(ProvisionProgress, {
      phase: "connecting",
      provision,
      onCancel: isTargetedAppUpdate(provision) ? undefined : () => void cancelProvisioning(),
      busy: provisionBusy,
    });
  } else if (provision?.phase === "error") {
    provisionContent = h(ProvisionError, {
      error: provision.error,
      provision,
      onRetry: () => void restartProvisioning({ replace: Boolean(provision.attemptId) }),
      onCancel: () => {
        const targetBotId = provision.botId;
        setModel((current) => ({ ...current, provisioning: null }));
        void loadStatus({ silent: true, restoreProvisioning: false });
        scheduleAnimationFrame(() => {
          if (targetBotId) cardRefs.current.get(targetBotId)?.focus();
          else addButtonRef.current?.focus();
        }, "focus");
      },
      busy: provisionBusy,
    });
  }

  const credentialContent = credentialOpen
    ? h(CredentialBindingPanel, {
        key: credentialDomain,
        channel: credentialDomain === "lark" ? "Lark" : "飞书",
        identityLabel: "App ID",
        identityPlaceholder: credentialDomain === "lark" ? "填写 Lark 开放平台 App ID" : "填写飞书开放平台 App ID",
        secretLabel: "App Secret",
        secretPlaceholder: credentialDomain === "lark" ? "填写 Lark 开放平台 App Secret" : "填写飞书开放平台 App Secret",
        busy: credentialBusy,
        error: credentialError,
        onSubmit: bindCredentials,
        onCancel: () => { setCredentialOpen(false); setCredentialError(null); },
      }, h("label", { className: "dim-credentialField" },
        h("span", null, "应用平台"),
        h("select", {
          className: "dim-feishuGroupSelect",
          "aria-label": "应用平台",
          value: credentialDomain,
          disabled: credentialBusy,
          onChange: (event) => {
            setCredentialDomain(event.target.value);
            setCredentialError(null);
          },
        },
        h("option", { value: "feishu" }, "飞书"),
        h("option", { value: "lark" }, "Lark（国际版）"))))
    : null;

  const setCardRef = React.useCallback((botId, node) => {
    if (node) cardRefs.current.set(botId, node);
    else cardRefs.current.delete(botId);
  }, []);
  const setRemoveButtonRef = React.useCallback((botId, node) => {
    if (node) removeButtonRefs.current.set(botId, node);
    else removeButtonRefs.current.delete(botId);
  }, []);

  return h(ModelCatalogContext.Provider, {
    value: model.modelCatalog ?? EMPTY_MODEL_CATALOG,
  }, h(AgentPresetCatalogContext.Provider, {
    value: model.agentPresetCatalog ?? EMPTY_AGENT_PRESET_CATALOG,
  }, h("section", { className: "bxf-page dim-channelPage", "aria-label": "飞书机器人设置" },
    operationError ? h(ConnectionError, { error: operationError }) : null,
    h(Heading, {
      totals: model.totals,
      onAdd: () => void startProvisioning(),
      onCredential: () => { setCredentialOpen((value) => !value); setCredentialError(null); },
      credentialOpen,
      adding: Boolean(provision),
      busy: provisionBusy || credentialBusy,
      addButtonRef,
    }),
    h("div", {
      className: "bxf-visuallyHidden", role: "status", "aria-live": "polite", "aria-atomic": "true",
    }, announcement),
    model.statusError
      ? h("div", { className: "bxf-statusNotice dim-statusNotice", role: "status" },
          h(AlertIcon, { size: 16 }),
          h("span", null, localizeTemplate('状态自动刷新失败：{error}', { error: localizeText(model.statusError.message) })),
          h(Button, { size: "small", onClick: () => void loadStatus({ silent: true }), disabled: pageBusy }, "立即重试"))
      : null,
    model.phase === "loading"
      ? h(LoadingView)
      : model.phase === "error"
        ? h(PageError, {
            error: model.pageError ?? { message: "无法读取连接状态" },
            onRetry: () => void loadStatus(),
            busy: pageBusy,
          })
        : h(React.Fragment, null,
            credentialContent,
            targetedProvisioning ? null : provisionContent,
            model.bots.length === 0 && !provision && !credentialOpen
              ? h(EmptyView, { onStart: () => void startProvisioning(), busy: provisionBusy })
              : null,
            model.bots.length > 0
              ? h(BotList, {
                  bots: model.bots,
                  busyByBot,
                  errorsByBot,
                  testNoticesByBot,
                  removeTargetId,
                  provisioning: provision,
                  provisionContent,
                  provisionRef: targetedProvisionRef,
                  onReconnect: (bot) => void reconnectOneBot(bot),
                  onRepairCallback: repairCallback,
                  onWorkspaceSave: saveWorkspace,
                  onAliasSave: (connection, alias) => saveBotSetting(
                    connection, 'alias', FEISHU_ENDPOINTS.setAlias, { alias },
                  ),
                  onModelSave: (connection, selectedModel) => saveBotSetting(
                    connection, "model", FEISHU_ENDPOINTS.setModel, { model: selectedModel },
                  ),
                  onAgentPresetSave: (connection, agentPreset) => saveBotSetting(
                    connection, "preset", FEISHU_ENDPOINTS.setAgentPreset, { agentPreset },
                  ),
                  onContextEnhancementSave: (connection, config) => saveBotSetting(
                    connection, "context-enhancement", FEISHU_ENDPOINTS.setContextEnhancement, { config },
                  ),
                  onStepPushSave: (connection, stepPush) => saveBotSetting(
                    connection, "step-push", FEISHU_ENDPOINTS.setStepPush, { stepPush },
                  ),
                  onStepPushModeSave: (connection, stepPushMode) => saveBotSetting(
                    connection, "step-push-mode", FEISHU_ENDPOINTS.setStepPushMode, { stepPushMode },
                  ),
                  onRequestRemove: requestRemove,
                  onConfirmRemove: (bot) => void confirmRemove(bot),
                  onCancelRemove: cancelRemove,
                  setCardRef,
                  setRemoveButtonRef,
                })
              : null,
          ),
  )));
}
