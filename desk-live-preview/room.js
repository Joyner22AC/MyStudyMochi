import * as THREE from './vendor/three.module.js';
import {RoundedBoxGeometry} from './vendor/RoundedBoxGeometry.js';

/* Mesh reconstruction of DEsk's room layout, not its SDF ray tracer.
 * Dimensions / camera are derived from ec16818b; see vendor/DESK-LICENSE.txt.
 * Geometry simplification is deliberate: rasterized objects share one live space. */
export function buildRoom(constants,aspect,courses,onDirty){
 const root=new THREE.Group();root.name='one-room';
 const portrait=aspect<1;
 const pose=window.DeskCamera.at(0,aspect,constants),back=pose.zf,front=constants.RM_ZN;
 const shelfFront=pose.shzf,shelfBack=shelfFront-constants.RM_SH_D;
 const shelfWidth=pose.shhx;
 const groups={papers:[],book:null,doors:[],hitTargets:[],knobs:[],drawerCards:[]};
 const color=(hex,roughness=.65,metalness=0)=>new THREE.MeshStandardMaterial({color:hex,roughness,metalness});
 const walnut=color(0x69452b,.45),edgeWood=color(0x4d3020,.52),darkWood=color(0x38261b,.75);
 const brass=color(0xbba06a,.42,.55),felt=color(0x273b30,.9),leatherA=color(0x552d27,.8),leatherB=color(0x253a32,.8);
 const darkMetal=color(0x272929,.55,.3),glass=color(0x141a18,.28,.25),paperEdge=color(0xd8cdb2,.95);
 const materials={walnut,edgeWood,darkWood,brass,felt,leatherA,leatherB,darkMetal,glass,paperEdge};
 const geometryCache=new Map();
 function box(name,size,pos,mat,parent=root){
  const key=size.join(',');if(!geometryCache.has(key))geometryCache.set(key,Math.min(...size)>.15?new RoundedBoxGeometry(...size,2,Math.min(.12,Math.min(...size)*.13)):new THREE.BoxGeometry(...size));
  const mesh=new THREE.Mesh(geometryCache.get(key),mat);mesh.name=name;mesh.position.set(...pos);
  mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
 }
 function cylinder(name,radius,height,pos,mat,parent=root){
  const mesh=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,height,24),mat);
  mesh.name=name;mesh.position.set(...pos);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
 }
 function textureLabel(text,{width=512,height=192,background='#e5d8b7',ink='#3b3024',size=44,vertical=false}={}){
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d');ctx.fillStyle=background;ctx.fillRect(0,0,width,height);
  ctx.strokeStyle='rgba(82,60,36,.24)';ctx.lineWidth=3;ctx.strokeRect(12,12,width-24,height-24);
  ctx.fillStyle=ink;ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`${size}px "Songti SC",SimSun,serif`;
  if(vertical){const chars=[...text],step=height/(chars.length+1);chars.forEach((ch,i)=>ctx.fillText(ch,width/2,step*(i+1),width-38));}
  else ctx.fillText(text,width/2,height/2,width-38);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  texture.anisotropy=4;return texture;
 }
 function plane(name,w,h,pos,rotation,texture,parent=root){
  const material=new THREE.MeshStandardMaterial({map:texture,roughness:.86,side:THREE.DoubleSide});
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(w,h),material);
  mesh.name=name;mesh.position.set(...pos);mesh.rotation.set(...rotation);mesh.receiveShadow=true;
  parent.add(mesh);return mesh;
 }
 // Material maps are auxiliary surfaces on actual 3D geometry, never a room backdrop.
 const textureLoader=new THREE.TextureLoader();
 const grain=textureLoader.load('materials/walnut.webp',onDirty,undefined,()=>{});
 grain.colorSpace=THREE.SRGBColorSpace;grain.wrapS=grain.wrapT=THREE.RepeatWrapping;grain.repeat.set(2,1);
 walnut.map=grain;walnut.color.set(0xe9d2b2);
 walnut.roughness=.68;
 const micro=document.createElement('canvas');micro.width=micro.height=64;const mctx=micro.getContext('2d'),pixels=mctx.createImageData(64,64);let microSeed=1827;
 for(let i=0;i<pixels.data.length;i+=4){microSeed=(microSeed*1664525+1013904223)>>>0;const v=185+(microSeed%45);pixels.data.set([v,v,v,255],i);}mctx.putImageData(pixels,0,0);
 const roughness=new THREE.CanvasTexture(micro);roughness.wrapS=roughness.wrapT=THREE.RepeatWrapping;roughness.repeat.set(9,3);
 brass.roughnessMap=roughness;leatherA.bumpMap=roughness;leatherB.bumpMap=roughness;leatherA.bumpScale=leatherB.bumpScale=.018;

 box('floor',[125,.4,145],[0,-19.25,back-18],color(0x473b2d,.9));
 box('wall',[125,82,.5],[0,20,shelfBack-1],color(0x5b5243,.92));
 box('skirting',[125,2.1,.6],[0,-18,shelfBack-.5],darkWood);
 box('desk top',[32,.55,front-back],[0,-.275,(front+back)/2],walnut);
 box('desk front rail',[31,.65,.55],[0,-.95,front-.35],edgeWood);
 box('desk rear panel',[30,4.2,.75],[0,-2.6,back+.6],edgeWood);
 for(const x of [-15.15,15.15])box('desk leg',[1.04,18.2,front-back-1.2],[x,-9.5,(front+back)/2+.4],edgeWood);
 const drawer=new THREE.Group();drawer.name='working drawer';drawer.position.set(0,0,front-.1);drawer.userData.baseZ=front-.1;drawer.userData.action='drawer';root.add(drawer);groups.drawer=drawer;
 box('drawer face',[26.4,2.6,.6],[0,-2.3,0],walnut,drawer);
 box('drawer brass plate',[4.0,.75,.16],[0,-2.3,.34],brass,drawer);
 box('drawer pull',[3.3,.36,.6],[0,-2.3,.85],brass,drawer);
 const drawerDepth=portrait?12:8;drawer.userData.depth=drawerDepth;drawer.userData.travel=portrait?11:7;
 box('drawer lining',[25.8,.2,drawerDepth],[0,-2.68,-drawerDepth/2-.2],felt,drawer);
 for(const x of [-13.1,13.1])box('drawer side',[.35,2,drawerDepth],[x,-1.8,-drawerDepth/2-.2],edgeWood,drawer);
 box('drawer back',[26.4,2,.3],[0,-1.8,-drawerDepth-.1],edgeWood,drawer);
 // Public course titles only. Recent-reading metadata selects which physical cards are visible.
 [...courses.map((c,i)=>({title:c.title,kind:'course',index:i})),{title:'正义之心',kind:'book',index:0}].forEach(entry=>{
  const card=new THREE.Group();card.name='recent reading card';card.visible=false;card.position.y=-2.5;
  card.userData={action:'resume',...entry};
  const cw=portrait?11.5:7.7,ch=portrait?3.2:2.8;
  box('card edge',[cw,.05,ch],[0,0,0],paperEdge,card);
  plane('paper face',cw,ch,[0,.04,0],[-Math.PI/2,0,0],textureLabel(entry.title,{width:1024,height:384,size:128}),card);
  drawer.add(card);groups.drawerCards.push(card);
 });

 const top=22.6,bottom=-15.4,center=(shelfFront+shelfBack)/2;
 box('shelf back',[shelfWidth*2,.5,top-bottom],[0,(top+bottom)/2,shelfBack],darkWood).rotation.x=Math.PI/2;
 for(const x of [-shelfWidth+.55,0,shelfWidth-.55])box('shelf upright',[1.1,top-bottom,constants.RM_SH_D],[x,(top+bottom)/2,center],walnut);
 for(const y of [bottom,-2.6,8.8,20.6])box('shelf board',[shelfWidth*2,.8,constants.RM_SH_D],[0,y,center],walnut);
 box('shelf cornice',[shelfWidth*2+1.8,1.8,constants.RM_SH_D+1.3],[0,21.8,center+.25],edgeWood);
 box('shelf top bevel',[shelfWidth*2+1.2,.4,constants.RM_SH_D+1.0],[0,22.8,center+.25],walnut);
 for(const [i,row] of constants.binders.entries()){
  const [x,hw,h,lean,labelY]=row;
  const binder=new THREE.Group();binder.position.set(x,9.2,shelfFront-3.75);binder.rotation.z=-lean;
  box('binder cover',[hw*2,h,6.4],[0,h/2,0],i%2?leatherB:leatherA,binder);
  box('binder spine',[hw*2-.08,h-.2,.16],[0,h/2,3.25],i%2?leatherB:leatherA,binder);
  plane('blank label',hw*1.3,2.8,[0,labelY,3.35],[0,0,0],textureLabel('·',{width:192,height:192,size:45}),binder);
  root.add(binder);
 }
 // One actual book; the unlabelled binders remain scenery, not invented book entries.
 const book=new THREE.Group();book.name='actual encrypted book';book.position.set(16.02,9.2,shelfFront-3.55);
 const bookMat=color(0x172737,.55);
 box('book pages',[1.8,8.6,5.8],[0,4.5,0],paperEdge,book);
 box('book back board',[.18,9.1,6.1],[-1.02,4.55,0],bookMat,book);
 const cover=new THREE.Group();cover.position.set(1.02,0,3.1);book.add(cover);
 box('book front board',[.18,9.1,6.1],[0,4.55,-3.1],bookMat,cover);
 plane('book cover title',5.4,8.2,[.11,4.55,-3.1],[0,Math.PI/2,0],textureLabel('正义之心',{width:768,height:1024,size:128,background:'#172737',ink:'#ddc58c'}),cover);
 groups.bookCover=cover;
 groups.bookPage=plane('open book page',5.7,8.6,[.94,4.55,0],[0,Math.PI/2,0],textureLabel('正义之心',{width:768,height:1024,size:112,background:'#eee4c9',ink:'#302a23'}),book);
 box('book spine',[2.14,9.1,.3],[0,4.55,3.1],bookMat,book);
 for(const y of [1.3,3.1,6.6,8])box('gilt band',[2.2,.07,.06],[0,y,3.29],brass,book);
 plane('book title',1.5,5.4,[0,4.9,3.29],[0,0,0],textureLabel('正义之心',{width:256,height:768,size:112,vertical:true,background:'#172737',ink:'#f3dfaa'}),book);
 book.userData.action='library';book.userData.baseZ=book.position.z;groups.book=book;
 groups.hitTargets.push(book);root.add(book);

 // Hinged doors guard the real upper book bay. They are geometry, including hit occlusion.
 for(const side of [-1,1]){
  const door=new THREE.Group();door.name=side<0?'left cabinet door':'right cabinet door';
  door.position.set(side*(shelfWidth-.55),8.95,shelfFront+.55);door.userData.side=side;door.userData.action='cabinet';
  const span=shelfWidth-.8,cx=-side*span/2;
  box('door opaque panel',[span,11.2,.20],[cx,5.7,0],felt,door);
  for(const x of [cx-span/2+.2,cx+span/2-.2])box('door stile',[.42,11.6,.5],[x,5.7,.12],edgeWood,door);
  for(const y of [.1,11.3])box('door rail',[span,.48,.5],[cx,y,.12],walnut,door);
  for(const y of [1,10.4])cylinder('cabinet hinge',.18,.8,[0,y,.22],brass,door);
  cylinder('door handle',.25,.16,[-side*(span-.8),5.6,.43],brass,door).rotation.x=Math.PI/2;
  const lock=new THREE.Group();lock.position.set(-side*(span-.8),7.0,.43);door.add(lock);door.userData.lock=lock;
  cylinder('cabinet lock cylinder',.24,.12,[0,0,0],brass,lock).rotation.x=Math.PI/2;
  box('key slot',[.055,.27,.035],[0,0,.08],darkMetal,lock);
  root.add(door);groups.doors.push(door);groups.hitTargets.push(door);
 }

 // The console/post box keep source-inspired positions; decorative until explicitly implemented.
 const consoleX=-10.3,consoleZ=back+1.5;
 const consoleGroup=new THREE.Group();consoleGroup.userData.action='lighting';root.add(consoleGroup);groups.console=consoleGroup;
 box('console wooden case',[10.2,3.5,4.2],[0,1.75,0],edgeWood,consoleGroup);
 box('console panel',[9.3,.18,3.7],[0,3.57,0],darkMetal,consoleGroup);
 for(const [i,x] of [-3,-1.6,0,1.6,3.1].entries()){
  const knob=new THREE.Group();knob.position.set(x,3.82,.25);knob.userData.action=['lamp-power','brightness','warmth','sound','light-reset'][i];consoleGroup.add(knob);groups.knobs.push(knob);
  cylinder('knob',i===2?.6:.35,.28,[0,0,0],i%2?brass:darkMetal,knob);
  box('knob pointer',[.05,.035,.28],[0,.16,-.1],paperEdge,knob);
 }
 consoleGroup.scale.setScalar(.55);consoleGroup.position.set(consoleX,0,consoleZ);
 const postZ=back+1.5;
 const postGroup=new THREE.Group();root.add(postGroup);
 const post=color(0x842e21,.82);
 box('post box',[4.4,4.6,3.0],[0,2.3,0],post,postGroup);
 box('post lid',[4.7,.4,3.3],[0,4.75,0],post,postGroup);
 box('letter slot',[3.4,.12,.10],[0,3.8,1.55],darkMetal,postGroup);
 box('post badge',[1.6,.6,.12],[0,2.0,1.57],brass,postGroup);
 postGroup.scale.setScalar(.55);postGroup.position.set(10,0,postZ);

 const clockZ=back+1.1;
 box('clock case',[10.3,.8,1.85],[.5,.4,clockZ],edgeWood);
 const clockTexture=textureLabel('MY STUDY',{width:768,height:160,size:65,background:'#181d19',ink:'#c77f50'});
 const clock=plane('clock display',9.3,1.25,[.5,.82,clockZ],[-Math.PI/2,0,0],clockTexture);
 // Lower shelf clock and two writing pads are actual volumes, not baked pixels.
 box('shelf clock case',[4.5,4.7,1.4],[4.6,.15,shelfFront-2.5],edgeWood);
 plane('clock face',3.6,3.6,[4.6,.3,shelfFront-1.77],[0,0,0],textureLabel('12 · 6',{width:256,height:256,size:37}));
 for(const x of [-10.5,-3.8]){
  const pad=box('writing pad',[4.5,4.6,.3],[x,.1,shelfFront-2.3],paperEdge);
  pad.rotation.x=-.16;
  for(let i=0;i<5;i++){
   const ring=new THREE.Mesh(new THREE.TorusGeometry(.11,.025,4,12),brass);
   ring.position.set(x-1.4+i*.7,2.45,shelfFront-2.05);root.add(ring);
  }
 }

 function paperTexture(course,index){
  // Rasterize at twice the design resolution; retain physical dimensions and layout.
  const canvas=document.createElement('canvas');canvas.width=1536;canvas.height=1024;const ctx=canvas.getContext('2d');ctx.scale(2,2);
  ctx.fillStyle='#eee4c9';ctx.fillRect(0,0,768,512);
  let seed=421+index;ctx.fillStyle='rgba(105,87,53,.055)';
  for(let i=0;i<3800;i++){seed=(seed*1664525+1013904223)>>>0;const x=seed/4294967296*768;seed=(seed*1664525+1013904223)>>>0;ctx.fillRect(x,seed/4294967296*512,1.4,.4);}
  ctx.strokeStyle='rgba(107,91,57,.12)';ctx.lineWidth=1;
  for(let y=125;y<490;y+=48){ctx.beginPath();ctx.moveTo(42,y);ctx.lineTo(725,y);ctx.stroke();}
  ctx.fillStyle='#806a4b';ctx.font='22px Georgia';ctx.fillText(`FIELD NOTES / ${String(index+1).padStart(2,'0')}`,48,61);
  ctx.fillStyle='#171713';ctx.font='600 46px "Microsoft YaHei","PingFang SC",sans-serif';
  let line='',y=165;
  for(const ch of course.title){if(ctx.measureText(line+ch).width>665){ctx.fillText(line,48,y);line='';y+=64;}line+=ch;}ctx.fillText(line,48,y);
  ctx.font='600 25px "Microsoft YaHei",sans-serif';ctx.fillStyle='#343127';
  line='';y+=80;
  for(const ch of course.summary){if(ctx.measureText(line+ch).width>665){ctx.fillText(line,48,y);line='';y+=42;}if(y>375)break;line+=ch;}
  if(y<=375)ctx.fillText(line,48,y);
  ctx.font='21px "Microsoft YaHei",sans-serif';ctx.fillText('取起手稿 · 开始阅读',48,462);
  // The corner is part of the sheet surface; paper has its own thickness and live shadow.
  ctx.fillStyle='#c4b796';ctx.beginPath();ctx.moveTo(722,0);ctx.lineTo(768,0);ctx.lineTo(768,46);ctx.fill();
  const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=16;return map;
 }
 courses.forEach((course,i)=>{
  const w=portrait?13.8:8.1,h=portrait?10.4:Math.min(5.5,(front-back-5.2)/2);
  const x=portrait?(i%2-.5)*15.7:(i%3-1)*9.7;
  // Reserve a rear band for scenery; adapt both paper rows to available desk depth.
  const z=portrait?back+13.5+Math.floor(i/2)*13.7:back+4.2+h/2+Math.floor(i/3)*(h+.7);
  const group=new THREE.Group();group.name='paper-'+i;group.position.set(x,.10,z);group.rotation.y=i%2?.018:-.026;
  box('paper thickness',[w,.048,h],[0,0,0],paperEdge,group);
  const sheet=plane('paper face',w,h,[0,.04,0],[-Math.PI/2,0,0],paperTexture(course,i),group);
  // The solid paper edge casts the sheet's shadow; avoid a duplicate near-coplanar caster.
  sheet.castShadow=false;group.userData.action='course';group.userData.index=i;group.userData.baseY=.10;
  groups.papers.push(group);groups.hitTargets.push(group);root.add(group);
 });

 const hemi=new THREE.HemisphereLight(0xd5cbb6,0x4d3c29,1.65);root.add(hemi);
 const fixture=new THREE.Group();fixture.position.set(13.8,0,back+.9);fixture.name='brass desk lamp';fixture.userData.action='lamp-power';root.add(fixture);groups.lampFixture=fixture;
 cylinder('lamp foot',1,.22,[0,.15,0],brass,fixture);
 cylinder('lamp stem',.12,5.7,[0,3,0],brass,fixture);
 cylinder('lamp joint',.28,.45,[0,5.85,0],brass,fixture);
 const shade=new THREE.Group();shade.position.set(0,6.4,0);fixture.add(shade);
 const targetPoint=new THREE.Vector3(-1,0,back*.15),source=new THREE.Vector3(13.8,6.4,back+.9);
 shade.quaternion.setFromUnitVectors(new THREE.Vector3(0,-1,0),targetPoint.clone().sub(source).normalize());
 const shell=new THREE.Mesh(new THREE.ConeGeometry(1.35,1.6,32,1,true),color(0x234d3d,.37,.15));shell.position.y=.1;shell.castShadow=true;shade.add(shell);
 const bulbMat=new THREE.MeshStandardMaterial({color:0xffe7bc,emissive:0xffd49b,emissiveIntensity:1.4});
 const bulb=new THREE.Mesh(new THREE.SphereGeometry(.25,16,12),bulbMat);bulb.position.y=-.35;shade.add(bulb);groups.bulb=bulb;
 const lamp=new THREE.SpotLight(0xffe4b5,220,150,.95,.75,1.6);
 lamp.name='single desk lamp';fixture.updateMatrixWorld(true);bulb.getWorldPosition(lamp.position);lamp.target.position.copy(targetPoint);
 lamp.castShadow=true;lamp.shadow.mapSize.set(1024,1024);lamp.shadow.bias=-.0008;lamp.shadow.normalBias=.16;
 lamp.shadow.camera.near=1;lamp.shadow.camera.far=95;root.add(lamp,lamp.target);
 // No screenshot plane, no camera-frame sequence. Every visible surface is a mesh.
 return {root,...groups,pose,lamp,hemi,materials,meshCount:root.getObjectsByProperty('isMesh',true).length};
}
