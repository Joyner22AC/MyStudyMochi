import * as THREE from './vendor/three.module.js';
import {ViewMotion} from './motion.js';

// Animate the real sheet in the room; hand off to the unchanged note only at rest.
export function createPaperReader({getPaper,getCamera,courses,requestFrame,freezeView,reduced}){
 const travel=new ViewMotion(0,10),saved=new Map();
 let index=-1,base=null,phase='closed',ready=false,timer=null,returnFocus=null,source='desk',paperParent=null;
 const selected=()=>getPaper(index,source);
 function bind(paper){paperParent=source==='drawer'?paper.parent:null;if(paperParent)paperParent.parent.attach(paper);return {object:paper,position:paper.position.clone(),quaternion:paper.quaternion.clone(),scale:paper.scale.clone()};}
 const host=document.createElement('section');host.id='paper-reader';host.hidden=true;
 host.setAttribute('role','dialog');host.setAttribute('aria-modal','true');host.setAttribute('aria-label','展开的学习笔记');
 host.innerHTML='<header class="paper-reader-bar"><button type="button" data-close aria-label="合上笔记，返回原来的书桌视角">← 放回书桌</button><span data-title></span><a data-direct target="_blank" rel="noopener">独立打开 ↗</a></header><div class="paper-reader-page"><p data-status role="status">正在展开笔记…</p><div data-failure hidden><p>这份笔记暂时没有打开。</p><button type="button" data-retry>重试</button><a data-backup target="_blank" rel="noopener">直接打开笔记 ↗</a></div></div>';
 document.body.append(host);
 const close=host.querySelector('[data-close]'),status=host.querySelector('[data-status]'),failure=host.querySelector('[data-failure]');
 const page=host.querySelector('.paper-reader-page');
 const frame=document.createElement('iframe');frame.title='学习笔记';frame.allowFullscreen=true;frame.hidden=true;
 host.querySelector('.paper-reader-page').append(frame);
 const controls=[document.querySelector('.topline'),document.querySelector('.view-control')];
 function busy(value){controls.forEach(el=>{el.inert=value;});document.body.classList.toggle('paper-reading',value);}
 function remember(){
  if(index<0||!ready)return;
  try{const entry={href:frame.contentWindow.location.href,scroll:frame.contentWindow.scrollY};saved.set(index,entry);window.dispatchEvent(new CustomEvent('desk:reading-progress',{detail:{kind:'course',index,...entry}}));}catch{}
 }
 function fail(){if(phase==='closed'||travel.target===0)return;ready=false;frame.hidden=true;status.hidden=true;failure.hidden=false;}
 function load(){
  ready=false;status.hidden=false;failure.hidden=true;frame.hidden=true;clearTimeout(timer);
  const entry=saved.get(index);frame.src=entry?.href||new URL(courses[index].href,location.href).href;
  timer=setTimeout(fail,18000);
 }
 function closeReader(){
  if(phase==='closed'||phase==='closing')return;
  remember();clearTimeout(timer);host.classList.add('is-closing');
  phase='closing';travel.setTarget(0);requestFrame();
 }
 frame.addEventListener('load',()=>{
  if(index<0||phase==='closed'||phase==='closing')return;
  clearTimeout(timer);
  try{
   const doc=frame.contentDocument;
   if(!doc||/^(Error response|404(?:\b|:))/i.test(doc.title))return fail();
   ready=true;status.hidden=true;failure.hidden=true;frame.hidden=false;
   host.querySelector('[data-direct]').href=frame.contentWindow.location.href;
   // Same-origin navigation remains inside the original note, including encrypted courses.
   doc.addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.defaultPrevented){closeReader();e.preventDefault();}});
   doc.addEventListener('click',e=>{
    const anchor=e.target.closest('a[href]');if(!anchor||anchor.target==='_blank'||e.ctrlKey||e.metaKey)return;
    const url=new URL(anchor.href,frame.contentWindow.location.href);
    const home=new URL('../',location.href),localHome=new URL('../学习笔记_课程总入口.html',location.href);
    if(url.origin===location.origin&&(url.pathname===home.pathname||url.pathname===localHome.pathname)){
     e.preventDefault();closeReader();
    }
   });
   const entry=saved.get(index);if(entry&&entry.href===frame.contentWindow.location.href){doc.documentElement.getBoundingClientRect();frame.contentWindow.scrollTo({top:entry.scroll,behavior:'instant'});}
   if(phase==='reading')frame.hidden=false;
  }catch{fail();}
 });
 frame.addEventListener('error',fail);close.addEventListener('click',closeReader);
 window.addEventListener('pagehide',remember);
 host.querySelector('[data-retry]').addEventListener('click',load);
 document.addEventListener('keydown',e=>{
  if(phase==='closed')return;
  if(e.key==='Escape'){closeReader();e.preventDefault();}
  if(e.key==='Tab'&&phase!=='reading'){e.preventDefault();close.focus({preventScroll:true});}
 });
 function open(i,options={}){
  if(phase!=='closed'||!getPaper(i,options.source||'desk'))return;
  freezeView();index=i;source=options.source||'desk';returnFocus=document.activeElement;
  if(options.resume)saved.set(index,options.resume);
  const paper=selected();base=bind(paper);
  phase='opening';busy(true);travel.setTarget(1);
  host.querySelector('[data-title]').textContent=courses[index].title;
  for(const selector of ['[data-direct]','[data-backup]'])host.querySelector(selector).href=courses[index].href;
  host.hidden=false;host.classList.remove('is-readable','is-closing');page.removeAttribute('style');close.focus({preventScroll:true});
  load();requestFrame();
 }
 function update(dt){
  if(phase==='closed')return;
  if(reduced.matches)travel.finish();else travel.step(dt);
  const paper=selected(),camera=getCamera();if(!paper||!camera)return;
  // Rebind to rebuilt geometry on resize/orientation change, preserving progress.
  if(base.object!==paper)base=bind(paper);
  const t=travel.position,distance=12,forward=new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion);
  const up=new THREE.Vector3(0,1,0).applyQuaternion(camera.quaternion);
  const end=camera.position.clone().addScaledVector(forward,distance);
  const endRotation=camera.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI/2));
  const {width,height}=paper.getObjectByName('paper face').geometry.parameters;
  const visibleHeight=2*distance*Math.tan(THREE.MathUtils.degToRad(camera.fov/2));
  const endScale=new THREE.Vector3(visibleHeight*camera.aspect/width,1,visibleHeight/height);
  paper.position.copy(base.position).lerp(end,t).addScaledVector(up,Math.sin(t*Math.PI)*1.6);
  paper.quaternion.copy(base.quaternion).slerp(endRotation,t);paper.scale.copy(base.scale).lerp(endScale,t);
  if(phase==='closing'){
   // Carry the actual live note back with its physical sheet rather than cutting to a cover.
   paper.updateMatrixWorld(true);
   const sheet=paper.getObjectByName('paper face'),bar=host.querySelector('.paper-reader-bar').getBoundingClientRect().height;
   const corners=[[-width/2,height/2-height*bar/innerHeight],[width/2,height/2-height*bar/innerHeight],[width/2,-height/2],[-width/2,-height/2]].map(([x,y])=>{
    const q=sheet.localToWorld(new THREE.Vector3(x,y,0)).project(camera);return [(q.x+1)*innerWidth/2,(1-q.y)*innerHeight/2];
   });
   page.style.width=innerWidth+'px';page.style.height=(innerHeight-bar)+'px';
   page.style.transform=projectiveTransform(corners,innerWidth,innerHeight-bar);
   page.style.opacity=String(Math.min(1,t*3));
  }
  if(!travel.active&&travel.target===1&&phase==='opening'){
   phase='reading';host.classList.add('is-readable');frame.hidden=!ready;close.focus({preventScroll:true});
  }
  if(!travel.active&&travel.target===0){
   paper.position.copy(base.position);paper.quaternion.copy(base.quaternion);paper.scale.copy(base.scale);
   if(paperParent)paperParent.attach(paper);paperParent=null;
   phase='closed';index=-1;base=null;host.hidden=true;busy(false);
   const focus=returnFocus?.isConnected&&returnFocus!==document.body?returnFocus:document.querySelector('#catalog-toggle');
   focus?.focus({preventScroll:true});
  }
 }
 return {open,update,close:closeReader,get active(){return phase!=='closed';},get moving(){return travel.active;},
  owns:paper=>index>=0&&selected()===paper,
  snapshot:()=>({phase,index,progress:travel.position,ready})};
}

// Homography from a rectangular reading surface to the projected sheet's four corners.
function projectiveTransform(corners,width,height){
 const rows=[];
 [[0,0],[1,0],[1,1],[0,1]].forEach(([u,v],i)=>{
  const [x,y]=corners[i];rows.push([u,v,1,0,0,0,-x*u,-x*v,x],[0,0,0,u,v,1,-y*u,-y*v,y]);
 });
 for(let col=0;col<8;col++){
  let pivot=col;for(let r=col+1;r<8;r++)if(Math.abs(rows[r][col])>Math.abs(rows[pivot][col]))pivot=r;
  [rows[col],rows[pivot]]=[rows[pivot],rows[col]];const divisor=rows[col][col];
  if(Math.abs(divisor)<1e-9)return 'none';
  for(let j=col;j<9;j++)rows[col][j]/=divisor;
  for(let r=0;r<8;r++)if(r!==col){const factor=rows[r][col];for(let j=col;j<9;j++)rows[r][j]-=factor*rows[col][j];}
 }
 const [a,b,c,d,e,f,g,h]=rows.map(r=>r[8]);
 return `matrix3d(${[a/width,d/width,0,g/width,b/height,e/height,0,h/height,0,0,1,0,c,f,0,1].join(',')})`;
}
