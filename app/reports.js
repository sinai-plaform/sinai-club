/* ===== SINAI Club — monthly progress report for the parents =====
   For every player, once a month: the attribute profile, the change since last month,
   attendance, achievements, the development plan, and one personal sentence.
   The AI suggests the sentence from the data; the coach edits and approves — nothing goes
   to a parent before that. On approval the report is frozen (coach_reports.body) and gets
   a private link; it goes out as a PDF or as that link on WhatsApp, to the parents only. */

const AI_FN = SB_URL+'/functions/v1/coach-ai';
const REP_BASE = (/sinaiclub\.com$/.test(location.hostname)?location.origin:'https://sinaiclub.com')+'/r/?t=';

/* the month a coach usually reports on: the one that just ended (until the 10th), else this one */
function defaultPeriod(){ const d=new Date(); if(d.getDate()<=10) d.setMonth(d.getMonth()-1); return d.toISOString().slice(0,7); }
function periodBounds(period){
  const [y,m]=period.split('-').map(Number);
  const start=new Date(y,m-1,1), end=new Date(y,m,0,23,59,59);
  const prevEnd=new Date(y,m-1,0,23,59,59);
  const cap=d=>d>new Date()?new Date():d;
  return {start, end:cap(end), prevEnd};
}
const monthName=p=>I18N.date(p+'-15',{month:'long',year:'numeric'});
function randToken(){ const b=crypto.getRandomValues(new Uint8Array(24)); return btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }

/* ---------- the facts ---------- */
async function buildReportBody(pid, period, numbers){
  const p=S.players.find(x=>x.id===pid); if(!p) throw new Error('player');
  const {start,end,prevEnd}=periodBounds(period);
  const isGk=p.position==='שוער';
  const attrs=teamAttrs(isGk).filter(a=>isGk?true:a.grp!=='gk');
  const fromISO=start.toISOString(), toISO=end.toISOString();
  const [{data:obs},{data:att},{data:goals},{data:tests},{data:disc}] = await Promise.all([
    sb.from('coach_observations').select('id,player_id,attribute,score,source,at,weight,voided').eq('player_id',pid).eq('voided',false).limit(3000),
    sb.from('coach_attendance').select('present,coach_sessions!inner(date,team_id)').eq('player_id',pid)
      .gte('coach_sessions.date',fromISO.slice(0,10)).lte('coach_sessions.date',toISO.slice(0,10)).limit(80),
    sb.from('coach_goals').select('*').eq('player_id',pid).is('archived_at',null).limit(20),
    sb.from('coach_tests').select('*').eq('player_id',pid).gte('at',fromISO).lte('at',toISO).limit(20),
    sb.from('coach_discipline').select('kind,positive,at').eq('player_id',pid).gte('at',fromISO).lte('at',toISO).limit(40)
  ]);
  const all=withLocalObs(obs,[pid]).filter(o=>o.player_id===pid);
  const now=scoreFromObs(all,end), prev=scoreFromObs(all,prevEnd);
  const monthObs=all.filter(o=>o.at>=fromISO&&o.at<=toISO).length;
  const rows=attrs.map(a=>{ const n=now[a.key]?.score??null, pr=prev[a.key]?.score??null;
    return {key:a.key,label:a.label,grp:a.grp,now:n,prev:pr,delta:(n!=null&&pr!=null&&(now[a.key].weight>=1))?+(n-pr).toFixed(1):null,conf:now[a.key]?.conf||'none'}; });
  const known=rows.filter(r=>r.now!=null&&r.conf!=='none');
  const strengths=[...known].sort((a,b)=>b.now-a.now).slice(0,3).map(r=>r.label);
  const goalAttrs=(goals||[]).filter(g=>g.attribute&&!g.done_at).map(g=>g.attribute);
  const focus=[...new Set([...goalAttrs.map(k=>ATTR_LABEL(k)), ...[...known].sort((a,b)=>a.now-b.now).slice(0,2).map(r=>r.label)])].slice(0,2);
  const improved=rows.filter(r=>r.delta!=null&&r.delta>=1).sort((a,b)=>b.delta-a.delta);
  const marked=(att||[]).filter(a=>a.present);
  const attendance={present:marked.filter(a=>a.present==='yes').length,total:marked.length};
  const ach=[];
  if(attendance.total>=3&&attendance.present===attendance.total) ach.push(I18N.t('נוכחות מלאה החודש'));
  if(improved[0]) ach.push(I18N.t('השיפור הגדול: {0}',improved[0].label));
  (goals||[]).filter(g=>(g.reached_at||g.done_at)&&(g.reached_at||g.done_at)>=fromISO&&(g.reached_at||g.done_at)<=toISO)
    .forEach(g=>ach.push(I18N.t('השיג יעד: {0}',g.attribute?ATTR_LABEL(g.attribute):g.text)));
  const pos=(disc||[]).filter(d=>d.positive).length; if(pos) ach.push(I18N.t('{0} ציונים לשבח על התנהגות',pos));
  (tests||[]).slice(0,2).forEach(t=>ach.push(`${I18N.tr(t.test)}: ${t.value} ${t.unit==='sec'?I18N.t('שנ׳'):t.unit==='cm'?I18N.t('ס״מ'):''}`.trim()));
  const curOf=k=>now[k]?.score??null;
  const goalsOut=(goals||[]).filter(g=>!g.season||g.season===seasonOf()).map(g=>{
    const c=g.attribute?curOf(g.attribute):null;
    return {label:g.attribute?ATTR_LABEL(g.attribute):g.text, text:g.attribute?g.text:null, baseline:g.baseline, target:g.target,
      pct:g.attribute?goalPct(g,c):null, reached:!!(g.done_at||g.reached_at)};
  });
  return {v:1, period, player:p.name, first:p.name.split(' ')[0], team:S.team?.name||'', club:S.club?.name||'',
    coach:(S.user?.user_metadata?.name)||'', age:S.team?.age_profile||'', numbers:!!numbers,
    attendance, attrs:rows.filter(r=>r.now!=null&&r.conf!=='none').map(({conf,...r})=>r), improved:improved.length, strengths, focus, achievements:ach, goals:goalsOut,
    obs_month:monthObs, lang:I18N.lang};
}

/* the personal sentence: the AI writes, the coach decides. Without signal or AI → a plain sentence from the same facts */
async function aiReportLine(body){
  const facts={first_name:body.first, age_group:I18N.tr(AGES[body.age]||''), month:monthName(body.period),
    attendance:body.attendance.total?`${body.attendance.present}/${body.attendance.total}`:'',
    strengths:body.strengths, improved:body.attrs.filter(a=>a.delta>=1).map(a=>a.label), working_on:body.focus,
    goals:body.goals.map(g=>g.label+(g.reached?' ✓':g.pct!=null?` ${g.pct}%`:'')), achievements:body.achievements};
  for(let tries=0;tries<4;tries++){
    try{
      const {data:{session}}=await sb.auth.getSession();
      const r=await fetch(AI_FN,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+(session?.access_token||''),apikey:SB_KEY},
        body:JSON.stringify({action:'report_line',facts,lang:I18N.lang})});
      const j=await r.json().catch(()=>({}));
      if(r.status===429&&j.wait){ await new Promise(ok=>setTimeout(ok,Math.min(30,j.wait)*1000)); continue; }
      if(r.ok&&j.line) return {line:j.line, ai:true};
      break;
    }catch(e){ break; }
  }
  return {line:plainReportLine(body), ai:false};
}
function plainReportLine(b){
  const up=b.attrs.filter(a=>a.delta>=1).map(a=>a.label);
  const s1=up.length?I18N.t('החודש של {0} הראה התקדמות יפה ב{1}.',b.first,I18N.list(up.slice(0,2)))
    :b.strengths.length?I18N.t('{0} ממשיך/ה להפגין יכולת טובה ב{1}.',b.first,b.strengths[0]):I18N.t('{0} עובד/ת יפה באימונים.',b.first);
  const s2=b.focus.length?I18N.t('בחודש הבא נתמקד ב{0}.',b.focus[0]):'';
  return [s1,s2].filter(Boolean).join(' ');
}

/* ---------- the month: every player of the team ---------- */
VIEWS.monthly = async function(arg){
  const period=(arg&&arg.period)||LS('rep_period')||defaultPeriod(); LS('rep_period',period);
  screen('דוחות חודשיים', '<div class="empty">טוען…</div>');
  const ids=S.players.map(p=>p.id);
  const {data}=ids.length?await sb.from('coach_reports').select('id,player_id,status,sent_at,approved_at').eq('period',period).in('player_id',ids):{data:[]};
  const by={}; (data||[]).forEach(r=>by[r.player_id]=r);
  const cnt=s=>(data||[]).filter(r=>r.status===s).length;
  const months=[...Array(6)].map((_,i)=>{ const d=new Date(); d.setDate(1); d.setMonth(d.getMonth()-i); return d.toISOString().slice(0,7); });
  $('.wrap').innerHTML=`
    <div class="card stack">
      <label class="f">חודש<select id="rpm">${months.map(m=>`<option value="${m}" ${m===period?'selected':''}>${esc(monthName(m))}</option>`).join('')}</select></label>
      <p class="sm muted">${esc(I18N.t('{0} שחקנים · {1} טיוטות · {2} אושרו · {3} נשלחו',S.players.length,cnt('draft'),cnt('approved'),cnt('sent')))}</p>
      <button class="btn primary" id="rpall">✨ הכנת טיוטות לכל מי שאין לו</button>
      <p class="xs muted">כל טיוטה כוללת משפט אישי שה-AI מציע. שום דוח לא יוצא להורים לפני שאישרת אותו.</p>
    </div>
    <div class="stack" style="margin-top:12px">${S.players.map(p=>{const r=by[p.id];
      const st=!r?['','טרם הוכן']:r.status==='draft'?['warn','טיוטה']:r.status==='approved'?['info','אושר']:['ok','נשלח'];
      return `<div class="prow" onclick="go('report',{pid:'${p.id}',period:'${period}'})"><div class="av">${esc(initials(p.name))}</div>
        <div class="pname"><b><span translate="no">${esc(p.name)}</span></b></div><span class="pill ${st[0]}">${st[1]}</span></div>`;}).join('')}</div>
    <p class="xs muted" id="rpst" style="text-align:center;margin-top:10px"></p>`;
  $('#rpm').onchange=e=>go('monthly',{period:e.target.value});
  $('#rpall').onclick=async()=>{
    const todo=S.players.filter(p=>!by[p.id]);
    if(!todo.length) return toast('לכולם כבר יש דוח לחודש הזה');
    if(!navigator.onLine) return toast('צריך קליטה כדי להכין דוחות');
    $('#rpall').disabled=true;
    for(let i=0;i<todo.length;i++){
      const st=$('#rpst'); if(st) st.textContent=I18N.t('מכין {0} מתוך {1}…',i+1,todo.length);
      try{ await saveDraft(todo[i].id,period); }catch(e){ console.warn(e); }
    }
    toast('הטיוטות מוכנות'); go('monthly',{period});
  };
};
async function saveDraft(pid, period, existing){
  const body=await buildReportBody(pid, period, existing?existing.body?.numbers:!!S.team?.parent_sees_scores);
  const ai=await aiReportLine(body);
  const row={club_id:S.club.id, team_id:S.team?.id||null, player_id:pid, period, body, ai_line:ai.line,
    coach_line:existing&&existing.coach_line&&existing.coach_line!==existing.ai_line?existing.coach_line:ai.line, lang:I18N.lang,
    status:'draft', updated_at:new Date().toISOString()};
  const {data,error}=await sb.from('coach_reports').upsert(row,{onConflict:'player_id,period'}).select().single();
  if(error) throw error; return data;
}

/* ---------- one player's report: preview, edit the sentence, approve, send ---------- */
VIEWS.report = async function(arg){
  const pid=arg&&arg.pid, period=(arg&&arg.period)||LS('rep_period')||defaultPeriod();
  const p=S.players.find(x=>x.id===pid); if(!p) return go('monthly');
  screen(I18N.t('דוח חודשי — {0}',p.name.split(' ')[0]), '<div class="empty">מכין את הדוח…</div>');
  let {data:rep}=await sb.from('coach_reports').select('*').eq('player_id',pid).eq('period',period).maybeSingle();
  if(!rep){
    if(!navigator.onLine){ $('.wrap').innerHTML='<div class="empty">צריך קליטה כדי להכין דוח.</div>'; return; }
    try{ rep=await saveDraft(pid,period); }catch(e){ $('.wrap').innerHTML=`<div class="alert">לא הצלחנו להכין: ${esc(e.message||e)}</div>`; return; }
  }
  const draft=rep.status==='draft';
  const {data:gs}=await sb.from('coach_guardian_players').select('coach_guardians(id,name,phone)').eq('player_id',pid);
  const parents=(gs||[]).map(x=>x.coach_guardians).filter(g=>g&&g.phone);
  $('.wrap').innerHTML=`
    <div class="card stack">
      <div class="spread"><b>${esc(monthName(period))}</b><span class="pill ${draft?'warn':rep.status==='sent'?'ok':'info'}">${draft?'טיוטה':rep.status==='sent'?'נשלח':'אושר'}</span></div>
      <label class="f">המשפט האישי (ה-AI הציע, אתה מחליט)<textarea id="rpl" rows="3" ${draft?'':'disabled'}>${esc(rep.coach_line||'')}</textarea></label>
      ${draft&&rep.ai_line&&rep.ai_line!==rep.coach_line?`<button class="btn sm ghost" onclick="$('#rpl').value=${esc(JSON.stringify(rep.ai_line))};rpPreview()">↺ חזרה להצעת ה-AI</button>`:''}
      ${draft?`<div class="togrow"><div class="t"><b>מספרים בדוח</b><span>כבוי: ההורה רואה רמה בפס וחץ שינוי, בלי ציון</span></div>
        <label class="sw"><input type="checkbox" id="rpn" ${rep.body?.numbers?'checked':''}><i></i></label></div>
      <div class="row" style="gap:8px"><button class="btn" style="flex:1" id="rpre">↻ רענון הנתונים</button>
        <button class="btn" style="flex:1" id="rpai">✨ הצעה חדשה</button></div>
      <button class="btn primary big" id="rpok">אישור הדוח</button>`
      :`<div class="stack">
        ${parents.map(g=>`<button class="btn primary" onclick="rpSendWa('${rep.id}','${g.id}')">💬 ${esc(I18N.t('קישור בוואטסאפ ל{0}',g.name||showPhone(g.phone)))}</button>`).join('')||'<p class="xs muted">אין טלפון של הורה. אפשר לשלוח את ה-PDF.</p>'}
        <button class="btn" id="rppdf">📄 PDF</button>
        <button class="btn ghost sm" id="rpback">חזרה לעריכה (הקישור יפסיק לעבוד עד אישור מחדש)</button></div>`}
    </div>
    <div id="rpv" style="margin-top:12px"></div>`;
  window.rpPreview=()=>{ const b=Object.assign({},rep.body,{numbers:$('#rpn')?$('#rpn').checked:rep.body?.numbers});
    $('#rpv').innerHTML=renderReport(b, $('#rpl').value.trim()); };
  rpPreview();
  $('#rpl').oninput=rpPreview; const n=$('#rpn'); if(n) n.onchange=rpPreview;
  const on=(id,f)=>{ const x=$('#'+id); if(x) x.onclick=f; };
  on('rpre',async()=>{ $('#rpre').disabled=true; rep.coach_line=$('#rpl').value.trim();
    try{ await saveDraft(pid,period,rep); }catch(e){ toast('שגיאה: '+e.message); } go('report',{pid,period}); });
  on('rpai',async()=>{ $('#rpai').disabled=true; const ai=await aiReportLine(rep.body); $('#rpl').value=ai.line; rpPreview();
    await sb.from('coach_reports').update({ai_line:ai.line}).eq('id',rep.id); rep.ai_line=ai.line; $('#rpai').disabled=false;
    if(!ai.ai) toast('אין חיבור ל-AI — הוצע משפט פשוט מהנתונים'); });
  on('rpok',async()=>{
    const line=$('#rpl').value.trim(); if(!line) return toast('חסר משפט אישי');
    const body=Object.assign({},rep.body,{numbers:$('#rpn').checked});
    const {error}=await sb.from('coach_reports').update({coach_line:line, body, status:'approved', approved_at:new Date().toISOString(),
      approved_by:S.user.id, share_token:rep.share_token||randToken(), updated_at:new Date().toISOString()}).eq('id',rep.id);
    if(error) return toast('שגיאה: '+error.message);
    toast('הדוח אושר'); go('report',{pid,period});
  });
  on('rppdf',async()=>{ const b=$('#rppdf'); b.disabled=true; b.textContent=I18N.t('מכין PDF…');
    try{ const r=await reportPdf($('#rpcard'), `SINAI-Club-${p.name.split(' ')[0]}-${period}.pdf`);
      if(r!=='cancel') await sb.from('coach_reports').update({status:'sent',sent_at:new Date().toISOString()}).eq('id',rep.id);
    }catch(e){ toast('לא הצלחנו להכין PDF — אפשר להדפיס ולשמור כ-PDF'); setTimeout(()=>window.print(),400); }
    b.disabled=false; b.textContent='📄 PDF'; });
  on('rpback',async()=>{ await sb.from('coach_reports').update({status:'draft'}).eq('id',rep.id); go('report',{pid,period}); });
};
async function rpSendWa(id, gid){
  const {data:rep}=await sb.from('coach_reports').select('*').eq('id',id).single(); if(!rep) return;
  const {data:g}=await sb.from('coach_guardians').select('id,name,phone').eq('id',gid).single(); if(!g) return;
  const first=(rep.body?.first)||'';
  const txt=I18N.t('שלום{0}, דוח ההתקדמות של {1} לחודש {2} מוכן:',g.name?' '+g.name.split(' ')[0]:'',first,monthName(rep.period))+'\n'+REP_BASE+rep.share_token+'\n\n'+(rep.coach_line||'');
  const to=String(g.phone).replace(/\D/g,'').replace(/^0/,'972');
  if(!await waOpen(`https://wa.me/${to}?text=`+encodeURIComponent(txt))) return;
  await sb.from('coach_reports').update({status:'sent',sent_at:new Date().toISOString()}).eq('id',id);
  logMsg({player_id:rep.player_id,to_guardian_id:gid,kind:'monthly_report',body:txt});
  toast('נפתח בוואטסאפ ונרשם ביומן');
}
