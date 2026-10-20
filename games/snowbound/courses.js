/* Twenty repeatable route designs. All random choices are deterministic per level. */
(function(root){'use strict';
var names=['Alpine Village','Aurora Pass','Frostwater Harbor','Crystal Crossing','Winterkeep','Pine Switchbacks','Lantern Harbor','Sapphire Run','Royal Slalom','Glacier Ribbon','Timber Crossing','Polar Freight','Crystal Bridges','Castle Chicanes','Frostbite Bend','Northern Causeway','Twilight Circuit','Prism Passage','Crown Traverse','Summit Circuit'];
// R: recovery; S: slalom; P: moving plow; B: bridge; G: launch gap; C: double chicane.
var patterns=['RSRRRSRRRSRR','RSRRSRRSRRSR','RBRSPRRSRBRR','RGRSBRRSPRGR','RBRCSRGRSPRR','RSRCSRRSPRCR','RBRCBRRSPRBR','RGRCSRGSRPRR','RCRSBRCRSPRR','RGRCPRGRSBRR','RBRCBRCSRBRR','RPRCBRPSRGRR','RGRBCRGRSBRR','RCRBCRCSRSRR','RGRCPRGRCPRR','RBRCBRGRCBRR','RCRPBRCRGPRR','RGRBCRGRBCRR','RCRBCRGRCBRR','RCBRCGRCPRCR'];
var skies=['#8ed7f4','#a8baf0','#ffc7a3','#85d6df','#c3b1e9','#9bd9bf','#efb9d6','#a6d8f5'];
var ice=['#73c6e7','#a9c4f4','#8dd9ed','#73d6d5','#b8a1e0','#81c8d4','#b5c6ee','#6bbadc'];
function hash(a){a=(a^61)^(a>>>16);a=Math.imul(a,9);a=a^(a>>>4);a=Math.imul(a,0x27d4eb2d);a=a^(a>>>15);return(a>>>0)/4294967296;}
function get(level){level=Math.max(1,Math.floor(Number(level)||1));var index=(level-1)%20,cycle=Math.floor((level-1)/20),rank=index+1,theme=(index+cycle*2)%5+1,palette=(Math.floor(index/5)+cycle)%8;
 var growth=Math.max(0,rank-5),needs=rank<=5?[{launch:1,glide:1,rocket:1},{launch:2,glide:2,rocket:2,steer:1},{launch:3,glide:3,rocket:3,steer:2,armor:1},{launch:4,glide:4,rocket:4,steer:3,armor:3},{launch:6,glide:5,rocket:5,steer:5,armor:4}][index]:{launch:Math.min(12,6+Math.ceil(growth*.4)),glide:Math.min(12,5+Math.ceil(growth*.47)),rocket:Math.min(12,5+Math.ceil(growth*.47)),steer:Math.min(12,5+Math.ceil(growth*.47)),armor:Math.min(12,4+Math.ceil(growth*.54))};
 if(cycle>0)needs={launch:12,glide:12,rocket:12,steer:12,armor:12};
 return {level:level,index:index,cycle:cycle,rank:rank,name:names[index],target:index<5?[7500,8500,9000,9500,10000][index]:10000,needs:needs,theme:theme,sky:skies[palette],ice:ice[palette],pattern:patterns[index],bend:.004+index*.00022,span:150-index*1.45,bridgeHalf:5.5-index*.04,gapHalf:4.5-index*.045,mirror:cycle>0&&hash(level*31)>.5?-1:1};
}
function plan(level,chunk){var c=get(level),end=4+c.target/4;if(chunk<2||chunk*88>end-88)return{kind:'R',safe:0,quiet:true};var index=(chunk-2)%12,kind=c.pattern[index],prev=c.pattern[(index+11)%12],next=c.pattern[(index+1)%12],critical=function(k){return k==='B'||k==='G';};
 // Reserve complete approach/landing chunks; bridges/gaps never contain other hazards.
 if(!critical(kind)&&(critical(prev)||critical(next)))return{kind:'R',safe:0,quiet:true};
 if(c.cycle&&kind==='R'&&hash(level*337+chunk*19)>.55)kind=hash(level*71+chunk)>.5?'S':'P';
 var safe=(hash(level*89+chunk*47)>.5?1:-1)*(c.rank<3?4.5:5.5)*c.mirror;
 return{kind:kind,safe:safe,quiet:false,lane:(Math.floor(hash(level*211+chunk*37)*3)-1)*5};
}
root.SnowCourses={get:get,plan:plan,hash:hash,names:names};if(typeof module!=='undefined')module.exports=root.SnowCourses;
})(typeof window!=='undefined'?window:globalThis);
