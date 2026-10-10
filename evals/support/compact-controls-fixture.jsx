// Real production controls, Composer and DesignPanel; transport and file I/O
// are isolated in-memory fixtures. No user workspace or paid provider is used.
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Pencil, Save, SunMoon, Info, Tag, Bell, Settings, Check, AlignLeft, AlignCenter, CircleCheck, TriangleAlert, OctagonX } from "lucide-react";
import { Button } from "../../apps/app/src/components/ui/button";
import { Input } from "../../apps/app/src/components/ui/input";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "../../apps/app/src/components/ui/field";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../../apps/app/src/components/ui/select";
import { TooltipProvider } from "../../apps/app/src/components/ui/tooltip";
import { Alert, AlertTitle, AlertDescription } from "../../apps/app/src/components/ui/alert";
import { Progress } from "../../apps/app/src/components/ui/progress";
import { Badge } from "../../apps/app/src/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../../apps/app/src/components/ui/card";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "../../apps/app/src/components/ui/empty";
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetClose, SheetFooter } from "../../apps/app/src/components/ui/sheet";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "../../apps/app/src/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "../../apps/app/src/components/ui/toggle-group";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../apps/app/src/components/ui/tabs";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "../../apps/app/src/components/ui/dialog";
import { Toaster, toast } from "../../apps/app/src/components/ui/sonner";
import { ConfirmModal } from "../../apps/app/src/react-app/design-system/modals/confirm-modal";
import { ReactSessionComposer } from "../../apps/app/src/react-app/domains/session/surface/composer/composer";
import { DesignPanel } from "../../apps/app/src/react-app/domains/session/design/design-panel";
import { TemplateCatalogDialog } from "../../apps/app/src/components/template-catalog-dialog";
import { PlatformProvider, createDefaultPlatform } from "../../apps/app/src/react-app/kernel/platform";
import { LocalProvider } from "../../apps/app/src/react-app/kernel/local-provider";
import { ShellConfigProvider } from "../../apps/app/src/react-app/shell/shell-config";
import { setLocale } from "../../apps/app/src/i18n";
import "../../apps/app/src/app/index.css";
import { ComponentValidationMatrix } from "./component-validation-matrix";

setLocale("zh");
const noop = () => {};
const empty = async () => [];
let html = '<!doctype html><html><head><style>body{margin:48px;background:#f5f6f9;font:18px sans-serif}h1{margin:90px 30px;padding:24px;background:white;border-radius:8px}</style></head><body><h1 id="headline">紧凑工具栏 · 点击这段文字</h1></body></html>';
const client = {
  getTemplateSession: async () => { throw new Error("Direct HTML fixture"); },
  readWorkspaceFile: async () => ({ content: html, updatedAt: 1 }),
  writeWorkspaceFile: async (_workspace, payload) => { html = payload.content; return { content: html, updatedAt: 2 }; },
};
const modes = [{ id: "build", label: "执行", icon: "zap", description: "直接开始完成任务" }, { id: "plan", label: "计划", icon: "list", description: "先梳理步骤再执行" }];
const accessModes = [{ id: "default", label: "智能体默认", icon: "shield-check", description: "沿用当前智能体配置的权限规则。" }, { id: "read-only", label: "只读", icon: "shield", description: "允许检查，拒绝编辑、Shell 命令和委派任务。" }];
function Fixture() {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(0);
  const [mode, setMode] = useState("build");
  const [access, setAccess] = useState("default");
  const [receipt, setReceipt] = useState("");
  const [closedAlerts, setClosedAlerts] = useState([]);
  const [dark, setDark] = useState(false);
  const [theme, setTheme] = useState("system");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  useEffect(() => {
    const receive = (event) => {
      const frame = document.getElementById("image-plugin-proof");
      if (event.source !== frame?.contentWindow) return;
      const message = event.data;
      if (message.type === "ipollowork:image-studio:ask-ai") {
        window.imagePluginReference = message.reference;
        setReceipt(`图片批注引用：${message.reference.kind}（模拟宿主接收）`);
      }
      if (!message.id || !message.method) return;
      if (message.method === "ui/initialize") event.source.postMessage({ jsonrpc: "2.0", id: message.id, result: { hostContext: { locale: "zh", theme: "light" } } }, location.origin);
      else if (message.method === "tools/call") event.source.postMessage({ jsonrpc: "2.0", id: message.id, result: { structuredContent: { models: [] } } }, location.origin);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  return <main className="min-h-screen bg-background text-foreground">
    <header className="flex items-center justify-between border-b px-4 py-2"><h1 className="text-sm font-medium">紧凑控件验收 · 真实组件 / 模拟传输</h1><Button variant="ghost" onClick={() => { const next = !dark; setDark(next); document.documentElement.dataset.theme = next ? "dark" : "light"; document.documentElement.style.colorScheme = next ? "dark" : "light"; }}><SunMoon data-icon="inline-start" />{dark ? "切换浅色" : "切换深色"}</Button></header>
    <div style={{ display: "grid", gridTemplateColumns: "minmax(420px, 46%) minmax(0, 1fr)" }} className="gap-4 p-4">
      <section className="space-y-4"><h2 className="text-sm font-medium">设置表单</h2><FieldGroup>
        <Field><FieldLabel htmlFor="project">项目名称</FieldLabel><Input id="project" defaultValue="iPolloWork" /><FieldDescription>正文不缩小，控件与间距更紧凑。</FieldDescription></Field>
        <Field><FieldLabel>外观</FieldLabel><Select value={theme} onValueChange={setTheme}><SelectTrigger aria-label="外观选择"><SelectValue>{{ system: "跟随系统", light: "浅色", dark: "深色" }[theme]}</SelectValue></SelectTrigger><SelectContent><SelectItem value="system">跟随系统</SelectItem><SelectItem value="light">浅色</SelectItem><SelectItem value="dark">深色</SelectItem></SelectContent></Select></Field>
        <div className="flex gap-2"><Button variant="ghost" onClick={() => setReceipt("编辑已点击")}><Pencil data-icon="inline-start" />编辑</Button><Button size="lg" onClick={() => setReceipt("设置已保存")}><Save data-icon="inline-start" />保存</Button><Button variant="ghost" disabled>不可用</Button></div>
      </FieldGroup><h2 className="text-sm font-medium">对话输入框</h2>
      <ReactSessionComposer draft={draft} mentions={{}} onDraftChange={setDraft} onSend={() => { setBusy(true); setDraft(""); setReceipt("任务执行中（模拟）"); }} onQueue={() => { setQueued(queued + 1); setDraft(""); setReceipt("已排队（模拟）"); }} onStop={() => { setBusy(false); setReceipt("任务已停止（模拟）"); }} busy={busy} queuedCount={queued} disabled={false} statusLabel="" modelPickerOpen={false} selectedModel={{ providerID: "fixture", modelID: "test-model" }} onModelPickerOpenChange={noop} onModelChange={noop} attachments={[]} onAttachFiles={noop} onRemoveAttachment={noop} modelVariantLabel="高" modelVariant="high" modelBehaviorOptions={[{ value: "low", label: "低" }, { value: "high", label: "高" }]} onModelVariantChange={noop} selectedMode={mode} listModes={async () => modes} onSelectMode={setMode} selectedAccessMode={access} listAccessModes={async () => accessModes} onSelectAccessMode={setAccess} listAgents={empty} onSelectAgent={noop} listCommands={empty} plusMenuScope="compact-proof" listPlusMenuData={async () => ({ extensions: [], externalAgents: [], mcpServers: [], mcpStatuses: null, mcpStatus: null })} recentFiles={[]} searchFiles={empty} onInsertMention={noop} onPasteText={noop} onUnsupportedFileLinks={noop} pastedText={[]} onExpandPastedText={noop} onRemovePastedText={noop} isRemoteWorkspace={false} isSandboxWorkspace={false} layout="inline" placeholder="输入测试消息，不会调用模型" />
      <p role="status" className="text-xs text-muted-foreground">{receipt || "等待操作"}</p></section>
      <section style={{ height: 620 }} className="min-w-0 overflow-hidden rounded-lg border"><DesignPanel sessionId="compact-proof" workspaceId="compact-proof" client={client} initialPath="design/compact-proof/entry.html" onAskAi={() => setReceipt("AI 操作已触发（模拟）")} /></section>
    </div>
    <section id="migration-proof" className="space-y-3 border-t p-4">
      <h2 className="text-sm font-medium">迁移验收 · 模板搜索 / 图片插件</h2>
      <Button variant="ghost" onClick={() => setCatalogOpen(true)}><Settings />打开真实模板目录</Button>
      <TemplateCatalogDialog open={catalogOpen} onOpenChange={setCatalogOpen} queryKey={["compact-template-proof"]} copy={{ title: "模板目录验收", description: "真实组件；目录服务为隔离空数据。" }} listTemplates={empty} getCover={async () => { throw new Error("Empty catalog"); }} applyTemplate={noop} onApplied={noop} />
      <iframe id="image-plugin-proof" title="真实图片插件 · 隔离宿主" src="../../examples/plugin-packages/media-studio/ui/image-studio.html" style={{ width: "100%", height: 620, border: "1px solid #ddd", borderRadius: 8 }} />
    </section>
    <section id="task-progress-proof" className="space-y-3 border-t p-4">
      <h2 className="text-sm font-medium">任务进度 · 真实数值与阶段加载</h2>
      <div className="grid max-w-lg gap-4 rounded-lg border p-4">
        <div className="space-y-2"><p className="text-xs">下载进度 45%</p><Progress value={45} aria-label="下载进度" /></div>
        <div className="space-y-2"><p className="text-xs">正在连接，暂时无法计算百分比</p><Progress value={null} aria-label="正在连接" /></div>
      </div>
    </section>
    <section id="remaining-categories" className="space-y-4 border-t p-4">
      <h2 className="text-sm font-medium">剩余分类 · 表格 / 标签 / 切换 / 弹窗 / 提醒</h2>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary"><Tag />素材分类</Badge><Badge variant="outline">等待确认</Badge>
        <ToggleGroup defaultValue={["left"]} aria-label="对齐方式"><ToggleGroupItem value="left" aria-label="左对齐"><AlignLeft />左对齐</ToggleGroupItem><ToggleGroupItem value="center" aria-label="居中"><AlignCenter />居中</ToggleGroupItem></ToggleGroup>
        <Dialog><DialogTrigger render={<Button variant="ghost" />}><Settings />打开设置弹窗</DialogTrigger><DialogContent className="max-w-md"><DialogHeader><DialogTitle>紧凑设置弹窗</DialogTitle><DialogDescription>16px 内边距，长内容保留滚动，不隐藏文字。</DialogDescription></DialogHeader><Input aria-label="弹窗项目名称" defaultValue="iPolloWork" /><DialogFooter><DialogClose render={<Button variant="ghost" />}>取消</DialogClose><DialogClose render={<Button />} onClick={() => setReceipt("弹窗已保存")}><Check />保存设置</DialogClose></DialogFooter></DialogContent></Dialog>
        <Button variant="ghost" onClick={() => setConfirmOpen(true)}><Info />打开确认弹窗</Button>
        <Sheet><SheetTrigger render={<Button variant="ghost" />}><Settings />打开属性抽屉</SheetTrigger><SheetContent><SheetHeader><SheetTitle>属性抽屉</SheetTitle><SheetDescription>复用 16px 内边距，正文保留滚动空间。</SheetDescription></SheetHeader><SheetFooter><SheetClose render={<Button variant="ghost" />}>关闭抽屉</SheetClose></SheetFooter></SheetContent></Sheet>
        <Button variant="ghost" onClick={() => toast.success("统一完成", { description: "标签和提醒完整显示。", duration: 10000 })}><Bell />显示轻提醒</Button>
        <Button variant="ghost" onClick={() => toast.warning("需要确认", { action: { label: "确认采用", onClick: () => setReceipt("结果已采用") }, cancel: { label: "取消", onClick: noop }, duration: 20000 })}><Check />显示结果确认</Button>
        <Button variant="ghost" onClick={() => toast.info("需要补充信息", { description: "请检查连接设置。", action: { label: "查看", onClick: noop }, duration: 10000 })}><Info />显示信息提醒</Button>
        <Button variant="ghost" onClick={() => toast.error("连接失败", { description: "请检查网络后重试。", action: { label: "重试", onClick: noop }, duration: 10000 })}><OctagonX />显示错误提醒</Button>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {!closedAlerts.includes("info") ? <Alert onDismiss={() => setClosedAlerts([...closedAlerts, "info"])}><Info /><AlertTitle>需要补充信息</AlertTitle><AlertDescription>保留正文可读性，不把提示压成固定高度。</AlertDescription></Alert> : null}
        {!closedAlerts.includes("success") ? <Alert variant="success" onDismiss={() => setClosedAlerts([...closedAlerts, "success"])}><CircleCheck /><AlertDescription>连接成功，任务已连接，可以继续操作。</AlertDescription></Alert> : null}
        {!closedAlerts.includes("warning") ? <Alert variant="warning" onDismiss={() => setClosedAlerts([...closedAlerts, "warning"])}><TriangleAlert /><AlertTitle>即将达到用量限制</AlertTitle><AlertDescription>请检查当前剩余用量。</AlertDescription></Alert> : null}
        {!closedAlerts.includes("error") ? <Alert variant="destructive" onDismiss={() => setClosedAlerts([...closedAlerts, "error"])}><OctagonX /><AlertTitle>连接失败</AlertTitle><AlertDescription>检查网络后可以重试。</AlertDescription></Alert> : null}
      </div>
      <Card size="sm"><CardHeader><CardTitle>紧凑内容卡片</CardTitle><CardDescription>小卡片 12px 内边距；常规卡片 16px。</CardDescription></CardHeader><CardContent><Empty variant="ghost"><EmptyHeader><EmptyTitle>暂无内容</EmptyTitle><EmptyDescription>空状态保留说明和后续操作空间。</EmptyDescription></EmptyHeader></Empty></CardContent></Card>
      <Tabs defaultValue="table"><TabsList><TabsTrigger value="table">数据表格</TabsTrigger><TabsTrigger value="empty">空状态</TabsTrigger></TabsList><TabsContent value="table"><Table><TableHeader><TableRow><TableHead>名称</TableHead><TableHead>状态</TableHead><TableHead>操作</TableHead></TableRow></TableHeader><TableBody><TableRow><TableCell>组件规范</TableCell><TableCell><Badge variant="secondary">待确认</Badge></TableCell><TableCell><Button variant="ghost" size="sm" onClick={() => setReceipt("已查看组件规范")}><Info />查看</Button></TableCell></TableRow></TableBody></Table></TabsContent><TabsContent value="empty">暂无匹配结果，请调整搜索条件。</TabsContent></Tabs>
      <ConfirmModal open={confirmOpen} title="确认采用结果？" message="这是隔离验收，不修改真实任务或文件。" confirmLabel="确认采用" cancelLabel="取消" onConfirm={() => { setConfirmOpen(false); setReceipt("结果已采用"); }} onCancel={() => setConfirmOpen(false)} />
      <Toaster />
    </section>
  </main>;
}
createRoot(document.getElementById("root")).render(<HashRouter><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><TooltipProvider><PlatformProvider value={createDefaultPlatform()}><LocalProvider><ShellConfigProvider>{new URLSearchParams(location.search).has("matrix") ? <ComponentValidationMatrix /> : <Fixture />}</ShellConfigProvider></LocalProvider></PlatformProvider></TooltipProvider></QueryClientProvider></HashRouter>);
