# Další efekty (EQ, bitcrusher, stereo charakter) – implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Přidat send efekty equalizer a bitcrusher, dát delayi ping-pong a reverbu šířku a mít seznam efektů na jednom místě.

**Architecture:** Registr efektů v `js/fx.js` (typy, výchozí hodnoty, rozsahy, továrna `createEffect`) je jediný zdroj pravdy pro `sends.js`, `scene.js` a menu v `ui.js`. Popisy ovladačů (UI) jsou v čistém `js/fx-fields.js`. Bitcrusher má čistou logiku v `js/crush.js`, `AudioWorklet` v `js/bitcrusher.worklet.js` a načítání ve `js/worklet.js`; engine nabízí `ready` a `hasWorklet()`.

**Tech Stack:** Vanilla JS, Web Audio (`BiquadFilterNode`, `ChannelSplitter/Merger`, `AudioWorklet`), `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-20-effects-eq-crusher-design.md`

## Global Constraints

- Efekty zůstávají send: až 3 sendy na modul, bypass (`enabled`, `setEnabled`) a mazání jako dnes; změny parametrů jen plynule (`setTargetAtTime`), `.value` se po vytvoření uzlu nezapisuje.
- Typy a parametry (rozsah; krok; výchozí):
  - `delay` (dnešní `time`, `feedback`, `tone`, `return`) + `pingpong` 0–1; 0,05; 0
  - `reverb` (dnešní `decay`, `damping`, `return`) + `width` 0–1; 0,05; 1
  - `eq`: `low`, `mid`, `high` −12–12 dB; 0,5; 0 · `midFreq` 200–5000 Hz; 10; 1000 (log slider) · `return` 0–1; 0,05; 0,5
  - `bitcrusher`: `bits` 1–16; 1; 8 · `rate` 1–32; 1; 4 (drží každý N-tý vzorek, 1 = beze změny) · `return` 0–1; 0,05; 0,5
- `pingpong` 0 a `width` 1 znějí jako dnes; scéna bez nových parametrů se načte s těmito hodnotami; `version` scény zůstává 1.
- Zpětná vazba delaye zůstává stabilní při `pingpong` 1 a `feedback` 0,9 (celkové zesílení smyčky včetně křížové větve pod 1); `tailMs` konečný a ≤ 20000.
- Worklet: `js/bitcrusher.worklet.js`, načtený při vytvoření enginu přes `ctx.audioWorklet.addModule`; `engine.ready` se vždy splní, `engine.hasWorklet()` říká výsledek; bez workletu `addEffect('bitcrusher')` vyhodí výjimku, `[+]` bitcrusher nenabídne a načtení scény ho přeskočí a nahlásí (existující cesta v `applyScene`). `addEffect` v UI a načtení scény počkají na `engine.ready`; `applyScene` zůstává synchronní.
- Efekty ve stereu: EQ a bitcrusher zachovávají kanály L/R (každý kanál zvlášť).
- Cache SW `pulsar-v14`, nové soubory do `FILES`; relativní cesty.
- Testy: `npm test`; UI v Chrome (po změně souborů smazat service worker, cache a vynutit znovunačtení souborů). Zvuk ověřit nelze.

## Review Focus

- Bez workletu (`addModule` odmítne, 404, prohlížeč bez `AudioWorklet`): aplikace běží, `ready` se splní, ostatní efekty fungují, bitcrusher není k dispozici, scéna s bitcrusherem načte zbytek a nahlásí přeskočení, žádná neošetřená výjimka.
- Scéna uložená před krokem 3 (delay a reverb bez `pingpong` a `width`) se načte a zní jako dřív.
- Ping-pong a šířka na krajích: `pingpong` 1 s `feedback` 0,9 je stabilní, `width` 0 a 1, `tailMs` ≤ 20000, žádný zápis `.value` po vytvoření.
- Bypass, smazání a `dispose`/`disconnect` nových efektů: `return` jde na 0, odpojí se všechny uzly včetně workletového, nic nevisí po smazání.
- Krajní a nepoužitelné hodnoty: EQ ±12 dB a `midFreq` na koncích, `bits` 1 a 16, `rate` 1 a 32, `NaN`, text a obří čísla přes `setParam`, scénu i soubor.

---

### Task 1: Registr efektů

**Files:**
- Create: `js/fx-fields.js`
- Modify: `js/fx.js`, `js/sends.js`, `js/scene.js`, `js/ui.js`
- Test: `tests/fx.test.js`, `tests/fx-fields.test.js`

**Interfaces:**
- Produces:
  - z `js/fx.js`: `FX_TYPES: string[]` (zatím `['delay', 'reverb']`), `FX_DEFAULTS`, `FX_RANGES` (dnešní `RANGES`, nově exportované), `createEffect(ctx, type, params) → effect`; neznámý typ vyhodí `Error('unknown effect: <type>')`.
  - z `js/fx-fields.js`: `FX_FIELDS: { [type]: Array<{ key, min, max, step, scale?, format }> }` (dnešní tabulka z `ui.js` včetně formátů) a `FX_LABELS: { [type]: string }` (text tlačítka v menu, např. `reverb`).
- `sends.js` volá `createEffect`; `scene.js` bere typy z `FX_TYPES`; menu `[+]` v `ui.js` vytváří tlačítka efektů ze `FX_TYPES` a `FX_LABELS`.

- [ ] **Step 1: Write the failing tests**

`tests/fx.test.js`: `FX_TYPES` deep-equals `['delay','reverb']`; pro každý typ platí, že `FX_DEFAULTS[type]` a `FX_RANGES[type]` mají stejné klíče, výchozí hodnota leží v rozsahu a `createEffect(stubCtx(), type)` vrátí objekt s `type`, `enabled === true`, `setParam`, `setEnabled`, `tailMs`, `dispose`, `disconnect`; `createEffect(ctx, 'chorus')` vyhodí. `tests/fx-fields.test.js`: pro každý typ z `FX_TYPES` pokrývají `FX_FIELDS[type]` právě klíče `FX_DEFAULTS[type]`, `min`/`max`/`step` pole sedí s `FX_RANGES` a `format(default)` vrací neprázdný text; `FX_LABELS[type]` je neprázdný řetězec.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test 2>&1 | grep -E "^# (pass|fail)|^not ok"`
Expected: nové testy FAIL (chybějící exporty a modul).

- [ ] **Step 3: Implement the registry and rewire the consumers**

Čisté přesunutí a odvození: tabulka `FX_FIELDS` z `ui.js` do `js/fx-fields.js` (UI ji importuje); `sends.js` místo `MAKERS` volá `createEffect`; `scene.js` místo vlastního `FX_TYPES` importuje ten z `fx.js`; menu v `ui.js` se staví ze `FX_TYPES` a `FX_LABELS`. Chování se nemění.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: všechno PASS (původní testy beze změny).

- [ ] **Step 5: Verify in Chrome**

Smaž service worker a cache, vynuť znovunačtení; přidej reverb a delay přes `[+]`. Expected: menu nabízí `[reverb]` a `[delay]` (a nic jiného), karty a slidery vypadají a fungují jako dřív, konzole bez chyb.

- [ ] **Step 6: Commit**

```bash
git add js tests
git commit -m "refactor: one effect registry drives senders, scenes and the add menu

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Ping-pong delaye a šířka reverbu

**Files:**
- Modify: `js/fx.js`, `js/fx-fields.js`, `tests/helpers/stub-ctx.js`
- Test: `tests/fx.test.js`, `tests/fx-fields.test.js`, `tests/scene.test.js`

**Interfaces:**
- Consumes: Task 1 – registr (`FX_DEFAULTS`, `FX_RANGES`, `FX_FIELDS`).
- Produces: `delay` má parametr `pingpong`, `reverb` parametr `width` (viz Global Constraints); z `js/fx.js` navíc čistá `delayLoopGain({ feedback, pingpong }) → number`, nejhorší zesílení zpětnovazební smyčky (bez rezonance filtru `tone`, která je pokrytá dnešním testem); stub kontextu má `createChannelSplitter(n)` a `createChannelMerger(n)` (uzly s `kind`, záznamem spojení a `disconnect`) a `gain` parametr u `createBiquadFilter`.

- [ ] **Step 1: Write the failing tests**

- `clampFxParam('delay','pingpong', 5) === 1`, `(…, -1) === 0`, text/`NaN` → `null`; totéž pro `reverb` `width`. Výchozí `pingpong` 0 a `width` 1; `accept` bez nových klíčů doplní výchozí.
- Všechny dnešní testy delaye a reverbu projdou beze změny (zapojení a chování při výchozích hodnotách se nemění).
- `delayLoopGain` je < 1 pro každou kombinaci `feedback` ∈ {0, 0.5, 0.9} a `pingpong` ∈ {0, 0.5, 1}; roste s `feedback`.
- `setParam('pingpong', 1)` a zpět plynule mění jen `AudioParam` hodnoty přes `setTargetAtTime` (žádné nové volání `value` po vytvoření); `tailMs()` při `pingpong` 1 a `feedback` 0,9 je konečné a ≤ 20000.
- `setParam('width', 0)` a `1` plynule změní zesílení postranní složky (aspoň jeden gain uzel dostane `target` 0, potom 1); při `width` 1 má efekt stejné spojení jako dnes.
- `FX_FIELDS` pokrývají nové klíče (test z Tasku 1 projde); scéna: `validateScene` zachová `pingpong`/`width` a ořízne mimo rozsah; efekt bez nich dostane výchozí hodnoty.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test 2>&1 | grep -E "^# (pass|fail)|^not ok"`
Expected: nové testy FAIL.

- [ ] **Step 3: Implement**

Rozšiř registr o nové klíče, výchozí hodnoty a rozsahy; do `createDelay` ping-pong (rozdělení kanálů a křížová zpětná vazba; při 0 zvuk jako dnes) a do `createReverb` šířku (např. rozklad na střed a boky se zesílením boků); pole do `FX_FIELDS` (`pingpong`: `format` v procentech, `width`: procenta). Topologii zvolí tvůrce v mezích Global Constraints.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: všechno PASS.

- [ ] **Step 5: Verify in Chrome**

Reverb a delay: nové slidery `width` a `pingpong` se zobrazí, jdou tahat i klávesami, hodnoty se uloží do scény (`localStorage` po `[save]`) a po načtení se obnoví; scéna uložená bez nich (ručně odeber klíče v `localStorage`) se načte s `pingpong` 0 a `width` 1; konzole bez chyb.

- [ ] **Step 6: Commit**

```bash
git add js tests
git commit -m "feat: ping-pong delay and reverb width

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Equalizer

**Files:**
- Modify: `js/fx.js`, `js/fx-fields.js`
- Test: `tests/fx.test.js`, `tests/fx-fields.test.js`, `tests/scene.test.js`, `tests/sends.test.js`

**Interfaces:**
- Consumes: Task 1 – registr; Task 2 – stub s `gain` u biquadu.
- Produces: typ `eq` v registru (`FX_TYPES` obsahuje `'eq'`), `createEq(ctx, params)`; `FX_LABELS.eq === 'eq'`; pole `FX_FIELDS.eq`: `low`, `mid`, `high` (`format` jako „+3 dB“ / „−6 dB“ / „0 dB“), `midFreq` (`scale: 'log'`, „1000 Hz“), `return` (procenta).

- [ ] **Step 1: Write the failing tests**

- Výchozí hodnoty z Global Constraints; `clampFxParam('eq','low', 99) === 12`, `(…, -99) === -12`, `midFreq` 5 → 200 a 99999 → 5000, text a `NaN` → `null`.
- Graf: vstup → nízká polička (`lowshelf`) → střed (`peaking`) → vysoká polička (`highshelf`) → `return`; typy filtrů a pořadí jsou zaznamenané na stubu; `enabled` výchozí `true`.
- `setParam('low', 6)`, `('mid', -3)`, `('high', 12)`, `('midFreq', 2000)` volají `setTargetAtTime` na příslušný `gain` nebo `frequency` (žádné `.value` po vytvoření); `setParam('return', 0.2)` při vypnutém efektu se uloží, ale neodtlumí (jako dnes u ostatních).
- `setEnabled(false)` ztlumí `return` na 0 a `true` jej vrátí; `tailMs()` je krátké a konečné (≤ 500); `dispose` ramp `return` na 0, `disconnect` odpojí všechny uzly (jako test z kroku efektů).
- `sends.addEffect('eq')` vrátí efekt s `id` a jménem `eq` a připojí výstup k masteru; `scene`: round trip efektu `eq` (parametry a `enabled`) a validace oseká `low: 99`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test 2>&1 | grep -E "^# (pass|fail)|^not ok"`
Expected: nové testy FAIL.

- [ ] **Step 3: Implement `createEq` and register it**

Tři `BiquadFilterNode`: nízká polička přibližně na 200 Hz, vysoká přibližně na 4000 Hz, střed s `Q` 1 na `midFreq`; zesílení v dB; `return` gain jako u ostatních. Přidej do `FX_TYPES`, `FX_DEFAULTS`, `FX_RANGES`, `createEffect`, `FX_FIELDS`, `FX_LABELS`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: všechno PASS.

- [ ] **Step 5: Verify in Chrome**

`[+]` nabízí `[eq]`; přidej ho, otevři detail: slidery `low`, `mid`, `high` (±dB), `midFreq` (logaritmický, klávesy fungují), `return`; bypass checkbox funguje; ulož a načti scénu s EQ (hodnoty se obnoví); smaž EQ z detailu; konzole bez chyb. Zvuk nelze ověřit.

- [ ] **Step 6: Commit**

```bash
git add js tests
git commit -m "feat: three-band equalizer send effect

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Bitcrusher a worklet

**Files:**
- Create: `js/crush.js`, `js/bitcrusher.worklet.js`, `js/worklet.js`
- Modify: `js/fx.js`, `js/fx-fields.js`, `js/engine.js`, `js/ui.js`, `js/scenes-ui.js`
- Test: `tests/crush.test.js`, `tests/fx.test.js`, `tests/sends.test.js`, `tests/scene-apply.test.js`, `tests/scene.test.js`

**Interfaces:**
- Consumes: Task 1 – registr; Task 3 – vzor efektu s bypassem.
- Produces:
  - `js/crush.js`: čistá `quantize(sample, bits) → number` (zaokrouhlení na `2^bits` úrovní, výsledek v `[-1, 1]`) a `createCrusher({ bits, rate }) → { process(sample) → number, set({ bits, rate }) }` s vlastním stavem držení vzorku (jedna instance na kanál).
  - `js/worklet.js`: `loadWorklet(ctx, url = 'js/bitcrusher.worklet.js') → Promise<boolean>` (nikdy neodmítne; `false` při chybě nebo chybějícím `ctx.audioWorklet`), `hasWorklet(ctx) → boolean`.
  - `js/bitcrusher.worklet.js`: procesor `pulsar-bitcrusher` s `AudioParam` `bits` a `rate`, zpracuje každý kanál zvlášť pomocí logiky z `crush.js` (nebo její kopie s testem shody).
  - `createBitcrusher(ctx, params)` v `js/fx.js` (vyhodí, pokud `!hasWorklet(ctx)`); typ `bitcrusher` v registru, `FX_LABELS.bitcrusher === 'crusher'`, `FX_FIELDS.bitcrusher`: `bits` („8 bit“), `rate` („÷4“), `return`.
  - Engine: `engine.ready` (Promise, vždy se splní, vyřeší se po `loadWorklet`), `engine.hasWorklet()`.
  - UI: `addEffect` v `ui.js` a `doLoad` v `scenes-ui.js` čekají na `engine.ready`; menu `[+]` nenabídne `[crusher]`, když `engine.hasWorklet()` je nepravda.

- [ ] **Step 1: Write the failing tests**

- `tests/crush.test.js`: `quantize(0.3, 1)` je jedna ze dvou úrovní; `quantize(x, 16)` se od `x` liší nejvýš o `1/2^15`; hodnoty mimo `[-1, 1]` a `NaN` dají konečné číslo v `[-1, 1]`; `bits` 1 dává nejvýš 2 různé výstupy na rozsahu vstupů; `createCrusher({bits:16,rate:1})` je skoro průchozí; `rate` 4 drží každý čtvrtý vzorek (výstup je po čtveřicích konstantní); `set` mění chování; dva kanály s vlastními instancemi se neovlivňují.
- `tests/fx.test.js`: s `globalThis.AudioWorkletNode` nahrazeným testovací třídou (zaznamená volby a nabídne `parameters` s `bits` a `rate`) a kontextem označeným jako s workletem: `createBitcrusher` vytvoří uzel, připojí vstup → uzel → `return`, `setParam('bits', 4)` volá `setTargetAtTime` na parametr `bits`, `clampFxParam('bitcrusher','bits', 99) === 16`, `('rate', 0) === 1`; `setEnabled(false)` ztlumí `return`; `tailMs()` krátké; `disconnect` odpojí i workletový uzel. Bez workletu `createEffect(ctx, 'bitcrusher')` vyhodí; ostatní typy fungují.
- `tests/sends.test.js`: `routing.addEffect('bitcrusher')` bez workletu vyhodí a nezanechá efekt v `routing.effects`.
- `tests/scene.test.js` a `tests/scene-apply.test.js`: `validateScene` přijme typ `bitcrusher` a oseká `bits: 99`; `applyScene` s bitcrusherem, jehož `addEffect` vyhodí, přeskočí jen tento efekt, ostatní vytvoří a nahlásí `effect N (bitcrusher)`.
- `loadWorklet` s kontextem bez `audioWorklet` → `false`; s `audioWorklet.addModule` odmítnutým → `false`; s úspěšným → `true` a `hasWorklet(ctx)` pravda.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test 2>&1 | grep -E "^# (pass|fail)|^not ok"`
Expected: nové testy FAIL (chybějící moduly a exporty).

- [ ] **Step 3: Implement**

`js/crush.js` a `js/worklet.js` podle Interfaces; `js/bitcrusher.worklet.js` registruje procesor; `createBitcrusher` a registr; v `createEngine` hned po vytvoření kontextu `ready = loadWorklet(ctx).then(() => {})`, `hasWorklet: () => hasWorklet(ctx)`; `ui.js`: `addEffect` čeká na `engine.ready`, menu přeskočí `bitcrusher`, pokud `!engine.hasWorklet()`; `scenes-ui.js`: `doLoad` čeká na `engine.ready` před `applyScene`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: všechno PASS.

- [ ] **Step 5: Verify in Chrome**

Smaž service worker a cache, vynuť znovunačtení. Expected:
- `[+]` nabízí `[crusher]`; po přidání je v sekci efektů karta `bitcrusher` s `bits`, `rate`, `return`; slidery fungují; bypass a smazání fungují; uložení a načtení scény s bitcrusherem obnoví hodnoty; konzole bez chyb.
- Selhání workletu: dočasně přesuň `js/bitcrusher.worklet.js` mimo repozitář, smaž service worker a cache, vynuť znovunačtení (HTTP cache) a načti stránku. Expected: aplikace běží, `[+]` nenabízí `[crusher]`, ostatní efekty fungují, načtení scény s bitcrusherem načte zbytek a ukáže hlášku o přeskočení, v konzoli žádná neošetřená výjimka (případná zpráva o selhání `addModule` je ošetřená). Pak soubor vrať na místo a ověř `git status` bez rozdílu v tomto souboru.
Zvuk ověřit nelze.

- [ ] **Step 6: Commit**

```bash
git add js tests
git commit -m "feat: bitcrusher send effect on an AudioWorklet

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Service worker a závěrečné ověření

**Files:**
- Modify: `sw.js`

**Interfaces:**
- Consumes: všechny předchozí tasky.
- Produces: `CACHE = 'pulsar-v14'`, nové soubory (`js/fx-fields.js`, `js/crush.js`, `js/worklet.js`, `js/bitcrusher.worklet.js`) v `FILES`.

- [ ] **Step 1: Update `sw.js`**

`CACHE = 'pulsar-v14'`; přidej do `FILES` všechny nové soubory z `js/` (porovnej se `ls js`).

- [ ] **Step 2: Run the Node suite**

Run: `npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: všechno PASS.

- [ ] **Step 3: Verify in Chrome**

Smaž service worker a cache, vynuť znovunačtení; přidej všechny čtyři efekty a tři moduly (melodic, drone, rhythmic) a nasměruj sendy. Expected:
- Všechny čtyři karty efektů, jejich slidery a bypass fungují; `[+]` nabízí `[reverb] [delay] [eq] [crusher]`.
- Round trip: uloženou scénu se všemi efekty a změněnými parametry načti po změně všeho; všechny ovladače ukazují uložené hodnoty.
- Stará scéna: scéna uložená v `localStorage` bez `pingpong` a `width` se načte s 0 a 1.
- 320 px (iframe): detail každého typu efektu bez vodorovného přetékání, ovladače ≥ 44 px, `scrollWidth` ≤ 320.
- Seznam souborů v `sw.js` odpovídá obsahu `js/` (skript porovná výpis `ls js` s `FILES`).
- Konzole bez chyb. Zvuk a skutečný telefon ověřit nelze; napiš to do závěrečné zprávy.

- [ ] **Step 4: Commit**

```bash
git add sw.js
git commit -m "chore: service worker v14 with the new effect files

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
