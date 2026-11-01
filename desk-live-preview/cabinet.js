import * as THREE from './vendor/three.module.js';
import {ViewMotion} from './motion.js';

export function createCabinet({getRoom,getCamera,getView,requestView,freezeView,requestFrame,showKey,reduced}){
 const $=id=>document.getElementById(id),gate=new ViewMotion(0,8),pull=new ViewMotion(0,13),travel=new ViewMotion(0,9);
 const shelf=$('personal-library'),overlay=$('home-reader-overlay');
 let phase='closed',pendingKey=false,base=null,book=null,initialPull=0,launched=false;
 const unlocked=()=>shelf.dataset.unlocked==='true';
 const actions=document.createElement('div');actions.className='shelf-actions';actions.hidden=true;
 actions.innerHTML='<button type="button" data-read>取出《正义之心》</button><button type="button" data-door>合上柜门</button><span role="status" data-state></span>';
 document.body.append(actions);
 const cancel=document.createElement('button');cancel.className='book-return';cancel.hidden=true;cancel.textContent='← 放回书柜';document.body.append(cancel);
 const read=actions.querySelector('[data-read]'),door=actions.querySelector('[data-door]'),status=actions.querySelector('[data-state]');
 const controls=[document.querySelector('.topline'),document.querySelector('.view-control')];
 function busy(value){controls.forEach(el=>{el.inert=value;});document.body.classList.toggle('book-in-hand',value);cancel.hidden=!value;}
 function requestCabinet(){
  requestView(1);
  if(unlocked()){gate.setTarget(1);status.textContent='';}else pendingKey=true;
  requestFrame();
 }
 function open(){
  if(phase!=='closed')return;
  if(!unlocked()){requestCabinet();return;}
  phase='approaching';launched=false;status.textContent='';requestView(1);gate.setTarget(1);busy(true);cancel.focus({preventScroll:true});requestFrame();
 }
 function close(){
  if(phase==='closed'||phase==='returning')return;
  // The existing host cancels pending key transfer and clears the reader's plaintext.
  $('home-reader-close').click();overlay.classList.remove('book-shown');
  if(phase==='approaching'){phase='closed';busy(false);}else{phase='returning';travel.setTarget(0);}
  requestFrame();
 }
 read.addEventListener('click',open);cancel.addEventListener('click',close);
 door.addEventListener('click',()=>{gate.setTarget(gate.target?0:1);requestFrame();});
 new MutationObserver(()=>{
  if(unlocked()){
   pendingKey=false;gate.setTarget(1);status.textContent='';read.focus({preventScroll:true});
  }else{
   pendingKey=false;if(phase!=='closed')close();else gate.setTarget(0);
  }
  requestFrame();
 }).observe(shelf,{attributes:true,attributeFilter:['data-unlocked']});
 new MutationObserver(()=>{
  if(overlay.hidden&&(phase==='awaiting'||phase==='reading')){
   phase='returning';travel.setTarget(0);requestFrame();
  }
 }).observe(overlay,{attributes:true,attributeFilter:['hidden']});
 new MutationObserver(()=>{
  const message=$('shelf-footnote').textContent;
  if(/超时|失败|无法/.test(message))status.textContent=message;
 }).observe($('shelf-footnote'),{childList:true,subtree:true,characterData:true});
 window.addEventListener('message',event=>{
  const iframe=$('home-reader-host').querySelector('iframe');
  if(!iframe||event.source!==iframe.contentWindow||event.origin!==location.origin||overlay.hidden)return;
  if(event.data?.type==='mystudy:reader-ready')overlay.classList.add('book-shown');
  if(event.data?.type==='mystudy:reader-opened'){phase='reading';cancel.hidden=true;overlay.classList.add('book-shown');requestFrame();}
 });
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&phase!=='closed'){close();e.preventDefault();}});
 function bind(){
  const room=getRoom();if(!room||book===room.book)return;
  book=room.book;base={position:book.position.clone(),quaternion:book.quaternion.clone(),scale:book.scale.clone()};
 }
 function update(dt){
  bind();if(!book)return;
  if(pendingKey&&getView().target<.98)pendingKey=false;
  if(pendingKey&&getView().progress>.985){pendingKey=false;showKey();}
  if(phase==='closed'&&!unlocked())gate.setTarget(0);
  if(reduced.matches){gate.finish();pull.finish();travel.finish();}else{gate.step(dt);pull.step(dt);travel.step(dt);}
  const room=getRoom();room.doors.forEach(d=>{
   d.rotation.y=d.userData.side*1.78*THREE.MathUtils.smoothstep(gate.position,.15,1);
   d.userData.lock.rotation.z=Math.PI/2*THREE.MathUtils.smoothstep(gate.position,0,.15);
  });
  actions.hidden=!unlocked()||getView().progress<.75||phase!=='closed';
  door.textContent=gate.target?'合上柜门':'打开柜门';read.disabled=gate.position<.98;
  if(phase==='approaching'&&getView().progress>.985&&gate.position>.985){
   freezeView();initialPull=pull.position*2.3;pull.setTarget(0);phase='extracting';travel.setTarget(1);
  }
  if(phase==='closed'||phase==='approaching'){
   book.position.copy(base.position);book.position.z+=pull.position*2.3;
   book.quaternion.copy(base.quaternion);book.scale.copy(base.scale);room.bookCover.rotation.y=0;
  }else{
   const t=travel.position,camera=getCamera(),distance=12;
   const rotation=camera.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),-Math.PI/2));
   const h=2*distance*Math.tan(THREE.MathUtils.degToRad(camera.fov/2)),scale=new THREE.Vector3(1,h/8.6,h*camera.aspect/5.7);
   const end=camera.position.clone().add(new THREE.Vector3(0,0,-distance).applyQuaternion(camera.quaternion));
   end.sub(new THREE.Vector3(.94,4.55,0).multiply(scale).applyQuaternion(rotation));
   const turn=THREE.MathUtils.smoothstep(t,.2,1);
   book.position.copy(base.position);book.position.z+=8*THREE.MathUtils.smoothstep(t,0,.25);
   book.position.lerp(end,turn);book.position.z+=initialPull*(1-t);
   book.quaternion.copy(base.quaternion).slerp(rotation,turn);book.scale.copy(base.scale).lerp(scale,turn);
   // Swing the physical cover about its spine only after clearing the cabinet.
   room.bookCover.rotation.y=-2.55*THREE.MathUtils.smoothstep(t,.45,.9);
   if(phase==='extracting'&&!travel.active&&travel.target===1&&!launched){
    phase='awaiting';launched=true;overlay.classList.add('book-scene-reader');overlay.classList.remove('book-shown');$('open-home-book').click();
   }
   if(phase==='returning'&&!travel.active){
    phase='closed';book.position.copy(base.position);book.quaternion.copy(base.quaternion);book.scale.copy(base.scale);room.bookCover.rotation.y=0;
    initialPull=0;busy(false);actions.hidden=!unlocked()||getView().progress<.75;if(!unlocked())gate.setTarget(0);
    (unlocked()?read:$('library-toggle')).focus({preventScroll:true});
   }
  }
 }
 return {requestCabinet,open,close,update,
  hover:value=>{pull.setTarget(value&&unlocked()&&gate.position>.98&&phase==='closed'?.18:0);requestFrame();},
  get active(){return phase!=='closed';},get moving(){return gate.active||pull.active||travel.active||phase==='approaching'||pendingKey;},
  snapshot:()=>({phase,unlocked:unlocked(),door:gate.position,pull:pull.position,travel:travel.position})};
}
