/*
 * Genesys Demo Site - serveren.
 *
 * Appen er to ting i ét:
 *
 *   1. **Demo-sitet** paa /, som serveren tegner side for side, med Genesys'
 *      Web Messaging-snippet lagt ind og en vidensbase hentet fra Genesys Cloud.
 *   2. **Admin** paa /admin, hvor siderne, Genesys-opsaetningen og laasen
 *      styres. Admin er altid bag login - ogsaa naar sitet er aabent.
 *
 * Laasen er sitets egen: ÉT delt kodeord, der kan slaas fra i et tidsvindue
 * (»aabent de naeste fire timer«), saa en demo aldrig moeder en kodeordsboks -
 * og saa sitet lukker sig selv igen bagefter.
 *
 * Ingen npm-pakker. node:http, node:sqlite, node:crypto - det er hele listen.
 */

'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const sider = require('./sider.js');
const hentIndUdefra = require('./import.js');
const genesysModul = require('./genesys.js');
const { klientIp } = require('./klientip.js');

const BIND_PORT = parseInt(process.env.BIND_PORT || '3000', 10);
const DATA_DIR = process.env.DATA_DIR || process.cwd();
const APP_DIR = __dirname;
const PUBLIC_DIR = path.join(APP_DIR, 'public');
const APP_NAME = process.env.APP_NAME || 'Genesys Demo Site';
const DB_PATH = path.join(DATA_DIR, 'demosite.db');
const SESSION_DAGE = 30;
const SITE_SESSION_DAGE = 7;

/* Versionen staar ét sted - i frontendens kilde - og stemples i index.html af
 * build_rune.py. Serveren laeser den derfra, saa /site.css?v=N faar samme tal
 * som admin (RUNE-ERFARINGER §5: Cloudflare cacher css/js i timevis). */
const APP_VERSION = (() => {
  try {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
    const m = html.match(/app\.js\?v=(\d+)/);
    return m ? m[1] : '0';
  } catch { return '0'; }
})();

const log = (t) => console.log(t);

/* ------------------------------------------------------------------ database */

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS admins (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  pass_salt TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  admin_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  nav INTEGER NOT NULL DEFAULT 1,
  forside INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  widget INTEGER NOT NULL DEFAULT 1,
  data TEXT NOT NULL DEFAULT '{}',
  html TEXT,
  source_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pages_sort ON pages(sort);
`);

const q = {
  getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
  setSetting: db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
  delSetting: db.prepare('DELETE FROM settings WHERE key = ?'),
  allSettings: db.prepare('SELECT key, value FROM settings'),
  adminByName: db.prepare('SELECT * FROM admins WHERE lower(username) = lower(?)'),
  adminById: db.prepare('SELECT * FROM admins WHERE id = ?'),
  adminCount: db.prepare('SELECT COUNT(*) AS n FROM admins'),
  insertAdmin: db.prepare('INSERT INTO admins(id, username, pass_salt, pass_hash, created_at) VALUES(?, ?, ?, ?, ?)'),
  updateAdminPass: db.prepare('UPDATE admins SET pass_salt = ?, pass_hash = ? WHERE id = ?'),
  insertSession: db.prepare('INSERT INTO sessions(token, kind, admin_id, created_at, expires_at) VALUES(?, ?, ?, ?, ?)'),
  sessionByToken: db.prepare('SELECT * FROM sessions WHERE token = ?'),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
  deleteSessionsOfKind: db.prepare('DELETE FROM sessions WHERE kind = ?'),
  sweepSessions: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
  allPages: db.prepare('SELECT * FROM pages ORDER BY sort, title'),
  pageBySlug: db.prepare('SELECT * FROM pages WHERE slug = ?'),
  pageById: db.prepare('SELECT * FROM pages WHERE id = ?'),
  frontPage: db.prepare('SELECT * FROM pages WHERE forside = 1 LIMIT 1'),
  insertPage: db.prepare(`INSERT INTO pages(id, slug, title, type, nav, forside, sort, widget, data, html, source_url, created_at, updated_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  updatePage: db.prepare(`UPDATE pages SET slug = ?, title = ?, type = ?, nav = ?, forside = ?, sort = ?, widget = ?,
    data = ?, html = ?, source_url = ?, updated_at = ? WHERE id = ?`),
  deletePage: db.prepare('DELETE FROM pages WHERE id = ?'),
  clearFront: db.prepare('UPDATE pages SET forside = 0 WHERE id <> ?'),
};

const nuIso = () => new Date().toISOString();
const indstilling = (navn, dflt = '') => { const r = q.getSetting.get(navn); return r ? r.value : dflt; };
const saetIndstilling = (navn, vaerdi) => q.setSetting.run(navn, String(vaerdi));

/* ----------------------------------------------------------- indstillinger */

/* Hvidlisten er den eneste liste over, hvad admin maa skrive. En ny
 * indstilling skal staa HER - ellers er den ikke en indstilling, den er en
 * skrivefejl, der bliver gemt. */
const INDSTILLINGER = {
  site_navn: { maks: 80, dflt: 'Demo Erhverv' },
  site_undertitel: { maks: 200, dflt: '' },
  site_baand: { maks: 160, dflt: '' },
  site_sprog: { maks: 8, dflt: 'da' },
  site_cta_tekst: { maks: 40, dflt: '' },
  site_cta_link: { maks: 300, dflt: '' },
  site_fodtekst: { maks: 400, dflt: '' },
  site_copyright: { maks: 200, dflt: '' },
  site_ekstra_head: { maks: 20000, dflt: '', raa: true },
  site_ekstra_body: { maks: 20000, dflt: '', raa: true },
  brand_farve: { maks: 9, dflt: '#0000bf' },
  brand_farve_moerk: { maks: 9, dflt: '#000080' },
  brand_tekst: { maks: 9, dflt: '#ffffff' },
  logo: { maks: 900000, dflt: '' },
  genesys_env: { maks: 40, dflt: 'prod-euc1' },
  genesys_domaene: { maks: 60, dflt: 'mypurecloud.de' },
  genesys_deployment_id: { maks: 60, dflt: '' },
  genesys_widget: { maks: 1, dflt: '1' },
  genesys_client_id: { maks: 80, dflt: '' },
  genesys_client_secret: { maks: 200, dflt: '', hemmelig: true },
  genesys_kb_id: { maks: 60, dflt: '' },
  kb_cache_min: { maks: 4, dflt: '5' },
  kb_antal: { maks: 4, dflt: '20' },
  gate_enabled: { maks: 1, dflt: '0' },
  gate_salt: { maks: 64, dflt: '', hemmelig: true },
  gate_hash: { maks: 200, dflt: '', hemmelig: true },
  gate_aaben_til: { maks: 20, dflt: '0' },
  gate_besked: { maks: 300, dflt: 'Siden er lukket lige nu. Skriv kodeordet for at komme ind.' },
  logo_ver: { maks: 20, dflt: '0' },
};

/** Alle indstillinger med deres standardvaerdier udfyldt. */
function alleIndstillinger() {
  const ud = {};
  for (const [navn, def] of Object.entries(INDSTILLINGER)) ud[navn] = indstilling(navn, def.dflt);
  return ud;
}

/**
 * Det, admin-fladen faar at se.
 *
 * Hemmeligheder returneres ALDRIG (RUNE-ERFARINGER §6b) - kun et flag om, at
 * de er sat. Ellers kan en gemt kodeord-hash og en OAuth-hemmelighed laeses ud
 * af den browser, der tilfaeldigvis staar aaben paa admin-siden.
 */
function indstillingerTilAdmin() {
  const alle = alleIndstillinger();
  const ud = {};
  for (const [navn, def] of Object.entries(INDSTILLINGER)) {
    if (def.hemmelig) continue;
    ud[navn] = alle[navn];
  }
  ud.genesys_secret_sat = Boolean(alle.genesys_client_secret);
  ud.gate_kodeord_sat = Boolean(alle.gate_hash);
  return ud;
}

/* ----------------------------------------------------------------- foerste start */

/**
 * Saa siderne, foerste gang appen starter.
 *
 * Teksten er skrevet til formaalet: en demo skal kunne begynde uden at nogen
 * foerst skal opfinde indhold. Alt kan rettes i admin, og »Importér side« kan
 * laegge en rigtig kundeside ved siden af.
 */
function saaFoerstegang() {
  if (q.allPages.all().length) return;
  const nu = nuIso();
  const navn = (process.env.SITE_NAME || 'Demo Erhverv').slice(0, 80);
  saetIndstilling('site_navn', navn);
  saetIndstilling('site_baand', 'Demomiljø – ikke et rigtigt kundesite');
  saetIndstilling('site_fodtekst', 'Et demo-site til Genesys Cloud: web messaging, bots og vidensbase.');
  saetIndstilling('site_copyright', `© ${new Date().getFullYear()} ${navn}`);
  saetIndstilling('site_cta_tekst', 'Log ind');
  saetIndstilling('site_cta_link', '#');
  if (process.env.GENESYS_ENV) saetIndstilling('genesys_env', process.env.GENESYS_ENV);
  if (process.env.GENESYS_ENV) {
    const r = genesysModul.region(process.env.GENESYS_ENV);
    saetIndstilling('genesys_domaene', r.domaene);
  }
  if (process.env.GENESYS_DEPLOYMENT_ID) saetIndstilling('genesys_deployment_id', process.env.GENESYS_DEPLOYMENT_ID);

  const nyeSider = [
    {
      slug: 'forside', title: 'Forside', type: 'forside', nav: 1, forside: 1, sort: 0,
      data: {
        hero: {
          overrubrik: 'Konfiguration og udførelse af Genesys-demonstrationer',
          titel: 'Genesys Demo',
          tekst: 'Et website til at vise web messaging, bots, co-browse og vidensbase frem – med rigtige knapper at trykke på.',
          knapTekst: 'Læs mere', knapLink: '/produkter',
        },
        sektioner: [{
          titel: 'Det kan I se her', kolonner: 3, kort: [
            { overrubrik: 'Chat', titel: 'Web messaging', tekst: 'Messenger-widget’en ligger på alle sider og kan åbnes fra knapper i indholdet.', link: '/kontakt', linkTekst: 'Prøv chatten' },
            { overrubrik: 'Selvbetjening', titel: 'Vidensbase', tekst: 'Artiklerne hentes live fra en vidensbase i Genesys Cloud – samme indhold som botten svarer ud fra.', link: '/hjaelp', linkTekst: 'Åbn hjælpen' },
            { overrubrik: 'Kontakt', titel: 'Flere kanaler', tekst: 'Telefon, formular og chat side om side, så overgangen mellem kanaler kan vises.', link: '/kontakt', linkTekst: 'Se kontaktsiden' },
          ],
        }],
      },
    },
    {
      slug: 'produkter', title: 'Løsninger', type: 'indhold', nav: 1, sort: 1,
      data: {
        intro: 'Siden findes for at have noget at navigere rundt i under en demo. Ret teksten i admin, så den passer til kunden.',
        sektioner: [{
          titel: 'Udvalgte løsninger', kolonner: 3, toner: true, kort: [
            { titel: 'Kontaktcenter', tekst: 'Kanaler, køer og routing samlet ét sted.' },
            { titel: 'Selvbetjening', tekst: 'Bots og vidensbase, der svarer før mennesket skal ind over.' },
            { titel: 'Analyse', tekst: 'Dashboards på tværs af kanaler og kunderejser.' },
          ],
        }],
      },
    },
    {
      slug: 'hjaelp', title: 'Hjælp', type: 'vidensbase', nav: 1, sort: 2,
      data: { intro: 'Søg i vores artikler – indholdet kommer direkte fra vidensbasen i Genesys Cloud.', soegetekst: 'Søg i vores hjælp …' },
    },
    {
      slug: 'kontakt', title: 'Kontakt', type: 'kontakt', nav: 1, sort: 3,
      data: {
        intro: 'Skriv, ring eller tag fat i chatten.',
        telefon: '+45 00 00 00 00', email: 'demo@example.com',
        adresse: 'Demovej 1, 2450 København SV', aabningstid: 'Man-fre 8-16',
      },
    },
  ];
  for (const s of nyeSider) {
    q.insertPage.run(nyId(), s.slug, s.title, s.type, s.nav, s.forside || 0, s.sort, 1,
      JSON.stringify(s.data || {}), null, null, nu, nu);
  }
  log(`[start] ${nyeSider.length} sider oprettet`);
}

function nyId() { return crypto.randomBytes(9).toString('hex'); }

/* ------------------------------------------------------------------- genesys */

const genesys = genesysModul.opret({ indstilling, log });

/* ------------------------------------------------------------------ login m.m. */

function hashKodeord(kodeord, salt) {
  return crypto.scryptSync(kodeord, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
}
function sammenlign(a, b) {
  const x = Buffer.from(String(a), 'hex');
  const y = Buffer.from(String(b), 'hex');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function laesCookies(req) {
  const ud = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) ud[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  });
  return ud;
}
function sikkerForbindelse(req) {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return proto ? proto === 'https' : Boolean(req.socket.encrypted);
}
function saetSession(res, req, kind, adminId, dage) {
  const token = crypto.randomBytes(32).toString('hex');
  q.insertSession.run(token, kind, adminId, nuIso(), new Date(Date.now() + dage * 864e5).toISOString());
  const navn = kind === 'admin' ? 'gds_admin' : 'gds_site';
  res.setHeader('Set-Cookie', [`${navn}=${token}`, 'HttpOnly', 'Path=/', 'SameSite=Lax',
    `Max-Age=${dage * 86400}`].concat(sikkerForbindelse(req) ? ['Secure'] : []).join('; '));
  return token;
}
function sessionFra(req, kind) {
  const token = laesCookies(req)[kind === 'admin' ? 'gds_admin' : 'gds_site'];
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const s = q.sessionByToken.get(token);
  if (!s || s.kind !== kind) return null;
  if (s.expires_at < nuIso()) { q.deleteSession.run(token); return null; }
  return s;
}
function nuvaerendeAdmin(req) {
  const s = sessionFra(req, 'admin');
  if (!s) return null;
  const a = q.adminById.get(s.admin_id);
  if (!a) { q.deleteSession.run(s.token); return null; }
  a._token = s.token;
  return a;
}

/* Rate-limit paa BEGGE kodeord. Uden den kan et fire-cifret demo-kodeord
 * proeves igennem paa et minut. */
const forsoeg = new Map();
function spaerret(noegle) {
  const nu = Date.now();
  const liste = (forsoeg.get(noegle) || []).filter((t) => nu - t < 15 * 60e3);
  forsoeg.set(noegle, liste);
  return liste.length >= 15;
}
function notérForsoeg(noegle) {
  const liste = forsoeg.get(noegle) || [];
  liste.push(Date.now());
  forsoeg.set(noegle, liste);
}
/* Loft over vidensbase-soegningen. Laasen er ikke en ratebegraensning: under en
 * demo staar sitet aabent, og saa er /api/kb/soeg en ulogget vej ind i
 * organisationens Genesys Knowledge-API - og soegningen caches med vilje ikke.
 * 30 pr. minut pr. IP er langt over, hvad én ivrig demonstrant taster, men
 * stopper en loekke. Egen tavle, saa soegninger aldrig spaerrer et login. */
const KB_SOEG_LOFT = 30;
const KB_SOEG_VINDUE = 60e3;
const soegninger = new Map();
function soegningOverLoft(noegle) {
  const nu = Date.now();
  const liste = (soegninger.get(noegle) || []).filter((t) => nu - t < KB_SOEG_VINDUE);
  if (liste.length >= KB_SOEG_LOFT) { soegninger.set(noegle, liste); return true; }
  liste.push(nu);
  soegninger.set(noegle, liste);
  return false;
}
/* Tavlen ryddes jaevnligt, ellers vokser den med hver IP, der nogensinde har soegt. */
setInterval(() => {
  const nu = Date.now();
  for (const [k, liste] of soegninger) {
    if (!liste.some((t) => nu - t < KB_SOEG_VINDUE)) soegninger.delete(k);
  }
}, 5 * 60e3).unref();
/* Aldrig den foerste vaerdi i X-Forwarded-For: den vaelger klienten selv, og
 * saa kunne baade loftet og login-spaerringen omgaas (app/klientip.js). */
function ip(req) {
  return klientIp(req);
}

/* --------------------------------------------------------------------- laasen */

/**
 * Er sitet aabent lige nu?
 *
 * Tre tilstande, ikke to: slukket laas, taendt laas, og taendt laas med et
 * aabent tidsvindue. Vinduet er et TIDSPUNKT og ikke en timer - saa overlever
 * det en genstart af containeren, og ingen demo begynder med en kodeordsboks,
 * fordi panelet opdaterede natten foer.
 */
function laaseStatus() {
  const taendt = indstilling('gate_enabled', '0') === '1';
  const til = Number(indstilling('gate_aaben_til', '0')) || 0;
  const aabentVindue = til > Date.now();
  return {
    taendt,
    aabentVindue,
    aabenTil: aabentVindue ? til : 0,
    laast: taendt && !aabentVindue && Boolean(indstilling('gate_hash')),
    kodeordSat: Boolean(indstilling('gate_hash')),
  };
}

function laasOk(req) {
  if (!laaseStatus().laast) return true;
  return Boolean(sessionFra(req, 'site'));
}

/* -------------------------------------------------------------- http-hjaelpere */

function sendJson(res, kode, obj) {
  const krop = JSON.stringify(obj);
  res.writeHead(kode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(krop);
}
const fejl = (res, kode, besked) => sendJson(res, kode, { error: besked });

function sendHtml(res, kode, html) {
  res.writeHead(kode, {
    'Content-Type': 'text/html; charset=utf-8',
    /* HTML caches aldrig: Cloudflare cacher .js/.css i timevis, og det er
     * netop derfor versionen skal kunne skiftes i en frisk HTML (§5). */
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(html);
}

function laesKrop(req, maks = 6e6) {
  return new Promise((ok, nej) => {
    let n = 0;
    const dele = [];
    req.on('data', (c) => {
      n += c.length;
      if (n > maks) { nej(new Error('For stor forespørgsel')); req.destroy(); return; }
      dele.push(c);
    });
    req.on('end', () => ok(Buffer.concat(dele).toString('utf8')));
    req.on('error', nej);
  });
}
async function laesJson(req, maks) {
  const t = await laesKrop(req, maks);
  if (!t) return {};
  try { return JSON.parse(t); } catch { throw new Error('Ugyldig JSON'); }
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2',
};
function sendStatisk(res, rel) {
  const fuld = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!fuld.startsWith(PUBLIC_DIR)) return fejl(res, 404, 'Ikke fundet');
  fs.readFile(fuld, (e, data) => {
    if (e) return fejl(res, 404, 'Ikke fundet');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(fuld)] || 'application/octet-stream',
      'Cache-Control': path.extname(fuld) === '.html' ? 'no-store' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  });
}

/* ------------------------------------------------------------- sider og data */

function sideRaekke(r) {
  let data = {};
  try { data = JSON.parse(r.data || '{}'); } catch { data = {}; }
  return {
    id: r.id, slug: r.slug, title: r.title, type: r.type,
    nav: !!r.nav, forside: !!r.forside, sort: r.sort, widget: !!r.widget,
    data, html: r.html, source_url: r.source_url,
    created_at: r.created_at, updated_at: r.updated_at,
  };
}

function alleSider() { return q.allPages.all().map(sideRaekke); }

/** Konteksten, alle skabelonerne tegner ud fra. */
function sideKontekst(req, side) {
  const indst = alleIndstillinger();
  return {
    indst,
    sider: alleSider(),
    sti: new URL(req.url, 'http://x').pathname,
    version: APP_VERSION,
    logoVer: indstilling('logo_ver', '0'),
    widget: (side ? side.widget : true) ? sider.widgetSnippet(indst) : '',
  };
}

/* Slugs, der ville stjæle en rigtig adresse. En side, der hedder »admin«,
 * ville goere admin uopnaaelig - og fejlen ville se ud som om admin var vaek. */
const FORBUDTE_SLUGS = new Set(['admin', 'api', 'laas', 'logo.png', 'site.css', 'site.js',
  'app.js', 'style.css', 'index.html', 'favicon.ico', 'icon-192.png', 'icon-512.png',
  'artikel', 'kategori', 'robots.txt']);

/* --------------------------------------------------------------- vidensbasen */

/** Det, vidensbase-siden skal bruge for at kunne tegnes. */
async function kbTilSide(side) {
  const ud = { kategorier: [], artikler: [], foraeldet: false, fejl: null };
  if (!genesys.konfigureret() || !indstilling('genesys_kb_id')) {
    ud.fejl = 'Genesys er ikke sat op endnu (admin → Genesys).';
    return ud;
  }
  const antal = Math.min(100, Math.max(1, Number(indstilling('kb_antal', '20')) || 20));
  try {
    const [kat, dok] = await Promise.all([
      genesys.kategorier().catch(() => ({ vaerdi: [], foraeldet: false })),
      genesys.dokumenter({ antal }),
    ]);
    ud.kategorier = kat.vaerdi || [];
    ud.artikler = dok.vaerdi || [];
    ud.foraeldet = Boolean(kat.foraeldet || dok.foraeldet);
  } catch (e) {
    ud.fejl = e.message;
  }
  return ud;
}

/* ------------------------------------------------------------------- ruteren */

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = decodeURIComponent(u.pathname);
  try {
    if (p.startsWith('/api/admin')) return await adminApi(req, res, u, p);
    if (p.startsWith('/api/kb')) return await kbApi(req, res, u, p);
    if (p === '/admin' || p.startsWith('/admin/')) return sendStatisk(res, 'index.html');
    return await siteRute(req, res, u, p);
  } catch (e) {
    log(`[fejl] ${req.method} ${p}: ${e.stack || e.message}`);
    if (!res.headersSent) {
      if (p.startsWith('/api/')) return fejl(res, 500, e.message);
      return sendHtml(res, 500, sider.tegnFejl(sideKontekst(req, null), 500, e.message));
    }
    res.end();
  }
});

/* ------------------------------------------------------------------ demo-sitet */

async function siteRute(req, res, u, p) {
  /* Statiske filer og laasesiden ligger FOER laasen: uden css kan laasesiden
   * ikke tegne sig selv. */
  if (p === '/site.css' || p === '/site.js') return sendStatisk(res, p.slice(1));
  if (p === '/app.js' || p === '/style.css' || p === '/icon-192.png' || p === '/icon-512.png') return sendStatisk(res, p.slice(1));
  if (p === '/favicon.ico') return sendStatisk(res, 'icon-192.png');
  if (p === '/robots.txt') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('User-agent: *\nDisallow: /\n');
  }
  if (p === '/logo.png') return sendLogo(req, res);

  if (p === '/laas') {
    if (req.method === 'POST') return await laasLogin(req, res);
    return sendHtml(res, 200, sider.tegnLaas(sideKontekst(req, null), { naeste: u.searchParams.get('naeste') || '/' }));
  }

  if (!laasOk(req)) {
    /* 200 og ikke 401: laasesiden ER svaret paa forespoergslen, ikke en
     * http-udfordring. Med 401 skriver browseren en fejl i konsollen, og
     * overvaagning og proxyer taeller et lukket demo-site som nedbrud. Den
     * rigtige 401 er den paa /api/kb - dér er der ingen side at vise. */
    return sendHtml(res, 200, sider.tegnLaas(sideKontekst(req, null), { naeste: p + (u.search || '') }));
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return fejl(res, 405, 'Metoden er ikke tilladt');

  /* Find siden. Forsiden er den, der er markeret som forside; alt andet slaas
   * op paa sin slug. Er stien laengere, hoerer resten til sidens egne
   * undersider (artikel/kategori i en vidensbase). */
  const dele = p.split('/').filter(Boolean);
  let raekke = null;
  let rest = [];
  if (!dele.length) {
    raekke = q.frontPage.get() || q.allPages.all()[0];
  } else {
    raekke = q.pageBySlug.get(dele[0]);
    rest = dele.slice(1);
    if (!raekke) {
      /* Undersider under forsiden: /artikel/<id>/… naar forsiden ER vidensbasen. */
      const forside = q.frontPage.get();
      if (forside && (dele[0] === 'artikel' || dele[0] === 'kategori')) { raekke = forside; rest = dele; }
    }
  }
  if (!raekke) return sendHtml(res, 404, sider.tegnFejl(sideKontekst(req, null), 404, `Der er ingen side på /${dele.join('/')}`));

  const side = sideRaekke(raekke);
  const ctx = sideKontekst(req, side);

  if (side.type === 'vidensbase' && rest.length) return await vidensbaseUnderside(res, side, ctx, rest);
  if (rest.length) return sendHtml(res, 404, sider.tegnFejl(ctx, 404, 'Siden findes ikke.'));

  if (side.type === 'vidensbase') ctx.kb = await kbTilSide(side);
  const tegn = (sider.TYPER[side.type] || sider.TYPER.indhold).tegn;
  return sendHtml(res, 200, tegn(side, ctx));
}

async function vidensbaseUnderside(res, side, ctx, rest) {
  const [hvad, id] = rest;
  if (hvad === 'artikel' && id) {
    try {
      const svar = await genesys.dokument(id);
      ctx.kb = { foraeldet: svar.foraeldet };
      return sendHtml(res, 200, sider.tegnArtikel(side, ctx, svar.vaerdi));
    } catch (e) {
      return sendHtml(res, 404, sider.tegnFejl(ctx, 404, `Artiklen kunne ikke hentes: ${e.message}`));
    }
  }
  if (hvad === 'kategori' && id) {
    try {
      const [kat, dok] = await Promise.all([
        genesys.kategorier(),
        genesys.dokumenter({ kategoriId: id, antal: 100 }),
      ]);
      const kategori = (kat.vaerdi || []).find((k) => k.id === id) || { navn: 'Kategori', beskrivelse: '' };
      return sendHtml(res, 200, sider.tegnKategori(side, ctx, kategori, dok.vaerdi || []));
    } catch (e) {
      return sendHtml(res, 404, sider.tegnFejl(ctx, 404, `Kategorien kunne ikke hentes: ${e.message}`));
    }
  }
  return sendHtml(res, 404, sider.tegnFejl(ctx, 404, 'Siden findes ikke.'));
}

function sendLogo(req, res) {
  const data = indstilling('logo', '');
  const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(data);
  if (!m) return fejl(res, 404, 'Intet logo');
  const buf = Buffer.from(m[2], 'base64');
  const etag = `"${crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16)}"`;
  if (req.headers['if-none-match'] === etag) { res.writeHead(304); return res.end(); }
  res.writeHead(200, {
    'Content-Type': m[1],
    ETag: etag,
    /* Adressen baerer ?v=<logo_ver>, som skiftes naar logoet skiftes - derfor
     * maa svaret gerne caches haardt (§4-moenstret fra Kokkeri). */
    'Cache-Control': 'public, max-age=604800, immutable',
  });
  res.end(buf);
}

async function laasLogin(req, res) {
  const krop = await laesKrop(req, 20000);
  const felter = new URLSearchParams(krop);
  const naeste = felter.get('naeste') || '/';
  /* Kun stier paa sitet selv - ellers er laasesiden en aaben viderestilling. */
  const tryg = /^\/[^/\\]/.test(naeste) && !naeste.startsWith('/api') ? naeste : '/';
  const noegle = `laas:${ip(req)}`;
  const ctx = sideKontekst(req, null);
  if (spaerret(noegle)) {
    log(`[sikkerhed] laas-spaerret ip=${ip(req)}`);
    return sendHtml(res, 429, sider.tegnLaas(ctx, { fejl: 'For mange forsøg. Prøv igen om et kvarter.', naeste: tryg }));
  }
  const salt = indstilling('gate_salt');
  const hash = indstilling('gate_hash');
  const givet = String(felter.get('kodeord') || '');
  if (!salt || !hash || !sammenlign(hashKodeord(givet, salt), hash)) {
    notérForsoeg(noegle);
    log(`[sikkerhed] laas-fejl ip=${ip(req)}`);
    return sendHtml(res, 401, sider.tegnLaas(ctx, { fejl: 'Forkert kodeord.', naeste: tryg }));
  }
  saetSession(res, req, 'site', null, SITE_SESSION_DAGE);
  res.writeHead(303, { Location: tryg });
  res.end();
}

/* ----------------------------------------------------------- vidensbase-api */

/** Sitets eget kb-api. Bag laasen - ellers kan vidensbasen laeses ud af et
 *  lukket site uden kodeord. */
async function kbApi(req, res, u, p) {
  if (!laasOk(req)) return fejl(res, 401, 'Siden er låst');
  if (req.method !== 'GET') return fejl(res, 405, 'Metoden er ikke tilladt');
  if (p === '/api/kb/soeg') {
    if (soegningOverLoft(`kbsoeg:${ip(req)}`)) {
      log(`[sikkerhed] kb-soeg-loft ip=${ip(req)}`);
      res.setHeader('Retry-After', '60');
      return fejl(res, 429, 'For mange søgninger på kort tid. Vent et minut, og prøv igen.');
    }
    const tekst = u.searchParams.get('q') || '';
    try {
      const svar = await genesys.soeg(tekst, { antal: 10 });
      return sendJson(res, 200, {
        total: svar.total,
        traef: svar.traef.map((t) => Object.assign({ slug: sider.slugify(t.titel) }, t)),
      });
    } catch (e) {
      return fejl(res, 502, e.message);
    }
  }
  return fejl(res, 404, 'Ukendt endepunkt');
}

/* ------------------------------------------------------------------ admin-api */

async function adminApi(req, res, u, p) {
  const sti = p.slice('/api/admin'.length) || '/';

  /* POST/PATCH/DELETE skal have JSON-content-type: en CSRF-barriere oven paa
   * SameSite=Lax, saa en fremmed side ikke kan sende en formular hertil. */
  if (req.method !== 'GET' && String(req.headers['content-type'] || '').indexOf('application/json') === -1) {
    return fejl(res, 415, 'Content-Type skal være application/json');
  }

  if (sti === '/status' && req.method === 'GET') {
    return sendJson(res, 200, {
      opsat: q.adminCount.get().n > 0,
      loggetInd: Boolean(nuvaerendeAdmin(req)),
      version: APP_VERSION,
      appNavn: APP_NAME,
    });
  }

  if (sti === '/setup' && req.method === 'POST') {
    if (q.adminCount.get().n > 0) return fejl(res, 409, 'Admin findes allerede');
    const krop = await laesJson(req);
    const navn = String(krop.brugernavn || '').trim();
    const kode = String(krop.kodeord || '');
    if (!/^[a-zA-Z0-9._-]{2,32}$/.test(navn)) return fejl(res, 400, 'Brugernavnet må være 2-32 tegn: bogstaver, tal, . _ -');
    if (kode.length < 8) return fejl(res, 400, 'Kodeordet skal være mindst 8 tegn');
    const salt = crypto.randomBytes(16).toString('hex');
    q.insertAdmin.run(nyId(), navn, salt, hashKodeord(kode, salt), nuIso());
    const a = q.adminByName.get(navn);
    saetSession(res, req, 'admin', a.id, SESSION_DAGE);
    log(`[start] admin »${navn}« oprettet`);
    return sendJson(res, 200, { ok: true });
  }

  if (sti === '/login' && req.method === 'POST') {
    const krop = await laesJson(req);
    const noegle = `admin:${ip(req)}`;
    if (spaerret(noegle)) { log(`[sikkerhed] login-spaerret ip=${ip(req)}`); return fejl(res, 429, 'For mange forsøg. Prøv igen om et kvarter.'); }
    const a = q.adminByName.get(String(krop.brugernavn || ''));
    if (!a || !sammenlign(hashKodeord(String(krop.kodeord || ''), a.pass_salt), a.pass_hash)) {
      notérForsoeg(noegle);
      log(`[sikkerhed] login-fejl ip=${ip(req)}`);
      return fejl(res, 401, 'Forkert brugernavn eller kodeord');
    }
    saetSession(res, req, 'admin', a.id, SESSION_DAGE);
    return sendJson(res, 200, { ok: true });
  }

  if (sti === '/logout' && req.method === 'POST') {
    const a = nuvaerendeAdmin(req);
    if (a) q.deleteSession.run(a._token);
    res.setHeader('Set-Cookie', 'gds_admin=; Path=/; Max-Age=0');
    return sendJson(res, 200, { ok: true });
  }

  const admin = nuvaerendeAdmin(req);
  if (!admin) return fejl(res, 401, 'Log ind først');

  /* ---- opsætning ---- */
  if (sti === '/data' && req.method === 'GET') {
    return sendJson(res, 200, {
      admin: { brugernavn: admin.username },
      indstillinger: indstillingerTilAdmin(),
      sider: alleSider().map((s) => Object.assign({}, s, { html: s.html ? `${s.html.length} tegn` : null })),
      sidetyper: Object.entries(sider.TYPER).map(([id, t]) => ({ id, navn: t.navn })),
      regioner: genesys.REGIONER,
      genesys: genesys.status(),
      laas: laaseStatus(),
      version: APP_VERSION,
    });
  }

  if (sti === '/indstillinger' && req.method === 'PATCH') {
    const krop = await laesJson(req, 2e6);
    const skrevet = [];
    for (const [navn, vaerdi] of Object.entries(krop)) {
      const def = INDSTILLINGER[navn];
      if (!def) return fejl(res, 400, `Ukendt indstilling: ${navn}`);
      if (def.hemmelig && navn !== 'genesys_client_secret') return fejl(res, 400, `${navn} sættes ikke her`);
      const s = String(vaerdi == null ? '' : vaerdi);
      if (s.length > def.maks) return fejl(res, 400, `${navn} er for lang (maks ${def.maks} tegn)`);
      if (navn === 'genesys_client_secret' && !s) continue; /* tom = »lad staa« */
      saetIndstilling(navn, s);
      skrevet.push(navn);
    }
    /* Regionen bestemmer domaenet - de to maa ikke kunne skride fra hinanden. */
    if (skrevet.includes('genesys_env')) {
      saetIndstilling('genesys_domaene', genesysModul.region(indstilling('genesys_env')).domaene);
    }
    if (skrevet.includes('logo')) saetIndstilling('logo_ver', String(Date.now()));
    if (skrevet.some((n) => n.startsWith('genesys_') || n === 'kb_cache_min')) genesys.ryd();
    return sendJson(res, 200, { ok: true, indstillinger: indstillingerTilAdmin() });
  }

  /* ---- sider ---- */
  if (sti === '/sider' && req.method === 'POST') {
    const krop = await laesJson(req, 14e6);
    return gemSide(res, null, krop);
  }
  if (sti.startsWith('/sider/')) {
    const id = sti.slice('/sider/'.length);
    const raekke = q.pageById.get(id);
    if (!raekke) return fejl(res, 404, 'Siden findes ikke');
    if (req.method === 'GET') return sendJson(res, 200, sideRaekke(raekke));
    if (req.method === 'PATCH') return gemSide(res, raekke, await laesJson(req, 14e6));
    if (req.method === 'DELETE') {
      if (raekke.forside) return fejl(res, 400, 'Forsiden kan ikke slettes. Gør en anden side til forside først.');
      q.deletePage.run(id);
      return sendJson(res, 200, { ok: true });
    }
  }

  /* ---- import ---- */
  if (sti === '/import' && req.method === 'POST') {
    const krop = await laesJson(req, 14e6);
    let html = String(krop.html || '');
    let kilde = String(krop.url || '').trim();
    if (!html && kilde) {
      const hentet = await hentIndUdefra.hentSide(kilde);
      html = hentet.html;
      kilde = hentet.url;
    }
    if (!html) return fejl(res, 400, 'Hverken adresse eller HTML');
    if (kilde) html = hentIndUdefra.absolutiser(html, kilde);
    html = hentIndUdefra.fjernGenesys(html);
    const titel = (html.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i) || [, 'Importeret side'])[1].trim() || 'Importeret side';
    return gemSide(res, krop.id ? q.pageById.get(krop.id) : null, {
      id: krop.id,
      slug: krop.slug || sider.slugify(titel) || `import-${Date.now()}`,
      title: krop.title || titel,
      type: 'html',
      nav: krop.nav !== undefined ? krop.nav : false,
      widget: krop.widget !== undefined ? krop.widget : true,
      html,
      source_url: kilde || null,
    });
  }

  /* ---- genesys ---- */
  if (sti === '/genesys/test' && req.method === 'POST') {
    try {
      await genesys.hentToken(true);
      const liste = await genesys.videnbaser();
      return sendJson(res, 200, { ok: true, videnbaser: liste, status: genesys.status() });
    } catch (e) {
      return sendJson(res, 200, { ok: false, error: e.message, status: genesys.status() });
    }
  }
  if (sti === '/genesys/ryd' && req.method === 'POST') { genesys.ryd(); return sendJson(res, 200, { ok: true }); }

  /* ---- laasen ---- */
  if (sti === '/laas' && req.method === 'PATCH') {
    const krop = await laesJson(req);
    if (krop.kodeord !== undefined && krop.kodeord !== '') {
      const kode = String(krop.kodeord);
      if (kode.length < 4) return fejl(res, 400, 'Kodeordet skal være mindst 4 tegn');
      const salt = crypto.randomBytes(16).toString('hex');
      saetIndstilling('gate_salt', salt);
      saetIndstilling('gate_hash', hashKodeord(kode, salt));
      /* Et nyt kodeord lukker alle, der er inde paa det gamle. */
      q.deleteSessionsOfKind.run('site');
    }
    if (krop.taendt !== undefined) {
      if (krop.taendt && !indstilling('gate_hash')) return fejl(res, 400, 'Sæt et kodeord først');
      saetIndstilling('gate_enabled', krop.taendt ? '1' : '0');
    }
    if (krop.aabenTimer !== undefined) {
      const t = Number(krop.aabenTimer);
      if (!Number.isFinite(t) || t < 0 || t > 72) return fejl(res, 400, 'Vinduet skal være 0-72 timer');
      saetIndstilling('gate_aaben_til', String(t > 0 ? Date.now() + t * 3600e3 : 0));
    }
    if (krop.besked !== undefined) saetIndstilling('gate_besked', String(krop.besked).slice(0, 300));
    if (krop.lukSessioner) q.deleteSessionsOfKind.run('site');
    return sendJson(res, 200, { ok: true, laas: laaseStatus() });
  }

  /* ---- konto ---- */
  if (sti === '/kodeord' && req.method === 'POST') {
    const krop = await laesJson(req);
    if (!sammenlign(hashKodeord(String(krop.gammelt || ''), admin.pass_salt), admin.pass_hash)) {
      return fejl(res, 401, 'Det gamle kodeord passer ikke');
    }
    const nyt = String(krop.nyt || '');
    if (nyt.length < 8) return fejl(res, 400, 'Kodeordet skal være mindst 8 tegn');
    const salt = crypto.randomBytes(16).toString('hex');
    q.updateAdminPass.run(salt, hashKodeord(nyt, salt), admin.id);
    return sendJson(res, 200, { ok: true });
  }

  /* ---- eksport og import af hele opsaetningen ---- */
  if (sti === '/eksport' && req.method === 'GET') {
    const ud = { version: APP_VERSION, tid: nuIso(), indstillinger: {}, sider: alleSider() };
    for (const [navn, def] of Object.entries(INDSTILLINGER)) {
      if (def.hemmelig) continue;   /* hemmeligheder foelger ALDRIG med en eksport */
      ud.indstillinger[navn] = indstilling(navn, def.dflt);
    }
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="demosite-${new Date().toISOString().slice(0, 10)}.json"`,
      'Cache-Control': 'no-store',
    });
    return res.end(JSON.stringify(ud, null, 2));
  }
  if (sti === '/import-opsaetning' && req.method === 'POST') {
    const krop = await laesJson(req, 30e6);
    if (!krop || typeof krop !== 'object') return fejl(res, 400, 'Ugyldig fil');
    let n = 0;
    for (const [navn, vaerdi] of Object.entries(krop.indstillinger || {})) {
      const def = INDSTILLINGER[navn];
      if (!def || def.hemmelig) continue;
      saetIndstilling(navn, String(vaerdi).slice(0, def.maks));
      n += 1;
    }
    let sideAntal = 0;
    if (Array.isArray(krop.sider) && krop.sider.length) {
      db.exec('DELETE FROM pages');
      for (const s of krop.sider) {
        const nu = nuIso();
        q.insertPage.run(s.id || nyId(), String(s.slug || `side-${sideAntal}`), String(s.title || 'Side'),
          sider.TYPER[s.type] ? s.type : 'indhold', s.nav ? 1 : 0, s.forside ? 1 : 0,
          Number(s.sort) || 0, s.widget === false ? 0 : 1,
          JSON.stringify(s.data || {}), s.html || null, s.source_url || null, nu, nu);
        sideAntal += 1;
      }
    }
    genesys.ryd();
    return sendJson(res, 200, { ok: true, indstillinger: n, sider: sideAntal });
  }

  return fejl(res, 404, 'Ukendt endepunkt');
}

/**
 * Gem en side - ny eller aendret.
 *
 * Slug'en valideres ét sted, fordi den er en adresse: to sider med samme slug,
 * eller en slug der hedder »admin«, er fejl, der foerst viser sig naar nogen
 * klikker.
 */
function gemSide(res, gammel, krop) {
  const type = sider.TYPER[krop.type] ? krop.type : (gammel ? gammel.type : 'indhold');
  const titel = String(krop.title != null ? krop.title : (gammel ? gammel.title : '')).trim().slice(0, 120) || 'Uden titel';
  let slug = sider.slugify(krop.slug != null ? krop.slug : (gammel ? gammel.slug : titel));
  if (!slug) slug = `side-${Date.now().toString(36)}`;
  if (FORBUDTE_SLUGS.has(slug)) return fejl(res, 400, `»${slug}« er reserveret af appen. Vælg en anden adresse.`);
  const optaget = q.pageBySlug.get(slug);
  if (optaget && (!gammel || optaget.id !== gammel.id)) return fejl(res, 400, `Adressen /${slug} er allerede i brug.`);

  const data = krop.data !== undefined ? krop.data : (gammel ? JSON.parse(gammel.data || '{}') : {});
  const dataJson = JSON.stringify(data || {});
  if (dataJson.length > 400000) return fejl(res, 400, 'Sidens indhold er for stort (maks 400 KB)');
  const html = krop.html !== undefined ? (krop.html ? String(krop.html) : null) : (gammel ? gammel.html : null);
  if (html && html.length > 12e6) return fejl(res, 400, 'Den importerede HTML er over 12 MB');

  const nav = krop.nav !== undefined ? (krop.nav ? 1 : 0) : (gammel ? gammel.nav : 1);
  const forside = krop.forside !== undefined ? (krop.forside ? 1 : 0) : (gammel ? gammel.forside : 0);
  const sort = krop.sort !== undefined ? Number(krop.sort) || 0 : (gammel ? gammel.sort : q.allPages.all().length);
  const widget = krop.widget !== undefined ? (krop.widget ? 1 : 0) : (gammel ? gammel.widget : 1);
  const kilde = krop.source_url !== undefined ? (krop.source_url || null) : (gammel ? gammel.source_url : null);
  const nu = nuIso();
  const id = gammel ? gammel.id : nyId();

  if (gammel) q.updatePage.run(slug, titel, type, nav, forside, sort, widget, dataJson, html, kilde, nu, id);
  else q.insertPage.run(id, slug, titel, type, nav, forside, sort, widget, dataJson, html, kilde, nu, nu);

  /* Der er ÉN forside. Saettes en ny, mister den gamle sin markering - ellers
   * ville / vaelge tilfaeldigt mellem to. */
  if (forside) q.clearFront.run(id);
  else if (!q.frontPage.get()) q.updatePage.run(slug, titel, type, nav, 1, sort, widget, dataJson, html, kilde, nu, id);

  return sendJson(res, 200, { ok: true, side: sideRaekke(q.pageById.get(id)) });
}

/* --------------------------------------------------------------------- opstart */

saaFoerstegang();

/* Udloebne sessioner ryddes én gang i doegnet. */
setInterval(() => {
  try { q.sweepSessions.run(nuIso()); } catch (e) { /* oprydning maa ikke vaelte serveren */ }
}, 24 * 3600e3).unref();

server.listen(BIND_PORT, () => {
  log(`${APP_NAME} v${APP_VERSION} lytter på port ${BIND_PORT} (data: ${DATA_DIR})`);
  const l = laaseStatus();
  log(`[start] laas: ${l.laast ? 'låst' : (l.taendt ? 'åbent tidsvindue' : 'slukket')}`);
  log(`[start] genesys: ${genesys.konfigureret() ? `sat op (${indstilling('genesys_env')})` : 'ikke sat op endnu'}`);
});

module.exports = { server, laaseStatus, INDSTILLINGER };
