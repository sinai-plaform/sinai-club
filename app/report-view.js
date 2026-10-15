/* ===== SINAI Club — the monthly progress report, as the parent sees it =====
   One renderer for the coach's preview, the parent's link (report.html) and the PDF.
   The report is a snapshot (coach_reports.body) taken when the coach approved it, so the
   link shows exactly what the coach saw — and nothing more. Numbers appear only when the
   coach chose to show them; otherwise levels are bars and the change is an arrow. */
(function(){
const css=`
.rp{--rb:#1E45B0;--rd:#0D1F4F;--rl:#E9EFFC;--rlime:#B9EE3E;--rink:#0E1B3D;--rmut:#5A6680;--rline:#DEE4F0;
  background:#fff;color:var(--rink);max-width:720px;margin:0 auto;border-radius:18px;overflow:hidden;border:1px solid var(--rline);
  font-family:Heebo,'Noto Sans Devanagari',system-ui,Arial,sans-serif;line-height:1.5}
.rp *{box-sizing:border-box}
.rp-hd{background:linear-gradient(135deg,#0D1F4F,#1E45B0 70%,#4D7CF0);color:#fff;padding:22px 22px 18px;position:relative}
.rp-hd .rp-brand{display:flex;align-items:center;gap:8px;font-family:Sora,Heebo,sans-serif;font-size:14px;direction:ltr;justify-content:flex-end;opacity:.95}
.rp-hd .rp-brand img{width:26px;height:26px;border-radius:6px}
.rp-hd .rp-brand b{font-weight:700}.rp-hd .rp-brand em{font-style:normal;color:#B9EE3E}
.rp-hd h1{font-family:'Secular One',Heebo,'Noto Sans Devanagari',sans-serif;font-weight:400;font-size:28px;margin:10px 0 2px;line-height:1.15}
.rp-hd p{margin:0;font-size:14px;opacity:.9}
.rp-b{padding:18px 22px 22px}
.rp-quote{background:var(--rl);border-inline-start:4px solid var(--rlime);border-radius:12px;padding:12px 14px;font-size:15.5px}
.rp-quote small{display:block;color:var(--rmut);font-size:12px;margin-top:6px}
.rp-tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px}
.rp-tile{border:1px solid var(--rline);border-radius:12px;padding:10px;text-align:center}
.rp-tile b{display:block;font-family:'Secular One',Heebo,sans-serif;font-weight:400;font-size:24px;color:var(--rb);line-height:1.1}
.rp-tile span{font-size:12px;color:var(--rmut)}
.rp h2{font-size:16px;margin:18px 0 8px;color:var(--rd);font-family:'Secular One',Heebo,'Noto Sans Devanagari',sans-serif;font-weight:400}
.rp-ach{display:flex;flex-wrap:wrap;gap:6px}
.rp-ach span{background:#F3FBE3;border:1px solid #CFEA95;color:#2D4A07;border-radius:999px;padding:4px 11px;font-size:13px}
.rp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:4px 18px}
.rp-grp h3{font-size:12px;letter-spacing:.06em;color:var(--rb);margin:8px 0 4px;font-weight:700}
.rp-at{display:grid;grid-template-columns:minmax(0,1fr) 84px 44px;gap:8px;align-items:center;padding:4px 0;font-size:13.5px}
.rp-at .rp-bar{height:7px;background:var(--rl);border-radius:99px;overflow:hidden}
.rp-at .rp-bar i{display:block;height:100%;border-radius:99px;background:var(--rb)}
.rp-at .rp-d{font-size:12px;text-align:end;font-variant-numeric:tabular-nums;white-space:nowrap}
.rp-up{color:#138A4E}.rp-dn{color:#C93A36}.rp-eq{color:var(--rmut)}
.rp-goal{border:1px solid var(--rline);border-radius:12px;padding:10px 12px;margin-bottom:8px}
.rp-goal .rp-bar{height:8px;background:var(--rl);border-radius:99px;overflow:hidden;margin-top:6px}
.rp-goal .rp-bar i{display:block;height:100%;background:var(--rb);border-radius:99px}
.rp-goal.ok .rp-bar i{background:#1F8F62}
.rp-two{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.rp-two div{border:1px solid var(--rline);border-radius:12px;padding:10px 12px;font-size:13.5px}
.rp-two b{display:block;font-size:12px;color:var(--rmut);font-weight:500;margin-bottom:2px}
.rp-ft{border-top:1px solid var(--rline);padding:12px 22px;font-size:11.5px;color:var(--rmut);display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}
@media (max-width:520px){.rp-tiles{grid-template-columns:repeat(3,1fr)}.rp-two{grid-template-columns:1fr}.rp-hd h1{font-size:24px}}
@media print{body{background:#fff!important}.rp{border:0;max-width:none}.noprint{display:none!important}}
`;
function ensureCss(){ if(document.getElementById('rp-css')) return; const s=document.createElement('style'); s.id='rp-css'; s.textContent=css; document.head.appendChild(s); }
const E=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const T=(...a)=>window.I18N?I18N.t(...a):a[0];
const GL={tech:'טכני',mental:'מנטלי',phys:'פיזי',gk:'שוער'};

function delta(a, nums){
  if(a.delta==null) return `<span class="rp-d rp-eq">—</span>`;
  const d=Math.round(a.delta*10)/10;
  if(Math.abs(d)<0.5) return `<span class="rp-d rp-eq">${T('יציב')}</span>`;
  const up=d>0;
  return `<span class="rp-d ${up?'rp-up':'rp-dn'}">${up?'▲':'▼'}${nums?` <span dir="ltr">${up?'+':''}${d}</span>`:''}</span>`;
}
function renderReport(body, coachLine, opts){
  ensureCss(); opts=opts||{};
  const b=body||{}, nums=!!b.numbers;
  const groups={}; (b.attrs||[]).forEach(a=>(groups[a.grp]=groups[a.grp]||[]).push(a));
  const att=b.attendance||{};
  const month=b.period?(window.I18N?I18N.date(b.period+'-15',{month:'long',year:'numeric'}):b.period):'';
  return `<div class="rp" id="rpcard">
    <div class="rp-hd"><div class="rp-brand"><img src="${E(opts.icon||'icon-192.png')}" alt=""><span><b>SINAI</b> <em>Club</em></span></div>
      <h1>${E(T('דוח התקדמות'))} · ${E(month)}</h1>
      <p><span translate="no">${E(b.player||'')}</span>${b.team?` · <span translate="no">${E(b.team)}</span>`:''}${b.club?` · <span translate="no">${E(b.club)}</span>`:''}</p></div>
    <div class="rp-b">
      ${coachLine?`<div class="rp-quote"><span translate="no">${E(coachLine)}</span><small>${E(T('מהמאמן'))}${b.coach?` · <span translate="no">${E(b.coach)}</span>`:''}</small></div>`:''}
      <div class="rp-tiles">
        <div class="rp-tile"><b dir="ltr">${att.total?Math.round(att.present/att.total*100)+'%':'—'}</b><span>${E(T('נוכחות החודש'))}</span></div>
        <div class="rp-tile"><b dir="ltr">${att.total?`${att.present}/${att.total}`:'—'}</b><span>${E(T('אימונים'))}</span></div>
        <div class="rp-tile"><b dir="ltr">${b.improved||0}</b><span>${E(T('תכונות שהשתפרו'))}</span></div>
      </div>
      ${(b.achievements||[]).length?`<h2>🏅 ${E(T('הישגים החודש'))}</h2><div class="rp-ach">${b.achievements.map(x=>`<span>${E(x)}</span>`).join('')}</div>`:''}
      ${(b.strengths||[]).length||(b.focus||[]).length?`<h2>${E(T('בקצרה'))}</h2><div class="rp-two">
        <div><b>💪 ${E(T('חוזקות'))}</b>${E((b.strengths||[]).join(' · ')||'—')}</div>
        <div><b>🎯 ${E(T('עובדים עכשיו על'))}</b>${E((b.focus||[]).join(' · ')||'—')}</div></div>`:''}
      ${(b.goals||[]).length?`<h2>🎯 ${E(T('תוכנית פיתוח אישית'))}</h2>${b.goals.map(g=>`<div class="rp-goal ${g.reached?'ok':''}">
        <div style="display:flex;justify-content:space-between;gap:8px"><b style="font-weight:600">${E(g.label)}${nums&&g.baseline!=null?` <span dir="ltr" style="font-weight:400;color:#5A6680">${Math.round(g.baseline)} → ${Math.round(g.target)}</span>`:''}</b>
        <span style="font-size:13px">${g.reached?'✓ '+E(T('הושג')):(g.pct!=null?g.pct+'%':'')}</span></div>
        ${g.text?`<div style="font-size:12.5px;color:#5A6680"><span translate="no">${E(g.text)}</span></div>`:''}
        ${g.pct!=null?`<div class="rp-bar"><i style="width:${Math.max(3,g.pct)}%"></i></div>`:''}</div>`).join('')}`:''}
      ${(b.attrs||[]).length?`<h2>📊 ${E(T('פרופיל התכונות'))}</h2>
        <p style="font-size:12px;color:#5A6680;margin:-4px 0 6px">${E(nums?T('סולם 1–20 · השינוי לעומת סוף החודש הקודם'):T('הפס מראה את הרמה · החץ מראה את השינוי לעומת החודש הקודם'))}</p>
        <div class="rp-grid">${['tech','mental','phys','gk'].filter(g=>groups[g]).map(g=>`<div class="rp-grp"><h3>${E(T(GL[g]))}</h3>
          ${groups[g].map(a=>`<div class="rp-at"><span>${E(a.label)}${nums&&a.now!=null?` <b dir="ltr" style="color:#1E45B0">${Math.round(a.now)}</b>`:''}</span>
            <div class="rp-bar"><i style="width:${a.now!=null?Math.max(4,a.now/20*100):0}%"></i></div>${delta(a,nums)}</div>`).join('')}</div>`).join('')}</div>`:''}
    </div>
    <div class="rp-ft"><span>${E(T('הציונים הם כלי עבודה של המאמן למעקב התקדמות — לא ציון בית-ספר.'))}</span><span dir="ltr">sinaiclub.com</span></div>
  </div>`;
}

/* PDF: the card drawn to an image (keeps Hebrew/Arabic shaping exactly as the browser shows it), on A4 */
const LIBS=['https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js','https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'];
const loadScript=u=>new Promise((ok,bad)=>{ if([...document.scripts].some(s=>s.src===u)) return ok();
  const s=document.createElement('script'); s.src=u; s.onload=ok; s.onerror=()=>bad(new Error('load')); document.head.appendChild(s); });
async function reportPdf(el, fileName){
  await Promise.all(LIBS.map(loadScript));
  if(document.fonts&&document.fonts.ready) await document.fonts.ready;
  // drawn from a copy at a fixed page width, so a phone screen gives the same A4 as a desktop
  const box=document.createElement('div'); box.setAttribute('dir',document.documentElement.dir||'rtl');
  box.style.cssText='position:fixed;top:0;left:-10000px;width:720px;background:#fff';
  const copy=el.cloneNode(true); copy.removeAttribute('id'); copy.style.maxWidth='720px'; box.appendChild(copy); document.body.appendChild(box);
  let canvas; try{ canvas=await window.html2canvas(copy,{scale:2,backgroundColor:'#ffffff',useCORS:true,logging:false,windowWidth:760}); }
  finally{ box.remove(); }
  const {jsPDF}=window.jspdf; const pdf=new jsPDF({unit:'mm',format:'a4'});
  const W=210, H=297, m=8, w=W-2*m, h=canvas.height*w/canvas.width;
  const img=canvas.toDataURL('image/jpeg',0.92);
  if(h<=H-2*m) pdf.addImage(img,'JPEG',m,m,w,h);
  else { // longer than one page: slice
    const pageH=(H-2*m)*canvas.width/w; let y=0;
    while(y<canvas.height){ const c=document.createElement('canvas'); c.width=canvas.width; c.height=Math.min(pageH,canvas.height-y);
      c.getContext('2d').drawImage(canvas,0,-y); if(y) pdf.addPage();
      pdf.addImage(c.toDataURL('image/jpeg',0.92),'JPEG',m,m,w,c.height*w/canvas.width); y+=pageH; }
  }
  const blob=pdf.output('blob'); const file=new File([blob],fileName,{type:'application/pdf'});
  // the phone's share sheet when it can take a file (WhatsApp, mail…), otherwise a download
  if(navigator.canShare&&navigator.canShare({files:[file]})){ try{ await navigator.share({files:[file],title:fileName}); return 'shared'; }catch(e){ if(e&&e.name==='AbortError') return 'cancel'; } }
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=fileName; document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },4000); return 'downloaded';
}
window.renderReport=renderReport; window.reportPdf=reportPdf;
})();
