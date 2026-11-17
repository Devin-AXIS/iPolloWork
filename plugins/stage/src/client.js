window.__ModuleLoader__.load({id:'@ipollo/dsh-stage',factory(require){
 const React=require('react'),h=React.createElement;
 const {useState,useEffect}=React;
 const base='/ipollo-stage';
 const css=`.ipw-stage{font-size:14px;line-height:1.6}.ipw-stage h1{margin:0;font-size:32px;line-height:1.2;letter-spacing:-1px}.ipw-stage p{margin:16px 0}.ipw-stage button,.ipw-stage select{font:inherit;color:inherit;background:transparent;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:9px 13px;max-width:100%;box-sizing:border-box}.ipw-stage button{cursor:pointer}.ipw-stage button:disabled{cursor:default;opacity:.5}.ipw-stage button:first-child{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base);border-color:transparent}.ipw-stage a{color:inherit;text-underline-offset:4px}.ipw-stage label{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-width:0}.ipw-stage [role=alert]{border-left:2px solid currentColor;padding-left:12px}.ipw-stage .ipw-stage-note{color:var(--dsw-alias-label-secondary);font-size:13px;margin-top:32px}`;
 async function request(action,input){const response=await fetch(base+'/'+action,input===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});const value=await response.json();if(!response.ok)throw new Error(value.message||({IPW_SIGN_IN_REQUIRED:'请先登录 iPolloWork / Sign in to iPolloWork first',STAGE_LINK_REQUIRED:'请重新关联已有 Stage 账号 / Reconnect your Stage account',STAGE_NOT_CONFIGURED:'请联系管理员配置 Stage / Ask your administrator to configure Stage'}[value.error])||value.error||'Stage unavailable');return value;}
 function Panel(){
  const [state,setState]=useState(null),[workspaces,setWorkspaces]=useState([]),[workspace,setWorkspace]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[link,setLink]=useState(''),[enabled,setEnabled]=useState(false);
  const refresh=async()=>{const value=await request('status');const result=await request('workspaces');setState(value);setWorkspaces(result.workspaces);setEnabled(!!result.workspaces.find(row=>row.id===workspace)?.enabled);return value;};
  useEffect(()=>{let alive=true;Promise.all([request('status'),request('workspaces')]).then(([status,result])=>{if(!alive)return;setState(status);setWorkspaces(result.workspaces);setWorkspace(result.workspaces[0]?.id||'');}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[]);
  async function run(action){setBusy(true);setError('');setLink('');try{const result=await request(action,{});if(result.url)setLink(result.url);await refresh();}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function enable(){setBusy(true);setError('');try{const result=await request('enable',{workspaceId:workspace,enabled:!enabled});setEnabled(result.enabled);}catch(e){setError(e.message);}finally{setBusy(false);}}
  return h('section',{className:'ipw-stage',style:{padding:24,paddingTop:'max(48px, var(--dsh-frame-top-clearance, 0px))',height:'100%',maxWidth:760,boxSizing:'border-box',overflow:'auto',color:'var(--dsw-alias-label-primary)'}},h('style',null,css),
   h('h1',null,'Stage'),h('p',null,'视频创作与对话定制 / Video creation and custom scenes'),
   !state&&!error&&h('p',{role:'status'},'正在连接… / Connecting…'),
   state&&h('p',null,state.connected?'已关联 / Connected · '+(state.stageName||'Stage'):'首次关联已有 Stage 账号，之后自动登录 / Link your existing Stage account once'),
   state&&!state.configured&&h('p',{role:'status'},'平台尚未启用 Stage 连接，请联系管理员。 / Stage is not configured by your platform administrator.'),
   error&&h('p',{role:'alert'},error),
   h('div',{style:{display:'flex',gap:12,flexWrap:'wrap'}},
    h('button',{disabled:busy||!state?.configured,onClick:()=>run(state?.connected?'launch':'connect')},state?.connected?'打开 Stage / Open Stage':'关联 Stage / Link Stage'),
    h('button',{disabled:busy,onClick:()=>refresh().catch(e=>setError(e.message))},'刷新 / Refresh'),
    state?.connected&&h('button',{disabled:busy,onClick:()=>run('disconnect')},'解除关联 / Disconnect')),
   link&&h('p',null,h('a',{href:link,target:'_blank',rel:'noopener noreferrer'},state?.connected?'进入 Stage / Continue to Stage':'继续授权 / Continue authorization')),
   state?.connected&&h('div',{style:{display:'flex',gap:12,flexWrap:'wrap',marginTop:24}},h('label',null,'工作区 / Workspace ',h('select',{value:workspace,onChange:e=>{setWorkspace(e.target.value);setEnabled(!!workspaces.find(row=>row.id===e.target.value)?.enabled);}},workspaces.map(row=>h('option',{key:row.id,value:row.id},row.title)))),h('button',{disabled:busy||!workspace,onClick:enable},enabled?'停止对话调用 / Disable tools':'允许此工作区调用 / Enable tools')),
   h('p',{className:'ipw-stage-note'},'由你打开和启用。对话可上传当前工作区资料、读取组件协议、修改场景和背景、导出视频。模型调用使用平台官方通道，按实际 Token 结算，不冻结积分。 / Opens only on your action. Official model usage is billed by actual tokens.'));
 }
 return {inject:['slots','layout'],apply(ctx){ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:'ipollo-stage'},Panel));ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:'ipollo-stage',order:8,label:()=> 'Stage'},()=>h('span',{'aria-hidden':true},'▶')));ctx.slots.inject('plugins.bundle.config',()=>ctx.slots.register({name:'plugins.bundle.config',key:'@ipollo/dsh-stage'},()=>h('button',{onClick:()=>ctx.layout.selectPanel('ipollo-stage')},'打开 Stage')));}};
}});
