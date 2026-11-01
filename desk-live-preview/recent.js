const KEY='mystudy:desk:recent:v1';
export function createRecent(courses){
 let entries=[],available=true;const listeners=new Set();
 function sanitize(value){
  if(!value||!Number.isFinite(value.updated)||value.updated<0)return null;
  if(value.kind==='book')return {kind:'book',updated:Math.min(Date.now(),value.updated)};
  if(value.kind!=='course'||!Number.isInteger(value.index)||!courses[value.index])return null;
  const home=new URL(courses[value.index].href,location.href);let url;
  try{url=new URL(value.href,location.href);}catch{return null;}
  if(url.origin!==location.origin)return null;
  url.search='';url.hash='';
  let target,base;try{target=decodeURIComponent(url.pathname);base=decodeURIComponent(home.pathname);}catch{return null;}
  const directory=target.slice(0,target.lastIndexOf('/')+1),site=decodeURIComponent(new URL('../',location.href).pathname);
  const legacy=directory===site&&target.split('/').at(-1).startsWith(courses[value.index].title+'_');
  const allowed=base.endsWith('/')?target.startsWith(base)||legacy:directory===base.slice(0,base.lastIndexOf('/')+1)&&target.split('/').at(-1).startsWith(base.split('/').at(-1).split('_')[0]+'_');
  if(!allowed||!(target.endsWith('.html')||target.endsWith('/')))return null;
  const scroll=Number.isFinite(value.scroll)?Math.min(10000000,Math.max(0,value.scroll)):0;
  return {kind:'course',index:value.index,href:url.pathname,scroll,updated:Math.min(Date.now(),value.updated)};
 }
 try{
  const raw=localStorage.getItem(KEY);
  if(raw&&raw.length<24000){let data;try{data=JSON.parse(raw);}catch{data=null;}if(data?.version===1&&Array.isArray(data.entries))entries=data.entries.map(sanitize).filter(Boolean).slice(0,6);}
  localStorage.setItem(KEY,JSON.stringify({version:1,entries}));
 }catch{available=false;}
 function notify(){listeners.forEach(fn=>fn(entries.slice()));}
 function write(){try{localStorage.setItem(KEY,JSON.stringify({version:1,entries}));}catch{available=false;}notify();}
 function record(value){const item=sanitize({...value,updated:Date.now()});if(!item)return;
  entries=[item,...entries.filter(e=>!(e.kind===item.kind&&(e.kind==='book'||e.index===item.index)))].slice(0,6);write();}
 return {record,list:()=>entries.slice(),subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},clear:()=>{entries=[];write();},get available(){return available;}};
}
