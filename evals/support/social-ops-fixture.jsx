import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ServiceWorkbenchFrame } from "../../apps/app/src/react-app/plugin-ui/service-workbench-frame";
import { Button } from "../../apps/app/src/components/ui/button";
import "../../apps/app/src/app/index.css";
const fixture = await (await fetch("/social-ops-fixture-state")).json();
const queryClient = new QueryClient();
window.__socialOpsReceipts = [];
window.__socialOpsLinks = [];
window.__IPOLLOWORK_ELECTRON__ = {
  browser: {
    openUrl: async (url, options) => {
      window.__socialOpsLinks.push({ url, options });
    },
  },
};
function Fixture() {
  const rejectNext = useRef(false);
  const [plugin, setPlugin] = useState("wechat-channels-ops"),
    [messages, setMessages] = useState([]),
    [width, setWidth] = useState("wide");
  const label =
    plugin === "wechat-channels-ops" ? "视频号运营台" : "抖音运营台";
  const surface = {
    pluginId: plugin,
    label,
    resource: {
      id: "workbench",
      type: "local-service",
      browserSession: {
        origin:
          plugin === "wechat-channels-ops"
            ? "https://channels.weixin.qq.com"
            : "https://www.douyin.com",
      },
    },
  };
  const client = {
    baseUrl: "fixture",
    callExtensionAction: async () => ({
      ok: true,
      result: { url: fixture.services[plugin] },
    }),
  };
  return (
    <QueryClientProvider client={queryClient}>
      <main className="bg-background text-foreground min-h-screen">
        <header className="flex gap-2 p-3 border-b">
          <Button
            variant="outline"
            onClick={() => setPlugin("wechat-channels-ops")}
          >
            视频号运营台
          </Button>
          <Button variant="outline" onClick={() => setPlugin("douyin-ops")}>
            抖音运营台
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              document.documentElement.dataset.theme =
                document.documentElement.dataset.theme === "dark"
                  ? "light"
                  : "dark";
              document.documentElement.classList.toggle(
                "dark",
                document.documentElement.dataset.theme === "dark",
              );
            }}
          >
            切换主题
          </Button>
          <Button
            variant="outline"
            onClick={() => setWidth(width === "wide" ? "narrow" : "wide")}
          >
            切换面板宽度
          </Button>
          <span className="text-xs text-muted-foreground">
            隔离验收 · 平台与模型执行以回执替代
          </span>
          <Button
            variant="outline"
            onClick={() => {
              rejectNext.current = true;
            }}
          >
            模拟下次 AI 投递失败
          </Button>
        </header>
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              width === "narrow" ? "1fr 390px" : "300px minmax(0,1fr)",
            height: "calc(100vh - 60px)",
          }}
        >
          <aside className="border-r p-4 overflow-auto">
            <h2 className="font-semibold mb-3">AI 对话区</h2>
            {messages.map((message, index) => (
              <p key={index} className="mb-2 text-sm" data-testid="ai-message">
                {message.text}
              </p>
            ))}
            <output data-testid="bridge-receipts" className="sr-only">
              {JSON.stringify(messages)}
            </output>
          </aside>
          <ServiceWorkbenchFrame
            key={plugin}
            surface={surface}
            client={client}
            workspaceId="fixture-workspace"
            workspaceRoot="fixture-workspace"
            sessionId="fixture-session"
            onSendMessage={(message) => {
              if (rejectNext.current) {
                rejectNext.current = false;
                throw new Error("隔离验收：AI 暂未接收，请重试。");
              }
              window.__socialOpsReceipts.push(message);
              setMessages((current) => [...current, message]);
              return { accepted: true, sessionId: "fixture-session" };
            }}
          />
        </div>
      </main>
    </QueryClientProvider>
  );
}
createRoot(document.getElementById("root")).render(<Fixture />);
