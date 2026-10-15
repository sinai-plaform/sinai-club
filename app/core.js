/* ===== SINAI Club — core ===== */
if(!window.supabase){
  document.getElementById('app').innerHTML =
    '<div class="wrap" style="padding-top:80px;max-width:400px;text-align:center">'+
    '<div style="font-size:40px">📡</div>'+
    '<h2 style="margin-top:10px">לא הצלחנו לטעון את האפליקציה</h2>'+
    '<p class="muted sm" style="margin-top:8px">נראה שאין חיבור לאינטרנט כרגע. '+
    'התחברו לרשת ורעננו את הדף.</p>'+
    '<button class="btn primary" style="margin-top:16px" onclick="location.reload()">רענון</button></div>';
  throw new Error('supabase sdk unavailable');
}
// every database call goes through OFF.fetch (offline.js), so the app keeps working without signal
// opened from a "reset password" email? remember it before the SDK reads the link
const RECOVERY = /type=recovery/.test(location.hash) || /type=recovery/.test(location.search);
const sb = window.supabase.createClient(SB_URL, SB_KEY, {auth:{persistSession:true,autoRefreshToken:true},
  global:{fetch:OFF.fetch}});
OFF.setAuth(async()=>{ const {data:{session}}=await sb.auth.getSession(); return session?session.access_token:null; });
const FN = SB_URL+'/functions/v1/coach-auth';
async function fn(action, payload, withAuth){
  try{
    const headers={'Content-Type':'application/json'};
    if(withAuth){ const {data:{session}}=await sb.auth.getSession(); if(session) headers.Authorization='Bearer '+session.access_token; }
    const r = await fetch(FN,{method:'POST',headers,
      body:JSON.stringify(Object.assign({action},payload||{}))});
    const j = await r.json().catch(()=>({error:'שגיאת רשת'}));
    return r.ok ? j : {error: j.error || ('שגיאה '+r.status)};
  }catch(e){ return {error:'אין חיבור לאינטרנט'}; }
}
// exchange a server-minted token for a real session
async function useToken(th){
  const {data,error} = await sb.auth.verifyOtp({token_hash:th, type:'email'});
  return error ? {error:error.message} : {user:data.user};
}

const APP_VERSION='2.9.0';
const S = { user:null, club:null, role:null, teams:[], team:null, players:[], attrs:[], dbDrills:[],
            session:null, sessionDrills:[], attendance:{}, match:null, view:'home', online:navigator.onLine };

/* ---------- utils ---------- */
const $=(s,r)=>(r||document).querySelector(s);
const $$=(s,r)=>[...(r||document).querySelectorAll(s)];
const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const uid=()=>OFF.uuid();   // a real uuid even on older tablets — the database ids are uuids
const today=()=>new Date().toLocaleDateString('en-CA');
const initials=n=>String(n||'').trim().split(/\s+/).slice(0,2).map(w=>w[0]).join('');
const fmtDate=d=>{const x=new Date(d);return x.toLocaleDateString(I18N.loc(),{day:'numeric',month:'short'});};
const daysAgo=d=>Math.floor((Date.now()-new Date(d).getTime())/864e5);
const LS=(k,v)=>{try{if(v===undefined){const r=localStorage.getItem('sc.'+k);return r?JSON.parse(r):null;}localStorage.setItem('sc.'+k,JSON.stringify(v));}catch(e){return null;}};
let toastT; function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('show');clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove('show'),2000);}
const fmtBirth=d=>{ const [y,m,dd]=String(d).slice(0,10).split('-'); return `${+dd}.${+m}.${y}`; };
function age(bd){if(!bd)return null;const b=new Date(bd),n=new Date();let a=n.getFullYear()-b.getFullYear();if(n<new Date(n.getFullYear(),b.getMonth(),b.getDate()))a--;return a;}

/* ---------- writes & sync ----------
   Writes go straight through sb; offline.js keeps them on the tablet when there is
   no signal and sends them later. push() stays as the short form the screens use. */
async function push(table, rows, opts){
  rows = Array.isArray(rows)?rows:[rows];
  const q = sb.from(table);
  const r = opts&&opts.upsert ? await q.upsert(rows,{onConflict:opts.onConflict}) : await q.insert(rows);
  if(r.error){ console.warn('write failed',table,r.error.message); return {error:r.error}; }
  return {ok:true};
}
// older versions kept their own queue in sc.queue — hand whatever is left in it to the new outbox once
async function flushQueue(){
  const old=LS('queue')||[];
  if(old.length){ LS('queue',[]); for(const it of old) await push(it.table,it.rows,it.opts); }
  OFF.flush();
}
function renderOffline(){
  const b=$('#offlineBar'); if(!b) return;
  const n=OFF.pending();
  b.classList.toggle('hide', S.online && !n);
  b.style.background = S.online ? 'var(--info)' : '';
  b.textContent = !S.online
    ? (n ? `אופליין — ${n} עדכונים שמורים בטאבלט, יישלחו לבד כשתחזור קליטה` : 'אופליין — כל מה שתזין נשמר בטאבלט')
    : `${n} עדכונים ממתינים — מסנכרן…`;
}
OFF.onChange(renderOffline);
OFF.onSynced(()=>{ if(!OFF.pending()) toast('סונכרן ✓'); });
addEventListener('online',()=>{S.online=true;renderOffline();flushQueue();warmForField();});
addEventListener('offline',()=>{S.online=false;renderOffline();});

/* ---------- getting ready for the pitch ----------
   While there is signal, the next sessions are opened once in the background, so on the
   pitch they open from the tablet: the session, its drills, attendance and squad ratings. */
let WARM_AT=0;
async function warmForField(){
  if(!navigator.onLine || !S.team || S.role==='parent' || S.role==='player') return;
  if(Date.now()-WARM_AT<10*60e3) return; WARM_AT=Date.now();
  try{
    const to=new Date(Date.now()+3*864e5).toLocaleDateString('en-CA');
    const {data}=await sb.from('coach_sessions').select('id').eq('team_id',S.team.id).in('status',['planned','live'])
      .gte('date',new Date(Date.now()-864e5*3).toISOString().slice(0,10)).lte('date',to).order('date').limit(4);
    for(const s of data||[]) await Promise.all([
      sb.from('coach_sessions').select('*').eq('id',s.id).single(),
      sb.from('coach_session_drills').select('*').eq('session_id',s.id).order('ord'),
      sb.from('coach_attendance').select('*').eq('session_id',s.id)]);
    await squadObs();
  }catch(e){}
}
// all ratings of the squad — one query shared by the squad screen and the team split, so one saved copy serves both
async function squadObs(){
  const ids=S.players.map(p=>p.id); if(!ids.length) return [];
  const {data}=await sb.from('coach_observations').select('id,player_id,attribute,score,source,at').in('player_id',ids).eq('voided',false).limit(5000);
  return data||[];
}
// server ratings + the ones made on this tablet, each counted once
function withLocalObs(list, ids){
  const seen=new Set((list||[]).map(o=>o.id));
  return (list||[]).concat(LOCAL_OBS.filter(o=>!seen.has(o.id) && (!ids||ids.includes(o.player_id))));
}

/* ---------- diagrams (same format as the library) ---------- */
const TEAMC={a:'var(--ta)',b:'var(--tb)',n:'var(--tn)',gk:'var(--tgk)',co:'var(--tco)'};
function zig(pts){let d='';for(let i=0;i<pts.length-1;i++){const [x1,y1]=pts[i],[x2,y2]=pts[i+1];const dx=x2-x1,dy=y2-y1,len=Math.hypot(dx,dy)||1,n=Math.max(2,Math.round(len/3));const nx=-dy/len*1.3,ny=dx/len*1.3;if(i===0)d+=`M${x1},${y1}`;for(let k=1;k<=n;k++){const t=k/n,s=(k%2?1:-1)*(k===n?0:1);d+=` L${(x1+dx*t+nx*s).toFixed(1)},${(y1+dy*t+ny*s).toFixed(1)}`;}}return d;}
const poly=p=>p.map(x=>x.join(',')).join(' ');
function gr(it,w,depth){const x=it.x,y=it.y;if(it.dir==='w')return[x-depth,y-w/2,depth,w];if(it.dir==='e')return[x,y-w/2,depth,w];if(it.dir==='n')return[x-w/2,y-depth,w,depth];return[x-w/2,y,w,depth];}
const OP=it=>it.o!=null?`<g opacity="${it.o}">`:'', CL=it=>it.o!=null?'</g>':'';
function svgDiag(d,cls){
  const items=(d&&d.items)||[];
  let s=`<svg class="${cls||'dg'}" direction="ltr" viewBox="0 0 120 80" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="דיאגרמה"><defs>
  <marker id="aW" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0,0 L6,3 L0,6 Z" fill="#fff"/></marker>
  <marker id="aO" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0,0 L6,3 L0,6 Z" fill="#FFD166"/></marker>
  <pattern id="nt" width="1.5" height="1.5" patternUnits="userSpaceOnUse"><path d="M0,0 L1.5,1.5 M1.5,0 L0,1.5" stroke="#fff" stroke-width=".25"/></pattern></defs>
  <rect width="120" height="80" fill="var(--pitch)"/>`;
  for(let i=1;i<6;i+=2)s+=`<rect x="${i*20}" y="0" width="20" height="80" fill="var(--pitch2)"/>`;
  const later=[];
  items.forEach(it=>{switch(it.t){
    case 'zone':s+=`<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" fill="#fff" fill-opacity=".10"/>`+(it.label?`<text x="${it.x+it.w/2}" y="${it.y+5}" font-size="3.4" fill="#fff" fill-opacity=".85" text-anchor="middle">${esc(I18N.tr(it.label))}</text>`:'');break;
    case 'line':s+=`<line x1="${it.x1}" y1="${it.y1}" x2="${it.x2}" y2="${it.y2}" stroke="#fff" stroke-width=".6" stroke-opacity=".8"/>`;break;
    case 'ring':s+=`<circle cx="${it.cx}" cy="${it.cy}" r="${it.r}" fill="none" stroke="#fff" stroke-width=".6" stroke-dasharray="2 1.5" stroke-opacity=".8"/>`;break;
    case 'hoop':s+=`<circle cx="${it.x}" cy="${it.y}" r="3.6" fill="none" stroke="#FFD166" stroke-width="1"/>`;break;
    case 'goal':{const[a,b,c,d2]=gr(it,it.w||16,4);s+=`<rect x="${a}" y="${b}" width="${c}" height="${d2}" fill="url(#nt)" stroke="#fff" stroke-width=".8"/>`;break;}
    case 'mg':{const[a,b,c,d2]=gr(it,7,2.2);s+=`<rect x="${a}" y="${b}" width="${c}" height="${d2}" fill="url(#nt)" stroke="#fff" stroke-width=".8"/>`;break;}
    case 'c':s+=`<path d="M${it.x},${it.y-2.3} L${it.x+2.1},${it.y+1.6} L${it.x-2.1},${it.y+1.6} Z" fill="${it.col||'#F2C14E'}" stroke="#000" stroke-opacity=".25" stroke-width=".3"/>`;break;
    case 'pass':later.push(OP(it)+`<polyline points="${poly(it.pts)}" fill="none" stroke="#fff" stroke-width=".8" stroke-dasharray="2 1.4" marker-end="url(#aW)"/>`+CL(it));break;
    case 'run':later.push(OP(it)+`<polyline points="${poly(it.pts)}" fill="none" stroke="#FFD166" stroke-width=".7" marker-end="url(#aO)"/>`+CL(it));break;
    case 'drib':later.push(OP(it)+`<path d="${zig(it.pts)}" fill="none" stroke="#fff" stroke-width=".7" marker-end="url(#aW)"/>`+CL(it));break;
    case 'shot':later.push(OP(it)+`<polyline points="${poly(it.pts)}" fill="none" stroke="#fff" stroke-width="1.5" marker-end="url(#aW)"/>`+CL(it));break;
    case 'p':later.push(`<circle cx="${it.x}" cy="${it.y}" r="3.3" fill="${TEAMC[it.s]||TEAMC.a}" stroke="#fff" stroke-width=".7"/>`+(it.n?`<text x="${it.x}" y="${it.y+1.2}" font-size="${String(it.n).length>1?2.4:3.2}" fill="#fff" text-anchor="middle" font-weight="700">${esc(it.n)}</text>`:(it.s==='co'?`<text x="${it.x}" y="${it.y+1.2}" font-size="3" fill="#fff" text-anchor="middle" font-weight="700">${I18N.t('מ')}</text>`:'')));break;
    case 'ball':later.push(`<circle cx="${it.x}" cy="${it.y}" r="1.7" fill="#fff" stroke="#1E1E1E" stroke-width=".45"/><circle cx="${it.x}" cy="${it.y}" r=".6" fill="#1E1E1E"/>`);break;
    case 'badge':later.push(`<circle cx="${it.x}" cy="${it.y}" r="2.6" fill="${it.hi?'#1E45B0':'#0E1B3D'}" stroke="#fff" stroke-width=".4"/><text x="${it.x}" y="${it.y+1.1}" font-size="3" fill="#fff" text-anchor="middle" font-weight="700">${esc(it.n)}</text>`);break;
    case 'txt':later.push(`<text x="${it.x}" y="${it.y}" font-size="3.4" fill="#fff" text-anchor="middle" paint-order="stroke" stroke="#0B2A18" stroke-width=".9" stroke-opacity=".7">${esc(I18N.tr(it.s))}</text>`);break;
  }});
  return s+later.join('')+'</svg>';
}

/* ---------- sheet ---------- */
function sheet(html){ $('#sheet').innerHTML='<div class="grab"></div>'+html; $('#sheetWrap').classList.add('open'); }
function closeSheet(){ $('#sheetWrap').classList.remove('open'); }
$('#sheetBd').onclick=closeSheet;

/* ---------- drills (bundled global library + club drills) ---------- */
function allDrills(){ return [...DRILLS, ...S.dbDrills.map(d=>({id:d.id,name:d.name,cat:d.cat,ages:d.ages,min:d.min,players:d.players,area:d.area,equip:d.equip,setup:d.setup,desc:d.descr,points:d.points||[],prog:d.prog||[],src:d.src||'המועדון',diag:d.diagram,notes:d.notes||'',created_by:d.created_by,mine:true})).map(d=>{ if(d.ages&&d.ages.includes('c')&&!d.ages.includes('d')) d.ages=[...d.ages,'d']; return d; })]; }
const drillById=id=>allDrills().find(d=>d.id===id);

/* ---------- attributes ---------- */
function teamAttrs(includeGk){
  const prof = S.team?S.team.age_profile:'b';
  return S.attrs.filter(a=>a.ages.includes(prof) && (a.grp!=='gk' || includeGk));
}
const ATTR_LABEL = k => (S.attrs.find(a=>a.key===k)||{}).label || k;
const GRP_LABEL = {tech:'טכני',phys:'פיזי',mental:'מנטלי',gk:'שוער'};

/* quick tags → attribute + score */
const TAGS=[
 // טכני
 {g:'tech',t:'מסירה מצוינת',a:'passing',s:5,good:1},{g:'tech',t:'מסירה שוברת קו',a:'passing',s:5,good:1,fx:[['decisions',4,.6]]},{g:'tech',t:'מסירה לא מדויקת',a:'passing',s:2},
 {g:'tech',t:'קבלה מצוינת',a:'first_touch',s:5,good:1},{g:'tech',t:'גוף פתוח בקבלה',a:'first_touch',s:4,good:1,fx:[['decisions',4,.4]]},{g:'tech',t:'קבלה בורחת',a:'first_touch',s:2},
 {g:'tech',t:'עבר 1v1',a:'dribbling',s:5,good:1,fx:[['agility',4,.3],['courage',5,.3]]},{g:'tech',t:'שמר על הכדור בלחץ',a:'dribbling',s:4,good:1,fx:[['strength',4,.4],['first_touch',4,.3]]},{g:'tech',t:'איבד בכדרור',a:'dribbling',s:2,fx:[['decisions',2,.3]]},
 {g:'tech',t:'סיום טוב',a:'shooting',s:5,good:1,fx:[['first_touch',4,.3]]},{g:'tech',t:'בעיטה למסגרת',a:'shooting',s:4,good:1},{g:'tech',t:'החמצה',a:'shooting',s:2,w:.6,fx:[]},
 {g:'tech',t:'נגיחה טובה',a:'heading',s:4,good:1},{g:'tech',t:'נמנע מנגיחה',a:'heading',s:2},
 {g:'tech',t:'ארוכה מדויקת',a:'long_pass',s:5,good:1},{g:'tech',t:'ארוכה לא מדויקת',a:'long_pass',s:2},
 {g:'tech',t:'הגבהה מדויקת',a:'crossing',s:5,good:1},{g:'tech',t:'הגבהה לא מדויקת',a:'crossing',s:2},
 {g:'tech',t:'תיקול נקי',a:'tackling',s:5,good:1,fx:[['decisions',4,.3]]},{g:'tech',t:'עבירה מיותרת',a:'tackling',s:2,fx:[['decisions',2,.4]]},
 {g:'tech',t:'שליטה יפה בכדור',a:'ball_control',s:5,good:1},{g:'tech',t:'הכדור בורח לו',a:'ball_control',s:2},
 // מנטלי
 {g:'mental',t:'החלטה טובה',a:'decisions',s:4,good:1},{g:'mental',t:'ראש למעלה',a:'decisions',s:4,good:1,fx:[['passing',4,.3]]},{g:'mental',t:'איבוד קל',a:'decisions',s:2,fx:[['focus',2,.4]]},{g:'mental',t:'החלטה שגויה',a:'decisions',s:2},
 {g:'mental',t:'מרוכז',a:'focus',s:5,good:1},{g:'mental',t:'לא מרוכז',a:'focus',s:2},
 {g:'mental',t:'משחק קבוצתי',a:'teamwork',s:5,good:1},{g:'mental',t:'דיבר עם החבר׳ה',a:'teamwork',s:4,good:1},{g:'mental',t:'משחק לבד',a:'teamwork',s:2,fx:[['decisions',2,.4]]},
 {g:'mental',t:'לחץ מצוין',a:'determination',s:5,good:1,fx:[['stamina',4,.4],['teamwork',4,.4]]},{g:'mental',t:'לא ויתר',a:'determination',s:5,good:1,fx:[['stamina',4,.3]]},{g:'mental',t:'לא חזר להגנה',a:'determination',s:2,fx:[['teamwork',2,.5]]},{g:'mental',t:'ויתר מהר',a:'determination',s:2,fx:[['focus',2,.3]]},
 {g:'mental',t:'מנהיגות',a:'leadership',s:5,good:1,fx:[['teamwork',4,.3]]},{g:'mental',t:'עודד חברים',a:'leadership',s:4,good:1,fx:[['teamwork',4,.5]]},
 {g:'mental',t:'הקשיב והשתתף',a:'listening',s:5,good:1,fx:[['focus',4,.4]]},{g:'mental',t:'לא הקשיב',a:'listening',s:2,fx:[['focus',2,.4]]},
 {g:'mental',t:'אמיץ',a:'courage',s:5,good:1},{g:'mental',t:'נרתע',a:'courage',s:2},
 // פיזי
 {g:'phys',t:'מהיר',a:'speed',s:5,good:1},{g:'phys',t:'איטי לחזור',a:'speed',s:2,fx:[['determination',2,.4]]},
 {g:'phys',t:'שינוי כיוון חד',a:'agility',s:5,good:1},{g:'phys',t:'מסורבל',a:'agility',s:2},
 {g:'phys',t:'ניצח במאבק',a:'strength',s:5,good:1,fx:[['determination',4,.3],['courage',5,.3]]},{g:'phys',t:'הפסיד במאבק',a:'strength',s:2,fx:[]},
 {g:'phys',t:'רץ עד הסוף',a:'stamina',s:5,good:1,fx:[['determination',5,.5]]},{g:'phys',t:'נגמר מהר',a:'stamina',s:2},
 {g:'phys',t:'תנועה מתואמת',a:'coordination',s:5,good:1},{g:'phys',t:'מתקשה בתיאום',a:'coordination',s:2},
 // שוער
 {g:'gk',t:'עצירה מצוינת',a:'gk_handling',s:5,good:1},{g:'gk',t:'שחרר כדור',a:'gk_handling',s:2},
 {g:'gk',t:'יציאה טובה',a:'gk_positioning',s:5,good:1,fx:[['courage',5,.3]]},{g:'gk',t:'מיקום שגוי',a:'gk_positioning',s:2},
 {g:'gk',t:'משחק טוב ברגל',a:'gk_feet',s:4,good:1,fx:[['passing',4,.3]]},{g:'gk',t:'ניהל את ההגנה',a:'gk_comm',s:5,good:1,fx:[['leadership',4,.4]]}
];
// the tags that fit this team's age profile (and the goalkeeper ones only for a goalkeeper)
function tagsForTeam(isGk){const ks=new Set(teamAttrs(true).map(a=>a.key));return TAGS.filter(t=>ks.has(t.a)&&(isGk||t.g!=='gk'));}

/* ---------- quick notes ----------
   One tap = one observation (attribute + score). The sheet stays open, so a coach can
   tap three notes in a row; the last one can be undone. */
const NOTE_GRP={tech:'טכני',mental:'מנטלי',phys:'פיזי',gk:'שוער'};
let NOTE_LOG=[];
function notesPanel(pid){
  const p=S.players.find(x=>x.id===pid)||{};
  const tags=tagsForTeam(p.position==='שוער');
  NOTE_LOG=[];
  const groups=['gk','tech','mental','phys'].filter(g=>tags.some(t=>t.g===g));
  return `<div class="notes">${typeof voiceBtn==='function'?voiceBtn(pid):''}${groups.map(g=>`<div class="ngrp"><p class="xs muted">${NOTE_GRP[g]}</p>
    <div class="nbtns">${tags.filter(t=>t.g===g).map(t=>{const i=TAGS.indexOf(t);
      return `<button class="nb ${t.good?'up':'dn'}" onclick="tapNote('${pid}',${i},this)">${esc(t.t)}</button>`;}).join('')}</div></div>`).join('')}
    <div class="spread" style="margin-top:8px"><span class="xs muted" id="nlog">כל הקשה נשמרת כנתון בכרטיס השחקן</span>
      <button class="btn sm ghost" id="nundo" onclick="undoNote()" disabled>ביטול אחרון</button></div></div>`;
}
async function tapNote(pid,i,btn){
  const t=TAGS[i]; if(!t) return;
  btn.classList.add('hit'); setTimeout(()=>btn.classList.remove('hit'),500);
  const rows=await addEffects(pid,[[t.a,t.s,t.w||1],...(t.fx||[])],{source:S.match?'match':'tag',tag:t.t,drill_id:S.sessionDrills?.[LIVE?.idx]?.id||null,match_id:S.match?S.match.id:null});
  NOTE_LOG.push(rows);
  const l=$('#nlog'); if(l) l.textContent=`נרשמו ${NOTE_LOG.length}: ${NOTE_LOG.slice(-3).map(r=>r[0].tag).join(' · ')}`;
  const u=$('#nundo'); if(u) u.disabled=false;
  if(typeof drawTiles==='function') drawTiles(); if(S.match&&typeof drawMatchTiles==='function') drawMatchTiles();
}
async function undoNote(){
  const rows=NOTE_LOG.pop(); if(!rows) return; const r=rows[0];
  const ids=rows.map(x=>x.id);
  LOCAL_OBS=LOCAL_OBS.filter(o=>!ids.includes(o.id)); LS('obs',LOCAL_OBS.slice(-800));
  await sb.from('coach_observations').update({voided:true}).in('id',ids);
  const l=$('#nlog'); if(l) l.textContent=NOTE_LOG.length?`נרשמו ${NOTE_LOG.length}`:'בוטל';
  const u=$('#nundo'); if(u) u.disabled=!NOTE_LOG.length;
  if(typeof drawTiles==='function') drawTiles(); if(S.match&&typeof drawMatchTiles==='function') drawMatchTiles();
  toast('בוטל: '+r.tag);
}

/* ---------- observations ---------- */
async function addObs(playerId, attribute, score, extra){
  const row={id:uid(),player_id:playerId,team_id:(extra&&extra.team_id)||S.team?.id||null,attribute,score,
    source:(extra&&extra.source)||'drill',session_id:(extra&&extra.session_id)||S.session?.id||null,
    match_id:(extra&&extra.match_id)||null,drill_id:(extra&&extra.drill_id)||null,
    tag:(extra&&extra.tag)||null,note:(extra&&extra.note)||null,by_user:S.user?.id||null,at:(extra&&extra.at)||new Date().toISOString(),
    weight:(extra&&extra.weight)||1};
  LOCAL_OBS.push(row); LS('obs',LOCAL_OBS.slice(-800));
  await push('coach_observations',row);
  return row;
}
/* one action → several attributes: [[attribute, score 1-5, weight], …]; attributes this team does not rate are skipped */
async function addEffects(pid, effects, extra){
  const ks=new Set(teamAttrs(true).map(a=>a.key)); const out=[];
  for(const [a,sc,w] of effects){ if(!ks.has(a)) continue; out.push(await addObs(pid,a,sc,{...extra,weight:w||1})); }
  return out;
}
let LOCAL_OBS = LS('obs')||[];
function localCounts(playerId, sessionId){ return LOCAL_OBS.filter(o=>o.player_id===playerId && (!sessionId||o.session_id===sessionId)).length; }

/* ---------- attribute scores (client-side, same formula as the DB view) ---------- */
/* Attribute score, 1-20 — the same formula as the database view coach_player_attributes:
     value  = 1 + (score-1)·4.75                       1-5 → 1-20
     weight = source × observation weight × 0.5^(days/28)
     score  = (Σ weight·value + 3·prior) / (Σ weight + 3)
     prior  = the player's overall level across all attributes, itself pulled toward 10.5
   So one tap moves a score a little, many taps move it a lot, old taps fade over a month,
   and an attribute with few observations stays close to the player's general level. */
const SRC_W={match:1.3,test:1.5,challenge:0.7};
function scoreFromObs(obs){
  const now=Date.now(); const byAttr={}; let pw=0, pv=0;
  obs.forEach(o=>{
    if(o.voided) return;
    const days=(now-new Date(o.at).getTime())/864e5;
    if(days>400) return;
    const v=1+(o.score-1)*4.75, ow=+(o.weight||1);
    const w=(SRC_W[o.source]||1)*ow*Math.pow(0.5, days/28);
    pw+=w; pv+=w*v;
    const b = byAttr[o.attribute] || (byAttr[o.attribute]={sw:0,sv:0,n90:0,rw:0,rv:0,rn:0,qw:0,qv:0,qn:0});
    b.sw+=w; b.sv+=w*v;
    if(days<=90)b.n90++;
    if(days<=30){b.rw+=ow;b.rv+=ow*v;b.rn++;} else if(days<=120){b.qw+=ow;b.qv+=ow*v;b.qn++;}
  });
  const prior=(pv+5*10.5)/(pw+5);
  const out={};
  for(const [k,b] of Object.entries(byAttr)){
    out[k]={score:+((b.sv+3*prior)/(b.sw+3)).toFixed(1), n90:b.n90, weight:b.sw,
      conf: b.sw>=8?'high':b.sw>=3?'med':b.sw>=1?'low':'none',
      trend: (b.rn>=2&&b.qn>=2)? +(b.rv/b.rw - b.qv/b.qw).toFixed(1) : null};
  }
  return out;
}
/* ---------- data loading ---------- */
async function bootstrap(){
  // 1 — an invite link was opened
  const url = new URL(location.href);
  const tok = url.searchParams.get('t');
  if(tok){
    splash('מחברים אותך…');
    const r = await fn('claim',{token:tok});
    history.replaceState({},'',url.pathname);
    if(r.error) return renderLogin(r.error);
    const s2 = await useToken(r.token_hash);
    if(s2.error) return renderLogin(s2.error);
    if(r.device) LS('dev', r.device);
  }

  // 2 — an existing session, or a device we already bound
  let user = null;
  if(navigator.onLine){ const r=await sb.auth.getUser(); user=r.data.user;
    // a weak signal on the pitch is not a logout: fall back to the user saved on the tablet
    if(!user && r.error && /fetch|network|Failed|abort/i.test(r.error.name+' '+r.error.message)) user=OFF.savedUser(); }
  else user = OFF.savedUser();
  if(!user && navigator.onLine){
    const d = LS('dev');
    if(d){
      splash('מחברים אותך…');
      const r = await fn('device',{device:d});
      if(r.token_hash){ await useToken(r.token_hash); ({data:{user}} = await sb.auth.getUser()); }
      else if(r.error && /מזוהה/.test(r.error)) LS('dev', null);
    }
  }
  if(!user){ renderLogin(); return; }
  S.user = user;
  if(RECOVERY && !bootstrap.pwDone) return renderNewPassword();

  // 3 — staff go to the coach app, everyone else to the family app
  const meta = user.user_metadata||{};
  let {data:mem} = await sb.from('coach_members').select('*, coach_clubs(*)').eq('user_id',user.id).in('role',['coach','assistant','manager']);
  if(!mem){   // no answer at all (not "no club") — never send a coach to the new-club screen because of signal
    if(navigator.onLine){ bootstrap.tries=(bootstrap.tries||0)+1;
      if(bootstrap.tries>4){ splash('לא מצליחים להתחבר לשרת. נסו לרענן בעוד רגע.'); return; }
      splash('החיבור חלש — מנסים שוב…'); setTimeout(bootstrap, 5000); }
    else { splash('אין קליטה, והאפליקציה עוד לא נפתחה בטאבלט הזה עם אינטרנט. פתחו אותה פעם אחת עם קליטה — מאז היא תעבוד גם בלי.');
      addEventListener('online',()=>bootstrap(),{once:true}); }
    return;
  }
  if(!mem||!mem.length){
    if(meta.coach || meta.role==='coach' || !meta.role){ renderNewClub(); return; }
    S.role = meta.role==='player' ? 'player' : 'parent'; return bootstrapFamily();
  }
  S.club = mem[0].coach_clubs; S.role = mem[0].role;
  const [t,a,d] = await Promise.all([
    sb.from('coach_teams').select('*').eq('club_id',S.club.id).order('name'),
    sb.from('coach_attributes').select('*').order('sort'),
    sb.from('coach_drills').select('*').eq('club_id',S.club.id)
  ]);
  S.teams=t.data||[]; S.attrs=a.data||[]; S.dbDrills=d.data||[];
  const savedTeam=LS('team'); S.team = S.teams.find(x=>x.id===savedTeam) || S.teams[0] || null;
  if(S.team) await loadTeam();
  $('#nav').classList.remove('hide');
  flushQueue();
  go(LS('view')||'home',null,{replace:true});
  setTimeout(warmForField, 1500);
}
function splash(t){
  $('#nav').classList.add('hide');
  $('#app').innerHTML = `<div class="wrap" style="padding-top:90px;text-align:center">
    <img src="icon.svg" alt="" style="width:56px;height:56px"><p class="muted" style="margin-top:12px">${esc(t)}</p></div>`;
}
async function loadTeam(){
  if(!S.team){S.players=[];return;}
  LS('team',S.team.id);
  const {data} = await sb.from('coach_team_players').select('player_id, coach_players(*)').eq('team_id',S.team.id);
  S.players=(data||[]).map(r=>r.coach_players).filter(Boolean)
    .sort((a,b)=>(a.shirt_no||99)-(b.shirt_no||99)||a.name.localeCompare(b.name,'he'));
}

/* ---------- router ----------
   Every screen change is a browser-history entry, so the in-app back
   button, Android's back button and the swipe-back gesture all walk the
   same stack. Re-rendering the screen you are already on replaces the
   entry instead of stacking duplicates. */
const VIEWS={};
const TOP_VIEWS=['home','squad','program','library','more'];
let NAV_DEPTH=0, CUR_ARG=null;
function go(v,arg,opt){ opt=opt||{};
  const same = v===S.view && JSON.stringify(arg??null)===JSON.stringify(CUR_ARG??null);
  if(!opt.fromPop){
    let st={v,arg:arg??null,d:NAV_DEPTH};
    try{
      if(opt.replace || same || !history.state){ history.replaceState(st,''); }
      else if(TOP_VIEWS.includes(v)){ NAV_DEPTH=0; st.d=0; history.pushState(st,''); }
      else { NAV_DEPTH++; st.d=NAV_DEPTH; history.pushState(st,''); }
    }catch(e){}
  }
  S.view=v; CUR_ARG=arg??null;
  LS('view',TOP_VIEWS.includes(v)?v:'home'); closeSheet();
  $$('#nav button').forEach(b=>b.classList.toggle('on', b.dataset.go===v || (b.dataset.go==='program'&&['plan','program'].includes(v))));
  window.scrollTo(0,0);
  (VIEWS[v]||VIEWS.home)(arg);
}
function goBack(){
  if($('#sheetWrap').classList.contains('open')) return closeSheet();
  if(history.state && history.state.d>0) history.back();
  else go('home');
}
$$('#nav button').forEach(b=>b.onclick=()=>go(b.dataset.go));
function screen(title, body, actions){
  $('#app').innerHTML = `<div class="topbar"><div class="in">
      ${TOP_VIEWS.includes(S.view)?'':`<button class="iconbtn" id="bk" aria-label="חזרה">${I18N.back()}</button>`}
      <h1>${esc(title)}</h1>${actions||''}</div></div>
    <div class="wrap">${body}</div>`;
  const bk=$('#bk'); if(bk) bk.onclick=goBack;
}
addEventListener('popstate',e=>{
  if(S.role==='parent'||S.role==='player'){ if(typeof famHome==='function') famHome(); return; }
  // a bottom sheet is open: back closes it and keeps the screen
  if($('#sheetWrap').classList.contains('open')){ closeSheet(); try{history.pushState({v:S.view,arg:CUR_ARG,d:NAV_DEPTH},'');}catch(err){} return; }
  const st=e.state;
  if(st && st.v){ NAV_DEPTH=st.d||0; go(st.v, st.arg, {fromPop:true}); }
  else go('home',null,{fromPop:true});
});

/* ---------- auth screens ----------
   One door for everyone: phone (or username / email) + password.
   The first time — or after a forgotten password — the person proves the
   phone with an SMS code and chooses their own password. */
function normPhoneDigits(v){
  let d=String(v||'').replace(/[^0-9+]/g,'');
  if(d.startsWith('+')) d=d.slice(1); else if(d.startsWith('00')) d=d.slice(2);
  else if(d.startsWith('0')) d='972'+d.slice(1); else if(d.length>=8&&d.length<=9) d='972'+d;
  return d.replace(/\D/g,'');
}
const looksPhone=v=>/^[+0-9][0-9\s\-()]{7,}$/.test(String(v||'').trim());
function loginCandidates(id){
  id=id.trim();
  if(id.includes('@')) return [id.toLowerCase()];
  if(looksPhone(id)){ const d=normPhoneDigits(id); return [`p${d}@guardian.sinaiclub.com`,`k${d}@kid.sinaiclub.com`]; }
  return [id.toLowerCase()+'@kid.sinaiclub.com'];
}
function renderLogin(err){
  $('#nav').classList.add('hide');
  let mode='in';                 // in | otp (first time / forgot) | signup (new coach) | email (coach signup by email)
  let sent=null;                 // {phone, options}
  const head={in:'אימונים, נתוני שחקנים והורים — במקום אחד', otp:'כניסה ראשונה או שכחתי סיסמה', signup:'פתיחת חשבון מאמן', email:'פתיחת חשבון מאמן עם אימייל'};
  const draw=()=>{
    let body='';
    if(mode==='in') body=`
      <label class="f">טלפון, אימייל או שם משתמש<input id="id" autocomplete="username" autocapitalize="off" dir="ltr" placeholder="050-0000000"></label>
      <label class="f">סיסמה<input id="pw" type="password" autocomplete="current-password"></label>
      <button class="btn lime big" id="doBtn">כניסה</button>
      <button class="btn ghost sm" id="toOtp">כניסה ראשונה / שכחתי סיסמה</button>`;
    else if(!sent) body=`
      ${mode==='signup'?'<label class="f">שם מלא<input id="nm" autocomplete="name"></label>':''}
      ${mode==='email'?`<label class="f">אימייל<input id="em" type="email" inputmode="email" autocapitalize="off" dir="ltr"></label>
        <label class="f">סיסמה<input id="pw" type="password" autocomplete="new-password" placeholder="6 תווים לפחות"></label>`
      :mode==='otp'?`<label class="f">טלפון או אימייל<input id="ph" autocapitalize="off" autocomplete="username" dir="ltr" placeholder="050-0000000 / name@gmail.com"></label>
        <p class="xs muted">לטלפון נשלח קוד ב-SMS. לאימייל נשלח קישור לבחירת סיסמה חדשה.</p>`
      :`<label class="f">מספר טלפון<input id="ph" type="tel" inputmode="tel" autocomplete="tel" dir="ltr" placeholder="050-0000000"></label>
        <p class="xs muted">נשלח קוד ב-SMS. אחריו בוחרים סיסמה, ומעכשיו נכנסים עם הטלפון והסיסמה.</p>`}
      <button class="btn primary big" id="doBtn">${mode==='email'?'פתיחת חשבון':'שליחת קוד'}</button>`;
    else body=`
      <p class="sm">שלחנו קוד ל-<b dir="ltr">${esc(sent.phone)}</b></p>
      ${sent.options&&sent.options.length>1?`<label class="f">למי הכניסה?<select id="who">${sent.options.map(o=>`<option value="${o.id}">${esc(o.label)}</option>`).join('')}</select></label>`:''}
      <label class="f">הקוד<input id="cd" inputmode="numeric" autocomplete="one-time-code" maxlength="8" dir="ltr" style="letter-spacing:6px;text-align:center;font-size:20px"></label>
      <label class="f">בחירת סיסמה<input id="pw" type="password" autocomplete="new-password" placeholder="6 תווים לפחות"></label>
      <button class="btn primary big" id="doBtn">אישור וכניסה</button>
      <button class="btn ghost sm" id="reBtn">מספר אחר / שליחה מחדש</button>`;
    $('#app').innerHTML=`<div class="wrap" style="max-width:420px;padding-top:50px">
    <div style="text-align:center;margin-bottom:20px">
      <div class="brandmark"><img src="icon.svg" alt="">
      <h1 class="brandword" aria-label="SINAI Club"><b>SINAI</b><span> Club</span></h1></div>
      <p class="muted sm" style="margin-top:8px">${head[mode]}</p>
    </div>
    <div class="card stack">
      <div id="err" class="alert hide"></div>
      ${body}
    </div>
    <div style="text-align:center;margin-top:14px" class="stack">
      ${mode==='in'?'<button class="btn ghost sm" id="toUp">מאמן חדש? פתיחת חשבון</button>':'<button class="btn ghost sm" id="toIn">← חזרה לכניסה</button>'}
      ${mode==='signup'&&!sent?'<button class="btn ghost sm" id="toEm">הרשמה עם אימייל במקום</button>':''}
    </div>
    <div class="langrow">${I18N.picker()}</div></div>`;
    if(err) showErr(err);
    const on=(id,f)=>{ const x=$('#'+id); if(x) x.onclick=f; };
    on('toOtp',()=>{ mode='otp'; sent=null; err=null; draw(); });
    on('toUp',()=>{ mode='signup'; sent=null; err=null; draw(); });
    on('toIn',()=>{ mode='in'; sent=null; err=null; draw(); });
    on('toEm',()=>{ mode='email'; err=null; draw(); });
    on('reBtn',()=>{ sent=null; draw(); });
    $('#doBtn').onclick=submit;
    $$('#app input').forEach(i=>i.onkeydown=e=>{ if(e.key==='Enter') submit(); });
  };
  const showErr=m=>{ const e=$('#err'); e.textContent=m; e.classList.remove('hide'); };
  const busy=(b,t)=>{ const x=$('#doBtn'); x.disabled=b; if(t) x.textContent=t; };
  async function submit(){
    $('#err').classList.add('hide'); err=null;
    if(mode==='in'){
      const id=$('#id').value.trim(), pw=$('#pw').value;
      if(!id||!pw) return showErr('צריך טלפון, אימייל או שם משתמש, וסיסמה');
      busy(true,'מתחבר…');
      for(const email of loginCandidates(id)){
        const {error}=await sb.auth.signInWithPassword({email,password:pw});
        if(!error) return bootstrap();
      }
      busy(false,'כניסה');
      return showErr('הפרטים לא נכונים. פעם ראשונה כאן? "כניסה ראשונה / שכחתי סיסמה"');
    }
    if(mode==='email'){
      const email=$('#em').value.trim(), password=$('#pw').value;
      if(!email) return showErr('צריך למלא אימייל');
      if(password.length<6) return showErr('הסיסמה צריכה להיות באורך 6 תווים לפחות');
      busy(true,'פותח חשבון…');
      const r=await fn('signup',{email,password});
      if(r.error){ busy(false,'פתיחת חשבון'); return showErr(r.error); }
      const {error}=await sb.auth.signInWithPassword({email,password});
      if(error){ busy(false,'פתיחת חשבון'); return showErr(error.message); }
      return bootstrap();
    }
    const purpose = mode==='signup'?'signup':'login';
    if(!sent){
      const ph=$('#ph').value.trim(); if(!ph) return showErr(mode==='otp'?'צריך טלפון או אימייל':'צריך מספר טלפון');
      if(mode==='otp' && ph.includes('@')){
        busy(true,'שולח…');
        const {error}=await sb.auth.resetPasswordForEmail(ph.toLowerCase(),{redirectTo:location.origin+location.pathname});
        busy(false,'שליחת קוד');
        if(error) return showErr(/rate|seconds/i.test(error.message)?'נשלח כבר מייל לפני רגע. חכו דקה ונסו שוב.':'לא הצלחנו לשלוח: '+error.message);
        $('#app .card').innerHTML=`<div class="alert ok">אם הכתובת <b dir="ltr">${esc(ph)}</b> רשומה אצלנו, נשלח אליה מייל עם קישור לבחירת סיסמה חדשה. פתחו אותו במכשיר הזה. (לא הגיע? בדקו בספאם.)</div>`;
        return;
      }
      if(mode==='signup' && !$('#nm').value.trim()) return showErr('צריך שם');
      if(mode==='signup') renderLogin.name_=$('#nm').value.trim();
      busy(true,'שולח…');
      const r=await fn('otp_send',{phone:ph,purpose});
      if(r.error){ busy(false,'שליחת קוד'); return showErr(r.error); }
      sent={phone:ph,options:r.options||[]}; return draw();
    }
    const code=$('#cd').value.trim(), password=$('#pw').value;
    if(code.length<4) return showErr('צריך את הקוד מה-SMS');
    if(password.length<6) return showErr('סיסמה של 6 תווים לפחות');
    const who=$('#who')?$('#who').value:(sent.options[0]?.id||'me');
    busy(true,'בודק…');
    const r=await fn('otp_check',{phone:sent.phone,code,password,purpose,who,name:renderLogin.name_||''});
    if(r.error){ busy(false,'אישור וכניסה'); return showErr(r.error); }
    const s2=await useToken(r.token_hash); if(s2.error){ busy(false,'אישור וכניסה'); return showErr(s2.error); }
    bootstrap();
  }
  draw();
}
function renderNewPassword(){
  $('#nav').classList.add('hide');
  $('#app').innerHTML=`<div class="wrap" style="max-width:420px;padding-top:50px">
    <div style="text-align:center;margin-bottom:20px"><div style="font-size:44px">🔑</div>
      <h1 style="margin-top:8px">סיסמה חדשה</h1>
      <p class="muted sm" dir="ltr">${esc(S.user.email||'')}</p></div>
    <div class="card stack">
      <div id="err" class="alert hide"></div>
      <label class="f">סיסמה חדשה<input id="np1" type="password" autocomplete="new-password" placeholder="6 תווים לפחות"></label>
      <label class="f">שוב, לאימות<input id="np2" type="password" autocomplete="new-password"></label>
      <button class="btn primary big" id="npBtn">שמירה וכניסה</button>
    </div></div>`;
  const err=m=>{ const e=$('#err'); e.textContent=m; e.classList.remove('hide'); };
  $('#npBtn').onclick=async()=>{
    const a=$('#np1').value, b=$('#np2').value;
    if(a.length<6) return err('הסיסמה צריכה להיות באורך 6 תווים לפחות');
    if(a!==b) return err('שתי הסיסמאות לא זהות');
    const btn=$('#npBtn'); btn.disabled=true; btn.textContent='שומר…';
    const {error}=await sb.auth.updateUser({password:a});
    if(error){ btn.disabled=false; btn.textContent='שמירה וכניסה'; return err(/same|different/i.test(error.message)?'זו הסיסמה הקיימת — בחרו סיסמה אחרת':error.message); }
    bootstrap.pwDone=true; toast('הסיסמה עודכנה ✓'); bootstrap();
  };
}
function renderNewClub(){
  $('#nav').classList.add('hide');
  $('#app').innerHTML=`<div class="wrap" style="max-width:440px;padding-top:40px">
    <h1>ברוך הבא</h1><p class="muted sm" style="margin:6px 0 18px">נקים את המועדון והקבוצה הראשונה.</p>
    <div class="card stack">
      <label class="f">שם המועדון / בית הספר<input id="cn" placeholder="בית הספר לכדורגל"></label>
      <label class="f">שם הקבוצה הראשונה<input id="tn" placeholder="כיתה ג׳"></label>
      <label class="f">קבוצת גיל<select id="ap"><option value="a">גן–ב׳</option><option value="b" selected>ג׳–ד׳</option><option value="c">ה׳–ז׳</option><option value="d">ח׳ ומעלה</option></select></label>
      <label class="f">אורך אימון (דקות)<input id="sm" type="number" value="60" class="num"></label>
      <button class="btn primary big" id="mk">יוצרים</button>
      <p class="xs muted" id="m2"></p>
    </div></div>`;
  $('#mk').onclick=async()=>{
    const cn=$('#cn').value.trim()||I18N.t('המועדון שלי'), tn=$('#tn').value.trim()||I18N.t('קבוצה א׳');
    $('#m2').textContent='יוצר…';
    const {data:club,error}=await sb.from('coach_clubs').insert({name:cn}).select().single();
    if(error){$('#m2').textContent='שגיאה: '+error.message;return;}
    await sb.from('coach_members').insert({user_id:S.user.id,club_id:club.id,role:'coach',display_name:S.user.email});
    await sb.from('coach_teams').insert({club_id:club.id,name:tn,age_profile:$('#ap').value,session_minutes:+$('#sm').value||60,coach_id:S.user.id});
    bootstrap();
  };
}

/* ---------- language ----------
   The DOM is translated in place; screens are drawn again so dates, weekdays and lists
   built in code follow the new language too. */
I18N.onChange(()=>{
  if($('#sheetWrap').classList.contains('open')) closeSheet();
  if(S.user && (S.role==='parent'||S.role==='player') && typeof famHome==='function' && FAM.kids.length) return famHome();
  if(S.user && S.club && VIEWS[S.view]) return go(S.view, CUR_ARG, {replace:true});
});

/* ---------- start ----------
   every screen module must be parsed before we route anywhere,
   so the boot happens after the document finishes loading. */
function startApp(){
  renderOffline();
  // keeps the app's own files on the tablet, so it opens on the pitch without signal
  if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
  bootstrap();
}
if(document.readyState==='complete') startApp();
else addEventListener('load', startApp, {once:true});
