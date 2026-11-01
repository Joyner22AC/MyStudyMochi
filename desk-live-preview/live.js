import * as THREE from './vendor/three.module.js';
import {ViewMotion} from './motion.js';
import {buildRoom} from './room.js';

const $=id=>document.getElementById(id);
const canvas=$('scene'),courses=window.DESK_COURSES;
const view=new ViewMotion(0,8.5),reduced=matchMedia('(prefers-reduced-motion: reduce)');
const modalOpen=()=>['key-overlay','catalog-overlay'].some(id=>!$(id).hidden)||!$('home-reader-overlay').hidden;
let renderer,room,camera,constants,lastTime=null,pending=0,disposed=false,drag=null,hovered=null,aspect=1;
let frames=0,drawing=false,low=false,lastRenderMs=0,slowFrames=0,dirtyShadow=true;
const scene=new THREE.Scene(),ray=new THREE.Raycaster(),pointer=new THREE.Vector2(),samples=[];
const lifts=courses.map(()=>new ViewMotion(0,14));
const metrics={ready:false,failed:false,resting:false,contextLost:false};

function requestFrame(){if(!pending&&!disposed&&!metrics.contextLost)pending=requestAnimationFrame(frame);}
function pose(){
 const p=window.DeskCamera.at(view.position,aspect,constants);
 // In portrait, approach the shelf instead of leaving near papers between the
 // viewer and the cabinet. Objects remain in place and naturally leave the frustum.
 if(aspect<.85){
  const start=window.DeskCamera.at(0,aspect,constants),t=view.position;
  const pitch=Math.atan2(32,11)*t;
  p.eye=[5.0*t,start.eye[1]+(17-start.eye[1])*t,start.eye[2]+(p.shzf+31-start.eye[2])*t];
  p.ww=[0,-Math.cos(pitch),-Math.sin(pitch)];p.vv=[0,Math.sin(pitch),-Math.cos(pitch)];
 }
 camera.fov=THREE.MathUtils.radToDeg(2*Math.atan(p.fovy*.5));camera.aspect=aspect;
 camera.position.set(...p.eye);camera.up.set(...p.vv);
 camera.lookAt(p.eye[0]+p.ww[0],p.eye[1]+p.ww[1],p.eye[2]+p.ww[2]);camera.updateProjectionMatrix();camera.updateMatrixWorld();
}
function frame(now){
 pending=0;if(!renderer||!room||disposed||metrics.contextLost)return;
 const dt=lastTime===null?1/60:Math.min(.05,Math.max(.001,(now-lastTime)/1000));lastTime=now;
 if(reduced.matches){view.finish();lifts.forEach(x=>x.finish());}else{view.step(dt);lifts.forEach(x=>x.step(dt));}
 room.papers.forEach((object,i)=>{const y=.1+lifts[i].position*.65;if(Math.abs(object.position.y-y)>.00001)dirtyShadow=true;object.position.y=y;});
 pose();
 if(dirtyShadow){renderer.shadowMap.needsUpdate=true;dirtyShadow=false;}
 const start=performance.now();renderer.render(scene,camera);lastRenderMs=performance.now()-start;
 // Adapt render resolution/shadow cost, never quantize camera progress or drop objects.
 if(lastRenderMs>28)slowFrames++;else slowFrames=Math.max(0,slowFrames-1);
 if(slowFrames>=10&&!low){low=true;renderer.setPixelRatio(.85);renderer.setSize(innerWidth,innerHeight,false);room.lamp.shadow.mapSize.set(512,512);room.lamp.shadow.map?.dispose();room.lamp.shadow.map=null;dirtyShadow=true;}
 frames++;if(samples.length>=600)samples.shift();samples.push({at:now,position:view.position,velocity:view.velocity});
 metrics.resting=!view.active&&!lifts.some(x=>x.active)&&!drag;
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
 room=buildRoom(constants,aspect,courses,()=>{dirtyShadow=true;requestFrame();});
 if(old){scene.remove(old.root);const geos=new Set(),mats=new Set();old.root.traverse(o=>{if(o.geometry)geos.add(o.geometry);if(o.material)mats.add(o.material);});geos.forEach(g=>g.dispose());mats.forEach(m=>{m.map?.dispose();m.dispose();});old.lamp.shadow.map?.dispose();}
 scene.add(room.root);
 renderer.setSize(innerWidth,innerHeight,false);camera.aspect=aspect;dirtyShadow=true;requestFrame();
}
function hit(event){
 if(!room||!camera||modalOpen())return null;
 const r=canvas.getBoundingClientRect();pointer.set((event.clientX-r.left)/r.width*2-1,-(event.clientY-r.top)/r.height*2+1);
 ray.setFromCamera(pointer,camera);
 // Intersect all room geometry, not just clickable targets: a shelf can occlude a paper.
 const intersections=ray.intersectObject(room.root,true);
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
 canvas.style.cursor=object?'pointer':'grab';requestFrame();
}
function action(object){
 if(!object)return;
 if(object.userData.action==='course')location.assign(courses[object.userData.index].href);
 if(object.userData.action==='library'){
  if($('personal-library').dataset.unlocked==='true')$('open-home-book').click();
  else showModal('key-overlay',$('shelf-key'));
 }
}
canvas.addEventListener('pointerdown',e=>{
 if(e.button!==0||modalOpen()||!metrics.ready)return;
 canvas.setPointerCapture(e.pointerId);drag={id:e.pointerId,x:e.clientX,y:e.clientY,progress:view.position,moved:false};
});
canvas.addEventListener('pointermove',e=>{
 if(drag&&drag.id===e.pointerId){
  if(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>5)drag.moved=true;
  if(drag.moved){target(drag.progress+(drag.y-e.clientY)/innerHeight*1.75);hover(null);canvas.style.cursor='grabbing';}
 }else if(metrics.ready)hover(hit(e));
});
canvas.addEventListener('pointerup',e=>{
 if(!drag||drag.id!==e.pointerId)return;
 const moved=drag.moved;drag=null;canvas.releasePointerCapture(e.pointerId);
 if(!moved)action(hit(e));requestFrame();
});
canvas.addEventListener('pointercancel',()=>{drag=null;hover(null);requestFrame();});
canvas.addEventListener('pointerleave',()=>{if(!drag)hover(null);});
canvas.addEventListener('wheel',e=>{
 if(e.ctrlKey||modalOpen()||!metrics.ready)return;e.preventDefault();
 const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?innerHeight:1);
 target(view.target+Math.max(-.25,Math.min(.25,delta*.0014)));
},{passive:false});
$('view-desk').addEventListener('click',()=>target(0));$('view-shelf').addEventListener('click',()=>target(1));
$('view-position').addEventListener('input',e=>target(Number(e.target.value)));

function showModal(id,focus){$(id).hidden=false;focus?.focus({preventScroll:true});}
function hideModal(id,returnTo){$(id).hidden=true;returnTo?.focus({preventScroll:true});}
$('catalog-toggle').addEventListener('click',()=>showModal('catalog-overlay',$('catalog-close')));
$('catalog-close').addEventListener('click',()=>hideModal('catalog-overlay',$('catalog-toggle')));
$('key-close').addEventListener('click',()=>hideModal('key-overlay',$('library-toggle')));
$('library-toggle').addEventListener('click',()=>{target(1);action({userData:{action:'library'}});});
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
Object.defineProperty(window,'deskLiveDiagnostics',{value:{snapshot:()=>({
 ...metrics,progress:view.position,target:view.target,velocity:view.velocity,renderedFrames:frames,
 meshCount:room?.meshCount||0,rendererObjects:renderer?.info.render.calls||0,triangles:renderer?.info.render.triangles||0,
 pixelRatio:renderer?.getPixelRatio()||0,lastRenderMs,quality:low?'light':'normal',samples:samples.map(s=>({...s})),
 paperPositions:room?.papers.map(p=>p.position.toArray()),paperVisible:room?.papers.map(p=>p.visible),
 paperCenters:room?.papers.map(p=>{const q=p.position.clone().project(camera);return {x:(q.x+1)*innerWidth/2,y:(1-q.y)*innerHeight/2};}),
 eye:camera?.position.toArray(),cameraMatrix:camera?.matrixWorld.elements.slice(),
 })}});

(async()=>{
 try{
  const response=await fetch('scene-constants.json');if(!response.ok)throw Error('Missing scene constants');constants=await response.json();
  renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance',alpha:false});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.35));renderer.setClearColor(0x262019,1);
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
