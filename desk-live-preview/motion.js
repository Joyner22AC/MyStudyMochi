/* Continuous critically damped scalar; targets may change at any instant. */
export class ViewMotion {
 constructor(value=0,omega=9){this.position=value;this.velocity=0;this.target=value;this.omega=omega;}
 setTarget(value){this.target=Math.max(0,Math.min(1,value));}
 step(dt){
  if(!Number.isFinite(dt)||dt<=0)return this.position;
  const x=this.position-this.target,c=this.velocity+this.omega*x,e=Math.exp(-this.omega*dt);
  this.position=this.target+(x+c*dt)*e;
  this.velocity=(this.velocity-this.omega*c*dt)*e;
  if(this.position<0){this.position=0;this.velocity=Math.max(0,this.velocity);}
  if(this.position>1){this.position=1;this.velocity=Math.min(0,this.velocity);}
  if(Math.abs(this.position-this.target)<.00008&&Math.abs(this.velocity)<.0008){this.position=this.target;this.velocity=0;}
  return this.position;
 }
 get active(){return Math.abs(this.position-this.target)>.00001||Math.abs(this.velocity)>.0001;}
 finish(){this.position=this.target;this.velocity=0;}
}
