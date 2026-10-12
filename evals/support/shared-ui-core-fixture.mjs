// A real runtime consumer: no app imports, bundled React or component copies.
function mountLibrary() {
  const ui = window.ipolloworkUi;
  const h = ui.React.createElement;
  const required = ['Table','Card','Avatar','Image','Field','InputGroup','Autocomplete','Checkbox','RadioGroup','Switch','Toggle','ToggleGroup','DropdownMenu','ContextMenu','Command','AlertDialog','Sheet','Popover','HoverCard','Tooltip','Alert','Badge','Progress','Skeleton','Empty','Tabs','Accordion','Collapsible','ScrollArea','Separator','DescriptiveButton','Button','Icon'];
  if (Number(ui.version.split('.')[1]) < 5) throw Error('请更新客户端 UI 运行时');
  if (required.some(name => typeof ui[name] !== 'function')) throw Error('缺少核心组件');
  window.__libraryRequired = required;
  function Demo() {
    const [receipt, setReceipt] = ui.React.useState('等待操作');
    const [section, setSection] = ui.React.useState('输入与选择');
    const [name, setName] = ui.React.useState('插件草稿');
    const [error, setError] = ui.React.useState(false);
    const [confirmOpen, setConfirmOpen] = ui.React.useState(false);
    const [loading, setLoading] = ui.React.useState(false);
    const [iconClicks, setIconClicks] = ui.React.useState(0);
    const [dismissed, setDismissed] = ui.React.useState([]);
    const options = ['电影','产品','角色'];
    const sample = (title, ...children) => h('article', { 'data-sample': title }, h('h2', null, title), ...children);
    const action = (id, title, fn) => h(ui.Button, { id, onClick: fn }, title);
    const command = () => h(ui.Command, { items: options }, h(ui.CommandInput, { 'aria-label': '搜索命令' }), h(ui.CommandEmpty, null, '无匹配命令'), h(ui.CommandList, null, item => h(ui.CommandItem, { key: item, value: item, onClick: () => setReceipt('命令：'+item) }, item)));
    const groups = {
      '图标与按钮': [
        sample('公共 Lucide 图标', h('div', {id:'icon-gallery',style:{display:'flex',flexWrap:'wrap',gap:12}}, ui.ICON_NAMES.map(name=>h('span',{key:name,title:name},h(ui.Icon,{name,label:name}))))),
        sample('S / M / L', ...['s','m','l'].map(size=>h(ui.Icon,{key:size,name:'Search',size,label:'搜索 '+size}))),
        sample('Button 图标组合', h('div',{style:{display:'flex',flexWrap:'wrap',gap:8}},
          ...[['sm','s'],['default','m'],['lg','l']].map(([size,iconSize])=>h(ui.Button,{key:size,id:'icon-leading-'+size,size,onClick:()=>{setIconClicks(iconClicks+1);setReceipt('前置图标：'+size);}},h(ui.Icon,{name:'Plus',size:iconSize,'data-icon':'inline-start'}),'新建')),
          h(ui.Button,{id:'icon-trailing',variant:'outline',onClick:()=>setReceipt('后置图标已执行')},'下载',h(ui.Icon,{name:'Download','data-icon':'inline-end'})),
          h(ui.Button,{id:'icon-only',size:'icon',variant:'ghost','aria-label':'图标搜索',onClick:()=>setReceipt('纯图标已执行')},h(ui.Icon,{name:'Search'})),
          h(ui.Button,{id:'icon-disabled',disabled:true,onClick:()=>setReceipt('禁用不应执行')},h(ui.Icon,{name:'Trash2','data-icon':'inline-start'}),'禁用'),
          h(ui.Button,{id:'icon-loading',disabled:loading,'aria-busy':loading,onClick:()=>{setLoading(true);setReceipt('正在保存');setTimeout(()=>{setLoading(false);setReceipt('保存完成');},1200);}},h(ui.Icon,{name:loading?'LoaderCircle':'Save','data-icon':'inline-start',className:loading?'animate-spin':undefined}),loading?'保存中':'保存')),
          h('output',{id:'icon-click-count'},String(iconClicks))),
      ],
      '输入与选择': [
        sample('Field / Label / Input', h(ui.Field, null, h(ui.FieldLabel, { htmlFor: 'name' }, '项目名称'), h(ui.Input, { id: 'name', value: name, 'aria-invalid': error, 'aria-describedby': error ? 'name-error' : undefined, onChange: e => { setName(e.target.value); setError(false); } }), error ? h(ui.FieldError, { id: 'name-error' }, '保存失败，草稿仍保留') : h(ui.FieldDescription, null, '输入内容由插件管理')), action('fail','模拟失败',()=>setError(true)), action('retry','重试',()=>{setError(false);setReceipt('保存：'+name);})),
        sample('Textarea / InputGroup', h(ui.Textarea, { 'aria-label': '补充说明', defaultValue: '多行说明' }), h(ui.InputGroup, null, h(ui.InputGroupAddon, null, '搜索'), h(ui.InputGroupInput, { 'aria-label': '分组输入', placeholder: '搜索项目' }))),
        sample('Select', h(ui.Select, { defaultValue: '电影', items: options.map(value=>({value,label:value})), onValueChange: value=>setReceipt('选择：'+value) }, h(ui.SelectTrigger, { 'aria-label': '风格' }, h(ui.SelectValue)), h(ui.SelectContent, null, options.map(value=>h(ui.SelectItem,{key:value,value},value))))),
        sample('Autocomplete', h(ui.Autocomplete, { items: options, onValueChange: value=>setReceipt('搜索选择：'+value) }, h(ui.AutocompleteInput, { 'aria-label': '搜索选择', showClear: true, clearProps: { 'aria-label': '清空搜索' } }), h(ui.AutocompletePopup, null, h(ui.AutocompleteEmpty, null, '无匹配选项'), h(ui.AutocompleteList, null, item=>h(ui.AutocompleteItem,{key:item,value:item},item))))),
        sample('Checkbox / RadioGroup / Switch', h(ui.Checkbox, { id: 'check', 'aria-label': '勾选项目', onCheckedChange: value=>setReceipt('勾选：'+value) }), h(ui.Switch, { id: 'switch', 'aria-label': '自动保存', onCheckedChange: value=>setReceipt('开关：'+value) }), h(ui.RadioGroup, { defaultValue:'a', onValueChange:value=>setReceipt('单选：'+value) }, h(ui.RadioGroupItem, { value:'a','aria-label':'方案甲' }), h(ui.RadioGroupItem, { value:'b','aria-label':'方案乙' }))),
        sample('Toggle / ToggleGroup', h(ui.Toggle, { 'aria-label':'加粗', onPressedChange:value=>setReceipt('加粗：'+value) }, 'B'), h(ui.ToggleGroup, { defaultValue:['a'], onValueChange:value=>setReceipt('工具：'+value.join(',')) }, h(ui.ToggleGroupItem,{value:'a'},'文字'),h(ui.ToggleGroupItem,{value:'b'},'图片'))),
      ],
      '菜单与浮层': [
        sample('DropdownMenu', h(ui.DropdownMenu, null, h(ui.DropdownMenuTrigger, { id:'menu',render:h(ui.Button) }, '操作菜单'), h(ui.DropdownMenuContent, null, h(ui.DropdownMenuItem,{id:'menu-action',onClick:()=>setReceipt('菜单已执行')},'复制'),h(ui.DropdownMenuItem,{disabled:true},'禁用操作')))),
        sample('ContextMenu',h(ui.ContextMenu,null,h(ui.ContextMenuTrigger,{render:h('div',{id:'context',tabIndex:0})},'右键或菜单键打开'),h(ui.ContextMenuContent,null,h(ui.ContextMenuItem,{onClick:()=>setReceipt('上下文已执行')},'复制引用')))),
        sample('Command / CommandDialog',command(),h(ui.CommandDialog,null,h(ui.CommandDialogTrigger,{id:'command-dialog',render:h(ui.Button)},'打开命令面板'),h(ui.CommandDialogPopup,null,h(ui.CommandDialogTitle,null,'命令面板'),command()))),
        sample('Popover / HoverCard / Tooltip',h(ui.Popover,null,h(ui.PopoverTrigger,{id:'popover',render:h(ui.Button)},'打开浮层'),h(ui.PopoverContent,null,'浮层内容')),h(ui.HoverCard,null,h(ui.HoverCardTrigger,{render:h('a',{href:'#',id:'hover'})},'查看来源'),h(ui.HoverCardContent,null,'来源内容')),h(ui.Tooltip,null,h(ui.TooltipTrigger,{render:h(ui.Button),id:'tooltip'},'帮助'),h(ui.TooltipContent,null,'帮助说明'))),
      ],
      '对话框与抽屉': [
        sample('Dialog',h(ui.Dialog,null,h(ui.DialogTrigger,{id:'dialog-trigger',render:h(ui.Button)},'编辑项目'),h(ui.DialogContent,{closeLabel:'关闭'},h(ui.DialogHeader,null,h(ui.DialogTitle,null,'编辑项目'),h(ui.DialogDescription,null,'短表单')),h(ui.Input,{'aria-label':'弹窗输入',defaultValue:'保留输入'})))),
        sample('AlertDialog',h(ui.AlertDialog,{open:confirmOpen,onOpenChange:setConfirmOpen},h(ui.AlertDialogTrigger,{id:'confirm-trigger',render:h(ui.Button)},'删除确认'),h(ui.AlertDialogContent,null,h(ui.AlertDialogHeader,null,h(ui.AlertDialogTitle,null,'确认删除？'),h(ui.AlertDialogDescription,null,'此处只调用隔离演示回调。')),h(ui.AlertDialogFooter,null,h(ui.AlertDialogCancel,{id:'confirm-cancel'},'取消'),h(ui.AlertDialogAction,{id:'confirm-action',onClick:()=>{setReceipt('确认已执行');setConfirmOpen(false);}},'确认'))))),
        sample('Sheet',h(ui.Sheet,null,h(ui.SheetTrigger,{id:'sheet-trigger',render:h(ui.Button)},'打开抽屉'),h(ui.SheetContent,null,h(ui.SheetHeader,null,h(ui.SheetTitle,null,'长编辑'),h(ui.SheetDescription,null,'抽屉内容')),h(ui.Textarea,{'aria-label':'抽屉说明',defaultValue:'编辑草稿'})))),
      ],
      '数据、状态与布局': [
        sample('Table / Card',
          h(ui.Card,null,
            h(ui.CardHeader,null,h(ui.CardTitle,null,'项目列表')),
            h(ui.CardContent,null,
              h(ui.Table,null,
                h(ui.TableHeader,null,h(ui.TableRow,null,h(ui.TableHead,null,'名称'),h(ui.TableHead,null,'状态'))),
                h(ui.TableBody,null,h(ui.TableRow,null,h(ui.TableCell,null,'演示项目'),h(ui.TableCell,null,h(ui.Badge,null,'待处理')))))))),
        sample('Avatar / Image',h(ui.Avatar,null,h(ui.AvatarImage,{src:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="teal"/></svg>'),alt:'头像'}),h(ui.AvatarFallback,null,'IP')),h(ui.Image,{alt:'图片占位',style:{height:40,width:80}})),
        sample('Alert / Toast',...['default','success','warning','destructive'].filter(variant=>!dismissed.includes(variant)).map(variant=>h(ui.Alert,{key:variant,variant,'data-feedback':variant,onDismiss:()=>setDismissed([...dismissed,variant]),closeLabel:'关闭'+variant},h(ui.AlertTitle,null,({default:'信息提醒',success:'连接成功',warning:'操作提醒',destructive:'连接失败'})[variant]),h(ui.AlertDescription,null,'错误留在原位置'),variant==='destructive'?h(ui.AlertAction,null,action('alert-retry','重试连接',()=>setReceipt('提醒重试已执行'))):null)),action('notify','成功提示',()=>ui.toast.success('操作成功'))),
        sample('Badge / Progress / Skeleton / Empty',...['info','success','warning','destructive'].map((variant,index)=>h(ui.Badge,{key:variant,variant,'data-semantic-badge':variant},h(ui.Icon,{name:['Info','CircleCheck','TriangleAlert','CircleX'][index],'data-icon':'inline-start'}),['处理中','已保存','已中断','失败'][index])),h(ui.Progress,{value:40,'aria-label':'实际进度'}),h(ui.Skeleton,{style:{height:16,width:100}}),h(ui.Empty,null,h(ui.EmptyHeader,null,h(ui.EmptyTitle,null,'暂无结果'),h(ui.EmptyDescription,null,'请选择条件')))),
        sample('Tabs / Accordion / Collapsible',h(ui.Tabs,{defaultValue:'one'},h(ui.TabsList,null,h(ui.TabsTrigger,{value:'one'},'概览'),h(ui.TabsTrigger,{value:'two',id:'tab-two'},'详情')),h(ui.TabsContent,{value:'one'},'概览内容'),h(ui.TabsContent,{value:'two'},'详情内容')),h(ui.Accordion,null,h(ui.AccordionItem,{value:'first'},h(ui.AccordionTrigger,{id:'accordion'},'展开说明'),h(ui.AccordionContent,null,'说明已展开'))),h(ui.Collapsible,null,h(ui.CollapsibleTrigger,{id:'collapse',render:h(ui.Button)},'展开详情'),h(ui.CollapsibleContent,null,'详情已展开'))),
        sample('ScrollArea / Separator / DescriptiveButton',h(ui.ScrollArea,{style:{height:80}},h(ui.ScrollAreaViewport,{'aria-label':'可滚动内容'},h('div',null,Array.from({length:10},(_,i)=>h('p',{key:i},'滚动内容 '+i))))),h(ui.Separator),h(ui.DescriptiveButton,{id:'descriptive',onClick:()=>setReceipt('描述按钮已执行')},h(ui.DescriptiveButtonContent,null,h(ui.DescriptiveButtonTitle,null,'继续编辑'),h(ui.DescriptiveButtonDescription,null,'标题和说明共用按钮')))),
      ],
    };
    return h(ui.TooltipProvider,null,h('header',null,h('h1',null,'共享核心组件 · '+ui.mode),h('nav',null,Object.keys(groups).map(title=>action('group-'+title,title,()=>setSection(title)))),h('output',{id:'receipt',role:'status'},receipt)),h('main',{'data-group':section},...groups[section]),h(ui.Toaster,{closeLabel:'关闭'}));
  }
  addEventListener('message',event=>{if(event.data?.theme)document.documentElement.dataset.theme=event.data.theme;});
  ui.createRoot(document.querySelector('#root')).render(h(Demo));
}

export function coreDemoHtml(runtimeScript = '') {
  return `<!doctype html><html lang="zh" data-theme="light"><head><meta name="ipollowork-ui-runtime" content="1"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;font:13px/1.5 system-ui;background:var(--background);color:var(--foreground)}header{position:sticky;top:0;z-index:2;background:var(--background);padding:8px 0}h1{font-size:18px}h2{font-size:14px;margin:0 0 12px}nav{display:flex;flex-wrap:wrap;gap:8px}output{display:block;margin-top:8px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:16px}article{min-width:0;border:1px solid var(--border);padding:16px;border-radius:12px}article>*{max-width:100%}</style>${runtimeScript ? '<script>'+runtimeScript.replaceAll('</script','<\\/script')+'</script>' : ''}</head><body><div id="root"></div><script>(${mountLibrary.toString()})();</script></body></html>`;
}
