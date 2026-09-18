async function mountFixture() {
  const modules = performance.getEntriesByType("resource").map((entry) => entry.name);
  const { default: React } = await import(modules.find((url) => /\/react\.js\?/.test(url)));
  const { default: ReactDOM } = await import(modules.find((url) => /\/react-dom_client\.js\?/.test(url)));
  const { QueuedMessagesPanel } = await import("/src/react-app/domains/session/modals/queued-messages-panel.tsx");
  const host = document.createElement("section");
  host.id = "composer-midturn-steer-proof";
  host.className = "fixed inset-0 z-50 flex items-end justify-center bg-background p-16 text-foreground";
  document.body.append(host);
  const root = ReactDOM.createRoot(host);

  function Fixture() {
    const [messages, setMessages] = React.useState([
      "先检查中宽窗口下的工具栏是否重叠",
      "完成后再统一深色模式的按钮颜色",
    ]);
    const [guidanceEnabled, setGuidanceEnabled] = React.useState(true);
    React.useEffect(() => {
      window.__midturnSteerProof.setGuidanceEnabled = setGuidanceEnabled;
    }, []);
    const steer = async (index) => {
      await new Promise((resolve) => setTimeout(resolve, 180));
      window.__midturnSteerProof.accepted = messages[index];
      setMessages((current) => current.filter((_, itemIndex) => itemIndex !== index));
    };
    return React.createElement("main", { className: "w-full max-w-3xl" },
      React.createElement("div", { className: "mb-48" },
        React.createElement("h1", { className: "text-2xl font-semibold" }, "运行中的任务"),
        React.createElement("p", { className: "mt-2 text-sm text-gray-10" }, "后续消息先进入队列；Codex 任务支持在安全边界加入当前执行。")),
      React.createElement("div", { className: "overflow-hidden rounded-[28px] border border-gray-7 bg-dls-surface" },
        React.createElement(QueuedMessagesPanel, {
          messages,
          steerable: messages.map(() => true),
          onSteer: guidanceEnabled ? steer : undefined,
          onRemove: (index) => setMessages((current) => current.filter((_, itemIndex) => itemIndex !== index)),
        }),
        React.createElement("div", { className: "h-32 px-5 py-4" },
          React.createElement("span", { className: "text-gray-9" }, "描述你的任务…"),
          React.createElement("div", { className: "mt-12 flex items-center justify-between text-sm text-gray-9" },
            React.createElement("span", null, "+   GPT 5.6 · 均衡"),
            React.createElement("span", { className: "rounded-full bg-gray-12 px-3 py-2 text-gray-1" }, "■")))));
  }

  window.__midturnSteerProof = {
    accepted: null,
    cleanup() {
      root.unmount();
      host.remove();
      delete window.__midturnSteerProof;
    },
  };
  root.render(React.createElement(Fixture));
}

export default {
  id: "composer-midturn-steer",
  title: "Queued follow-ups share one UI across conversation engines",
  kind: "user-facing",
  steps: [{
    name: "Guide the active task from its compact queue",
    async run(ctx) {
      await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000 });
      try {
        await ctx.prove("Queued messages use compact rows with explicit Guide and Delete actions", {
          voiceover: "任务执行中，后续消息逐条显示。支持的 Codex 任务可以选择引导当前执行，也可以删除排队内容。",
          action: () => ctx.eval(`(${mountFixture.toString()})()`, { awaitPromise: true }),
          assert: async () => {
            await ctx.waitFor("document.querySelectorAll('#composer-midturn-steer-proof [data-queued-message-index]').length === 2");
            ctx.assert(await ctx.eval("document.querySelectorAll('#composer-midturn-steer-proof [data-testid=queued-message-steer]').length === 2"), "Each steerable row exposes Guide.");
            ctx.assert(await ctx.eval("document.querySelectorAll('#composer-midturn-steer-proof [data-testid=queued-message-steer] svg.lucide-send').length === 2"), "Each Guide action uses the shared Lucide Send icon.");
            ctx.assert(await ctx.eval("document.querySelectorAll('#composer-midturn-steer-proof svg.lucide-trash-2').length === 2"), "Each row exposes Delete.");
          },
          screenshot: {
            name: "composer-midturn-steer-queue",
            requireText: ["运行中的任务", "引导", "先检查中宽窗口"],
          },
        });

        await ctx.prove("An accepted guide leaves the remaining queue intact", {
          voiceover: "引导请求被当前任务接受后，只移除这一条，其他消息仍保持原来的排队顺序。",
          action: async () => {
            await ctx.eval("document.querySelector('#composer-midturn-steer-proof [data-testid=queued-message-steer]')?.click()", { awaitPromise: true });
          },
          assert: async () => {
            await ctx.waitFor("window.__midturnSteerProof.accepted && document.querySelectorAll('#composer-midturn-steer-proof [data-queued-message-index]').length === 1");
            ctx.assert(await ctx.eval("window.__midturnSteerProof.accepted.includes('中宽窗口')"), "The selected guide was accepted.");
            ctx.assert(await ctx.eval("document.querySelector('#composer-midturn-steer-proof [data-queued-message-index]')?.textContent.includes('深色模式')"), "The next queued message remains available.");
          },
          screenshot: {
            name: "composer-midturn-steer-accepted",
            requireText: ["深色模式", "引导"],
            rejectText: ["先检查中宽窗口"],
          },
        });

        await ctx.prove("OpenCode keeps the same queue card without a Guide action", {
          voiceover: "OpenCode 继续采用下一轮排队。同一张队列卡片只隐藏不支持的引导操作，内容、间距和删除操作保持一致。",
          action: () => ctx.eval("window.__midturnSteerProof.setGuidanceEnabled(false)", { awaitPromise: true }),
          assert: async () => {
            await ctx.waitFor("document.querySelectorAll('#composer-midturn-steer-proof [data-testid=queued-message-steer]').length === 0");
            ctx.assert(await ctx.eval("document.querySelectorAll('#composer-midturn-steer-proof [data-queued-message-index]').length === 1"), "The queued row remains visible.");
            ctx.assert(await ctx.eval("document.querySelectorAll('#composer-midturn-steer-proof svg.lucide-trash-2').length === 1"), "The shared Delete action remains available.");
          },
          screenshot: {
            name: "composer-opencode-queue-only",
            requireText: ["深色模式"],
          },
        });
      } finally {
        await ctx.eval("window.__midturnSteerProof?.cleanup()", { awaitPromise: true });
      }
    },
  }],
};
