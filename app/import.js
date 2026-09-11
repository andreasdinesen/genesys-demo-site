/*
 * Import af en fremmed side.
 *
 * Den vigtigste sidetype i en demo er ofte kundens egen forside: chatten skal
 * ses dér, hvor kunden ser den. Modulet henter siden, goer dens ressourcer
 * absolutte og fjerner en Genesys-snippet, siden allerede maatte have.
 *
 * Det er bevidst ét modul for sig: de tre funktioner er rene (paa naer selve
 * hentningen), og saa kan de proeves uden at starte en server.
 */

'use strict';

const http = require('node:http');
const https = require('node:https');

/**
 * Hent en side udefra og gem den som en »html«-side.
 *
 * Der hentes ogsaa over **http**: den nuvaerende testside ligger paa en ren
 * ip-adresse uden certifikat, og det er netop den, der skal kunne hentes ind.
 */
function hentSide(url, viderestillinger = 4) {
  return new Promise((ok, nej) => {
    let u;
    try { u = new URL(url); } catch { return nej(new Error('Ugyldig adresse')); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return nej(new Error('Kun http og https'));
    const klient = u.protocol === 'https:' ? https : http;
    const req = klient.get(u, { timeout: 30000, headers: { 'user-agent': 'genesys-demo-site/import', accept: 'text/html,*/*' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (viderestillinger <= 0) return nej(new Error('For mange viderestillinger'));
        return ok(hentSide(new URL(res.headers.location, u).toString(), viderestillinger - 1));
      }
      if (res.statusCode !== 200) { res.resume(); return nej(new Error(`Kilden svarede ${res.statusCode}`)); }
      let n = 0;
      const dele = [];
      res.on('data', (d) => {
        n += d.length;
        if (n > 12e6) { res.destroy(); nej(new Error('Siden er over 12 MB')); return; }
        dele.push(d);
      });
      res.on('end', () => ok({ html: Buffer.concat(dele).toString('utf8'), url: u.toString() }));
      res.on('error', nej);
    });
    req.on('timeout', () => req.destroy(new Error('Kilden svarede ikke inden 30 sekunder')));
    req.on('error', nej);
  });
}

/**
 * Gør relative adresser absolutte - men KUN paa ressourcer.
 *
 * `<base href>` ville vaere én linje, men den flytter ogsaa alle `<a href>`,
 * og saa forlader man demoen ved foerste klik i menuen. Derfor skrives kun
 * det, browseren HENTER (css, js, billeder), om til kildens adresse; links
 * bliver, hvor de er.
 */
function absolutiser(html, kilde) {
  const base = new URL(kilde);
  const abs = (v) => {
    const s = String(v || '').trim();
    if (!s || /^(https?:|data:|blob:|mailto:|tel:|#|javascript:)/i.test(s)) return s;
    try { return new URL(s, base).toString(); } catch { return s; }
  };
  let ud = html;
  ud = ud.replace(/(<(?:script|img|source|iframe|video|audio|embed)\b[^>]*?\ssrc=)(["'])(.*?)\2/gi,
    (m, a, k, v) => a + k + abs(v) + k);
  ud = ud.replace(/(<link\b[^>]*?\shref=)(["'])(.*?)\2/gi, (m, a, k, v) => a + k + abs(v) + k);
  ud = ud.replace(/(\ssrcset=)(["'])(.*?)\2/gi, (m, a, k, v) => a + k
    + v.split(',').map((d) => {
      const dele = d.trim().split(/\s+/);
      dele[0] = abs(dele[0]);
      return dele.join(' ');
    }).join(', ') + k);
  ud = ud.replace(/url\((['"]?)([^)'"]+)\1\)/gi, (m, k, v) => `url(${k}${abs(v)}${k})`);
  return ud;
}

/**
 * Fjern en Genesys-snippet, siden allerede har.
 *
 * Uden det ville en importeret side koere TO widgets: kildens og vores. To
 * bootstraps paa samme side giver to koeer, to sessions og en chat, der
 * opfoerer sig tilfaeldigt - og det er svaert at gennemskue midt i en demo.
 */
function fjernGenesys(html) {
  let ud = html.replace(/<script\b[^>]*>(?:(?!<\/script>)[\s\S])*?genesys-bootstrap[\s\S]*?<\/script>/gi, '\n<!-- (oprindelig Genesys-snippet fjernet ved import) -->\n');
  ud = ud.replace(/<!--\s*\/?\s*Genesys Web Messaging[^>]*-->/gi, '');
  return ud;
}


module.exports = { hentSide, absolutiser, fjernGenesys };
