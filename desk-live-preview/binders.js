import * as THREE from './vendor/three.module.js';
import {ViewMotion} from './motion.js';

export function createBinders({courses,getChapters,getRoom,getCamera,getView,requestView,requestFrame,freezeView,reduced,getReader}){
 const motion=new ViewMotion(0,8.5),focus=new ViewMotion(0,8.5),hover=new ViewMotion(0,13);
 let index=-1,selectedChapter=0,phase='closed',page=0,base=null,binder=null,pendingClose=false,hovered=-1;
 const controls=[document.querySelector('.topline'),document.querySelector('.view-control')];
 const bar=document.createElement('nav');bar.className='folder-toolbar';bar.hidden=true;bar.setAttribute('aria-label','课程活页夹');
 bar.innerHTML='<button type="button" data-return>← 归回书架</button><span data-course></span><button type="button" data-directory>课程总览</button><button type="button" data-list>章节列表</button>';
 const pages=document.createElement('div');pages.className='folder-pagination';pages.hidden=true;
 pages.innerHTML='<button type="button" data-prev aria-label="上一组章节">‹</button><span data-page></span><button type="button" data-next aria-label="下一组章节">›</button>';
 const chooser=document.createElement('div');chooser.className='folder-list panel';chooser.hidden=true;chooser.setAttribute('aria-label','选择章节');
 document.body.append(bar,pages,chooser);
 const capacity=()=>innerWidth<innerHeight||innerHeight<500?3:6,rows=()=>getChapters()[index]||[];
 const listButton=bar.querySelector('[data-list]');
 function busy(value){controls.forEach(el=>el.inert=value);document.body.classList.toggle('folder-open',value);}
 function open(i){
  if(phase!=='closed'||!getRoom()?.binders[i])return;
  index=i;page=0;selectedChapter=0;phase='approaching';pendingClose=false;focus.setTarget(1);requestView(1);busy(true);
  bar.querySelector('[data-course]').textContent=courses[i].title;bar.hidden=false;bar.querySelector('[data-return]').focus({preventScroll:true});requestFrame();
 }
 function close(){
  if(phase==='closed'||phase==='closing')return;
  if(getReader().active){pendingClose=true;getReader().close();return;}
  pendingClose=false;phase='closing';chooser.hidden=true;motion.setTarget(0);focus.setTarget(0);requestView(1);requestFrame();
 }
 function choose(j){
  if(phase!=='choosing'||!rows()[j])return;
  selectedChapter=j;page=Math.floor(j/capacity());chooser.hidden=true;update();phase='reading';
  getReader().open(index,{source:'folder',resume:{href:new URL(rows()[j].href,location.href).href,scroll:0}});requestFrame();
 }
 function renderList(){
  chooser.replaceChildren();
  rows().forEach((entry,j)=>{const button=document.createElement('button');button.type='button';button.textContent=entry.title;button.addEventListener('click',()=>choose(j));chooser.append(button);});
 }
 bar.querySelector('[data-return]').addEventListener('click',close);
 bar.querySelector('[data-directory]').addEventListener('click',()=>{
  if(phase!=='choosing')return;selectedChapter=page*capacity();phase='reading';
  getReader().open(index,{source:'folder',resume:{href:new URL(courses[index].href,location.href).href,scroll:0}});requestFrame();
 });
 listButton.addEventListener('click',()=>{if(phase!=='choosing')return;renderList();chooser.hidden=!chooser.hidden;if(!chooser.hidden)chooser.querySelector('button')?.focus();});
 for(const [selector,direction] of [['[data-prev]',-1],['[data-next]',1]])pages.querySelector(selector).addEventListener('click',()=>{page=THREE.MathUtils.clamp(page+direction,0,Math.ceil(rows().length/capacity())-1);hovered=-1;hover.setTarget(0);requestFrame();});
 document.addEventListener('keydown',e=>{
  if(phase==='closed'||getReader().active)return;
  if(e.key==='Escape'){e.preventDefault();if(!chooser.hidden){chooser.hidden=true;listButton.focus();}else close();}
 });
 function step(dt){
  if(reduced.matches){motion.finish();focus.finish();hover.finish();}else{motion.step(dt);focus.step(dt);hover.step(dt);}
  if(phase==='approaching'&&getView().progress===1&&focus.position===1){phase='opening';motion.setTarget(1);requestView(0);}
 }
 function update(){
  const room=getRoom();if(!room)return;
  if(index<0)return;
  if(binder!==room.binders[index]){binder=room.binders[index];base={position:binder.position.clone(),rotation:binder.quaternion.clone(),scale:binder.scale.clone()};}
  const t=motion.position,camera=getCamera(),distance=18;
  if(phase!=='closed'){
   const endRotation=camera.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),-Math.PI/2));
   const height=2*distance*Math.tan(THREE.MathUtils.degToRad(camera.fov/2));
   const scale=Math.min(height*Math.min(.7,Math.max(.4,1-160/innerHeight))/9.4,height*camera.aspect*.9/12.8);
   const end=camera.position.clone().add(new THREE.Vector3(0,0,-distance).applyQuaternion(camera.quaternion));
   end.sub(new THREE.Vector3(1.2,4.7,3.15).multiplyScalar(scale).applyQuaternion(endRotation));
   const slide=base.position.clone();slide.z+=8*THREE.MathUtils.smoothstep(t,0,.25);
   binder.position.copy(slide).lerp(end,THREE.MathUtils.smoothstep(t,.18,1));binder.quaternion.copy(base.rotation).slerp(endRotation,THREE.MathUtils.smoothstep(t,.18,1));binder.scale.copy(base.scale).lerp(new THREE.Vector3(scale,scale,scale),THREE.MathUtils.smoothstep(t,.18,1));
   binder.userData.cover.rotation.y=-Math.PI*THREE.MathUtils.smoothstep(t,.4,.95);
   if(phase==='opening'&&!motion.active&&getView().progress===0){phase='choosing';freezeView();listButton.focus({preventScroll:true});}
   if(phase==='closing'&&!motion.active){binder.position.copy(base.position);binder.quaternion.copy(base.rotation);binder.scale.copy(base.scale);binder.userData.cover.rotation.y=0;phase='closed';busy(false);document.querySelector('#catalog-toggle').focus({preventScroll:true});}
  }
  const maxPage=Math.max(0,Math.ceil(rows().length/capacity())-1);page=Math.min(page,maxPage);
  room.chapterSheets.forEach((sheets,i)=>sheets.forEach((leaf,j)=>{
   const parent=room.binders[i];if(getReader().owns(leaf)&&leaf.parent!==parent)return;
   const visible=i===index&&phase!=='closed'&&j>=page*capacity()&&j<(page+1)*capacity();
   leaf.visible=visible;
   if(!visible)return;
   const slot=j%capacity(),portrait=capacity()===3,w=portrait?11:5.4,h=2.4;
   leaf.position.set(-.1+1.35*THREE.MathUtils.smoothstep(t,.45,.95)+(hovered===j?.1*hover.position:0),7.8-Math.floor(slot/(portrait?1:2))*3.1,portrait?3.15:slot%2===0?6.25:.05);
   leaf.getObjectByName('paper face').scale.set(w,h,1);
  }));
  refreshUI();
 }
 function refreshUI(){
  if(phase==='reading'&&!getReader().active){if(pendingClose)close();else{phase='choosing';listButton.focus({preventScroll:true});}}
  const showing=phase!=='closed'&&phase!=='reading';bar.hidden=!showing;pages.hidden=phase!=='choosing'||rows().length<=capacity();listButton.setAttribute('aria-expanded',String(!chooser.hidden));
  if(phase!=='closed')busy(true);
  if(index>=0){const total=Math.max(1,Math.ceil(rows().length/capacity()));pages.querySelector('[data-page]').textContent=`${page+1} / ${total}`;pages.querySelector('[data-prev]').disabled=page===0;pages.querySelector('[data-next]').disabled=page+1>=total;}
 }
 return {open,close,choose,step,update,refreshUI,
  hover:object=>{const j=object?.userData.action==='chapter'?object.userData.chapter:-1;if(j!==hovered){hovered=j;hover.setTarget(j<0?0:1);requestFrame();}},
  getPage:i=>i===index?getRoom()?.chapterSheets[index]?.[selectedChapter]:null,
  get active(){return phase!=='closed';},get choosing(){return phase==='choosing';},get listOpen(){return !chooser.hidden;},get cameraFocus(){return focus.position;},
  get moving(){return motion.active||focus.active||hover.active||phase==='approaching'||phase==='opening';},
  snapshot:()=>({phase,index,page,progress:motion.position,focus:focus.position,count:index<0?0:rows().length})};
}
