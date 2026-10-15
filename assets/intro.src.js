/* SINAI Club — branded intro (source; the minified copy is inlined right after <body> in the
   home page of every language and in the app, so it costs no extra request).
   In the style of the SINAI Cinema splash: the logo scales in, the wordmark rises, a lime bar sweeps.
   ≤ 1.5 s in all · once per browser session (site and app share it) · a tap or a key skips it ·
   nothing with "reduce motion" · the page loads underneath, nothing waits for it. */
(function(){try{
  if(window.__scApp) return;                                   // on the way into the app: the app shows it
  var K='sc-intro'; if(sessionStorage.getItem(K)) return; sessionStorage.setItem(K,'1');
  if(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var d=document.createElement('div'); d.id='scIntro'; d.setAttribute('aria-hidden','true');
  d.innerHTML='<style>#scIntro{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;'+
    'background:radial-gradient(120% 90% at 50% 40%,#1E45B0 0%,#0D1F4F 70%);cursor:pointer;transition:opacity .25s ease}'+
    '#scIntro.out{opacity:0}#scIntro .in{display:flex;flex-direction:column;align-items:center}'+
    '#scIntro img{width:92px;height:92px;border-radius:22px;opacity:0;transform:scale(.82);'+
    'filter:drop-shadow(0 12px 30px rgba(0,0,0,.35));animation:siA .5s cubic-bezier(.22,1,.36,1) .05s forwards}'+
    '#scIntro .w{direction:ltr;margin-top:14px;font:400 30px/1 Sora,Heebo,system-ui,sans-serif;letter-spacing:-.4px;color:#fff;'+
    'opacity:0;transform:translateY(8px);animation:siB .4s ease .3s forwards}#scIntro .w b{font-weight:700}#scIntro .w span{color:#B9EE3E}'+
    '#scIntro i{display:block;height:3px;width:0;margin-top:14px;border-radius:3px;background:#B9EE3E;animation:siC .45s cubic-bezier(.22,1,.36,1) .55s forwards}'+
    '@keyframes siA{to{opacity:1;transform:none}}@keyframes siB{to{opacity:1;transform:none}}@keyframes siC{to{width:132px}}</style>'+
    '<div class="in"><img src="LOGO" alt=""><div class="w"><b>SINAI</b> <span>Club</span></div><i></i></div>';
  document.body.appendChild(d);
  var gone=false, t;
  function end(){ if(gone) return; gone=true; clearTimeout(t); d.className='out'; setTimeout(function(){ d.parentNode&&d.parentNode.removeChild(d); },260);
    removeEventListener('keydown',end); }
  t=setTimeout(end,1230);
  d.addEventListener('pointerdown',end); addEventListener('keydown',end);
}catch(e){}})();
