// A real runtime consumer: no app imports, bundled React or component copies.
function mountLibrary(initialSection = '输入与选择') {
  const ui = window.ipolloworkUi;
  const h = ui.React.createElement;
  const required = ['TableSortHead','TablePagination','TablePageSelection','TableBulkActions','Table','Card','CardActionsMenu','DropdownMenuItem','CardHeader','CardTitle','CardDescription','CardContent','CardFooter','CardIcon','CardMeta','Avatar','Image','Field','InputGroup','Autocomplete','Checkbox','RadioGroup','Switch','Toggle','ToggleGroup','DropdownMenu','ContextMenu','Command','AlertDialog','Sheet','Popover','HoverCard','Tooltip','Alert','Badge','Progress','Skeleton','Empty','Tabs','Accordion','Collapsible','ScrollArea','Separator','DescriptiveButton','Button','Icon','SearchField','NumberField','Slider','DatePicker','Calendar','TimeInput','FileUpload','FileUploadItem'];
  ui.requireRuntime(1, required, 8);
  window.__libraryRequired = required;
  function Demo() {
    const [receipt, setReceipt] = ui.React.useState('等待操作');
    const [section, setSection] = ui.React.useState(initialSection);
    const [name, setName] = ui.React.useState('插件草稿');
    const [error, setError] = ui.React.useState(false);
    const [confirmOpen, setConfirmOpen] = ui.React.useState(false);
    const [loading, setLoading] = ui.React.useState(false);
    const [iconClicks, setIconClicks] = ui.React.useState(0);
    const [dismissed, setDismissed] = ui.React.useState([]);
    const [query,setQuery]=ui.React.useState("");
    const [amount,setAmount]=ui.React.useState(50);
    const [date,setDate]=ui.React.useState("2026-10-12");
    const [time,setTime]=ui.React.useState("09:30");
    const [file,setFile]=ui.React.useState(null);
    const [fileError,setFileError]=ui.React.useState("");
    const [compositionText,setCompositionText]=ui.React.useState('保留多行描述\n第二行说明');
    const [feedbackPhase,setFeedbackPhase]=ui.React.useState('success');
    const [feedbackFail,setFeedbackFail]=ui.React.useState(false);
    const [feedbackItems,setFeedbackItems]=ui.React.useState(['已有素材']);
    const [feedbackDraft,setFeedbackDraft]=ui.React.useState('搜索草稿');
    const reloadFeedback=async()=>{setFeedbackPhase('loading');await new Promise(resolve=>setTimeout(resolve,700));if(feedbackFail){setFeedbackPhase('error');return;}setFeedbackItems(['更新后的素材']);setFeedbackPhase('success');};
    const tableRows=ui.React.useRef(Array.from({length:23},(_,i)=>({id:String(i+1),name:'素材 '+String(23-i).padStart(2,'0'),status:i%2?'已完成':'待处理'})));
    const [tableQuery,setTableQuery]=ui.React.useState({search:'',status:'全部',direction:'none',pageIndex:0,pageSize:5});
    const [tableView,setTableView]=ui.React.useState({items:[],total:0,pageIndex:0,pageSize:5,direction:'none'});
    const [tableLoading,setTableLoading]=ui.React.useState(false);
    const [tableError,setTableError]=ui.React.useState('');
    const [tableSelection,setTableSelection]=ui.React.useState([]);
    const [tableConfirm,setTableConfirm]=ui.React.useState(false);
    const [tableBulkBusy,setTableBulkBusy]=ui.React.useState(false);
    const [tableBulkError,setTableBulkError]=ui.React.useState('');
    const [tableFailRead,setTableFailRead]=ui.React.useState(false);
    const [tableFailBulk,setTableFailBulk]=ui.React.useState(true);
    const tableRequest=ui.React.useRef(0);
    const tableBulkLock=ui.React.useRef(false);
    const loadTable=async(query)=>{
      const sequence=++tableRequest.current;setTableLoading(true);setTableError('');
      await new Promise(resolve=>setTimeout(resolve,300));
      if(sequence!==tableRequest.current)return;
      if(tableFailRead){setTableError('模拟读取失败；上一页仍保留');setTableLoading(false);return;}
      const rows=tableRows.current.filter(row=>row.name.includes(query.search)&&(query.status==='全部'||row.status===query.status));
      if(query.direction!=='none')rows.sort((a,b)=>a.name.localeCompare(b.name,'zh',{numeric:true})*(query.direction==='ascending'?1:-1));
      const pageIndex=Math.min(query.pageIndex,Math.max(0,Math.ceil(rows.length/query.pageSize)-1));
      setTableView({items:rows.slice(pageIndex*query.pageSize,(pageIndex+1)*query.pageSize),total:rows.length,pageIndex,pageSize:query.pageSize,direction:query.direction});
      setTableLoading(false);
    };
    ui.React.useEffect(()=>{void loadTable(tableQuery);return()=>{tableRequest.current++;};},[tableQuery]);
    const changeTable=(patch,clearSelection=false)=>{setTableQuery(current=>({...current,...patch}));if(clearSelection){setTableSelection([]);setTableBulkError('');}};
    const executeTableBulk=async()=>{
      if(tableBulkLock.current)return;
      tableBulkLock.current=true;setTableBulkBusy(true);setTableBulkError('');
      const ids=[...tableSelection];
      await new Promise(resolve=>setTimeout(resolve,500));
      const failed=tableFailBulk?ids.slice(-1):[];
      tableRows.current=tableRows.current.filter(row=>!ids.includes(row.id)||failed.includes(row.id));
      setTableSelection(failed);
      setTableBulkError(failed.length?'模拟部分失败：仅保留失败项，可重试':'');
      setReceipt('批量结果：成功 '+(ids.length-failed.length)+'，失败 '+failed.length);
      setTableBulkBusy(false);tableBulkLock.current=false;setTableConfirm(false);
      void loadTable(tableQuery);
    };
    const options = ['电影','产品','角色'];
    const sample = (title, ...children) => h('article', { 'data-sample': title }, h('h2', null, title), ...children);
    const action = (id, title, fn) => h(ui.Button, { id, onClick: fn }, title);
    const command = () => h(ui.Command, { items: options }, h(ui.CommandInput, { 'aria-label': '搜索命令' }), h(ui.CommandEmpty, null, '无匹配命令'), h(ui.CommandList, null, item => h(ui.CommandItem, { key: item, value: item, onClick: () => setReceipt('命令：'+item) }, item)));
    const groups = {
      '数据表格': [
        h('article',{'data-sample':'紧凑数据表格',style:{gridColumn:'1 / -1'}},
          h('h2',null,'素材目录 · 隔离演示，不操作真实文件'),
          h('div',{role:'group','aria-label':'表格筛选',style:{display:'flex',flexWrap:'wrap',gap:8,marginBottom:12}},
            h(ui.SearchField,{id:'table-search',value:tableQuery.search,onValueChange:search=>changeTable({search,pageIndex:0},true),clearLabel:'清除表格搜索','aria-label':'搜索表格',disabled:tableBulkBusy,containerClassName:'min-w-32 flex-1'}),
            h(ui.Select,{value:tableQuery.status,disabled:tableBulkBusy,onValueChange:status=>{if(status)changeTable({status,pageIndex:0},true);}},
              h(ui.SelectTrigger,{'aria-label':'筛选状态',id:'table-status'},h(ui.SelectValue,null,tableQuery.status)),
              h(ui.SelectContent,null,['全部','待处理','已完成'].map(status=>h(ui.SelectItem,{key:status,value:status},status))))),
          tableLoading?h('p',{role:'status',id:'table-loading'},'正在加载，保留上一页'):null,
          tableError?h(ui.Alert,{variant:'destructive',id:'table-error'},h(ui.AlertDescription,null,tableError),h(ui.AlertAction,null,action('table-retry','重试读取',()=>loadTable(tableQuery)))):null,
          tableBulkError?h(ui.Alert,{variant:'destructive',id:'table-bulk-error'},h(ui.AlertDescription,null,tableBulkError)):null,
          h(ui.TableBulkActions,{selectedCount:tableSelection.length,label:'已选择 '+tableSelection.length+' 项（跨页）',clearLabel:'清空选择',onClear:()=>{setTableSelection([]);setTableBulkError('');},busy:tableBulkBusy},
            h(ui.Button,{id:'table-bulk',disabled:tableLoading||!!tableError||tableBulkBusy,onClick:()=>setTableConfirm(true)},'批量操作')),
          h('section',{'aria-busy':tableLoading,id:'table-result'},h(ui.Table,{'aria-label':'素材数据表'},
            h(ui.TableHeader,null,h(ui.TableRow,null,
              h(ui.TableHead,null,h(ui.TablePageSelection,{selectableCount:tableView.items.length,selectedCount:tableView.items.filter(row=>tableSelection.includes(row.id)).length,label:'选择当前页',disabled:tableLoading||!!tableError||tableBulkBusy,onCheckedChange:checked=>setTableSelection(current=>checked?[...new Set([...current,...tableView.items.map(row=>row.id)])]:current.filter(id=>!tableView.items.some(row=>row.id===id)))})),
              h(ui.TableSortHead,{id:'table-sort-head',direction:tableView.direction,label:'切换名称排序',disabled:tableLoading||tableBulkBusy,onDirectionChange:direction=>changeTable({direction,pageIndex:0})},'名称'),
              h(ui.TableHead,null,'状态'))),
            h(ui.TableBody,null,tableView.items.map(row=>h(ui.TableRow,{key:row.id,'data-row-id':row.id,'data-state':tableSelection.includes(row.id)?'selected':undefined},
              h(ui.TableCell,null,h(ui.Checkbox,{'aria-label':'选择 '+row.name,checked:tableSelection.includes(row.id),disabled:tableLoading||!!tableError||tableBulkBusy,onCheckedChange:checked=>setTableSelection(current=>checked?[...current,row.id]:current.filter(id=>id!==row.id))})),
              h(ui.TableCell,{'data-column':'name'},row.name),h(ui.TableCell,null,row.status))))),
            !tableLoading&&!tableError&&!tableView.items.length?h(ui.Empty,{variant:'ghost'},h(ui.EmptyDescription,null,tableQuery.search||tableQuery.status!=='全部'?'没有匹配结果':'暂无素材'),action('table-reset','重置筛选',()=>changeTable({search:'',status:'全部',pageIndex:0},true))):null),
          h(ui.TablePagination,{pageIndex:tableView.pageIndex,pageSize:tableView.pageSize,total:tableView.total,pageSizes:[5,10,20],disabled:tableLoading||tableBulkBusy,onPageChange:pageIndex=>changeTable({pageIndex}),onPageSizeChange:pageSize=>changeTable({pageSize,pageIndex:0}),labels:{navigation:'表格分页',previous:'上一页',next:'下一页',pageSize:'每页条数',status:(page,pages,total)=>'第 '+page+' / '+pages+' 页 · 共 '+total+' 项'}}),
          h('div',{style:{display:'flex',flexWrap:'wrap',gap:8}},
            h(ui.Button,{id:'table-fail-read',variant:'outline','aria-pressed':tableFailRead,onClick:()=>setTableFailRead(!tableFailRead)},'模拟读取失败'),
            h(ui.Button,{id:'table-fail-bulk',variant:'outline','aria-pressed':tableFailBulk,onClick:()=>setTableFailBulk(!tableFailBulk)},'模拟部分失败')),
          h(ui.AlertDialog,{open:tableConfirm,onOpenChange:open=>{if(!tableBulkBusy)setTableConfirm(open);}},
            h(ui.AlertDialogContent,null,h(ui.AlertDialogTitle,null,'确认批量操作'),h(ui.AlertDialogDescription,null,'将对已选择的 '+tableSelection.length+' 项执行隔离演示操作；不会操作真实文件。'),
              h(ui.AlertDialogFooter,null,h(ui.AlertDialogCancel,{disabled:tableBulkBusy},'取消'),
                h(ui.AlertDialogAction,{id:'table-confirm',disabled:tableBulkBusy,onClick:executeTableBulk},tableBulkBusy?'正在执行…':'确认执行'))))),
      ],
      '异步反馈': [
        sample('异步列表演示',h(ui.SearchField,{id:'feedback-draft',value:feedbackDraft,onValueChange:setFeedbackDraft,clearLabel:'清除搜索','aria-label':'搜索草稿'}),
          h('section',{id:'feedback-region','aria-busy':feedbackPhase==='loading'},
            feedbackPhase==='loading'?h('p',{role:'status'},'正在更新，保留上次内容'):null,
            feedbackPhase==='error'?h(ui.Alert,{variant:'destructive'},h(ui.AlertDescription,null,'模拟请求失败，已有内容保留'),h(ui.AlertAction,null,action('feedback-retry','重试',reloadFeedback))):null,
            feedbackPhase==='success'?h('p',{role:'status'},'列表已更新'):null,
            feedbackItems.length?h('ul',{id:'feedback-items'},...feedbackItems.map(item=>h('li',{key:item},item))):feedbackPhase!=='loading'&&feedbackPhase!=='error'?h(ui.Empty,{variant:'ghost'},h(ui.EmptyDescription,null,'尚无素材'),action('feedback-empty-reset','恢复演示内容',()=>setFeedbackItems(['已有素材']))):null),
          action('feedback-reload','刷新演示列表',reloadFeedback),
          h(ui.Checkbox,{id:'feedback-fail',checked:feedbackFail,onCheckedChange:setFeedbackFail,'aria-label':'模拟请求失败'}),
          action('feedback-empty','演示空列表',()=>{setFeedbackItems([]);setFeedbackPhase('success');})),
      ],
      '组合模式': [
        sample('标准表单',h(ui.FieldGroup,null,
          h(ui.Field,{'data-invalid':error},
            h(ui.FieldLabel,{htmlFor:'composition-name'},'名称'),
            h(ui.Input,{id:'composition-name',value:name,required:true,'aria-invalid':error,'aria-describedby':'composition-name-help'+(error?' composition-name-error':''),onChange:e=>{setName(e.currentTarget.value);setError(false);}}),
            h(ui.FieldDescription,{id:'composition-name-help'},'必填，提交失败保留输入。'),
            error?h(ui.FieldError,{id:'composition-name-error'},'模拟保存失败，请重试'):null),
          h(ui.Field,{orientation:'horizontal'},h(ui.Switch,{id:'composition-enabled'}),h(ui.FieldContent,null,h(ui.FieldLabel,{htmlFor:'composition-enabled'},'启用'),h(ui.FieldDescription,null,'立即生效的开关。'))),
          h(ui.Field,{orientation:'responsive'},h(ui.FieldContent,null,h(ui.FieldLabel,{htmlFor:'composition-unit'},'时长'),h(ui.FieldDescription,null,'宽容器横排，窄容器竖排。')),
            h(ui.InputGroup,null,h(ui.InputGroupInput,{id:'composition-unit',type:'number',defaultValue:15}),h(ui.InputGroupAddon,{align:'inline-end',tabIndex:-1},h(ui.InputGroupText,null,'秒')))),
          action('composition-fail','模拟保存失败',()=>setError(true)))),
        sample('多行输入组合',h(ui.Field,null,h(ui.FieldLabel,{htmlFor:'composition-text'},'描述'),
          h(ui.InputGroup,{id:'composition-text-group'},h(ui.InputGroupTextarea,{id:'composition-text',value:compositionText,rows:3,maxLength:300,'aria-describedby':'composition-count',onChange:e=>setCompositionText(e.currentTarget.value)}),
            h(ui.InputGroupAddon,{align:'block-end',tabIndex:-1},h(ui.InputGroupText,{id:'composition-count'},compositionText.length+' / 300'),
              h(ui.InputGroupButton,{id:'composition-clear','aria-label':'清空描述',disabled:!compositionText,onClick:()=>setCompositionText('')},h(ui.Icon,{name:'X'})))))),
        sample('主动作与更多菜单',h('div',{role:'group','aria-label':'作品操作',style:{display:'flex',flexWrap:'wrap',gap:8}},
          action('composition-save','保存',()=>setReceipt('组合保存已执行')),
          h(ui.DropdownMenu,null,h(ui.DropdownMenuTrigger,{render:h(ui.Button,{variant:'outline','aria-label':'更多作品操作',id:'composition-more'})},'更多',h(ui.Icon,{name:'ChevronDown'})),
            h(ui.DropdownMenuContent,null,h(ui.DropdownMenuItem,{onClick:()=>setReceipt('模板操作已执行')},'保存为模板'),h(ui.DropdownMenuItem,{disabled:true},'暂不可用'))))),
      ],
      '高频控件': [
        sample('搜索与清空',h(ui.SearchField,{id:'compact-search',value:query,onValueChange:setQuery,clearLabel:'清除搜索','aria-label':'搜索素材',placeholder:'搜索素材…'}),
          h('output',{id:'search-results'},['中文素材','图片素材','配音素材'].filter(value=>value.includes(query)).join('、')||'暂无匹配素材')),
        sample('数值与滑块',h(ui.NumberField,{id:'compact-number',label:'音量',value:amount,onValueChange:setAmount,min:0,max:100,step:5,suffix:'%',invalidLabel:'请输入 0–100 的数值'}),
          h(ui.Slider,{id:'compact-slider',value:Math.min(100,Math.max(0,amount??0)),onValueChange:setAmount,min:0,max:100,step:5,thumbLabels:['音量滑块']}),
          h('output',{id:'numeric-value'},String(amount))),
        sample('日期与时间',h(ui.DatePicker,{id:'compact-date',value:date,onValueChange:setDate,min:'2026-10-10',max:'2026-11-30',calendarLabel:'打开日历',clearLabel:'清除日期','aria-label':'截止日期'}),
          h(ui.TimeInput,{id:'compact-time','aria-label':'执行时间',value:time,onChange:e=>setTime(e.currentTarget.value)}),
          h('output',{id:'date-value'},date+' '+time)),
        sample('上传与恢复',h(ui.FileUpload,{label:'选择或拖入图片',description:'PNG / JPG · 最大 1 KB',accept:'.png,.jpg',maxSize:1024,
          messages:{invalidType:'仅支持 PNG / JPG',tooLarge:'文件超过 1 KB',empty:'文件不能为空',tooMany:'一次仅选一个文件'},
          onError:setFileError,onFilesSelected:files=>{setFile(files[0]);setFileError('');setReceipt('已选择：'+files[0].name);}}),
          file?h(ui.FileUploadItem,{name:file.name,status:fileError?'error':'ready',statusLabel:'文件已就绪',error:fileError,onRetry:()=>{setFileError('');setReceipt('重试保留：'+file.name);},retryLabel:'重试',onRemove:()=>setFile(null),removeLabel:'移除文件'}):fileError?h('p',{role:'alert',id:'upload-error'},fileError):null,
          action('upload-fail','模拟上传失败',()=>setFileError('模拟传输失败，文件保留')),h('output',{id:'file-name'},file?.name||'')),
      ],
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
          h(ui.Card,{id:'default-card'},
            h(ui.CardHeader,null,h(ui.CardTitle,null,'项目列表')),
            h(ui.CardContent,null,
              h(ui.Table,null,
                h(ui.TableHeader,null,h(ui.TableRow,null,h(ui.TableHead,null,'名称'),h(ui.TableHead,null,'状态'))),
                h(ui.TableBody,null,h(ui.TableRow,null,h(ui.TableCell,null,'演示项目'),h(ui.TableCell,null,h(ui.Badge,null,'待处理')))))))),
        sample('Resource Card',
          h(ui.Card,{variant:'resource',id:'resource-card'},
            h(ui.CardHeader,null,h(ui.CardIcon,{id:'resource-card-icon'},h('img',{alt:'资源品牌',src:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="4" fill="teal"/></svg>')})),h('div',{className:'min-w-0'},h(ui.CardTitle,{as:'h3'},'共享资源卡'),h(ui.CardDescription,null,'说明保持可读，使用共享字体和布局。'))),
            h(ui.CardContent,null,h(ui.CardMeta,null,'v1.0.0 · 资源元信息')),
            h(ui.CardFooter,null,h(ui.CardMeta,null,'已就绪'),h(ui.Button,{id:'resource-card-action',size:'sm',variant:'outline',onClick:()=>setReceipt('资源卡动作已执行')},'查看'))),
          h(ui.Card,{variant:'outline',id:'outline-card'},h(ui.CardHeader,null,h(ui.CardTitle,null,'原有描边卡')),h(ui.CardContent,null,'既有默认尺寸与版式保留'))),
        h('article',{'data-sample':'Resource Card Row',style:{gridColumn:'1 / -1'}},h('h2',null,'Resource Card Row · 无边框款'),
          h(ui.Card,{variant:'resource',layout:'row',surface:'plain',id:'resource-row-card'},
            h(ui.CardHeader,null,h(ui.CardIcon,null,h(ui.Icon,{name:'Folder'})),h('div',{className:'min-w-0'},h(ui.CardTitle,{as:'h3'},'紧凑资源行'),h(ui.CardDescription,null,'名称和一句说明，操作在右侧或右下。'))),
            h(ui.CardFooter,null,h(ui.Button,{id:'resource-row-action',size:'sm',variant:'outline',onClick:()=>setReceipt('资源行动作已执行')},'查看')))),
        h('article',{'data-sample':'Resource Card Row Outline',style:{gridColumn:'1 / -1'}},h('h2',null,'Resource Card Row · 描边款'),
          h(ui.Card,{variant:'resource',layout:'row',surface:'outline',id:'resource-row-outline-card'},
            h(ui.CardHeader,null,h(ui.CardIcon,null,h(ui.Icon,{name:'Folder'})),h('div',{className:'min-w-0'},h(ui.CardTitle,{as:'h3'},'紧凑资源行'),h(ui.CardDescription,null,'名称和一句说明，操作在右侧或右下。'))),
            h(ui.CardFooter,null,h(ui.Button,{size:'sm',variant:'outline',onClick:()=>setReceipt('描边资源行动作已执行')},'查看')))),
        sample('Resource Card Actions',h(ui.CardActionsMenu,{label:'资源卡操作'},h(ui.DropdownMenuItem,{id:'resource-menu-action',onClick:()=>setReceipt('资源菜单动作已执行')},'查看详情'))),
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

export function coreDemoHtml(runtimeScript = '', initialSection = '输入与选择') {
  return `<!doctype html><html lang="zh" data-theme="light"><head><meta name="ipollowork-ui-runtime" content="1"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;font:13px/1.5 system-ui;background:var(--background);color:var(--foreground)}header{position:sticky;top:0;z-index:2;background:var(--background);padding:8px 0}h1{font-size:18px}h2{font-size:14px;margin:0 0 12px}nav{display:flex;flex-wrap:wrap;gap:8px}output{display:block;margin-top:8px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:16px}article{min-width:0;border:1px solid var(--border);padding:16px;border-radius:12px}article>*{max-width:100%}</style>${runtimeScript ? '<script>'+runtimeScript.replaceAll('</script','<\\/script')+'</script>' : ''}</head><body><div id="root"></div><script>(${mountLibrary.toString()})(${JSON.stringify(initialSection)});</script></body></html>`;
}
