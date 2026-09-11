/*
 * Proever af Genesys-klienten - uden at roere Genesys.
 *
 * Klienten faar sin hentefunktion udefra, saa hele OAuth-dansen og
 * Knowledge-kaldene kan proeves med et opdigtet svar. Det, der proeves, er
 * netop dét, man ikke kan se ved at laese koden: at tokenet genbruges, at et
 * 401 giver ÉT nyt forsoeg og ikke en uendelig loekke, og at cachen svarer med
 * et gammelt svar frem for at vaelte en demo.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const genesys = require('../app/genesys.js');

/** En klient med opdigtede indstillinger og et opdigtet net. */
function klient(svar, indstillinger = {}) {
  const kald = [];
  const ur = { nu: 1_700_000_000_000 };
  const std = {
    genesys_env: 'prod-euc1',
    genesys_client_id: 'id-1',
    genesys_client_secret: 'hemmelig',
    genesys_kb_id: 'kb-1',
    kb_cache_min: '5',
  };
  const g = genesys.opret({
    indstilling: (navn, dflt = '') => {
      const alle = Object.assign({}, std, indstillinger);
      return alle[navn] !== undefined ? alle[navn] : dflt;
    },
    log: () => {},
    nu: () => ur.nu,
    hent: async (url, opts = {}) => {
      kald.push({ url, opts });
      return svar(url, opts, kald.length);
    },
  });
  return { g, kald, ur };
}

test('regionen bestemmer alle tre adresser', () => {
  const { g } = klient(() => ({}));
  const k = g.konfig();
  assert.equal(k.domaene, 'mypurecloud.de');
  assert.equal(k.api, 'api.mypurecloud.de');
  assert.equal(k.login, 'login.mypurecloud.de');
  assert.equal(k.apps, 'apps.mypurecloud.de');
});

test('ukendt region falder tilbage paa Frankfurt i stedet for undefined', () => {
  assert.equal(genesys.region('vrooevl').domaene, 'mypurecloud.de');
  assert.equal(genesys.region('').env, 'prod-euc1');
  assert.equal(genesys.region('prod-euw1').domaene, 'mypurecloud.ie');
});

test('tokenet hentes med Basic auth og client_credentials', async () => {
  const { g, kald } = klient(() => ({ access_token: 'T1', expires_in: 3600 }));
  const t = await g.hentToken();
  assert.equal(t, 'T1');
  assert.equal(kald[0].url, 'https://login.mypurecloud.de/oauth/token');
  assert.equal(kald[0].opts.method, 'POST');
  assert.equal(kald[0].opts.body, 'grant_type=client_credentials');
  const basic = Buffer.from('id-1:hemmelig').toString('base64');
  assert.equal(kald[0].opts.headers.authorization, `Basic ${basic}`);
});

test('tokenet genbruges - der hentes ikke et nyt ved hvert kald', async () => {
  const { g, kald } = klient((url) => (url.includes('/oauth/token')
    ? { access_token: 'T1', expires_in: 3600 }
    : { entities: [] }));
  await g.api('/api/v2/en');
  await g.api('/api/v2/to');
  assert.equal(kald.filter((k) => k.url.includes('/oauth/token')).length, 1);
});

test('uden opsaetning er fejlen om den MANGLENDE opsaetning - ikke et 401', async () => {
  const { g, kald } = klient(() => ({}), { genesys_client_secret: '' });
  await assert.rejects(() => g.hentToken(), /ikke sat op/);
  assert.equal(kald.length, 0, 'der maa ikke ringes til Genesys uden en noegle');
});

test('401 giver ét nyt forsoeg med friskt token - og saa ikke flere', async () => {
  let tokener = 0;
  const { g, kald } = klient((url) => {
    if (url.includes('/oauth/token')) { tokener += 1; return { access_token: `T${tokener}`, expires_in: 3600 }; }
    throw Object.assign(new Error('401: Unauthorized'), { status: 401 });
  });
  await assert.rejects(() => g.api('/api/v2/knowledge/knowledgebases'), /401/);
  assert.equal(tokener, 2, 'præcis ét nyt token');
  assert.equal(kald.filter((k) => k.url.includes('/knowledge')).length, 2);
});

test('400 fra token-endepunktet peger paa noeglen - ikke paa rettigheder', async () => {
  /* Maalt mod det rigtige endepunkt 2026-09-11: en forkert noegle giver
   * 400 invalid_client paa login.<domaene>, mens et ugyldigt token giver
   * 401 bad.credentials paa api.<domaene>. De to fejl skal foere folk to
   * forskellige steder hen. */
  const { g } = klient(() => {
    throw Object.assign(new Error('400: invalid_client: authentication failed'), { status: 400 });
  });
  await assert.rejects(() => g.hentToken(), /tjek client id og secret/);
  assert.equal(g.status().sidsteFejl.status, 400);
});

test('sidste fejl gemmes, saa admin kan se HVAD Genesys sagde', async () => {
  const { g } = klient((url) => {
    if (url.includes('/oauth/token')) return { access_token: 'T', expires_in: 3600 };
    throw Object.assign(new Error('403: missing permission knowledge:document:view'), { status: 403 });
  });
  await assert.rejects(() => g.api('/api/v2/x'));
  const s = g.status();
  assert.equal(s.sidsteFejl.status, 403);
  assert.match(s.sidsteFejl.besked, /knowledge:document:view/);
});

test('status laekker hverken hemmelighed eller token', async () => {
  const { g } = klient(() => ({ access_token: 'TOKEN-VAERDI', expires_in: 3600 }),
    { genesys_client_secret: 'SEKS-SYV-OTTE' });
  await g.hentToken();
  const s = JSON.stringify(g.status());
  assert.ok(!s.includes('SEKS-SYV-OTTE'), 'client secret maa ALDRIG med i status');
  assert.ok(!s.includes('TOKEN-VAERDI'), 'heller ikke access-tokenet');
  assert.ok(s.includes('hemmelighedSat'), 'men det skal kunne SES, at den er sat');
  assert.equal(JSON.parse(s).klientId, 'id-1…', 'kun begyndelsen af klient-id\'et');
});

test('inden for cachens levetid spoerges Genesys slet ikke igen', async () => {
  const { g, kald } = klient((url) => {
    if (url.includes('/oauth/token')) return { access_token: 'T', expires_in: 3600 };
    return { entities: [{ id: 'k1', name: 'Ofte stillede', documentCount: 3 }] };
  });
  await g.kategorier();
  await g.kategorier();
  assert.equal(kald.filter((k) => k.url.includes('/categories')).length, 1);
});

test('naar Genesys fejler, svarer cachen med det sidst kendte - og siger det', async () => {
  let virker = true;
  const { g, ur } = klient((url) => {
    if (url.includes('/oauth/token')) return { access_token: 'T', expires_in: 3600 };
    if (!virker) throw Object.assign(new Error('502: nede'), { status: 502 });
    return { entities: [{ id: 'k1', name: 'Ofte stillede', documentCount: 3 }] };
  });
  const foerst = await g.kategorier();
  assert.equal(foerst.vaerdi[0].navn, 'Ofte stillede');
  assert.equal(foerst.foraeldet, false);

  /* Ti minutter senere er cachen for gammel (ttl = 5 min), og Genesys er nede.
   * Det er praecis det oejeblik, en demo ellers ville vise en tom side. */
  ur.nu += 10 * 60000;
  virker = false;
  const gammelt = await g.kategorier();
  assert.equal(gammelt.vaerdi[0].navn, 'Ofte stillede');
  assert.equal(gammelt.foraeldet, true, 'og siden skal kunne SIGE, at svaret er gammelt');
  assert.match(gammelt.fejl, /502/);
});

test('uden noget cachet slaar fejlen igennem - der opfindes ikke et tomt svar', async () => {
  const { g } = klient((url) => {
    if (url.includes('/oauth/token')) return { access_token: 'T', expires_in: 3600 };
    throw Object.assign(new Error('502: nede'), { status: 502 });
  });
  await assert.rejects(() => g.kategorier(), /502/);
});

test('kladder og arkiverede artikler kommer ikke paa sitet', async () => {
  const { g } = klient((url) => {
    if (url.includes('/oauth/token')) return { access_token: 'T', expires_in: 3600 };
    return {
      entities: [
        { id: '1', title: 'Udgivet', state: 'Published' },
        { id: '2', title: 'Kladde', state: 'Draft' },
        { id: '3', title: 'Arkiveret', state: 'Archived' },
      ],
    };
  });
  const svar = await g.dokumenter({});
  assert.deepEqual(svar.vaerdi.map((d) => d.titel), ['Udgivet']);
});

test('variationen med hoejest priority vinder', () => {
  const dok = {
    id: '1',
    title: '艦',
    variations: [
      { priority: 1, body: { blocks: [{ type: 'Paragraph', paragraph: { blocks: [{ type: 'Text', text: { text: 'lav' } }] } }] } },
      { priority: 9, body: { blocks: [{ type: 'Paragraph', paragraph: { blocks: [{ type: 'Text', text: { text: 'hoej' } }] } }] } },
    ],
  };
  assert.equal(genesys.vaelgVariation(dok).blocks[0].paragraph.blocks[0].text.text, 'hoej');
  assert.equal(genesys.resumeAf(dok), 'hoej');
});

test('resumeet tager foerste AFSNIT - ikke et billede', () => {
  const dok = {
    variations: [{
      body: {
        blocks: [
          { type: 'Image', image: { url: 'https://x/y.png' } },
          { type: 'Paragraph', paragraph: { blocks: [{ type: 'Text', text: { text: 'Den rigtige tekst' } }] } },
        ],
      },
    }],
  };
  assert.equal(genesys.resumeAf(dok), 'Den rigtige tekst');
});

test('et dokument uden variationer vaelter ikke kortformen', () => {
  const kort = genesys.kortDokument({ id: '1', title: null, labels: null });
  assert.equal(kort.titel, '(uden titel)');
  assert.equal(kort.resume, '');
  assert.deepEqual(kort.maerker, []);
});

test('soegning uden tekst rammer slet ikke Genesys', async () => {
  const { g, kald } = klient(() => ({ access_token: 'T', expires_in: 3600 }));
  const svar = await g.soeg('   ');
  assert.deepEqual(svar, { traef: [], total: 0 });
  assert.equal(kald.length, 0);
});

test('soegning sender query som ManualSearch', async () => {
  const { g, kald } = klient((url) => {
    if (url.includes('/oauth/token')) return { access_token: 'T', expires_in: 3600 };
    return { total: 1, results: [{ confidence: 0.8, document: { id: 'd1', title: 'Svar' } }] };
  });
  const svar = await g.soeg('hvordan skifter jeg kode?');
  const kaldet = kald.find((k) => k.url.includes('/documents/search'));
  assert.equal(kaldet.opts.method, 'POST');
  assert.equal(kaldet.opts.body.queryType, 'ManualSearch');
  assert.equal(svar.traef[0].titel, 'Svar');
  assert.equal(svar.traef[0].score, 0.8);
});

test('et ugyldigt dokument-id naar aldrig ud paa nettet', async () => {
  const { g, kald } = klient(() => ({ access_token: 'T', expires_in: 3600 }));
  await assert.rejects(() => g.dokument('../../admin'), /ugyldigt dokument-id/);
  assert.equal(kald.length, 0);
});
