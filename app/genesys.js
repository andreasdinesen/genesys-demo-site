/*
 * Genesys Cloud-klient: OAuth (client credentials) + Knowledge API.
 *
 * Modulet kender hverken databasen eller http'en. Det faar sine funktioner
 * injiceret gennem `srv` (samme moenster som oauth.js/mcp.js i doda), saa det
 * kan proeves med et opdigtet indstillings-opslag og en falsk hentefunktion.
 *
 * ── De tre regler ────────────────────────────────────────────────────────
 *
 * 1. **Hemmeligheden bliver her.** Klient-id og -hemmelighed laeses fra
 *    indstillingerne og bruges kun til at hente et token. Hverken token eller
 *    hemmelighed maa naa frontenden - serveren proxier alle kald.
 * 2. **Et udloebet token maa ikke vaelte en demo.** Alt hentes gennem cachen,
 *    og fejler kaldet, svarer cachen med det SIDST kendte gode svar og
 *    fortaeller hvor gammelt det er. En demo, der viser artikler fra i gaar,
 *    er bedre end en demo, der viser en fejlmeddelelse foran en kunde.
 * 3. **Fejlstien proeves lige saa noeje som succes-stien** (RUNE-ERFARINGER
 *    §6b). Et doedt endepunkt svarer 404/410; et levende med daarligt token
 *    svarer 401. De to skal kunne kendes fra hinanden i logget.
 */

'use strict';

const https = require('node:https');

/* Regionerne. `env` er det, Web Messaging-snippet'en kalder `environment`;
 * `domaene` bestemmer BAADE apps.<domaene> (snippet'en), api.<domaene>
 * (Platform API) og login.<domaene> (token-endepunktet). De hoerer sammen -
 * derfor staar de ét sted og ikke tre. */
const REGIONER = [
  { env: 'prod', navn: 'US East (Virginia)', domaene: 'mypurecloud.com' },
  { env: 'prod-usw2', navn: 'US West (Oregon)', domaene: 'usw2.pure.cloud' },
  { env: 'prod-cac1', navn: 'Canada (Central)', domaene: 'cac1.pure.cloud' },
  { env: 'prod-sae1', navn: 'South America (Sao Paulo)', domaene: 'sae1.pure.cloud' },
  { env: 'prod-euw1', navn: 'EU West (Irland)', domaene: 'mypurecloud.ie' },
  { env: 'prod-euw2', navn: 'EU West (London)', domaene: 'euw2.pure.cloud' },
  { env: 'prod-euc1', navn: 'EU Central (Frankfurt)', domaene: 'mypurecloud.de' },
  { env: 'prod-euc2', navn: 'EU Central (Zurich)', domaene: 'euc2.pure.cloud' },
  { env: 'prod-apne1', navn: 'Asia Pacific (Tokyo)', domaene: 'mypurecloud.jp' },
  { env: 'prod-apne2', navn: 'Asia Pacific (Seoul)', domaene: 'apne2.pure.cloud' },
  { env: 'prod-apne3', navn: 'Asia Pacific (Osaka)', domaene: 'apne3.pure.cloud' },
  { env: 'prod-aps1', navn: 'Asia Pacific (Mumbai)', domaene: 'aps1.pure.cloud' },
  { env: 'prod-apse2', navn: 'Asia Pacific (Sydney)', domaene: 'mypurecloud.com.au' },
  { env: 'prod-mec1', navn: 'Middle East (UAE)', domaene: 'mec1.pure.cloud' },
];

const REGION_EFTER_ENV = new Map(REGIONER.map((r) => [r.env, r]));

/** Regionen for et environment-navn. Ukendt env falder tilbage paa Frankfurt,
 *  fordi det er den region, demo-org'en ligger i - og en tom vaerdi maa ikke
 *  give et opslag mod `api.undefined`. */
function region(env) {
  return REGION_EFTER_ENV.get(String(env || '').trim()) || REGION_EFTER_ENV.get('prod-euc1');
}

/* Et kald, der haenger, haenger en sideindlaesning. */
const TIMEOUT_MS = 15000;
const MAX_SVAR = 8 * 1024 * 1024;

/**
 * Én https-forespoergsel med JSON ind og JSON ud.
 *
 * Kastes der, baerer fejlen `status` med - kalderen skal kunne skelne 401
 * (token/rettighed) fra 404 (forkert adresse) fra 429 (for mange kald).
 */
function hentJson(url, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((ok, nej) => {
    const u = new URL(url);
    const data = body == null ? null
      : (typeof body === 'string' ? body : JSON.stringify(body));
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      timeout: TIMEOUT_MS,
      headers: Object.assign({
        accept: 'application/json',
        'user-agent': 'genesys-demo-site',
      }, data == null ? {} : { 'content-length': Buffer.byteLength(data) }, headers),
    }, (res) => {
      let tekst = '';
      let bytes = 0;
      res.setEncoding('utf8');
      res.on('data', (d) => {
        bytes += d.length;
        if (bytes > MAX_SVAR) { res.destroy(); nej(Object.assign(new Error('svaret var for stort'), { status: 0 })); return; }
        tekst += d;
      });
      res.on('end', () => {
        let json = null;
        try { json = tekst ? JSON.parse(tekst) : {}; } catch { /* ikke JSON */ }
        if (res.statusCode >= 200 && res.statusCode < 300) return ok(json === null ? {} : json);
        /* Genesys svarer to forskellige steder fra: Platform API'et med
         * {message, code}, og token-endepunktet med OAuth'ens {error,
         * error_description}. Begge dele skal med - »invalid_client« alene
         * siger intet, og »authentication failed« alene siger ikke HVAD der
         * fejlede. Maalt mod de rigtige endepunkter: forkert noegle giver 400
         * invalid_client paa login.<domaene> og 401 bad.credentials paa
         * api.<domaene>. */
        const besked = (json && (json.message
          || (json.error && json.error_description ? `${json.error}: ${json.error_description}` : null)
          || json.error_description || json.error))
          || tekst.slice(0, 200) || 'ingen besked';
        nej(Object.assign(new Error(`${res.statusCode}: ${besked}`), { status: res.statusCode, krop: json }));
      });
      res.on('error', nej);
    });
    req.on('timeout', () => req.destroy(Object.assign(
      new Error(`svarede ikke inden ${TIMEOUT_MS} ms`), { status: 0 })));
    req.on('error', (e) => nej(Object.assign(e, { status: e.status || 0 })));
    if (data != null) req.write(data);
    req.end();
  });
}

/**
 * Opret en klient.
 *
 * `srv.indstilling(navn)` skal svare med den gemte streng (eller ''), og
 * `srv.log(tekst)` skriver i serverloggen. `srv.hent` findes kun for at kunne
 * proeve modulet uden net.
 */
function opret(srv) {
  const indstilling = srv.indstilling;
  const log = srv.log || (() => {});
  const hent = srv.hent || hentJson;
  const nu = srv.nu || (() => Date.now());

  /* Token og svar ligger i memory, ikke i databasen: et access-token er
   * kortlivet og maa ikke kunne laeses ud af en backup. */
  let token = null;          // { vaerdi, udloeber }
  let sidsteFejl = null;     // { tid, besked, status }
  const cache = new Map();   // noegle -> { vaerdi, tid }

  function konfig() {
    const r = region(indstilling('genesys_env'));
    return {
      env: r.env,
      domaene: r.domaene,
      apps: `apps.${r.domaene}`,
      api: `api.${r.domaene}`,
      login: `login.${r.domaene}`,
      klientId: String(indstilling('genesys_client_id') || '').trim(),
      klientHemmelighed: String(indstilling('genesys_client_secret') || ''),
      kbId: String(indstilling('genesys_kb_id') || '').trim(),
    };
  }

  const konfigureret = () => {
    const k = konfig();
    return Boolean(k.klientId && k.klientHemmelighed);
  };

  /** Hent (eller genbrug) et access-token. */
  async function hentToken(tving = false) {
    const k = konfig();
    if (!k.klientId || !k.klientHemmelighed) {
      throw Object.assign(new Error('Genesys er ikke sat op: klient-id og -hemmelighed mangler'), { status: 0 });
    }
    if (!tving && token && token.udloeber > nu() + 60000) return token.vaerdi;
    const basic = Buffer.from(`${k.klientId}:${k.klientHemmelighed}`).toString('base64');
    let svar;
    try {
      svar = await hent(`https://${k.login}/oauth/token`, {
        method: 'POST',
        headers: {
          authorization: `Basic ${basic}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      });
    } catch (e) {
      /* 400 invalid_client betyder noejagtig ét: id eller hemmelighed passer
       * ikke (eller klienten har ikke client credentials som grant type).
       * Det er den fejl, der ellers sender folk ud at lede efter rettigheder. */
      if (e.status === 400) {
        e.message = `${e.message} - tjek client id og secret, og at klienten bruger Client Credentials`;
      }
      sidsteFejl = { tid: new Date().toISOString(), besked: e.message, status: e.status || 0 };
      log(`[fejl] genesys: token kunne ikke hentes i ${k.env}: ${e.message}`);
      throw e;
    }
    if (!svar || !svar.access_token) throw new Error('token-svaret indeholdt intet access_token');
    token = {
      vaerdi: svar.access_token,
      udloeber: nu() + (Number(svar.expires_in) || 3600) * 1000,
    };
    log(`[genesys] token hentet i ${k.env}, udloeber om ${Math.round((token.udloeber - nu()) / 60000)} min`);
    return token.vaerdi;
  }

  /**
   * Kald Platform API'et.
   *
   * Et 401 kan betyde, at tokenet er tilbagekaldt midt i levetiden. Der proeves
   * derfor ÉN gang mere med et friskt token - men kun én, ellers hamrer en
   * forkert rettighed loes paa login-endepunktet.
   */
  async function api(sti, { method = 'GET', body = null, andetForsoeg = false } = {}) {
    const k = konfig();
    const t = await hentToken(andetForsoeg);
    try {
      const svar = await hent(`https://${k.api}${sti}`, {
        method,
        headers: Object.assign(
          { authorization: `Bearer ${t}` },
          body == null ? {} : { 'content-type': 'application/json' },
        ),
        body,
      });
      sidsteFejl = null;
      return svar;
    } catch (e) {
      if (e.status === 401 && !andetForsoeg) {
        log('[genesys] 401 - henter nyt token og proever igen');
        token = null;
        return api(sti, { method, body, andetForsoeg: true });
      }
      sidsteFejl = { tid: new Date().toISOString(), besked: e.message, status: e.status || 0 };
      /* [fejl] taelles af panelets watcher. En manglende opsaetning er ikke en
       * serverfejl - det er en tom formular - saa den skriver ikke [fejl]. */
      if (e.status === 401 || e.status === 403) log(`[fejl] genesys: ${e.message} (tjek rollen paa OAuth-klienten - der kraeves knowledge:readonly)`);
      else log(`[fejl] genesys: ${sti} -> ${e.message}`);
      throw e;
    }
  }

  /**
   * Cache med to lag: frisk inden for `ttlMs`, og ellers det sidst kendte gode
   * svar hvis hentningen fejler (regel 2). `foraeldet` fortaeller kalderen, at
   * svaret er gammelt, saa siden kan sige det hoejt i stedet for at lyve.
   */
  async function cachet(noegle, ttlMs, hentFrisk) {
    const gemt = cache.get(noegle);
    if (gemt && nu() - gemt.tid < ttlMs) return { vaerdi: gemt.vaerdi, foraeldet: false, alder: nu() - gemt.tid };
    try {
      const vaerdi = await hentFrisk();
      cache.set(noegle, { vaerdi, tid: nu() });
      return { vaerdi, foraeldet: false, alder: 0 };
    } catch (e) {
      if (gemt) {
        log(`[genesys] bruger cachet svar for ${noegle} (${Math.round((nu() - gemt.tid) / 1000)} s gammelt): ${e.message}`);
        return { vaerdi: gemt.vaerdi, foraeldet: true, alder: nu() - gemt.tid, fejl: e.message };
      }
      throw e;
    }
  }

  function ryd() { cache.clear(); }

  /* ---------------------------------------------------------- Knowledge API */

  const TTL = () => Math.max(5, Number(indstilling('kb_cache_min') || 5)) * 60000;

  /** Alle vidensbaser i org'en (til dropdown'en i admin). */
  async function videnbaser() {
    const svar = await api('/api/v2/knowledge/knowledgebases?pageSize=100');
    return (svar.entities || []).map((k) => ({
      id: k.id,
      navn: k.name,
      beskrivelse: k.description || '',
      sprog: k.coreLanguage,
      udgivet: !!k.published,
      artikler: (k.articleCount || 0) + (k.faqCount || 0),
    }));
  }

  async function kategorier(kbId) {
    const id = kbId || konfig().kbId;
    if (!id) throw new Error('ingen vidensbase valgt');
    return cachet(`kat:${id}`, TTL(), async () => {
      const svar = await api(`/api/v2/knowledge/knowledgebases/${encodeURIComponent(id)}/categories?pageSize=100`);
      return (svar.entities || []).map((c) => ({
        id: c.id,
        navn: c.name,
        beskrivelse: c.description || '',
        forael: c.parentCategory ? c.parentCategory.id : null,
        antal: c.documentCount || 0,
      }));
    });
  }

  /**
   * Dokumenter, evt. filtreret paa kategori.
   *
   * `state=Published` filtreres i koden og ikke i URL'en: endepunktet tager
   * ikke et state-parameter, kun `includeDrafts`. Uden filteret ville en kladde,
   * nogen sad og skrev paa, kunne staa paa demo-sitet.
   */
  async function dokumenter({ kbId, kategoriId, antal = 50 } = {}) {
    const id = kbId || konfig().kbId;
    if (!id) throw new Error('ingen vidensbase valgt');
    const qs = new URLSearchParams({ pageSize: String(Math.min(200, Math.max(1, antal))) });
    if (kategoriId) qs.set('categoryId', kategoriId);
    return cachet(`dok:${id}:${kategoriId || 'alle'}:${antal}`, TTL(), async () => {
      const svar = await api(`/api/v2/knowledge/knowledgebases/${encodeURIComponent(id)}/documents?${qs}`);
      return (svar.entities || [])
        .filter((d) => d.state !== 'Draft' && d.state !== 'Archived')
        .map(kortDokument);
    });
  }

  async function dokument(docId, kbId) {
    const id = kbId || konfig().kbId;
    if (!id) throw new Error('ingen vidensbase valgt');
    if (!/^[0-9a-fA-F-]{10,60}$/.test(String(docId || ''))) throw new Error('ugyldigt dokument-id');
    return cachet(`et:${id}:${docId}`, TTL(), async () => {
      const d = await api(`/api/v2/knowledge/knowledgebases/${encodeURIComponent(id)}/documents/${encodeURIComponent(docId)}?expand=variations`);
      return heltDokument(d);
    });
  }

  /**
   * Fritekstsoegning.
   *
   * Soegning caches IKKE: den er brugerens egen handling, svaret skal foelge det,
   * der staar i vidensbasen lige nu, og en demo, hvor soegningen svarer paa et
   * gammelt spoergsmaal, ser i stykker ud.
   */
  async function soeg(tekst, { kbId, antal = 10, side = 1 } = {}) {
    const id = kbId || konfig().kbId;
    if (!id) throw new Error('ingen vidensbase valgt');
    const q = String(tekst || '').trim().slice(0, 300);
    if (!q) return { traef: [], total: 0 };
    const svar = await api(`/api/v2/knowledge/knowledgebases/${encodeURIComponent(id)}/documents/search`, {
      method: 'POST',
      body: {
        query: q,
        pageSize: Math.min(50, Math.max(1, antal)),
        pageNumber: Math.max(1, side),
        queryType: 'ManualSearch',
      },
    });
    return {
      total: svar.total || 0,
      traef: (svar.results || []).map((r) => Object.assign(
        kortDokument(r.document || {}),
        { score: typeof r.confidence === 'number' ? r.confidence : null },
      )),
    };
  }

  function status() {
    const k = konfig();
    return {
      konfigureret: konfigureret(),
      env: k.env,
      domaene: k.domaene,
      klientId: k.klientId ? `${k.klientId.slice(0, 8)}…` : '',
      hemmelighedSat: Boolean(k.klientHemmelighed),
      kbId: k.kbId,
      tokenUdloeber: token ? new Date(token.udloeber).toISOString() : null,
      sidsteFejl,
    };
  }

  return {
    REGIONER, region, konfig, konfigureret, hentToken, api, ryd, status,
    videnbaser, kategorier, dokumenter, dokument, soeg,
  };
}

/* --------------------------------------------------------- svar -> vores form */

/** Kortformen: det listen og soegningen viser. Bevidst uden brodtekst. */
function kortDokument(d) {
  return {
    id: d.id,
    titel: d.title || '(uden titel)',
    kategori: d.category ? d.category.name : '',
    kategoriId: d.category ? d.category.id : '',
    maerker: (d.labels || []).map((l) => l.name).filter(Boolean),
    aendret: d.dateModified || d.dateCreated || null,
    resume: resumeAf(d),
  };
}

/** Hele artiklen: kortformen plus den valgte variations blokke. */
function heltDokument(d) {
  return Object.assign(kortDokument(d), {
    variation: vaelgVariation(d),
    alternativer: (d.alternatives || []).map((a) => a.phrase).filter(Boolean),
  });
}

/**
 * Et dokument kan have flere variationer (én pr. kanal/kontekst). Demo-sitet er
 * ét sted og skal vise ÉN: den med hoejest `priority`, ellers den foerste.
 * Uden det valg ville raekkefoelgen afhaenge af, hvad API'et naevner foerst.
 */
function vaelgVariation(d) {
  const liste = (d.variations || []).filter((v) => v && v.body);
  if (!liste.length) return null;
  const sorteret = liste.slice().sort((a, b) => (b.priority || 0) - (a.priority || 0));
  return sorteret[0].body;
}

/** Foerste stykke tekst i artiklen, klippet til et resume. */
function resumeAf(d) {
  const body = vaelgVariation(d);
  if (!body || !Array.isArray(body.blocks)) return '';
  for (const b of body.blocks) {
    if (b && b.type === 'Paragraph' && b.paragraph) {
      const tekst = (b.paragraph.blocks || [])
        .map((c) => (c && c.type === 'Text' && c.text ? c.text.text : ''))
        .join('').trim();
      if (tekst) return tekst.length > 220 ? `${tekst.slice(0, 217)}…` : tekst;
    }
  }
  return '';
}

module.exports = { opret, REGIONER, region, hentJson, kortDokument, heltDokument, vaelgVariation, resumeAf };
