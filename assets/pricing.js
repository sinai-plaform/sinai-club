/* SINAI Club — the pricing section of the site.
   Two tracks, both priced per team per month, in shekels, set here in one place:
   • מאמן — a coach with up to 3 teams
   • מועדון — 4 teams and more, a lower price per team, plus the manager's tools
   The section stays hidden until PUBLISHED is true; until then it can be previewed with
   ?pricing in the address (prices marked as a draft). Currency picker and live rate: currency.js. */
(function(){
var PUBLISHED = false;
// ILS per team per month. ils:null = not decided yet (the preview shows the draft value, marked).
var PLANS = [
  {k:'coach', ils:null, draft:99},
  {k:'club',  ils:null, draft:79, best:true}
];
var TX={
  he:{h:'מחירים',sub:'משלמים לפי קבוצה, לא לפי ילד. בלי התחייבות, וכל ההורים והשחקנים של הקבוצה כלולים.',per:'לקבוצה לחודש',
      plans:{coach:{n:'מאמן',d:'עד 3 קבוצות',inc:['תכנון אימונים ובונה אימון חכם לפי החולשות','דירוג בהקשה ובקול, כרטיס שחקן','דוח חודשי להורים ותוכנית פיתוח אישית','אפליקציה להורים ולשחקנים, שיחות מוגנות']},
             club:{n:'מועדון',d:'4 קבוצות ומעלה',inc:['כל מה שיש במסלול המאמן','לוח מנהל: נוכחות, נטישה ופעילות המאמנים','ספריית תרגילים מועדונית ומתודולוגיה אחידה','מיתוג המועדון והטמעה מלווה']}},
      best:'משתלם למועדונים',cta:'תיאום הדגמה',draft:'טיוטה — המחיר עוד לא נקבע'},
  en:{h:'Pricing',sub:'Priced per team, not per child. No commitment — every parent and player in the team is included.',per:'per team / month',
      plans:{coach:{n:'Coach',d:'Up to 3 teams',inc:['Session planning and a smart session built from your team’s weak spots','Tap and voice ratings, player card','Monthly parent report and personal development plan','App for parents and players, protected conversations']},
             club:{n:'Club',d:'4 teams and more',inc:['Everything in Coach','Manager dashboard: attendance, dropout risk, coach activity','Club drill library and one methodology','Club branding and guided onboarding']}},
      best:'Best for clubs',cta:'Book a demo',draft:'Draft — price not set yet'},
  ru:{h:'Цены',sub:'Оплата за команду, а не за ребёнка. Без обязательств — все родители и игроки команды включены.',per:'за команду в месяц',
      plans:{coach:{n:'Тренер',d:'До 3 команд',inc:['Планирование и умная тренировка по слабым местам команды','Оценки касанием и голосом, карточка игрока','Ежемесячный отчёт для родителей и личный план развития','Приложение для родителей и игроков, защищённые переписки']},
             club:{n:'Клуб',d:'От 4 команд',inc:['Всё из тарифа «Тренер»','Панель руководителя: посещаемость, риск ухода, активность тренеров','Клубная библиотека упражнений и единая методология','Брендинг клуба и сопровождение внедрения']}},
      best:'Выгодно клубам',cta:'Записаться на демо',draft:'Черновик — цена ещё не установлена'},
  ar:{h:'الأسعار',sub:'الدفع لكل فريق، لا لكل طفل. بلا التزام، وكل الأهل واللاعبين في الفريق مشمولون.',per:'لكل فريق شهريًا',
      plans:{coach:{n:'مدرب',d:'حتى 3 فرق',inc:['تخطيط التدريبات وتدريب ذكي مبني على نقاط ضعف الفريق','تقييم بلمسة وبالصوت، بطاقة لاعب','تقرير شهري للأهل وخطة تطوير شخصية','تطبيق للأهل وللاعبين، محادثات محمية']},
             club:{n:'نادٍ',d:'4 فرق فأكثر',inc:['كل ما في باقة المدرب','لوحة المدير: الحضور، خطر الانسحاب، نشاط المدربين','مكتبة تمارين للنادي ومنهجية موحّدة','هوية النادي ومرافقة في التطبيق']}},
      best:'الأوفر للأندية',cta:'حجز عرض توضيحي',draft:'مسودة — لم يُحدَّد السعر بعد'},
  es:{h:'Precios',sub:'Se paga por equipo, no por niño. Sin permanencia: todas las familias y jugadores del equipo incluidos.',per:'por equipo / mes',
      plans:{coach:{n:'Entrenador',d:'Hasta 3 equipos',inc:['Planificación y sesión inteligente según los puntos débiles del equipo','Valoraciones con un toque y por voz, ficha del jugador','Informe mensual para las familias y plan de desarrollo personal','App para familias y jugadores, conversaciones protegidas']},
             club:{n:'Club',d:'4 equipos o más',inc:['Todo lo del plan Entrenador','Panel del coordinador: asistencia, riesgo de abandono, actividad de los entrenadores','Biblioteca de ejercicios del club y una metodología común','Marca del club y puesta en marcha acompañada']}},
      best:'Ideal para clubes',cta:'Reservar una demo',draft:'Borrador — precio aún sin definir'},
  de:{h:'Preise',sub:'Bezahlt wird pro Team, nicht pro Kind. Ohne Vertragsbindung — alle Eltern und Spieler des Teams inklusive.',per:'pro Team / Monat',
      plans:{coach:{n:'Trainer',d:'Bis zu 3 Teams',inc:['Trainingsplanung und eine smarte Einheit nach den Schwächen des Teams','Bewertung per Tipp und per Stimme, Spielerkarte','Monatsbericht für Eltern und persönlicher Entwicklungsplan','App für Eltern und Spieler, geschützte Unterhaltungen']},
             club:{n:'Verein',d:'Ab 4 Teams',inc:['Alles aus dem Trainer-Paket','Leitungs-Dashboard: Anwesenheit, Abbruchrisiko, Aktivität der Trainer','Vereins-Übungsbibliothek und eine gemeinsame Methodik','Vereinsbranding und begleitete Einführung']}},
      best:'Ideal für Vereine',cta:'Demo vereinbaren',draft:'Entwurf — Preis noch nicht festgelegt'},
  fr:{h:'Tarifs',sub:'On paie par équipe, pas par enfant. Sans engagement : tous les parents et joueurs de l’équipe sont inclus.',per:'par équipe / mois',
      plans:{coach:{n:'Entraîneur',d:'Jusqu’à 3 équipes',inc:['Planification et séance intelligente selon les points faibles de l’équipe','Notes en un geste et à la voix, fiche joueur','Rapport mensuel pour les parents et plan de progression personnel','Appli pour les parents et les joueurs, conversations protégées']},
             club:{n:'Club',d:'4 équipes et plus',inc:['Tout le forfait Entraîneur','Tableau de bord du responsable : présence, risque d’abandon, activité des entraîneurs','Bibliothèque d’exercices du club et méthodologie commune','Image du club et mise en place accompagnée']}},
      best:'Idéal pour les clubs',cta:'Réserver une démo',draft:'Brouillon — prix pas encore fixé'},
  it:{h:'Prezzi',sub:'Si paga per squadra, non per bambino. Senza vincoli: tutti i genitori e i giocatori della squadra inclusi.',per:'per squadra / mese',
      plans:{coach:{n:'Allenatore',d:'Fino a 3 squadre',inc:['Pianificazione e seduta intelligente sui punti deboli della squadra','Valutazioni con un tocco e a voce, scheda giocatore','Report mensile per i genitori e piano di sviluppo personale','App per genitori e giocatori, conversazioni protette']},
             club:{n:'Società',d:'Da 4 squadre in su',inc:['Tutto il piano Allenatore','Pannello del responsabile: presenze, rischio abbandono, attività degli allenatori','Libreria esercizi della società e metodologia unica','Brand della società e avvio accompagnato']}},
      best:'Ideale per le società',cta:'Prenota una demo',draft:'Bozza — prezzo non ancora definito'},
  pt:{h:'Preços',sub:'Paga-se por time, não por criança. Sem fidelidade: todos os pais e jogadores do time incluídos.',per:'por time / mês',
      plans:{coach:{n:'Treinador',d:'Até 3 times',inc:['Planejamento e treino inteligente pelos pontos fracos do time','Avaliações com um toque e por voz, card do jogador','Relatório mensal para os pais e plano de desenvolvimento pessoal','App para pais e jogadores, conversas protegidas']},
             club:{n:'Clube',d:'4 times ou mais',inc:['Tudo do plano Treinador','Painel do coordenador: presença, risco de desistência, atividade dos treinadores','Biblioteca de exercícios do clube e metodologia única','Marca do clube e implantação acompanhada']}},
      best:'Ideal para clubes',cta:'Agendar uma demo',draft:'Rascunho — preço ainda não definido'},
  hi:{h:'कीमतें',sub:'भुगतान टीम के हिसाब से, बच्चे के हिसाब से नहीं। कोई बंधन नहीं — टीम के सभी माता-पिता और खिलाड़ी शामिल।',per:'प्रति टीम / महीना',
      plans:{coach:{n:'कोच',d:'3 टीमों तक',inc:['ट्रेनिंग प्लानिंग और टीम की कमज़ोरियों पर बना स्मार्ट सत्र','टैप और आवाज़ से रेटिंग, खिलाड़ी कार्ड','माता-पिता के लिए मासिक रिपोर्ट और व्यक्तिगत विकास योजना','माता-पिता और खिलाड़ियों के लिए ऐप, सुरक्षित बातचीत']},
             club:{n:'क्लब',d:'4 या उससे ज़्यादा टीमें',inc:['कोच प्लान की हर सुविधा','मैनेजर डैशबोर्ड: उपस्थिति, छोड़ने का जोखिम, कोचों की गतिविधि','क्लब की ड्रिल लाइब्रेरी और एक जैसी कार्यप्रणाली','क्लब ब्रांडिंग और साथ-साथ ऑनबोर्डिंग']}},
      best:'क्लबों के लिए सबसे फ़ायदेमंद',cta:'डेमो बुक करें',draft:'ड्राफ़्ट — कीमत अभी तय नहीं'}
};
var preview=/[?&]pricing\b/.test(location.search);
var sec=document.getElementById('pricing');
if(!sec||!window.SCFX||!(PUBLISHED||preview)) return;
var lang=(document.documentElement.lang||'he').slice(0,2), X=TX[lang]||TX.en;
function card(p){
  var t=X.plans[p.k], ils=p.ils!=null?p.ils:p.draft, pr=SCFX.price(ils);
  return '<div class="pr-card'+(p.best?' pr-best':'')+'">'+
    (p.ils==null?'<span class="pr-draft">'+X.draft+'</span>':(p.best?'<span class="pr-tag">'+X.best+'</span>':''))+
    '<h3 class="pr-n">'+t.n+'</h3><p class="pr-d">'+t.d+'</p>'+
    '<div class="pr-price" dir="ltr">'+pr.text+'</div><div class="pr-per">'+X.per+'</div>'+
    '<ul class="pr-inc">'+t.inc.map(function(s){ return '<li>'+s+'</li>'; }).join('')+'</ul>'+
    '<a class="btn '+(p.best?'btn-lime':'btn-ghost')+' pr-cta" href="#contact">'+X.cta+'</a></div>';
}
function draw(){
  var note=SCFX.note();
  sec.innerHTML='<div class="wrap pr-wrap"><h2 class="pr-h">'+X.h+'</h2><p class="pr-sub">'+X.sub+'</p>'+
    '<label class="pr-cur"><span>'+SCFX.label()+'</span>'+SCFX.picker()+'</label>'+
    '<div class="pr-grid">'+PLANS.map(card).join('')+'</div>'+
    (note?'<p class="pr-note">'+note+'</p>':'')+
    '<p class="pr-pay">'+SCFX.payNote()+'</p></div>';
}
var st=document.createElement('style');
st.textContent='#pricing{padding:40px 0}.pr-wrap{max-width:860px;margin:0 auto;padding:0 16px;text-align:center}'+
 '.pr-h{font-size:clamp(28px,4vw,40px);margin:0 0 8px}.pr-sub{color:var(--mut,#5A6680);margin:0 0 14px}'+
 '.pr-cur{display:inline-flex;align-items:center;gap:8px;font-size:13px;color:var(--mut,#5A6680);margin-bottom:22px}'+
 '.pr-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;text-align:start}'+
 '.pr-card{position:relative;display:flex;flex-direction:column;background:#fff;border:1px solid var(--line,#DEE4F0);border-radius:20px;padding:24px;box-shadow:0 18px 40px rgba(13,31,79,.08)}'+
 '.pr-best{border:2px solid var(--pri,#1E45B0)}'+
 '.pr-draft,.pr-tag{position:absolute;top:-12px;inset-inline-start:18px;border-radius:999px;padding:3px 12px;font-size:12px;font-weight:700}'+
 '.pr-draft{background:#FFE7B3;color:#7A4B00}.pr-tag{background:var(--lime,#B9EE3E);color:var(--lime-ink,#1A2606)}'+
 '.pr-n{font-size:22px;margin:4px 0 0;color:var(--deep,#0D1F4F)}.pr-d{color:var(--mut,#5A6680);margin:2px 0 14px;font-size:14px}'+
 '.pr-price{font-size:42px;font-weight:800;color:var(--deep,#0D1F4F);line-height:1}.pr-per{color:var(--mut,#5A6680);font-size:14px;margin-top:4px}'+
 '.cursel{height:38px;border:1px solid var(--line,#DEE4F0);border-radius:12px;background:#fff;padding:0 10px;font:600 14px inherit;color:var(--ink,#0E1B3D)}'+
 '.pr-inc{margin:16px 0;padding-inline-start:20px;line-height:1.8;flex:1}'+
 '.pr-cta{display:inline-flex;justify-content:center}'+
 '.pr-note{font-size:12.5px;color:var(--mut,#5A6680);margin:16px 0 0}.pr-pay{font-size:12px;color:var(--mut,#5A6680);margin:6px 0 0}';
document.head.appendChild(st);
sec.hidden=false; draw();
SCFX.onChange(draw); SCFX.start();
})();
