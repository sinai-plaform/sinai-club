/* ===== SINAI Club — roster import & parent invitations ===== */

/* keep this identical to coach_norm_phone() in the database */
function normPhone(p){
  if(!p) return null;
  let d=String(p).replace(/[^0-9+]/g,'');
  if(d.startsWith('+')) d='+'+d.slice(1).replace(/[^0-9]/g,'');
  else if(d.startsWith('00')) d='+'+d.slice(2);
  else if(d.startsWith('0')) d='+972'+d.slice(1);
  else if(d.length>=8&&d.length<=9) d='+972'+d;
  else d='+'+d;
  return d.replace(/[^0-9]/g,'').length<8 ? null : d;
}
const showPhone=p=>!p?'':p.startsWith('+972')?'0'+p.slice(4):p;

async function sha256hex(s){
  const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
const randTok=()=>[...crypto.getRandomValues(new Uint8Array(32))]
  .map(x=>x.toString(16).padStart(2,'0')).join('');

/* 12/3/2016 · 12.03.16 · 2016-03-12 · an Excel serial number */
function parseBirth(v){
  v=String(v).trim(); let m;
  if((m=v.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/))){ let y=+m[3]; if(y<100) y+= y>40?1900:2000;
    const d=+m[1], mo=+m[2]; if(mo<1||mo>12||d<1||d>31) return null; return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }
  if((m=v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  if(/^\d{5}$/.test(v)){ const n=+v; if(n>30000&&n<50000){ const d=new Date(Date.UTC(1899,11,30)+n*864e5); return d.toISOString().slice(0,10); } }
  return null;
}
/* ---------- grades & groups (2.9.0) ----------
   grade: 0 = kindergarten, 1–12 = א׳–י״ב (same as coach_players.grade).
   A registration list may name the child's group ("קבוצה ב", "ג׳-ד׳ שני 16:00"), a grade, or only a
   birth date. The import turns that into teams: an existing team when the name or grade matches,
   otherwise a new one — the coach sees the plan and can change it before anything is written. */
const RG_L={'א':1,'ב':2,'ג':3,'ד':4,'ה':5,'ו':6,'ז':7,'ח':8,'ט':9,'י':10,'יא':11,'יב':12};
const RG_NAME=['גן','א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ז׳','ח׳','ט׳','י׳','י״א','י״ב'];
const rgLabel=g=>g==null?'':g===0?'גן':'כיתה '+RG_NAME[g];
/* every grade a text mentions. strict: a letter counts only with a geresh or after כיתה/שכבה,
   so "בנים א" is not first grade. loose: a bare letter counts (for a "grade" column). */
function rgIn(t, loose){
  t=String(t||'').replace(/[״"]/g,'').replace(/[–—]/g,'-');
  const out=[], L='(יב|יא|[א-י])';
  if(/גן|חובה|טרום/.test(t)) out.push(0);
  const re = loose ? new RegExp(`(?:^|[^א-ת])${L}['׳]?(?=$|[^א-ת])`,'g')
    : new RegExp(`(?:^|[^א-ת])${L}['׳](?=$|[^א-ת])|(?:כית(?:ה|ות)|שכב(?:ה|ת|ות))\\s*${L}['׳]?(?:\\s*-\\s*${L}['׳]?)?`,'g');
  for(const m of t.matchAll(re)) [m[1],m[2],m[3]].forEach(x=>{ if(x&&RG_L[x]!=null) out.push(RG_L[x]); });
  for(const m of t.matchAll(/(?:כית(?:ה|ות)|שכב(?:ה|ת|ות)|grade|class)\s*(\d{1,2})(?:\s*-\s*(\d{1,2}))?/gi))
    [m[1],m[2]].forEach(x=>{ if(x&&+x<=12) out.push(+x); });
  if(loose && !out.length){ const n=t.match(/^\s*(\d{1,2})\s*$/); if(n&&+n[1]<=12) out.push(+n[1]); }
  return out;
}
/* Israeli school year starts in September: born 2016 → grade 5 in 2026-27 */
function rgFromBirth(b){
  if(!b) return null; const d=new Date(), sy=d.getMonth()>=7?d.getFullYear():d.getFullYear()-1;
  const g=sy-(+b.slice(0,4))-5; return g>=1&&g<=12 ? g : (g<=0&&g>=-2 ? 0 : null);
}
const rgProfile=g=>g==null?'b':g<=2?'a':g<=4?'b':g<=7?'c':'d';
const nName=s=>String(s||'').replace(/\s+/g,' ').trim();
const nTeam=s=>nName(s).replace(/[׳'״"\s\-–_.]/g,'').replace(/^(קבוצת|קבוצה|כיתות|כיתה|שכבת|שכבה)/,'');
const isoToIL=b=>b?b.split('-').reverse().join('/'):'';

function parseRoster(text){
  const rows=[]; let heading='';
  for(const line of text.split(/\r?\n/)){
    const raw=line.trim(); if(!raw) continue;
    // "== name ==": a sheet / section name that applies to the lines below it
    const hm=raw.match(/^==\s*(.+?)\s*==$/); if(hm){ heading=nName(hm[1]); continue; }
    let parts=raw.split(/[\t,;|]+/).map(x=>x.trim()).filter(Boolean);
    if(!parts.length) continue;
    // a header row from a spreadsheet
    if(parts.some(p=>/^(שם|טלפון|תאריך|name|phone)/i.test(p)) && !/[0-9]{7,}/.test(raw)) continue;
    // "#group" and "@grade" tokens (written by the file reader, editable by hand)
    let group='', grade=null, gradeSet=false;
    parts=parts.filter(p=>{
      if(p.startsWith('#')){ group=nName(p.slice(1)); return false; }
      if(p.startsWith('@')){ const g=rgIn(p.slice(1),true); if(g.length){ grade=g[0]; gradeSet=true; } return false; }
      return true; });
    let birth=null;
    parts=parts.filter(p=>{ const b=parseBirth(p); if(b&&!birth){ birth=b; return false; } return true; });
    let phone=null, pi=-1;
    parts.forEach((p,i)=>{ const digits=p.replace(/[^0-9]/g,'');
      if(phone===null && digits.length>=8 && digits.length<=15 && /^[0-9+\-(). ]+$/.test(p)){ phone=normPhone(p); pi=i; } });
    if(phone===null){ const m=raw.match(/[0-9][0-9\-(). ]{7,}/); if(m){ phone=normPhone(m[0]); } }
    const names=parts.filter((_,i)=>i!==pi && !/^[0-9+\-(). ]+$/.test(parts[i]));
    const player=nName(names[0]);
    const parent=nName(names[1]);
    if(!player && !phone) continue;
    if(!group) group=heading;
    if(grade==null){ const g=rgIn(group); if(g.length){ grade=g[0]; gradeSet=true; } else grade=rgFromBirth(birth); }
    rows.push({player,parent,phone,birth,group,grade,gradeSet,raw});
  }
  return rows;
}

/* which team each group of the list goes to: same name → that team; same grade → the team whose
   name covers it (ג׳-ד׳ covers ד׳); otherwise a new team. A list with no groups → the current team. */
function planGroups(rows){
  const G=new Map();
  rows.forEach(r=>{ r.gkey = r.group || rgLabel(r.grade);
    if(!G.has(r.gkey)) G.set(r.gkey,{key:r.gkey, rows:[]}); G.get(r.gkey).rows.push(r); });
  const teamGrades=S.teams.map(t=>({t, g:rgIn(t.name)}));
  for(const g of G.values()){
    const gr=g.rows.map(r=>r.grade).filter(x=>x!=null);
    g.grade = rgIn(g.key)[0] ?? (gr.length ? gr.sort((a,b)=>gr.filter(x=>x===b).length-gr.filter(x=>x===a).length)[0] : null);
    if(!g.key){ g.target = S.team ? S.team.id : 'none'; continue; }
    const same=S.teams.find(t=>nTeam(t.name)===nTeam(g.key));
    if(same){ g.target=same.id; continue; }
    // a grade match only when the list's group is itself just a grade ("כיתה ה׳"), not a named group
    const onlyGrade = !g.rows.some(r=>r.group) || nTeam(g.key).length<=4;
    const cover = g.grade==null||!onlyGrade ? [] : teamGrades.filter(x=>x.g.length && Math.min(...x.g)<=g.grade && g.grade<=Math.max(...x.g))
      .sort((a,b)=>(Math.max(...a.g)-Math.min(...a.g))-(Math.max(...b.g)-Math.min(...b.g)));
    g.target = cover.length ? cover[0].t.id : 'new';
  }
  return [...G.values()];
}

const RIMP={rows:[],groups:[],have:[]};

/* ---------- import screen ---------- */
VIEWS.roster = function(){
  screen('ייבוא רשימה', `
    <div class="card stack">
      <p class="sm">העלו את רשימת הרשומים מהמתנ״ס, או הדביקו אותה כאן — שורה לכל שחקן.<br>
      <span class="xs muted">PDF (גם סרוק), צילום, אקסל או Google Sheets. האפליקציה מזהה שם, טלפון הורה, תאריך לידה, כיתה וקבוצה — ופותחת או מעדכנת את הקבוצות.</span></p>
      <div class="grid2">
        <label class="btn" style="cursor:pointer">📄 קובץ — PDF / אקסל / תמונה
          <input id="rfile" type="file" accept=".xlsx,.xls,.csv,.pdf,image/*" style="display:none"></label>
        <button class="btn" id="rgs">🟩 Google Sheets</button>
      </div>
      <p class="xs muted" id="rstat"></p>
      <textarea id="rtext" rows="9" placeholder="דניאל כהן, 050-1234567, רונית כהן, 12/03/2016, #קבוצה ב&#10;יואב לוי, 0521234567"></textarea>
      <p class="xs muted" style="margin-top:-4px">קבוצה מסמנים ב-# (למשל #ג׳-ד׳). בלי קבוצה — לפי הכיתה או תאריך הלידה.</p>
      <button class="btn primary" id="rprev">בדיקת הרשימה</button>
    </div>
    <div id="rout"></div>`);

  $('#rfile').onchange=e=>{ const f=e.target.files[0]; if(f) readRosterFile(f); e.target.value=''; };
  $('#rgs').onclick=()=>{
    sheet(`<h2>ייבוא מ-Google Sheets</h2>
      <p class="xs muted" style="margin:4px 0 10px">בגיליון: שיתוף ← "כל מי שיש לו את הקישור" ← צופה. ואז מדביקים כאן את הקישור.</p>
      <input id="gsu" dir="ltr" placeholder="https://docs.google.com/spreadsheets/d/…">
      <button class="btn primary big" style="margin-top:10px" id="gsgo">טעינה</button>`);
    $('#gsgo').onclick=async()=>{ const u=$('#gsu').value.trim(); closeSheet(); await readGoogleSheet(u); };
  };
  $('#rprev').onclick=rosterPreview;
};

async function rosterPreview(){
  const all=parseRoster($('#rtext').value);
  if(!all.length) return toast('לא זוהו שורות');
  const rows=all.filter(r=>r.player);
  const bad=all.filter(r=>!r.player);
  // the club's players as they are now, to tell new from existing and to show what changes
  const {data:have,error}=await sb.from('coach_players')
    .select('id,name,birth_date,parent_phone,parent_name,grade,coach_team_players(team_id)').eq('club_id',S.club.id);
  if(error) return toast('שגיאה: '+error.message);
  RIMP.have=have||[];
  const byName={}; RIMP.have.forEach(p=>byName[nName(p.name)]=p);
  rows.forEach(r=>{ const p=byName[r.player]; r.existing=p||null;
    r.changes = !p ? [] : [
      r.phone && r.phone!==p.parent_phone && 'טלפון',
      r.birth && r.birth!==p.birth_date && 'תאריך לידה',
      r.parent && r.parent!==p.parent_name && 'הורה',
      r.gradeSet && r.grade!==p.grade && 'כיתה'].filter(Boolean); });
  RIMP.rows=rows; RIMP.groups=planGroups(rows);
  renderPreview(bad);
}

function renderPreview(bad=[]){
  const rows=RIMP.rows, groups=RIMP.groups;
  const teamName=id=>(S.teams.find(t=>t.id===id)||{}).name||'';
  const targetOf=r=>{ const g=groups.find(x=>x.key===r.gkey); return g?g.target:'none'; };
  const fresh=rows.filter(r=>!r.existing).length;
  const upd=rows.filter(r=>r.existing&&r.changes.length).length;
  const moves=rows.filter(r=>{ const t=targetOf(r); if(!r.existing||t==='none') return false;
    const cur=(r.existing.coach_team_players||[]).map(x=>x.team_id); return t==='new' || !cur.includes(t); }).length;
  const noPhone=rows.filter(r=>!r.phone).length;
  const newTeams=groups.filter(g=>g.target==='new').length;
  const status=r=>{ if(!r.existing) return '<span class="pill ok">חדש</span>';
    return r.changes.length ? `<span class="pill">עדכון: ${esc(r.changes.map(c=>I18N.t(c)).join(', '))}</span>` : '<span class="xs muted">קיים</span>'; };

  $('#rout').innerHTML=`
    <div class="card" style="margin-top:12px"><h2>${rows.length===1?'שחקן אחד ברשימה':rows.length+' שחקנים ברשימה'}</h2>
      <div class="row" style="gap:14px;margin-top:10px;flex-wrap:wrap">
        <div><div class="num" style="font-size:19px">${fresh}</div><span class="xs muted">חדשים</span></div>
        <div><div class="num" style="font-size:19px">${upd}</div><span class="xs muted">יעודכנו</span></div>
        <div><div class="num" style="font-size:19px">${moves}</div><span class="xs muted">ישובצו לקבוצה</span></div>
        <div><div class="num" style="font-size:19px">${newTeams}</div><span class="xs muted">קבוצות חדשות</span></div>
      </div></div>
    ${bad.length?`<div class="alert" style="margin-top:10px">${bad.length===1?'שורה אחת תדולג — לא זוהה בה שם.':bad.length+' שורות ידולגו — לא זוהה בהן שם.'}<br>
      <span class="xs" translate="no">${bad.slice(0,4).map(b=>esc(b.raw)).join(' · ')}</span></div>`:''}
    ${noPhone?`<div class="card" style="margin-top:10px"><p class="sm">${noPhone===1
      ?'לשחקן אחד אין טלפון הורה ברשימה. הוא ייובא, ואפשר להוסיף טלפון אחר כך בכרטיס השחקן.'
      :'ל-'+noPhone+' שחקנים אין טלפון הורה ברשימה. הם ייובאו, ואפשר להוסיף טלפון אחר כך בכרטיס השחקן.'}</p></div>`:''}
    <div class="hd"><h2>קבוצות</h2></div>
    <div class="stack">${groups.map((g,i)=>`<div class="card">
      <div class="spread"><b>${g.key?`<span translate="no">${esc(g.key)}</span>`:'ללא קבוצה ברשימה'}</b>
        <span class="xs muted">${g.rows.length===1?'שחקן אחד':g.rows.length+' שחקנים'}</span></div>
      <select id="rg${i}" style="margin-top:8px">
        ${S.teams.map(t=>`<option value="${t.id}" ${g.target===t.id?'selected':''} translate="no">${esc(t.name)}</option>`).join('')}
        ${g.key?`<option value="new" ${g.target==='new'?'selected':''}>${esc(I18N.t('קבוצה חדשה: {0}',g.key))}</option>`:''}
        <option value="none" ${g.target==='none'?'selected':''}>בלי קבוצה (רק לסגל המועדון)</option>
      </select></div>`).join('')}</div>
    <div class="hd"><h2>שחקנים</h2></div>
    <div class="scroll-x"><table class="tbl"><tr><th>שחקן</th><th>טלפון</th><th>לידה</th><th>קבוצה</th><th></th></tr>
      ${rows.map(r=>{ const t=targetOf(r);
        return `<tr><td translate="no">${esc(r.player)}${r.parent?`<br><span class="xs muted">${esc(r.parent)}</span>`:''}</td>
        <td class="num" dir="ltr">${r.phone?showPhone(r.phone):'—'}</td><td class="num">${r.birth?fmtDate(r.birth):'—'}</td>
        <td translate="no">${esc(t==='new'?r.gkey:t==='none'?'—':teamName(t))}</td><td>${status(r)}</td></tr>`; }).join('')}</table></div>
    <button class="btn primary big" style="margin-top:14px" id="rgo">${rows.length===1?'ייבוא שחקן אחד':'ייבוא '+rows.length+' שחקנים'}</button>`;

  groups.forEach((g,i)=>{ $('#rg'+i).onchange=e=>{ g.target=e.target.value; renderPreview(bad); }; });
  $('#rgo').onclick=async()=>{
    const b=$('#rgo'); b.disabled=true; b.textContent='מייבא…';
    try{ await importRoster(rows, groups); }
    catch(e){ b.disabled=false; b.textContent='ייבוא'; return toast('שגיאה: '+(e.message||e)); }
  };
}

/* ---------- reading lists from files ----------
   Every file goes to the coach-roster function, which understands the layout (columns in any order,
   group headings, scanned or photographed pages). Its rows come back as editable lines in the box.
   Offline or on a server error: the old local readers (text PDF, sheet, Tesseract for photos). */
const loadScript=src=>new Promise((ok,bad)=>{ if(document.querySelector(`script[src="${src}"]`)) return ok();
  const s=document.createElement('script'); s.src=src; s.onload=ok; s.onerror=()=>bad(new Error('טעינה נכשלה')); document.head.appendChild(s); });
function rosterStatus(t){ const e=$('#rstat'); if(e) e.textContent=t; }
function putRosterText(lines, how){
  const ta=$('#rtext'); if(!ta) return;
  ta.value=lines.map(l=>l.trim()).filter(Boolean).join('\n');
  rosterStatus(I18N.t('{0}: נקראו {1} שורות. בדקו ותקנו אם צריך — הקבוצות מופיעות למטה.',how,ta.value.split('\n').length));
  rosterPreview();
}
const ROSTER_FN = SB_URL + '/functions/v1/coach-roster';
async function aiRoster(payload){
  const {data:{session}}=await sb.auth.getSession();
  const r=await fetch(ROSTER_FN,{method:'POST',headers:{'Content-Type':'application/json',
    Authorization:'Bearer '+(session?session.access_token:''),apikey:SB_KEY},
    body:JSON.stringify({...payload, teams:S.teams.map(t=>t.name), hint:S.club?.name||''})});
  const j=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(j.error||('שגיאה '+r.status));
  return j.rows||[];
}
const clip=s=>String(s||'').replace(/[\t,;|#@]/g,' ').replace(/\s+/g,' ').trim();
/* the function's rows → lines the parser (and the coach) can read */
function aiLines(rows){
  return rows.map(r=>{ const g=rgIn(r.grade,true);
    return [clip(r.player), clip(r.phone||r.phone2), clip(r.parent), isoToIL(r.birth),
      r.group?'#'+clip(r.group):'', g.length?'@'+RG_NAME[g[0]]:''].filter(Boolean).join('\t'); });
}
/* a group heading on one page goes on over the next page when that page's rows carry none */
function carryGroups(pages){
  let last='';
  pages.forEach(rows=>{ if(last && rows.length && rows.every(r=>!r.group)) rows.forEach(r=>r.group=last);
    if(rows.length&&rows[rows.length-1].group) last=rows[rows.length-1].group; });
  return pages.flat();
}
/* long sheets go in chunks, each with the header row, so the model always knows the columns */
async function aiText(lines){
  const head=lines[0]||'', body=lines.slice(1), out=[];
  for(let i=0;i<Math.max(body.length,1);i+=120){
    if(body.length>120) rosterStatus(I18N.t('קורא שורות {0}–{1}…',i+1,Math.min(i+120,body.length)));
    out.push(await aiRoster({text:[head,...body.slice(i,i+120)].join('\n')}));
  }
  return carryGroups(out);
}
function toJpeg(canvas){ return canvas.toDataURL('image/jpeg',0.85); }
function drawScaled(src,w,h,max=2000){
  const k=Math.min(1,max/Math.max(w,h)), c=document.createElement('canvas');
  c.width=Math.round(w*k); c.height=Math.round(h*k);
  const x=c.getContext('2d'); x.fillStyle='#fff'; x.fillRect(0,0,c.width,c.height); x.drawImage(src,0,0,c.width,c.height); return c;
}
async function ocrLocal(canvases){
  rosterStatus('אין חיבור לשרת — מזהה טקסט במכשיר (פחות מדויק)…');
  await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js');
  const out=[];
  for(const c of canvases){ const {data}=await Tesseract.recognize(c,'heb+eng'); out.push(...data.text.split('\n')); }
  return out;
}

async function readRosterFile(f){
  const n=f.name.toLowerCase();
  try{
    if(/\.(xlsx|xls|csv)$/.test(n)){
      rosterStatus('קורא את הגיליון…');
      await loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
      const wb=XLSX.read(await f.arrayBuffer(),{type:'array',cellDates:true});
      const lines=[];
      wb.SheetNames.forEach(sn=>{   // every sheet: clubs often keep a sheet per group
        const rows=XLSX.utils.sheet_to_json(wb.Sheets[sn],{header:1,raw:false,dateNF:'dd/mm/yyyy'});
        const ls=rows.map(r=>r.filter(c=>c!=null&&String(c).trim()!=='').join('\t')).filter(Boolean);
        if(ls.length) lines.push(...(wb.SheetNames.length>1?['== '+sn+' ==']:[]), ...ls); });
      return await readLines(lines,'אקסל');
    }
    if(n.endsWith('.pdf')){
      rosterStatus('קורא את ה-PDF…');
      await loadScript('https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js');
      pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
      const pdf=await pdfjsLib.getDocument({data:await f.arrayBuffer()}).promise; const out=[];
      const pages=Math.min(pdf.numPages,40);
      for(let i=1;i<=pages;i++){
        const tc=await (await pdf.getPage(i)).getTextContent(); const byY={};
        tc.items.forEach(it=>{ if(!it.str.trim()) return; const y=Math.round(it.transform[5]/3);
          (byY[y]=byY[y]||[]).push({x:it.transform[4],s:it.str.trim()}); });
        Object.keys(byY).map(Number).sort((a,b)=>b-a).forEach(y=>out.push(byY[y].sort((a,b)=>b.x-a.x).map(c=>c.s).join('\t')));
      }
      // a real text layer → read the text; a scan (no text, or only a stamp/title) → read the page images
      if(out.join('').replace(/\s/g,'').length > 40*pages) return await readLines(out,'PDF');
      const canvases=[];
      for(let i=1;i<=pages;i++){
        rosterStatus(I18N.t('מכין עמוד {0} מתוך {1}…',i,pages));
        const page=await pdf.getPage(i), v1=page.getViewport({scale:1});
        const vp=page.getViewport({scale:Math.min(3,2000/Math.max(v1.width,v1.height))});
        const c=document.createElement('canvas'); c.width=vp.width; c.height=vp.height;
        await page.render({canvasContext:c.getContext('2d'),viewport:vp}).promise; canvases.push(c);
      }
      return await readImages(canvases,'PDF סרוק');
    }
    if(f.type.startsWith('image/')){
      const bmp=await createImageBitmap(f);
      return await readImages([drawScaled(bmp,bmp.width,bmp.height)],'תמונה');
    }
    toast('סוג קובץ לא נתמך');
  }catch(e){ rosterStatus(''); toast('שגיאה: '+(e.message||e)); }
}
async function readLines(lines, how){
  try{ rosterStatus('מנתח את הרשימה…');
    const rows=await aiText(lines.filter(l=>l.trim()));
    if(rows.length) return putRosterText(aiLines(rows),how);
  }catch(e){ console.warn('coach-roster',e); }
  putRosterText(lines,how);    // offline / server error: the simple local reader
}
async function readImages(canvases, how){
  try{
    const pages=[];
    for(let i=0;i<canvases.length;i++){
      rosterStatus(canvases.length>1?I18N.t('קורא עמוד {0} מתוך {1}…',i+1,canvases.length):'קורא את הרשימה…');
      pages.push(await aiRoster({images:[toJpeg(canvases[i])]}));
    }
    return putRosterText(aiLines(carryGroups(pages)),how);
  }catch(e){
    if(navigator.onLine && !/fetch|network|Load failed/i.test(e.message||'')) throw e;
    return putRosterText(await ocrLocal(canvases),how);
  }
}
async function readGoogleSheet(u){
  const m=u.match(/\/d\/([a-zA-Z0-9_-]+)/); if(!m) return toast('זה לא נראה כמו קישור לגיליון');
  const gid=(u.match(/[#&?]gid=(\d+)/)||[])[1]||'0';
  rosterStatus('טוען מ-Google Sheets…');
  try{
    const r=await fetch(`https://docs.google.com/spreadsheets/d/${m[1]}/gviz/tq?tqx=out:csv&gid=${gid}`);
    if(!r.ok) throw new Error('הגיליון לא פתוח לשיתוף בקישור');
    const csv=await r.text();
    await loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
    const wb=XLSX.read(csv,{type:'string',raw:true});
    const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,raw:false});
    await readLines(rows.map(r=>r.filter(c=>c!=null&&String(c).trim()!=='').join('\t')),'Google Sheets');
  }catch(e){ rosterStatus(''); toast('לא נטען: '+(e.message||e)); }
}

/* ---------- writing: teams, players, parents, team lists ---------- */
async function importRoster(rows, groups){
  const clubId=S.club.id;
  // 1 — the new teams
  for(const g of groups){
    if(g.target!=='new') continue;
    const {data,error}=await sb.from('coach_teams').insert({club_id:clubId, name:g.key, age_profile:rgProfile(g.grade),
      session_minutes:S.team?.session_minutes||60, coach_id:S.user.id}).select().single();
    if(error) throw error;
    S.teams.push(data); g.target=data.id;
  }
  const teamOf=r=>{ const g=groups.find(x=>x.key===r.gkey); return g&&g.target!=='none'?g.target:null; };

  // 2 — players: new ones in, existing ones (same name) updated with what the list adds
  const byName={}; RIMP.have.forEach(p=>byName[nName(p.name)]=p.id);
  const newOnes=rows.filter(r=>!byName[r.player]);
  for(let i=0;i<newOnes.length;i+=200){
    const {data,error}=await sb.from('coach_players').insert(newOnes.slice(i,i+200).map(r=>({club_id:clubId, name:r.player,
      parent_name:r.parent||null, parent_phone:r.phone||null, birth_date:r.birth||null, grade:r.gradeSet?r.grade:null})))
      .select('id,name');
    if(error) throw error;
    (data||[]).forEach(p=>byName[nName(p.name)]=p.id);
  }
  const updates=rows.filter(r=>r.existing&&r.changes.length).map(r=>{ const p={};
    if(r.phone) p.parent_phone=r.phone; if(r.parent) p.parent_name=r.parent;
    if(r.birth) p.birth_date=r.birth; if(r.gradeSet) p.grade=r.grade;
    return sb.from('coach_players').update(p).eq('id',r.existing.id); });
  for(let i=0;i<updates.length;i+=10){
    const res=await Promise.all(updates.slice(i,i+10)); const bad=res.find(x=>x.error); if(bad) throw bad.error; }

  // 3 — parents, one per distinct phone, linked to their kids (siblings share a parent)
  const withPhone=rows.filter(r=>r.phone);
  const phones=[...new Set(withPhone.map(r=>r.phone))];
  if(phones.length){
    const {error:ge}=await sb.from('coach_guardians').upsert(
      phones.map(ph=>({club_id:clubId, phone:ph, name:(withPhone.find(r=>r.phone===ph&&r.parent)||{}).parent||null})),
      {onConflict:'club_id,phone', ignoreDuplicates:true});
    if(ge) throw ge;
    const {data:gs}=await sb.from('coach_guardians').select('id,phone').eq('club_id',clubId);
    const gByPhone={}; (gs||[]).forEach(g=>gByPhone[g.phone]=g.id);
    const links=withPhone.filter(r=>gByPhone[r.phone]&&byName[r.player])
      .map(r=>({guardian_id:gByPhone[r.phone], player_id:byName[r.player]}));
    if(links.length) await sb.from('coach_guardian_players').upsert(links,{ignoreDuplicates:true});
  }

  // 4 — team lists: each child in the team of their group; a child the list moves leaves the old team
  const placed=rows.map(r=>({id:byName[r.player], team:teamOf(r)})).filter(x=>x.id&&x.team);
  const moving=placed.filter(x=>{ const p=RIMP.have.find(h=>h.id===x.id); return p&&(p.coach_team_players||[]).some(t=>t.team_id!==x.team); });
  for(const x of moving) await sb.from('coach_team_players').delete().eq('player_id',x.id).neq('team_id',x.team);
  for(let i=0;i<placed.length;i+=300){
    const {error}=await sb.from('coach_team_players').upsert(placed.slice(i,i+300).map(x=>({team_id:x.team, player_id:x.id})),{ignoreDuplicates:true});
    if(error) throw error;
  }

  S.teams.sort((a,b)=>a.name.localeCompare(b.name,'he'));
  if(!S.team) S.team=S.teams.find(t=>placed.some(x=>x.team===t.id))||S.teams[0]||null;
  if(S.team) await loadTeam();
  toast(I18N.t('יובאו {0} שחקנים',rows.length));
  go('settings');
}

/* ---------- parents screen: who got a link, who joined, who opened a child account ---------- */
VIEWS.parents = async function(){
  screen('הורים', '<div class="empty">טוען…</div>');
  const [{data:st},{data:gp}] = await Promise.all([
    sb.from('coach_parent_status').select('*').eq('club_id',S.club.id).order('name'),
    sb.from('coach_guardian_players').select('guardian_id,player_id')
  ]);
  const names={}; S.players.forEach(p=>names[p.id]=p.name);
  const kidsOf={}; (gp||[]).forEach(r=>(kidsOf[r.guardian_id]=kidsOf[r.guardian_id]||[]).push(names[r.player_id]));
  const list=st||[];
  const joined  = list.filter(g=>g.registered);
  const invited = list.filter(g=>!g.registered && g.invites_sent>0);
  const untouched = list.filter(g=>!g.registered && !g.invites_sent);
  const withLogin = list.reduce((n,g)=>n+(+g.kids_with_login||0),0);
  const pct = list.length?Math.round(joined.length/list.length*100):0;

  const row=g=>{
    const kids=(kidsOf[g.guardian_id]||[]).filter(Boolean);
    const when = g.claimed_at ? 'נרשם '+fmtDate(g.claimed_at)
               : g.last_sent_at ? 'נשלח '+fmtDate(g.last_sent_at)+(g.invites_sent>1?` · ${g.invites_sent} פעמים`:'')
               : 'טרם נשלח';
    return `<div class="prow" id="i_${g.guardian_id}">
      <div class="av">${esc(initials(g.name||'?'))}</div>
      <div class="pname" style="flex:1" onclick="go('parentCard','${g.guardian_id}')">
        <b><span translate="no">${esc(g.name||showPhone(g.phone))}</span></b>
        <span class="xs muted">${kids.length?esc(kids.join(' · ')):'ללא שיוך'} · ${when}</span></div>
      ${g.registered
        ? `<span class="pill ok">מחובר</span>`
        : `<button class="btn ghost sm" style="width:auto;padding:6px 12px" onclick="sendTo('${g.guardian_id}')">
             ${g.invites_sent?'שוב':'הזמנה'}</button>`}
    </div>`;};

  $('.wrap').innerHTML=`
    <div class="card"><h2>${joined.length} מתוך ${list.length} הורים מחוברים</h2>
      <div class="bar" style="margin-top:10px"><i style="width:${pct}%"></i></div>
      <div class="row" style="gap:14px;margin-top:12px">
        <div><div class="num" style="font-size:19px">${invited.length}</div><span class="xs muted">קיבלו ולא נרשמו</span></div>
        <div><div class="num" style="font-size:19px">${untouched.length}</div><span class="xs muted">טרם נשלח</span></div>
        <div><div class="num" style="font-size:19px">${withLogin}</div><span class="xs muted">ילדים עם חשבון</span></div>
      </div></div>

    ${untouched.length?`<button class="btn primary big" style="margin:14px 0" onclick="inviteAll(0)">
      שליחה ל-${untouched.length} שטרם קיבלו</button>`:''}
    ${invited.length?`<button class="btn big" style="margin-bottom:14px" onclick="inviteAll(1)">
      תזכורת ל-${invited.length} שקיבלו ולא נרשמו</button>`:''}

    ${untouched.length?`<div class="hd"><h2>טרם נשלח</h2></div><div class="stack">${untouched.map(row).join('')}</div>`:''}
    ${invited.length?`<div class="hd"><h2>ממתינים</h2></div><div class="stack">${invited.map(row).join('')}</div>`:''}
    ${joined.length?`<div class="hd"><h2>מחוברים</h2></div><div class="stack">${joined.map(row).join('')}</div>`:''}
    ${!list.length?'<p class="muted sm">אין עדיין הורים. התחל מייבוא הרשימה.</p>':''}
    <button class="btn ghost" style="margin-top:16px" onclick="go('roster')">ייבוא רשימה</button>`;
};

/* ---------- one parent ---------- */
VIEWS.parentCard = async function(gid){
  screen('הורה', '<div class="empty">טוען…</div>');
  const [{data:g},{data:inv}] = await Promise.all([
    sb.from('coach_guardians').select('*, coach_guardian_players(player_id)').eq('id',gid).single(),
    sb.from('coach_invites').select('sent_at,claimed_at,channel,expires_at')
      .eq('guardian_id',gid).order('created_at',{ascending:false}).limit(8)
  ]);
  const names={}; S.players.forEach(p=>names[p.id]=p);
  const kids=(g.coach_guardian_players||[]).map(x=>names[x.player_id]).filter(Boolean);
  $('.wrap').innerHTML=`
    <div class="card"><h2><span translate="no">${esc(g.name||showPhone(g.phone))}</span></h2>
      <p class="muted sm" dir="ltr">${showPhone(g.phone)}</p>
      <div class="chips" style="margin-top:10px">
        <span class="chip ${g.user_id?'':'muted'}">${g.user_id?'מחובר':'לא מחובר'}</span>
        <span class="chip ${g.media_consent?'':'muted'}">${g.media_consent?'אישר צילום':'ללא אישור צילום'}</span>
      </div></div>
    <div class="hd"><h2>ילדים</h2></div>
    <div class="stack">${kids.map(k=>`<div class="prow" onclick="go('player','${k.id}')">
      <div class="av">${esc(initials(k.name))}</div>
      <div class="pname" style="flex:1"><b><span translate="no">${esc(k.name)}</span></b>
        <span class="xs muted">${k.login_enabled?'יש חשבון שחקן':'ללא חשבון'}</span></div>
      ${k.login_enabled?'<span class="pill ok">חשבון</span>':''}</div>`).join('')||'<p class="muted sm">אין שיוך.</p>'}</div>
    <div class="hd"><h2>היסטוריית הזמנות</h2></div>
    <div class="card">${(inv||[]).map(i=>`<div class="togrow"><div class="t">
      <b>${i.sent_at?'נשלח '+fmtDate(i.sent_at):'נוצר'}</b>
      <span>${i.claimed_at?'נוצל '+fmtDate(i.claimed_at):(new Date(i.expires_at)<new Date()?'פג תוקף':'ממתין')}</span>
      </div></div>`).join('')||'<p class="muted sm">טרם נשלחה הזמנה.</p>'}</div>
    <button class="btn primary" style="margin-top:14px" onclick="sendTo('${gid}')">שליחת קישור</button>`;
};

async function makeInvite(guardianId){
  const tok=randTok();
  const {data,error}=await sb.from('coach_invites').insert({
    club_id:S.club.id, guardian_id:guardianId, kind:'guardian',
    token_hash:await sha256hex(tok), created_by:S.user.id}).select('id').single();
  if(error) throw error;
  return {link: location.origin+location.pathname+'?t='+tok, id:data.id};
}
function inviteText(link, kids){
  return I18N.t('היי! זו האפליקציה של {0}.',S.club.name)+'\n'+
    (kids?I18N.t('כאן תוכל לראות את {0} — נוכחות, יעדים ועדכונים מהמאמן.',kids)+'\n':'')+
    I18N.t('הכניסה בלחיצה אחת, בלי סיסמה:')+'\n'+link;
}

/* the one place that knows HOW a link goes out.
   today: opens the coach's WhatsApp. later: a provider, same signature. */
async function deliverInvite(gid, {silent}={}){
  const {data:g}=await sb.from('coach_guardians')
    .select('phone, coach_guardian_players(player_id)').eq('id',gid).single();
  const names={}; S.players.forEach(p=>names[p.id]=p.name.split(' ')[0]);
  const kids=I18N.list((g.coach_guardian_players||[]).map(x=>names[x.player_id]));
  const {link,id}=await makeInvite(gid);
  if(!silent){
    const to=g.phone.replace(/[^0-9]/g,'');
    // nothing is recorded as sent unless WhatsApp actually opened
    if(!await waOpen(`https://wa.me/${to}?text=`+encodeURIComponent(inviteText(link,kids)))) return null;
  }
  await sb.from('coach_invites').update({
    sent_at:new Date().toISOString(), sent_count:1, channel:'whatsapp', delivery:'sent'}).eq('id',id);
  return link;
}
async function sendTo(gid){
  try{
    if(!await deliverInvite(gid)) return;
    const row=$('#i_'+gid);
    if(row){ const b=row.querySelector('button');
      if(b){ b.outerHTML='<span class="pill ok">נשלח</span>'; } row.style.opacity='.6'; }
  }catch(e){ toast('שגיאה: '+e.message); }
}
async function inviteAll(mode){
  const {data:st}=await sb.from('coach_parent_status').select('*').eq('club_id',S.club.id).order('name');
  const gs=(st||[]).filter(g=>!g.registered && (mode?g.invites_sent>0:!g.invites_sent));
  if(!gs.length) return toast('אין למי לשלוח');
  screen(mode?'תזכורות':'שליחת הזמנות', `
    <div class="card"><p class="sm">כל הורה מקבל קישור אישי משלו — ולכן אי אפשר לשלוח אחד לכולם.
    זו בדיוק הסיבה שאף הורה לא יכול להיכנס לנתונים של ילד אחר.</p>
    <p class="xs muted" style="margin-top:8px">לחיצה על שורה פותחת את השיחה עם ההודעה מוכנה, וסימון נשאר כאן.</p></div>
    <div class="stack" style="margin-top:12px">
      ${gs.map(g=>`<div class="prow" id="i_${g.guardian_id}">
        <div class="av">${esc(initials(g.name||'?'))}</div>
        <div class="pname" style="flex:1"><b><span translate="no">${esc(g.name||showPhone(g.phone))}</span></b>
          <span class="xs muted" dir="ltr">${showPhone(g.phone)}</span></div>
        <button class="btn ghost sm" style="width:auto;padding:6px 12px" onclick="sendTo('${g.guardian_id}')">שליחה</button>
      </div>`).join('')}
    </div>`);
}

/* ---------- group updates: free, through the coach's own WhatsApp groups ---------- */
const waText = t => waOpen('https://wa.me/?text='+encodeURIComponent(t));
async function copyText(t, btn){
  try{ await navigator.clipboard.writeText(t); }
  catch(e){ const a=document.createElement('textarea'); a.value=t; document.body.appendChild(a);
    a.select(); document.execCommand('copy'); a.remove(); }
  if(btn){ const o=btn.textContent; btn.textContent='הועתק ✓'; setTimeout(()=>btn.textContent=o,1400); }
}
const dayName = d=>I18N.lang==='he' ? ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'][new Date(d).getDay()] : I18N.weekdays('long')[new Date(d).getDay()];

VIEWS.broadcast = async function(){
  if(!S.team) return go('home');
  screen('עדכון לקבוצה', '<div class="empty">טוען…</div>');
  const [{data:nx},{data:lt},{data:st}] = await Promise.all([
    sb.from('coach_sessions').select('*').eq('team_id',S.team.id).gte('date',today()).order('date').limit(1),
    sb.from('coach_sessions').select('*').eq('team_id',S.team.id).eq('status','done').order('date',{ascending:false}).limit(1),
    sb.from('coach_parent_status').select('registered').eq('club_id',S.club.id)
  ]);
  const next = (nx||[])[0], last = (lt||[])[0];
  const pending = (st||[]).filter(g=>!g.registered).length;
  const when = s => !s ? '' : I18N.lang==='he' ? `יום ${dayName(s.date)} ${fmtDate(s.date)}${s.start_time?' בשעה '+s.start_time.slice(0,5):''}`
    : `${dayName(s.date)} ${fmtDate(s.date)}${s.start_time?' '+I18N.t('בשעה {0}',s.start_time.slice(0,5)):''}`;
  const sign = `\n\n— ${S.team.name}, ${S.club.name}`;
  const L = (...a)=>I18N.t(...a);      // the messages go out in the coach's language

  const T = [];
  T.push({k:'about', t:'היכרות להורים: מה זה SINAI Club',
    b:[L('הורים יקרים, השנה נעבוד עם SINAI Club: אפליקציה שבה תראו את האימון הבא, את הנוכחות, את היעדים שאני מציב לכל ילד ואת ההתקדמות שלו.'),
       L('כל הורה רואה רק את הילד שלו, וצילום של ילדים רק באישורכם.'),
       L('הסבר קצר, דקה קריאה: {0}',location.origin+'/parents/'),
       L('בימים הקרובים יגיע אליכם קישור אישי להצטרפות.')].join('\n')+sign});
  if(next) T.push({k:'reminder', t:'תזכורת לאימון הבא',
    b:[L('תזכורת: אימון {0}.',when(next)), next.focus?L('הדגש: {0}.',I18N.tr(next.focus)):'',
       L('להביא בקבוק מים ונעלי כדורגל. נתראה!')].filter(Boolean).join('\n')+sign});
  if(next) T.push({k:'cancel', t:'ביטול אימון',
    b:L('שימו לב — האימון ב{0} מבוטל.',when(next))+'\n'+L('נעדכן בהקדם לגבי השלמה. מתנצל על אי הנוחות.')+sign});
  if(next) T.push({k:'change', t:'שינוי שעה או מקום',
    b:L('עדכון לאימון ב{0}: יש שינוי ב___ (שעה / מקום).',when(next))+'\n'+L('אנא שימו לב ועדכנו את הילדים.')+sign});
  if(last) T.push({k:'summary', t:'סיכום האימון האחרון',
    b:L('סיכום האימון מ{0}.',fmtDate(last.date)+(last.focus?' — '+I18N.tr(last.focus):''))+'\n'+L('הילדים עבדו יפה. כל הכבוד!')+sign});
  if(pending) T.push({k:'invite', t:`${pending} הורים טרם נכנסו לאפליקציה`,
    b:L('הורים יקרים — מי שעדיין לא נכנס לאפליקציה של {0}, הקישור האישי נשלח אליכם בהודעה פרטית.',S.club.name)+'\n'+L('הכניסה בלחיצה אחת, בלי סיסמה. שם תוכלו לראות נוכחות, יעדים ועדכונים.')+sign});
  T.push({k:'general', t:'הודעה חופשית', b:L('הורים יקרים,')+`\n\n${sign}`});

  $('.wrap').innerHTML = `
    <div class="card"><p class="sm">בחרו הודעה — היא נכתבת מהנתונים באפליקציה. לחיצה על "וואטסאפ" פותחת את
      רשימת הצ׳אטים שלכם ואתם בוחרים את הקבוצה הרלוונטית.</p>
      <p class="xs muted" style="margin-top:8px">חינם לגמרי — ההודעה יוצאת מהוואטסאפ שלכם, לא דרך שרת.</p></div>
    <div class="alert ok" style="margin:12px 0">
      בקבוצה שולחים רק מידע כללי. כל דבר שנוגע לילד מסוים — נוכחות, ציון, התנהגות, תשלום —
      יוצא בהודעה פרטית להורה שלו בלבד, מתוך כרטיס השחקן.</div>
    <div class="stack">
      ${T.map((x,i)=>`<div class="card">
        <div class="spread"><h3>${esc(x.t)}</h3></div>
        <textarea id="bc${i}" rows="${x.k==='general'?4:5}" style="margin-top:8px">${esc(x.b)}</textarea>
        <div class="row" style="gap:8px;margin-top:8px">
          <button class="btn primary sm" style="flex:2" onclick="bcSend(${i},'${x.k}')">שליחה בוואטסאפ</button>
          <button class="btn sm" style="flex:1" onclick="copyText($('#bc${i}').value, this)">העתקה</button>
        </div></div>`).join('')}
    </div>`;
};
async function bcSend(i, kind){
  const body = $('#bc'+i).value.trim(); if(!body) return;
  if(!await waText(body)) return;
  await push('coach_messages',{club_id:S.club.id, team_id:S.team.id, kind, body,
    channel:'whatsapp_group', sent_at:new Date().toISOString(), by_user:S.user.id});
  toast('נרשם ביומן ההודעות');
}

