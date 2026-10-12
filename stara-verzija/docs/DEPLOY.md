# Postavljanje na Render

Aplikacija se na Renderu vrti kao **jedan** Web Service: isti Node proces služi
i API i izgrađeni frontend. Nema zasebnog static site-a — server u produkciji
servira `artifacts/istorija-kviz/dist/public`.

Baza je zaseban Postgres (Render Postgres ili Supabase).

## 1. Baza

Napravi Postgres i sačuvaj konekcioni string.

- **Render Postgres** — uzmi *Internal Database URL* ako je servis u istom
  regionu; brže je i ne izlazi na internet.
- **Supabase** — uzmi **Session pooler** string (port 5432). Radi i bez
  `?sslmode=require`; dodaj ga samo ako veza bude odbijena.

Tabele se prave same, prilikom prvog deploya (vidi build komandu).

## 2. Web Service

Novi Web Service iz GitHub repoa, grana `main`. **Root Directory** ostaje
prazno.

**Build Command**

```bash
corepack enable && pnpm install --frozen-lockfile && pnpm run build && pnpm --filter @workspace/api-server run migrate
```

**Start Command**

```bash
node --enable-source-maps artifacts/api-server/dist/index.mjs
```

**Environment Variables**

| Ključ | Vrednost |
|---|---|
| `NODE_ENV` | `production` |
| `NODE_VERSION` | `22` |
| `PORT` | `10000` |
| `BASE_PATH` | `/` |
| `DATABASE_URL` | konekcioni string iz koraka 1 |
| `SESSION_SECRET` | dugačak nasumičan niz |

`.env` fajl se **ne** postavlja na Render — sve ide kroz Environment tab.
Fajl `.env` u korenu repoa služi samo za lokalni rad i `.gitignore` ga drži van
gita.

Tajnu generiši sa:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Promena `SESSION_SECRET`-a odjavljuje sve korisnike, pa je postavi jednom i ne
diraj je.

## 3. Zašto baš te komande

Tri stvari koje izgledaju kao sitnica, a obore deploy:

**Start komanda ne sme biti `pnpm start`.** Server traži frontend na putanji
`process.cwd() + "artifacts/istorija-kviz/dist/public"`. Pokrenut iz
`artifacts/api-server`, radni folder je pogrešan: API radi, a stranica je bela.

**`NODE_ENV=production` nije kozmetika.** Server servira statičke fajlove samo u
tom režimu (`app.ts`). Bez toga radi isključivo `/api`.

**`PORT` i `BASE_PATH` trebaju i pri gradnji, ne samo pri pokretanju.**
`vite.config.ts` namerno baca grešku ako ih nema, pa bez njih pada build, a ne
tek pokretanje. Zato stoje kao promenljive, a ne samo kao Renderov runtime port.

## 4. Prvi admin nalog

Skripta `seed` pravi nalog iz `ADMIN_INITIAL_PASSWORD` (najmanje šest znakova;
`reset-password` traži osam).
Korisničko ime je `admin`, osim ako postaviš `ADMIN_USERNAME`. Skripta je
idempotentna: ako nalog već postoji, ne dira mu lozinku.

Bilo koji od tri načina radi — izaberi prema planu koji imaš.

**a) Render Shell** (plaćeni plan)

Dodaj `ADMIN_INITIAL_PASSWORD` među promenljive, pa u Shell tabu:

```bash
pnpm --filter @workspace/api-server run seed
```

**b) Sa svog računara, protiv iste baze** (radi i na besplatnom planu)

U koren repoa upiši `.env` sa `DATABASE_URL` sa Rendera i
`ADMIN_INITIAL_PASSWORD`, pa lokalno:

```bash
pnpm --filter @workspace/api-server run seed
```

Skripte same čitaju `.env` iz korena (`src/lib/load-env.ts`).

**c) Kroz build komandu** (besplatan plan, bez lokalnog pristupa bazi)

Dodaj `ADMIN_INITIAL_PASSWORD` među promenljive i privremeno dopiši seed na kraj
Build Command-a:

```bash
... && pnpm --filter @workspace/api-server run migrate && pnpm --filter @workspace/api-server run seed
```

Posle uspešnog deploya **vrati build komandu na staru** i obriši
`ADMIN_INITIAL_PASSWORD`. Lozinka u promenljivima nema šta da radi duže nego što
mora.

Promena lozinke kasnije, istim putem:

```bash
NEW_PASSWORD=nova-lozinka pnpm --filter @workspace/api-server run reset-password admin
```

Bez argumenta, `reset-password` samo ispisuje sve naloge i njihovo stanje —
korisno kad prijava ne prolazi.

## 5. Migracije

Stoje u build komandi, pa se primenjuju pri svakom deployu. To je bezbedno jer
su pisane idempotentno (`IF NOT EXISTS`) i ne zavise od redosleda — vidi
`lib/db/migrations/`.

Ručno, ako zatreba:

```bash
pnpm --filter @workspace/api-server run migrate
```

## 6. Provera da radi

```
GET /api/healthz   →  {"status":"ok"}
GET /              →  200, uz assets/*.js i assets/*.css
```

## 7. Česti problemi

**Prijava vraća 401.** Upit nad bazom je prošao (da tabela ne postoji, dobila bi
500), pa je stvar u nalogu: ili ga nema, ili lozinka ne odgovara. Izlistaj
naloge sa `reset-password` bez argumenta. Korisničko ime se poredi tačno onako
kako je upisano — `admin`, latinicom.

**Bela stranica, a `/api` radi.** Nedostaje `NODE_ENV=production` ili je start
komanda pokrenuta iz pogrešnog foldera.

**Build pada na `PORT environment variable is required`.** Nisu postavljeni
`PORT` i `BASE_PATH`.

**Build pada na `@esbuild/linux-x64 could not be found`.**
`pnpm-workspace.yaml` isključuje sve platforme osim `linux-x64` i `win32-x64`;
proveri da linux-x64 nije slučajno završio među `overrides`.

**`Use pnpm instead` pri instalaciji.** Build komanda ne sme koristiti npm ili
yarn — `preinstall` ih odbija. Otud `corepack enable` na početku.
