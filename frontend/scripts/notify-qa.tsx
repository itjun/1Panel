/** Dev-only fixture: production notification components, isolated in-memory APIs. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/api';
import '@/react/styles/globals.css';
import '@/react/styles/workbench.css';
import '@/react/styles/uiux.css';

localStorage.setItem('1pannel-react-nav',JSON.stringify({workspace:'notify',notifySection:'metricRules',settingsOpen:false}));
const hostNames=['diteng-main','cdcp-main','diteng-nginx',...Array.from({length:24},(_,i)=>`host-${i+1}`)];
const now=Date.now();
const base={title:'',detail:'',metric:'',value:'88.2%',threshold:'危险 ≥ 85%',peak:'',level:'danger',stage:'',service:'',channels:['system','inApp'],read:false,state:'down'};
let events=[
 {...base,id:'metric-1',incidentId:'metric-1',kind:'mem',host:'host-20',at:now-190000},
 {...base,id:'metric-2',incidentId:'metric-2',kind:'cpu',host:'cdcp-main',at:now-360000},
 {...base,id:'app-1',incidentId:'app-1',kind:'app:im',service:'im',host:'cdcp-main',value:'健康检查失败',level:'',at:now-900000},
 {...base,id:'cert-1',incidentId:'cert-1',kind:'cert',host:'diteng-nginx',level:'',value:'',title:'证书剩余 25 天',detail:'*.example.test · 剩余 25 天',at:now-1100000},
];
let failRead=false;
let operation='无写入';
const publish=(s:string)=>{operation=s; window.dispatchEvent(new Event('qa-operation'))};
Object.assign(api,{
 listHosts:async()=>hostNames.map(name=>({name,hostname:name,user:'root',port:22})),
 listGroups:async()=>[{id:'prod',name:'生产环境',hosts:hostNames.slice(0,3),order:0},{id:'test',name:'测试环境',hosts:hostNames.slice(3),order:1}],
 listHostIcons:async()=>[],
 reorderGroups:async()=>{},
 listAlertHistory:async()=>{if(failRead)throw Error('隔离环境：模拟读取失败');return events.map(e=>({...e}))},
 markAlertRead:async(id:string)=>{events=events.map(e=>e.id===id?{...e,read:true}:e);publish('已读:'+id)},
 deleteAlertHistory:async(ids:string[])=>{events=events.filter(e=>!ids.includes(e.id));publish('删除:'+ids.join(','))},
 setNotifySubs:async()=>publish('订阅或规则已写入隔离适配器'),
 previewHostAlertMarkdown:async()=> '隔离环境消息预览，不会发送',
 getPanelConfigOverview:async()=>({}),
});
const {updateSettings}=await import('@/react/state/settings');
updateSettings({appearance:'light',hostResourceNotifySubs:{'diteng-main':['mem']},hostAppNotifySubs:{'cdcp-main':['im']}});
const {SessionProvider}=await import('@/react/state/session');
const {PageRefreshProvider}=await import('@/react/state/page-refresh');
const {ShellToolbarProvider}=await import('@/react/components/shell-toolbar');
const {NotifyNavigation}=await import('@/react/components/notify/navigation');
const {NotifyPage}=await import('@/react/pages/notify');
const {ModuleRail}=await import('@/react/components/module-rail');
function Fixture(){
 const [dark,setDark]=React.useState(false);
 const [sidebar,setSidebar]=React.useState(true);
 const [last,setLast]=React.useState(operation);
 React.useEffect(()=>{const changed=()=>setLast(operation);window.addEventListener('qa-operation',changed);return()=>window.removeEventListener('qa-operation',changed)},[]);
 return <div style={{display:'flex',height:'100vh',background:'var(--color-canvas)',color:'var(--color-ink)'}}>
  <ModuleRail/>
  <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column'}}>
   <div style={{height:40,display:'flex',alignItems:'center',gap:16,padding:'0 12px',fontSize:12,flexShrink:0}}>
    <button onClick={()=>{setDark(!dark);document.documentElement.classList.toggle('dark',!dark)}}>切换明暗</button>
    <button onClick={()=>setSidebar(!sidebar)}>切换侧栏</button>
    <button onClick={()=>{failRead=!failRead;window.dispatchEvent(new Event('alerts-changed'))}}>模拟读取失败 / 恢复</button>
    <output aria-label="隔离操作结果">{last}</output>
   </div>
   <div style={{display:'flex',flex:1,minHeight:0}}>
    {sidebar?<aside style={{width:200,flexShrink:0,overflow:'auto'}}><NotifyNavigation/></aside>:null}
    <main style={{flex:1,minWidth:0,minHeight:0,background:"var(--color-surface)"}}><NotifyPage/></main>
   </div>
  </div>
 </div>
}
const root=createRoot(document.getElementById('app')!);
import.meta.hot?.dispose(()=>root.unmount());
root.render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><SessionProvider><PageRefreshProvider><ShellToolbarProvider><Fixture/></ShellToolbarProvider></PageRefreshProvider></SessionProvider></QueryClientProvider>);
