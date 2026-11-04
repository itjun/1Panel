import React from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {api} from '@/api';
import '@/react/styles/globals.css';
import '@/react/styles/workbench.css';
import '@/react/styles/uiux.css';
import {SessionProvider} from '@/react/state/session';
import {PageRefreshProvider} from '@/react/state/page-refresh';
import {DiskPage} from '@/react/pages/host-disk';
const GB=1024**3;
const disk=(filesystem:string,mount:string,total:number,used:number,kind='mount')=>({filesystem,mount,total:total*GB,used:used*GB,avail:(total-used)*GB,percent:used/total*100,fsType:'ext4',kind});
const params=new URLSearchParams(location.search);
Object.assign(api,{
 setThemeAppearance:async()=>{},
 collectDisks:async()=>[disk('/dev/sda','sda',50,20.4,'disk'),...(params.has('multi')?[disk('/dev/sdb','sdb',200,80,'disk')]:[]),{...disk('/dev/sda1','/',49.1,20.4),percent:44},...(params.has('multi')?[disk('/dev/sdb1','/data',198,78)]:[])],
 collectLargestFiles:(_host:string,mount:string)=>{
  let rejectTask:(e:Error)=>void;
  const promise=new Promise((resolve,reject)=>{rejectTask=reject;setTimeout(()=>{
   if(params.has('error'))return reject(new Error('agent 不可达：Connection refused'));
   resolve({elapsedMs:10400,incomplete:params.has('partial'),files:Array.from({length:10},(_,i)=>({name:i===0?'agent-api.log':i===1?'btmp.1':'diteng-im-server-202409.01.jar',size:i===0?1.1*GB:(i===1?367.4:289.7)*1024**2,dir:mount==='/data'?'/data/backups':i===0?'/root/ai-agent/logs':i===1?'/var/log':`/root/diteng-center/260901_${i}`,path:`${mount}/sample-${i}`}))});
  },params.has('slow')?120000:250)});
  return Object.assign(promise,{cancel:()=>rejectTask(new Error('cancelled'))});
 },
});
const {updateSettings}=await import('@/react/state/settings');
updateSettings({colorPalette:'apricot-sea',appearance:'light'});
Object.entries({'--color-canvas':'#fffefa','--color-surface':'#fffefa','--color-accent':'#805536','--color-accent-soft':'#fae8bc'}).forEach(([key,value])=>document.documentElement.style.setProperty(key,value));
function Fixture(){const [host,setHost]=React.useState('cdcp-raven');return <><div style={{height:32,paddingLeft:16,fontSize:12}}><span>本地样例预览</span> <button onClick={()=>setHost(host==='cdcp-raven'?'other':'cdcp-raven')}>切换样例主机</button> {host}</div><div style={{height:'calc(100% - 32px)'}}><DiskPage host={host}/></div></>}
const root=createRoot(document.getElementById('app')!);
import.meta.hot?.dispose(()=>root.unmount());
root.render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><SessionProvider><PageRefreshProvider><Fixture/></PageRefreshProvider></SessionProvider></QueryClientProvider>);
