/* Web scene host: projected HTML paper, cached camera film, existing crypto host. */
(() => {
 'use strict';
 const $=id=>document.getElementById(id);
 const world=$('world'),image=$('room-image'),papers=[...document.querySelectorAll('.scene-paper')];
 const shelf=$('personal-library'),locked=$('shelf-locked'),book=$('open-home-book');
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 const portrait=matchMedia('(max-width: 650px)').matches,aspect=portrait?.625:1.6;
 document.body.classList.toggle('portrait-scene',portrait);
 let constants,frames=[],images=[],stills={},view=0,moving=false,epoch=0;
 const lifts=papers.map(()=>0);let layoutPending=false;

 function matrix(q,w,h){
  const [[x0,y0],[x1,y1],[x2,y2],[x3,y3]]=q;
  const dx1=x1-x2,dx2=x3-x2,dx3=x0-x1+x2-x3;
  const dy1=y1-y2,dy2=y3-y2,dy3=y0-y1+y2-y3;
  const den=dx1*dy2-dx2*dy1;
  const g=Math.abs(den)<1e-8?0:(dx3*dy2-dx2*dy3)/den;
  const k=Math.abs(den)<1e-8?0:(dx1*dy3-dx3*dy1)/den;
  return `matrix3d(${(x1-x0+g*x1)/w},${(y1-y0+g*y1)/w},0,${g/w},${(x3-x0+k*x3)/h},${(y3-y0+k*y3)/h},0,${k/h},0,0,1,0,${x0},${y0},0,1)`;
 }
 function projectQuad(points,cam,w,h){
  const q=points.map(p=>DeskCamera.project(p,cam));
  if(q.some(p=>!p))return null;
  return q.map(([x,y])=>[x*w,y*h]);
 }
 function layout(){
  layoutPending=false;if(!constants)return;
  const {width:w,height:h}=world.getBoundingClientRect();
  const cam=DeskCamera.at(view,aspect,constants);
  papers.forEach((paper,i)=>{
   if(paper.classList.contains('is-opening'))return;
   const x=portrait?(i%2-.5)*15.7:(i%3-1)*9.7;
   const z=portrait?cam.zf+13.5+Math.floor(i/2)*13.7:Math.floor(i/3)*6.5-5.3,y=.10+lifts[i];
   const angle=(i%2?.018:-.026),s=Math.sin(angle),c=Math.cos(angle);
   const hw=portrait?6.9:4.05,hh=portrait?5.2:2.75;
   const q=projectQuad([[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]].map(([a,b])=>[x+a*c-b*s,y,z+a*s+b*c]),cam,w,h);
   paper.hidden=view>.06;paper.inert=moving||view>.06;
   if(q)paper.style.transform=matrix(q,310,210);
  });
  // The real encrypted title occupies the original index-book's geometric spine.
  const x=constants.RM_BK_X0+constants.RM_BK_HW;
  const z=cam.shzf-.55+.10;
  const quad=projectQuad([[x-1,constants.RM_BN_FOOT+8.85,z],[x+1,constants.RM_BN_FOOT+8.85,z],[x+1,constants.RM_BN_FOOT+.15,z],[x-1,constants.RM_BN_FOOT+.15,z]],cam,w,h);
  if(quad){const m=matrix(quad,90,300);locked.style.transform=m;book.style.transform=m;}
  locked.hidden=view<.999||moving||shelf.dataset.unlocked==='true';
  $('shelf-books').inert=view<.999||moving||shelf.dataset.unlocked!=='true';
  $('shelf-books').style.visibility=view<.999?'hidden':'visible';
 }
 function requestLayout(){if(!layoutPending){layoutPending=true;requestAnimationFrame(layout);}}
 function paint(t){
  const i=Math.round(t*(frames.length-1));view=frames[i].t;
  image.src=(!moving&&stills[i])?stills[i].src:images[i].src;requestLayout();
 }
 async function turn(target){
  if(!frames.length||moving)return;
  const ticket=++epoch,start=view,at=performance.now();moving=true;
  $('look-shelf').hidden=true;$('look-desk').hidden=true;
  $('key-overlay').hidden=true;
  const duration=reduced.matches?0:850;
  await new Promise(resolve=>{
   const tick=now=>{
    if(ticket!==epoch){resolve();return;}
    const p=duration?Math.min(1,(now-at)/duration):1,e=p*p*(3-2*p);
    paint(start+(target-start)*e);
    if(p<1)requestAnimationFrame(tick);else resolve();
   };requestAnimationFrame(tick);
  });
  if(ticket!==epoch)return;
  moving=false;paint(target);
  document.body.dataset.view=target?'shelf':'desk';
  $('look-shelf').hidden=Boolean(target);$('look-desk').hidden=!target;
  $('scene-caption').textContent=target?'书柜中的物件共享同一相机与光照。右侧深蓝书脊是当前实际藏书入口。':'翻开桌上的六份真实课程手稿，或抬头看书柜。';
  (target?$('look-desk'):$('look-shelf')).focus({preventScroll:true});
 }
 function lift(i,to){
  const from=lifts[i],at=performance.now(),ticket=Symbol();papers[i]._liftTicket=ticket;
  const tick=now=>{
   if(papers[i]._liftTicket!==ticket)return;
   const p=reduced.matches?1:Math.min(1,(now-at)/160);
   lifts[i]=from+(to-from)*p;requestLayout();if(p<1)requestAnimationFrame(tick);
  };requestAnimationFrame(tick);
 }
 papers.forEach((paper,i)=>{
  paper.addEventListener('pointerenter',()=>lift(i,.65));paper.addEventListener('pointerleave',()=>lift(i,0));
  paper.addEventListener('focus',()=>lift(i,.65));paper.addEventListener('blur',()=>lift(i,0));
  paper.addEventListener('click',event=>{
   if(event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||moving)return;
   event.preventDefault();paper.classList.add('is-opening');
   const box=world.getBoundingClientRect();
   const scale=Math.min(innerWidth*.82/310,innerHeight*.72/210);
   const tx=(innerWidth-310*scale)/2-box.left,ty=(innerHeight-210*scale)/2-box.top;
   const animation=paper.animate([{transform:paper.style.transform},{transform:`matrix(${scale},0,0,${scale},${tx},${ty})`}],{duration:reduced.matches?0:360,easing:'cubic-bezier(.2,.8,.2,1)',fill:'forwards'});
   animation.finished.catch(()=>{}).then(()=>location.assign(paper.href));
  });
 });
 $('look-shelf').addEventListener('click',()=>turn(1));$('look-desk').addEventListener('click',()=>turn(0));
 if(portrait){
  const entry=document.createElement('button');entry.type='button';entry.id='mobile-library';entry.textContent='我的书架';
  entry.addEventListener('click',async()=>{await turn(1);if(moving)return;(shelf.dataset.unlocked==='true'?book:locked).click();});
  document.querySelector('.quiet-tools').prepend(entry);
 }
 function showModal(id,focus){$(id).hidden=false;focus?.focus({preventScroll:true});}
 function hideModal(id){$(id).hidden=true;}
 locked.addEventListener('click',()=>{if(!moving)showModal('key-overlay',$('shelf-key'));});
 $('key-close').addEventListener('click',()=>{hideModal('key-overlay');locked.focus();});
 $('catalog-toggle').addEventListener('click',()=>showModal('catalog-overlay',$('catalog-close')));
 $('catalog-close').addEventListener('click',()=>{hideModal('catalog-overlay');$('catalog-toggle').focus();});
 for(const id of ['key-overlay','catalog-overlay']){
  $(id).addEventListener('click',e=>{if(e.target===$(id))hideModal(id);});
 }
 document.addEventListener('keydown',e=>{
  const active=['key-overlay','catalog-overlay'].find(id=>!$(id).hidden);
  if(active&&e.key==='Escape'){hideModal(active);(active==='key-overlay'?locked:$('catalog-toggle')).focus();e.preventDefault();}
  if(active&&e.key==='Tab'){
   const items=[...$(active).querySelectorAll('button:not([disabled]),input:not([type=file]),a[href]')];
   const first=items[0],last=items.at(-1);
   if(e.shiftKey&&document.activeElement===first){last.focus();e.preventDefault();}
   if(!e.shiftKey&&document.activeElement===last){first.focus();e.preventDefault();}
  }
 });
 new MutationObserver(()=>{
  if(shelf.dataset.unlocked==='true')hideModal('key-overlay');
  requestLayout();
 }).observe(shelf,{attributes:true,attributeFilter:['data-unlocked']});
 $('full-view').addEventListener('click',async()=>{
  try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}
  catch(_){$('scene-caption').textContent='当前浏览器不支持全屏；仍可使用场景与课程目录。';}
 });
 $('loading-exit').addEventListener('click',()=>location.assign('../'));
 new ResizeObserver(requestLayout).observe(world);
 window.addEventListener('pageshow',()=>{papers.forEach(p=>{p.classList.remove('is-opening');p.getAnimations().forEach(a=>a.cancel());});requestLayout();});
 (async()=>{
  try{
   const responses=await Promise.all([fetch('scene-constants.json'),fetch((portrait?'room-mobile':'room')+'/frames.json')]);
   if(responses.some(r=>!r.ok))throw Error('Scene data unavailable');
   [constants,frames]=await Promise.all(responses.map(r=>r.json()));
   if(frames.length<2)throw Error('Incomplete camera views');
   images=await Promise.all(frames.map(frame=>new Promise((resolve,reject)=>{
    const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('Scene image unavailable'));img.src=frame.file;
   })));
   paint(0);document.body.dataset.view='desk';$('room-loading').hidden=true;
   frames.forEach((frame,i)=>{
    if(!frame.still)return;
    const img=new Image();img.onload=()=>{stills[i]=img;if(!moving&&Math.round(view*(frames.length-1))===i)paint(view);};img.src=frame.still.file;
   });
  }catch(error){$('room-loading').querySelector('p').textContent='书房原型暂时未能载入，请返回原主页。';}
 })();
})();
