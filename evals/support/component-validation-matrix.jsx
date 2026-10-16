// Production components with isolated values/callbacks; no model, OS or file writes.
import React, { useState } from "react";
import { Input } from "../../apps/app/src/components/ui/input";
import { Textarea } from "../../apps/app/src/components/ui/textarea";
import { Label } from "../../apps/app/src/components/ui/label";
import { Button } from "../../apps/app/src/components/ui/button";
import { Checkbox } from "../../apps/app/src/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "../../apps/app/src/components/ui/radio-group";
import { Switch } from "../../apps/app/src/components/ui/switch";
import { SettingsListSearchInput } from "../../apps/app/src/react-app/domains/settings/settings-list";
import { DescriptiveButton, DescriptiveButtonContent, DescriptiveButtonTitle, DescriptiveButtonDescription } from "../../apps/app/src/components/descriptive-button";
import { Autocomplete, AutocompleteInput, AutocompletePopup, AutocompleteList, AutocompleteItem, AutocompleteEmpty } from "../../apps/app/src/components/ui/autocomplete";
import { Command, CommandInput, CommandList, CommandItem, CommandEmpty, CommandDialog, CommandDialogTrigger, CommandDialogPopup, CommandDialogTitle } from "../../apps/app/src/components/ui/command";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "../../apps/app/src/components/ui/dropdown-menu";
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem } from "../../apps/app/src/components/ui/context-menu";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "../../apps/app/src/components/ui/hover-card";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "../../apps/app/src/components/ui/accordion";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "../../apps/app/src/components/ui/collapsible";
import { SidebarProvider, Sidebar, SidebarContent, SidebarTrigger, SidebarMenu, SidebarMenuItem, SidebarMenuButton } from "../../apps/app/src/components/ui/sidebar";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "../../apps/app/src/components/ui/resizable";
import { ScrollArea, ScrollAreaViewport } from "../../apps/app/src/components/ui/scroll-area";
import { Separator } from "../../apps/app/src/components/ui/separator";
import { Skeleton } from "../../apps/app/src/components/ui/skeleton";
import { Avatar, AvatarImage, AvatarFallback } from "../../apps/app/src/components/ui/avatar";
import { Image } from "../../apps/app/src/components/ui/image";
import { Message, MessageContent } from "../../apps/app/src/components/ui/message";
import { Source, SourceTrigger, SourceContent } from "../../apps/app/src/components/ui/source";
import { Tool } from "../../apps/app/src/components/ui/tool";
import { ChainOfThought, ChainOfThoughtStep, ChainOfThoughtTrigger, ChainOfThoughtContent } from "../../apps/app/src/components/ui/chain-of-thought";
import { PanelTabList, PanelTabItem, PanelTab, PanelTabClose } from "../../apps/app/src/components/panel-tabs";
import { ModelBehaviorMenu } from "../../apps/app/src/components/model-behavior-menu";
import { ModelDirectoryLoadingStatus } from "../../apps/app/src/components/model-directory-loading-status";
import { LinkActionMenu } from "../../apps/app/src/components/markdown/link-action-menu";
import { ConfirmModal } from "../../apps/app/src/react-app/design-system/modals/confirm-modal";
import { NotificationBell } from "../../apps/app/src/react-app/shell/notification-center";
import { ReloadCoordinatorProvider } from "../../apps/app/src/react-app/shell/reload-coordinator";
import { useNotificationStore } from "../../apps/app/src/react-app/kernel/notification-store";
import { ArtifactList } from "../../apps/app/src/components/chat/artifact";
import { OpenTargetProvider } from "../../apps/app/src/lib/target-provider";

const options = ["Alpha", "Beta", "Gamma"];
const imageSrc = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="480"><rect width="240" height="480" fill="#94b7cd"/><text x="20" y="60" font-size="24">Preview</text></svg>')}`;
function Section({ id, title, children }) {
  return <section id={id} className="min-w-0 scroll-mt-28 space-y-3 rounded-xl border p-4"><h2 className="text-base font-semibold">{title}</h2>{children}</section>;
}
function SearchCommands({ onValueChange }) {
  return <Command items={options}><CommandInput aria-label="命令搜索" placeholder="搜索命令"/><CommandEmpty>无匹配命令</CommandEmpty><CommandList>{item => <CommandItem key={item} value={item} onClick={() => onValueChange(item)}>{item}</CommandItem>}</CommandList></Command>;
}
export function ComponentValidationMatrix() {
  const [theme, setTheme] = useState("light");
  const [receipt, setReceipt] = useState("等待操作");
  const [name, setName] = useState("保留草稿");
  const [error, setError] = useState(false);
  const [search, setSearch] = useState("");
  const [text, setText] = useState("");
  const [variant, setVariant] = useState("high");
  const [confirm, setConfirm] = useState(false);
  const [linkRect, setLinkRect] = useState(null);
  const [tabs, setTabs] = useState(["文档", "预览"]);
  const [active, setActive] = useState("文档");
  const [toolState, setToolState] = useState("input-available");
  const [loading, setLoading] = useState(true);
  const changeTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next); document.documentElement.classList.toggle("dark", next === "dark");
    document.documentElement.dataset.theme = next; document.documentElement.style.colorScheme = next;
  };
  const toolPart = { type: "dynamic-tool", toolName: "read", toolCallId: "isolated-proof", state: toolState, input: { path: "proof.txt" }, ...(toolState === "output-error" ? { errorText: "连接失败；原始输入保留" } : toolState === "output-available" ? { output: "读取结果" } : {}) };
  return <main id="validation-matrix" className="mx-auto max-w-5xl space-y-4 bg-background p-4 text-foreground">
    <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 rounded-lg border bg-background p-3"><h1>组件补齐验证 · 隔离回调</h1><Button id="matrix-theme" onClick={changeTheme}>切换主题</Button><output id="matrix-receipt" role="status">{receipt}</output></header>
    <Section id="matrix-form" title="字段错误恢复、搜索与选择">
      <Label htmlFor="matrix-name">项目名称</Label><Input id="matrix-name" value={name} aria-invalid={error} aria-describedby={error ? "matrix-error" : undefined} onChange={event => {setName(event.target.value); setError(false);}}/>
      {error && <p id="matrix-error" role="alert">名称暂不可用；请修改后重试</p>}
      <Button id="matrix-validate" onClick={() => setError(true)}>触发校验失败</Button><Button id="matrix-save" onClick={() => {setError(false);setReceipt(`保存：${name}`);}}>重试保存</Button>
      <Label htmlFor="matrix-text">补充说明</Label><Textarea id="matrix-text" value={text} onChange={event => setText(event.target.value)} placeholder="多行说明"/><Textarea aria-label="禁用说明" disabled value="不可编辑" readOnly/>
      <SettingsListSearchInput id="matrix-search" aria-label="目录搜索" value={search} onChange={event => setSearch(event.target.value)}/><p id="matrix-search-results">{options.filter(item => item.toLowerCase().includes(search.toLowerCase())).join(" / ") || "没有匹配结果"}</p>
      <div className="flex flex-wrap items-center gap-3"><Checkbox id="matrix-checkbox" aria-label="多选项目" onCheckedChange={value => setReceipt(`多选：${value}`)}/><Checkbox aria-label="禁用多选" disabled/><Switch id="matrix-switch" aria-label="自动保存" onCheckedChange={value => setReceipt(`自动保存：${value}`)}/><Switch aria-label="禁用开关" disabled/></div>
      <RadioGroup id="matrix-radio" defaultValue="one" onValueChange={value => setReceipt(`单选：${value}`)}><label className="flex gap-2"><RadioGroupItem value="one" aria-label="方案一"/>方案一</label><label className="flex gap-2"><RadioGroupItem value="two" aria-label="方案二"/>方案二</label><RadioGroupItem value="disabled" aria-label="禁用方案" disabled/></RadioGroup>
      <Autocomplete items={options} onValueChange={value => setReceipt(`搜索选择：${value}`)}><AutocompleteInput id="matrix-autocomplete" aria-label="可搜索选择" showClear clearProps={{"aria-label":"清空搜索选择"}}/><AutocompletePopup><AutocompleteEmpty>无匹配选项</AutocompleteEmpty><AutocompleteList>{item => <AutocompleteItem key={item} value={item}>{item}</AutocompleteItem>}</AutocompleteList></AutocompletePopup></Autocomplete>
      <div id="matrix-command"><SearchCommands onValueChange={value => setReceipt(`命令：${value}`)}/></div>
    </Section>
    <Section id="matrix-menus" title="操作入口、菜单与确认">
      <DescriptiveButton id="matrix-descriptive" onClick={() => setReceipt("描述按钮已执行")}><DescriptiveButtonContent><DescriptiveButtonTitle>新建插件</DescriptiveButtonTitle><DescriptiveButtonDescription>保留说明和长文案，窄容器可以换行，不截断用户需要理解的操作后果。</DescriptiveButtonDescription></DescriptiveButtonContent></DescriptiveButton>
      <DropdownMenu><DropdownMenuTrigger id="matrix-dropdown" render={<Button/>}>操作菜单</DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem id="matrix-dropdown-action" onClick={() => setReceipt("菜单已执行")}>查看详情</DropdownMenuItem><DropdownMenuItem disabled>禁用操作</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
      <ContextMenu><ContextMenuTrigger id="matrix-context" render={<div className="rounded-lg border p-4"/>}>右键打开上下文菜单</ContextMenuTrigger><ContextMenuContent><ContextMenuItem id="matrix-context-action" onClick={() => setReceipt("上下文已执行")}>复制引用（隔离）</ContextMenuItem><ContextMenuItem disabled>禁用操作</ContextMenuItem></ContextMenuContent></ContextMenu>
      <CommandDialog><CommandDialogTrigger id="matrix-command-dialog" render={<Button/>}>打开命令面板</CommandDialogTrigger><CommandDialogPopup><CommandDialogTitle>命令面板验证</CommandDialogTitle><SearchCommands onValueChange={value => setReceipt(`弹窗命令：${value}`)}/></CommandDialogPopup></CommandDialog>
      <ModelBehaviorMenu selectedModel={{providerID:"fixture",modelID:"test-model"}} modelVariant={variant} modelVariantLabel={variant === "high" ? "高" : "低"} options={[{value:"low",label:"低"},{value:"high",label:"高"}]} onModelChange={() => setReceipt("模型回调（隔离）")} onModelVariantChange={value => {setVariant(value);setReceipt(`推理：${value}`);}} appearance="field"/>
      <Button id="matrix-confirm" onClick={() => setConfirm(true)}>打开风险确认</Button><ConfirmModal open={confirm} variant="danger" title="确认隔离操作？" message="取消不产生结果；不会修改真实文件。" confirmLabel="确认执行" cancelLabel="取消执行" onConfirm={() => {setConfirm(false);setReceipt("确认已执行");}} onCancel={() => {setConfirm(false);setReceipt("确认已取消");}}/>
      <Button id="matrix-link" onClick={event => setLinkRect(event.currentTarget.getBoundingClientRect())}>打开链接操作</Button>{linkRect && <LinkActionMenu target={{kind:"file",value:"design/proof/index.html",preview:"html",name:"隔离网页"}} anchorRect={linkRect} onOpenTarget={(_target, options) => setReceipt(`链接：${options?.viewer || "panel"}`)} onClose={() => setLinkRect(null)}/ >}
    </Section>
    <Section id="matrix-content" title="消息、来源、图片与工具状态">
      <div className="flex gap-3"><Avatar><AvatarImage src="data:image/png;base64,broken" alt="加载失败头像"/><AvatarFallback>IP</AvatarFallback></Avatar><Avatar><AvatarImage src={imageSrc} alt="可用头像"/><AvatarFallback>OK</AvatarFallback></Avatar></div>
      <div id="matrix-image" className="max-w-60"><Image src={imageSrc} alt="隔离长图" previewMaxHeight={100}/></div><Image alt="等待图片" className="h-12 w-40"/>
      <Message id="matrix-message"><MessageContent>消息内容不会因为长文本而产生横向滚动。{ "LongContent".repeat(18)}</MessageContent></Message>
      <div id="matrix-source"><Source href="https://example.com/reference"><SourceTrigger label="来源 1"/><SourceContent title="验证来源标题" description="来源说明与安全外链"/></Source></div>
      <HoverCard><HoverCardTrigger id="matrix-hover" render={<a href="#matrix-content"/>}>查看悬停详情</HoverCardTrigger><HoverCardContent>独立 HoverCard 详情</HoverCardContent></HoverCard>
      <div className="flex flex-wrap gap-2"><Button id="matrix-tool-running" onClick={() => setToolState("input-available")}>工具运行</Button><Button id="matrix-tool-error" onClick={() => setToolState("output-error")}>工具失败</Button><Button id="matrix-tool-success" onClick={() => setToolState("output-available")}>工具成功</Button></div>
      <div id="matrix-tool"><Tool toolPart={toolPart} title="读取 proof.txt"/></div>
      <div id="matrix-thought"><ChainOfThought><ChainOfThoughtStep><ChainOfThoughtTrigger id="matrix-thought-trigger" data-proof="forwarded">查看处理步骤</ChainOfThoughtTrigger><ChainOfThoughtContent>保留处理过程说明</ChainOfThoughtContent></ChainOfThoughtStep><ChainOfThoughtStep><ChainOfThoughtTrigger id="matrix-thought-disabled" disabled>禁用处理步骤</ChainOfThoughtTrigger><ChainOfThoughtContent>不应展开</ChainOfThoughtContent></ChainOfThoughtStep></ChainOfThought></div>
      <Button id="matrix-loading-toggle" onClick={() => setLoading(!loading)}>切换加载结果</Button>{loading ? <div id="matrix-loading"><ModelDirectoryLoadingStatus hasModels={false}/><Skeleton id="matrix-skeleton" className="h-8 w-full"/></div> : <p id="matrix-loaded">目录已就绪（隔离）</p>}
    </Section>
    <Section id="matrix-layout" title="展开、面板、分栏与滚动">
      <Accordion><AccordionItem value="first"><AccordionTrigger id="matrix-accordion">展开说明</AccordionTrigger><AccordionContent>手风琴内容已展开</AccordionContent></AccordionItem><AccordionItem value="disabled" disabled><AccordionTrigger>禁用折叠项</AccordionTrigger><AccordionContent>不可展开</AccordionContent></AccordionItem></Accordion>
      <Collapsible><CollapsibleTrigger id="matrix-collapsible" render={<Button/>}>展开补充内容</CollapsibleTrigger><CollapsibleContent>补充内容已展开</CollapsibleContent></Collapsible>
      <PanelTabList values={tabs} onReorder={setTabs}>{tabs.map(tab => <PanelTabItem key={tab} value={tab}><PanelTab active={active === tab} aria-pressed={active === tab} onClick={() => {setActive(tab);setReceipt(`面板：${tab}`);}}>{tab}</PanelTab><PanelTabClose label={tab} onClose={() => {setTabs(tabs.filter(item => item !== tab));setActive("文档");setReceipt(`关闭：${tab}`);}}/></PanelTabItem>)}</PanelTabList>
      <div id="matrix-resize" style={{height:160}}><ResizablePanelGroup orientation="horizontal"><ResizablePanel id="matrix-panel-left" defaultSize="50%" minSize="20%">左侧面板</ResizablePanel><ResizableHandle withHandle aria-label="调整分栏"/><ResizablePanel defaultSize="50%" minSize="20%">右侧面板</ResizablePanel></ResizablePanelGroup></div>
      <ScrollArea id="matrix-scroll" style={{height:120}}><ScrollAreaViewport tabIndex={0}>{Array.from({length:20},(_,i) => <p key={i}>滚动内容 {i + 1}</p>)}</ScrollAreaViewport></ScrollArea><Separator id="matrix-separator" decorative={false}/>
      <div id="matrix-sidebar"><SidebarProvider className="min-h-0" style={{height:180}}><Sidebar collapsible="icon" className="relative" ><SidebarContent><SidebarMenu><SidebarMenuItem><SidebarMenuButton isActive>组件目录</SidebarMenuButton></SidebarMenuItem></SidebarMenu></SidebarContent></Sidebar><div><SidebarTrigger id="matrix-sidebar-toggle"/><p>隔离侧栏，不保存偏好</p></div></SidebarProvider></div>
    </Section>
    <Section id="matrix-business" title="通知中心与产物入口 · 隔离数据">
      <Button id="matrix-notify-reset" onClick={() => useNotificationStore.getState().clearAll()}>清空隔离通知</Button>
      <Button id="matrix-notify-add" onClick={() => useNotificationStore.getState().add({kind:"system",severity:"warning",title:"隔离验证通知",body:"只在独立浏览器中写入，不触及客户端通知。",dedupeKey:"matrix-proof"})}>添加隔离通知</Button>
      <ReloadCoordinatorProvider><NotificationBell/></ReloadCoordinatorProvider>
      <OpenTargetProvider onOpenTarget={(target, options) => setReceipt(`产物：${target.value}:${options?.viewer || "panel"}`)}><div id="matrix-artifacts"><ArtifactList messages={[]} supplementalFiles={["design/proof/index.html"]} title="隔离网页产物"/></div><div id="matrix-artifacts-empty"><ArtifactList messages={[]}/></div></OpenTargetProvider>
    </Section>
  </main>;
}
