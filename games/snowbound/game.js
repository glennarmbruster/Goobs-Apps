import * as T from '../../shared/three.module.min.js';

const $ = id => document.getElementById(id);
const canvas = $('game');
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const lerp = (a,b,t) => a+(b-a)*t;
const STORE = 'goobs.snowbound.v1';
const C=window.SnowCourses;
let save = {bestLaunch:0,bestEndless:0,tokens:0,level:1,courseVersion:3,levelMeters:{},completedThrough:0,levelTwoComplete:false,up:{launch:0,glide:0,rocket:0,steer:0,armor:0}};
try {
  const prior = JSON.parse(localStorage.getItem(STORE)||'null');
  if (prior && typeof prior === 'object') {
    save.bestLaunch = Number(prior.bestLaunch)||0;
    save.bestEndless = Number(prior.bestEndless)||0;
    save.tokens = Math.max(0, Number(prior.tokens)||0);
    save.level = Math.max(1,Math.floor(Number(prior.level)||1));
    if(prior.courseVersion===3){save.levelMeters=prior.levelMeters&&typeof prior.levelMeters==='object'?prior.levelMeters:{};save.completedThrough=Math.max(0,Math.floor(Number(prior.completedThrough)||0));}
    else if(prior.courseVersion===2){save.completedThrough=0;for(let i=0;i<5;i++){if(prior.completed?.[i])save.completedThrough=i+1;if(Number(prior.levelMeters?.[i])>0)save.levelMeters[i]=Number(prior.levelMeters[i]);}if(save.completedThrough>=save.level)save.level=save.completedThrough+1;}
    else {save.completedThrough=prior.levelTwoComplete?2:prior.level>=2?1:0;save.level=Math.max(save.level,save.completedThrough+1);}
    save.levelTwoComplete=save.completedThrough>=2;
    for (const key of Object.keys(save.up)) save.up[key] = clamp(Number(prior.up?.[key])||0,0,12)|0;
  }
} catch {}
const persist = () => { try { localStorage.setItem(STORE,JSON.stringify(save)); } catch {} };
let soundOn = true;
try { soundOn = localStorage.getItem('goobs.snowbound.sound') !== 'off'; } catch {}
let audio;
function tone(f,d=.13,type='sine',gain=.09) {
  if (!soundOn) return;
  try {
    audio ||= new (window.AudioContext||window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    const o=audio.createOscillator(), g=audio.createGain(), t=audio.currentTime;
    o.type=type; o.frequency.setValueAtTime(f,t); o.frequency.exponentialRampToValueAtTime(Math.max(70,f*.64),t+d);
    g.gain.setValueAtTime(.001,t); g.gain.exponentialRampToValueAtTime(gain,t+.015); g.gain.exponentialRampToValueAtTime(.001,t+d);
    o.connect(g); g.connect(audio.destination); o.start(t); o.stop(t+d+.02);
  } catch {}
}
let scene,camera,renderer,rider,wings,flames,engineSingle,engineDual,gate,particles,skyGroup;
const chunks=new Map(), objects=[], materials={}, turbines=[], mountains=[];
let mode='launch', phase='menu', beforeHelp='menu', z=4, lateral=0, target=0, speed=0, air=0, vy=0, hearts=3, stars=0, shieldTime=0, surgeTime=0, invuln=0, boostTime=0, boostCharges=1, jumpCooldown=0, hitFlash=0, power=85, pull=null, pointer=false, last=0, clock=0, runId=0, runLevel=1, introT=0;
let worldY=0, verticalSpeed=0, airborneTime=0, totalAir=0, runReward=0, flipAngle=0, flipping=false, finishReason='', hudTimer=0;
let elastic,snowfall,shadow,skiTrail,speedStreaks,trailPoints=[],landingPulse=0,launchPulse=0,lastSection=-1;
let noticeTimer;
function notice(s){$('toast').textContent=s;$('toast').classList.add('show');clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('toast').classList.remove('show'),1450)}
function rng(n){const v=Math.sin(n*127.1+64.7)*43758.5453;return v-Math.floor(v)}
// Broad, banked terrain: long drops feed speed into rounded launch crests.
function course(){return C.get(runLevel)}
function center(q){const c=course(),bend=c.bend;return c.mirror*(Math.sin(q*bend)*(8.5+c.index*.3)+Math.sin(q*bend*2.1)*3.5)}
function base(q){const c=course();return 24-q*.045+13*Math.cos(q*Math.PI/c.span)+3*Math.cos(q*Math.PI/(65-c.index*.5))}
function slope(q){return base(q+.5)-base(q-.5)}
function bridgeAt(q){const k=Math.floor(q/88),t=q-k*88;return C.plan(runLevel,k).kind==='B'&&t>=18&&t<=70}
function gapAt(q){const k=Math.floor(q/88),t=q-k*88;return C.plan(runLevel,k).kind==='G'&&t>=40&&t<=56}
function ground(q,offset=0){const edge=Math.max(0,Math.abs(offset)-9),bank=Math.min(edge,7);let y=base(q)+bank*bank*.095+Math.max(0,edge-7)*.015;
 if(bridgeAt(q)&&Math.abs(offset)>6)y=base(q)-4;
 if(gapAt(q)&&Math.abs(offset)<14)y=base(q)-12;
 return y;
}
function meters(){return Math.max(0,(z-4)*4)}
function scenicTheme(q){const baseTheme=course().theme,chapter=Math.floor(Math.max(0,q)/440)%4;return chapter===0?baseTheme:[baseTheme,2,4,baseTheme===5?5:3][chapter]}
function section(q){return Math.floor(Math.max(0,q)/310)%3}
function readyForCourse(){return Object.entries(course().needs).every(([key,n])=>save.up[key]>=n)}
function requirements(level){return Object.entries(C.get(level).needs).map(([key,n])=>({launch:'Slingshot',glide:'Wings',rocket:'Rocket',steer:'Steering',armor:'Armor'}[key])+' '+n+(save.up[key]>=n?' ✓':'')).join(' · ')}
function mat(color,opts={}){return new T.MeshStandardMaterial({color,roughness:.73,metalness:.02,...opts})}
function box(w,h,d,m){return new T.Mesh(new T.BoxGeometry(w,h,d),m)}
function ball(r,m,segments=14){return new T.Mesh(new T.SphereGeometry(r,segments,10),m)}
function tube(a,b,r,m,parent){const va=new T.Vector3(...a),vb=new T.Vector3(...b),dir=vb.clone().sub(va);const mesh=new T.Mesh(new T.CylinderGeometry(r,r,dir.length(),8),m);mesh.position.copy(va.add(vb).multiplyScalar(.5));mesh.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),dir.normalize());parent.add(mesh);return mesh}
function put(parent,mesh,x,y,z,scale=1){mesh.position.set(x,y,z);mesh.scale.setScalar(scale);parent.add(mesh);return mesh}
function pine(parent,x,z,s=1){const y=ground(z,x-center(z));const g=new T.Group();g.position.set(x,y,z);g.scale.setScalar(s);g.rotation.y=rng(x+z)*1.6;parent.add(g);
  put(g,new T.Mesh(new T.CylinderGeometry(.18,.27,1.85,8),materials.wood),0,.87,0);
  const profile=[[0,.2],[1.34,.42],[1.12,.66],[.63,.86],[1.14,.98],[.94,1.2],[.51,1.42],[.96,1.54],[.76,1.79],[.38,1.99],[.72,2.14],[.52,2.47],[.27,2.72],[.43,2.8],[.18,3.1],[0,3.45]].map(v=>new T.Vector2(...v));
  const foliage=put(g,new T.Mesh(new T.LatheGeometry(profile,16),scenicTheme(z)===2?(rng(x*.2+z)>.5?materials.pineViolet:materials.pineBlue):(rng(x*.2+z)>.5?materials.pine2:materials.pine)),0,.55,0);
  foliage.rotation.z=(rng(x+z*3)-.5)*.045;
  for(const [r,yy] of [[1.34,.42],[1.14,.98],[.96,1.54],[.72,2.14],[.43,2.8]]){
    const snowProfile=[[r*.62,0],[r*.93,.03],[r, .12],[r*.78,.26]].map(v=>new T.Vector2(...v));
    put(g,new T.Mesh(new T.LatheGeometry(snowProfile,16),materials.snow),0,yy+.55,0);
  }
  for(let k=0;k<5;k++){const a=k*2.4,h=1+k*.46;const tuft=put(g,ball(.24,materials.snow,8),Math.cos(a)*(.95-k*.13),h,Math.sin(a)*(.95-k*.13));tuft.scale.set(1.7,.55,1);}
  const tip=put(g,new T.Mesh(new T.ConeGeometry(.21,.52,9),materials.snow),0,3.82,0);tip.rotation.z=foliage.rotation.z;
  return g
}
function frostTexture(snow=false){const size=128,pixels=new Uint8Array(size*size*4);for(let y=0;y<size;y++)for(let x=0;x<size;x++){const i=(y*size+x)*4,grain=rng(x*3+y*131),ripple=Math.sin(y*.11+Math.sin(x*.08)*2)*.5+.5;let v=snow?241+grain*14:213+grain*16+ripple*17;const seam=Math.abs(Math.sin(x*.075+Math.sin(y*.083)*1.7));if(!snow&&seam<.025)v=254;pixels[i]=Math.min(255,v);pixels[i+1]=Math.min(255,v+(!snow?5:0));pixels[i+2]=255;pixels[i+3]=255;}const texture=new T.DataTexture(pixels,size,size,T.RGBAFormat);texture.wrapS=texture.wrapT=T.RepeatWrapping;texture.magFilter=T.LinearFilter;texture.minFilter=T.LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.colorSpace=T.SRGBColorSpace;texture.needsUpdate=true;return texture;}
function makeMesh(start,len,track=false){const offsets=track?[-14,-12,-9,0,9,12,14]:[-55,-38,-24,-15,-9,-6,0,6,9,15,24,38,55],steps=Math.ceil(len/2),v=[],colors=[],uv=[],idx=[];
  const palette=course().theme===2?(track?['#e4edff','#a3d3fa','#d9e9ff','#eff8ff','#d9e9ff','#a3d3fa','#e4edff']:['#b9d3f5','#c9dff7','#dceafb','#f8fcff','#dceefb','#dceefb','#e5f3ff','#dceefb','#dceefb','#f8fcff','#dceafb','#c9dff7','#b9d3f5']):(track?['#f9ffff','#b8e9ff','#69badf','#95d3ec','#69badf','#b8e9ff','#f9ffff']:['#b6e4ef','#d3f1f5','#ecfcfc','#ffffff','#e8fafb','#dff5f7','#f0ffff','#dff5f7','#e8fafb','#ffffff','#ecfcfc','#d3f1f5','#b6e4ef']);
  for(let i=0;i<=steps;i++){let zz=start+len*i/steps;for(let j=0;j<offsets.length;j++){const off=offsets[j]*(track?(.9+.07*Math.sin(zz*.031)):1);uv.push(off/19,zz/36);v.push(center(zz)+off,ground(zz,off)+(track?.08:0),zz);const c=new T.Color(palette[j]);if(track){c.lerp(new T.Color(course().ice),.4);const gleam=.09+.07*Math.sin(zz*.12+off*.7)+.035*Math.sin(zz*.43-off*.9);c.lerp(new T.Color('#ffffff'),gleam);if(Math.abs(off)>11)c.lerp(new T.Color('#ffffff'),.5);}colors.push(c.r,c.g,c.b)}}
  for(let i=0;i<steps;i++)for(let j=0;j<offsets.length-1;j++){const a=i*offsets.length+j,b=a+1,c=a+offsets.length,d=c+1;idx.push(a,c,b,b,c,d)}
  const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(v,3));geo.setAttribute('color',new T.Float32BufferAttribute(colors,3));geo.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geo.setIndex(idx);geo.computeVertexNormals();return new T.Mesh(geo,track?materials.track:materials.terrain)
}
function trailMarks(start,len){const v=[];function line(x1,q1,x2,q2){v.push(center(q1)+x1,ground(q1,x1)+.16,q1,center(q2)+x2,ground(q2,x2)+.16,q2)}for(let q=start;q<start+len;q+=9){const x=(rng(q+7)-.5)*17;line(x,q,x+2,q+3);line(x+2,q+3,x-.8,q+7);line(x+2,q+3,x+5,q+5);line(x-.8,q+7,x-4,q+8)}const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(v,3));return new T.LineSegments(geo,materials.trail)}
function createRamp(group,x,q){const g=new T.Group();g.position.set(x,ground(q,x-center(q)),q);group.add(g);const deck=box(6.3,.42,4.7,materials.ramp);deck.rotation.x=-.17;put(g,deck,0,.48,0);for(let k=-1;k<=1;k++){const stripe=box(.52,.04,4.2,materials.rampStripe);stripe.rotation.x=-.17;put(g,stripe,k*1.9,.76,0)}const flag=box(6.7,.32,.2,materials.rampStripe);put(g,flag,0,.52,-2.3);return g}
function createRock(group,x,q){const y=ground(q,x-center(q));const rock=put(group,new T.Mesh(new T.DodecahedronGeometry(1.1,0),materials.rock),x,y+.7,q);rock.scale.set(1.15,.75,1);return rock}
function createStar(group,x,q,power){const y=ground(q,x-center(q));const g=new T.Group();g.position.set(x,y+1.22,q);group.add(g);
  const outline=new T.Shape();for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,r=i%2?.47:1.03,px=Math.cos(a)*r,py=Math.sin(a)*r;i?outline.lineTo(px,py):outline.moveTo(px,py)}outline.closePath();
  const color=power==='shield'?materials.starBlue:power==='surge'?materials.starPink:materials.starGold;
  const gem=new T.Mesh(new T.ExtrudeGeometry(outline,{depth:.24,bevelEnabled:true,bevelSize:.1,bevelThickness:.08,bevelSegments:2,steps:1}),color);g.add(gem);
  const ring=new T.Mesh(new T.TorusGeometry(1.24,.055,5,24),materials.starRing);g.add(ring);g.userData.spin=true;g.userData.dynamic=true;return g
}
function lodge(group,x,q,roofColor){const y=ground(q,x-center(q));const g=new T.Group();g.position.set(x,y,q);g.rotation.y=.25;group.add(g);
  put(g,box(6,3.2,5,materials.cabin),0,1.6,0);const roof=new T.Mesh(new T.ConeGeometry(4.55,2.8,4),roofColor);roof.rotation.y=Math.PI/4;put(g,roof,0,4.27,0);
  for(const face of [-1,1]){for(const side of [-1,1]){put(g,box(1.12,1.05,.12,materials.window),side*1.65,2.05,face*2.56);put(g,box(1.3,.12,.22,materials.white),side*1.65,2.64,face*2.59);put(g,box(.08,1.1,.16,materials.wood),side*1.65,2.05,face*2.64);put(g,box(1.15,.08,.16,materials.wood),side*1.65,2.05,face*2.64);}
  put(g,box(1.2,2,.13,materials.door),0,1,face*2.59);put(g,ball(.07,materials.gold,8),.4,1.05,face*2.7);put(g,box(1.7,.22,.7,materials.snow),0,.1,face*2.8);}
  const cap=new T.Mesh(new T.ConeGeometry(4.64,2.8,4),materials.snow);cap.rotation.y=Math.PI/4;put(g,cap,0,4.49,0);for(const side of [-1,1])put(g,box(6.35,.2,.28,roofColor),0,3.19,side*2.53);
  put(g,box(.65,1.35,.65,materials.wood),1.6,5.15,-.9);put(g,box(.9,.22,.9,materials.snow),1.6,5.86,-.9);return g
}
function igloo(g,x,q){const y=ground(q,x-center(q));const dome=new T.Mesh(new T.SphereGeometry(3.2,20,12,0,Math.PI*2,0,Math.PI/2),materials.snow);put(g,dome,x,y,q);for(let row=1;row<4;row++){const h=row*.68,r=Math.sqrt(3.2*3.2-h*h);const ring=new T.Mesh(new T.TorusGeometry(r,.035,4,32),materials.ice);ring.rotation.x=Math.PI/2;put(g,ring,x,y+h,q);}const door=put(g,ball(1,materials.dark),x,y+.8,q-2.95);door.scale.set(.8,1.15,.3);const rim=new T.Mesh(new T.TorusGeometry(.92,.24,6,18,Math.PI),materials.snow);put(g,rim,x,y+.7,q-3.1);}
function snowman(g,x,q){const y=ground(q,x-center(q));for(const [r,h] of [[.95,.85],[.72,2],[.52,3.05]])put(g,ball(r,materials.snow),x,y+h,q);put(g,new T.Mesh(new T.CylinderGeometry(.54,.54,.7,12),materials.dark),x,y+3.7,q);put(g,new T.Mesh(new T.CylinderGeometry(.73,.73,.12,12),materials.dark),x,y+3.35,q);const scarf=new T.Mesh(new T.TorusGeometry(.49,.12,6,18),materials.hot);scarf.rotation.x=Math.PI/2;put(g,scarf,x,y+2.68,q);for(const side of [-1,1]){tube([x+side*.5,y+2.1,q],[x+side*1.5,y+2.7,q],.07,materials.wood,g);put(g,ball(.07,materials.dark,8),x+side*.19,y+3.12,q-.47);}const nose=new T.Mesh(new T.ConeGeometry(.13,.5,8),materials.rampStripe);nose.rotation.x=-Math.PI/2;put(g,nose,x,y+2.95,q-.6);for(let j=0;j<3;j++)put(g,ball(.08,materials.dark,8),x,y+1.7+j*.28,q-.69);}
function snowGarden(g,start,theme){for(const side of [-1,1]){for(let j=0;j<3;j++){const q=start+17+j*24,x=center(q)+side*(19+rng(q)*6),mound=put(g,ball(1,materials.snow,12),x,ground(q,x-center(q))-.3,q);mound.scale.set(2.7+rng(q+2)*2.4,.7+rng(q+5)*.5,3.8);}
 if(theme===2&&Math.floor(start/88)%3===0)igloo(g,center(start+45)+side*25,start+45);
 if(theme===1&&Math.floor(start/88)%3===1)snowman(g,center(start+20)+side*19,start+20);
 if(theme===5){for(let j=0;j<4;j++){const q=start+8+j*19;put(g,ball(.8,materials.pink,12),center(q)+side*18,ground(q,side*18)+.6,q);}}
 }}

function flagPole(group,x,q,color){const y=ground(q,x-center(q));const g=new T.Group();g.position.set(x,y,q);group.add(g);tube([0,0,0],[0,4.1,0],.09,materials.chrome,g);const shape=new T.Shape();shape.moveTo(0,0);shape.lineTo(2.2,-.35);shape.lineTo(0,-.85);shape.closePath();const flag=new T.Mesh(new T.ShapeGeometry(shape),color);flag.position.y=3.85;flag.material.side=T.DoubleSide;g.add(flag);return g}
function iceSpire(group,x,q,s=1){const y=ground(q,x-center(q));const g=new T.Group();g.position.set(x,y,q);group.add(g);for(let k=0;k<3;k++){const shard=new T.Mesh(new T.ConeGeometry((.6+k*.15)*s,(2.2+k*.5)*s,5),materials.ice);shard.position.set((k-1)*.65*s,(1.1+k*.25)*s,(k-1)*.4*s);shard.rotation.z=(k-1)*.16;g.add(shard)}return g}
function turbine(group,x,q){const y=ground(q,x-center(q));const g=new T.Group();g.position.set(x,y,q);group.add(g);tube([0,0,0],[0,17,0],.36,materials.white,g);const hub=put(g,ball(.65,materials.chrome),0,17,0);const rotor=new T.Group();rotor.position.set(0,17,.65);g.add(rotor);for(let k=0;k<3;k++){const arm=box(.48,6.4,.17,materials.white);arm.position.set(0,3.5,0);const blade=new T.Group();blade.rotation.z=k*Math.PI*2/3;blade.add(arm);rotor.add(blade)}g.userData.dynamic=true;turbines.push({rotor,group});return g}
function batchScenery(group){
 group.updateMatrixWorld(true);const batches=new Map(),remove=[];
 group.traverse(o=>{if(!o.isMesh||Array.isArray(o.material))return;for(let n=o;n&&n!==group;n=n.parent)if(n.userData.dynamic)return;
  let b=batches.get(o.material);if(!b){b={p:[],n:[],c:[],uv:[]};batches.set(o.material,b)}
  const geo=o.geometry,ps=geo.attributes.position,ns=geo.attributes.normal,cs=geo.attributes.color,us=geo.attributes.uv,ind=geo.index,normalMatrix=new T.Matrix3().getNormalMatrix(o.matrixWorld),v=new T.Vector3();
  const count=ind?ind.count:ps.count;
  for(let k=0;k<count;k++){const i=ind?ind.getX(k):k;v.fromBufferAttribute(ps,i).applyMatrix4(o.matrixWorld);b.p.push(v.x,v.y,v.z);if(ns)v.fromBufferAttribute(ns,i).applyMatrix3(normalMatrix).normalize();else v.set(0,1,0);b.n.push(v.x,v.y,v.z);b.uv.push(us?us.getX(i):0,us?us.getY(i):0);if(cs)b.c.push(cs.getX(i),cs.getY(i),cs.getZ(i));else b.c.push(1,1,1);}
  remove.push(o);
 });
 for(const o of remove){o.parent.remove(o);o.geometry.dispose()}
 for(const [material,b] of batches){const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(b.p,3));geo.setAttribute('normal',new T.Float32BufferAttribute(b.n,3));geo.setAttribute('uv',new T.Float32BufferAttribute(b.uv,2));if(material.vertexColors)geo.setAttribute('color',new T.Float32BufferAttribute(b.c,3));geo.computeBoundingSphere();group.add(new T.Mesh(geo,material));}
}
function snowArch(group,q){const cx=center(q),y=base(q);for(const side of [-1,1]){const rock=put(group,new T.Mesh(new T.DodecahedronGeometry(1,0),materials.rock),cx+side*17,y+9,q);rock.scale.set(5,13,8);put(group,new T.Mesh(new T.ConeGeometry(6,8,5),materials.snow),cx+side*17,y+23,q);}
 const arch=new T.Mesh(new T.TorusGeometry(17,2.1,5,18,Math.PI),materials.ice);arch.position.set(cx,y+8,q);group.add(arch);
}
function castle(g,x,q){const y=ground(q,x-center(q));put(g,box(9,6,5,materials.cabin),x,y+3,q);for(const side of [-1,1]){const tx=x+side*6;put(g,new T.Mesh(new T.CylinderGeometry(2.4,2.8,11,8),materials.cabin),tx,y+5.5,q);put(g,new T.Mesh(new T.ConeGeometry(3.5,5,8),materials.roofPurple),tx,y+13,q);for(let row=1;row<5;row++)put(g,new T.Mesh(new T.CylinderGeometry(2.55,2.55,.18,8),materials.cream),tx,y+row*2.1,q);for(const h of [3.2,7.3]){put(g,box(.7,1.6,.15,materials.window),tx,y+h,q-2.7);put(g,box(.9,.18,.3,materials.cream),tx,y+h-.85,q-2.8);}}
 for(let k=-3;k<=3;k++){put(g,box(.75,.9,5.3,materials.cream),x+k*1.3,y+6.4,q);}put(g,box(2.5,4,.2,materials.door),x,y+2,q-2.6);for(const side of [-1,1])flagPole(g,x+side*6,q,materials.flagCoral);
}
function crystalTree(g,x,q,size){const y=ground(q,x-center(q));tube([x,y,q],[x,y+4*size,q],.22,materials.gold,g);for(const side of [-1,1]){tube([x,y+2*size,q],[x+side*1.5*size,y+3.5*size,q],.13,materials.gold,g);const orb=put(g,new T.Mesh(new T.IcosahedronGeometry(1.8*size,1),materials.crystalBlue),x+side*1.4*size,y+4.5*size,q);put(g,new T.Mesh(new T.IcosahedronGeometry(.6*size,0),materials.starPink),x+side*2.3*size,y+3.3*size,q);}}
function frostTree(g,x,q,size){const y=ground(q,x-center(q));tube([x,y,q],[x,y+5*size,q],.25,materials.wood,g);for(const side of [-1,1]){tube([x,y+2*size,q],[x+side*1.8*size,y+4.8*size,q],.15,materials.wood,g);const crown=put(g,ball(1.7,materials.pink,10),x+side*1.5*size,y+5*size,q);crown.scale.set(size,size*.8,size);put(g,ball(1.1,materials.snow,10),x+side*1.5*size,y+5.8*size,q);}}
function lighthouse(g,x,q){const y=ground(q,x-center(q));for(let k=0;k<4;k++)put(g,new T.Mesh(new T.CylinderGeometry(1.8-k*.18,2.05-k*.18,2.4,12),k%2?materials.white:materials.hot),x,y+1.2+k*2.4,q);put(g,new T.Mesh(new T.CylinderGeometry(1.7,1.7,1.6,12),materials.glass),x,y+10.2,q);put(g,new T.Mesh(new T.ConeGeometry(2.4,1.7,12),materials.roofCoral),x,y+11.8,q);}
function barricade(g,q,safe){const gap=course().gapHalf;const cx=center(q),y=base(q);for(const side of [-1,1]){const left=side<0?-13:safe+gap,right=side<0?safe-gap:13;if(right-left<.2)continue;const width=right-left,mid=(left+right)/2;
 put(g,box(width,1.15,.65,materials.hot),cx+mid,y+1.25,q);put(g,box(width,.18,.71,materials.white),cx+mid,y+1.55,q);for(const x of [left+.3,right-.3])tube([cx+x,y,q],[cx+x,y+2,q],.12,materials.chrome,g);objects.push({q,x:cx+mid,type:'barrier',width:width/2+1,used:false,group:g});}
 for(const side of [-1,1])flagPole(g,cx+safe+side*gap,q,materials.flagGold);
}
function bridge(g,start){for(let q=start+18;q<=start+70;q+=2.6){put(g,box(course().bridgeHalf*2,.3,2.45,materials.wood),center(q),base(q)+.2,q);for(const side of [-1,1]){tube([center(q)+side*course().bridgeHalf,base(q)+.2,q],[center(q)+side*course().bridgeHalf,base(q)+2,q],.12,materials.wood,g);if(q<start+68)tube([center(q)+side*course().bridgeHalf,base(q)+1.7,q],[center(q+2.6)+side*course().bridgeHalf,base(q+2.6)+1.7,q+2.6],.1,materials.gold,g);}}
 const q=start+44,riverVerts=[],riverIndex=[];for(let row=0;row<=26;row++){const rq=start+18+row*2;for(const side of [-1,1])riverVerts.push(center(rq)+side*45,base(rq)-3.2,rq);if(row<26){const a=row*2;riverIndex.push(a,a+2,a+1,a+1,a+2,a+3)}}const river=new T.BufferGeometry();river.setAttribute('position',new T.Float32BufferAttribute(riverVerts,3));river.setIndex(riverIndex);river.computeVertexNormals();g.add(new T.Mesh(river,materials.harbor));
 for(const side of [-1,1]){const bx=center(q)+side*23,by=base(q)-2.5;const hull=put(g,ball(1,materials.hot),bx,by,q);hull.scale.set(2.5,.65,5);put(g,box(2.5,1.7,2.5,materials.white),bx,by+1,q);put(g,box(2.7,.25,2.8,materials.roofPurple),bx,by+2,q);tube([bx,by,bx*0+q],[bx,by+5,q],.1,materials.chrome,g);put(g,ball(.4,materials.gold),bx,by+5,q);}

}
function snowplow(parent,q){const g=new T.Group();g.userData.dynamic=true;g.position.set(center(q),base(q),q);g.rotation.y=Math.PI/2;parent.add(g);put(g,box(2.8,.8,4.1,materials.hot),0,1,0);put(g,box(2.3,1.5,1.9,materials.jacket),0,2,-.6);put(g,box(2.1,.8,.1,materials.glass),0,2.25,.4);for(const side of [-1,1])for(const z of [-1.3,1.3]){const wheel=new T.Mesh(new T.CylinderGeometry(.65,.65,.45,10),materials.dark);wheel.rotation.z=Math.PI/2;put(g,wheel,side*1.5,.65,z);}const blade=put(g,box(4.5,1.3,.4,materials.gold),0,.7,2.4);blade.rotation.x=-.25;put(g,ball(.3,materials.starGold),0,3.05,-.6);objects.push({q,x:center(q),type:'plow',width:2.8,visual:g,used:false,group:parent});}
function createChunk(i){const g=new T.Group(),start=i*88,plan=C.plan(runLevel,i),theme=scenicTheme(start+44);g.add(makeMesh(start,88));g.add(makeMesh(start,88,true));g.add(trailMarks(start,88));scene.add(g);
  for(let k=0;k<6;k++){const q=start+3+k*14.2;for(const side of [-1,1]){const n=i*140+k*7+(side+1)+course().cycle*173;const x=center(q)+side*(20+rng(n)*17);theme===4?(k%2?crystalTree(g,x,q,1.3+rng(n+4)*.6):iceSpire(g,x,q,1.2+rng(n+4)*.6)):theme===5?frostTree(g,x,q,1.2+rng(n+4)*.6):pine(g,x,q,1.65+rng(n+4)*1.15);if(rng(n+10)>.9&&theme<4)pine(g,x+side*3,q+4,.55+rng(n+5)*.6);if((theme===2||theme===4)&&k===3&&i>0)iceSpire(g,center(q)+side*19.8,q,.8+rng(n+11)*.9)}}
  if(i>0){for(const side of [-1,1])flagPole(g,center(start+13)+side*16.9,start+13,theme===2?(side>0?materials.flagGold:materials.flagViolet):(side>0?materials.flagCoral:materials.flagGold))}
  if(theme<=3&&i>0&&(theme===2?i%3===0:i%2===0))lodge(g,center(start+39)+(i%4===0?1:-1)*30,start+39,theme===2?materials.roofPurple:(i%4===0?materials.roofCoral:materials.roofGold));
  if(i>0&&i%5===0)turbine(g,center(start+50)+35,start+50);
  if(i>=1){
    const lane=(plan.kind==='B'||plan.kind==='G')?0:plan.lane||0;
    // Quiet chunks reserve the whole approach and landing area, including optional ramps.
    if(plan.kind==='R'&&!plan.quiet&&C.hash(runLevel*13+i)>.62){const q=start+44,x=center(q)+lane;createRamp(g,x,q);objects.push({q,x,type:'ramp',used:false,group:g});}
    for(let j=0;j<3;j++){const cq=start+7+j*3,cx=center(cq)+lane,power=j===2&&i%4===0?'boost':'coin',visual=createStar(g,cx,cq,power);visual.scale.setScalar(.6);objects.push({q:cq,x:cx,type:'star',power,visual,used:false,group:g})}
    if(theme===5&&i%2===0)castle(g,center(start+40)+(i%4?1:-1)*29,start+40);
  }
  if(plan.kind==='S')barricade(g,start+55,plan.safe);
  if(plan.kind==='C'){barricade(g,start+20,plan.safe);barricade(g,start+72,-plan.safe);}
  if(plan.kind==='B'){bridge(g,start);for(const side of [-1,1])flagPole(g,center(start+16)+side*6,start+16,materials.flagCoral);}
  if(plan.kind==='G'){createRamp(g,center(start+29),start+29);objects.push({q:start+29,x:center(start+29),type:'ramp',used:false,group:g});}
  if(plan.kind==='P')snowplow(g,start+36);
  if(theme===3&&i>0&&i%3===1)lighthouse(g,center(start+30)+(i%2?1:-1)*25,start+30);
  const end=4+course().target/4;
  if(end>=start&&end<start+88){const cx=center(end),yy=ground(end,0);for(const side of [-1,1])tube([cx+side*13,yy,end],[cx+side*13,yy+12,end],.25,materials.hot,g);for(let k=0;k<18;k++)for(let j=0;j<2;j++)put(g,box(26/18,1.3,.18,(k+j)%2?materials.white:materials.dark),cx-13+(k+.5)*26/18,yy+11+j*1.3,end);}
  if(theme===4&&i>0&&i%7===3)snowArch(g,start+60);
  snowGarden(g,start,theme);batchScenery(g);chunks.set(i,g)
}
function maintainChunks(){const first=Math.max(-1,Math.floor(z/88)-1),lastChunk=Math.floor(z/88)+8;for(let i=first;i<=lastChunk;i++)if(!chunks.has(i))createChunk(i);for(const [i,g] of chunks){if(i<first||i>lastChunk){scene.remove(g);g.traverse(o=>{if(o.geometry)o.geometry.dispose()});chunks.delete(i)}}for(let i=objects.length-1;i>=0;i--)if(!chunks.has(Math.floor(objects[i].q/88)))objects.splice(i,1);for(let i=turbines.length-1;i>=0;i--)if(!turbines[i].group.parent)turbines.splice(i,1)}
function createGate(){const g=new T.Group();scene.add(g);g.position.set(center(7),ground(7,0),7);for(const s of [-1,1]){tube([s*4.4,0,0],[s*4.4,5.2,0],.35,materials.hot,g);put(g,ball(.52,materials.pink),s*4.4,5.1,0);tube([s*4.4,5,0],[s*4.4,3.3,-1.2],.15,materials.white,g)}tube([-4.4,4.45,0],[4.4,4.45,0],.13,materials.pink,g);const arch=box(8.8,.4,.4,materials.white);put(g,arch,0,5.7,0);for(let k=-3;k<=3;k++){let flag=new T.Mesh(new T.ConeGeometry(.38,.9,3),k%2?materials.gold:materials.hot);flag.rotation.z=Math.PI;put(g,flag,k*1.1,5.15,0)}return g}
function makeRider(){
  const g=new T.Group(),sled=new T.Group();g.add(sled);
  const hullGeo=new T.BoxGeometry(2.55,.36,3.85);const v=hullGeo.attributes.position;
  for(let i=0;i<v.count;i++){const zz=v.getZ(i);if(zz>.6)v.setX(i,v.getX(i)*(1-.19*(zz-.6)));if(zz>1.4)v.setY(i,v.getY(i)+.09)}v.needsUpdate=true;hullGeo.computeVertexNormals();
  put(sled,new T.Mesh(hullGeo,materials.red),0,.39,0);
  const nose=put(sled,ball(1,materials.red),0,.43,1.66);nose.scale.set(.96,.19,.49);
  put(sled,box(1.8,.055,2.65,materials.sledPanel),0,.61,.12);
  for(const side of [-1,1]){
    tube([side*1.03,.12,-1.85],[side*1.03,.12,1.82],.12,materials.chrome,sled);
    tube([side*1.03,.12,1.82],[side*.77,.53,2.16],.11,materials.chrome,sled);
    const trim=box(.11,.07,2.65,materials.gold);put(sled,trim,side*1.12,.61,.08);
    const light=box(.32,.11,.13,materials.headlamp);put(sled,light,side*.68,.55,1.95)
  }
  const seat=put(sled,box(1.55,.18,1.4,materials.dark),0,.74,-.38);seat.rotation.x=.07;
  const windshield=new T.Mesh(new T.SphereGeometry(.85,16,8,0,Math.PI*2,0,Math.PI*.55),materials.glass);windshield.scale.set(1,.58,.42);put(sled,windshield,0,.95,1.03);
  tube([-1.0,1.05,.78],[1.0,1.05,.78],.07,materials.chrome,sled);
  const jacket=put(g,ball(.88,materials.jacket),0,1.28,-.36);jacket.scale.set(.77,1.07,.73);
  const belly=put(g,ball(.64,materials.white),0,1.11,.25);belly.scale.set(.8,1.03,.43);
  const head=put(g,ball(.72,materials.fox,18),0,2.28,-.03);head.scale.set(1,.85,.9);
  for(const side of [-1,1]){
    const ear=new T.Mesh(new T.ConeGeometry(.3,.68,8),materials.fox);put(g,ear,side*.47,2.95,-.15);
    const inner=new T.Mesh(new T.ConeGeometry(.15,.37,8),materials.pink);put(g,inner,side*.47,2.92,.08);
    put(g,ball(.105,materials.dark),side*.32,2.34,.62);
    const glove=put(g,ball(.27,materials.fox),side*.72,1.48,.4);glove.scale.set(.8,1.2,.8);
    tube([side*.7,1.3,.48],[side*.62,.97,.95],.13,materials.jacket,g)
  }
  const muzzle=put(g,ball(.29,materials.white),0,2.15,.58);muzzle.scale.set(1.25,.57,.8);
  put(g,ball(.13,materials.dark),0,2.23,.81);
  const scarf=put(g,new T.Mesh(new T.TorusGeometry(.54,.14,8,24),materials.gold),0,1.86,.03);scarf.rotation.x=Math.PI/2;
  const scarfTail=box(.37,.08,1.45,materials.gold);put(g,scarfTail,-.35,1.86,-1.1);scarfTail.rotation.y=-.3;
  const tail=put(g,ball(.48,materials.fox),0,.98,-.96);tail.scale.set(.68,.7,1.46);put(g,ball(.28,materials.white),0,1,-1.6);
  const wingL=new T.Group(),wingR=new T.Group();for(const [side,wing] of [[-1,wingL],[1,wingR]]){
    wing.position.set(side*1.18,.56,-.35);
    const outline=new T.Shape();outline.moveTo(0,.7);outline.lineTo(side*2.3,.1);outline.lineTo(side*2.2,-.55);outline.lineTo(0,-.8);outline.closePath();const plate=new T.Mesh(new T.ExtrudeGeometry(outline,{depth:.12,bevelEnabled:true,bevelSize:.07,bevelThickness:.04,bevelSegments:2,steps:1}),materials.wing);plate.rotation.x=Math.PI/2;wing.add(plate);const fin=box(.1,.45,.72,materials.gold);put(wing,fin,side*2.15,.17,.15);
    put(wing,box(1.56,.05,.18,materials.gold),side*.72,.08,.52);g.add(wing)
  }
  function thruster(parent,x){const unit=new T.Group();unit.position.set(x,.55,-1.68);parent.add(unit);
    const motor=new T.Mesh(new T.CylinderGeometry(.39,.42,1.04,12),materials.chrome);motor.rotation.x=Math.PI/2;unit.add(motor);
    const ring=new T.Mesh(new T.TorusGeometry(.39,.08,8,16),materials.headlamp);ring.position.z=-.58;unit.add(ring);
    const nozzle=new T.Mesh(new T.CylinderGeometry(.31,.25,.2,12),materials.dark);nozzle.rotation.x=Math.PI/2;nozzle.position.z=-.58;unit.add(nozzle);
    const fire=new T.Mesh(new T.ConeGeometry(.32,1.65,10),materials.flame);fire.rotation.x=-Math.PI/2;fire.position.z=-1.37;unit.add(fire);flames.push(fire)
  }
  flames=[];engineSingle=new T.Group();g.add(engineSingle);thruster(engineSingle,0);
  engineDual=new T.Group();g.add(engineDual);thruster(engineDual,-.82);thruster(engineDual,.82);
  wings=[wingL,wingR];g.userData.sled=sled;scene.add(g);return g
}
function setup(){try{
  renderer=new T.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));renderer.setSize(innerWidth,innerHeight,false);renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.04;
  scene=new T.Scene();scene.background=new T.Color('#91d9f9');scene.fog=new T.Fog('#b3e4f6',240,780);
  camera=new T.PerspectiveCamera(66,innerWidth/innerHeight,.2,900);
  scene.add(new T.HemisphereLight('#e9f8ff','#547a9f',2.1));const sun=new T.DirectionalLight('#fff4df',3.1);sun.position.set(-30,80,70);scene.add(sun);
  Object.assign(materials,{track:new T.MeshStandardMaterial({map:frostTexture(false),vertexColors:true,roughness:.19,metalness:.12,side:T.DoubleSide}),cream:mat('#f0d8aa'),crystalBlue:mat('#299edb',{metalness:.16,roughness:.27}),harbor:mat('#209dcc',{roughness:.22,metalness:.28}),terrain:new T.MeshStandardMaterial({map:frostTexture(true),vertexColors:true,roughness:.9,side:T.DoubleSide}),trail:new T.LineBasicMaterial({color:'#ffffff',transparent:true,opacity:.26}),snow:mat('#f9fdff'),pine:mat('#177e4c'),pine2:mat('#2aac70'),pineBlue:mat('#176f9e'),pineViolet:mat('#7060a8'),wood:mat('#765957'),rock:mat('#879eae'),ice:mat('#91eaff',{metalness:.11,roughness:.25}),white:mat('#ffffff'),ramp:mat('#ffbd31'),rampStripe:mat('#ff7f4f'),hot:mat('#f6638e'),pink:mat('#ff9dc0'),gold:mat('#ffc94d'),red:mat('#eb4750',{roughness:.43}),sledPanel:mat('#ff7253',{roughness:.35}),jacket:mat('#2481a4'),fox:mat('#f6a552'),dark:mat('#173e57'),chrome:mat('#bddce5',{metalness:.67,roughness:.23}),glass:mat('#83e8ef',{transparent:true,opacity:.45,metalness:.2,roughness:.12}),headlamp:new T.MeshBasicMaterial({color:'#93f9ff'}),wing:mat('#39b9d9',{metalness:.3,roughness:.32}),flame:new T.MeshBasicMaterial({color:'#ffb633'}),cabin:mat('#c8855e'),window:new T.MeshBasicMaterial({color:'#ffe58b'}),door:mat('#3d607c'),roofCoral:mat('#ee664e'),roofPurple:mat('#7654bf'),roofGold:mat('#f1aa3d'),flagGold:mat('#ffc850',{side:T.DoubleSide}),flagCoral:mat('#ff724f',{side:T.DoubleSide}),flagViolet:mat('#a171d6',{side:T.DoubleSide}),starGold:mat('#ffd747',{metalness:.24,roughness:.2,emissive:'#ffaf1d',emissiveIntensity:.43,side:T.DoubleSide}),starBlue:mat('#6feaff',{metalness:.24,roughness:.2,emissive:'#2ac4ef',emissiveIntensity:.43,side:T.DoubleSide}),starPink:mat('#ff81c5',{metalness:.24,roughness:.2,emissive:'#ea359c',emissiveIntensity:.43,side:T.DoubleSide}),starRing:new T.MeshBasicMaterial({color:'#ffffff',transparent:true,opacity:.62,side:T.DoubleSide})});
  skyGroup=new T.Group();const sunDisc=new T.Mesh(new T.SphereGeometry(18,16,12),new T.MeshBasicMaterial({color:'#fff0be'}));skyGroup.add(sunDisc);for(let i=0;i<6;i++){const puff=ball(1,new T.MeshBasicMaterial({color:'#effbff',transparent:true,opacity:.75}));puff.scale.set(11+rng(i)*9,2.1+rng(i+4)*2,4);puff.position.set((i-2.5)*25,6+(i%2)*4,-8);skyGroup.add(puff)}scene.add(skyGroup);
  const sprayPositions=new Float32Array(48*3);const sprayGeo=new T.BufferGeometry();sprayGeo.setAttribute('position',new T.BufferAttribute(sprayPositions,3));particles=new T.Points(sprayGeo,new T.PointsMaterial({color:'#faffff',size:.45,transparent:true,opacity:.84,depthWrite:false}));scene.add(particles);
  const snowGeo=new T.BufferGeometry();snowGeo.setAttribute('position',new T.BufferAttribute(new Float32Array(140*3),3));snowfall=new T.Points(snowGeo,new T.PointsMaterial({color:'#ffffff',size:.16,transparent:true,opacity:.7,depthWrite:false}));scene.add(snowfall);
  shadow=new T.Mesh(new T.CircleGeometry(1,24),new T.MeshBasicMaterial({color:'#1c5275',transparent:true,opacity:.22,depthWrite:false}));shadow.rotation.x=-Math.PI/2;scene.add(shadow);
  const trailGeo=new T.BufferGeometry();trailGeo.setAttribute('position',new T.BufferAttribute(new Float32Array(80*12),3));skiTrail=new T.LineSegments(trailGeo,new T.LineBasicMaterial({color:'#599fca',transparent:true,opacity:.34,depthWrite:false}));scene.add(skiTrail);
 const streakGeo=new T.BufferGeometry();streakGeo.setAttribute('position',new T.BufferAttribute(new Float32Array(16*6),3));speedStreaks=new T.LineSegments(streakGeo,new T.LineBasicMaterial({color:'#efffff',transparent:true,opacity:.24,depthWrite:false}));scene.add(speedStreaks);
 gate=createGate();elastic=new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(),new T.Vector3(),new T.Vector3()]),new T.LineBasicMaterial({color:'#ff5476'}));scene.add(elastic);rider=makeRider();applyUpgrades();applyLevelLook();maintainChunks();updateLevelUI();resize();requestAnimationFrame(frame);
} catch(e){console.error(e);$('error').hidden=false}}
function resize(){if(!renderer)return;camera.position.set(center(z)+lateral,ground(z,lateral)+10+air,z-18);renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/innerHeight;camera.fov=innerHeight>innerWidth?73:62;camera.updateProjectionMatrix()}
window.addEventListener('resize',resize);if(window.visualViewport)window.visualViewport.addEventListener('resize',resize);
function applyLevelLook(){const c=course();scene.background.set(c.sky);scene.fog.color.set(c.sky).lerp(new T.Color('#f3fbff'),.4);skyGroup.children[0].material.color.set(c.cycle%2?'#fff3dc':'#fff0be');const hue=(c.cycle%8)*.025;materials.pink.color.setHSL((.91+hue)%1,.65,.73);materials.roofPurple.color.setHSL((.73+hue)%1,.52,.48);materials.crystalBlue.color.setHSL((.55+hue)%1,.73,.48);materials.harbor.color.set(c.ice);}
function updateLevelUI(){const index=save.level-1,c=C.get(save.level),best=Math.floor(save.levelMeters[index]||0);$('levelName').textContent='Level '+save.level+' · '+c.name;$('levelMeters').textContent='Route '+(c.index+1)+'/20 · Tour '+(c.cycle+1)+' · '+c.target.toLocaleString()+' m in one run';$('levelFill').style.width=Math.min(100,best/c.target*100)+'%';$('courseNeeds').textContent='Required sled: '+requirements(save.level);}
function addLevelDistance(distance){if(mode!=='launch')return 'Endless practice · finish a Launch run to advance';const index=runLevel-1,c=course();save.levelMeters[index]=Math.max(save.levelMeters[index]||0,Math.min(distance,c.target));
 if(distance<c.target)return 'Best run '+Math.floor(save.levelMeters[index])+' / '+c.target+' m · distance does not accumulate';
 if(!readyForCourse())return 'Training finish · upgrade your sled to complete this course: '+requirements(runLevel);
 save.completedThrough=Math.max(save.completedThrough,runLevel);save.levelTwoComplete=save.completedThrough>=2;save.level=Math.max(save.level,runLevel+1);
 // Retain recent run records without allowing an endless campaign to grow storage indefinitely.
 for(const key of Object.keys(save.levelMeters))if(Number(key)<save.level-41)delete save.levelMeters[key];
 return 'Level '+runLevel+' clear! '+C.get(save.level).name+' unlocked.';
}
function updateHud(){$('dist').textContent=Math.max(0,Math.floor(meters()))+' m';$('speed').textContent=Math.round(speed*2.237)+' mph';$('stars').textContent='★ '+stars;$('life').textContent=(mode==='endless'?'♥ '+hearts:'Best '+Math.floor(save.bestLaunch)+' m')+(shieldTime>0?' 🛡':'');$('boostCount').textContent=boostCharges;$('courseFill').style.height=Math.min(100,meters()/course().target*100)+'%';$('airtime').textContent=air>1?'AIR TIME '+airborneTime.toFixed(1)+'s':'';$('jump').disabled=air<2||flipping;const status=$('powerup');status.hidden=!(shieldTime>0||surgeTime>0);status.textContent=shieldTime>0?'🛡 SHIELD '+Math.ceil(shieldTime)+'s':'✦ STAR SURGE '+Math.ceil(surgeTime)+'s'}
function display(id){for(const key of ['menu','paused','result','help'])$(key).hidden=key!==id}
function applyUpgrades(){const gl=save.up.glide;wings[0].visible=wings[1].visible=gl>0;engineSingle.visible=save.up.rocket<3;engineDual.visible=save.up.rocket>=3;for(const f of flames)f.visible=false;$('rocketLabel').textContent=save.up.rocket>=3?'Dual Thrusters':'Rocket'}
function reset(m){trailPoints=[];mode=m;phase='ready';z=4;lateral=target=0;speed=air=vy=stars=shieldTime=surgeTime=invuln=boostTime=jumpCooldown=hitFlash=0;hearts=3;boostCharges=1+Math.floor(save.up.rocket/4);introT=0;worldY=ground(4,0);verticalSpeed=0;airborneTime=totalAir=runReward=flipAngle=0;flipping=false;finishReason='';landingPulse=launchPulse=0;lastSection=-1;runId++;runLevel=save.level;worldY=ground(4,0);for(const [i,g] of chunks){scene.remove(g);g.traverse(o=>{if(o.geometry)o.geometry.dispose()})}chunks.clear();objects.length=0;turbines.length=0;applyLevelLook();maintainChunks();applyUpgrades();updateLevelUI();gate.visible=true;display('');$('ready').hidden=false;$('pullGuide').hidden=true;$('readyTitle').textContent='Level '+runLevel+' · '+course().name;$('readyText').textContent=m==='launch'?(readyForCourse()?'Sled ready · reach the finish in one run':'Training run · earn upgrades for this course'):'Practice the route without advancing levels';$('powerBox').hidden=m!=='launch';$('go').textContent=m==='launch'?'Launch':'Start riding';$('pause').hidden=true;$('jump').hidden=true;$('boost').hidden=true;updateHud()}
function begin(){if(phase!=='ready')return;phase='running';launchPulse=1;$('ready').hidden=true;$('pullGuide').hidden=true;$('pause').hidden=false;$('exit').hidden=true;$('jump').hidden=false;$('boost').hidden=false;$('steerHint').hidden=false;speed=mode==='launch'?(57+save.up.launch*3.4)*(.45+power*.0055):55;air=0;worldY=ground(z,lateral);verticalSpeed=slope(z)*speed;gate.visible=true;tone(560,.22,'sawtooth',.11);setTimeout(()=>{if(phase==='running')$('steerHint').hidden=true},3000);last=performance.now()}
function finish(){if(phase!=='running')return;phase='result';$('pause').hidden=true;$('jump').hidden=true;$('boost').hidden=true;$('steerHint').hidden=true;$('powerup').hidden=true;const dist=Math.floor(meters()),key=mode==='launch'?'bestLaunch':'bestEndless',record=dist>save[key];save[key]=Math.max(save[key],dist);if(mode==='launch')save.tokens+=1+Math.floor(stars/12)+Math.floor(totalAir/12);const levelMessage=addLevelDistance(dist);persist();updateLevelUI();$('levelResult').textContent=levelMessage;$('resultLabel').textContent=mode==='launch'?'Launch & Glide':'Endless Ride';$('resultTitle').textContent=levelMessage.includes('clear!')?'Level cleared!':finishReason|| (record?'New best!':'Run complete');$('resultDistance').textContent=dist+' m';$('resultDetail').textContent=(record?'Personal record · ':'')+stars+' stars · '+Math.floor(totalAir)+'s air time · best '+Math.floor(save[key])+' m';$('upgradeBox').hidden=mode!=='launch';refreshUpgrade();display('result');tone(720,.28)}
function refreshUpgrade(){$('upgradePrompt').textContent=save.tokens?'Choose an upgrade · '+save.tokens+' available':'All upgrades used for now';for(const key of Object.keys(save.up)){$(key+'Level').textContent=save.up[key]+'/12';document.querySelector('[data-up="'+key+'"]').disabled=!save.tokens||save.up[key]>=12}}
function upgrade(key){if(!save.tokens||save.up[key]>=12)return;save.tokens--;save.up[key]++;persist();refreshUpgrade();applyUpgrades();notice(key[0].toUpperCase()+key.slice(1)+' upgraded');tone(870,.18)}
function jump(){if(phase!=='running'||air<2||flipping)return;flipping=true;flipAngle=0;tone(510,.14)}
function boost(){if(phase!=='running'||boostCharges<1||boostTime>0)return;boostCharges--;boostTime=1.5+save.up.rocket*.12;speed+=11+save.up.rocket*1.6+(save.up.rocket>=3?5:0);if(air>0)verticalSpeed+=3;notice(save.up.rocket>=3?'Dual thrusters!':'Rocket boost!');tone(210,.45,'sawtooth',.1);updateHud()}
function pause(){if(phase!=='running')return;phase='paused';pointer=false;$('pauseStats').textContent=Math.floor(meters())+' m · '+Math.round(speed*2.237)+' mph';$('jump').hidden=true;$('boost').hidden=true;display('paused')}
function resume(){phase='running';display('');$('jump').hidden=false;$('boost').hidden=false;last=performance.now()}
function back(){phase='menu';$('exit').hidden=false;$('ready').hidden=true;$('pullGuide').hidden=true;$('pause').hidden=true;$('jump').hidden=true;$('boost').hidden=true;$('steerHint').hidden=true;display('menu');updateHud()}
function help(){beforeHelp=phase;display('help')}
function closeHelp(){display(beforeHelp==='menu'?'menu':beforeHelp==='paused'?'paused':beforeHelp==='result'?'result':'')}
function simulate(dt){clock+=dt;hitFlash=Math.max(0,hitFlash-dt*3);if(phase!=='running')return;
 const oldZ=z,oldGround=ground(z,lateral),wasAir=air>.1;
 target=clamp(target,-13,13);lateral=lerp(lateral,target,1-Math.exp(-dt*(air>2?2.9+save.up.steer*.2:4+save.up.steer*.25)));
 const grade=slope(z),drag=air>.1?.48:2.55;
 speed=clamp(speed+(-grade*17-drag-speed*speed*.00016+save.up.glide*.022)*dt,0,100);
 if(mode==='endless')speed=Math.max(speed,43);
 if(boostTime>0){boostTime=Math.max(0,boostTime-dt);speed=Math.min(110,speed+dt*(13+save.up.rocket*.7))}
 z+=speed*dt;const floor=ground(z,lateral);
 if(!wasAir){verticalSpeed=grade*speed;worldY=oldGround;}
 verticalSpeed-=(save.up.glide?9.2-save.up.glide*.27:11)*dt;worldY+=verticalSpeed*dt;
 if(worldY<=floor){worldY=floor;verticalSpeed=slope(z)*speed;
   if(wasAir){landingPulse=Math.min(1,airborneTime/2);if(flipping&&flipAngle<Math.PI*1.85){speed*=.8;notice('Rough landing')}else if(flipping){stars+=3;speed=Math.min(100,speed+4);notice('Clean flip! +3 stars · momentum bonus')}else if(airborneTime>.8){notice('Smooth landing · '+airborneTime.toFixed(1)+'s air')}
   airborneTime=0;flipping=false;flipAngle=0;tone(160,.08,'triangle',.03)}
 }else if(worldY-floor>.1){airborneTime+=dt;totalAir+=dt;}
 air=Math.max(0,worldY-floor);
 if(flipping)flipAngle=Math.min(Math.PI*2,flipAngle+dt*4.8);
 invuln=Math.max(0,invuln-dt);
 for(const o of objects){if(o.type==='plow')o.x=center(o.q)+Math.sin(clock*.7+o.q)*8;if(o.used||o.q>z+2||o.q<oldZ-2)continue;if(Math.abs(o.x-(center(o.q)+lateral))>(o.width||2.6))continue;
  if(o.type==='star'&&air<3){o.used=true;o.visual.visible=false;stars++;tone(920,.08);if(o.power==='boost'){boostCharges=Math.min(5,boostCharges+1);notice('Rocket refilled')}}
  if(o.type==='ramp'&&air<1.2){o.used=true;verticalSpeed=Math.max(8,speed*.24);worldY=floor+.3;air=.3;tone(470,.15)}
  if((o.type==='rock'||o.type==='barrier'||o.type==='plow')&&air<(o.type==='barrier'?2.3:1.6)&&invuln<=0){o.used=true;speed*=.5+save.up.armor*.019;invuln=1;notice('Impact — momentum lost');tone(100,.2,'triangle');if(mode==='endless'){hearts--;if(hearts<=0){finishReason='Run complete';finish();return}}}
 }
 if((bridgeAt(z)&&Math.abs(lateral)>course().bridgeHalf-.9&&air<1.2)||(gapAt(z)&&worldY<base(z)-2.5)){finishReason=bridgeAt(z)?'Missed the bridge':'Short of the landing';finish();return}
 if(Math.abs(lateral)>12&&air<3&&invuln<=0){speed*=.65;target*=.85;invuln=1;notice('Snowbank!');tone(130,.15)}
 if(air<1.2&&(trailPoints.length===0||z-trailPoints[trailPoints.length-1].q>.7)){trailPoints.push({x:center(z)+lateral,y:ground(z,lateral)+.18,q:z});if(trailPoints.length>81)trailPoints.shift();}else if(air>1.2&&trailPoints.length&&trailPoints[trailPoints.length-1]!==null){trailPoints=[];}
 maintainChunks();
 const currentSection=Math.floor(z/310);if(currentSection!==lastSection){lastSection=currentSection;}
 if(mode==='launch'&&meters()>=course().target){finishReason='Finish line reached!';finish();return}
 if(mode==='launch'&&speed<3&&z>12){finishReason='Out of momentum';finish();return}
 hudTimer+=dt;if(hudTimer>.1){updateHud();hudTimer=0}
}
function render(dt){if(!renderer)return;introT+=dt;landingPulse=Math.max(0,landingPulse-dt*2);launchPulse=Math.max(0,launchPulse-dt*1.2);const x=center(z)+lateral,level=ground(z,lateral);rider.position.set(x,level+.1+air-landingPulse*.13,z-(phase==='ready'&&pull?Math.min(2.2,pull.amount/100):0));rider.rotation.z=lerp(rider.rotation.z,(target-lateral)*-.055,Math.min(1,dt*6));rider.rotation.y=lerp(rider.rotation.y,(center(z+6)-center(z))*.018+(target-lateral)*.04,Math.min(1,dt*5));rider.rotation.x=flipping?-flipAngle:lerp(rider.rotation.x,(air>1?clamp(-verticalSpeed*.012,-.35,.25):-Math.atan(slope(z))),1-Math.exp(-dt*9));
  for(const o of objects)if(o.type==='plow'){o.visual.position.x=o.x;o.visual.rotation.y=Math.cos(clock*.7+o.q)>0?Math.PI/2:-Math.PI/2;}
  for(const o of objects)if(o.type==='star'&&!o.used){o.visual.rotation.y+=dt*1.6;o.visual.position.y=ground(o.q,o.x-center(o.q))+1.22+Math.sin(clock*3+o.q)*.12}
  for(let k=0;k<mountains.length;k++){const side=k%2?-1:1,step=Math.floor(k/2),q=z+330+step*29,peak=mountains[k];peak.position.set(center(q)+side*(95+step*42),base(q)+peak.children[0].geometry.parameters.height*.45-4,q)}
  skyGroup.position.set(center(z+330)+80,base(z+330)+105,z+330);
  shadow.position.set(x,level+.2,z);shadow.rotation.x=-Math.PI/2-Math.atan(slope(z));shadow.scale.set(1.5+air*.035,2.2+air*.025,1);shadow.material.opacity=Math.max(.04,.23-air*.004);
  const snowPos=snowfall.geometry.attributes.position;for(let i=0;i<140;i++){const sx=(rng(i*3)*2-1)*40,sz=(rng(i*3+1)*125+z*.4)%125-25,sy=(rng(i*3+2)*38-clock*2)%38;snowPos.setXYZ(i,x+sx,level+4+(sy+38)%38,z+sz);}snowPos.needsUpdate=true;
  const p=particles.geometry.attributes.position,active=phase==='running'?clamp(speed/75,.35,1):0;for(let i=0;i<48;i++){const back=(i/48*12+clock*(16+speed*.27))%12,side=(rng(i+7)*2-1)*(1+back*.17),yy=ground(z-back,lateral)+.1+rng(i+33)*.75*active;p.setXYZ(i,x+side,yy,z-back)}p.needsUpdate=true;particles.visible=phase==='running'&&(air<1.5||landingPulse>.1);particles.material.size=.35+landingPulse*.5;
  for(const entry of turbines)entry.rotor.rotation.z+=dt*.7;
  const wingAngle=air>1?-.15:.18;wings[0].rotation.z=lerp(wings[0].rotation.z,wingAngle,Math.min(1,dt*7));wings[1].rotation.z=-wings[0].rotation.z;
  for(const f of flames){f.visible=boostTime>0;f.scale.set(1+Math.sin(clock*38)*.12,1+Math.sin(clock*31)*.24,1)}
  gate.visible=z<22;
  elastic.visible=phase==='ready';if(elastic.visible){const e=elastic.geometry.attributes.position,yy=ground(7,0);e.setXYZ(0,center(7)-4.4,yy+4.4,7);e.setXYZ(1,rider.position.x,rider.position.y+1,rider.position.z-1.8);e.setXYZ(2,center(7)+4.4,yy+4.4,7);e.needsUpdate=true;elastic.geometry.computeBoundingSphere();}
  const tp=skiTrail.geometry.attributes.position;let ti=0;for(let j=1;j<trailPoints.length;j++){const a=trailPoints[j-1],b=trailPoints[j];for(const side of [-1,1]){tp.setXYZ(ti++,a.x+side*.92,a.y,a.q);tp.setXYZ(ti++,b.x+side*.92,b.y,b.q);}}skiTrail.geometry.setDrawRange(0,ti);tp.needsUpdate=true;skiTrail.frustumCulled=false;
  const sp=speedStreaks.geometry.attributes.position;for(let j=0;j<16;j++){const side=j%2?1:-1,back=(j*11+clock*speed*.8)%90,xx=x+side*(10+j%4*3),yy=worldY+2+j%5;sp.setXYZ(j*2,xx,yy,z+45-back);sp.setXYZ(j*2+1,xx,yy,z+45-back-Math.min(8,speed*.075));}sp.needsUpdate=true;speedStreaks.frustumCulled=false;speedStreaks.visible=phase==='running'&&speed>55;speedStreaks.material.opacity=clamp((speed-55)/200,0,.25);
  const portrait=innerHeight>innerWidth,back=portrait?19:23,high=portrait?10.8:12,look=portrait?46:55;
  const desired=new T.Vector3(x+(center(z-back)-center(z))*.25,Math.max(level+high+air*.78,ground(z-back,lateral)+4),z-back);
  camera.position.lerp(desired,1-Math.exp(-dt*(phase==='menu'||phase==='ready'?2.7:4.5)));
  camera.lookAt(center(z+look)+lateral*.36,lerp(level,ground(z+look,0),.43)+2+air*.65,z+look);
  camera.fov=lerp(camera.fov,(portrait?65:59)+Math.min(9,speed*.085)+launchPulse*3,1-Math.exp(-dt*3));camera.updateProjectionMatrix();
  renderer.render(scene,camera);
}
let dragging=false,dragStartY=0,lastPointerX=0;
canvas.addEventListener('pointerdown',e=>{if(phase==='ready'&&mode==='launch'){dragging=true;dragStartY=e.clientY;pull={amount:0};canvas.setPointerCapture(e.pointerId)}else if(phase==='running'){pointer=true;lastPointerX=e.clientX;canvas.setPointerCapture(e.pointerId)}});
canvas.addEventListener('pointermove',e=>{if(dragging&&phase==='ready'){pull.amount=Math.max(0,e.clientY-dragStartY);power=clamp(Math.round(35+pull.amount*.38),35,100);$('power').value=power;$('powerValue').textContent=power+'%'}else if(pointer&&phase==='running'){const dx=e.clientX-lastPointerX;lastPointerX=e.clientX;target=clamp(target-dx/innerWidth*26,-12.5,12.5)}});
canvas.addEventListener('pointerup',e=>{if(dragging&&pull?.amount>22)begin();dragging=false;pull=null;pointer=false});canvas.addEventListener('pointercancel',()=>{dragging=false;pull=null;pointer=false});
window.addEventListener('keydown',e=>{if(e.key==='Escape'){phase==='running'?pause():phase==='paused'?resume():null;return}if(phase!=='running')return;if(['ArrowLeft','a','A'].includes(e.key)){target+=1.8;e.preventDefault()}if(['ArrowRight','d','D'].includes(e.key)){target-=1.8;e.preventDefault()}if(e.key===' '){jump();e.preventDefault()}if(['b','B'].includes(e.key))boost()});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&phase==='running')pause()});
function bind(id,fn){$(id).addEventListener('click',fn)}
bind('garage',()=>{phase='result';$('resultLabel').textContent='Sled workshop';$('resultTitle').textContent='Your garage';$('resultDistance').textContent='';$('resultDetail').textContent='Permanent upgrades · saved automatically';$('levelResult').textContent='';$('upgradeBox').hidden=false;refreshUpgrade();display('result')});bind('launchMode',()=>reset('launch'));bind('endlessMode',()=>reset('endless'));bind('go',begin);bind('readyBack',back);bind('menuHelp',help);bind('pauseHelp',help);bind('closeHelp',closeHelp);bind('pause',pause);bind('resume',resume);bind('jump',jump);bind('boost',boost);for(const id of ['exit','menuExit','pauseExit'])bind(id,()=>{persist();location.href='../../index.html'});bind('resultBack',back);bind('retry',()=>reset(mode));
$('power').addEventListener('input',e=>{power=Number(e.target.value);$('powerValue').textContent=power+'%'});
for(const button of document.querySelectorAll('[data-up]'))button.addEventListener('click',()=>upgrade(button.dataset.up));
bind('sound',()=>{soundOn=!soundOn;$('sound').textContent=soundOn?'Sound':'Muted';try{localStorage.setItem('goobs.snowbound.sound',soundOn?'on':'off')}catch{}});$('sound').textContent=soundOn?'Sound':'Muted';
function frame(t){const dt=Math.min(.08,(t-last)/1000||0);last=t;let remaining=dt;while(remaining>0){const step=Math.min(remaining,1/120);simulate(step);remaining-=step}render(dt);requestAnimationFrame(frame)}
setup();
window.__snowbound={reset,begin,simulate,finish,state:()=>({phase,mode,dist:meters(),speed,hearts,air,boostCharges,lateral,target,up:save.up})};
