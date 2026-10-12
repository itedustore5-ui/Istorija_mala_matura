# Stanje prepisivanja zbirke

Deo ISTORIJA u zbirci ima **120 zadataka (241–360)**; uneto je **svih 120**,
sa tačnim odgovorom iz odeljka REŠENJA i kratkim objašnjenjem. Tačan broj po
celinama i tipovima ispisuje `verify:scoring`, a ako neki broj nedostaje,
navodi ga posebno:

```bash
pnpm --filter @workspace/api-server run verify:scoring
```

## Kako je zadatak prepisan

1. Tekst zadatka sa strane iz `Istorija.pdf` (skeniran, bez tekstualnog sloja —
   strane su renderovane u sliku i čitane vizuelno). Skenirano je bez rupa:
   strane knjige 63–99 idu redom.
2. **Tačan odgovor isključivo iz `Istorija rešenja.pdf`** (strane 174–179), nikad
   iz označenih kružića u samom zadatku — primerak je bio popunjen.
3. Zadatak je u `src/data/questions/zadaci-<od>-<do>.ts`, sa brojem koji ima u
   zbirci.
4. Prilozi (karte, fotografije, grafikoni, grbovi, plakat) isečeni su iz PDF-a
   na 216 dpi u `artifacts/istorija-kviz/public/images/zadatak-NNN.jpg`, sivi
   JPEG (skenovi su sivi; PNG bi zbog šuma zauzeo pet puta više). Grafikoni i
   amblem (290, 291, 309) su PNG, jer su crteži sa tekstom.
5. Tabele (286–289) su prepisane kao tekst, ne kao slika.

Stari pravopis u izvorima (Sretenjski ustav u 352, „Начертаније“ u 355,
ijekavski oblici u 324) ostaje kako stoji u zbirci. Unutrašnji navodnici su
ujednačeni u ‚…‘.

## Prilagođavanja modelu

Svako ima komentar iznad zadatka, sa razlogom.

| Zadatak | U zbirci | U aplikaciji | Zašto |
|---|---|---|---|
| 243, 244, 245, 247 | linije za upis | `fill` sa po jednim poljem za svaku liniju | — |
| 245 | „___ деценија ___ века“ | dva polja; uz „деветнаестог“ prima i „деветнаести“ | polje „Век“ nema padež iz rečenice |
| 281, 285 | jedna linija, više pojmova | jedno polje, svaki redosled (`anyOrder`) | dva polja bi priznala isti pojam upisan dvaput |
| 288 | upis „у броју тенкова, топова и минобацача и авиона“ | `multi` nad kolonama tabele | tri stavke u slobodnoj formulaciji se ne mogu pouzdano porediti; ponuđene su samo kolone iz tabele, ništa izmišljeno |
| 295 | upis pojava u kolone tabele | `match`: za svaku pojavu bira se vek | isti sadržaj; dve pojave u istoj koloni su dozvoljene |
| 300, 301 | jedan red ostaje prazan | kolona „није ниједан од наведених“ | prazan red bi značio i „nisam odgovorio“ |
| 348 | četiri slike sa kružićem ispod | `single` sa `optionImages` | natpisi „Слика 1–4“ ne odaju odgovor |
| 360 | dve kolone, po jedan odgovor („Шта поручује?“ / „На какав начин?“) | jedan `multi`, stavke označene „А.“ i „Б.“ | pravilo za zadatke sa dva dela; oba dela ostaju bodovana |

## Greške u samoj zbirci

| Zadatak | Šta stoji | Šta je uneto |
|---|---|---|
| 293 | „Оба текста написана су написали поражени.“ | „Оба текста написали су поражени.“ |
| 302 | „Кнежевине Србија и Кнежевине Црна Гора …“ | „Кнежевине Србија и Црна Гора …“ (kao u rešenju) |
| 359 | „би смо“ | ostaje — citat izvora se ne ispravlja |

## Šta još nedostaje

- **Nivoi po standardima.** Zbirka ih za istoriju ne piše uz zadatke; šifre
  standarda su u tabeli koja nije u skenu. Bez nje se nivo ne unosi — bilo bi
  nagađanje.
- **Testovi sa prethodnih završnih ispita** (`scripts/import-exam.mjs`).

## Posle svake dopune

```bash
pnpm run typecheck
pnpm --filter @workspace/api-server run verify:scoring
pnpm --filter @workspace/api-server run verify:tekst
```
