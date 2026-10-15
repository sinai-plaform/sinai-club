/* ===== SINAI Club — conversations, with the parents always inside =====
   Child protection, enforced by the database (coach_msg_guard), not only by this screen:
   • a conversation belongs to a player, and every message in it is seen by the coach,
     the player and ALL the player's registered parents — there is no adult↔minor channel
     without a parent. A player under 18 (or with no birth date) with no registered
     parent cannot be written to by an adult at all.
   • every message, and every WhatsApp the app opens for a parent, is kept in
     coach_messages, which cannot be edited or deleted — by anyone, the coach included.
   • the app never opens a WhatsApp chat to a minor's own phone. */

const TH = { pid:null, rows:[], guardians:[], player:null, back:null };

/* a line in the log for WhatsApp messages the app opens (to an adult: a parent or a group) */
async function logMsg(row){
  try{ await sb.from('coach_messages').insert(Object.assign({id:uid(), club_id:S.club?.id||FAM.club?.id, team_id:S.team?.id||null,
    channel:'whatsapp', sent_at:new Date().toISOString()}, row)); }catch(e){}
}
const isMinor=p=>!p||!p.birth_date||age(p.birth_date)<18;
const roleName=r=>({coach:'המאמן',assistant:'עוזר המאמן',manager:'המנהל',parent:'הורה',player:'השחקן'})[r]||'';

async function openThread(pid){
  TH.pid=pid;
  const fam=S.role==='parent'||S.role==='player';
  const p=fam?FAM.kids.find(k=>k.id===pid):S.players.find(x=>x.id===pid);
  TH.player=p||{id:pid,name:''};
  const title=I18N.t('שיחה — {0}',(p?.name||'').split(' ')[0]);
  if(fam){ $('#app').innerHTML=famBar(title,true).replace('onclick="famHome()"',`onclick="famKid('${pid}')"`)+'<div class="wrap" id="thw"><div class="empty">טוען…</div></div>'; }
  else { if(S.view!=='thread') return go('thread',pid); screen(title,'<div id="thw"><div class="empty">טוען…</div></div>'); }
  await threadLoad(); threadDraw();
  clearInterval(TH.poll); TH.poll=setInterval(async()=>{ if(!$('#thw')){ clearInterval(TH.poll); return; }
    const n=TH.rows.length; await threadLoad(); if(TH.rows.length!==n) threadDraw(true); }, 20000);
}
VIEWS.thread = pid=>openThread(pid);

async function threadLoad(){
  const fam=S.role==='parent'||S.role==='player';
  const [{data:rows},{data:gs}] = await Promise.all([
    sb.from('coach_messages').select('id,body,sender_role,by_user,sent_at,minor,recipients').eq('thread_player_id',TH.pid).order('sent_at').limit(300),
    fam?Promise.resolve({data:null}):sb.from('coach_guardian_players').select('coach_guardians(id,name,phone,user_id)').eq('player_id',TH.pid)
  ]);
  TH.rows=rows||[];
  if(gs) TH.guardians=gs.map(x=>x.coach_guardians).filter(Boolean);
  else { const last=TH.rows[TH.rows.length-1]; TH.guardians=(last&&last.recipients&&last.recipients.guardians)||TH.guardians||[]; }
  try{ LS('th_seen_'+TH.pid, new Date().toISOString()); }catch(e){}
}
function threadDraw(keepScroll){
  const el=$('#thw'); if(!el) return;
  const me=S.user?.id, p=TH.player, minor=isMinor(p);
  const fam=S.role==='parent'||S.role==='player';
  const gl=TH.guardians;
  const who=[I18N.t('המאמן'), p?.name?(p.name.split(' ')[0]+(p.user_id||p.login_enabled?'':' '+I18N.t('(אין לו חשבון עדיין)'))):'',
    ...gl.map(g=>(g.name||showPhone2(g.phone))+(g.user_id?' ✓':' '+I18N.t('(לא באפליקציה)')))].filter(Boolean);
  const noParent=!fam && minor && !gl.length;
  el.innerHTML=`
    <div class="alert ok sm" style="line-height:1.5">🔒 ${minor
      ? 'שיחה עם שחקן מתחת לגיל 18: ההורים הרשומים תמיד בתוך השיחה, ואין ערוץ פרטי בין מבוגר לילד.'
      : 'השיחה נשמרת ביומן המועדון.'} כל ההודעות נשמרות ביומן שאי אפשר לערוך או למחוק.</div>
    <p class="xs muted" style="margin:8px 2px">${esc(I18N.t('בשיחה: {0}',who.join(' · ')))}</p>
    ${noParent?`<div class="alert">לשחקן אין הורה רשום, ולכן אי אפשר לכתוב לו. מוסיפים הורה בכרטיס השחקן או בייבוא הרשימה.</div>
      <button class="btn" style="margin-top:8px" onclick="playerForm(S.players.find(x=>x.id==='${p.id}'))">הוספת הורה</button>`:''}
    <div class="stack" id="thmsgs" style="margin-top:10px;gap:8px">${TH.rows.map(m=>{
      const mine=m.by_user===me;
      return `<div style="display:flex;justify-content:${mine?'flex-start':'flex-end'}"><div class="card" style="max-width:86%;padding:9px 12px;${mine?'background:var(--surface2)':''}">
        <p class="xs muted">${esc(I18N.tr(roleName(m.sender_role)))} · ${fmtDate(m.sent_at)} ${I18N.time(m.sent_at)}</p>
        <p class="sm" style="white-space:pre-wrap;margin-top:2px"><span translate="no">${esc(m.body)}</span></p></div></div>`;}).join('')
      ||'<p class="muted sm" style="text-align:center">עוד אין הודעות.</p>'}</div>
    ${noParent?'':`<div class="card stack" style="margin-top:12px">
      <textarea id="thbody" rows="3" placeholder="${fam?'כתיבה למאמן…':'כתיבה לשחקן ולהורים…'}"></textarea>
      <button class="btn primary" id="thsend">שליחה</button>
      ${!fam?'<p class="xs muted">ההודעה מופיעה באפליקציה אצל השחקן וההורים. אחרי השליחה אפשר להודיע להורים גם בוואטסאפ.</p>':''}</div>`}
    <div id="thwa"></div>`;
  const b=$('#thsend'); if(b) b.onclick=threadSend;
  if(!keepScroll) setTimeout(()=>{ const m=$('#thmsgs'); m&&m.lastElementChild&&m.lastElementChild.scrollIntoView({block:'nearest'}); },50);
}
const showPhone2=ph=>String(ph||'').replace(/^\+?972/,'0');

async function threadSend(){
  const body=$('#thbody').value.trim(); if(!body) return;
  if(!navigator.onLine) return toast('צריך קליטה כדי לשלוח הודעה');
  const b=$('#thsend'); b.disabled=true;
  const {error}=await sb.from('coach_messages').insert({id:uid(), thread_player_id:TH.pid, club_id:S.club?.id||FAM.club?.id||null,
    team_id:S.team?.id||null, kind:'thread', body, channel:'app'});
  b.disabled=false;
  if(error){
    if(/CHILD_GUARD/.test(error.message)) return toast(error.message.replace(/^.*CHILD_GUARD:\s*/,''));
    return toast('לא נשלח: '+error.message);
  }
  await threadLoad(); threadDraw();
  // the coach can also tell the parents on WhatsApp — the parents, never the child's own phone
  const fam=S.role==='parent'||S.role==='player';
  if(!fam && TH.guardians.some(g=>g.phone)){
    const link=location.origin+'/app/';
    const txt=I18N.t('הודעה מהמאמן של {0} על {1}:',S.team?.name||'',TH.player.name.split(' ')[0])+'\n'+body+'\n\n'+I18N.t('השיחה המלאה באפליקציה: {0}',link);
    $('#thwa').innerHTML=`<div class="card" style="margin-top:12px"><p class="sm"><b>להודיע להורים בוואטסאפ?</b></p>
      <div class="stack" style="margin-top:8px">${TH.guardians.filter(g=>g.phone).map(g=>`<button class="btn" onclick="threadWa('${g.id}')">${esc(g.name||showPhone2(g.phone))}</button>`).join('')}</div></div>`;
    TH.waText=txt;
  }
}
async function threadWa(gid){
  const g=TH.guardians.find(x=>x.id===gid); if(!g) return;
  const to=String(g.phone).replace(/\D/g,'').replace(/^0/,'972');
  if(await waOpen(`https://wa.me/${to}?text=`+encodeURIComponent(TH.waText)))
    logMsg({player_id:TH.pid, to_guardian_id:gid, kind:'thread_whatsapp', body:TH.waText});
}

/* ---------- coach: all conversations of the team ---------- */
VIEWS.threads = async function(){
  screen('שיחות עם שחקנים', '<div class="empty">טוען…</div>');
  const ids=S.players.map(p=>p.id);
  const {data}=ids.length?await sb.from('coach_messages').select('thread_player_id,body,sent_at,sender_role').in('thread_player_id',ids).order('sent_at',{ascending:false}).limit(400):{data:[]};
  const last={}; (data||[]).forEach(m=>{ if(!last[m.thread_player_id]) last[m.thread_player_id]=m; });
  const rows=[...S.players].sort((a,b)=>((last[b.id]?.sent_at)||'').localeCompare((last[a.id]?.sent_at)||''));
  $('.wrap').innerHTML=`<div class="alert ok sm">🔒 כל שיחה עם שחקן כוללת את ההורים הרשומים שלו. ההודעות נשמרות ביומן שאי אפשר למחוק.</div>
    <div class="stack" style="margin-top:12px">${rows.map(p=>{const m=last[p.id]; const seen=LS('th_seen_'+p.id);
      const nw=m&&m.sender_role&&!['coach','assistant','manager'].includes(m.sender_role)&&(!seen||seen<m.sent_at);
      return `<div class="prow" onclick="openThread('${p.id}')"><div class="av">${esc(initials(p.name))}</div>
        <div class="pname"><b><span translate="no">${esc(p.name)}</span></b><span class="xs muted">${m?`<span translate="no">${esc(m.body.slice(0,60))}</span> · ${fmtDate(m.sent_at)}`:'אין הודעות'}</span></div>
        ${nw?'<span class="pill info">חדש</span>':''}</div>`;}).join('')}</div>`;
};
