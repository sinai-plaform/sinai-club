/* ===== SINAI Club — voice notes + screen awake (2.6.0) =====
   Hold the mic, say "יואב, מסירה מעולה לעומק", let go. A quick tap starts a recording
   that stops on the next tap (good with gloves). Max 30 seconds.
   The audio goes to the coach-voice function (transcript + structured notes) and is not
   stored anywhere. Without signal the recording waits on the tablet (IndexedDB) and is sent
   when the connection is back.
   Results:
     • a clear player → saved right away as observations (weight ×0.8, tag "🎙 …"), with undo
     • a name shared by two players / no name → "לטיפול" inbox, resolved by one tap
     • discipline → the discipline log;  a plain note (pain, tired…) → inbox, can be added to the coach note
     • the foot used is compared with the player's real foot: the other foot is marked "רגל חלשה" */

const VOICE = { rec:null, stream:null, chunks:[], pid:null, t0:0, at:null, ctx:null, mime:'', cap:null,
                idle:null, toggle:false, busy:false, last:null, err:'' };
const VOICE_FN = SB_URL + '/functions/v1/coach-voice';
const VOICE_W = 0.8;          // a spoken note counts a little less than a tap
const VOICE_MAX_MS = 30000;

/* ---------- styles ---------- */
(function(){
  const st=document.createElement('style');
  st.textContent=`
  .vmic{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;margin-bottom:10px;
    min-height:48px;border-radius:var(--r);border:1.5px dashed var(--accent);background:var(--surface2);
    color:var(--accent);font-weight:700;font-size:15px;touch-action:none;user-select:none;-webkit-user-select:none}
  .vmic.rec{background:var(--bad);border:1.5px solid var(--bad);color:#fff;animation:vpulse 1s infinite}
  .vfab{position:fixed;z-index:40;inset-inline-start:16px;bottom:calc(84px + env(safe-area-inset-bottom));
    width:64px;height:64px;min-height:0;margin:0;border-radius:50%;border:0;background:var(--accent);color:#fff;
    font-size:26px;box-shadow:var(--shadow)}
  .vfab.rec{background:var(--bad);border:0}
  .vfab .vbadge,.vbox .vbadge{position:absolute;top:-4px;inset-inline-end:-4px;min-width:22px;height:22px;padding:0 6px;
    border-radius:11px;background:var(--lime);color:var(--lime-ink);font-size:12px;font-weight:800;
    display:flex;align-items:center;justify-content:center}
  .vbox{position:fixed;z-index:40;inset-inline-start:88px;bottom:calc(96px + env(safe-area-inset-bottom));
    height:40px;padding:0 14px;border-radius:20px;border:1px solid var(--line);background:var(--surface);
    color:var(--ink);font-weight:700;box-shadow:var(--shadow)}
  .vstrip{position:fixed;z-index:45;inset-inline:12px;bottom:calc(160px + env(safe-area-inset-bottom));
    background:var(--surface);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--shadow);
    padding:10px 12px;max-width:560px;margin-inline:auto}
  .vstrip .vchips{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
  .vchip{font-size:13px;padding:4px 10px;border-radius:14px;background:var(--surface2);color:var(--ink)}
  .vchip.dn{color:var(--warn)} .vchip.q{background:var(--lime);color:var(--lime-ink)}
  .vitem{border:1px solid var(--line);border-radius:var(--r);padding:10px 12px}
  .vitem .vtext{font-size:13px;color:var(--muted);margin-top:4px}
  @keyframes vpulse{0%,100%{opacity:1}50%{opacity:.75}}`;
  document.head.appendChild(st);
})();

/* ---------- the recordings that wait for signal (IndexedDB) ---------- */
const VQ = {
  db:null,
  open(){ if(this.db) return Promise.resolve(this.db);
    return new Promise((ok,bad)=>{ const r=indexedDB.open('sc-voice',1);
      r.onupgradeneeded=()=>r.result.createObjectStore('q',{keyPath:'id'});
      r.onsuccess=()=>{ this.db=r.result; ok(this.db); }; r.onerror=()=>bad(r.error); }); },
  async tx(mode,fn){ const db=await this.open(); return new Promise((ok,bad)=>{
    const t=db.transaction('q',mode); const st=t.objectStore('q'); const out=fn(st);
    t.oncomplete=()=>ok(out&&out.result!==undefined?out.result:out); t.onerror=()=>bad(t.error); }); },
  put(x){ return this.tx('readwrite',s=>s.put(x)); },
  del(id){ return this.tx('readwrite',s=>s.delete(id)); },
  all(){ return this.tx('readonly',s=>s.getAll()); },
};
let VQ_COUNT=0;
async function vqCount(){ try{ VQ_COUNT=(await VQ.all()).length; }catch(e){ VQ_COUNT=0; } voiceFab(); }

/* the inbox: notes that need one decision from the coach (who / keep the note) */
const vInbox=()=>LS('vinbox')||[];
const vInboxSave=x=>{ LS('vinbox',x.slice(-100)); voiceFab(); };

/* ---------- the button ---------- */
function voiceBtn(pid){
  if(!voiceOk()) return '';
  return `<button type="button" class="vmic" data-pid="${pid||''}">🎙 החזק ודבר${pid?'':' · או הקשה להתחלה ולסיום'}</button>`;
}
const voiceOk=()=>!!(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia&&window.MediaRecorder);

// hold = record while held; a short tap = start, next tap = stop
document.addEventListener('pointerdown',e=>{
  const b=e.target.closest('.vmic'); if(!b) return;
  e.preventDefault();
  if(VOICE.rec){ voiceStop(); return; }
  try{ b.setPointerCapture&&b.setPointerCapture(e.pointerId); }catch(err){}
  VOICE.toggle=false; VOICE.stopSoon=false; VOICE.t0=Date.now(); VOICE.mode=b.dataset.mode||''; voiceStart(b.dataset.pid||null);
});
document.addEventListener('pointerup',e=>{
  const b=e.target.closest('.vmic'); if(!b||VOICE.toggle) return;
  const quick=Date.now()-VOICE.t0<450;
  if(!VOICE.rec){ if(quick) VOICE.toggle=true; else VOICE.stopSoon=true; return; }   // still opening the mic
  if(quick){ VOICE.toggle=true; toast('מקליט… הקשה נוספת לסיום'); return; }
  voiceStop();
});
document.addEventListener('pointercancel',e=>{ if(e.target.closest('.vmic')&&VOICE.rec&&!VOICE.toggle) voiceStop(); });
document.addEventListener('contextmenu',e=>{ if(e.target.closest('.vmic')) e.preventDefault(); });

async function voiceStart(pid){
  if(VOICE.rec) return;
  try{
    if(!VOICE.stream||!VOICE.stream.active)
      VOICE.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
  }catch(e){ return toast('אין גישה למיקרופון. צריך לאשר בהגדרות הדפדפן'); }
  clearTimeout(VOICE.idle);
  const mime=['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/mp4','audio/webm'].find(m=>{try{return MediaRecorder.isTypeSupported(m);}catch(e){return false;}})||'';
  try{ VOICE.rec=new MediaRecorder(VOICE.stream, mime?{mimeType:mime,audioBitsPerSecond:32000}:undefined); }
  catch(e){ VOICE.rec=new MediaRecorder(VOICE.stream); }
  VOICE.mime=VOICE.rec.mimeType||mime||'audio/webm';
  VOICE.chunks=[]; VOICE.pid=pid; VOICE.at=new Date().toISOString();
  const di=S.sessionDrills?.[typeof LIVE!=='undefined'?LIVE.idx:0];
  const d=di?drillById(di.id):null;
  VOICE.ctx={team_id:S.team?.id||null, session_id:S.session?.id||null, drill_id:S.view==='live'&&di?di.id:null,
    match_id:S.match?S.match.id:null, desc:[S.match?'משחק':'', d&&S.view==='live'?'תרגיל: '+d.name:'', S.session?.focus?'נושא: '+S.session.focus:''].filter(Boolean).join(' · ')};
  VOICE.rec.ondataavailable=e=>{ if(e.data&&e.data.size) VOICE.chunks.push(e.data); };
  VOICE.rec.onstop=voiceDone;
  VOICE.rec.start();
  $$('.vmic').forEach(b=>b.classList.add('rec'));
  VOICE.cap=setTimeout(voiceStop,VOICE_MAX_MS);
  try{ navigator.vibrate&&navigator.vibrate(25); }catch(e){}
  if(VOICE.toggle) toast('מקליט… הקשה נוספת לסיום');
  if(VOICE.stopSoon){ VOICE.stopSoon=false; voiceStop(); }
  wakeSync();
}
function voiceStop(){
  clearTimeout(VOICE.cap);
  if(VOICE.rec&&VOICE.rec.state!=='inactive') VOICE.rec.stop();
  $$('.vmic').forEach(b=>b.classList.remove('rec'));
  try{ navigator.vibrate&&navigator.vibrate([15,40,15]); }catch(e){}
}
async function voiceDone(){
  const ms=Date.now()-VOICE.t0, rec=VOICE.rec; VOICE.rec=null; VOICE.toggle=false;
  // keep the microphone open for two minutes, so the next note starts instantly
  clearTimeout(VOICE.idle); VOICE.idle=setTimeout(()=>{ if(!VOICE.rec&&VOICE.stream){ VOICE.stream.getTracks().forEach(t=>t.stop()); VOICE.stream=null; } },120000);
  wakeSync();
  if(ms<700||!VOICE.chunks.length) return toast('קצר מדי, צריך להחזיק ולדבר');
  const blob=new Blob(VOICE.chunks,{type:VOICE.mime});
  const roster=S.players.map(p=>({id:p.id,name:p.name,nick:p.nickname||null,no:p.shirt_no||null,pos:p.position||null}));
  const item={id:uid(),at:VOICE.at,pid:VOICE.pid,ctx:VOICE.ctx,mime:VOICE.mime,blob,roster,lang:I18N.lang,mode:VOICE.mode||''};   // the language the coach spoke
  try{ await VQ.put(item); }catch(e){ VOICE.mem=item; }
  await vqCount();
  if(navigator.onLine) voiceFlush(); else toast('נשמר. יישלח כשתחזור קליטה');
}

/* ---------- send what waits ---------- */
async function voiceFlush(){
  if(VOICE.busy||!navigator.onLine) return;
  VOICE.busy=true; voiceFab();
  try{
    let list=[]; try{ list=await VQ.all(); }catch(e){ list=VOICE.mem?[VOICE.mem]:[]; }
    list.sort((a,b)=>a.at<b.at?-1:1);
    for(const q of list){
      const r=await voiceSend(q);
      if(r.offline) break;
      if(r.error){ if(VOICE.err!==r.error){ VOICE.err=r.error; toast('הקלטה: '+r.error); } if(r.keep) break; }
      else { VOICE.err=''; if(q.mode==='rate') voiceRateResult(q,r); else await voiceApply(q,r); }
      try{ await VQ.del(q.id); }catch(e){} if(VOICE.mem&&VOICE.mem.id===q.id) VOICE.mem=null;
    }
  } finally { VOICE.busy=false; await vqCount(); }
}
async function voiceSend(q){
  try{
    const audio=q.text?null:await new Promise((ok,bad)=>{ const fr=new FileReader();
      fr.onload=()=>ok(String(fr.result).split(',')[1]||''); fr.onerror=bad; fr.readAsDataURL(q.blob); });
    const {data:{session}}=await sb.auth.getSession();
    const attrs=teamAttrs(true).map(a=>({key:a.key,label:a.label}));
    const r=await fetch(VOICE_FN,{method:'POST',headers:{'Content-Type':'application/json',
      Authorization:'Bearer '+(session?session.access_token:''),apikey:SB_KEY},
      body:JSON.stringify({audio,text:q.text||undefined,mime:q.mime,roster:q.roster,attrs,selected:q.pid,context:q.ctx&&q.ctx.desc||'',lang:q.lang||'he',mode:q.mode||''})});
    const j=await r.json().catch(()=>({}));
    if(!r.ok) return {error:j.error||('שגיאה '+r.status), keep:r.status>=500||r.status===401};
    return j;
  }catch(e){ return {offline:true}; }
}

/* ---------- turn the result into data ---------- */
async function voiceApply(q,res){
  const done=[], box=vInbox();
  const items=res.items||[];
  if(!items.length){ toast(res.text?`לא זוהתה הערה: "${res.text}"`:'לא נשמע דיבור'); return; }
  for(const it of items){
    let pids=it.player_ids||[];
    if(it.who==='team'){
      pids=(q.ctx.session_id&&S.session&&q.ctx.session_id===S.session.id&&presentPlayers().length?presentPlayers():S.players).map(p=>p.id);
    }
    if(it.kind==='note'||(!pids.length)){
      box.push({id:uid(),at:q.at,ctx:q.ctx,it,text:res.text,cands:it.candidate_ids||[]});
      if(!pids.length){ done.push({p:'?',t:it.label,q:1}); continue; }
      done.push({p:pids.map(pName).join(', '),t:it.label,q:1}); continue;
    }
    for(const pid of pids) done.push(await voiceCommit(pid,it,q,res.text));
  }
  vInboxSave(box);
  VOICE.last={rows:done.filter(d=>d.rows).flatMap(d=>d.rows), disc:done.filter(d=>d.disc).map(d=>d.disc)};
  voiceStripShow(res.text,done);
  if(typeof drawTiles==='function') drawTiles();
  if(S.match&&typeof drawMatchTiles==='function') drawMatchTiles();
}
const pName=id=>{ const p=S.players.find(x=>x.id===id); return p?(p.nickname||p.name.split(' ')[0]):'?'; };

async function voiceCommit(pid,it,q,text){
  const p=S.players.find(x=>x.id===pid)||{};
  if(it.kind==='discipline'){
    const row={id:uid(),player_id:pid,team_id:q.ctx.team_id||S.team?.id,kind:it.discipline_kind||it.label,
      severity:it.severity||1,positive:!!it.positive,note:'🎙 '+text,by_user:S.user?.id||null,at:q.at};
    await push('coach_discipline',row);
    return {p:pName(pid),t:'משמעת: '+row.kind,dn:!row.positive,disc:row.id};
  }
  // the foot the coach mentioned, against the player's real foot
  let foot='';
  if(it.foot){
    const pf=p.preferred_foot;
    if(pf&&pf!=='both'&&pf!==it.foot) foot='רגל חלשה';
    else if(!pf) foot=it.foot==='left'?'שמאל':'ימין';
  }
  const tag='🎙 '+it.label+(foot?' · '+foot:'');
  const effects=it.effects.map(e=>[e.attr,e.score,Math.round(e.weight*VOICE_W*100)/100]);
  const rows=await addEffects(pid,effects,{source:q.ctx.match_id?'match':'tag',tag,note:text,
    team_id:q.ctx.team_id,session_id:q.ctx.session_id,drill_id:q.ctx.drill_id,match_id:q.ctx.match_id,at:q.at});
  const main=it.effects[0];
  return {p:pName(pid),t:main?`${ATTR_LABEL(main.attr)} ${main.score}${foot?' · '+foot:''}`:it.label,dn:main&&main.score<=2,rows};
}

/* the strip that shows what was understood, with undo */
let VSTRIP_T;
function voiceStripShow(text,done){
  let el=$('#vstrip'); if(!el){ el=document.createElement('div'); el.id='vstrip'; el.className='vstrip'; document.body.appendChild(el); }
  const undo=VOICE.last&&(VOICE.last.rows.length||VOICE.last.disc.length);
  el.innerHTML=`<div class="spread"><span class="xs muted">"<span translate="no">${esc(text)}</span>"</span>
      ${undo?'<button class="btn sm ghost" onclick="voiceUndo()">ביטול</button>':''}</div>
    <div class="vchips">${done.map(d=>`<span class="vchip ${d.q?'q':d.dn?'dn':''}">${esc(d.p)} · ${esc(d.t)}${d.q?' · לטיפול':''}</span>`).join('')}</div>`;
  el.style.display='block';
  clearTimeout(VSTRIP_T); VSTRIP_T=setTimeout(()=>{ el.style.display='none'; },6000);
  el.onclick=e=>{ if(!e.target.closest('button')){ el.style.display='none'; } };
}
async function voiceUndo(){
  const l=VOICE.last; if(!l) return; VOICE.last=null;
  const ids=l.rows.map(r=>r.id);
  if(ids.length){
    LOCAL_OBS=LOCAL_OBS.filter(o=>!ids.includes(o.id)); LS('obs',LOCAL_OBS.slice(-800));
    await sb.from('coach_observations').update({voided:true}).in('id',ids);
  }
  if(l.disc.length) await sb.from('coach_discipline').delete().in('id',l.disc);
  const el=$('#vstrip'); if(el) el.style.display='none';
  if(typeof drawTiles==='function') drawTiles();
  toast('ההערה הקולית בוטלה');
}

/* ---------- the inbox ("לטיפול") ---------- */
function voiceInbox(){
  if(vRates().length) return voiceRateSheet(vRates()[0].id);
  const box=vInbox();
  if(!box.length) return sheet(`<h2>הערות קוליות</h2><div class="empty" style="margin-top:12px">הכול מטופל ✓${VQ_COUNT?`<br><br>${VQ_COUNT} הקלטות ממתינות לקליטה`:''}</div>`);
  const pool=S.players;
  sheet(`<h2>הערות קוליות לטיפול</h2>
    <p class="xs muted" style="margin:4px 0 12px">שם שמשותף לשני שחקנים, הערה בלי שם, או הערה בלי ציון</p>
    <div class="stack">${box.map(x=>{
      const it=x.it, cands=x.cands.length?x.cands:[];
      const what=it.kind==='rating'?it.effects.map(e=>ATTR_LABEL(e.attr)+' '+e.score).join(' · '):it.kind==='discipline'?'משמעת: '+(it.discipline_kind||it.label):'הערה';
      return `<div class="vitem"><div class="spread"><b class="sm">${esc(it.label)}</b><span class="xs muted">${fmtDate(x.at)} ${I18N.time(x.at)}</span></div>
        <p class="xs muted">${esc(what)}</p><p class="vtext">"<span translate="no">${esc(x.text)}</span>"</p>
        ${it.kind==='note'&&it.player_ids&&it.player_ids.length
          ? `<div class="row" style="gap:6px;margin-top:8px"><button class="btn sm primary" onclick="voiceKeepNote('${x.id}')">להוסיף להערות המאמן של ${esc(it.player_ids.map(pName).join(', '))}</button>
             <button class="btn sm ghost" onclick="voiceDrop('${x.id}')">מחיקה</button></div>`
          : `<p class="xs muted" style="margin-top:8px">${cands.length?'על מי?':'על מי? (לא זוהה שם)'}</p>
             <div class="chips" style="margin-top:4px">${(cands.length?cands.map(id=>pool.find(p=>p.id===id)).filter(Boolean):pool).map(p=>
               `<button class="chip" onclick="voiceResolve('${x.id}','${p.id}')"><span translate="no">${esc(p.name)}</span>${p.shirt_no?' #'+p.shirt_no:''}</button>`).join('')}
               <button class="chip" onclick="voiceDrop('${x.id}')">🗑 מחיקה</button></div>`}
      </div>`;}).join('')}</div>`);
}
async function voiceResolve(id,pid){
  const box=vInbox(); const x=box.find(b=>b.id===id); if(!x) return;
  const q={at:x.at,ctx:x.ctx};
  if(x.it.kind==='note') await voiceNoteTo(pid,x);
  else await voiceCommit(pid,x.it,q,x.text);
  vInboxSave(box.filter(b=>b.id!==id)); toast('נשמר אצל '+pName(pid)); voiceInbox();
}
async function voiceKeepNote(id){
  const box=vInbox(); const x=box.find(b=>b.id===id); if(!x) return;
  for(const pid of x.it.player_ids) await voiceNoteTo(pid,x);
  vInboxSave(box.filter(b=>b.id!==id)); toast('נוסף להערות המאמן'); voiceInbox();
}
async function voiceNoteTo(pid,x){
  const p=S.players.find(z=>z.id===pid); if(!p) return;
  const line=`${fmtDate(x.at)}: ${x.it.label} ("${x.text}")`;
  p.coach_note=[p.coach_note,line].filter(Boolean).join('\n');
  await sb.from('coach_players').update({coach_note:p.coach_note}).eq('id',pid);
}
function voiceDrop(id){ vInboxSave(vInbox().filter(b=>b.id!==id)); voiceInbox(); }

/* ---------- the floating mic (training, game) ---------- */
const VOICE_VIEWS=['live','match','attend'];
function voiceFab(){
  let f=$('#vfab'), bx=$('#vbox');
  const show=['coach','assistant','manager'].includes(S.role)&&VOICE_VIEWS.includes(S.view)&&voiceOk();
  if(!show){ f&&f.remove(); bx&&bx.remove(); return; }
  if(!f){ f=document.createElement('button'); f.id='vfab'; f.type='button'; f.className='vmic vfab'; f.setAttribute('aria-label','הערה קולית'); document.body.appendChild(f); }
  f.innerHTML='🎙'; if(VOICE.rec) f.classList.add('rec');
  const n=vInbox().length+vRates().length, w=VQ_COUNT;
  if(n||w){
    if(!bx){ bx=document.createElement('button'); bx.id='vbox'; bx.className='vbox'; bx.onclick=voiceInbox; document.body.appendChild(bx); }
    bx.innerHTML=`${n?`לטיפול ${n}`:''}${n&&w?' · ':''}${w?(VOICE.busy?'שולח…':`ממתין ${w}`):''}`;
  } else bx&&bx.remove();
}

/* ---------- screen awake ----------
   'session' (default): during attendance, training and game · 'always': whenever the app is open · 'off' */
const WAKE={lock:null};
const wakeMode=()=>LS('wake')||'session';
function wakeWanted(){
  const m=wakeMode();
  if(VOICE.rec) return true;
  if(m==='off') return false;
  if(m==='always') return true;
  return VOICE_VIEWS.includes(S.view);
}
async function wakeSync(){
  if(!('wakeLock' in navigator)) return;
  try{
    if(wakeWanted()&&document.visibilityState==='visible'){
      if(!WAKE.lock){ WAKE.lock=await navigator.wakeLock.request('screen'); WAKE.lock.addEventListener('release',()=>{ WAKE.lock=null; }); }
    } else if(WAKE.lock){ const l=WAKE.lock; WAKE.lock=null; await l.release(); }
  }catch(e){}
}
document.addEventListener('visibilitychange',wakeSync);
function wakeSheet(){
  const m=wakeMode(), ok='wakeLock' in navigator;
  sheet(`<h2>מסך דלוק</h2><p class="sm muted" style="margin:6px 0 12px">${ok?'כדי שהמסך לא ייכבה באמצע האימון. צורך קצת יותר סוללה.':'המכשיר או הדפדפן הזה לא מאפשרים לאפליקציה להשאיר את המסך דלוק. אפשר להאריך את זמן כיבוי המסך בהגדרות המכשיר.'}</p>
    <div class="stack">${[['session','באימון ובמשחק (מומלץ)'],['always','תמיד כשהאפליקציה פתוחה'],['off','כבוי']].map(([v,l])=>
      `<button class="btn ${m===v?'primary':''}" ${ok?'':'disabled'} onclick="LS('wake','${v}');wakeSync();wakeSheet();toast('נשמר')">${l}</button>`).join('')}</div>`);
}
const wakeLabel=()=>({session:'באימון ובמשחק',always:'תמיד',off:'כבוי'})[wakeMode()];

/* ---------- hook into navigation ---------- */
(function(){
  const _go=go;
  go=function(){ const r=_go.apply(this,arguments); voiceFab(); wakeSync(); return r; };
})();
addEventListener('online',()=>{ voiceFlush(); });
setTimeout(()=>{ vqCount().then(()=>{ if(VQ_COUNT) voiceFlush(); }); },3000);

/* ===== rating by voice (3.0) =====
   On the rating screen: "יוסי מסירה 4, דני בעיטה 3". The coach's own numbers, read back on a
   confirmation screen — nothing is saved until the coach presses save. Each line can be
   corrected (player / attribute / score) or removed. Recorded without signal → waits on the
   tablet, and the confirmation opens when it comes back ("לאישור" on the mic). */
const vRates=()=>LS('vrates')||[];
const vRatesSave=x=>{ LS('vrates',x.slice(-30)); voiceFab(); };
function voiceRateBtn(){
  if(!voiceOk()) return `<button type="button" class="btn" style="width:100%;margin-top:10px" onclick="voiceRateType()">⌨️ דירוג בהקלדה: "יוסי מסירה 4"</button>`;
  return `<button type="button" class="vmic" data-mode="rate" style="margin-top:10px">🎙 דירוג בקול — "יוסי מסירה 4, דני בעיטה 3"</button>`;
}
function voiceRateResult(q,res){
  const list=(res.ratings||[]).map(r=>({pid:r.player_ids[0]||'',cands:r.candidate_ids||[],heard:r.name_heard||'',attr:r.attr||'',score:r.score,src:r.heard||''}));
  if(!list.length){ toast(res.text?I18N.t('לא זוהו דירוגים: "{0}"',res.text):'לא נשמע דיבור'); return; }
  const x={id:q.id,at:q.at,ctx:q.ctx,text:res.text||'',rows:list};
  vRatesSave(vRates().filter(r=>r.id!==x.id).concat([x]));
  // open the confirmation right away when the coach is still on a rating screen
  if(['live','match','attend'].includes(S.view) && !$('#sheetWrap').classList.contains('open')) voiceRateSheet(x.id);
  else toast(I18N.t('{0} דירוגים ממתינים לאישור',list.length));
}
function voiceRateSheet(id){
  const x=vRates().find(r=>r.id===id); if(!x) return closeSheet();
  const attrs=teamAttrs(true);
  const pl=S.players;
  const rowHtml=(r,i)=>{
    const opts=(r.cands.length?r.cands.map(c=>pl.find(p=>p.id===c)).filter(Boolean):[]);
    const rest=pl.filter(p=>!opts.includes(p));
    return `<div class="vitem" data-i="${i}" style="${r.pid&&r.attr?'':'border-color:var(--warn)'}">
      <div class="spread"><span class="xs muted">"<span translate="no">${esc(r.src)}</span>"</span>
        <button class="btn sm ghost" onclick="vrDel('${id}',${i})" aria-label="הסרה">✕</button></div>
      <div class="grid2" style="margin-top:6px">
        <select onchange="vrSet('${id}',${i},'pid',this.value)" aria-label="שחקן">
          <option value="">${r.heard?esc(I18N.t('מי זה "{0}"?',r.heard)):esc(I18N.t('בחרו שחקן'))}</option>
          ${opts.map(p=>`<option value="${p.id}" ${p.id===r.pid?'selected':''}>⭐ ${esc(p.name)}</option>`).join('')}
          ${rest.map(p=>`<option value="${p.id}" ${p.id===r.pid?'selected':''}>${esc(p.name)}${p.shirt_no?' #'+p.shirt_no:''}</option>`).join('')}
        </select>
        <select onchange="vrSet('${id}',${i},'attr',this.value)" aria-label="תכונה">
          <option value="">${esc(I18N.t('תכונה?'))}</option>
          ${attrs.map(a=>`<option value="${a.key}" ${a.key===r.attr?'selected':''}>${esc(a.label)}</option>`).join('')}
        </select></div>
      <div class="scorerow" style="margin-top:6px">${[1,2,3,4,5].map(v=>`<button data-s="${v}" style="${v===r.score?'outline:2px solid var(--accent);background:var(--accent-b)':''}" onclick="vrSet('${id}',${i},'score',${v})">${v}</button>`).join('')}</div>
    </div>`;
  };
  const ok=x.rows.filter(r=>r.pid&&r.attr&&r.score).length;
  sheet(`<div class="spread"><h2>אישור דירוגים</h2><span class="xs muted">${fmtDate(x.at)} ${I18N.time(x.at)}</span></div>
    <p class="xs muted" style="margin:4px 0 10px">שמענו: "<span translate="no">${esc(x.text)}</span>". בודקים, מתקנים אם צריך, ושומרים.</p>
    <div class="stack" id="vrrows">${x.rows.map(rowHtml).join('')}</div>
    <button class="btn primary big" style="margin-top:12px" id="vrsave" ${ok?'':'disabled'}>${esc(I18N.t('שמירת {0} דירוגים',ok))}</button>
    <div class="row" style="gap:8px;margin-top:8px">
      <button class="btn ghost" style="flex:1" onclick="vrDrop('${id}')">ביטול הכול</button>
      ${voiceOk()?`<button type="button" class="vmic" data-mode="rate" style="flex:1;margin:0;min-height:42px">🎙 עוד</button>`:''}</div>`);
  $('#vrsave').onclick=()=>vrCommit(id);
}
function vrUpd(id,fn){ const all=vRates(); const x=all.find(r=>r.id===id); if(!x) return; fn(x); vRatesSave(all); voiceRateSheet(id); }
function vrSet(id,i,k,v){ vrUpd(id,x=>{ x.rows[i][k]=k==='score'?+v:v; }); }
function vrDel(id,i){ vrUpd(id,x=>{ x.rows.splice(i,1); }); if(!(vRates().find(r=>r.id===id)||{rows:[]}).rows.length) vrDrop(id); }
function vrDrop(id){ vRatesSave(vRates().filter(r=>r.id!==id)); closeSheet(); }
async function vrCommit(id){
  const x=vRates().find(r=>r.id===id); if(!x) return;
  const good=x.rows.filter(r=>r.pid&&r.attr&&r.score>=1&&r.score<=5);
  const b=$('#vrsave'); if(b) b.disabled=true;
  for(const r of good) await addObs(r.pid,r.attr,r.score,{source:x.ctx.match_id?'match':'drill',tag:'🎙 '+ATTR_LABEL(r.attr)+' '+r.score,
    note:x.text,team_id:x.ctx.team_id,session_id:x.ctx.session_id,drill_id:x.ctx.drill_id,match_id:x.ctx.match_id,at:x.at});
  vRatesSave(vRates().filter(r=>r.id!==id)); closeSheet();
  toast(I18N.t('נשמרו {0} דירוגים',good.length));
  if(typeof drawTiles==='function') drawTiles(); if(S.match&&typeof drawMatchTiles==='function') drawMatchTiles();
  if(vRates().length) setTimeout(()=>voiceRateSheet(vRates()[0].id),300);
}
/* the same, typed — for a noisy pitch or a device without a microphone */
function voiceRateType(){
  sheet(`<h2>דירוג בהקלדה</h2><p class="xs muted" style="margin:4px 0 10px">למשל: יוסי מסירה 4, דני בעיטה 3</p>
    <textarea id="vrt" rows="3"></textarea><button class="btn primary big" style="margin-top:10px" id="vrtgo">המשך לאישור</button>`);
  $('#vrtgo').onclick=async()=>{
    const text=$('#vrt').value.trim(); if(!text) return;
    if(!navigator.onLine) return toast('צריך קליטה לפענוח. אפשר לדרג בהקשה על השחקן.');
    const di=S.sessionDrills?.[typeof LIVE!=='undefined'?LIVE.idx:0];
    const q={id:uid(),at:new Date().toISOString(),pid:null,mode:'rate',text,lang:I18N.lang,
      ctx:{team_id:S.team?.id||null,session_id:S.session?.id||null,drill_id:S.view==='live'&&di?di.id:null,match_id:S.match?S.match.id:null,desc:''},
      roster:S.players.map(p=>({id:p.id,name:p.name,nick:p.nickname||null,no:p.shirt_no||null,pos:p.position||null}))};
    $('#vrtgo').disabled=true;
    const r=await voiceSend(q);
    if(r.error||r.offline){ $('#vrtgo').disabled=false; return toast(r.error||'אין חיבור'); }
    closeSheet(); voiceRateResult(q,r);
  };
}
