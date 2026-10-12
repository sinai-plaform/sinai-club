/* ===== SINAI Club — languages (he · en · ru · ar · es · de · fr · it · pt) =====
   Hebrew is the source language: every screen is still written in Hebrew, and this layer
   translates what reaches the page — text, placeholders, titles, toasts, confirm boxes and
   WhatsApp texts — from a dictionary keyed by the Hebrew text itself. Anything without a
   translation stays in Hebrew, so nothing ever renders blank.
   • i18n/<lang>.js holds one language (UI, drill library, parents pages): I18N.add({...})
   • keys with {0} {1}… are patterns; the parts they capture are translated again when they
     are themselves UI text (a weekday, an attribute), and left alone otherwise (a name)
   • user data (names, notes) is never in the dictionary, so it is never changed; an element
     with translate="no" (and the initials circles, .av) is skipped entirely
   • the choice is kept in localStorage 'sg-lang' (shared with the marketing site);
     first run: the device language when supported, otherwise Hebrew
   • pitch drawings are SVG with fixed coordinates — they never mirror; only labels change */
(function(){
const LANGS={he:{name:'עברית',dir:'rtl',loc:'he-IL'},en:{name:'English',dir:'ltr',loc:'en-GB'},
  ru:{name:'Русский',dir:'ltr',loc:'ru-RU'},ar:{name:'العربية',dir:'rtl',loc:'ar-u-nu-latn'},es:{name:'Español',dir:'ltr',loc:'es-ES'},
  de:{name:'Deutsch',dir:'ltr',loc:'de-DE'},fr:{name:'Français',dir:'ltr',loc:'fr-FR'},it:{name:'Italiano',dir:'ltr',loc:'it-IT'},pt:{name:'Português',dir:'ltr',loc:'pt-BR'}};
const HE=/[֐-׿]/;
const norm=s=>String(s).replace(/\s+/g,' ').trim();
function pickLang(){
  let s=null; try{ s=localStorage.getItem('sg-lang'); }catch(e){}
  if(s&&LANGS[s]) return s;
  const ls=navigator.languages||[navigator.language||''];
  for(const l of ls){ let c=String(l||'').slice(0,2).toLowerCase(); if(c==='iw') c='he'; if(LANGS[c]) return c; }
  return 'he';
}
const I={ LANGS, lang:pickLang(), dict:{}, pats:[], loaded:{}, _cbs:[] };
I.dir=()=>LANGS[I.lang].dir;
I.loc=()=>LANGS[I.lang].loc;

/* ---------- dictionary ---------- */
I.add=function(lang,map){
  if(typeof lang==='object'){ for(const [l,m] of Object.entries(lang)) I.add(l,m); return; }
  const d=I.loaded[lang]||(I.loaded[lang]={exact:new Map(),pats:[]});
  for(const [k,v] of Object.entries(map)){
    if(v==null||v==='') continue;
    const key=norm(k);
    if(/\{\d+\}/.test(key)){
      const parts=key.split(/(\{\d+\})/), lits=parts.filter((p,i)=>i%2===0).join('');
      if((lits.match(/[\u05D0-\u05EA]/g)||[]).length<2) continue;   // too generic to match safely
      const order=[]; let re='^';
      parts.forEach((p,i)=>{ if(i%2){ order.push(+p.slice(1,-1)); re+='([\\s\\S]*?)'; } else re+=p.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); });
      d.pats.push({re:new RegExp(re+'$'),order,out:v,len:lits.length});
    } else d.exact.set(key,v);
  }
  d.pats.sort((a,b)=>b.len-a.len);
};
function cur(){ return I.loaded[I.lang]; }
function fill(tpl,vals){ return tpl.replace(/\{(\d+)\}/g,(m,n)=>vals[+n]!=null?vals[+n]:''); }
// translate one piece of text; returns the same string when nothing matches
const CACHE=new Map();
function tr1(s,depth){
  const d=cur(); if(!d||!s||!HE.test(s)) return s;
  const key=norm(s); if(!key) return s;
  if(CACHE.has(key)) return CACHE.get(key);
  const r=tr2(d,key,depth); if(depth===0) CACHE.set(key,r); return r;
}
function tr2(d,key,depth){
  const s=key;
  const ex=d.exact.get(key); if(ex!=null) return ex;
  if(depth>3) return s;
  for(const p of d.pats){
    const m=key.match(p.re); if(!m) continue;
    const vals=[]; p.order.forEach((n,i)=>{ vals[n]=tr1(m[i+1],depth+1); });
    return fill(p.out,vals);
  }
  // an emoji / symbol in front or punctuation at the end: "💡 …", "◆ …", "…:"
  const m=key.match(/^([^\p{L}\p{N}"(]*)([\s\S]*?)([\s:.!?…✓]*)$/u);
  let part=null;   // a half-translated result is kept only if nothing better turns up
  if(m&&(m[1]||m[3])&&m[2]&&m[2]!==key){ const y=tr1(m[2],depth+1); if(y!==m[2]){ if(!HE.test(y)) return m[1]+y+m[3]; part=m[1]+y+m[3]; } }
  // composite labels: "ג׳–ד׳ · 60 דק׳ · 12 שחקנים", "הצהרת בריאות: טרם נחתמה"
  for(const sep of [' · ',' — ',': ']){
    if(!key.includes(sep)) continue;
    const segs=key.split(sep); let hit=false;
    const out=segs.map(x=>{ const y=tr1(x,depth+1); if(y!==x) hit=true; return y; });
    if(hit){ const j=out.join(sep); if(!HE.test(j)) return j; if(!part) part=j; }
  }
  return part||s;
}
// translate text that may have several lines and surrounding spaces
I.tr=function(s){
  if(I.lang==='he'||s==null) return s;
  s=String(s); if(!HE.test(s)) return s;
  if(s.includes('\n')){
    // a paragraph wrapped in the source: try it whole first, then line by line
    const whole=tr1(s,0); if(whole!==norm(s)) return whole;
    return s.split('\n').map(l=>I.tr(l)).join('\n');
  }
  const lead=s.match(/^\s*/)[0], trail=s.match(/\s*$/)[0];
  const out=tr1(s,0);
  return out===s ? s : lead+out+trail;
};
// t('נשמר אצל {0}', name) — explicit use in code
I.t=function(k,...a){ const v=I.lang==='he'?k:I.tr(k); return a.length?fill(v,a):v; };

/* ---------- the page ---------- */
const ORIG=new WeakMap();      // text node → its Hebrew original
const AORIG=new WeakMap();     // element → {attr: Hebrew original}
const ATTRS=['placeholder','title','aria-label','alt'];
const skip=el=>!!(el&&el.closest&&el.closest('[translate="no"],script,style,noscript,textarea,.av'));
function doText(n){
  if(!n.parentElement||skip(n.parentElement)) return;
  let o=ORIG.get(n);
  if(o&&n.data!==o.out){ o=null; ORIG.delete(n); }       // the app wrote new text into it
  const src=o?o.src:n.data;
  if(!HE.test(src)) return;
  const pe=n.parentElement;
  // an <option> without a value submits its text — keep the Hebrew value
  if(pe.tagName==='OPTION'&&!pe.hasAttribute('value')) pe.setAttribute('value',pe.textContent);
  const out=I.lang==='he'?src:I.tr(src);
  if(out!==n.data){ ORIG.set(n,{src,out}); n.data=out; }
  else if(!o&&out!==src) ORIG.set(n,{src,out});
}
// a textarea's content is the user's, but its placeholder / title is UI text
const skipA=el=>el&&el.tagName==='TEXTAREA' ? skip(el.parentElement) : skip(el);
function doAttrs(el){
  if(skipA(el)) return;
  let rec=AORIG.get(el);
  for(const a of ATTRS){
    if(!el.hasAttribute(a)) continue;
    const v=el.getAttribute(a);
    let src=v;
    if(rec&&rec[a]){ if(v===rec[a].out) src=rec[a].src; else delete rec[a]; }
    if(!HE.test(src)) continue;
    const out=I.lang==='he'?src:I.tr(src);
    if(!rec) AORIG.set(el,rec={});
    rec[a]={src,out};
    if(out!==v) el.setAttribute(a,out);
  }
}
function walk(root){
  if(!root) return;
  if(root.nodeType===3) return doText(root);
  if(root.nodeType!==1&&root.nodeType!==9&&root.nodeType!==11) return;
  if(root.nodeType===1){ if(root.tagName==='TEXTAREA') return doAttrs(root); if(skip(root)) return; doAttrs(root); }
  const tw=document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT);
  let n; while((n=tw.nextNode())){ if(n.nodeType===3) doText(n); else if(n.attributes.length) doAttrs(n); }
}
I.translateDom=walk;
let MO=null;
function observe(){
  if(MO) return;
  MO=new MutationObserver(list=>{
    if(I.lang==='he'&&!I._wasOther) return;
    for(const m of list){
      if(m.type==='childList') m.addedNodes.forEach(walk);
      else if(m.type==='characterData') doText(m.target);
      else if(m.type==='attributes') doAttrs(m.target);
    }
  });
  MO.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:ATTRS});
}

/* ---------- dialogs ---------- */
['confirm','alert','prompt'].forEach(f=>{ const o=window[f]; if(!o) return;
  window[f]=function(m,...r){ return o.call(window,I.tr(m),...r); }; });

/* ---------- dates & lists ---------- */
I.date=(d,opt)=>new Date(d).toLocaleDateString(I.loc(),opt);
I.time=d=>new Date(d).toLocaleTimeString(I.loc(),{hour:'2-digit',minute:'2-digit'});
const WD_HE=['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳'];
// weekdays from Sunday; Hebrew keeps its letters
I.weekdays=function(style){
  if(I.lang==='he'&&style!=='long') return WD_HE;
  const st=style||(I.lang==='ar'?'narrow':'short');   // Arabic short names are whole words — too wide for the day circles
  const out=[]; for(let i=0;i<7;i++) out.push(new Date(Date.UTC(2024,0,7+i,12)).toLocaleDateString(I.loc(),{weekday:st,timeZone:'UTC'}));
  return out;
};
I.list=function(arr){ arr=arr.filter(Boolean);
  if(I.lang==='he') return arr.join(' ו');
  try{ return new Intl.ListFormat(I.loc(),{type:'conjunction'}).format(arr); }catch(e){ return arr.join(', '); } };
I.back=()=>I.dir()==='rtl'?'→':'←';
I.fwd=()=>I.dir()==='rtl'?'‹':'›';

/* ---------- speech: the chosen language's voice, or none ---------- */
I.voice=function(){
  if(!window.speechSynthesis) return null;
  const vs=speechSynthesis.getVoices()||[], c=I.lang==='he'?['he','iw']:[I.lang];
  return vs.find(v=>c.some(x=>v.lang.toLowerCase().startsWith(x))&&v.localService)||vs.find(v=>c.some(x=>v.lang.toLowerCase().startsWith(x)))||null;
};
// speaks in the chosen language only; a device without such a voice stays silent (the vibration still runs)
I.speak=function(text){
  try{ if(!window.speechSynthesis||!window.SpeechSynthesisUtterance) return false;
    const v=I.voice();
    if(!v&&speechSynthesis.getVoices().length) return false;          // voices known, none for this language
    const u=new SpeechSynthesisUtterance(I.t(text)); u.lang=I.loc().split('-u-')[0];
    if(v) u.voice=v;                                                   // else: list not loaded yet, the browser picks by u.lang
    speechSynthesis.cancel(); speechSynthesis.speak(u); return true; }catch(e){ return false; }
};
try{ window.speechSynthesis&&speechSynthesis.getVoices(); }catch(e){}

/* ---------- switching ---------- */
// the language files are listed in the page as <link rel="i18n" data-lang> so the service worker keeps them offline
function fileFor(l){
  const ln=document.querySelector(`link[rel="i18n"][data-lang="${l}"]`);
  if(ln) return ln.getAttribute('href');
  const me=document.querySelector('script[src*="i18n.js"]'); if(!me) return null;
  const pack=me.getAttribute('data-pack');
  return me.getAttribute('src').replace(/i18n\.js(\?.*)?$/,`i18n/${pack?pack+'.':''}${l}.js`);
}
function load(l,sync){
  if(l==='he'||I.loaded[l]) return Promise.resolve(true);
  const u=fileFor(l); if(!u) return Promise.resolve(false);
  if(sync&&document.readyState==='loading'){ document.write(`<script src="${u}"><\/script>`); return Promise.resolve(true); }
  return new Promise(ok=>{ const s=document.createElement('script'); s.src=u; s.onload=()=>ok(true); s.onerror=()=>ok(false); document.head.appendChild(s); });
}
function applyRoot(){
  const h=document.documentElement; h.lang=I.lang; h.dir=I.dir();
}
I.onChange=f=>I._cbs.push(f);
I.set=async function(l){
  if(!LANGS[l]) return;
  try{ localStorage.setItem('sg-lang',l); }catch(e){}
  const ok=await load(l);
  if(!ok&&l!=='he'){ if(typeof toast==='function') toast('Offline — language file not available yet'); return; }
  if(I.lang!=='he') I._wasOther=true;
  I.lang=l; CACHE.clear(); applyRoot();
  walk(document.documentElement);
  I._cbs.forEach(f=>{ try{ f(l); }catch(e){ console.warn(e); } });
};
/* the picker: a native select, so it works the same on every phone */
I.picker=function(cls){
  return `<select class="langsel ${cls||''}" translate="no" aria-label="Language" onchange="I18N.set(this.value)">${
    Object.entries(LANGS).map(([k,v])=>`<option value="${k}" ${k===I.lang?'selected':''} lang="${k}">${v.name}</option>`).join('')}</select>`;
};

applyRoot();
load(I.lang,true);
observe();
document.addEventListener('DOMContentLoaded',()=>walk(document.documentElement));
window.I18N=I;
})();
