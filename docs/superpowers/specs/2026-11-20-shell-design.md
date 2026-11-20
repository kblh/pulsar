# Skořápka: layout, sbalené karty, detail, cyan HUD – návrh (krok 1 ze 5)

Datum: 2026-11-20. Navazuje na `instructions.md` (sekce „Změny 20/11“). Je to první ze 5 kroků; každý další krok má vlastní spec a plán.

## Pořadí kroků (dohodnuto)
1. **Skořápka** (tento dokument): hlavní lišta, pořadí sekcí, sbalené karty, detail na celou obrazovku, responzivita od 320 px, nový vzhled (cyan HUD) a animace.
2. Ovládací prvky: vlastní slidery, grafická obálka použitelná na dotyk (včetně DELAY a HOLD), textové inputy jen pro notes a rhythm.
3. Nové efekty: equalizer, bitcrusher, stereo efekty.
4. Kombinace oscilátorů v jednom modulu s nastavitelným poměrem.
5. Modul sekvence (aranžmá skladby) a import/export jednotlivých modulů.

## Záměr
Z terminálového vzhledu a plně rozbalených panelů udělat futuristické HUD rozhraní, které je přehledné i s mnoha moduly a dobře se ovládá z mobilu. Uživatel chce, aby aplikace byla dobře použitelná na dotyk a od 320 px šířky.

## Cíle
- **Hlavní lišta** vždy viditelná (sticky): play/stop all (ikona), `save`, `load`, `[+]`.
- **Pořadí sekcí:** efekty nahoře, pod nimi moduly. Místo pro budoucí modul sekvence (krok 5) úplně dole se teď nevytváří.
- **Všechny karty jsou výchozí sbalené.**
  - Karta efektu: checkbox on/off (bypass) + jméno.
  - Karta modulu: ikona play/stop + jméno + volume slider.
  - Žádné další ovládací prvky ve sbaleném stavu, žádné `[x]` (mazání je v detailu).
- **Detail na celou obrazovku:** klik na kartu (mimo její ovládací prvky) ji rozbalí do detailu se všemi dnešními ovládacími prvky, mřížkou a mazáním. Zavře ho tlačítko zavřít, Esc a na mobilu tlačítko Zpět.
- **Animace** rozbalení a sbalení přes View Transitions; CSS animace pro hover, stisk a stav on/off.
- **Responzivita:** nic nepřetéká vodorovně na 320 px, ovládací prvky v liště a kartách mají dotykovou plochu aspoň 44 px.
- **Vzhled cyan HUD** nahrazuje zeleno-jantarovou terminálovou paletu (rozhodl uživatel). Předloha: screenshot s HUD panely – tmavé pozadí, cyan linky a text, panely s rámečkem, rohové závorky, čárkované spojnice, drobné značky.
- Dnešní chování zvuku se nemění: rozbalení a sbalení karty nic neovlivní, hraje se dál, žádné cvaknutí.

## Non-cíle
- Vlastní slidery a grafická obálka (krok 2); sbalená karta zatím používá nativní range input, jen ostylovaný.
- Nové efekty, mix oscilátorů, modul sekvence, import/export jednotlivých modulů (kroky 3–5).
- Změna chování zvuku mimo bypass efektů, nové zvukové parametry, změna struktury scén mimo pole `enabled`.
- Techno font ze screenshotu: zůstává systémový monospace (vložení fontu do repa kvůli offline PWA se může řešit později, pokud ho uživatel bude chtít).

## Anti-cíle (selhání, i kdyby to „fungovalo“)
- Rozbalení detailu přestaví ovládací prvky a ztratí rozepsaný text nebo přeruší přehrávání.
- Na 320 px se objeví vodorovné posouvání.
- Tlačítko play/stop all zmizí při rolování.
- Stávající uložené scény nebo soubory se po změně nenačtou.
- Animace blokují ovládání nebo ignorují `prefers-reduced-motion`.

## Přístup (vybral uživatel: varianta 1)
**Jeden DOM uzel na modul či efekt, dva stavy** (sbalená karta / detail). Detail je tentýž uzel přepnutý CSS třídou na celou obrazovku; přechod řeší `document.startViewTransition` s `view-transition-name` nastaveným jen na právě animovaný uzel.
- Plus: nic se nestaví znovu, mřížka a playhead se aktualizují dál, rozepsaný text přežije; žádné duplicitní ovládací prvky.
- Zamítnuto: **2** (zvláštní karta a detail stavěný při otevření – ztráta rozepsaného textu, dvě cesty aktualizace); **3** (detail jako stránka s adresou – víc routovacího kódu; tlačítko Zpět se získá i bez něj přes `history.pushState`).

## Rozhodnutí
Uživatelova:
- Pořadí kroků; vzhled nahradit cyan HUD stylem.
- Karta modulu: on/off = play/stop, vyjádřené ikonou. Checkbox on/off je jen u efektů (bypass).

Autorova (ke kontrole):
- **Bypass efektu:** vypnutý efekt ztiší svůj výstup (return gain na 0, plynule přes `setTargetAtTime`); sendy do něj dál tečou, takže po zapnutí se vrací bez cvaknutí. `fx.enabled` je výchozí `true`. Změna parametru `return` při vypnutém efektu stav neodtlumí.
- **Scény:** efekt má volitelné `enabled` (boolean, chybějící = `true`), `version` zůstává 1. `validateScene` pole přijme jen jako boolean, jinak `true`. `serializeScene` ho zapisuje.
- **`[+]`** se přesouvá do hlavní lišty (jinak by při mnoha kartách zmizelo dole). Menu je tlačítko s nabídkou melodic, rhythmic, drone, reverb, delay.
- **Nové karty** se přidávají sbalené. Po načtení scény jsou všechny karty sbalené.
- **Jen jeden detail** je otevřený najednou. Načtení scény nebo smazání otevřeného modulu detail zavře.
- **Zamčení rolování stránky** pod detailem; detail rolují uvnitř sebe.
- **Mřížka karet:** `repeat(auto-fill, minmax(min(100%, 300px), 1fr))`; efekty a moduly mají každé vlastní sekci s nadpisem.
- **Hlavní lišta:** play/stop all je ikona, `save` a `load` zůstávají textové tlačítka (panel scén se otevírá pod lištou jako dnes).
- Service worker: nová verze cache (`pulsar-v12`), nové soubory v `FILES`.
- `prefers-reduced-motion`: bez View Transitions a bez animací.

Doplněno po kontrole návrhu (autorova rozhodnutí):
- **Hlavní lišta** obsahuje přesně: play/stop all, `save`, `load`, `[+]`. Dnes v ní není tempo ani master volume (`transportEl` nese jen tlačítko stop/play all), nic se neodstraňuje. Play/stop all zůstává stavové jako dnes (`showsPlay()`: nabízí play, když nic nehraje nebo byl transport zastaven), jen se zobrazuje ikonou. Tři dnešní kotvy (`transportEl`, `adderEl`, `scenesEl`) se sloučí do jedné lišty, API `mountUi` se tomu přizpůsobí.
- **Detail zakrývá hlavní lištu** (je opravdu na celou obrazovku) a má vlastní hlavičku: jméno (zde se přejmenovává), play/stop modulu, resp. bypass checkbox efektu, smazání a zavřít. Tlačítko play/stop all tedy v detailu není k dispozici; anti-cíl „zmizí při rolování“ se týká rolování stránky se sbalenými kartami.
- **Přejmenování jen v detailu.** Ve sbalené kartě je jméno prostý text a klik na kartu mimo play/stop, bypass a volume otevírá detail. Ovládací prvky karty zastaví šíření kliku.
- **Bypass checkbox** je u efektu ve sbalené kartě i v hlavičce detailu (jedno společné zobrazení stavu `fx.enabled`). Ovládací prvky vypnutého efektu zůstávají aktivní, jen jsou vizuálně ztlumené (nižší průhlednost), aby šlo efekt předladit před zapnutím.
- **Historie:** otevření detailu udělá `history.pushState({detail: id})`. Zavřít tlačítkem nebo Esc volá `history.back()`, pokud je náš záznam nahoře; `popstate` detail zavře. Po obnovení stránky se detail neobnovuje (stav aplikace se po reloadu stejně neobnovuje). Panel scén se do historie nezapisuje a Zpět zavírá jen detail.
- **Panel scén** je součástí normálního toku stránky pod lištou (neklesá s ní jako sticky). Má `max-height` a vlastní rolování, aby se na 320 px vešel.
- **Struktura UI kódu je volná:** UI testy v repu neexistují (testy jsou jen pro engine, efekty, scény, transport a pomocné moduly), takže `panels`, `fxNodes` a aktualizace mřížek se mohou přeskupit.

## Omezení a ověření
- Vanilla JS/CSS, žádné závislosti, žádný build. Cesty relativní (GitHub Pages pod `/pulsar/`).
- Node testy (`node --test`): engine a efekt (`setFxEnabled`: ztlumení, ne `.value`, `return` při vypnutém efektu), scéna (`enabled` v serializaci a validaci, zpětná kompatibilita), dispose vypnutého efektu.
- UI se ověřuje v Chrome na 320 px a na desktopu: bez vodorovného posouvání, hlavní lišta zůstává při rolování, detail se otevře a zavře myší, Esc i Zpět, přehrávání při tom nepřeruší, bypass funguje, uložená scéna se po načtení rozbalí sbalená.

## Ponecháno tvůrci
Přesné barvy a odstíny cyan HUD palety (tokeny v `:root`), kreslení rohových závorek a spojnic (CSS), tvar ikon play/stop (inline SVG nebo CSS), rozdělení `ui.js` na komponentu karty a ovládací prvky (např. `js/card.js`), přesné názvy tříd a CSS animací, jak se zjišťuje a zamyká rolování, hlášky, přístupnost (aria atributy, focus při otevření a zavření detailu).
