/** @jsxImportSource react */
// Production menu and hook; only plugin-list responses are controlled.
import React from "react";
import { createRoot } from "react-dom/client";
import "../src/app/index.css";
import canvas from "../../../examples/plugin-packages/workspace-canvas/ipollowork.plugin.json";
import { createiPolloWorkServerClient, type iPolloWorkPluginPackageItem } from "../src/app/lib/ipollowork-server";
import { parsePluginPackageManifest } from "@ipollowork/types/plugins";
import { TooltipProvider } from "../src/components/ui/tooltip";
import { SidePanelLauncherMenu, type SidePanelLauncherItem } from "../src/react-app/domains/session/panel/side-panel";
import { useInstalledPluginContributions } from "../src/react-app/plugin-ui/plugin-ui-contributions";
import { resolveExtensionIconUrl } from "../src/react-app/design-system/extension-icon-src";
import { setLocale } from "../src/i18n";

setLocale("zh");
const client = {
  ...createiPolloWorkServerClient({ baseUrl: location.origin + "/proof-api", token: "isolated-proof" }),
  listPluginPackages: () => {
    document.body.dataset.requests = String(Number(document.body.dataset.requests || 0) + 1);
    return new Promise<{ items: iPolloWorkPluginPackageItem[] }>((resolve) => {
      window.addEventListener("proof-release", () => {
        const ids = ["operation-recorder", "douyin-ops", "short-video-studio", "wechat-channels-ops", "media-studio", "xiaohongshu-ops", "ipollo-onto", "no-icon", "broken-icon"];
        const names = ["操作录制", "抖音运营台", "短片工作台", "视频号运营台", "素材工作台", "小红书运营台", "iPollo Onto", "未配置图标", "图标加载失败"];
        resolve({ items: ids.map((id, index) => ({
          pluginId: id, name: names[index], enabled: true, disabledResourceIds: [],
          version: "1.0.0", previousVersion: null, integrity: { sha256: "0".repeat(64), status: "unsigned" },
          manifest: parsePluginPackageManifest({ ...canvas, id, name: names[index], contributions: [{ type: "workspace-app", ref: "canvas", label: names[index] }],
            icon: id === "broken-icon" ? { src: "/missing-proof-icon.png" } : undefined }),
        })) });
      }, { once: true });
    });
  },
};

function Proof() {
  const { workspaceApps, isLoading } = useInstalledPluginContributions(client, "isolated-proof");
  const items: SidePanelLauncherItem[] = [
    { id: "web", label: "网页", group: "content", icon: "web", onClick() {} },
    { id: "design", label: "设计", group: "content", icon: "design", onClick() {} },
    { id: "plugin-workshop", label: "插件工坊", group: "studio", icon: "plugin-workshop", onClick() {} },
    ...workspaceApps.map<SidePanelLauncherItem>((surface) => ({
      id: surface.pluginId, label: surface.label, group: "studio", icon: "workspace-app",
      iconSrc: resolveExtensionIconUrl({ pluginId: surface.pluginId, iconSrc: surface.iconSrc ?? undefined, iconSlug: surface.iconSlug }),
      onClick() { document.body.dataset.selectedPlugin = surface.pluginId; },
    })),
  ];
  return <TooltipProvider><main className="min-h-screen bg-background p-6 text-foreground">
    <p className="mb-6 text-sm text-muted-foreground">插件菜单验证 · 隔离 HTTP 响应</p>
    <div className="mb-6 flex gap-4 text-sm">
      <button onClick={() => window.dispatchEvent(new Event("proof-release"))}>完成读取</button>
      <button onClick={() => window.dispatchEvent(new Event("focus"))}>刷新列表</button>
      <button onClick={() => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; }}>切换主题</button>
    </div>
    <div className="flex justify-end"><SidePanelLauncherMenu launcherItems={items} pluginsLoading={isLoading} /></div>
  </main></TooltipProvider>;
}
createRoot(document.getElementById("root")!).render(<Proof />);
