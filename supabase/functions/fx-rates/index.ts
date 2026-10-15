// SINAI Club — fx-rates
// Live exchange rates for the price display, base ILS (prices are set in shekels).
// One shared copy in the table coach_fx_rates, refreshed when it is older than an hour,
// so every visitor gets the same rate and the provider is called at most ~24 times a day.
// Provider:
//   OXR_APP_ID set → Open Exchange Rates (rates updated hourly by the provider)
//   otherwise      → European Central Bank reference rates via frankfurter.app (free, no key;
//                    the ECB publishes once a working day ~16:00 CET). AED is pegged to USD (3.6725).
// If the provider fails, the last saved rates are returned with stale: true.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SRK = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OXR = Deno.env.get('OXR_APP_ID') || '';
const CODES = ['ILS', 'USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD', 'CHF', 'AED', 'JPY', 'BRL', 'MXN', 'ZAR'];
const MAX_AGE_MS = 60 * 60 * 1000;
const AED_PER_USD = 3.6725;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (b: unknown, s = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json', ...extra } });

type Rates = { rates: Record<string, number>; provider: string; as_of: string };

// all rates as "1 ILS = x CUR"
async function fromOXR(): Promise<Rates> {
  const r = await fetch(`https://openexchangerates.org/api/latest.json?app_id=${OXR}&symbols=${CODES.join(',')}`);
  const j = await r.json();
  if (!r.ok || !j.rates?.ILS) throw new Error('oxr ' + r.status);
  const usdIls = j.rates.ILS; const out: Record<string, number> = {};
  for (const c of CODES) if (j.rates[c]) out[c] = j.rates[c] / usdIls;
  return { rates: out, provider: 'Open Exchange Rates', as_of: new Date(j.timestamp * 1000).toISOString() };
}
async function fromECB(): Promise<Rates> {
  const want = CODES.filter((c) => c !== 'ILS' && c !== 'AED');
  const r = await fetch(`https://api.frankfurter.app/latest?from=ILS&to=${want.join(',')}`);
  const j = await r.json();
  if (!r.ok || !j.rates?.USD) throw new Error('ecb ' + r.status);
  const out: Record<string, number> = { ILS: 1, ...j.rates };
  out.AED = out.USD * AED_PER_USD;
  // the ECB fixes the reference rates at 16:00 CET (14:00 UTC) on the publication date
  return { rates: out, provider: 'European Central Bank', as_of: new Date(j.date + 'T14:00:00Z').toISOString() };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const admin = createClient(SB_URL, SRK, { auth: { persistSession: false } });
  const { data: saved } = await admin.from('coach_fx_rates').select('*').eq('base', 'ILS').maybeSingle();
  const fresh = saved && Date.now() - new Date(saved.fetched_at).getTime() < MAX_AGE_MS;
  const shape = (s: any, stale: boolean) => ({
    base: 'ILS', rates: s.rates, provider: s.provider, as_of: s.as_of, fetched_at: s.fetched_at, stale,
  });
  if (fresh) return json(shape(saved, false), 200, { 'Cache-Control': 'public, max-age=300' });
  try {
    const got = OXR ? await fromOXR().catch(() => fromECB()) : await fromECB();
    const row = { base: 'ILS', rates: got.rates, provider: got.provider, as_of: got.as_of, fetched_at: new Date().toISOString() };
    await admin.from('coach_fx_rates').upsert(row, { onConflict: 'base' });
    return json(shape(row, false), 200, { 'Cache-Control': 'public, max-age=300' });
  } catch (_e) {
    if (saved) return json(shape(saved, true), 200, { 'Cache-Control': 'public, max-age=60' });
    return json({ error: 'rates unavailable' }, 503);
  }
});
