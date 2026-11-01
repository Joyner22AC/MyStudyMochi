import * as THREE from './vendor/three.module.js';
import {ViewMotion} from './motion.js';
import {createRecent} from './recent.js';

export function createDeskTools({courses,getRoom,getView,requestView,requestFrame,reduced,isReading,openCourse,openBook}){
 const recent=createRecent(courses),drawer=new ViewMotion(0,9),level=new ViewMotion(.72,10),warmth=new ViewMotion(.65,10);
 let on=true,sound=false,audio=null,pendingDrawer=false,cardVersion='',roomRef=null,previousMoving=false;
 try{const v=JSON.parse(localStorage.getItem('mystudy:desk:light:v1')||'null');if(v?.version===1){on=v.on!==false;sound=v.sound===true;level.position=level.target=Number.isFinite(v.level)?THREE.MathUtils.clamp(v.level,.2,1):.72;warmth.position=warmth.target=Number.isFinite(v.warmth)?THREE.MathUtils.clamp(v.warmth,0,1):.65;}}catch{}
 const trigger=document.createElement('button');trigger.id='room-tools-toggle';trigger.textContent='房间';trigger.type='button';trigger.setAttribute('aria-label','房间：灯光与继续学习');document.querySelector('.tools').append(trigger);
 const modal=document.createElement('div');modal.id='room-tools';modal.className='modal-backdrop';modal.hidden=true;
 modal.innerHTML='<section class="panel" role="dialog" aria-modal="true" aria-labelledby="room-tools-title"><button type="button" class="close" data-close aria-label="关闭房间设置">×</button><h2 id="room-tools-title">书桌的灯与抽屉</h2><label class="tool-switch"><span>台灯</span><input type="checkbox" data-power></label><label class="tool-range">灯光明暗<input aria-label="灯光明暗" type="range" min="0.2" max="1" step="0.01" data-level></label><label class="tool-range">冷暖 · 从晨光到暖灯<input aria-label="灯光冷暖" type="range" min="0" max="1" step="0.01" data-warmth></label><label class="tool-switch"><span>轻微物件音效</span><input type="checkbox" data-sound></label><div class="tool-actions"><button type="button" data-reset>恢复灯光</button><button type="button" data-drawer>拉开抽屉 · 继续学习</button></div><p>最近阅读只保存在本机，记录课程、位置与书目，不保存密钥或解密正文。</p><div data-recent></div><button type="button" data-clear>清除最近阅读</button><p data-storage role="status"></p></section>';
 document.body.append(modal);
 const empty=document.createElement('div');empty.className='drawer-caption';empty.hidden=true;empty.innerHTML='<span>抽屉里还没有阅读卡片。读过笔记后，它会留在这里。</span><button type="button" aria-label="合上抽屉">合上抽屉</button>';document.body.append(empty);
 const close=()=>{modal.hidden=true;trigger.focus({preventScroll:true});};
 function persist(){try{localStorage.setItem('mystudy:desk:light:v1',JSON.stringify({version:1,on,level:level.target,warmth:warmth.target,sound}));}catch{}sync();}
 function sync(){modal.querySelector('[data-power]').checked=on;modal.querySelector('[data-level]').value=level.target;modal.querySelector('[data-warmth]').value=warmth.target;modal.querySelector('[data-sound]').checked=sound;}
 function tick(frequency=300){if(!sound)return;
  try{const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;audio||=new Audio();audio.resume().catch(()=>{});const osc=audio.createOscillator(),gain=audio.createGain();osc.type='triangle';osc.frequency.setValueAtTime(frequency,audio.currentTime);gain.gain.setValueAtTime(.0001,audio.currentTime);gain.gain.exponentialRampToValueAtTime(.016,audio.currentTime+.008);gain.gain.exponentialRampToValueAtTime(.0001,audio.currentTime+.065);osc.connect(gain);gain.connect(audio.destination);osc.onended=()=>{osc.disconnect();gain.disconnect();};osc.start();osc.stop(audio.currentTime+.075);}catch{}
 }
 function lights(action){
  if(action==='lamp-power')on=!on;
  if(action==='brightness')level.setTarget(level.target>.85?.35:Math.min(1,level.target+.3));
  if(action==='warmth')warmth.setTarget(warmth.target>.8?0:Math.min(1,warmth.target+.5));
  if(action==='sound')sound=!sound;
  if(action==='light-reset'){on=true;level.setTarget(.72);warmth.setTarget(.65);}
  tick();persist();requestFrame();
 }
 function openPanel(){sync();renderRecent();modal.hidden=false;modal.querySelector('[data-close]').focus({preventScroll:true});}
 function toggleDrawer(){if(isReading())return;
  if(drawer.target||pendingDrawer){pendingDrawer=false;drawer.setTarget(0);}else{pendingDrawer=true;requestView(0);}
  tick(180);requestFrame();}
 trigger.addEventListener('click',openPanel);modal.querySelector('[data-close]').addEventListener('click',close);
 modal.addEventListener('click',e=>{if(e.target===modal)close();});
 for(const [selector,fn] of [['[data-power]',()=>lights('lamp-power')],['[data-sound]',()=>lights('sound')],['[data-reset]',()=>lights('light-reset')]])modal.querySelector(selector).addEventListener('click',fn);
 modal.querySelector('[data-level]').addEventListener('input',e=>{level.setTarget(Number(e.target.value));persist();requestFrame();});
 modal.querySelector('[data-warmth]').addEventListener('input',e=>{warmth.setTarget(Number(e.target.value));persist();requestFrame();});
 modal.querySelector('[data-drawer]').addEventListener('click',()=>{close();toggleDrawer();});empty.querySelector('button').addEventListener('click',toggleDrawer);
 modal.querySelector('[data-clear]').addEventListener('click',()=>recent.clear());
 document.addEventListener('keydown',e=>{
  if(modal.hidden)return;if(e.key==='Escape'){e.preventDefault();close();}
  if(e.key==='Tab'){const list=[...modal.querySelectorAll('button:not([disabled]),input,a')],first=list[0],last=list.at(-1);if(e.shiftKey&&document.activeElement===first){last.focus();e.preventDefault();}else if(!e.shiftKey&&document.activeElement===last){first.focus();e.preventDefault();}}
 });
 function resume(entry,source='desk'){
  if(entry.kind==='book')openBook();else openCourse(entry.index,{source,resume:{href:new URL(entry.href,location.href).href,scroll:entry.scroll}});
 }
 function renderRecent(){
  const list=modal.querySelector('[data-recent]');list.replaceChildren();
  for(const entry of recent.list()){const button=document.createElement('button');button.type='button';button.textContent=entry.kind==='book'?'正义之心 · 回到书柜':courses[entry.index].title+' · 继续阅读';button.addEventListener('click',()=>{close();resume(entry);});list.append(button);}
  modal.querySelector('[data-storage]').textContent=recent.available?'':'浏览器暂时不能保存进度，本次阅读仍可继续。';
 }
 recent.subscribe(()=>{cardVersion='';renderRecent();requestFrame();});
 window.addEventListener('desk:reading-progress',e=>recent.record(e.detail));
 window.addEventListener('message',e=>{const iframe=document.querySelector('#home-reader-host iframe');if(iframe&&e.source===iframe.contentWindow&&e.origin===location.origin&&e.data?.type==='mystudy:reader-opened')recent.record({kind:'book'});});
 function update(dt){
  const room=getRoom();if(!room)return;
  if(pendingDrawer&&getView().target>.01)pendingDrawer=false;
  if(pendingDrawer&&getView().progress===0){pendingDrawer=false;drawer.setTarget(1);}
  if(getView().target>.01)drawer.setTarget(0);
  if(reduced.matches){drawer.finish();level.finish();warmth.finish();}else{drawer.step(dt);level.step(dt);warmth.step(dt);}
  const tint=new THREE.Color(0xe7f1ff).lerp(new THREE.Color(0xffce88),warmth.position);
  room.lamp.color.copy(tint);room.lamp.intensity=on?130+level.position*130:0;
  room.hemi.intensity=on?1.6+level.position*.5:1.05;room.hemi.color.copy(new THREE.Color(0xcdd9e6).lerp(new THREE.Color(0xd8c9ab),warmth.position*.55));
  room.bulb.material.emissive.copy(tint);room.bulb.material.emissiveIntensity=on?1.2:0;
  const values=[on?1:0,level.position,warmth.position,sound?1:0,.5];room.knobs.forEach((knob,i)=>knob.rotation.y=(values[i]-.5)*Math.PI*1.5);
  room.drawer.position.z=room.drawer.userData.baseZ+room.drawer.userData.travel*drawer.position;
  const list=recent.list(),version=JSON.stringify(list);
  if(roomRef!==room||version!==cardVersion){roomRef=room;cardVersion=version;
   const portrait=innerWidth<innerHeight;
   room.drawerCards.forEach(card=>{const slot=list.findIndex(e=>e.kind===card.userData.kind&&(e.kind==='book'||e.index===card.userData.index));card.visible=slot>=0;if(slot>=0){card.position.x=portrait?(slot%2-.5)*12.4:(slot%3-1)*8.3;card.position.z=portrait?-9.2+Math.floor(slot/2)*3.5:-5.4+Math.floor(slot/3)*3.5;card.userData.entry=list[slot];}});
  }
  refreshUI();
  const moving=drawer.active||level.active||warmth.active;
  if(previousMoving&&!moving)tick(160);previousMoving=moving;
 }
 function refreshUI(){empty.hidden=drawer.position<.98||isReading();empty.querySelector('span').hidden=recent.list().length>0;document.body.classList.toggle('drawer-open',drawer.position>.05);}
 sync();
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&audio)audio.suspend().catch(()=>{});});
 return {update,refreshUI,openPanel,toggleDrawer,lights,resume:card=>resume(card.userData.entry,'drawer'),recent,
  adjust:(action,value)=>{(action==='brightness'?level:warmth).setTarget(THREE.MathUtils.clamp(value,action==='brightness'?.2:0,1));persist();requestFrame();},
  dragDrawer:value=>{pendingDrawer=false;drawer.setTarget(THREE.MathUtils.clamp(value,0,1));requestFrame();},
  finishDrawerDrag:()=>{drawer.setTarget(drawer.target>.5?1:0);tick(180);requestFrame();},
  get panelOpen(){return !modal.hidden;},get drawerPosition(){return drawer.position;},get moving(){return drawer.active||level.active||warmth.active||pendingDrawer;},
  snapshot:()=>({on,brightness:level.position,warmth:warmth.position,sound,drawer:drawer.position,panel:!modal.hidden,recent:recent.list(),audioStarted:Boolean(audio)})};
}
