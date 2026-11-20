# Sekvence (aranžmá po částech) a import/export modulů – návrh (krok 5 z 5)

Datum: 2026-11-20. Navazuje na `instructions.md` („další vrstva: modul typ sekvence – obsahuje moduly – určeno pro aranžmá skladby“, „ukládání (import/export) jednotlivých modulů“) a na kroky 1–4.

## Pořadí kroků
1. Skořápka, 2. Ovládací prvky, 3. Efekty, 4. Dva oscilátory – hotovo.
5. **Sekvence a import/export modulů** (tento dokument).

## Záměr
Moduly dnes hrají všechny najednou, dokud je uživatel ručně nevypne. Sekvence umožní složit z nich skladbu: řadu částí (intro, sloka, …), v každé zní jiná skupina modulů a trvá určitou dobu; sekvence části sama přehraje za sebou. Samostatně si půjde uložit jednotlivý modul do souboru a přidat ho zpět nebo do jiné scény.

## Cíle
### Sekvence
- **Jedna sekvence** v aplikaci, karta v sekci **sequence úplně dole** (pod efekty a moduly); přidá se přes `[+]` → `[sequence]` (po přidání se tlačítko v menu nenabízí).
- Sekvence je **řada částí**. Část má jméno, **délku v sekundách** (celé číslo 1–600) a **seznam modulů, které v ní znějí** (odkazy na existující moduly ze společného seznamu).
- **Přehrávání:** `play` spustí první část; po uplynutí délky přejde na další; na konci buď začne znovu (**loop** zapnutý), nebo skončí. Délka se měří časem audio kontextu (ne `setTimeout`), takže běží i v kartě na pozadí.
- **Přechod do části:** moduly, které sekvence řídí (jsou v aspoň jedné části) a v nové části nejsou, se zastaví; moduly nové části se spustí (`start` zná už dnes plynulý náběh a dozvuk, drone si dohraje zeslabení). Moduly, které nejsou v žádné části, sekvence nechává být.
- **Ruční zásah má přednost do dalšího přechodu:** uživatel může během části modul ručně zapnout nebo vypnout; sekvence stav znovu určí až při nástupu další části.
- **Ovládání:** `play/stop`, přeskok na předchozí a další část, loop; ve sbalené kartě ikona play/stop, jméno, „část 2/4“ a čas do konce části (nebo tenký ukazatel postupu).
- **Detail** (celá obrazovka jako u modulů): seznam částí s jménem (přejmenování), délkou (slider) a tlačítky pro členy (jedno tlačítko na modul, ≥ 44 px, nese `#id jméno`), změna pořadí (nahoru/dolů), smazání části, `[+ part]` a tlačítko **„použít běžící“**, které do části zapíše moduly, které právě hrají (aby se skladba dala skládat hraním, ne klikáním po tlačítkách).
- **Společný play/stop all** funguje i se sekvencí: `stop all` ji pozastaví (čas se nepřičítá), `play all` ji obnoví a znovu uplatní aktuální část.
- **Smazání modulu** ho odebere ze všech částí; smazání poslední sekvence ji odstraní; načtení scény sekvenci zruší a nahradí sekvencí scény (nebo žádnou).
- **Scény** ukládají sekvenci (jméno, loop, části s délkou a členy odkazem na pořadí modulu ve scéně); po načtení je zastavená na části 1 (uživatel stiskne play). Staré scény sekvenci nemají a načtou se jako dřív. Exportované soubory scén ji nesou stejně.

### Import a export jednotlivých modulů
- **`[export]`** v hlavičce detailu modulu (vedle `[remove]`) stáhne `<jméno>.pulsar-module.json`.
- **`[import]`** v menu `[+]` otevře výběr souborů (jeden nebo více `.json`) a přidá z každého nový modul. Hlášení v liště jako u scén: kolik se přidalo, kolik přeskočilo a proč.
- Soubor: `{ "pulsar": "module", "module": { type, name, params, volume, pan, running } }`; přijme se i holý objekt modulu. **Sendy a efekty součástí souboru nejsou**: importovaný modul má sendy prázdné.
- Validace stejnou cestou jako moduly ve scénách (neznámý typ se přeskočí, hodnoty se omezí, nepoužitelné klíče zahodí). Melodický modul si při importu vygeneruje novou melodii (jako po načtení scény).
- Limity jako u scén: soubor ≤ 1 000 000 bajtů, nejvýše 100 modulů na import; celkem nejvýše tolik modulů, kolik připouští scéna (64).

## Non-cíle
- Vnořené moduly nebo více sekvencí; sekvence, která vlastní moduly (varianty 2 z brainstormingu).
- Změna parametrů modulů v části (tempo, hlasitost, ...); plynulé prolínání mezi částmi; časování po taktech; časová osa s kreslením.
- Export a import jednotlivých efektů nebo samotné sekvence mimo scény; import modulů ze souboru scény.
- Přehrávač scén (varianta 3).
- Zvuk (sekvence žádný vlastní nevydává, nemá hlasitost ani pan).

## Anti-cíle
- Sekvence, kterou `stop all` nepozastaví (běží dál přes celkové zastavení), nebo kterou `play all` neobnoví (rozpad stavu mezi `stop all`, `play all` a sekvencí). Ruční spuštění sekvence při zastaveném transportu je dovolené stejně jako u modulů.
- Odkaz na smazaný modul, který shodí aplikaci nebo ponechá sirotka v části; modul uvedený v části dvakrát.
- Načtení scény, které nechá starou sekvenci běžet nebo odkazovat na staré moduly.
- Čas sekvence, který se rozjede se skutečným časem (karta na pozadí, pozastavený kontext).
- Hostilní soubor (obří, nevalidní, tisíce částí, odkazy na neexistující moduly, nečíselné délky, `__proto__`) shodí aplikaci nebo zahltí paměť.

## Přístup (vybral uživatel: varianta 1)
Sekvence je řada částí; každá část vybírá existující moduly ze společného seznamu a trvá zadanou dobu. Zamítnuto: **2** (kontejner vlastnící moduly – zásadně mění strukturu aplikace, scén a efektů) a **3** (přehrávač scén – načtení scény všechno smaže a znovu postaví, takže by byly mezery a restart evoluce modulů).

## Rozhodnutí
Uživatelova: sekvence jako řada částí (1); návrh importu a exportu modulů (včetně vynechání sendů při importu).

Autorova (ke kontrole):
- **Jen jedna sekvence**, přidává se přes `[+]` a v menu se pak nenabízí; mazání z detailu (`[remove]`) jako u ostatních karet.
- **Sekvence řídí jen členy částí**: modul, který není v žádné části, se jí netýká.
- **Po skončení bez loopu** sekvence skončí a moduly nechá tak, jak jsou po poslední části (nic dalšího nezastavuje).
- **`stop` sekvence** zastaví jen postup (moduly zůstanou, jak jsou); **`play`** po stopu začne od začátku aktuální části. `stop all` ji naproti tomu jen pozastaví a `play all` pokračuje tam, kde přestala.
- **Meze:** nejvýše 32 částí, délka 1–600 s (celé), jména nejvýše 24 znaků (`NAME_MAX`), v části každý modul nejvýše jednou; neexistující odkazy se při načtení a importu zahodí.
- **Jméno sekvence i částí** je přejmenovatelné stejně jako jména modulů (v detailu); výchozí `sequence`, `part 1`, `part 2`, …
- **Časování** podle `ctx.currentTime` a posouvané stávajícími hodinami enginu (worker hodin), ne `setTimeout`; přesnost na desetiny sekundy stačí.
- **Registrace v transportu:** sekvence má rozhraní `{ id, running, start(), stop() }`, takže ji `stop all` a `play all` zpracují stejnou cestou jako moduly.
- **UI:** karta sekvence má třídu jako ostatní karty (sbalená/detail), ikonu play/stop, jméno, „část N/M · m:ss“ a ukazatel postupu; v detailu délka části je HUD slider s logaritmickým mapováním a zobrazením `m:ss`; nové texty a tlačítka mají dotykovou plochu ≥ 44 px a vejdou se do 320 px.
- **Soubor modulu** používá stejné pomocné funkce jako soubory scén (`exportFilename`, validace modulu); přípona `.pulsar-module.json`; jména kolizí se neřeší (jména modulů nemusí být jedinečná).
- Service worker: nová verze cache (`pulsar-v16`), nové soubory do `FILES`.

## Doplněno po kontrole návrhu (autorova rozhodnutí)

- **Jedno rozhraní start/stop = pauza a pokračování.** Sekvence má `running`, `start()` a `stop()`, kde `stop()` jen zmrazí postup (zachová pozici a uplynulý čas) a `start()` pokračuje. Tlačítko **stop** v kartě je navíc `stop()` a vynulování uplynulého času aktuální části (aktuální část zůstane), takže další `play` začne od začátku té části. `stop all` volá jen `stop()` (pauza), `play all` jen `start()` (pokračování). Ruční `play/stop` v kartě značí sekvenci v transportu za „ručně ovládanou“ stejně jako moduly (`transport.manual`).
- **`play all` bez čehokoli běžícího** spustí jako dosud všechno registrované, tedy i sekvenci od začátku aktuální části.
- **Kdy se členství v části uplatní:** při nástupu části (přechod, `start()` z nulového času, přeskok za běhu). Čisté pokračování po pauze (uplynulý čas > 0) členství znovu **neuplatňuje**, jen pokračuje časem; moduly, které `stop all` zastavil, vrací transport. Ručně vypnutý modul tedy sekvence při pokračování nepřebíjí, při nástupu další části ano.
- **Přechod do části:** člen nové části, který už běží, se nechá být (`start()` se nevolá, aby se nerestartoval náběh); člen nové části, který neběží (třeba byl vypnut ručně), se spustí; řízený modul, který v nové části není a běží, se zastaví; modul mimo všechny části se nedotkne.
- **Po přirozeném konci bez loopu** sekvence skončí (`running` nepravda), vrátí se na část 1 s nulovým časem a moduly nechá tak, jak byly po poslední části. Po ručním stopu zůstává aktuální část. Ve stopu karta ukazuje „část N/M“ a celou délku části, za běhu zbývající čas.
- **Přeskok předchozí a další:** ve stopu nebo za pauzy jen posune aktuální část (čas 0, moduly beze změny); za běhu skočí na část, nuluje její čas a uplatní členství. Za poslední částí při loopu přejde na první, bez loopu zůstane na poslední; před první při loopu přejde na poslední, bez loopu zůstane na první.
- **„Použít běžící“** nahradí členy části všemi moduly, které právě běží (včetně těch, které sekvence sama spustila); prázdný výsledek je dovolený a znamená tichou část.
- **Hodiny enginu** běží, kdykoli existuje modul **nebo** sekvence, a ne, když neexistuje nic. Postup sekvence se počítá z rozdílu `ctx.currentTime`, takže při pozastaveném kontextu se zastaví (žádný posun), po obnovení pokračuje.
- **Scény:** klíč `sequence` v objektu scény je volitelný, `version` zůstává 1; starší sestavení ho při čtení tiše ignoruje. Členy odkazuje pořadí modulu v poli `modules` scény; `validateScene` při zahození neplatného modulu přepočítá odkazy (jako u efektů) a odkazy na zahozené moduly odstraní, `applyScene` při přeskočeném modulu odkaz také odstraní. Limit modulů u importu počítá jen moduly (sekvence se nepočítá).
- **`[+ part]`:** nová část kopíruje délku předchozí (první má 30 s), členy prázdné, jméno `part N`; při 32 částech je tlačítko zakázané. Délka v detailu je logaritmický slider 1–600 s s krokem 1 s a zobrazením `m:ss`.

## Omezení a ověření
- Vanilla JS/CSS, žádné závislosti; cesty relativní; relativně ke stávajícím vzorům (testovatelné čisté moduly + tenká DOM vrstva).
- Node testy: čistá logika sekvence (postup času podle vloženého „teď“, přechody částí, loop, konec, pozastavení a obnovení, přeskok, odebrání modulu, meze a neplatné vstupy), validace sekvence ve scéně a souboru (hostilní vstupy), round trip scény se sekvencí, soubor modulu (export, import, hostilní vstupy, limity, sendy vynechané), `[+]` bez nabídky druhé sekvence.
- Chrome: sestavení sekvence z běžících modulů, přehrání části, přechod mezi částmi a loop (zrychleně přes krátké délky), `stop all` a `play all`, smazání modulu, načtení scény, uložení a načtení scény se sekvencí, export a import modulu (skutečné stažení nelze ověřit, jen vytvoření souboru v paměti jako u scén), 320 px bez přetékání, dotykové plochy ≥ 44 px, konzole bez chyb. **Skutečný zvuk a skutečné stahování souboru ověřit nelze.**

## Ponecháno tvůrci
Rozdělení do souborů a funkcí, přesný tvar karty a řádků částí, texty hlášek, přesné mapování slideru délky, způsob napojení na hodiny enginu, pojmenování klíčů ve scéně (musí být zpětně kompatibilní a bez zvýšení `version`).
