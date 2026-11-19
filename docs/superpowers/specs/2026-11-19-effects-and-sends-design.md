# Efekty (reverb, delay) a sendy – krátký návrh

Datum: 2026-11-19. Navazuje na `2026-11-19-pulsar-design.md` a `2026-11-19-drone-and-global-transport-design.md`.

## Záměr
Přidat sdílené efekty (zatím reverb a delay) a každému modulu dát až 3 sendy. Efekty se přidávají přes `[+]` jako instance, takže jich může být víc.

## Cíle
- `[+]` nabízí `[reverb]` a `[delay]` vedle melodic/rhythmic/drone; efekt má vlastní panel s `[x]`.
- Každý modul má 3 sloty `send 1–3`: výběr cíle (`—` nebo konkrétní efekt) a úroveň 0–100 %.
- Jeden efekt může přijímat sendy z libovolně mnoha modulů.
- Efekt vrací jen mokrý signál do masteru; vlastní `return` úroveň.
- Všechny změny (úroveň sendu, parametry, výběr cíle, odebrání) bez lupnutí – rampy, nikdy skok.

## Non-cíle / anti-cíle
- Žádný globální BPM: čas delaye je v ms, bez vazby na tempo modulů.
- Žádné řetězení efektů (efekt neposílá do efektu), žádné pre/post přepínání, žádné presety, žádná modulace parametrů.
- Selhání: lupnutí při změně parametru, nekonečně rostoucí feedback, efekt, který po odebrání dál žere zdroje, send ukazující na smazaný efekt.

## Zapojení
`voices → m.out → volume → pan → master` zůstává. Za panem se odbočí `send gain` (jeden na slot) → vstup efektu. Efekt: `input → zpracování → return gain → master`. Volume a pan modulu tedy ovlivní i množství do efektu.

## Efekty
- **delay:** `DelayNode` se zpětnou vazbou a lowpass filtrem. Parametry: `time` 10–2000 ms, `feedback` 0–0,9 (tvrdý strop), `tone` (cutoff lowpassu), `return` 0–1. Změna `time` přes `setTargetAtTime`.
- **reverb:** `ConvolverNode` s generovanou impulzní odezvou (šum s exponenciálním útlumem). Parametry: `decay` 0,3–10 s, `damping` (tmavost odezvy), `return` 0–1. Změna `decay`/`damping` překreslí odezvu a plynule překříží starý a nový convolver.

## Životní cyklus
- `engine.addEffect(fx)`, `engine.removeEffect(id)`, `engine.setSend(m, slot, {fx, level})`.
- Odebrání efektu: sendy na něj se vynulují (rampa), sloty se přepnou na `—`, efekt po doznění (ozvěna/dozvuk) odpojí uzly. Odebrání modulu odpojí jeho send gainy.
- `[stop all]/[play all]` efekty nevypíná, aby doznívající ocasy neluply; efekty nemají vlastní start/stop.
- UI výběr cíle v slotech se obnoví při přidání/odebrání efektu.

## Přístup (vybral uživatel: A)
Efekty jako instance přes `[+]` s vlastními panely a sloty v modulech. Zamítnuto: B (dva pevné efekty s posuvníky) – 3 sloty by byly zbytečné.

## Rozhodnutí autora (ke kontrole)
- Efekty mají vlastní id (`fx1`, `fx2`…), samostatné od modulů.
- Výchozí hodnoty: delay 350 ms, feedback 0,4, tone 4 kHz, return 0,5; reverb decay 2,5 s, damping střední, return 0,5. Nový send má úroveň 0,3.
- Logika (omezení rozsahů, generování impulzní odezvy) je čistá a testovaná v Node; zapojení uzlů testováno nahrávajícím stub kontextem jako u `mix.js`.
- Service worker cache zvednout (`pulsar-v7`) a přidat nové soubory.

## Ponecháno tvůrci
Přesný algoritmus generování odezvy, ladění výchozích hodnot, vzhled panelu efektu v rámci stávajícího terminálního stylu.
