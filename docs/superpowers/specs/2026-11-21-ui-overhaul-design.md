# Změny 21/11: ikony, globální BPM, transport bar, header, theme — design

Zdroj: `instructions.md`, sekce „21/11 změny“. Velikost: větší změna (pět souvisejících částí), ale bez nového zvukového kódu kromě jednoho místa (efektivní BPM modulu).

## Proč

Aplikace se má dobře ovládat z mobilu a mít klidnější, hotovější ovládání. Textová tlačítka `[save]`, `[x]`, `[sure?]` zabírají místo a působí jako terminál z minulého století. Header je přeplněný (transport, save/load, přidávání, zprávy). Tempo se dnes nastavuje po modulech a není způsob, jak je nastavit najednou. Barva je pevně cyan.

## Cíle

- Každé ovládací tlačítko je grafická ikona (SVG), stále s `title` a `aria-label`.
- **Globální BPM** s přepínačem on/off. On: všechny tempové moduly hrají stejným tempem. Off: každý svým vlastním, přesně jako dnes.
- **Transport bar** dole, stále viditelný: play/stop, globální BPM (přepínač + slider). Na desktopu mezerník = play/stop.
- **Header**: název, tlačítko `+`, hamburger. `+` otevře menu s moduly, hamburger menu se scénou (new scene, load, save) a theme.
- **Theme**: uživatel si vybere barevný akcent, vybraný akcent se pamatuje.
- Všechno funguje a ovládá se prstem při 320 px.

## Ne-cíle

- Žádné srovnávání dob (beat sync), žádný tap tempo. Společné je jen tempo (potvrzeno uživatelem).
- Drone nemá tempo (má `rate`), globální BPM se ho netýká.
- Žádný světlý theme, žádný akcent po scénách (je to nastavení zařízení, ne scény).
- Žádné další klávesové zkratky než mezerník. Žádná změna zvukového jádra a formátu scén (`version` zůstává 1).
- Skutečný telefon (safe-area na iPhonu, skutečný dotyk) a zvuk z reproduktoru neověřím. Ověřím v Chrome při 320 px, myší a simulovanými dotyky.

## Přístupy

1. **Globální BPM přepisem v `tick` (zvoleno).** Efektivní tempo modulu = `global.on ? global.bpm : m.params.bpm`. Hodnoty v modulech zůstávají, po vypnutí hrají dál vlastním tempem. Alternativa „zapsat globální hodnotu do všech modulů a pak vrátit“ je křehká (modul přidaný za běhu, import, scéna).
2. **Ikony jako inline SVG v malém modulu `js/icons.js` (zvoleno).** Barva `currentColor`, takže se ikony přebarví akcentem a vypadají všude stejně. Unicode znaky vypadají na iOS a Androidu každý jinak, samostatné `.svg` soubory přidávají požadavky a položky v service workeru.
3. **Akcent jako šest předvoleb (zvoleno).** Všechny jsou čitelné na tmavém pozadí. Volný výběr barvy dovolí zvolit barvu, která na pozadí není vidět.

## Design

### 1. Ikony (`js/icons.js`, všechna UI)

- `ICON_PATHS`: prostá data `{ jméno: "SVG path…" }` ve čtvercovém viewBoxu 24, `stroke: currentColor`, bez výplně, zaoblené konce. `icon(name)` vrátí `<svg aria-hidden="true">`. `iconButton(name, { label, ... })` vrátí `<button type="button" title aria-label>` s ikonou. Neznámé jméno vyhodí chybu hned (ne tiše prázdné tlačítko).
- Sada (kolem 20): play, stop, plus, menu, close, save, load, export, import, trash, rename, check, up, down, prev, next, new, theme, power. Přesný seznam určí grep `textContent: '[`.
- Nahradí se všechna tlačítka s textem v hranatých závorkách a znaky `▶︎`, `■`, `×`, `+`/`−` zůstávají u nudge (jsou to číselné ovládání, ne ikony akcí).
- **Zůstává text:** jména (`.name-btn`, `.scene-name`, chipy `#1 název`), popisky řádků a položky v menu (ty mají ikonu i popisek, protože typy modulů nejsou samy o sobě zřejmé).
- Potvrzení „[sure?]“ (smazání scény, new scene): ikona koše se po prvním klepnutí změní na ikonu check v barvě akcentu, `title` „klepni znovu“, po 5 s se vrátí (stejné pravidlo jako dnes).
- Pro zvuk a stav (play/stop) se přepíná ikona, `aria-label` se mění s ní.

### 2. Header a menu (`index.html`, `js/menu.js`, `js/ui.js`, `js/scenes-ui.js`, CSS)

- Header: `brand`, vpravo `+` a hamburger. Nic jiného. `#transport`, `#scenes`, `#adder` přestanou být v headeru.
- `js/menu.js`: `createMenu({ button, items })`, kde `item = { icon, label, onSelect, disabled?, hidden? }`. Rozbalovací panel pod headerem (na ≤ 480 px přes celou šířku). Zavře se klepnutím mimo, `Escape`, výběrem položky. Vždy jen jedno menu otevřené. `aria-haspopup`, `aria-expanded`, po zavření se fokus vrací na tlačítko. Položky mají dotykovou plochu aspoň 44 px.
- **Menu `+`:** melodic, rhythmic, drone, efekty (bitcrusher jen když `engine.hasWorklet()`), sequence (jen když ještě neexistuje), import module. Seznam položek je čistá funkce `addMenuItems({ hasWorklet, hasSequence, fxTypes })`, aby šla testovat.
- **Hamburger:** new scene, load, save, theme. Save a load otevřou stávající panel pod headerem (řádek „save as“, seznam scén), jen s ikonami.
- **New scene:** smaže vše přes stávající `sceneUi.clear()` a vrátí globální tempo na výchozí (off, 120). Když už je scéna prázdná, nic se neptá. Jinak potvrzení druhým klepnutím na položku (popisek „sure?“, 5 s).
- **Zprávy** (`say` ze scén a importu) přestanou být v headeru. Jeden `#status` prvek (`aria-live="polite"`), zobrazený jako lišta těsně nad transport barem, mizí po 5 s. Používají ho scény i import.

### 3. Globální BPM (`js/timing.js`, `js/module.js`, `js/engine.js`, `js/scene.js`)

- Stav v enginu: `engine.tempo = { on: false, bpm: 120 }`, rozsah 20–300 (stejný jako modul). Čistá funkce `effectiveBpm(ownBpm, tempo)` v `timing.js`: `tempo.on ? tempo.bpm : ownBpm`, při neplatné hodnotě vrací `ownBpm`.
- Engine před každým `tick` nastaví modulu efektivní tempo. Modul ho používá na **obou** místech, kde dnes čte `params.bpm`: `advance(...)` a délku noty (`stepDuration(...)` v `onStep`). Drone ho ignoruje.
- Přepnutí za běhu: `track.nextTime` se sčítá po krocích, takže tempo se změní plynule od dalšího kroku, bez skoku a bez restartu modulu.
- **Scéna:** nové volitelné pole `tempo: { on, bpm }` v `serializeScene`, v `applyScene` se hodnoty ořežou do rozsahu. Chybějící pole (starší scény a soubory) = off, 120. Modulový soubor (export jednoho modulu) tempo neobsahuje.
- **Slider BPM v modulu** (karta i detail) zůstává použitelný, ale při zapnutém globálním je ztlumený (`opacity`, `title` „global BPM is on“). Hodnota v něm zůstává vlastní hodnota modulu.

### 4. Transport bar (`index.html`, `js/ui.js`, `css/style.css`)

- `position: fixed; bottom: 0`, nad detailem modulu (detail dostane dolní odsazení, aby nic nezmizelo za lištou). `padding-bottom: env(safe-area-inset-bottom)`, v `index.html` `viewport-fit=cover`. Hlavní obsah má dolní odsazení o výšku lišty.
- Obsah zleva: **play/stop** (ikona, stav jako dnes přes `showsPlay()`), **přepínač global BPM** (ikona power/„BPM“, `aria-pressed`), **slider BPM** (`createSlider`, 20–300, krok 1, s nudge −/+) a číselná hodnota. Při vypnutém globálním je slider ztlumený, ale stále nastavitelný (hodnota se uloží).
- Musí se vejít do 320 px bez vodorovného scrollu a s dotykovými plochami aspoň 44 px. Pokud se vše na jeden řádek nevejde, lišta se zalomí na dva řádky (play + přepínač + hodnota, pod nimi slider). Rozhodne stavitel podle měření.
- **Mezerník (desktop):** posluchač na `document`. Čistá funkce `shouldHandleSpace(event)`: klávesa `Space`, bez modifikátorů, bez `repeat`, cíl není `input`, `textarea`, `select`, `button`, `[role=slider]` ani `[contenteditable]`. Při zpracování `preventDefault()` (stránka se nescrolluje) a stejné chování jako klepnutí na play/stop, včetně `engine.resume()`.

### 5. Theme (`js/theme.js`, `css/style.css`, `js/main.js`)

- `ACCENTS`: šest předvoleb se jménem a odstínem (cyan 188, zelená 135, jantar 40, magenta 320, fialová 265, červená 5), stejná sytost a světlost, aby byla čitelnost stejná.
- Čistá funkce `deriveTheme(hue)` vrátí všechny proměnné, které jsou dnes cyan: `--accent`, `--fg`, `--dim`, `--line`, `--glow`, `--panel`, `--panel-hi`, `--bg`. Odvozují se z HSL jediného odstínu. Výchozí cyan se musí co nejvíc shodovat s dnešním vzhledem.
- CSS: natvrdo napsané `rgba(94, 238, 255, …)` (přechod baru, záře) se nahradí `color-mix(in srgb, var(--accent) N%, transparent)`. Po změně nesmí v CSS zůstat žádná cyan hodnota kromě `:root` jako výchozí (hlídá test nad `style.css`).
- Použití: nastaví se na `document.documentElement.style` a `meta[name=theme-color]` dostane barvu pozadí. Volba se pamatuje v `localStorage` (`pulsar.accent`, vše v `try/catch`, bez uložení se použije cyan). Aplikuje se na začátku `main.js`, před `mountUi`. Případné bliknutí prvního snímku se toleruje.
- UI: položka „theme“ v hamburgeru rozbalí řadu šesti kulatých vzorků (44 px, `aria-pressed`), klepnutí barvu hned změní. Menu se nezavře, aby šlo barvy zkoušet.
- Statický `manifest.webmanifest` a ikona aplikace se nemění (nelze za běhu).

## Co je na staviteli

- Přesný seznam ikon a podoba jejich cest. Přesné barvy odvozené z odstínu, hlavně aby výchozí cyan vypadal jako dnes.
- Jestli se lišta vejde do 320 px na jeden řádek, nebo se zalomí.
- Pořadí práce a velikost commitů. Doporučení: 1) ikony, menu, header, status, 2) tempo (engine, scéna, lišta, mezerník), 3) theme. Service worker se zvedne na `pulsar-v19` a přibudou `icons.js`, `menu.js`, `theme.js`.

## Ověření

- `node --test`: nové čisté funkce (`effectiveBpm`, `tempo` ve scéně včetně chybějícího a neplatného pole, efektivní tempo v `tick` se záznamovými stuby v obou místech, `shouldHandleSpace`, tabulka `ICON_PATHS`, `addMenuItems`, `deriveTheme` a `ACCENTS`, test, že v CSS není cyan mimo `:root`) a celá dosavadní sada zůstane zelená.
- Chrome při 320 px a při desktopové šířce: header má jen tři prvky, obě menu se otevřou a zavřou (mimo, Escape, výběr), `+` přidá všechny typy, new scene žádá potvrzení, transport bar je dole a nic nezakrývá (ani v otevřeném detailu), globální BPM zapnuté/vypnuté mění tempo (měřeno rozestupy kroků), mezerník hraje a stopuje a v textovém poli nepřepíná, akcent se změní všude a přežije reload, žádné tlačítko nemá holý text v závorkách.
- Nelze ověřit: reálný dotyk a safe-area na iPhonu, zvuk z reproduktoru.
