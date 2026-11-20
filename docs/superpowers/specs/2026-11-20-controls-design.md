# Ovládací prvky: HUD slidery, přepínače, obálka s tažením uzlů – návrh (krok 2 z 5)

Datum: 2026-11-20. Navazuje na `instructions.md` („Změny 20/11“) a na krok 1 (`2026-11-20-shell-design.md`: lišta, sbalené karty, detail, cyan HUD).

## Pořadí kroků
1. Skořápka – hotovo.
2. **Ovládací prvky** (tento dokument).
3. Nové efekty: equalizer, bitcrusher, stereo efekty.
4. Kombinace oscilátorů v modulu s nastavitelným poměrem.
5. Modul sekvence a import/export jednotlivých modulů.

## Záměr
Všechno v aplikaci se má dát pohodlně ovládat prstem a mít HUD vzhled ze screenshotu `Snímek obrazovky 2026-11-20 v 18.46.40` (pruhy s vyplněním a šrafovaným zbytkem) a obálku v grafu jako screenshot `v 19.15.36`, jen jednodušší. Textové pole zůstává jen pro `notes` a `rhythm`.

## Cíle
- **HUD slider** nahrazuje všechna číselná pole (`bpm`, `octaves`, `max extra`, `fade`, parametry efektů) a dnešní nativní posuvníky (`swing`, `randomize`, `rhythm mod`, `rate`, `pan`, sendy, hlasitost).
- **Přepínací tlačítka** nahrazují selecty s pár volbami: `osc` (4), `pitch` (2), `evolution` (2).
- **Dlouhé seznamy** zůstávají nativní `<select>` ve HUD stylu: `root`, `scale`, cíl sendu.
- **Obálka (ADSR) jako SVG graf**: uzly se táhnou prstem nebo myší a ovládají se i šipkami; pod grafem číselné hodnoty.
- **Drone `base`** přestává být textem: výběr tónu a oktávy.
- **Ovladatelnost z mobilu a 320 px:** dotyková plocha každého ovladače (včetně uzlů obálky) aspoň 44 px; svislé tažení mimo ovladač stránku normálně roluje.
- Zvuk, hodnoty a formát scén se nemění (kromě omezení obálky na platné hodnoty).

## Non-cíle
- DELAY, HOLD a TENSION obálky (DAHDSR) – případně samostatný krok později.
- Psaní čísel; vlastní rozbalovací seznamy místo nativního `select`.
- Úprava kroků rytmu přímo v mřížce; textová pole `rhythm`, `notes`, `kick`, `snare`, `hat` zůstávají beze změny (jsou to rytmické vzorce a seznam tónů).
- Nové parametry zvuku, změna formátu scény, světlý motiv.

## Anti-cíle
- Slider, který se při tažení „trhá“, nebo ovladač, který nejde ovládat klávesnicí.
- Ovladač, který na dotyku bojuje s rolováním stránky.
- Zobrazená hodnota, která nesedí se skutečnou (modul hodnotu omezil, nebo se změnila zvenku, např. načtením scény).
- Změna zvuku nebo ztráta uložených hodnot ve starých scénách.

## Přístup (vybral uživatel: hybrid)
**Kreslený HUD pruh + průhledný nativní `<input type=range>` nad ním.** Tažení, klávesnici a přístupnost zajišťuje prohlížeč, vzhled je vlastní. Kreslený pruh se synchronizuje s hodnotou inputu.
- Zamítnuto: ostylovaný nativní range (omezený HUD vzhled, rozdíly mezi prohlížeči); úplně vlastní slider z `div`ů (nejvíc práce a nejkřehčí na iOS: dotyk, klávesnice, čtečky).
- Obálka je v každé variantě vlastní SVG s pointer událostmi.

## Rozhodnutí
Uživatelova:
- Obálka zůstává ADSR s tažením uzlů; DELAY/HOLD/TENSION se nepřidávají.
- Hybridní slider.
- Čísla → HUD slidery; selecty s pár volbami → přepínací tlačítka; dlouhé seznamy → nativní select; `kick`/`snare`/`hat` zůstávají text; `base` → výběr tónu a oktávy; u slideru v detailu tlačítka −/+; obálka se v modulu omezí na platné hodnoty (potvrdil „ok“ na návrh).

Autorova (ke kontrole):
- **Slider** je komponenta `createSlider({ min, max, step, value, format, onInput, ariaLabel, nudge })` → `{ node, set(value) }`. `set` mění zobrazení a input bez volání `onInput`. `nudge: true` přidá po stranách tlačítka −/+, která posunou o jeden krok (jen slidery v detailu; slider hlasitosti v hlavičce karty je nemá a ukazuje jen pruh).
- **Hodnota** se zobrazuje textem vedle pruhu (`format(value)`); `aria-valuetext` odpovídá. Pruh je vyplněný do podílu `(value − min) / (max − min)` a zbytek je šrafovaný.
- **Rozsahy** zůstávají dnešní: `bpm` 20–300 (krok 1), `swing` 0–1 (0,05), `randomize` a `rhythm mod` a `rate` 1–10 (1), `pan` −1–1 (0,05), sendy a `return` a `damping` a hlasitost 0–1, `octaves` 1–4 (1), `max extra` 0–6 (1), `fade` 0,5–30 (0,5), delay `time` 10–2000 (10), `feedback` 0–0,9 (0,05), `tone` 200–12000 (100), reverb `decay` 0,3–10 (0,1). Zda `time`, `tone` a `decay` dostanou logaritmické mapování na pruh, rozhodne tvůrce.
- **Přepínací tlačítka:** `createSegmented({ options, value, onChange, ariaLabel })` → `{ node, set(value) }`, roleové skupiny (`radiogroup`), každé tlačítko aspoň 44 px.
- **Drone `base`:** výběr tónu (`ROOTS`, nativní select) a oktávy (0–6, slider s krokem 1, tedy celý dnešní rozsah C0–C6 modulu) skládá `rootNote` jako `${root}${oktáva}` a volá `setParam('rootNote', …)`. Hodnota z modulu se rozloží na tón a oktávu; enharmonické zápisy mimo `ROOTS` (`Db`, `D#`, `Gb`, `G#`, `A#`) se jen zobrazí jako jejich ekvivalent v `ROOTS` (`C#`, `Eb`, `F#`, `Ab`, `Bb`) a uložená hodnota se tím nepřepíše. Modul nepřijme tón mimo C0–C6 (např. `B6`); ovladače se pak vrátí na přijatou hodnotu (jako dnešní `synced`).
- **Obálka v modulu:** `setParam('env', …)` v `js/module.js` omezí `a`, `d`, `r` na 0–5 a `s` na 0–1 (stejně jako `validateScene`); UI přestane přiřazovat `m.params.env` přímo.
- **Graf obálky:** uzly jsou vrchol náběhu (`a`), konec poklesu (`d` vodorovně, `s` svisle) a konec doznění (`r`); sustain úsek má pevnou vizuální šířku, není parametrem. Mapování času na šířku musí umožnit jemně nastavit krátké hodnoty (výchozí `a` = 0,01 s musí jít vybrat a táhnout, např. odmocninové mapování). Uzel má dotykovou plochu aspoň 44 px; `touch-action: none` jen na uzlech, ne na celém SVG, aby šlo stránku rolovat. Šipky na zaostřeném uzlu mění hodnotu.
- **Synchronizace:** po změně zvenku (načtení scény, omezení modulem) se zobrazené hodnoty aktualizují; zdrojem pravdy je hodnota po přijetí modulem/efektem (jako dnes `synced`).
- Service worker: `pulsar-v13`, nové soubory do `FILES`.

Doplněno po kontrole návrhu (autorova rozhodnutí):
- **Žádný ovladač nevolá `setParam` při prvním vykreslení ani při synchronizaci ze scény.** Uložené hodnoty se přepíšou, jen když uživatel ovladač skutečně změní.
- **Svislé tažení začaté na slideru roluje stránku:** nativní `range` má `touch-action: pan-y`, slider je tedy jen vodorovný. Uzly obálky mají `touch-action: none`: tažení začaté na uzlu nikdy neroluje. Skutečný dotyk na telefonu zůstává neověřený.
- **Změna obálky platí živě:** každý pohyb ukazatele volá `setParam('env', …)`. `playNote` čte obálku jednou na začátku noty, takže se nic neslyšitelně nerozbije; platí od další noty.
- **`setParam('env', částečný objekt)` slučuje s aktuální obálkou modulu** (ne s `DEFAULT_ENV`): `{ a: 0.5 }` změní jen `a`. `validateScene` se tím nemění a dál dosazuje chybějící klíče z `DEFAULT_ENV`.
- **Kroky:** hlasitost a sendy zůstávají na 0,01; `return` a `damping` na 0,05 (jako dnes). Tlačítka −/+ posunou o jeden `step` slideru, kromě hlasitosti a úrovní sendů, kde posunou o 0,05.
- **Logaritmické mapování** (pokud ho tvůrce u `time`, `tone`, `decay` použije) platí i pro klávesy: vstupní range pracuje v mapovaném prostoru, takže jeden stisk šipky je jeden krok v tom prostoru.
- **Klávesy na uzlech obálky:** uzel poklesu (`d`/`s`) se hýbe šipkami na obou osách (vodorovně `d`, svisle `s`), uzel náběhu a uzel doznění jen vodorovně.

## Omezení a ověření
- Vanilla JS/CSS, žádné závislosti; cesty relativní.
- Node testy (`node --test`): čistá logika bez DOM – převod hodnota ↔ podíl pruhu včetně kroku, omezení a nečíselných vstupů; převod souřadnic grafu obálky na `a`, `d`, `s`, `r` a zpět včetně meze; `setParam('env')` v modulu (omezení, částečné objekty, nečíselné hodnoty); rozklad a skládání `rootNote`.
- UI v Chrome: tažení slideru a uzlů obálky skutečnou myší a pointer událostmi, šipky, tlačítka −/+, přepínače, `base` u dronu, načtení scény aktualizuje všechny ovladače, 320 px bez vodorovného posouvání, dotykové plochy ≥ 44 px, konzole bez chyb. Zvuk a skutečný dotyk na telefonu ověřit nelze.

## Ponecháno tvůrci
Přesný vzhled pruhu a šrafování, tvar uzlů a mřížky grafu obálky, přesné mapování času na šířku, logaritmické mapování u vybraných slideru, rozdělení do souborů (např. `js/hud.js` pro čistou logiku, `js/controls.js` pro DOM), názvy tříd a animací, zaostření a focus ring, texty `aria` atributů.
