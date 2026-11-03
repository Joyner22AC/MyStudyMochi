// Personal writing stays in this browser. Only public catalog targets are linkable.
export const STUDY_KEY='mystudy:desk:journal:v1';
export const dayKey=(date=new Date())=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export function validDay(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const [y,m,d]=value.split('-').map(Number),date=new Date(y,m-1,d,12);
 return y>=2000&&y<=2200&&dayKey(date)===value;
}
export function createStudyStore({courses,getChapters,now=()=>new Date(),storage}){
 let notes=[],visits=[],deleted=[],available=true,writable=true;const listeners=new Set();
 try{storage=storage===undefined?window.localStorage:storage;}catch{available=false;storage=null;}
 const cleanText=(v,max)=>typeof v==='string'?v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').slice(0,max):'';
 function chapterId(index,href){
  const url=new URL(href,location.href),site=new URL('../',location.href).pathname;
  const route=decodeURIComponent(url.pathname.startsWith(site)?url.pathname.slice(site.length):url.pathname);
  let hash=2166136261;for(const char of route){hash^=char.codePointAt(0);hash=Math.imul(hash,16777619);}
  return `${index}:p${(hash>>>0).toString(16).padStart(8,'0')}`;
 }
 function targets(){
  return courses.flatMap((course,index)=>{
   const rows=[{id:`${index}:catalog`,index,chapter:-1,title:course.title+' · 课程目录',href:course.href}];
   (getChapters()[index]||[]).forEach((entry,chapter)=>{if(!entry.directoryOnly)rows.push({id:chapterId(index,entry.href),index,chapter,title:course.title+' · '+entry.title,href:entry.href});});
   return rows;
  });
 }
 const resolve=id=>targets().find(t=>t.id===id)||null;
 const validTarget=id=>typeof id==='string'&&/^\d:(?:catalog|p[0-9a-f]{8}|\d{1,3})$/.test(id)&&Boolean(courses[Number(id.split(':')[0])]);
 const stamp=()=>now().getTime();
 const safeTime=v=>Number.isFinite(v)&&v>=0?Math.min(v,stamp()):stamp();
 function cleanNote(v){
  if(!v||typeof v.id!=='string'||!/^n-[a-z0-9-]{1,65}$/.test(v.id))return null;
  return {id:v.id,text:cleanText(v.text,2000),kind:v.kind==='question'?'question':'todo',day:validDay(v.day)?v.day:dayKey(now()),done:v.done===true,target:validTarget(v.target)?v.target:'',updated:safeTime(v.updated)};
 }
 function cleanVisit(v){
  if(!v||!validDay(v.day)||!validTarget(v.target))return null;
  return {day:v.day,target:v.target,done:v.done===true,updated:safeTime(v.updated)};
 }
 function notify(){listeners.forEach(fn=>fn());}
 function pull(){
  if(!writable||!storage)return;
  try{
   const raw=storage.getItem(STUDY_KEY);if(!raw)return;if(raw.length>=1500000)throw Error('Oversized record');const data=JSON.parse(raw);if(data?.version!==1)throw Error('Unsupported record');
   const merge=(local,remote,key,clean)=>{
    const map=new Map();for(const item of [...remote,...local]){const v=clean(item);if(v&&(!map.has(key(v))||map.get(key(v)).updated<=v.updated))map.set(key(v),v);}return [...map.values()].sort((a,b)=>b.updated-a.updated);
   };
   deleted=merge(deleted,Array.isArray(data.deleted)?data.deleted:[],v=>v.id,v=>typeof v?.id==='string'&&/^n-[a-z0-9-]{1,65}$/.test(v.id)?{id:v.id,updated:safeTime(v.updated)}:null).slice(0,200);
   notes=merge(notes,Array.isArray(data.notes)?data.notes:[],v=>v.id,cleanNote).filter(n=>!deleted.some(d=>d.id===n.id&&d.updated>=n.updated)).slice(0,100);
   visits=merge(visits,Array.isArray(data.visits)?data.visits:[],v=>v.day+'|'+v.target,cleanVisit).slice(0,3650);
  }catch{available=false;writable=false;}
 }
 function save(){
  try{if(!storage||!writable)throw Error('Unavailable');storage.setItem(STUDY_KEY,JSON.stringify({version:1,notes,visits,deleted}));available=true;}catch{available=false;}
  notify();
 }
 pull();
 // Probe persistence even when no records exist. Never read unrelated browser storage.
 save();
 function upsert(value){
  pull();
  const existing=notes.find(n=>n.id===value.id);
  if(!existing&&notes.length>=100)return null;
  const id=existing?.id||'n-'+(globalThis.crypto?.randomUUID?.()||stamp().toString(36)+'-'+Math.random().toString(36).slice(2));
  const note=cleanNote({...existing,...value,id,updated:stamp()});if(!note)return null;
  notes=[note,...notes.filter(n=>n.id!==id)];save();return {...note};
 }
 function record(value){
  if(value?.kind!=='course'||!Number.isInteger(value.index))return;
  let incoming;try{incoming=new URL(value.href,location.href);incoming.search='';incoming.hash='';}catch{return;}
  if(incoming.origin!==location.origin)return;
  const target=targets().find(t=>t.index===value.index&&new URL(t.href,location.href).pathname===incoming.pathname);
  if(!target)return;pull();const day=dayKey(now()),previous=visits.find(v=>v.day===day&&v.target===target.id);
  visits=[{day,target:target.id,done:previous?.done===true,updated:stamp()},...visits.filter(v=>v!==previous)].slice(0,3650);save();
 }
 return {targets,resolve,upsert,record,
  notes:()=>notes.map(n=>({...n})),visits:()=>visits.map(v=>({...v})),
  remove:id=>{pull();notes=notes.filter(n=>n.id!==id);deleted=[{id,updated:stamp()},...deleted.filter(d=>d.id!==id)].slice(0,200);save();},
  complete:(day,target,done)=>{pull();const entry=visits.find(v=>v.day===day&&v.target===target);if(entry){entry.done=Boolean(done);entry.updated=stamp();save();}},
  subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},
  get available(){return available;},
  refresh:()=>{pull();notify();}};
}
