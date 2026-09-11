# CLAUDE.md — Genesys Demo Site

Læs `~/ClaudeMacBook/RUNE-ERFARINGER.md` **før og efter** arbejde her, og skriv
nye generelle lærdomme derind (ikke her).

## Hvad det er

Et demo-website til Genesys Cloud som yggdrasil-rune. Sitet er kulissen; admin
er styringen. Alt bor i én SQLite-fil i `/data`.

## Regler, der ikke må brydes

- **`app/public/app.js` er genereret.** Redigér `app/parts/p*.js` og kør
  `python3 build_rune.py`. Det samme gælder `runes/genesys-demo-site.yaml`.
- **Versionen bor ét sted**: `const APP_VERSION = N;` i `app/parts/p1_core.js`.
  Bump **kun** når Andreas har godkendt en udgivelse — ellers brændes numre af
  på noget, der aldrig blev pushet.
- **Commit og push kræver et udtrykkeligt ja.** Repoet er offentligt, og
  install-scriptet henter fra taggen `vN`: et push er en udgivelse.
- **Hemmeligheder forlader aldrig serveren.** `genesys_client_secret`,
  `gate_hash` og `gate_salt` står i `INDSTILLINGER` med `hemmelig: true` og
  filtreres fra i både `/api/admin/data` og eksporten. Nye hemmeligheder skal
  markeres samme sted.
- **Ingen npm-pakker.** node:http, node:sqlite, node:crypto — det er listen.
- **Ingen CSP på demo-sitet.** Se README. Widget, importeret side og
  »ekstra kode« skal kunne hente udefra.

## Sådan vokser det

- **Ny sidetype**: en `tegnX()` i `app/sider.js`, en linje i `TYPER`, og
  felterne i `tegnTypeFelter()` i `app/parts/p3_sider.js`. Intet andet sted.
- **Ny indstilling**: en linje i `INDSTILLINGER` i `app/server.js` (hvidlisten
  er den eneste liste) og et felt i den relevante admin-del.
- **Ny admin-side**: en del i `app/parts/`, en `tegnX()`, en linje i `SIDER` i
  p1, og knapper/formularer i `HANDLINGER`/`FORMER`. Delene kender ikke
  hinanden — kun registrene.
- **Nyt Genesys-kald**: i `app/genesys.js`, altid gennem `api()` (401-retry) og
  `cachet()` (sidste gode svar). Aldrig et kald direkte fra frontenden.

## Prøverne

```bash
node --test tests/*.test.mjs
```

De dækker artikel-rendereren, Genesys-klienten (med opdigtet net og styret ur),
importen og skabelonerne. `tests/genesys.test.mjs` viser mønsteret: klienten
får både `hent` og `nu` injiceret, så både 401-retry og cachens udløb kan
prøves uden at røre Genesys.

## Lokal kørsel

`~/.claude/launch.json` har en post `genesys-demo-site` på port 8920 med
DATA_DIR i en scratch-mappe.

## Ting, der er lette at gøre forkert

- `render()`/`tegn()` i admin bygger DOM'en forfra: element-refs bliver stale
  ved hvert klik. Driv fladen med `javascript_tool` i test, ikke med refs.
- Editoren skal læses ind med `laesEditor()` **før** enhver gentegning, ellers
  taber man det, brugeren lige skrev.
- `widgetSnippet()` validerer deployment-id og region, fordi værdierne skrives
  ind i et `<script>`. Løsn aldrig de regexer.
- En importeret side kan være 260 KB+. Grænserne (12 MB i `hentSide`, `gemSide`
  og `laesJson`) hænger sammen — ret dem samlet.
