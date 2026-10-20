/* Spring Run — conservative grid fluid and diggable terrain. No external dependencies. */
(function(root){'use strict';
var W=96,H=144,N=W*H;
var titles=['A little spring','Around the bend','Split the stream','The stone shelf','Dry country','Two little detours','The long way home','Broken staircase','Thread the needle','Three islands','The spillway','A winding spring'];
function make(level){
 var s={level:level,w:W,h:H,terrain:new Uint8Array(N),water:new Float32Array(N),collected:0,lost:0,total:0,steps:0,gates:[],pipes:[],sponges:[],revision:0,stars:[],title:'',goal:{x:37,y:130,w:22,h:10}};
 s.terrain.fill(1);
 function rect(x,y,w,h,type){for(var yy=y;yy<y+h;yy++)for(var xx=x;xx<x+w;xx++)if(xx>=0&&xx<W&&yy>=0&&yy<H)s.terrain[yy*W+xx]=type;}
 s.rect=rect;
 rect(0,0,W,3,2);rect(0,0,3,H,2);rect(W-3,0,3,H,2);rect(0,H-3,W,3,2);
 rect(30,5,36,19,0);rect(34,8,28,13,0);
 for(var y=8;y<21;y++)for(var x=34;x<62;x++){s.water[y*W+x]=1;s.total++;}
 rect(34,128,28,13,0);
 var k=(level-1)%12,chapter=Math.floor((level-1)/12),mirror=chapter%2===1;
 function mx(x){return mirror?W-1-x:x;}
 function block(x,y,w,h,type){rect(mirror?W-x-w:x,y,w,h,type);}
 function gate(x,y,sx,sy){block(3,y,90,4,2);block(x,y,24,4,4);s.gates.push({x:mirror?W-x-24:x,y:y,w:24,h:4,sx:mx(sx),sy:sy,charge:0,open:false});}
 function pipe(x,y,ox,oy){var p={x:mx(x),y:y,ox:mx(ox),oy:oy,transferred:0};s.pipes.push(p);block(x-5,y-5,11,11,0);block(ox-5,oy-5,11,11,0);}
 function sponge(x,y,w,h,cap){block(x,y,w,h,6);s.sponges.push({x:mirror?W-x-w:x,y:y,w:w,h:h,held:0,capacity:cap});}
 var titles=['First light','The winding brook','Two paths','Wake the waterwheel','Through the pipes','Poison garden','The thirsty sponge','Up and over','Two locks','The buried aqueduct','A careful split','The great waterworks'];
 s.title=titles[k]+(chapter?' · '+(chapter+1):'');s.hint='Dig a smooth downhill channel from the reservoir to the pool.';
 var points=[[48,45],[48,80],[48,115]];
 if(k===1){block(3,53,56,5,2);points=[[71,42],[73,77],[48,115]];s.hint='Pass the right end of the stone shelf, then curve back toward the pool.';}
 if(k===2){block(37,49,22,12,2);points=[[25,54],[72,54],[48,112]];s.hint='Split the stream around both sides of the stone island for all three sunstones.';}
 if(k===3){gate(36,80,30,51);points=[[30,51],[48,92],[48,115]];s.hint='Send water over the cyan wheel first. It opens the striped gate below.';}
 if(k===4){block(3,70,90,5,2);pipe(48,57,25,85);points=[[48,39],[25,96],[48,117]];s.hint='Dig into the upper pipe and dig a separate channel from the matching lower outlet.';}
 if(k===5){block(36,61,24,5,5);block(36,66,24,3,2);points=[[24,48],[24,83],[48,115]];s.hint='Purple sludge destroys clean water. Go around the left side of its stone basin.';}
 if(k===6){sponge(42,57,12,7,65);points=[[30,48],[28,83],[48,116]];s.hint='A sponge drinks some of your water, then releases the rest. Save water by digging around it.';}
 if(k===7){block(3,69,90,5,2);pipe(67,56,22,81);block(38,95,55,4,2);points=[[66,40],[22,87],[24,111]];s.hint='The pipe carries water across the rock. Stay left of the second shelf.';}
 if(k===8){gate(58,65,69,43);gate(16,105,28,85);points=[[69,43],[28,85],[48,119]];s.hint='Open the upper gate, then guide its stream diagonally down to the second wheel.';}
 if(k===9){block(3,51,90,5,2);pipe(30,39,69,65);gate(20,105,27,84);points=[[30,30],[69,73],[27,86]];s.hint='The left pipe feeds the right chamber. Dig down and left to wake the gate wheel.';}
 if(k===10){block(40,49,16,14,2);sponge(19,74,12,5,40);block(63,77,15,4,5);block(63,81,15,3,2);points=[[25,54],[72,54],[45,112]];s.hint='Split for both upper stones, then steer clear of the purple pool. The sponge takes a small share.';}
 if(k===11){gate(58,58,69,39);block(3,93,90,4,2);pipe(69,80,24,106);points=[[69,39],[69,68],[24,115]];s.hint='Wake the wheel, then send water through the pipe below the opened gate.';}
 s.stars=points.map(function(p){return{x:mx(p[0]),y:p[1],wet:0,got:false};});
 if(chapter){s.hint=(mirror?'This spring is mirrored. ':'')+s.hint;block(4,124,13,4,3);block(79,124,13,4,3);}
 if(level>24){s.title='Wild waterworks · '+(level-24);var offset=((level*17)%9)-4;s.stars.forEach(function(p){p.x=Math.max(10,Math.min(85,p.x+offset));});}
 return s;
}
function dig(s,x,y,r){var count=0;for(var yy=Math.max(3,Math.floor(y-r));yy<=Math.min(H-4,Math.ceil(y+r));yy++)for(var xx=Math.max(3,Math.floor(x-r));xx<=Math.min(W-4,Math.ceil(x+r));xx++){var i=yy*W+xx;if((xx-x)*(xx-x)+(yy-y)*(yy-y)<=r*r&&s.terrain[i]===1){s.terrain[i]=0;count++;}}return count;}
function stroke(s,a,b,r){var d=Math.hypot(b.x-a.x,b.y-a.y),n=Math.max(1,Math.ceil(d/(r*.45)));for(var j=0;j<=n;j++)dig(s,a.x+(b.x-a.x)*j/n,a.y+(b.y-a.y)*j/n,r);}
function step(s){
 var a=s.water,t=s.terrain; s.steps++;
 for(var pi=0;pi<s.pipes.length;pi++){var pp=s.pipes[pi],volume=0;for(var py=pp.y-4;py<=pp.y+4;py++)for(var px=pp.x-4;px<=pp.x+4;px++){var ii=py*W+px,take=Math.min(a[ii],.32);a[ii]-=take;volume+=take;}pp.transferred+=volume;for(var px=-3;px<=3;px++)a[(pp.oy+2)*W+pp.ox+px]+=volume/7;}
 for(var si=0;si<s.sponges.length;si++){var sp=s.sponges[si];if(sp.held>=sp.capacity)continue;for(var yy=sp.y;yy<sp.y+sp.h;yy++)for(var xx=sp.x;xx<sp.x+sp.w;xx++){var ii=yy*W+xx,take=Math.min(a[ii],.25,sp.capacity-sp.held);a[ii]-=take;sp.held+=take;s.lost+=take;}}

 function move(i,j,amount){if(t[j]===1||t[j]===2||t[j]===4||amount<=0)return;amount=Math.min(a[i],amount);a[i]-=amount;a[j]+=amount;}
 for(var y=H-4;y>=3;y--){var reverse=(s.steps+y)%2;for(var z=3;z<W-3;z++){var x=reverse?W-1-z:z,i=y*W+x,v=a[i];if(v<.00001)continue;
 if(t[i]===3||t[i]===5){s.lost+=v;a[i]=0;continue;}
 if(y>=s.goal.y&&y<s.goal.y+s.goal.h&&x>=s.goal.x&&x<s.goal.x+s.goal.w){s.collected+=v;a[i]=0;continue;}
 var below=i+W;if(t[below]!==1&&t[below]!==2&&t[below]!==4)move(i,below,Math.max(0,1.03-a[below]));
 var first=reverse?-1:1;for(var j=0;j<2;j++){var side=i+(j?-first:first);move(i,side,Math.max(0,(a[i]-a[side])*.25));}
 if(a[i]>1.04)move(i,i-W,(a[i]-1.04)*.3);
 }}
 for(var gi=0;gi<s.gates.length;gi++){var gate=s.gates[gi];if(gate.open)continue;var wet=0;for(var yy=gate.sy-4;yy<=gate.sy+4;yy++)for(var xx=gate.sx-4;xx<=gate.sx+4;xx++)wet+=a[yy*W+xx];gate.charge+=Math.min(wet,.6);if(gate.charge>3){gate.open=true;for(var yy=gate.y;yy<gate.y+gate.h;yy++)for(var xx=gate.x;xx<gate.x+gate.w;xx++)t[yy*W+xx]=0;s.revision++;}}
 for(var n=0;n<s.stars.length;n++){var p=s.stars[n];if(p.got)continue;var wet=0;for(var yy=p.y-3;yy<=p.y+3;yy++)for(var xx=p.x-3;xx<=p.x+3;xx++)wet+=a[yy*W+xx];p.wet+=Math.min(wet,.7);if(p.wet>=2.5)p.got=true;}
}
function mass(s){var sum=s.collected+s.lost;for(var i=0;i<N;i++)sum+=s.water[i];return sum;}
root.SpringFluid={make:make,dig:dig,stroke:stroke,step:step,mass:mass,W:W,H:H};
if(typeof module!=='undefined')module.exports=root.SpringFluid;
})(typeof window!=='undefined'?window:globalThis);
