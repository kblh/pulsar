# Drone modul a globální play/stop – krátký návrh

Datum: 2026-11-19. Navazuje na `2026-11-19-pulsar-design.md`.

## Záměr
Dvě rozšíření Pulsaru: (1) jedno tlačítko pro zastavení/spuštění všech modulů, (2) třetí druh modulu, **drone** – bordunový tón/interval/akord, který se vyvíjí jen plynulým přidáváním a odebíráním dalších tónů.

## Cíle
- Globální `[stop all]` / `[play all]` v hlavičce stránky.
- Drone: základní tón zní stále; přídavné tóny z kandidátního seznamu se postupně přidávají a odebírají.
- Každá změna hlasitosti tónu je vždy rampa (fade), nikdy skok – včetně startu, stopu, odebrání modulu a změny parametrů.
- Drone je nezávislý jako ostatní moduly (vlastní tempo změn, žádná sdílená mřížka).

## Non-cíle / anti-cíle
- Žádný globální BPM ani synchronizace (drone nemá kroky ani `Track`).
- Žádné lupnutí: tvrdé useknutí zvuku nebo skok gainu je selhání, i když drone jinak funguje.
- Drone nemá `drift`/`walk`: báze je pevná, mění se jen výběr přídavných tónů.
- Globální play nesmí rozjet moduly, které uživatel zastavil ručně.

## Globální play/stop
- Ovládá jen stav běhu modulů, nic neodebírá.
- `stop all`: zastaví všechny běžící moduly a zapamatuje si, které to byly. `play all`: spustí jen ty zapamatované (ručně zastavené zůstanou zastavené). Melodické/rytmické moduly po startu dostanou nový `Track` (jako dnes `start()`).
- Drone při stopu plynule ztichne (fade out master gainu dronu), při startu plynule nabíhá.
- Tlačítko ukazuje aktuální stav; když nic neběží, nabízí `[play all]`.

## Drone – parametry
- `wave` (sine, triangle, sawtooth, square), `root` (základní tón, např. C2), pool kandidátních přídavných tónů (stejný způsob zadání jako u melodie: stupnice+tónika+oktávy nebo výčet tónů, přes `buildPitchPool`), `maxExtra` (kolik přídavných tónů smí znít najednou), `rate` 1–10 (jak často se mění), `fade` (délka fade v sekundách).

## Přístup (vybral uživatel: A)
Oscilátory vznikají a zanikají podle potřeby. Přidání tónu vytvoří oscilátor + gain s rampou z 0; odebrání spustí rampu na 0 a po doznění oscilátor zastaví a odpojí (`onended`). O změnách rozhoduje časovač v `tick` (čas příští změny), bez `Track`. Zamítnuto: B (všechny oscilátory stále běží – plýtvání), C (předplánované automace – složité, těžké živé změny).

## Rozhodnutí autora (ke kontrole)
- Čistá logika rozhodování (`pickChange(state, opts, rng)` vracející `{add}` / `{remove}` / `null`) oddělená od zvuku, testovatelná v Node.
- Změna: pokud je zvuk < `maxExtra` a pool má volný tón, přidat; pokud je `maxExtra`, odebrat; mezi tím náhodně; nikdy nepřidat tón, který ještě doznívá, ani odebrat poslední neexistující; báze se nikdy neodebere.
- Interval mezi změnami: `rate` 10 ≈ každé ~3 s, `rate` 1 ≈ každých ~40 s (s náhodným rozptylem ±30 %); přesné ladění na tvůrci.
- Výchozí hodnoty: `wave` sine, `root` C2, pool C moll pentatonika přes 2 oktávy nad C3, `maxExtra` 2, `rate` 3, `fade` 4 s; fade se omezí do rozsahu 0.5–30 s.
- UI panel: textový přehled aktuálně znějících tónů (např. `C2 + G3 + Eb4`) a stav fade; žádná mřížka kroků.
- Hlasitost: každý přídavný tón má menší výsledný gain, aby součet nepřebudil (např. společný gain dronu ~0,25).
- Ponecháno tvůrci: přesná křivka rampy, jemné rozladění (detune) – nepožadováno.
