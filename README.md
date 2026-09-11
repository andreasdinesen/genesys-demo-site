# Genesys Demo Site

Et demo-website til Genesys Cloud, pakket som **yggdrasil-rune**.

Sitet er kulissen, man viser Genesys frem i: Web Messaging-widget'en ligger på
alle sider, hjælpesiden henter artikler live fra en vidensbase i Genesys Cloud,
og en kundes rigtige forside kan importeres som en side, så chatten kan vises
dér, hvor kunden ser den.

Hele sitet kan lukkes bag **ét kodeord**, der kan åbnes i et tidsvindue før en
demo og lukker sig selv igen bagefter.

```
/                    demo-sitet  (låsen gælder her)
/admin               styringen   (altid bag eget login)
```

---

## Kom i gang

### 1 · Installér runen

I Yggdrasil Panel: **Runes → Browse GitHub → Reload**, og installér *Genesys
Demo Site*. Ved installationen kan udfyldes:

| Variabel | Betydning |
|---|---|
| `SITE_NAME` | Sitets navn i menu og fod. Kan ændres i admin bagefter. |
| `GENESYS_ENV` | Region, fx `prod-euc1` (Frankfurt). |
| `GENESYS_DEPLOYMENT_ID` | Messenger deployment-id. Valgfrit – kan sættes i admin. |
| `NODE_IMAGE` | `node:24-alpine` som standard. Node 22+ kræves (`node:sqlite`). |
| `KODE_VERSION` | Tom = hent nyeste udgivelse ved hver genstart. Et tal låser. |

Runen **bærer ikke** appen: install-scriptet henter koden fra GitHub-taggen
`vN`, og serveren henter selv nyere udgaver ved hver genstart. **En genstart
er altså opdateringen** – der skal ikke udgives en ny rune for ny app-kode.

### 2 · Opret administratoren

Åbn `/admin`. Første besøg beder om brugernavn og kodeord. Det er *din* konto –
demo-gæster bruger sitets eget kodeord og har ingen konto.

### 3 · Sæt Web Messaging op

**Admin → Genesys → Web messaging**: vælg region og indsæt deployment-id'et fra
Genesys Cloud (*Admin → Message → Messenger Deployments*). Snippet'en lægges
derefter ordret ind på hver side – den samme, Genesys selv udleverer.

### 4 · Giv adgang til vidensbasen (valgfrit)

Hjælpesiden henter artikler gennem Platform API'et og kræver en OAuth-klient:

1. I Genesys Cloud: **Admin → Integrations → OAuth → Add client**
2. Grant type: **Client Credentials**
3. Giv klienten en rolle med mindst
   `knowledge:document:view` og `knowledge:knowledgebase:view`
4. Kopiér **Client ID** og **Client Secret** ind i **Admin → Genesys → API-adgang**
5. Tryk **Test forbindelsen** og vælg vidensbasen i listen

Hemmeligheden bliver på serveren. Den vises aldrig igen og kommer ikke med i en
eksport – frontenden får kun at vide, *at* den er sat.

### 5 · Lås sitet

**Admin → Adgang**: sæt et kodeord og slå låsen til. Før en demo trykker du
**Åbn i 2/4/8 timer** på oversigten. Vinduet lukker sig selv – også hvis du
glemmer det – og låsen gælder kun sitet, aldrig admin.

---

## Sider

Sitet er en række sider i databasen. Hver side har en adresse, en type og et
felt for, om Genesys-widget'en skal med.

| Type | Hvad den er |
|---|---|
| **Forside** | Hero + sektioner med kort. Ligger altid på `/`. |
| **Indholdsside** | Rubrik, manchet og de samme sektioner. |
| **Vidensbase** | Søgefelt, kategorier og artikler fra Genesys. Artikler på `/<slug>/artikel/<id>/<titel>`. |
| **Kontakt** | Kontaktoplysninger, en demo-formular og en »Åbn chatten«-knap. |
| **Importeret HTML** | En fremmed side, som den er. |

### Import af en kundes side

**Sider → Importér side** henter en adresse (også over http) eller tager
indsat HTML. Ved importen sker to ting:

- **Ressourcer gøres absolutte** – css, js og billeder hentes fortsat fra
  kilden, så siden ser ud som originalen. `<a href>` røres *ikke*, så man ikke
  forlader demoen ved første klik i menuen.
- **En Genesys-snippet, siden allerede har, fjernes.** To bootstraps på samme
  side giver to køer og en chat, der opfører sig tilfældigt.

Importerede sider får hverken sitets menu eller css. Det er meningen.

---

## Udvikling

```bash
BIND_PORT=8920 DATA_DIR=/tmp/gds node app/server.js   # kør lokalt
node --test tests/*.test.mjs                          # prøverne
python3 build_rune.py                                 # byg runen
```

`app/public/app.js` er **genereret** af `build_rune.py` ud fra `app/parts/p*.js`
– redigér aldrig den samlede fil. Versionen bor ét sted:
`const APP_VERSION = N;` i `app/parts/p1_core.js`.

### Filerne

| Fil | Ansvar |
|---|---|
| `app/server.js` | Ruter, login, lås, sider, admin-API |
| `app/sider.js` | Skabelonerne + Genesys-snippet'en. Sidetyperne står i `TYPER` |
| `app/genesys.js` | OAuth + Knowledge API + cache med »sidste gode svar« |
| `app/kb.js` | Genesys' artikelformat (DocumentBody) → HTML |
| `app/import.js` | Hentning af en fremmed side |
| `app/kilde.js` | Henter appens egen kode fra GitHub ved opstart |

### Udgivelse

1. Bump `APP_VERSION` i `app/parts/p1_core.js` – **kun ved en godkendt udgivelse**
2. `python3 build_rune.py`
3. Opdatér versionshistorikken herunder
4. Commit, `git tag vN`, `git push && git push --tags`
5. I panelet: genstart (eller **Opdater demo-sitet**)

Taggen `vN` **skal** være pushet – det er den, install-scriptet henter.

---

## Sikkerhed

- Sitets lås er ét delt kodeord (scrypt-hashet) med rate-limit og en
  session-cookie, der lever syv dage. Et nyt kodeord lukker alle inde fra det
  gamle.
- Admin har eget login, egen cookie og er aldrig omfattet af låsen.
- Alle sider er `noindex, nofollow`, og `/robots.txt` afviser alt.
- Artikler fra Genesys escapes fuldt ud, og kun `http`, `https`, `mailto` og
  `tel` overlever som links.
- **Der sættes ingen CSP på demo-sitet.** Widget'en, en importeret kundeside og
  »ekstra kode«-felterne henter med vilje fra fremmede værter – en CSP ville
  blokere netop det, sitet er til for.

---

## Versionshistorik

| Version | Ændring |
|---|---|
| 1 | Første udgave: sider (forside, indhold, vidensbase, kontakt, importeret HTML), Web Messaging-snippet, vidensbase fra Genesys Knowledge API, lås med tidsvindue, admin med udseende/Genesys/adgang, import af fremmed side, eksport og import af opsætningen. |
