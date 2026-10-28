/* Camera mathematics adapted from DEsk draw.c, ec16818b (MIT; vendor/LICENSE.txt).
 * Web host API and interpolation written for this prototype. */
(() => {
 const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
 function cameras(aspect,c){
  const hx=c.RM_HX_MIN, fov=c.RM_FOV_X_V, a=Math.max(aspect,.2);
  const zf=c.RM_ZN-2*hx/a, zn=c.RM_ZN+c.RM_DR_PULL+.90;
  const eye=[0,(zn-zf)*a/fov,(zf+zn)*.5];
  const plan={eye,pitch:0};
  const shzf=zf+(fov*.5/a)*c.RM_FLOOR+c.RM_SH_PLINTH_Z-c.RM_SH_CLEAR;
  const phi=.9599, fy=fov/a;
  const yT=c.RM_SH_CORN_Y,zT=shzf+c.RM_SH_CORN_P;
  const zB=zf+.42*(c.RM_ZN-zf);
  const cT=1/Math.tan(phi+Math.atan((.5-.045)*fy));
  const cB=1/Math.tan(phi+Math.atan((.5-.990)*fy));
  const ez=(zT*cT-zB*cB-yT)/(cT-cB),ey=yT-(zT-ez)*cT;
  const shelf={eye:[0,ey,ez],pitch:phi};
  const ww=[0,-Math.cos(phi),-Math.sin(phi)];
  const dw=dot([0,yT-ey,zT-ez],ww);
  const shhx=Math.max(12,.97*dw*fov*.5-c.RM_SH_CORN_P,c.RM_BK_X0+2*c.RM_BK_HW+c.RM_BK_GAP+c.RM_SH_SIDE);
  return {plan,shelf,zf,shzf,hx,shhx,fov,a};
 }
 function at(t,aspect,c){
  const base=cameras(aspect,c);
  const pitch=base.shelf.pitch*t;
  const eye=base.plan.eye.map((v,i)=>v+(base.shelf.eye[i]-v)*t);
  const ww=[0,-Math.cos(pitch),-Math.sin(pitch)],uu=[1,0,0],vv=cross(uu,ww);
  return {...base,eye,ww,uu,vv,fovy:base.fov/base.a};
 }
 function project(point,cam){
  const d=point.map((v,i)=>v-cam.eye[i]);const z=dot(d,cam.ww);
  if(z<=0)return null;
  return [.5+dot(d,cam.uu)/z/cam.fov,.5-dot(d,cam.vv)/z/cam.fovy];
 }
 window.DeskCamera={at,project};
})();
