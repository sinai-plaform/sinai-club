/* SINAI Club — the pricing section of the site.
   Prices are set here, in shekels, in one place. The section stays hidden until PUBLISHED is
   true; until then it can be previewed with ?pricing in the address (marked as a draft).
   The currency picker and the live rate come from currency.js. */
(function(){
var PUBLISHED = false;
// ILS per active player per month. null = not decided yet (the preview shows the draft value, marked).
var PLANS = [
  {k:'club',  ils:null, draft:12, unit:'player'},
];
var TX={
  he:{h:'מחירים',sub:'מחיר אחד לשחקן פעיל בחודש. בלי התחייבות, וכל הפיצ׳רים כלולים.',per:'לשחקן לחודש',
      inc:['תכנון אימונים ובונה אימון לפי החולשות','דירוג בהקשה ובקול, כרטיס שחקן','דוח חודשי להורים','אפליקציה להורים ולשחקנים'],
      cta:'תיאום הדגמה',draft:'טיוטה — המחיר עוד לא נקבע'},
  en:{h:'Pricing',sub:'One price per active player per month. No commitment, every feature included.',per:'per player / month',
      inc:['Session planning and a session built from your team’s weak spots','Tap and voice ratings, player card','Monthly report for parents','App for parents and players'],
      cta:'Book a demo',draft:'Draft — price not set yet'},
  ru:{h:'Цены',sub:'Одна цена за активного игрока в месяц. Без обязательств, все функции включены.',per:'за игрока в месяц',
      inc:['Планирование и тренировка по слабым местам команды','Оценки касанием и голосом, карточка игрока','Ежемесячный отчёт для родителей','Приложение для родителей и игроков'],
      cta:'Записаться на демо',draft:'Черновик — цена ещё не установлена'},
  ar:{h:'الأسعار',sub:'سعر واحد لكل لاعب نشط شهريًا. بلا التزام، وكل الميزات مشمولة.',per:'لكل لاعب شهريًا',
      inc:['تخطيط التدريبات وتدريب مبني على نقاط ضعف الفريق','تقييم بلمسة وبالصوت، بطاقة لاعب','تقرير شهري للأهل','تطبيق للأهل وللاعبين'],
      cta:'حجز عرض توضيحي',draft:'مسودة — لم يُحدَّد السعر بعد'},
  es:{h:'Precios',sub:'Un precio por jugador activo al mes. Sin permanencia, todo incluido.',per:'por jugador / mes',
      inc:['Planificación y sesión creada según los puntos débiles del equipo','Valoraciones con un toque y por voz, ficha del jugador','Informe mensual para las familias','App para familias y jugadores'],
      cta:'Reservar una demo',draft:'Borrador — precio aún sin definir'},
  de:{h:'Preise',sub:'Ein Preis pro aktivem Spieler und Monat. Ohne Vertragsbindung, alle Funktionen inklusive.',per:'pro Spieler / Monat',
      inc:['Trainingsplanung und eine Einheit nach den Schwächen des Teams','Bewertung per Tipp und per Stimme, Spielerkarte','Monatsbericht für Eltern','App für Eltern und Spieler'],
      cta:'Demo vereinbaren',draft:'Entwurf — Preis noch nicht festgelegt'},
  fr:{h:'Tarifs',sub:'Un seul prix par joueur actif et par mois. Sans engagement, tout inclus.',per:'par joueur / mois',
      inc:['Planification et séance construite selon les points faibles de l’équipe','Notes en un geste et à la voix, fiche joueur','Rapport mensuel pour les parents','Appli pour les parents et les joueurs'],
      cta:'Réserver une démo',draft:'Brouillon — prix pas encore fixé'},
  it:{h:'Prezzi',sub:'Un prezzo per giocatore attivo al mese. Senza vincoli, tutto incluso.',per:'per giocatore / mese',
      inc:['Pianificazione e seduta costruita sui punti deboli della squadra','Valutazioni con un tocco e a voce, scheda giocatore','Report mensile per i genitori','App per genitori e giocatori'],
      cta:'Prenota una demo',draft:'Bozza — prezzo non ancora definito'},
  pt:{h:'Preços',sub:'Um preço por jogador ativo por mês. Sem fidelidade, tudo incluído.',per:'por jogador / mês',
      inc:['Planejamento e treino montado pelos pontos fracos do time','Avaliações com um toque e por voz, card do jogador','Relatório mensal para os pais','App para pais e jogadores'],
      cta:'Agendar uma demo',draft:'Rascunho — preço ainda não definido'},
  hi:{h:'कीमतें',sub:'हर सक्रिय खिलाड़ी के लिए हर महीने एक ही कीमत। कोई बंधन नहीं, सभी फ़ीचर शामिल।',per:'प्रति खिलाड़ी / महीना',
      inc:['ट्रेनिंग प्लानिंग और टीम की कमज़ोरियों के हिसाब से बना सत्र','टैप और आवाज़ से रेटिंग, खिलाड़ी कार्ड','माता-पिता के लिए मासिक रिपोर्ट','माता-पिता और खिलाड़ियों के लिए ऐप'],
      cta:'डेमो बुक करें',draft:'ड्राफ़्ट — कीमत अभी तय नहीं'}
};
var preview=/[?&]pricing\b/.test(location.search);
var sec=document.getElementById('pricing');
if(!sec||!window.SCFX||!(PUBLISHED||preview)) return;
var lang=(document.documentElement.lang||'he').slice(0,2), X=TX[lang]||TX.en;
function draw(){
  var p=PLANS[0], ils=p.ils!=null?p.ils:p.draft, pr=SCFX.price(ils), note=SCFX.note();
  sec.innerHTML='<div class="wrap pr-wrap"><h2 class="pr-h">'+X.h+'</h2><p class="pr-sub">'+X.sub+'</p>'+
    '<div class="pr-card">'+(p.ils==null?'<span class="pr-draft">'+X.draft+'</span>':'')+
    '<div class="pr-row"><div><div class="pr-price" dir="ltr">'+pr.text+'</div><div class="pr-per">'+X.per+'</div></div>'+
    '<label class="pr-cur"><span>'+SCFX.label()+'</span>'+SCFX.picker()+'</label></div>'+
    (note?'<p class="pr-note">'+note+'</p>':'')+
    '<ul class="pr-inc">'+X.inc.map(function(s){ return '<li>'+s+'</li>'; }).join('')+'</ul>'+
    '<a class="btn btn-lime pr-cta" href="#contact">'+X.cta+'</a>'+
    '<p class="pr-pay">'+SCFX.payNote()+'</p></div></div>';
}
var st=document.createElement('style');
st.textContent='#pricing{padding:40px 0}.pr-wrap{max-width:720px;margin:0 auto;padding:0 16px;text-align:center}'+
 '.pr-h{font-size:clamp(28px,4vw,40px);margin:0 0 8px}.pr-sub{color:var(--mut,#5A6680);margin:0 0 18px}'+
 '.pr-card{position:relative;background:#fff;border:1px solid var(--line,#DEE4F0);border-radius:20px;padding:24px;text-align:start;box-shadow:0 18px 40px rgba(13,31,79,.08)}'+
 '.pr-draft{position:absolute;top:-12px;inset-inline-start:18px;background:#FFE7B3;color:#7A4B00;border-radius:999px;padding:3px 12px;font-size:12px;font-weight:700}'+
 '.pr-row{display:flex;justify-content:space-between;align-items:flex-end;gap:14px;flex-wrap:wrap}'+
 '.pr-price{font-size:44px;font-weight:800;color:var(--deep,#0D1F4F);line-height:1}.pr-per{color:var(--mut,#5A6680);font-size:14px;margin-top:4px}'+
 '.pr-cur{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--mut,#5A6680)}'+
 '.cursel{height:40px;border:1px solid var(--line,#DEE4F0);border-radius:12px;background:#fff;padding:0 10px;font:600 14px inherit;color:var(--ink,#0E1B3D)}'+
 '.pr-note{font-size:12.5px;color:var(--mut,#5A6680);margin:10px 0 0}.pr-inc{margin:16px 0;padding-inline-start:20px;line-height:1.9}'+
 '.pr-cta{display:inline-flex}.pr-pay{font-size:12px;color:var(--mut,#5A6680);margin:12px 0 0}';
document.head.appendChild(st);
sec.hidden=false; draw();
SCFX.onChange(draw); SCFX.start();
})();
