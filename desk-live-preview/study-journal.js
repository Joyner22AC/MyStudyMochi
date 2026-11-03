import * as THREE from './vendor/three.module.js';
import {ViewMotion} from './motion.js';
import {projectiveTransform} from './paper-reader.js';
import {createStudyStore,dayKey,validDay} from './study-store.js';

export function createStudyJournal({courses,getChapters,getRoom,getCamera,getView,requestView,requestFrame,reduced,isBusy,openCourse}){
 const store=createStudyStore({courses,getChapters}),travel=new ViewMotion(0,9),lift=new ViewMotion(0,15);
 let phase='closed',kind='memo',tab='memo',object=null,base=null,hovered=null,returnFocus=null,returnView=0,pending=null;
 let selectedId='',selectedDay=dayKey(),month=selectedDay.slice(0,7),deleteId='',undo=null,editTimer=0,dayTimer=0,surfaceVersion='',surfaceRoom=null,backdropPressed=false;
 const shell=document.createElement('section');shell.id='study-journal';shell.hidden=true;
 shell.innerHTML=`<div class="journal-paper" role="dialog" aria-modal="true" aria-labelledby="journal-title">
 <header class="journal-header"><div><p class="journal-eyebrow">A LITTLE EVERY DAY</p><h2 id="journal-title">留一张，给明天的自己</h2></div><button type="button" data-journal-close aria-label="放回书桌">放回书桌 <span aria-hidden="true">↙</span></button></header>
 <nav class="journal-tabs" aria-label="学习手记"><button type="button" data-tab="memo" aria-pressed="true">学习便签</button><button type="button" data-tab="calendar" aria-pressed="false">学习台历</button><span data-save role="status" aria-live="polite"></span></nav>
 <div class="journal-scroll">
 <section data-memo><div class="memo-layout"><aside class="memo-list"><div class="memo-list-heading"><h3>手边的事</h3><button type="button" data-new>＋ 新便签</button></div><label class="memo-filter"><input type="checkbox" data-show-done> 显示已完成</label><div data-note-list></div></aside>
 <form class="memo-editor"><div class="memo-fields"><label>记作<select data-note-kind><option value="todo">学习待办</option><option value="question">没弄懂的问题</option></select></label><label>放在哪天<input type="date" min="2000-01-01" max="2200-12-31" data-note-day></label></div>
 <label class="memo-writing">写给自己<textarea data-note-text maxlength="2000" rows="7" placeholder="今天想学什么？哪一步还没想明白？"></textarea></label>
 <div class="memo-writing-bottom"><span data-chars>0 / 2000</span><span>输入后自动保存</span></div>
 <label class="memo-link-label">关联到哪一页<select data-note-target aria-label="关联课程或章节"></select></label>
 <div class="memo-footer"><label><input type="checkbox" data-note-done> 我已完成</label><button type="button" data-open-target hidden>去这一页 ↗</button><button type="button" data-delete hidden>删除便签</button></div>
 <div class="memo-delete" data-delete-confirm hidden><p>删除这张便签？</p><button type="button" data-confirm-delete>删除</button><button type="button" data-cancel-delete>保留</button></div>
 <p class="journal-feedback" data-feedback role="status" aria-live="polite"></p><button type="button" data-undo hidden>撤销删除</button>
 </form></div></section>
 <section data-calendar hidden><div class="calendar-layout"><aside class="calendar-month month-collapsed"><div class="calendar-month-heading"><button type="button" data-month-prev aria-label="上个月">‹</button><h3 data-month-title></h3><button type="button" data-month-next aria-label="下个月">›</button><button type="button" data-month-toggle aria-expanded="false">展开月历</button></div><div class="calendar-week" aria-hidden="true"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div><div class="calendar-days" data-days role="group" aria-label="选择日期"></div><button type="button" data-today>回到今天</button><p class="calendar-legend"><i></i> 读过　<span>✓</span> 手动完成</p></aside>
 <div class="calendar-detail"><header class="calendar-date"><button type="button" data-day-prev aria-label="前一天">‹</button><div><p data-day-week></p><h3 data-day-title></h3></div><button type="button" data-day-next aria-label="后一天">›</button></header><p class="calendar-explainer">打开过 ≠ 学完了。学懂后，再亲手打个勾。</p><h4>这天读过</h4><div data-visits></div><h4>这天的便签</h4><div data-day-notes></div><button type="button" data-day-new>＋ 给这一天留张便签</button></div></div></section>
 <footer class="journal-privacy">只保存在此浏览器，不上传。保留100张便签及最近3650条阅读记录。清理网站数据会清除记录；便签不是加密保险箱。</footer></div></div>`;
 document.body.append(shell);
 const q=s=>shell.querySelector(s),paper=q('.journal-paper'),editor=q('.memo-editor'),text=q('[data-note-text]');
 const trigger=document.createElement('button');trigger.id='study-journal-toggle';trigger.type='button';trigger.textContent='学习';trigger.setAttribute('aria-label','学习便签与台历');document.querySelector('.tools').append(trigger);
 // Accessible equivalents share the same physical pick-up path.
 const roomActions=document.querySelector('#room-tools .tool-actions');
 for(const [mode,label] of [['memo','写学习便签'],['calendar','查看学习台历']]){
  const button=document.createElement('button');button.type='button';button.dataset.journal=mode;button.textContent=label;
  button.addEventListener('click',()=>{document.querySelector('#room-tools [data-close]').click();open(mode);});roomActions?.append(button);
 }
 const controls=[document.querySelector('.topline'),document.querySelector('.view-control')];
 function busy(value){controls.forEach(c=>c.inert=value);document.body.classList.toggle('journal-open',value);}
 function feedback(message){q('[data-feedback]').textContent=message;}
 function saveStatus(){q('[data-save]').textContent=store.available?'已存于本机':'未能保存 · 仅本次有效';q('[data-save]').classList.toggle('save-warning',!store.available);}
 function targetOptions(){
  const select=q('[data-note-target]');select.replaceChildren(new Option('暂不关联',''));
  courses.forEach((course,index)=>{const group=document.createElement('optgroup');group.label=course.title;store.targets().filter(t=>t.index===index).forEach(t=>group.append(new Option(t.chapter<0?'课程目录':getChapters()[index][t.chapter].title,t.id)));select.append(group);});
 }
 function current(){return store.notes().find(n=>n.id===selectedId);}
 function renderList(){
  const list=q('[data-note-list]'),showDone=q('[data-show-done]').checked;list.replaceChildren();
  const notes=store.notes().filter(n=>showDone||!n.done).sort((a,b)=>Number(a.done)-Number(b.done)||b.updated-a.updated);
  if(!notes.length){const p=document.createElement('p');p.className='journal-empty';p.textContent=showDone?'还没有便签。写下第一件小事吧。':'手边暂时没有待办，留点空白也很好。';list.append(p);}
  for(const note of notes){const button=document.createElement('button');button.type='button';button.className='memo-card';button.dataset.note=note.id;button.setAttribute('aria-pressed',String(note.id===selectedId));
   const meta=document.createElement('small');meta.textContent=(note.done?'✓ 已完成':note.kind==='question'?'待解的问题':'学习待办')+' · '+note.day;
   const title=document.createElement('span');title.textContent=note.text.trim().split('\n')[0]||'还没写完的便签';button.append(meta,title);button.addEventListener('click',()=>{flush();selectNote(note.id);});list.append(button);
  }
 }
 function selectNote(id='',day=dayKey()){
  selectedId=id;deleteId='';q('[data-delete-confirm]').hidden=true;feedback('');
  const note=current();q('[data-note-kind]').value=note?.kind||'todo';q('[data-note-day]').value=note?.day||day;text.value=note?.text||'';
  const select=q('[data-note-target]');select.querySelector('option[data-unavailable]')?.remove();if(note?.target&&!store.resolve(note.target)){const option=new Option('章节目录暂不可用 · 保留原关联',note.target);option.dataset.unavailable='true';select.append(option);}select.value=note?.target||'';q('[data-note-done]').checked=note?.done===true;
  q('[data-chars]').textContent=`${text.value.length} / 2000`;q('[data-delete]').hidden=!note;syncTarget();renderList();
 }
 function syncTarget(){q('[data-open-target]').hidden=!store.resolve(q('[data-note-target]').value);}
 function persistEditor(){
  clearTimeout(editTimer);editTimer=0;
  if(!text.value.trim()&&!selectedId){saveStatus();return;}
  let day=q('[data-note-day]').value;if(!validDay(day)){day=current()?.day||dayKey();q('[data-note-day]').value=day;feedback('日期不完整，文字已按原日期保存。');}
  const note=store.upsert({id:selectedId,text:text.value,kind:q('[data-note-kind]').value,day,done:q('[data-note-done]').checked,target:q('[data-note-target]').value});
  if(!note){feedback('便签已满（最多100张），请先整理不再需要的便签。');return;}
  selectedId=note.id;q('[data-delete]').hidden=false;saveStatus();renderList();
 }
 function flush(){if(editTimer)persistEditor();}
 editor.addEventListener('submit',e=>e.preventDefault());
 text.addEventListener('input',()=>{q('[data-chars]').textContent=`${text.value.length} / 2000`;q('[data-save]').textContent='正在保存…';clearTimeout(editTimer);editTimer=setTimeout(persistEditor,220);});
 for(const name of ['kind','day','target','done'])q(`[data-note-${name}]`).addEventListener('change',()=>{persistEditor();syncTarget();});
 q('[data-new]').addEventListener('click',()=>{flush();selectNote();text.focus();});
 q('[data-show-done]').addEventListener('change',renderList);
 q('[data-delete]').addEventListener('click',()=>{flush();deleteId=selectedId;q('[data-delete-confirm]').hidden=false;q('[data-cancel-delete]').focus();});
 q('[data-cancel-delete]').addEventListener('click',()=>{deleteId='';q('[data-delete-confirm]').hidden=true;q('[data-delete]').focus();});
 q('[data-confirm-delete]').addEventListener('click',()=>{undo=current();store.remove(deleteId);selectNote();feedback('便签已删除。');q('[data-undo]').hidden=false;});
 q('[data-undo]').addEventListener('click',()=>{if(!undo)return;const note=store.upsert(undo);undo=null;q('[data-undo]').hidden=true;if(note)selectNote(note.id);});
 function readTarget(id){const target=store.resolve(id);if(!target)return;close(()=>openCourse(target.index,{resume:{href:new URL(target.href,location.href).href,scroll:0}}));}
 q('[data-open-target]').addEventListener('click',()=>{flush();readTarget(q('[data-note-target]').value);});
 function showTab(value){flush();tab=value;q('[data-memo]').hidden=tab!=='memo';q('[data-calendar]').hidden=tab!=='calendar';shell.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tab===tab)));q('#journal-title').textContent=tab==='memo'?'留一张，给明天的自己':'慢慢学，每天一点';if(tab==='calendar')renderCalendar();else renderList();}
 shell.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.tab)));
 function dateValue(day){const [y,m,d]=day.split('-').map(Number);return new Date(y,m-1,d,12);}
 function changeDay(day,animate=true){if(!validDay(day))return;selectedDay=day;month=day.slice(0,7);renderCalendar();if(animate&&!reduced.matches)q('.calendar-detail').animate([{opacity:.4,transform:'translateY(8px) rotateX(-4deg)'},{opacity:1,transform:'none'}],{duration:240,easing:'ease-out'});}
 function offsetDay(amount){const date=dateValue(selectedDay);date.setDate(date.getDate()+amount);changeDay(dayKey(date));}
 function offsetMonth(amount){const date=dateValue(month+'-01');date.setMonth(date.getMonth()+amount);if(validDay(dayKey(date))){month=dayKey(date).slice(0,7);renderCalendar();}}
 q('[data-month-prev]').addEventListener('click',()=>offsetMonth(-1));q('[data-month-next]').addEventListener('click',()=>offsetMonth(1));
 q('[data-month-toggle]').addEventListener('click',()=>{const closed=q('.calendar-month').classList.toggle('month-collapsed');q('[data-month-toggle]').setAttribute('aria-expanded',String(!closed));q('[data-month-toggle]').textContent=closed?'展开月历':'收起月历';});
 q('[data-day-prev]').addEventListener('click',()=>offsetDay(-1));q('[data-day-next]').addEventListener('click',()=>offsetDay(1));q('[data-today]').addEventListener('click',()=>changeDay(dayKey()));
 q('[data-day-new]').addEventListener('click',()=>{selectNote('',selectedDay);showTab('memo');text.focus();});
 function renderCalendar(){
  const date=dateValue(month+'-01'),today=dayKey(),visits=store.visits(),notes=store.notes(),list=q('[data-days]');list.replaceChildren();
  q('[data-month-title]').textContent=`${date.getFullYear()}年 ${date.getMonth()+1}月`;
  const first=(date.getDay()+6)%7;date.setDate(1-first);
  for(let i=0;i<42;i++){
   const day=dayKey(date),button=document.createElement('button');button.type='button';button.dataset.day=day;button.textContent=date.getDate();button.className=day.slice(0,7)!==month?'adjacent-month':'';
   const dayVisits=visits.filter(v=>v.day===day),tasks=notes.filter(n=>n.day===day),done=dayVisits.some(v=>v.done)||tasks.some(n=>n.done);
   button.setAttribute('aria-pressed',String(day===selectedDay));if(day===today)button.setAttribute('aria-current','date');
   button.disabled=!validDay(day);
   button.dataset.visited=String(dayVisits.length>0);button.dataset.done=String(done);button.dataset.planned=String(tasks.some(n=>!n.done));
   button.setAttribute('aria-label',`${day}${day===today?' 今天':''}，读过${dayVisits.length}项，${tasks.length}张便签${done?'，有手动完成项':''}`);
   button.addEventListener('click',()=>{changeDay(day);q(`[data-day="${day}"]`)?.focus({preventScroll:true});});list.append(button);date.setDate(date.getDate()+1);
  }
  const selected=dateValue(selectedDay);q('[data-day-week]').textContent=new Intl.DateTimeFormat('zh-CN',{weekday:'long'}).format(selected)+(selectedDay===today?' · 今天':'');q('[data-day-title]').textContent=`${selected.getMonth()+1}月${selected.getDate()}日`;
  const visited=q('[data-visits]');visited.replaceChildren();
  for(const visit of visits.filter(v=>v.day===selectedDay)){
   const target=store.resolve(visit.target);if(!target)continue;
   const row=document.createElement('div');row.className='calendar-entry';
   const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=visit.done;check.setAttribute('aria-label',`标记完成：${target.title}`);check.addEventListener('change',()=>{store.complete(selectedDay,target.id,check.checked);renderCalendar();q(`[data-visits] input[data-target="${target.id}"]`)?.focus({preventScroll:true});});check.dataset.target=target.id;label.append(check);
   const button=document.createElement('button');button.type='button';button.textContent=target.title;button.addEventListener('click',()=>readTarget(target.id));
   const badge=document.createElement('small');badge.textContent=visit.done?'已手动完成':'读过';row.append(label,button,badge);visited.append(row);
  }
  if(!visited.children.length){const p=document.createElement('p');p.className='journal-empty';p.textContent=selectedDay>today?'这一天还没到，先留一个小计划吧。':'这一天还没有阅读记录。记录从启用台历后开始。';visited.append(p);}
  const tasks=q('[data-day-notes]');tasks.replaceChildren();
  for(const note of notes.filter(n=>n.day===selectedDay)){const button=document.createElement('button');button.type='button';button.className='calendar-note';button.textContent=(note.done?'✓ ':note.kind==='question'?'? ':'○ ')+(note.text.trim().split('\n')[0]||'未写完的便签');button.addEventListener('click',()=>{selectNote(note.id);showTab('memo');text.focus();});tasks.append(button);}
  if(!tasks.children.length){const p=document.createElement('p');p.className='journal-empty';p.textContent='纸面还是空白的。';tasks.append(p);}
 }
 function open(mode='memo'){
  if(phase!=='closed'||isBusy())return;returnFocus=document.activeElement;returnView=getView().progress;kind=mode;pending=null;object=null;base=null;hovered=null;backdropPressed=false;lift.setTarget(0);
  targetOptions();selectNote(store.notes().find(n=>!n.done)?.id||'');selectedDay=dayKey();month=selectedDay.slice(0,7);showTab(mode);saveStatus();busy(true);
  shell.hidden=false;shell.classList.remove('journal-ready');paper.style.opacity='0';phase=getRoom()?'approaching':'ready';requestView(0);q('[data-journal-close]').focus({preventScroll:true});
  if(phase==='ready'){shell.classList.add('journal-ready');paper.removeAttribute('style');}requestFrame();
 }
 function close(after=null){
  if(phase==='closed'||phase==='closing')return;flush();pending=after;phase='closing';travel.setTarget(0);shell.classList.remove('journal-ready');requestFrame();if(!getRoom())finish();
 }
 function finish(){
  if(base&&object){object.position.copy(base.position);object.quaternion.copy(base.rotation);object.scale.copy(base.scale);}phase='closed';shell.hidden=true;busy(false);object=null;base=null;
  const next=pending;pending=null;if(next)next();else{requestView(returnView);(returnFocus?.isConnected&&returnFocus!==document.body?returnFocus:trigger).focus({preventScroll:true});}
 }
 function panelRect(){const margin=innerWidth<650?12:40,w=Math.min(860,innerWidth-margin*2),h=Math.min(690,innerHeight-(innerWidth<650?24:64));return {left:(innerWidth-w)/2,top:(innerHeight-h)/2,width:w,height:h};}
 function update(dt){
  if(reduced.matches){travel.finish();lift.finish();}else{travel.step(dt);lift.step(dt);}
  const room=getRoom();
  if(room){const notes=store.notes(),todos=notes.filter(n=>!n.done&&n.kind==='todo').length,questions=notes.filter(n=>!n.done&&n.kind==='question').length,signature=[dayKey(),todos,questions].join(':');if(signature!==surfaceVersion||room!==surfaceRoom){room.refreshJournalSurfaces?.(new Date(),todos,questions);surfaceVersion=signature;surfaceRoom=room;}}
  if(phase==='closed'){if(room)for(const mode of ['memo','calendar']){const mesh=room[mode];if(mesh)mesh.position.y=mesh.userData.baseY+(hovered===mode?lift.position*.35:0);}return;}
  if(!room)return;
  if(phase==='approaching'&&getView().progress===0){phase='opening';travel.setTarget(1);}
  const mesh=room[kind],camera=getCamera();if(!mesh||!camera)return;
  if(object!==mesh){object=mesh;base={position:mesh.position.clone(),rotation:mesh.quaternion.clone(),scale:mesh.scale.clone()};base.position.y=mesh.userData.baseY;}
  const rect=panelRect(),t=travel.position,distance=12,face=object.getObjectByName('journal face'),{width,height}=face.geometry.parameters;
  const visibleHeight=2*distance*Math.tan(THREE.MathUtils.degToRad(camera.fov/2)),visibleWidth=visibleHeight*camera.aspect;
  const rotation=camera.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI/2));
  const scale=new THREE.Vector3(visibleWidth*rect.width/innerWidth/width,1,visibleHeight*rect.height/innerHeight/height);
  const end=camera.position.clone().add(new THREE.Vector3(0,0,-distance).applyQuaternion(camera.quaternion));
  end.sub(face.position.clone().multiply(scale).applyQuaternion(rotation));
  object.position.copy(base.position).lerp(end,t).add(new THREE.Vector3(0,1,0).applyQuaternion(camera.quaternion).multiplyScalar(Math.sin(Math.PI*t)*1.3));object.quaternion.copy(base.rotation).slerp(rotation,t);object.scale.copy(base.scale).lerp(scale,t);
  object.updateMatrixWorld(true);
  if(phase!=='ready'){
   const corners=[[-width/2,height/2],[width/2,height/2],[width/2,-height/2],[-width/2,-height/2]].map(([x,y])=>{const q=face.localToWorld(new THREE.Vector3(x,y,0)).project(camera);return [(q.x+1)*innerWidth/2,(1-q.y)*innerHeight/2];});
   paper.style.width=rect.width+'px';paper.style.height=rect.height+'px';paper.style.transform=projectiveTransform(corners,rect.width,rect.height);paper.style.opacity=String(THREE.MathUtils.smoothstep(t,.35,.9));
  }
  shell.style.setProperty('--journal-shade',String(t*.48));
  if(phase==='opening'&&!travel.active&&travel.target===1){phase='ready';paper.removeAttribute('style');shell.classList.add('journal-ready');}
  if(phase==='closing'&&!travel.active&&travel.target===0)finish();
 }
 trigger.addEventListener('click',()=>open());q('[data-journal-close]').addEventListener('click',()=>close());
 // A touch which opened the object may produce a delayed compatibility click.
 // Only a new gesture which actually began on the backdrop may dismiss it.
 shell.addEventListener('pointerdown',e=>{backdropPressed=e.target===shell;});shell.addEventListener('pointercancel',()=>{backdropPressed=false;});
 shell.addEventListener('click',e=>{if(e.target===shell&&backdropPressed){backdropPressed=false;close();}});
 document.addEventListener('keydown',e=>{
  if(phase==='closed')return;
  if(e.key==='Escape'){e.preventDefault();close();return;}
  if(e.key==='Tab'){if(phase!=='ready'){e.preventDefault();q('[data-journal-close]').focus();return;}const items=[...paper.querySelectorAll('button,input,select,textarea')].filter(el=>!el.disabled&&el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden');const first=items[0],last=items.at(-1);if(!paper.contains(document.activeElement)||e.shiftKey&&document.activeElement===first){e.preventDefault();(e.shiftKey?last:first)?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}
 });
 store.subscribe(()=>{saveStatus();if(tab==='calendar')renderCalendar();else renderList();requestFrame();});
 window.addEventListener('storage',e=>{if(e.key==='mystudy:desk:journal:v1')store.refresh();});
 window.addEventListener('desk:chapter-opened',e=>store.record(e.detail));
 window.addEventListener('desk:reading-progress',e=>store.record(e.detail));
 function nextDay(){clearTimeout(dayTimer);const now=new Date(),next=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1);dayTimer=setTimeout(()=>{if(tab==='calendar'&&phase!=='closed')renderCalendar();requestFrame();nextDay();},Math.min(2147483647,next-now+100));}
 document.addEventListener('visibilitychange',()=>{if(document.hidden)flush();else{if(tab==='calendar'&&phase!=='closed')renderCalendar();requestFrame();nextDay();}});window.addEventListener('pagehide',flush);nextDay();
 return {open,close,update,store,get active(){return phase!=='closed';},get moving(){return travel.active||lift.active||phase==='approaching';},
  hover:mode=>{if(phase!=='closed')return;hovered=mode;lift.setTarget(mode?1:0);requestFrame();},
  snapshot:()=>({phase,kind,tab,progress:travel.position,noteCount:store.notes().length,visitCount:store.visits().length,available:store.available,day:dayKey()})};
}
