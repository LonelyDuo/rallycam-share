(function(global){
/* Display-only trajectory fitting. Observed positions are archived unchanged. */
function trainedSolve3(matrix,vector){
  const a=matrix.map((r,i)=>[...r,vector[i]]);
  for(let i=0;i<3;i++){
    let pivot=i;for(let j=i+1;j<3;j++)if(Math.abs(a[j][i])>Math.abs(a[pivot][i]))pivot=j;
    [a[i],a[pivot]]=[a[pivot],a[i]];if(Math.abs(a[i][i])<1e-10)return null;
    const d=a[i][i];for(let k=i;k<4;k++)a[i][k]/=d;
    for(let j=0;j<3;j++)if(j!==i){const f=a[j][i];for(let k=i;k<4;k++)a[j][k]-=f*a[i][k]}
  }
  return a.map(r=>r[3]);
}
function trainedSmooth(points){
  if(points.length<3)return points.map(p=>({...p}));
  return points.map((p,i)=>{
    const rows=points.slice(Math.max(0,i-5),i+6);if(rows.length<3)return {...p};
    let weights=rows.map(r=>Math.exp(-.5*((r.t-p.t)*60/4)**2)),cx,cy;
    for(let pass=0;pass<3;pass++){
      const m=Array.from({length:3},()=>[0,0,0]),bx=[0,0,0],by=[0,0,0];
      rows.forEach((r,j)=>{const t=(r.t-p.t)*60,v=[1,t,t*t],w=weights[j];for(let a=0;a<3;a++){bx[a]+=w*v[a]*r.x;by[a]+=w*v[a]*r.y;for(let b=0;b<3;b++)m[a][b]+=w*v[a]*v[b]}});
      cx=trainedSolve3(m,bx);cy=trainedSolve3(m,by);if(!cx||!cy)return {...p};
      weights=rows.map(r=>{const t=(r.t-p.t)*60,px=cx[0]+cx[1]*t+cx[2]*t*t,py=cy[0]+cy[1]*t+cy[2]*t*t,residual=Math.hypot((r.x-px)*1920,(r.y-py)*1080);return Math.exp(-.5*(t/4)**2)*Math.min(1,10/Math.max(residual,1e-6))});
    }
    // Keep the latest marker at its observed center. Filtering only styles history.
    return i===points.length-1?{...p}:{...p,x:cx[0],y:cy[0]};
  });
}
function trainedAccept(history,result){
  const top=result.detections?.[0],last=history.at(-1);
  if(result.warming||result.reset||!top||result.state==='held')return [];
  const p={x:top.x,y:top.y,t:result.time,seq:result.sequence,r:0};
  if(last&&(p.t<=last.t||p.t-last.t>.12||Math.hypot((p.x-last.x)*960,(p.y-last.y)*540)>50))history=[];
  return [...history,p].filter(r=>p.t-r.t<=3).slice(-180);
}
function trainedContentRect(box,videoWidth,videoHeight){
  if(!(box.width>0&&box.height>0&&videoWidth>0&&videoHeight>0))return {left:box.left||0,top:box.top||0,width:0,height:0};
  const aspect=videoWidth/videoHeight,width=Math.min(box.width,box.height*aspect),height=width/aspect;
  return {left:box.left+(box.width-width)/2,top:box.top+(box.height-height)/2,width,height};
}
function trainedDisplayFrame(frames,time,delay){
  const available=frames.filter(f=>f.bitmap).sort((a,b)=>a.time-b.time),ready=available.filter(f=>f.result&&!f.result.warming),target=time-delay;
  return ready.filter(f=>f.time<=target).at(-1)||ready[0]||available[0]||null;
}
function trainedTableContains(point,corners){
  if(!Array.isArray(corners)||corners.length!==4)return point.x>430/1920&&point.x<1500/1920&&point.y>450/1080&&point.y<860/1080;
  let inside=false,near=false;
  for(let i=0,j=3;i<4;j=i++){
    const a=corners[j],b=corners[i];if(!Number.isFinite(a.x+a.y+b.x+b.y))return false;
    if((a.y>point.y)!==(b.y>point.y)&&point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
    const dx=(b.x-a.x)*1920,dy=(b.y-a.y)*1080,px=(point.x-a.x)*1920,py=(point.y-a.y)*1080,den=dx*dx+dy*dy,u=den?Math.max(0,Math.min(1,(px*dx+py*dy)/den)):0;
    if(Math.hypot(px-u*dx,py-u*dy)<=20)near=true;
  }
  return inside||near;
}
function trainedTableContact(points,corners=null){
  if(points.length<11)return null;
  const raw=points.slice(-11);if(raw.at(-1).t-raw[0].t>.35)return null;
  const fitted=trainedSmooth(raw),center=fitted[5],ys=fitted.map(p=>p.y*1080);
  if(!trainedTableContains(center,corners)||ys[5]<Math.max(...ys.slice(2,9))-1e-6)return null;
  const down=ys[5]-(ys[0]+ys[1])/2,up=ys[5]-(ys[9]+ys[10])/2;
  if(Math.min(down,up)<6||(Math.max(...raw.map(p=>p.x))-Math.min(...raw.map(p=>p.x)))*1920<15)return null;
  const local=raw.slice(3,8),peak=Math.max(...local.map(p=>p.y)),plateau=local.filter(p=>Math.abs(p.y-peak)<1e-8),p=plateau[Math.floor(plateau.length/2)];
  return {kind:'table',estimated:true,time:p.t,sequence:p.seq,x:p.x,y:p.y};
}
function trainedContactSmooth(points,contacts){
  if(points.length<2)return trainedSmooth(points);
  const anchors=new Map(contacts.map(c=>[c.sequence,c])),cuts=[0,...points.map((p,i)=>anchors.has(p.seq)?i:-1).filter(i=>i>0&&i<points.length-1),points.length-1],result=[];
  for(let i=1;i<cuts.length;i++){
    const fitted=trainedSmooth(points.slice(cuts[i-1],cuts[i]+1));
    for(const p of fitted){const a=anchors.get(p.seq);if(a){p.x=a.x;p.y=a.y}}
    result.push(...(i===1?fitted:fitted.slice(1)));
  }
  return result;
}


class SharedBallTracking {
 constructor({videoID,player,container,controls,service='https://rallycam-share-storage.richardisbluehd.chatgpt.site'}){
  Object.assign(this,{videoID,player,container,controls,service});this.closed=false;this.enabled=true;this.parts=new Map();this.pending=new Set();this.retryAt=new Map();this.abort=new AbortController();this.manifest=null;
  this.canvas=document.createElement('canvas');this.canvas.width=1920;this.canvas.height=1080;Object.assign(this.canvas.style,{position:'absolute',inset:'0',width:'100%',height:'100%',pointerEvents:'none'});container.style.position='relative';container.append(this.canvas);this.ctx=this.canvas.getContext('2d');
  this.label=document.createElement('label');this.check=document.createElement('input');this.check.type='checkbox';this.check.checked=true;this.check.disabled=true;this.label.append(this.check,document.createTextNode(' Ball tracking'));this.note=document.createElement('span');this.note.textContent=' Checking tracking…';controls.append(this.label,this.note);this.check.onchange=()=>{this.enabled=this.check.checked};
  this.load();this.tick=()=>{if(this.closed)return;this.render();this.raf=requestAnimationFrame(this.tick)};this.raf=requestAnimationFrame(this.tick);
 }
 async load(){try{const r=await fetch(this.service+'/api/tracking/'+this.videoID,{credentials:'omit',cache:'no-store',signal:this.abort.signal});if(this.closed)return;if(r.status===404){this.note.textContent=' · Not added yet';return}if(!r.ok)throw Error('unavailable');const m=await r.json();if(m.v!==1||m.videoID!==this.videoID||!Number.isFinite(m.offset)||!Number.isFinite(m.aspect)||!Array.isArray(m.parts)||m.parts.length>2000||!m.parts.every(p=>Number.isInteger(p.index)&&Number.isFinite(p.start)&&Number.isFinite(p.end)))throw Error('invalid');this.manifest=m;this.check.disabled=false;this.note.textContent=' · Contacts are estimates';}catch(e){if(!this.closed)this.note.textContent=' · Tracking unavailable; video still plays'}}
 async part(index){if(this.closed||this.parts.has(index)||this.pending.has(index)||Date.now()<(this.retryAt.get(index)||0))return;this.pending.add(index);try{const r=await fetch(this.service+'/api/tracking/'+this.videoID+'/parts/'+index+'?version='+encodeURIComponent(this.manifest.version),{credentials:'omit',cache:'no-store',signal:this.abort.signal});if(!r.ok)throw Error();const data=await r.json();if(this.closed)return;this.parts.set(index,data);while(this.parts.size>4)this.parts.delete(this.parts.keys().next().value);this.note.textContent=' · Contacts are estimates';}catch(e){if(!this.closed){this.retryAt.set(index,Date.now()+10000);this.note.textContent=' · Could not load tracking here';}}finally{this.pending.delete(index)}}
 render(){const ctx=this.ctx;ctx.clearRect(0,0,1920,1080);if(!this.enabled||!this.manifest)return;const t=this.player.getCurrentTime()-this.manifest.offset,parts=this.manifest.parts;const pi=parts.findIndex(p=>t>=p.start-.01&&t<=p.end+.12);if(pi<0)return;const desired=[pi];if(pi>0&&t-parts[pi].start<.6)desired.unshift(pi-1);if(pi+1<parts.length&&parts[pi+1].start-t<2)this.part(pi+1);for(const n of desired)this.part(n);if(!this.parts.has(pi))return;
 const rows=desired.flatMap(n=>this.parts.get(n)?.frames||[]),contacts=desired.flatMap(n=>this.parts.get(n)?.contacts||[]).filter(c=>c[0]<=t&&t-c[0]<.4).map(c=>({time:c[0],x:c[1],y:c[2],sequence:c[3]}));let lo=0,hi=rows.length;while(lo<hi){const mid=(lo+hi)>>1;if(rows[mid][0]<=t)lo=mid+1;else hi=mid}const i=lo-1,row=rows[i];if(!row||t-row[0]>.12)return;
 const box=this.container.getBoundingClientRect(),rect=trainedContentRect({left:0,top:0,width:box.width,height:box.height},this.manifest.aspect,1),sx=rect.width/box.width*1920,sy=rect.height/box.height*1080,ox=rect.left/box.width*1920,oy=rect.top/box.height*1080,scale=Math.min(sx/1920,sy/1080),X=p=>ox+p.x*sx,Y=p=>oy+p.y*sy;
 ctx.globalAlpha=1;ctx.shadowBlur=0;for(const c of contacts){const age=t-c.time,rx=(27+age*42)*scale;ctx.globalAlpha=1-age/.4;ctx.shadowColor='#00fff2';ctx.shadowBlur=18*scale;ctx.strokeStyle='#00fff2';ctx.lineWidth=6*scale;ctx.beginPath();ctx.ellipse(X(c),Y(c)+5*scale,rx,rx*.35,0,0,Math.PI*2);ctx.stroke();ctx.shadowBlur=0;ctx.strokeStyle='#bdfffc';ctx.lineWidth=2*scale;ctx.stroke()}ctx.globalAlpha=1;if(!row[3])return;
 let raw=[];for(let j=i;j>=0;j--){const r=rows[j],next=raw.at(-1);if(row[0]-r[0]>.5||r[3]!==1||(next&&(next.t-r[0]>.12||Math.hypot((next.x-r[1])*960,(next.y-r[2])*540)>50)))break;raw.push({t:r[0],x:r[1],y:r[2],seq:r[4]});if(r[5])break}const points=trainedContactSmooth(raw.reverse(),contacts);ctx.lineCap=ctx.lineJoin='round';
 if(points.length>1){const trace=()=>{ctx.beginPath();ctx.moveTo(X(points[0]),Y(points[0]));for(let j=1;j<points.length;j++){const a=points[j-1],b=points[j];ctx.quadraticCurveTo(X(a),Y(a),(X(a)+X(b))/2,(Y(a)+Y(b))/2)}ctx.lineTo(X(points.at(-1)),Y(points.at(-1)))};const first=points[0],last=points.at(-1),gradient=ctx.createLinearGradient(X(first),Y(first),X(last)+.001,Y(last)+.001);gradient.addColorStop(0,'rgba(0,255,242,0)');gradient.addColorStop(1,'#40fff4');ctx.strokeStyle=gradient;for(const [width,blur]of [[12,23],[8,9],[4,0]]){trace();ctx.lineWidth=width*scale;ctx.shadowColor='#00fff2';ctx.shadowBlur=blur*scale;ctx.stroke()}}
 const top={x:row[1],y:row[2]};ctx.globalAlpha=1;ctx.shadowColor='#00fff2';ctx.shadowBlur=20*scale;ctx.fillStyle='#00fff2';ctx.beginPath();ctx.arc(X(top),Y(top),12*scale,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;ctx.fillStyle='#cfffff';ctx.beginPath();ctx.arc(X(top),Y(top),8*scale,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;
 }
 dispose(){this.closed=true;this.abort.abort();cancelAnimationFrame(this.raf);this.canvas.remove();this.label.remove();this.note.remove();this.parts.clear()}
}
global.RallyCamSharedTracking=SharedBallTracking;
})(typeof window!=='undefined'?window:globalThis);
