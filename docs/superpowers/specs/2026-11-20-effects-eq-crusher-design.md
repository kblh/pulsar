# Další efekty: equalizer, bitcrusher, stereo charakter – návrh (krok 3 z 5)

Datum: 2026-11-20. Navazuje na `instructions.md` („Změny 20/11“, „další vylepšení“), na návrh efektů a sendů (`2026-11-19-effects-and-sends-design.md`) a na krok 2 (HUD ovladače).

## Pořadí kroků
1. Skořápka – hotovo. 2. Ovládací prvky – hotovo.
3. **Další efekty** (tento dokument).
4. Kombinace oscilátorů v modulu s nastavitelným poměrem.
5. Modul sekvence a import/export jednotlivých modulů.

## Záměr
K reverbu a delayi přidat **equalizer** a **bitcrusher** a dát existujícím efektům stereo charakter: ozvěny delaye se střídavě přelévají mezi levým a pravým kanálem (ping-pong) a reverb má ovladač šířky. Efekty zůstávají send efekty: modul posílá kopii signálu (až 3 sendy na modul) a efekt ji vrací do mixu.

## Cíle
- **Equalizer** jako send efekt, tři pásma: nízká polička, střed s nastavitelnou frekvencí, vysoká polička. Zesílení −12 až +12 dB.
- **Bitcrusher** jako send efekt: snížení počtu bitů a vzorkovací frekvence (přes `AudioWorklet`).
- **Delay:** nový parametr `pingpong` 0–1; **reverb:** nový parametr `width` 0–1.
- **Stará zvuk a staré scény se nemění:** `pingpong` 0 a `width` 1 znějí jako dnes; scéna bez nových parametrů se načte s těmito hodnotami.
- Každý efekt má **bypass** (checkbox na kartě), karty a ovladače jako dnes (HUD slidery, sbalená karta, detail); `[+]` nabízí `[eq]` a `[crusher]`.
- Seznam efektů je na **jednom místě**: nový efekt se nepřidává zásahem do pěti souborů.

## Non-cíle
- Master EQ, insert efekty na modulu, řazení efektů za sebou (efekt do efektu).
- Spektrum, křivka EQ, sidechain, chorus, stereo widener jako samostatný efekt.
- Pan nebo šířka u každého efektu; změna počtu sendů; změna formátu scény mimo nové typy a parametry efektů.

## Anti-cíle
- Cvakání nebo skoky při změně parametru, bypassu, mazání efektu nebo načtení scény (parametry se mění plynule, jako dnes `setTargetAtTime`).
- Nestabilní zpětná vazba delaye (nárůst hlasitosti) při `pingpong` 1 a `feedback` 0,9.
- Bitcrusher, který shodí aplikaci nebo scény, když prohlížeč `AudioWorklet` neumí nebo se jeho soubor nenačte.
- Stará scéna, která po aktualizaci zní jinak.

## Přístup
- **EQ jako send (vybral uživatel: varianta 1).** Zamítnuto: master EQ a insert na modulu (viz non-cíle). Důsledek, o kterém uživatel ví: EQ upraví jen přimíchanou kopii, suchý signál se nemění, proto zesílení pásma slyšet je, ale **ubrání pásma suchý zvuk neztiší**.
- **Bitcrusher jako send přes `AudioWorklet`** (bity i vzorkovací frekvence). Zamítnuto: `WaveShaper` (jen bity).
- **Stereo charakter existujícím efektům (vybral uživatel: A).** Zamítnuto: nový efekt jen pro šířku (B), nic navíc (C).

## Rozhodnutí
Uživatelova: EQ jako send; bitcrusher přes `AudioWorklet`; ping-pong u delaye a šířka u reverbu; efekty zůstávají send.

Autorova (ke kontrole):
- **Seznam efektů:** v `js/fx.js` je jeden registr typů (`FX_TYPES`, výchozí hodnoty, rozsahy, továrna `createEffect(ctx, type, params)`); `sends.js`, `scene.js` a `ui.js` z něj odvozují, co mají nabízet a validovat; popisy a formáty ovladačů (UI) zůstávají v `ui.js` podle typu.
- **EQ:** typ `eq`, parametry `low`, `mid`, `high` (−12–12 dB, krok 0,5, výchozí 0), `midFreq` (200–5000 Hz, logaritmický slider, krok 10, výchozí 1000), `return` (0–1, výchozí 0,5). Pevné frekvence poliček (nízká přibližně 200 Hz, vysoká přibližně 4000 Hz) a pevné Q středu zvolí tvůrce.
- **Bitcrusher:** typ `bitcrusher`, parametry `bits` (1–16, krok 1, výchozí 8), `rate` (1–32, krok 1, výchozí 4; udržuje každý N-tý vzorek, 1 = beze změny), `return` (0–1, výchozí 0,5). Zobrazení `bits` jako „8 bit“, `rate` jako „÷4“.
- **Delay `pingpong`:** 0–1, krok 0,05, výchozí 0; při 0 zvuk jako dnes. Stabilita: celková zpětnovazební smyčka včetně křížové větve zůstává pod 1 při `feedback` ≤ 0,9 (stejně jako dnes `tone` v smyčce s `Q` −3 dB). `tailMs` zůstává platný.
- **Reverb `width`:** 0–1, krok 0,05, výchozí 1; při 1 zvuk jako dnes, při 0 mono výstup efektu.
- **`AudioWorklet`:** soubor `js/bitcrusher.worklet.js`; engine ho načte hned při vytvoření (`ctx.audioWorklet.addModule`), `engine.ready` je Promise, který se vždy splní (nikdy neodmítne) a `engine.hasWorklet()` říká, zda se načtení povedlo. `addEffect('bitcrusher')` bez worklet vyhodí výjimku (existující cesta v `applyScene` takový efekt přeskočí a nahlásí); `[+]` bitcrusher nenabídne (nebo ho ukáže zakázaný), když `hasWorklet()` je nepravda; `addEffect` v UI a načtení scény počkají na `engine.ready`.
- **Čistá logika bitcrusheru** (zaokrouhlení na bity, držení vzorku) je v samostatném modulu bez DOM, testovaném v Node; worklet ji použije (pokud import ve worklet kontextu v podporovaných prohlížečích nejde, tvůrce zvolí kopii s testem shody).
- **Scény:** nové typy `eq` a `bitcrusher` a nové parametry `pingpong`, `width` projdou `validateScene` přes `clampFxParam`; chybějící parametry se doplní výchozími; `version` zůstává 1; scéna s neznámým typem efektu se zpracuje jako dnes (přeskočí se).
- **Bypass** a mazání efektu fungují pro nové efekty stejně jako dnes (`return` na 0, plynulé odpojení po `tailMs`); EQ a bitcrusher mají krátký `tailMs`.
- Service worker: `pulsar-v14`, nové soubory do `FILES`.

## Omezení a ověření
- Vanilla JS/CSS, žádné závislosti; cesty relativní (GitHub Pages pod `/pulsar/`); `AudioWorklet` vyžaduje zabezpečený kontext (HTTPS nebo `localhost`), což splňuje Pages i lokální server.
- Node testy: registr (každý typ má výchozí hodnoty, rozsahy a továrnu; UI pole pokrývají všechny parametry), `clampFxParam` nových parametrů, čistá logika bitcrusheru (bity, držení vzorku, 1 bit, 16 bitů, `rate` 1, `NaN`), grafy EQ a ping-pong delaye a šířky reverbu na stubu (zapojení, plynulé změny bez `.value` po vytvoření, výchozí hodnoty zachovávají dnešní zapojení nebo chování), scény (nové typy a parametry, stará scéna, neznámý typ), engine bez worklet (`addEffect('bitcrusher')` vyhodí, ostatní efekty fungují).
- Chrome: přidání `[eq]` a `[crusher]`, slidery, bypass, uložení a načtení scény s novými efekty, stará scéna načtená beze změny, bez worklet (simulace odmítnutím `addModule`) aplikace funguje a bitcrusher není k dispozici, konzole bez chyb, 320 px bez přetékání, dotykové plochy ≥ 44 px. **Zvuk (skutečný charakter EQ, bitcrusheru, ping-pongu a šířky, cvakání, stabilita smyčky) ověřit nelze.**

## Ponecháno tvůrci
Topologie ping-pongu a šířky (rozdělení kanálů, M/S), pevné frekvence a Q EQ, plynulé změny `bits` a `rate` ve workletu (AudioParam nebo zprávy), přesné názvy souborů a funkcí, zda registr nese i UI popisy, formáty zobrazení, texty hlášek.
