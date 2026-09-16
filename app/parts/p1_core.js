/*
 * Admin-fladen: kerne.
 *
 * Vanilla JS, ét dokument, ingen bygger. Delene i app/parts/ samles til
 * public/app.js af build_rune.py - redigér ALDRIG public/app.js i haanden.
 *
 * Versionen bor ÉT sted: konstanten herunder. Build'et laeser den og stempler
 * den paa runens `version:` og paa ?v=-adresserne i index.html.
 */

'use strict';

const APP_VERSION = 2;

/* Al tilstand ét sted. `data` er svaret fra /api/admin/data - den er
 * sandheden, og alt tegnes ud fra den. */
const S = {
  view: 'oversigt',
  klar: false,
  opsat: false,
  loggetInd: false,
  data: null,
  redigerer: null,      // siden der er aaben i editoren
  besked: null,         // { slags: 'ok' | 'fejl', tekst }
  travl: false,
};

/* ------------------------------------------------------------------ hjaelpere */

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const $ = (v) => document.querySelector(v);
const $$ = (v) => Array.from(document.querySelectorAll(v));

/**
 * Kald API'et.
 *
 * Content-Type saettes EFTER en eventuel merge af kalderens headers - ellers
 * forsvinder den, naar nogen sender egne (Kokkeri v15's Authorization-faelde i
 * lille udgave).
 */
async function api(sti, { metode = 'GET', krop = undefined } = {}) {
  const opsaetning = { method: metode, headers: {} };
  /* Serveren afviser ALT andet end GET uden application/json - en CSRF-barriere
   * oven paa SameSite=Lax, fordi en fremmed sides formular ikke kan saette
   * headeren. Den skal derfor med OGSAA paa kald uden krop (logout,
   * /genesys/test), ellers svarer serveren 415 paa en knap, der ser rigtig ud. */
  if (metode !== 'GET') opsaetning.headers['Content-Type'] = 'application/json';
  if (krop !== undefined) opsaetning.body = JSON.stringify(krop);
  const svar = await fetch(`/api/admin${sti}`, opsaetning);
  let json = {};
  try { json = await svar.json(); } catch { /* tomt svar er ogsaa et svar */ }
  if (!svar.ok) throw new Error(json.error || `Serveren svarede ${svar.status}`);
  return json;
}

function sig(tekst, slags = 'ok') {
  S.besked = { slags, tekst };
  tegnBesked();
  clearTimeout(sig._t);
  sig._t = setTimeout(() => { S.besked = null; tegnBesked(); }, slags === 'fejl' ? 9000 : 4000);
}

function tegnBesked() {
  const boks = $('#besked');
  if (!boks) return;
  if (!S.besked) { boks.hidden = true; boks.textContent = ''; return; }
  boks.hidden = false;
  boks.className = `besked ${S.besked.slags}`;
  boks.textContent = S.besked.tekst;
}

/** Kald et api og vis fejlen ét sted, i stedet for i tyve try/catch. */
async function proev(fn, okTekst) {
  if (S.travl) return null;
  S.travl = true;
  try {
    const svar = await fn();
    if (okTekst) sig(okTekst);
    return svar;
  } catch (e) {
    sig(e.message, 'fejl');
    return null;
  } finally {
    S.travl = false;
  }
}

async function hentData() {
  S.data = await api('/data');
  return S.data;
}

const indst = () => (S.data && S.data.indstillinger) || {};
const laas = () => (S.data && S.data.laas) || {};

/** Tid tilbage af det aabne vindue, skrevet som et menneske ville sige det. */
function timerTilbage(tid) {
  const ms = Number(tid) - Date.now();
  if (!(ms > 0)) return '';
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min.`;
  const t = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${t} t. ${r} min.` : `${t} t.`;
}

function datoTid(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('da-DK', { dateStyle: 'short', timeStyle: 'short' });
}

/* --------------------------------------------------------------------- temaet */

function tema() {
  try { return localStorage.getItem('gds_tema') || 'auto'; } catch { return 'auto'; }
}
function saetTema(vaerdi) {
  try { localStorage.setItem('gds_tema', vaerdi); } catch { /* privat vindue */ }
  document.documentElement.dataset.theme = vaerdi === 'auto'
    ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : vaerdi;
}

/* ------------------------------------------------------- registre for delene

   Delene i app/parts/ samles til ÉN fil, saa de kan se hinandens funktioner.
   Men de skal ikke KENDE hinanden: en del laegger sine knapper i HANDLINGER,
   sine formularer i FORMER og sit efterarbejde i EFTER - og kernen kalder.
   Saa kan en ny del tilfoejes uden at rette en if-kaede her.                 */

const HANDLINGER = {};
const FORMER = {};
const EFTER = [];

async function haandter(navn, el) {
  const f = HANDLINGER[navn];
  if (!f) return;
  await f(el);
}
async function haandterForm(navn, felter, form) {
  const f = FORMER[navn];
  if (!f) return;
  await f(felter, form);
}
function efterTegning() {
  for (const f of EFTER) {
    try { f(); } catch (e) { console.error(e); }
  }
}

/* --------------------------------------------------------------- login-siden */

function tegnLogin() {
  const opsat = S.opsat;
  return `
<div class="loginside">
  <form class="kort loginkort" data-form="${opsat ? 'login' : 'setup'}">
    <h1>${esc((S.data && S.data.appNavn) || 'Genesys Demo Site')}</h1>
    <p class="daemp">${opsat ? 'Log ind for at styre demo-sitet.' : 'Opret den første administrator. Det er kun dig, der styrer sitet – demo-gæster bruger sitets eget kodeord.'}</p>
    <label>Brugernavn<input name="brugernavn" autocomplete="username" required></label>
    <label>Kodeord<input name="kodeord" type="password" autocomplete="${opsat ? 'current-password' : 'new-password'}" required></label>
    <button class="knap" type="submit">${opsat ? 'Log ind' : 'Opret administrator'}</button>
  </form>
</div>`;
}

/* ------------------------------------------------------------------- skallen */

const SIDER = [
  { id: 'oversigt', navn: 'Oversigt', ikon: '◱' },
  { id: 'sider', navn: 'Sider', ikon: '▤' },
  { id: 'udseende', navn: 'Udseende', ikon: '◑' },
  { id: 'genesys', navn: 'Genesys', ikon: '◎' },
  { id: 'sikkerhed', navn: 'Adgang', ikon: '⚿' },
];

function tegnSkal(indhold) {
  const l = laas();
  return `
<div class="skal">
  <aside class="sidebar">
    <div class="maerke">
      <span class="prik${l.laast ? ' rod' : ' groen'}"></span>
      <div>
        <p class="maerkenavn">${esc(indst().site_navn || 'Demo')}</p>
        <p class="maerkestatus">${l.laast ? 'Sitet er låst' : (l.aabentVindue ? `Åbent i ${timerTilbage(l.aabenTil)}` : 'Sitet er åbent')}</p>
      </div>
    </div>
    <nav>
      ${SIDER.map((s) => `<button type="button" data-gaa="${s.id}" class="${S.view === s.id ? 'aktiv' : ''}">
        <span class="ikon">${s.ikon}</span>${esc(s.navn)}</button>`).join('')}
    </nav>
    <div class="sidebarbund">
      <a class="knap knap-linje" href="/" target="_blank" rel="noopener">Se sitet →</a>
      <button type="button" class="knap knap-tekst" data-tema>Tema</button>
      <button type="button" class="knap knap-tekst" data-logud>Log ud</button>
      <p class="version">v${APP_VERSION}</p>
    </div>
  </aside>
  <main class="indhold">
    <div id="besked" class="besked" hidden></div>
    ${indhold}
  </main>
</div>`;
}

/* ------------------------------------------------------------------ tegningen */

function tegn() {
  const rod = $('#app');
  if (!S.klar) { rod.innerHTML = '<p class="daemp indlaeser">Henter …</p>'; return; }
  if (!S.loggetInd) { rod.innerHTML = tegnLogin(); return; }

  let indhold = '';
  if (S.view === 'oversigt') indhold = tegnOversigt();
  else if (S.view === 'sider') indhold = tegnSider();
  else if (S.view === 'udseende') indhold = tegnUdseende();
  else if (S.view === 'genesys') indhold = tegnGenesys();
  else if (S.view === 'sikkerhed') indhold = tegnSikkerhed();
  rod.innerHTML = tegnSkal(indhold);
  tegnBesked();
  if (typeof efterTegning === 'function') efterTegning();
}

/* Én delegeret lytter for hele fladen. Alternativet - at binde knapper efter
 * hver tegning - taber en knap, hver gang en ny bliver tilfoejet. */
document.addEventListener('click', async (e) => {
  const maal = e.target.closest('[data-gaa],[data-logud],[data-tema],[data-handling]');
  if (!maal) return;

  if (maal.dataset.gaa) {
    S.view = maal.dataset.gaa;
    S.redigerer = null;
    tegn();
    window.scrollTo(0, 0);
    return;
  }
  if (maal.dataset.logud !== undefined) {
    await proev(() => api('/logout', { metode: 'POST' }));
    S.loggetInd = false;
    tegn();
    return;
  }
  if (maal.dataset.tema !== undefined) {
    const raekke = ['auto', 'light', 'dark'];
    const ny = raekke[(raekke.indexOf(tema()) + 1) % raekke.length];
    saetTema(ny);
    sig(`Tema: ${{ auto: 'følger systemet', light: 'lyst', dark: 'mørkt' }[ny]}`);
    return;
  }
  if (maal.dataset.handling && typeof haandter === 'function') {
    e.preventDefault();
    await haandter(maal.dataset.handling, maal);
  }
});

document.addEventListener('submit', async (e) => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  const felter = Object.fromEntries(new FormData(form).entries());
  const hvad = form.dataset.form;

  if (hvad === 'login' || hvad === 'setup') {
    const svar = await proev(() => api(hvad === 'login' ? '/login' : '/setup', { metode: 'POST', krop: felter }));
    if (!svar) return;
    await proev(async () => { await hentData(); });
    S.loggetInd = true;
    S.opsat = true;
    tegn();
    return;
  }
  if (typeof haandterForm === 'function') await haandterForm(hvad, felter, form);
});

/* --------------------------------------------------------------------- opstart */

async function start() {
  saetTema(tema());
  try {
    const status = await api('/status');
    S.opsat = status.opsat;
    S.loggetInd = status.loggetInd;
    if (S.loggetInd) await hentData();
  } catch (e) {
    S.besked = { slags: 'fejl', tekst: e.message };
  }
  S.klar = true;
  tegn();
}

window.addEventListener('DOMContentLoaded', start);
