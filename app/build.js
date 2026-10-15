/* ===== SINAI Club — "בנה לי אימון" =====
   A full session, built from the library for this team:
   • what the team is weakest at — the average of the squad's ratings in the last 4 weeks,
     each attribute pulled toward the team's overall level so one rating can't decide it
   • the team's age profile (only drills for that age) and its session length
   • nothing the team did in the last two weeks, if there's an alternative
   Every drill comes with one sentence that says why it was chosen. The coach can swap,
   reorder or change minutes before saving — the result is an ordinary plan.
   Works on the pitch without signal: the ratings and the library are on the tablet. */

const WEAK_DAYS = 28;
const WEAK_K = 4;          // how strongly an attribute is pulled toward the team's overall level

async function teamWeakness(){
  const ids=S.players.map(p=>p.id);
  let list=[]; try{ list=await squadObs(); }catch(e){}
  const obs=withLocalObs(list,ids).filter(o=>!o.voided && daysAgo(o.at)<=WEAK_DAYS);
  const allowed=new Set(teamAttrs(false).filter(a=>a.grp!=='gk').map(a=>a.key));
  const by={}; let sw=0, sv=0;
  obs.forEach(o=>{
    if(!allowed.has(o.attribute)) return;
    const v=1+(o.score-1)*4.75, w=(SRC_W[o.source]||1)*(+o.weight||1);
    const b=by[o.attribute]||(by[o.attribute]={w:0,v:0,n:0,pl:new Set()});
    b.w+=w; b.v+=w*v; b.n++; b.pl.add(o.player_id); sw+=w; sv+=w*v;
  });
  const mean=sw?sv/sw:null;
  const rows=Object.entries(by).filter(([,b])=>b.n>=3 && b.pl.size>=2)
    .map(([k,b])=>({key:k,label:ATTR_LABEL(k),avg:(b.v+WEAK_K*mean)/(b.w+WEAK_K),raw:b.v/b.w,n:b.n,players:b.pl.size}))
    .sort((a,b)=>a.avg-b.avg);
  return {rows, mean, total:obs.length};
}

/* which theme of the program trains the weak attributes best */
function weakThemes(age, weak, mean){
  const gap={}; weak.slice(0,5).forEach((w,i)=>{ const g=mean-w.avg; if(g>0) gap[w.key]=g*(1-i*0.12); });
  return THEMES.filter(t=>t.ages.includes(age) && t.k!=='review').map(t=>{
    const ks=(THEME_ATTRS[t.k]||[]);
    const hit=ks.filter(k=>gap[k]!=null);
    return {t, score:hit.reduce((s,k)=>s+gap[k],0)/Math.sqrt(ks.length||1), hit};
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
}

/* drills of the last two weeks, so the new session doesn't repeat them */
async function recentDrills(){
  const used={__n:20};
  try{
    const from=new Date(Date.now()-14*864e5).toLocaleDateString('en-CA');
    const {data}=await sb.from('coach_session_drills').select('drill_id,coach_sessions!inner(team_id,date)')
      .eq('coach_sessions.team_id',S.team.id).gte('coach_sessions.date',from).limit(400);
    (data||[]).forEach(r=>{ used[r.drill_id]=19; });
  }catch(e){}
  return used;
}

const one=n=>(+n).toFixed(1);
function whyFor(slot, ctx){
  const {theme, main, second, mean, fallback}=ctx;
  const T=I18N.t;
  if(fallback){
    if(slot.theme) return T('נושא התקופה לפי רצף העונה: {0}',theme.label);
    if(slot.game) return T('משחק מסכם — שם רואים ומדרגים את מה שעבדנו עליו');
    if(slot.warm) return T('הפעלה ומניעת פציעות לפני העומס');
    if(slot.cool) return T('שחרור וסיכום קצר עם הקבוצה');
    return T('שומר על הבסיס הטכני של הגיל');
  }
  if(slot.theme==='main') return T('החולשה הבולטת בקבוצה ב-4 השבועות האחרונים: {0} ({1} מתוך 20, מול {2} בממוצע לכל התכונות)',main.label,one(main.avg),one(mean));
  if(slot.theme==='apply') return T('יישום של {0} מול לחץ, כדי שהשיפור ב{1} יעבור למשחק',theme.label,main.label);
  if(slot.game) return T('משחק מסכם — כדאי לדרג בו {0} ולראות אם יש שיפור',main.label);
  if(slot.warm) return T('הפעלה ומניעת פציעות לפני העומס');
  if(slot.cool) return T('סיכום: שאלה אחת לקבוצה על {0}',theme.label);
  if(second) return T('גם כאן עובדים על החולשה השנייה של הקבוצה: {0} ({1} מתוך 20)',second.label,one(second.avg));
  return T('שומר על הבסיס הטכני של הגיל');
}
function slotKind(label, cats){
  if(cats==='THEME') return {theme:'main'};
  if(cats==='THEME2') return {theme:'apply'};
  if(Array.isArray(cats)&&cats.includes('ssg')) return {game:1};
  if(Array.isArray(cats)&&(cats.includes('warm')&&cats[0]!=='play')) return {warm:1};
  if(Array.isArray(cats)&&cats.includes('cool')) return {cool:1};
  return {keep:1};
}

async function aiBuildSession(seedBump){
  if(!S.team) return toast('קודם בוחרים קבוצה');
  if(PLAN.items.length && !seedBump && !confirm('להחליף את התרגילים שכבר באימון באימון חדש?')) return;
  const btn=$('#aiBuild'); if(btn){ btn.disabled=true; btn.textContent=I18N.t('בונה…'); }
  const age=S.team.age_profile||'b', minutes=+S.team.session_minutes||60;
  const W=await teamWeakness();
  const themes=W.mean!=null?weakThemes(age,W.rows,W.mean):[];
  const fallback=!themes.length;
  let theme, maint=null, main=W.rows[0]||null, second=null;
  if(fallback){
    const seq=THEME_SEQ[age]||THEME_SEQ.b;
    const wk=Math.floor((Date.now()/864e5+4)/7);
    theme=themeBy(seq[wk%seq.length]); main=null;
  } else {
    theme=themes[0].t;
    main=W.rows.find(w=>themes[0].hit.includes(w.key))||W.rows[0];
    // the second weakness keeps the technique / rondo slot busy
    const other=W.rows.find(w=>w.key!==main.key && !themes[0].hit.includes(w.key) && W.mean-w.avg>0);
    if(other){ second=other; const t2=themes.find(x=>x.t.k!==theme.k && x.hit.includes(other.key)); maint=t2?t2.t:null; }
  }
  const used=await recentDrills();
  const seed=(Date.now()/864e5|0)+(seedBump||0)*7919+S.team.id.charCodeAt(0);
  const items=buildSession(theme, age, minutes, 1, used, rng(seed), maint, 1);
  const slots=SLOTS[age]||SLOTS.b;
  const ctx={theme, main, second, mean:W.mean, fallback};
  PLAN.items=items.map(it=>{
    const sl=slots.find(s=>s[0]===it.slot)||[it.slot,0,[]];
    const kind=slotKind(sl[0], sl[2]);
    return {id:it.id, min:it.min, slot:it.slot, why:whyFor(kind,ctx), kind};
  });
  PLAN.focus=theme.label;
  PLAN.ai={theme:theme.k, at:new Date().toISOString(), seed:seedBump||0,
    note: fallback
      ? I18N.t('עוד אין מספיק דירוגים מ-4 השבועות האחרונים, אז הנושא נבחר לפי רצף העונה. אחרי כמה אימונים עם דירוגים הבחירה תתבסס על החולשות של הקבוצה.')
      : I18N.t('נבנה לפי {0} דירוגים מ-4 השבועות האחרונים: {1}. {2} דק׳, לגילאי {3}.',W.total,
          W.rows.slice(0,3).map(w=>`${w.label} ${one(w.avg)}`).join(' · '),minutes,I18N.tr(AGES[age]))};
  planChanged();
  go('plan');
  toast(fallback?'נבנה לפי רצף העונה':'נבנה לפי החולשות של הקבוצה');
}
/* a drill the coach swapped in keeps the slot's reason and is marked as his choice */
function swapWhy(it){ it.swapped=true; return it.why; }
