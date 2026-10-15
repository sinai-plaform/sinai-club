/* ===== SINAI Club — personal development plan =====
   2–3 goals per player for the season, each tied to an attribute of the card
   ("מסירות מ-11 ל-14"). Progress is not typed in: it follows the attribute score,
   which comes from the coach's ratings — so it moves by itself after every training.
   A goal is reached when the score reaches the target; the card marks it on its own.
   The coach, the player and the parents see the plan (the family through coach_kid_goals,
   with numbers only when the coach opened scores for the team), and it goes into the
   monthly report. Free-text goals from before still show, as plain goals. */

const GOALS_MAX = 3;
/* the football season runs August → June */
function seasonOf(d){
  if(S.team&&S.team.season) return S.team.season;
  const x=d?new Date(d):new Date(); const y=x.getMonth()>=7?x.getFullYear():x.getFullYear()-1;
  return `${y}/${String((y+1)%100).padStart(2,'0')}`;
}
const seasonEnd=()=>{ const s=seasonOf(); return `20${s.slice(-2)}-06-30`; };

function goalPct(g, cur){
  if(g.target==null||g.baseline==null) return null;
  if(+g.target<=+g.baseline) return 100;
  const c=cur!=null?cur:+g.baseline;
  return Math.max(0,Math.min(100,Math.round((c-g.baseline)/(g.target-g.baseline)*100)));
}
function goalRow(g, cur, opts){
  opts=opts||{};
  const reached=!!(g.done_at||g.reached_at);
  const pct=g.pct!=null?g.pct:goalPct(g,cur);
  const nums=opts.numbers!==false && g.baseline!=null;
  const label=g.attribute?ATTR_LABEL(g.attribute):'';
  const head=g.attribute
    ? (nums?I18N.t('{0}: מ-{1} ל-{2}',label,Math.round(g.baseline),Math.round(g.target)):label)
    : g.text;
  const sub=[g.attribute&&g.text&&g.text!==head?g.text:'',
    g.attribute&&nums&&cur!=null?I18N.t('עכשיו {0}',(+cur).toFixed(1)):'',
    reached?I18N.t('הושג 🎉'):(g.due?I18N.t('עד {0}',fmtDate(g.due)):'')].filter(Boolean).join(' · ');
  return `<div class="prow" style="flex-wrap:wrap">
    <div class="pname" style="min-width:150px"><b class="sm">${esc(head)}</b><span class="xs muted">${esc(sub)}</span></div>
    ${pct!=null?`<span class="pill ${reached?'ok':pct>=60?'info':''} num">${reached?'✓':pct+'%'}</span>`:''}
    ${opts.coach&&!reached?`<button class="btn sm ghost" onclick="goalMenu('${g.id}','${opts.pid}')" aria-label="אפשרויות">⋯</button>`:''}
    ${pct!=null?`<div class="bar" style="flex-basis:100%;margin-top:6px"><i style="width:${Math.max(3,pct)}%;background:${reached?'var(--ok)':'var(--accent)'}"></i></div>`:''}
  </div>`;
}

/* ---------- coach: the section on the player card ---------- */
function devPlanHtml(pid, goals, sc){
  const season=seasonOf();
  const open=goals.filter(g=>!g.archived_at && (g.season===season || !g.season));
  const active=open.filter(g=>g.attribute&&!g.done_at).length;
  return `<div class="hd"><h2>תוכנית פיתוח אישית</h2>
      ${active<GOALS_MAX?`<button class="btn sm" onclick="goalForm('${pid}')">+ יעד</button>`:''}</div>
    <p class="xs muted" style="margin:-4px 0 8px">${esc(I18N.t('עונה {0} · עד {1} יעדים · ההתקדמות מתעדכנת לבד מהדירוגים · השחקן וההורים רואים',season,GOALS_MAX))}</p>
    ${open.length?`<div class="stack">${open.map(g=>goalRow(g, g.attribute?sc[g.attribute]?.score:null, {coach:true,pid})).join('')}</div>`
      :'<p class="muted sm">עוד אין יעדים לעונה. 2–3 יעדים מכוונים את השחקן ואת האימון.</p>'}`;
}
/* a goal whose attribute reached the target is marked as reached, once */
async function goalsAutoReach(pid, goals, sc){
  for(const g of goals){
    if(!g.attribute||g.done_at||g.target==null) continue;
    const cur=sc[g.attribute]?.score;
    if(cur!=null && cur>=+g.target){
      const now=new Date().toISOString();
      const {error}=await sb.from('coach_goals').update({done_at:now,reached_at:now}).eq('id',g.id);
      if(!error){ g.done_at=now; toast(I18N.t('🎉 יעד הושג: {0}',ATTR_LABEL(g.attribute))); }
    }
  }
}

async function goalForm(pid){
  const p=S.players.find(x=>x.id===pid)||{};
  const isGk=p.position==='שוער';
  const attrs=teamAttrs(isGk).filter(a=>isGk?true:a.grp!=='gk');
  const {data:obs}=await sb.from('coach_observations').select('id,player_id,attribute,score,source,at,weight,voided').eq('player_id',pid).eq('voided',false).limit(1500);
  const sc=scoreFromObs(withLocalObs(obs,[pid]).filter(o=>o.player_id===pid));
  const now=k=>sc[k]?.score!=null?Math.round(sc[k].score):null;
  // the weakest attributes come first: that is usually where a goal is worth setting
  const sorted=[...attrs].sort((a,b)=>(now(a.key)??11)-(now(b.key)??11));
  sheet(`<h2>יעד לעונה — <span translate="no">${esc(p.name||'')}</span></h2>
    <div class="stack" style="margin-top:12px">
      <label class="f">תכונה<select id="ga">${sorted.map(a=>`<option value="${a.key}">${esc(a.label)}${now(a.key)!=null?' · '+now(a.key):''}</option>`).join('')}</select></label>
      <div class="grid2">
        <label class="f">היום<input id="gb" type="number" class="num" min="1" max="20"></label>
        <label class="f">יעד<input id="gtg" type="number" class="num" min="2" max="20"></label>
      </div>
      <p class="xs muted" id="gnote"></p>
      <label class="f">איך עובדים על זה (לא חובה)<input id="gt" placeholder="למשל: 10 דק׳ קיר ברגל חלשה פעמיים בשבוע"></label>
      <label class="f">עד תאריך<input id="gd" type="date" value="${seasonEnd()}"></label>
      <button class="btn primary big" id="gs">שמירה</button></div>`);
  const fill=()=>{ const k=$('#ga').value, b=now(k)??10;
    $('#gb').value=b; $('#gtg').value=Math.min(20,b+3);
    $('#gnote').textContent=sc[k]?.conf==='high'||sc[k]?.conf==='med'?I18N.t('הציון היום מבוסס על מספיק דירוגים.')
      :I18N.t('עוד מעט דירוגים בתכונה הזו — נקודת הפתיחה עשויה לזוז. שווה לדרג אותה בשבועות הקרובים.'); };
  $('#ga').onchange=fill; fill();
  $('#gs').onclick=async()=>{
    const k=$('#ga').value, b=+$('#gb').value, tg=+$('#gtg').value;
    if(!(b>=1&&b<=20&&tg>b&&tg<=20)) return toast('היעד צריך להיות גבוה מהיום, עד 20');
    const row={id:uid(),player_id:pid,team_id:S.team?.id||null,attribute:k,baseline:b,target:tg,season:seasonOf(),
      text:$('#gt').value.trim(),due:$('#gd').value||null};
    const {error}=await sb.from('coach_goals').insert(row);
    if(error) return toast(/GOAL_LIMIT/.test(error.message)?I18N.t('לכל שחקן עד {0} יעדים פתוחים בעונה',GOALS_MAX):'שגיאה: '+error.message);
    closeSheet(); go('player',pid); toast('היעד נשמר — השחקן וההורים רואים אותו');
  };
}
function goalMenu(id,pid){
  sheet(`<h2>יעד</h2><div class="stack" style="margin-top:12px">
    <button class="btn" onclick="doneGoal('${id}','${pid}')">✓ סימון כהושג</button>
    <button class="btn danger" onclick="archiveGoal('${id}','${pid}')">הסרת היעד</button></div>`);
}
async function archiveGoal(id,pid){
  if(!confirm('להסיר את היעד? הוא לא יופיע יותר לשחקן ולהורים.')) return;
  await sb.from('coach_goals').update({archived_at:new Date().toISOString()}).eq('id',id);
  closeSheet(); go('player',pid);
}

/* ---------- family: the same plan, from the server (numbers only when allowed) ---------- */
async function famGoalsHtml(pid){
  const {data,error}=await sb.rpc('coach_kid_goals',{p_player:pid});
  const list=(!error&&Array.isArray(data))?data:[];
  if(!list.length) return '';
  const season=seasonOf();
  const cur=list.filter(g=>!g.season||g.season===season);
  if(!cur.length) return '';
  return `<div class="hd"><h2>תוכנית פיתוח אישית</h2><span class="xs muted">${esc(season)}</span></div>
    <div class="stack">${cur.map(g=>goalRow(g, g.current, {numbers:!!g.numbers})).join('')}</div>
    <p class="xs muted" style="margin-top:6px">היעדים נקבעים על ידי המאמן. ההתקדמות מתעדכנת לבד אחרי כל אימון שבו המאמן מדרג.</p>`;
}
