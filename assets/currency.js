/* SINAI Club — currency: one choice for the site and the app, live rates.
   • Prices are set in shekels (₪). Shown in ₪ in Israel and $ elsewhere until the visitor picks
     another currency (kept in localStorage 'sg-cur', shared by the site and the app).
   • Rates come from the fx-rates function (one shared copy, refreshed hourly from Open Exchange
     Rates or the European Central Bank). The page asks again every hour while it is open.
   • No answer from the server → the last rates saved on this device, marked as saved.
   • Charging is in ₪: the final amount in another currency is the one the payment provider
     confirms, shown to the customer before they approve the payment. */
(function(){
var FX_URL='https://eidcnukgvmdgwmbewfgb.supabase.co/functions/v1/fx-rates';
var CODES=['ILS','USD','EUR','GBP','INR','CAD','AUD','CHF','AED','JPY','BRL','MXN','ZAR'];
var NAME={ILS:'₪ ILS',USD:'$ USD',EUR:'€ EUR',GBP:'£ GBP',INR:'₹ INR',CAD:'CA$ CAD',AUD:'A$ AUD',CHF:'CHF',AED:'AED',JPY:'¥ JPY',BRL:'R$ BRL',MXN:'MX$ MXN',ZAR:'R ZAR'};
var L={
  he:{asof:'שער נכון ל-{0}',saved:'שער שמור מ-{0} — אין כרגע עדכון',none:'אין שער זמין כרגע — המחיר מוצג ב-₪',cur:'מטבע',src:'מקור: {0}',
      pay:'החיוב בשקלים. בתשלום במטבע אחר, הסכום הסופי הוא זה שספק הסליקה מאשר, והוא מוצג לפני האישור.'},
  en:{asof:'Rate as of {0}',saved:'Saved rate from {0} — no update right now',none:'No rate available right now — price shown in ₪',cur:'Currency',src:'Source: {0}',
      pay:'Billed in shekels (₪). When you pay in another currency, the final amount is the one your payment provider confirms, shown before you approve.'},
  ru:{asof:'Курс на {0}',saved:'Сохранённый курс от {0} — обновления пока нет',none:'Курс сейчас недоступен — цена в ₪',cur:'Валюта',src:'Источник: {0}',
      pay:'Оплата в шекелях (₪). При оплате в другой валюте итоговую сумму подтверждает платёжный провайдер, и она показывается до подтверждения.'},
  ar:{asof:'السعر حتى {0}',saved:'سعر محفوظ من {0} — لا يوجد تحديث حاليًا',none:'لا يوجد سعر صرف حاليًا — السعر بالشيكل ₪',cur:'العملة',src:'المصدر: {0}',
      pay:'الدفع بالشيكل (₪). عند الدفع بعملة أخرى، المبلغ النهائي هو ما يؤكده مزوّد الدفع، ويُعرض قبل الموافقة.'},
  es:{asof:'Tipo de cambio a las {0}',saved:'Tipo guardado de {0} — sin actualización ahora',none:'Sin tipo de cambio ahora — precio en ₪',cur:'Moneda',src:'Fuente: {0}',
      pay:'Se cobra en séquels (₪). Si pagas en otra moneda, el importe final es el que confirma el proveedor de pago, y se muestra antes de aprobar.'},
  de:{asof:'Kurs von {0}',saved:'Gespeicherter Kurs von {0} — gerade keine Aktualisierung',none:'Gerade kein Kurs verfügbar — Preis in ₪',cur:'Währung',src:'Quelle: {0}',
      pay:'Abgerechnet in Schekel (₪). Bei Zahlung in einer anderen Währung gilt der Betrag, den der Zahlungsanbieter bestätigt — er wird vor der Freigabe angezeigt.'},
  fr:{asof:'Taux au {0}',saved:'Taux enregistré du {0} — pas de mise à jour pour l’instant',none:'Aucun taux disponible — prix en ₪',cur:'Devise',src:'Source : {0}',
      pay:'Facturé en shekels (₪). Si vous payez dans une autre devise, le montant final est celui confirmé par le prestataire de paiement, affiché avant validation.'},
  it:{asof:'Cambio al {0}',saved:'Cambio salvato del {0} — nessun aggiornamento ora',none:'Nessun cambio disponibile ora — prezzo in ₪',cur:'Valuta',src:'Fonte: {0}',
      pay:'Addebito in shekel (₪). Se paghi in un’altra valuta, l’importo finale è quello confermato dal fornitore di pagamento, mostrato prima della conferma.'},
  pt:{asof:'Câmbio de {0}',saved:'Câmbio salvo de {0} — sem atualização agora',none:'Sem câmbio disponível agora — preço em ₪',cur:'Moeda',src:'Fonte: {0}',
      pay:'Cobrado em shekels (₪). Ao pagar em outra moeda, o valor final é o confirmado pelo provedor de pagamento, mostrado antes da aprovação.'},
  hi:{asof:'{0} की दर',saved:'{0} की सहेजी गई दर — अभी कोई अपडेट नहीं',none:'अभी कोई दर उपलब्ध नहीं — कीमत ₪ में',cur:'मुद्रा',src:'स्रोत: {0}',
      pay:'बिलिंग शेकेल (₪) में होती है। दूसरी मुद्रा में भुगतान करने पर अंतिम राशि वही होगी जिसकी पुष्टि भुगतान प्रदाता करता है, और यह स्वीकृति से पहले दिखाई जाती है।'}
};
var LOC={he:'he-IL',en:'en-GB',ru:'ru-RU',ar:'ar-u-nu-latn',es:'es-ES',de:'de-DE',fr:'fr-FR',it:'it-IT',pt:'pt-BR',hi:'hi-IN'};
function lang(){ var l=(window.I18N&&I18N.lang)||(document.documentElement.lang||'he').slice(0,2); return L[l]?l:'en'; }
function t(k,a){ return (L[lang()][k]||L.en[k]).replace('{0}',a==null?'':a); }
function ls(k,v){ try{ if(v===undefined) return JSON.parse(localStorage.getItem(k)||'null'); localStorage.setItem(k,JSON.stringify(v)); }catch(e){ return null; } }
function inIsrael(){ try{ return Intl.DateTimeFormat().resolvedOptions().timeZone==='Asia/Jerusalem'; }catch(e){ return false; } }

var FX={ CODES:CODES, NAME:NAME, data:ls('sg-fx'), _cbs:[], loading:null };
FX.get=function(){ var c=null; try{ c=localStorage.getItem('sg-cur'); }catch(e){} return CODES.indexOf(c)>=0?c:(inIsrael()?'ILS':'USD'); };
FX.set=function(c){ if(CODES.indexOf(c)<0) return; try{ localStorage.setItem('sg-cur',c); }catch(e){} FX._fire(); };
FX.onChange=function(f){ FX._cbs.push(f); };
FX._fire=function(){ FX._cbs.forEach(function(f){ try{ f(); }catch(e){} }); };
// rates: the server copy when it answers, else the one saved on this device (marked stale)
FX.load=function(force){
  var d=FX.data, fresh=d&&d.got&&(Date.now()-d.got<30*60e3);
  if(fresh&&!force) return Promise.resolve(d);
  if(FX.loading) return FX.loading;
  FX.loading=fetch(FX_URL,{cache:'no-store'}).then(function(r){ return r.ok?r.json():Promise.reject(r.status); })
    .then(function(j){ if(!j||!j.rates) throw 0; j.got=Date.now(); FX.data=j; ls('sg-fx',j); return j; })
    .catch(function(){ if(FX.data) FX.data.stale=true; return FX.data; })
    .then(function(x){ FX.loading=null; FX._fire(); return x; });
  return FX.loading;
};
// a price in ₪ → {text, cur, note}
FX.price=function(ils, cur){
  cur=cur||FX.get(); var d=FX.data, loc=LOC[lang()]||'en-GB';
  var rate=cur==='ILS'?1:(d&&d.rates&&d.rates[cur]);
  if(!rate){ cur='ILS'; rate=1; }
  var v=ils*rate, dig=(cur==='JPY'||cur==='INR'||Number.isInteger(v)||v>=100)?0:2;
  var text; try{ text=new Intl.NumberFormat(loc,{style:'currency',currency:cur,minimumFractionDigits:dig,maximumFractionDigits:dig}).format(v); }
  catch(e){ text=v.toFixed(dig)+' '+cur; }
  return {text:text, cur:cur, value:v};
};
FX.note=function(){
  var d=FX.data, loc=LOC[lang()]||'en-GB';
  if(FX.get()==='ILS') return '';
  if(!d||!d.rates) return t('none');
  var when=new Date(d.as_of).toLocaleString(loc,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
  return (d.stale?t('saved',when):t('asof',when))+' · '+t('src',d.provider);
};
FX.payNote=function(){ return t('pay'); };
FX.label=function(){ return t('cur'); };
FX.picker=function(cls){
  var c=FX.get();
  return '<select class="cursel '+(cls||'')+'" translate="no" aria-label="'+t('cur')+'" onchange="SCFX.set(this.value)">'+
    CODES.map(function(k){ return '<option value="'+k+'"'+(k===c?' selected':'')+'>'+NAME[k]+'</option>'; }).join('')+'</select>';
};
// a page that shows prices calls start(): rates now, and again at least once an hour while it is open
FX.start=function(){ if(FX._t) return FX.load(); FX._t=setInterval(function(){ FX.load(true); }, 60*60e3); return FX.load(); };
window.SCFX=FX;
})();
