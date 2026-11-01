import * as THREE from './vendor/three.module.js';
import {ViewMotion} from './motion.js';
import {buildRoom} from './room.js';
import {createPaperReader} from './paper-reader.js';
import {createCabinet} from './cabinet.js';
import {createDeskTools} from './desk-tools.js';
import {createBinders} from './binders.js';

const $=id=>document.getElementById(id);
const canvas=$('scene'),courses=window.DESK_COURSES;
const view=new ViewMotion(0,8.5),reduced=matchMedia('(prefers-reduced-motion: reduce)');
const modalOpen=()=>paperReader.active||cabinet.active||deskTools.panelOpen||(binders.active&&!binders.choosing)||binders.listOpen||['key-overlay','catalog-overlay'].some(id=>!$(id).hidden)||!$('home-reader-overlay').hidden;
let renderer,room,camera,constants,chapters=[],lastTime=null,pending=0,disposed=false,drag=null,hovered=null,aspect=1;
let frames=0,drawing=false,low=false,lastRenderMs=0,slowFrames=0,dirtyShadow=true;
const scene=new THREE.Scene(),ray=new THREE.Raycaster(),pointer=new THREE.Vector2(),samples=[];
const lifts=courses.map(()=>new ViewMotion(0,14));
const metrics={ready:false,failed:false,resting:false,contextLost:false};
const paperReader=createPaperReader({getPaper:(i,source)=>source==='folder'?binders.getPage(i):source==='drawer'?room?.drawerCards.find(c=>c.userData.kind==='course'&&c.userData.index===i):room?.papers[i],getCamera:()=>camera,courses,requestFrame,reduced,
 freezeView:()=>{view.setTarget(view.position);view.finish();drag=null;}});
const deskTools=createDeskTools({courses,getRoom:()=>room,getView:()=>({progress:view.position,target:view.target}),requestView:target,requestFrame,reduced,
 isReading:()=>paperReader.active||cabinet.active,openCourse:(i,options)=>paperReader.open(i,options),openBook:()=>cabinet.open()});
const cabinet=createCabinet({getRoom:()=>room,getCamera:()=>camera,getView:()=>({progress:view.position,target:view.target}),
 requestView:target,requestFrame,reduced,showKey:()=>showModal('key-overlay',$('shelf-key')),
 freezeView:()=>{view.setTarget(view.position);view.finish();drag=null;}});
const binders=createBinders({courses,getChapters:()=>chapters,getRoom:()=>room,getCamera:()=>camera,getView:()=>({progress:view.position,target:view.target}),requestView:target,requestFrame,reduced,getReader:()=>paperReader,
 freezeView:()=>{view.setTarget(view.position);view.finish();drag=null;}});
document.querySelectorAll('#catalog-overlay a').forEach((a,i)=>{
 const button=document.createElement('button');button.type='button';button.className='open-folder';button.textContent='展开章节';button.setAttribute('aria-label','展开'+courses[i].title+'活页夹');
 button.addEventListener('click',()=>{hideModal('catalog-overlay');if(metrics.ready)binders.open(i);else location.assign(a.href);});const row=document.createElement('div');row.className='catalog-course';a.before(row);row.append(a,button);
});

function requestFrame(){metrics.resting=false;if(!pending&&!disposed&&!metrics.contextLost)pending=requestAnimationFrame(frame);}
function pose(){
 const p=window.DeskCamera.at(view.position,aspect,constants);
 // In portrait, approach the shelf instead of leaving near papers between the
 // viewer and the cabinet. Objects remain in place and naturally leave the frustum.
 if(aspect<.85){
  const start=window.DeskCamera.at(0,aspect,constants),t=view.position;
  const pitch=Math.atan2(32,11)*t;
  p.eye=[11.0*t,start.eye[1]+(17-start.eye[1])*t,start.eye[2]+(p.shzf+31-start.eye[2])*t];
  p.ww=[0,-Math.cos(pitch),-Math.sin(pitch)];p.vv=[0,Math.sin(pitch),-Math.cos(pitch)];
 }
 p.eye[0]-=(aspect<.85?20:8)*binders.cameraFocus*view.position;
 camera.fov=THREE.MathUtils.radToDeg(2*Math.atan(p.fovy*.5));camera.aspect=aspect;
 camera.position.set(...p.eye);camera.up.set(...p.vv);
 const drawerOffset=deskTools.drawerPosition*(1-view.position);
 if(aspect<1){camera.position.y+=(38-p.eye[1])*drawerOffset;const center=room.drawer.userData.baseZ+room.drawer.userData.travel-room.drawer.userData.depth/2-.2;camera.position.z+=(center-p.eye[2])*drawerOffset;}
 else{camera.position.y+=7.5*drawerOffset;camera.position.z+=5.8*drawerOffset;}
 camera.lookAt(camera.position.x+p.ww[0],camera.position.y+p.ww[1],camera.position.z+p.ww[2]);camera.updateProjectionMatrix();camera.updateMatrixWorld();
}
function frame(now){
 pending=0;if(!renderer||!room||disposed||metrics.contextLost)return;
 const dt=lastTime===null?1/60:Math.min(.05,Math.max(.001,(now-lastTime)/1000));lastTime=now;
 if(reduced.matches){view.finish();lifts.forEach(x=>x.finish());}else{view.step(dt);lifts.forEach(x=>x.step(dt));}
 room.papers.forEach((object,i)=>{if(paperReader.owns(object))return;const y=.1+lifts[i].position*.65;if(Math.abs(object.position.y-y)>.00001)dirtyShadow=true;object.position.y=y;});
 deskTools.update(dt);if(deskTools.moving)dirtyShadow=true;
 binders.step(dt);
 pose();
 binders.update();if(binders.moving)dirtyShadow=true;
 paperReader.update(dt);if(paperReader.moving)dirtyShadow=true;
 cabinet.update(dt);if(cabinet.moving)dirtyShadow=true;
 deskTools.refreshUI();
 binders.refreshUI();
 if(dirtyShadow){renderer.shadowMap.needsUpdate=true;dirtyShadow=false;}
 const start=performance.now();renderer.render(scene,camera);lastRenderMs=performance.now()-start;
 // Adapt render resolution/shadow cost, never quantize camera progress or drop objects.
 if(lastRenderMs>28)slowFrames++;else slowFrames=Math.max(0,slowFrames-1);
 if(slowFrames>=10&&!low){low=true;room.lamp.shadow.mapSize.set(512,512);room.lamp.shadow.map?.dispose();room.lamp.shadow.map=null;dirtyShadow=true;}
 frames++;if(samples.length>=600)samples.shift();samples.push({at:now,position:view.position,velocity:view.velocity});
 metrics.resting=!view.active&&!lifts.some(x=>x.active)&&!drag&&!paperReader.moving&&!cabinet.moving&&!deskTools.moving&&!binders.moving;
 // Reduce only motion cost on slow devices, then redraw sharp text once settled.
 const desiredRatio=low&&!metrics.resting?1:Math.min(devicePixelRatio,2);
 if(renderer.getPixelRatio()!==desiredRatio){renderer.setPixelRatio(desiredRatio);renderer.setSize(innerWidth,innerHeight,false);requestFrame();}
 document.body.dataset.view=view.position<.0001?'desk':view.position>.9999?'shelf':'moving';
 $('view-position').value=view.position;
 if(!metrics.resting||dirtyShadow)requestFrame();else lastTime=null;
}
function target(value){
 view.setTarget(value);$('view-desk').setAttribute('aria-pressed',String(view.target===0));$('view-shelf').setAttribute('aria-pressed',String(view.target===1));
 $('view-position').value=view.target;metrics.resting=false;requestFrame();
}
function resize(){
 if(!renderer||!constants)return;
 aspect=innerWidth/innerHeight;
 const old=room;
 room=buildRoom(constants,aspect,courses,()=>{dirtyShadow=true;requestFrame();},chapters);
 if(old){scene.remove(old.root);const geos=new Set(),mats=new Set(),textures=new Set();old.root.traverse(o=>{if(o.geometry)geos.add(o.geometry);if(o.material)mats.add(o.material);});geos.forEach(g=>g.dispose());mats.forEach(m=>{Object.values(m).forEach(value=>{if(value?.isTexture)textures.add(value);});m.dispose();});textures.forEach(t=>t.dispose());old.lamp.shadow.map?.dispose();}
 scene.add(room.root);
 renderer.setSize(innerWidth,innerHeight,false);camera.aspect=aspect;dirtyShadow=true;requestFrame();
}
function visiblyRendered(object){for(let o=object;o;o=o.parent)if(!o.visible)return false;return true;}
function hit(event){
 if(!room||!camera||modalOpen())return null;
 const r=canvas.getBoundingClientRect();pointer.set((event.clientX-r.left)/r.width*2-1,-(event.clientY-r.top)/r.height*2+1);
 ray.setFromCamera(pointer,camera);
 // Intersect all room geometry, not just clickable targets: a shelf can occlude a paper.
 const intersections=ray.intersectObject(room.root,true).filter(i=>visiblyRendered(i.object));
 for(const intersection of intersections){
  let o=intersection.object;
  while(o&&o!==room.root){if(o.userData.action)return o;o=o.parent;}
  return null;
 }
 return null;
}
function hover(object){
 if(hovered===object)return;
 hovered=object;lifts.forEach((lift,i)=>lift.setTarget(object===room.papers[i]?1:0));
 cabinet.hover(object===room.book);
 binders.hover(object);
 canvas.style.cursor=['brightness','warmth','drawer'].includes(object?.userData.action)?'ns-resize':object?'pointer':'grab';requestFrame();
}
function action(object){
 if(!object)return;
 if(binders.active){if(object.userData.action==='chapter')binders.choose(object.userData.chapter);return;}
 if(object.userData.action==='binder')binders.open(object.userData.index);
 if(object.userData.action==='course')paperReader.open(object.userData.index);
 if(object.userData.action==='library')cabinet.open();
 if(object.userData.action==='cabinet')cabinet.requestCabinet();
 if(object.userData.action==='lighting')deskTools.openPanel();
 if(['lamp-power','brightness','warmth','sound','light-reset'].includes(object.userData.action))deskTools.lights(object.userData.action);
 if(object.userData.action==='drawer')deskTools.toggleDrawer();
 if(object.userData.action==='resume')deskTools.resume(object);
}
canvas.addEventListener('pointerdown',e=>{
 if(e.button!==0||modalOpen()||!metrics.ready)return;
 canvas.setPointerCapture(e.pointerId);drag={id:e.pointerId,x:e.clientX,y:e.clientY,progress:view.position,moved:false};
 const control=hit(e)?.userData.action;
 if(['brightness','warmth','drawer'].includes(control)){
  drag.control=control;const s=deskTools.snapshot();drag.value=control==='drawer'?s.drawer:control==='brightness'?s.brightness:s.warmth;
 }
});
canvas.addEventListener('pointermove',e=>{
 if(drag&&drag.id===e.pointerId){
  if(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>5)drag.moved=true;
  if(drag.moved){
   if(drag.control==='drawer')deskTools.dragDrawer(drag.value+(e.clientY-drag.y)/160);
   else if(drag.control)deskTools.adjust(drag.control,drag.value+(drag.y-e.clientY)/120);
   else if(!binders.active)target(drag.progress+(drag.y-e.clientY)/innerHeight*1.75);
   hover(null);canvas.style.cursor='grabbing';
  }
 }else if(metrics.ready)hover(hit(e));
});
canvas.addEventListener('pointerup',e=>{
 if(!drag||drag.id!==e.pointerId)return;
 const moved=drag.moved,control=drag.control;drag=null;canvas.releasePointerCapture(e.pointerId);
 if(moved&&control==='drawer')deskTools.finishDrawerDrag();
 if(!moved)action(hit(e));requestFrame();
});
canvas.addEventListener('pointercancel',()=>{if(drag?.control==='drawer')deskTools.finishDrawerDrag();drag=null;hover(null);requestFrame();});
canvas.addEventListener('pointerleave',()=>{if(!drag)hover(null);});
canvas.addEventListener('wheel',e=>{
 if(e.ctrlKey||modalOpen()||!metrics.ready)return;e.preventDefault();
 const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?innerHeight:1);
 target(view.target+Math.max(-.25,Math.min(.25,delta*.0014)));
},{passive:false});
$('view-desk').addEventListener('click',()=>target(0));$('view-shelf').addEventListener('click',()=>target(1));
$('view-position').addEventListener('input',e=>target(Number(e.target.value)));
// The accessible course list opens the same physical sheet; unsupported WebGL keeps normal links.
$('catalog-overlay').addEventListener('click',e=>{
 const a=e.target.closest('a[href]');if(!a||!metrics.ready||e.ctrlKey||e.metaKey||e.shiftKey)return;
 const i=courses.findIndex(c=>new URL(c.href,location.href).href===a.href);if(i<0)return;
 e.preventDefault();hideModal('catalog-overlay');paperReader.open(i);
});

function showModal(id,focus){$(id).hidden=false;focus?.focus({preventScroll:true});}
function hideModal(id,returnTo){$(id).hidden=true;returnTo?.focus({preventScroll:true});}
$('catalog-toggle').addEventListener('click',()=>showModal('catalog-overlay',$('catalog-close')));
$('catalog-close').addEventListener('click',()=>hideModal('catalog-overlay',$('catalog-toggle')));
$('key-close').addEventListener('click',()=>hideModal('key-overlay',$('library-toggle')));
$('library-toggle').addEventListener('click',()=>cabinet.requestCabinet());
for(const id of ['catalog-overlay','key-overlay'])$(id).addEventListener('click',e=>{if(e.target===$(id))hideModal(id,$('catalog-toggle'));});
document.addEventListener('keydown',e=>{
 const id=['key-overlay','catalog-overlay'].find(id=>!$(id).hidden);
 if(id&&e.key==='Escape'){hideModal(id,$('catalog-toggle'));e.preventDefault();return;}
 if(id&&e.key==='Tab'){
  const items=[...$(id).querySelectorAll('button:not([disabled]),input:not([type=file]),a[href]')];const first=items[0],last=items.at(-1);
  if(e.shiftKey&&document.activeElement===first){last.focus();e.preventDefault();}
  else if(!e.shiftKey&&document.activeElement===last){first.focus();e.preventDefault();}return;
 }
 if(modalOpen()||e.target.matches('input,textarea,select'))return;
 if(e.key==='ArrowUp'){e.preventDefault();target(Math.min(1,view.target+.2));}
 if(e.key==='ArrowDown'){e.preventDefault();target(Math.max(0,view.target-.2));}
});
new MutationObserver(()=>{if($('personal-library').dataset.unlocked==='true')hideModal('key-overlay');}).observe($('personal-library'),{attributes:true,attributeFilter:['data-unlocked']});
window.addEventListener('resize',resize);
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(pending)cancelAnimationFrame(pending);pending=0;lastTime=null;}else requestFrame();});
canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();metrics.contextLost=true;$('context-warning').hidden=false;});
canvas.addEventListener('webglcontextrestored',()=>{metrics.contextLost=false;$('context-warning').hidden=true;dirtyShadow=true;requestFrame();});

// Read-only diagnostics for motion/idle validation, no key or book contents exposed.
Object.defineProperty(window,'deskLiveDiagnostics',{value:{hitAt:(x,y)=>{const object=hit({clientX:x,clientY:y});return object?{name:object.name,action:object.userData.action}:null;},drawerReadability:()=>room.drawerCards.filter(c=>c.visible).map(card=>{
 const sheet=card.getObjectByName('paper face'),{width,height}=sheet.geometry.parameters;let clear=0;const blockers=[];
 for(const u of [-.85,0,.85])for(const v of [-.85,0,.85]){const point=sheet.localToWorld(new THREE.Vector3(u*width/2,v*height/2,0)),q=point.clone().project(camera);ray.set(camera.position,point.clone().sub(camera.position).normalize());const hit=ray.intersectObject(room.root,true).find(i=>visiblyRendered(i.object))?.object;if((hit===sheet||hit?.parent===card)&&Math.abs(q.x)<=1&&Math.abs(q.y)<=1)clear++;else blockers.push({u,v,name:hit?.name,parent:hit?.parent?.name,x:q.x,y:q.y});}
 return {index:card.userData.index,kind:card.userData.kind,clear,total:9,blockers};
}),paperReadability:()=>room.papers.map(paper=>{
 const sheet=paper.getObjectByName('paper face'),{width,height}=sheet.geometry.parameters;
 let clear=0,total=0;const blockers=new Set();
 for(const u of [-.9,-.5,0,.5,.9])for(const v of [-.9,-.5,0,.5,.9]){
  const point=sheet.localToWorld(new THREE.Vector3(u*width/2,v*height/2,0));
  const projected=point.clone().project(camera);total++;
  ray.set(camera.position,point.clone().sub(camera.position).normalize());
  const first=ray.intersectObject(room.root,true).find(i=>visiblyRendered(i.object))?.object;
  if((first===sheet||first?.parent===paper)&&Math.abs(projected.x)<=1&&Math.abs(projected.y)<=1)clear++;
  else blockers.add(first?.name||'outside');
 }
 return {index:paper.userData.index,clear,total,blockers:[...blockers],textureWidth:sheet.material.map.image.width};
}),snapshot:()=>({
 ...metrics,aspect,progress:view.position,target:view.target,velocity:view.velocity,renderedFrames:frames,drag:drag?{control:drag.control,moved:drag.moved,y:drag.y,value:drag.value}:null,paperReader:paperReader.snapshot(),cabinet:cabinet.snapshot(),deskTools:deskTools.snapshot(),binders:binders.snapshot(),
 chapterCenters:room?.chapterSheets.flat().filter(p=>p.visible).map(p=>{const q=p.getWorldPosition(new THREE.Vector3()).project(camera);return {course:p.userData.index,chapter:p.userData.chapter,x:(q.x+1)*innerWidth/2,y:(1-q.y)*innerHeight/2};}),
 binderCenters:room?.binders.map(p=>{const q=p.localToWorld(new THREE.Vector3(0,4.7,3.4)).project(camera);return {x:(q.x+1)*innerWidth/2,y:(1-q.y)*innerHeight/2};}),
 drawerCards:room?.drawerCards.filter(c=>c.visible).map(c=>{const q=c.getWorldPosition(new THREE.Vector3()).project(camera);return {kind:c.userData.kind,index:c.userData.index,x:(q.x+1)*innerWidth/2,y:(1-q.y)*innerHeight/2};}),
 lightPower:room?.lamp.intensity,controlCenters:room?[...room.knobs,room.lampFixture,room.drawer].map(o=>{const point=o===room.drawer?new THREE.Vector3(0,-2.3,.9):o===room.lampFixture?new THREE.Vector3(0,.15,0):new THREE.Vector3(0,.2,0);const q=o.localToWorld(point).project(camera);return {action:o.userData.action,x:(q.x+1)*innerWidth/2,y:(1-q.y)*innerHeight/2};}):[],
 bookCenter:room?.book?(()=>{const q=room.book.localToWorld(new THREE.Vector3(0,4.55,3.3)).project(camera);return {x:(q.x+1)*innerWidth/2,y:(1-q.y)*innerHeight/2};})():null,
 meshCount:room?.meshCount||0,rendererObjects:renderer?.info.render.calls||0,triangles:renderer?.info.render.triangles||0,
 pixelRatio:renderer?.getPixelRatio()||0,lastRenderMs,quality:low?'light':'normal',samples:samples.map(s=>({...s})),
 paperPositions:room?.papers.map(p=>p.position.toArray()),paperVisible:room?.papers.map(p=>p.visible),
 paperCenters:room?.papers.map(p=>{const q=p.position.clone().project(camera);return {x:(q.x+1)*innerWidth/2,y:(1-q.y)*innerHeight/2};}),
 eye:camera?.position.toArray(),cameraMatrix:camera?.matrixWorld.elements.slice(),
 })}});

(async()=>{
 try{
  const response=await fetch('scene-constants.json');if(!response.ok)throw Error('Missing scene constants');constants=await response.json();
  try{const res=await fetch('chapters.json');const data=res.ok?await res.json():null;if(!Array.isArray(data)||data.length!==6||data.some(rows=>!Array.isArray(rows)||!rows.length))throw Error('Missing chapters');chapters=data;}catch{chapters=courses.map(c=>[{title:'打开课程目录',href:c.href,directoryOnly:true}]);}
  renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance',alpha:false});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0x262019,1);
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.10;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;
  camera=new THREE.PerspectiveCamera(35,innerWidth/innerHeight,.1,240);
  resize();metrics.ready=true;clearTimeout(window.deskLiveBootTimer);$('loading').hidden=true;$('fallback').hidden=true;requestFrame();
 }catch(error){
  metrics.failed=true;$('loading').hidden=true;$('fallback').hidden=false;
  $('view-desk').disabled=true;$('view-shelf').disabled=true;$('view-position').disabled=true;
  // Unsupported WebGL falls back honestly to navigation, never a fake cut-frame animation.
 }
})();
