# Efekty (reverb, delay) a sendy – implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sdílené efekty reverb a delay jako instance přidávané přes `[+]` a 3 sendy u každého modulu.

**Architecture:** Nový `js/fx.js` (čisté clampy a generování impulzní odezvy + továrny `createDelay`/`createReverb` nad Web Audio uzly), nový `js/sends.js` (routing sendů mezi moduly a efekty, testovatelný se stub kontextem), `connectMix` v `js/mix.js` získá odbočku `send(dest)` za panem. `engine.js` jen deleguje, `ui.js` přidává panely efektů a řádky `send 1–3`.

**Tech Stack:** Vanilla JS (ES moduly), Web Audio API, `node --test` se stub kontexty (styl `tests/mix.test.js`).

**Spec:** `docs/superpowers/specs/2026-11-19-effects-and-sends-design.md`

## Global Constraints

- Žádný globální BPM; čas delaye v ms. `delay.time` 10–2000 ms, `feedback` 0–0,9 (tvrdý strop), `tone` 200–12000 Hz, `return` 0–1. `reverb.decay` 0,3–10 s, `damping` 0–1, `return` 0–1.
- Výchozí hodnoty: delay `time` 350, `feedback` 0,4, `tone` 4000, `return` 0,5; reverb `decay` 2,5, `damping` 0,5, `return` 0,5. Nový send má úroveň 0,3. 3 sloty na modul.
- Každá změna hlasitosti/parametru jen přes `setTargetAtTime` nebo crossfade; nikdy skok (`.value =` pouze při vytvoření uzlu).
- Efekty se `[stop all]` nedotýkají; id efektů `fx1`, `fx2`… se nikdy nepoužijí znovu.
- Při změně souborů zvednout cache SW na `pulsar-v7` a přidat `js/fx.js`, `js/sends.js` do `FILES`.
- Vanilla JS/CSS/HTML, žádné závislosti. Testy: `npm test` (`node --test "tests/**/*.test.js"`).

## Review Focus

- Odebrání efektu při aktivních sendech: žádné lupnutí, sloty ve všech modulech se přepnou na `—`, výběry v UI neukazují smazaný efekt.
- `feedback` zadaný jako `'1.5'`, `NaN` nebo text nikdy nepřekročí 0,9 ani nezůstane nekonečný.
- Rychlé tahání posuvníku reverbu (`decay`/`damping`) nevytvoří desítky convolverů ani buffer na každý event.
- Odebrání modulu s aktivními sendy uprostřed doznívání dronu: send gainy se odpojí až po `disposeDelay`.
- Dva sloty jednoho modulu na stejný efekt fungují (sčítají se); `[stop all]/[play all]` nepřeruší doznívání ocasů.

---

### Task 1: Efekty `js/fx.js`

**Files:**
- Create: `js/fx.js`
- Test: `tests/fx.test.js`

**Interfaces:**
- Consumes: `mulberry32` z `js/rng.js` (pro výchozí RNG impulzní odezvy; testy dávají vlastní).
- Produces:
  - `FX_DEFAULTS: { delay: {...}, reverb: {...} }` (hodnoty z Global Constraints)
  - `clampFxParam(type: 'delay'|'reverb', key: string, value: unknown): number | null` – `null` pro neznámý klíč nebo nekonečné/NaN; jinak číslo ořezané do rozsahu (řetězec `'1.5'` se převede)
  - `makeImpulse(decay: number, damping: number, sampleRate: number, rng: () => number): [Float32Array, Float32Array]` – délka `ceil(decay*sampleRate)`, šum s exponenciálním útlumem (~−60 dB na konci), `damping` ztmavuje (jednopólový lowpass), všechny vzorky konečné a |x| ≤ 1
  - `createDelay(ctx, params?)` a `createReverb(ctx, params?)` → `{ type, params, input: AudioNode, output: AudioNode, setParam(key, value): void, tailMs(): number, dispose(): void, disconnect(): void }`. `params` je živý objekt s přijatými hodnotami. `dispose()` plynule spustí `return` k nule (doznění), `disconnect()` odpojí všechny uzly.

- [ ] **Step 1: Write the failing tests** v `tests/fx.test.js`:
  - `clampFxParam clamps every documented range`: delay `time` 5→10, 99999→2000; `feedback` 5→0,9, `'1.5'`→0,9, -1→0; `tone` 10→200; reverb `decay` 0→0,3, 99→10; `damping` 2→1; `return` 2→1; `NaN`/`'abc'`/neznámý klíč → `null`.
  - `makeImpulse is finite, bounded, decays and is deterministic`: dva kanály délky `ceil(decay*sr)`, žádné NaN, max |x| ≤ 1, energie posledního desetiny < 1 % energie první desetiny, stejné RNG seed → stejný výstup.
  - `makeImpulse damping darkens`: součet |x[i]−x[i−1]| pro `damping` 0,9 je menší než pro 0,1 (stejný seed).
  - `delay graph`: `createDelay` na stub kontextu (rozšířit stub z `tests/mix.test.js` o `createDelay`, `createBiquadFilter`, `createConvolver`, `createBuffer`) vytvoří DelayNode s `maxDelayTime` ≥ 2, feedback smyčku přes lowpass a `input`/`output`; `setParam('time', 500)` volá jen `setTargetAtTime` s 0,5 s; `setParam('feedback', 7)` nastaví cíl 0,9; po vytvoření žádné další `.value =`.
  - `delay tailMs` roste s `feedback` a `time`, je konečný i pro `feedback` 0,9 (≤ 20000).
  - `reverb setParam decay crossfades`: po `setParam('decay', 5)` a doběhnutí časovače (`t.mock.timers`) existují dva convolvery, starý gain dostal cíl 0, nový začal na 0 a dostal cíl 1, žádný skok.
  - `reverb coalesces rapid changes`: 20 volání `setParam('decay', …)` v řadě → po doběhnutí časovače právě 1 nový `createBuffer` (plus ten z konstrukce).
  - `dispose then disconnect`: `dispose()` dá `return` cíl 0 (ne `.value`), `disconnect()` odpojí uzly.
- [ ] **Step 2: Run** `node --test tests/fx.test.js` – Expected: FAIL (modul neexistuje).
- [ ] **Step 3: Implement `js/fx.js`.** Delay: `input → DelayNode → BiquadFilter(lowpass, tone) → return gain → output`, z biquadu zpětná vazba přes `feedback` gain zpět do DelayNode; všechny změny `setTargetAtTime` (konstanta ~0,02 s). Reverb: `input → ConvolverNode → return gain → output`; změna `decay`/`damping` se po 150 ms trailing debounce přebuduje jedním novým bufferem a novým convolverem s vlastním gainem; starý gain se rampou sníží na 0 a po 300 ms se starý convolver odpojí. `tailMs`: delay ≈ `time * ln(0.001)/ln(feedback)` omezeno na 20000 ms (feedback ≤ 0 → `time`); reverb `decay*1000`.
- [ ] **Step 4: Run** `node --test tests/fx.test.js` – Expected: PASS; pak `npm test` – Expected: vše zelené.
- [ ] **Step 5: Commit** `feat: delay and reverb effects` (se všemi soubory tohoto tasku).

---

### Task 2: Sendy `js/sends.js` + odbočka v `connectMix`

**Files:**
- Modify: `js/mix.js` (`connectMix` vrací navíc `send(dest)`; `disconnect()` odpojí i sendy)
- Create: `js/sends.js`
- Modify: `js/engine.js`
- Test: `tests/mix.test.js` (rozšířit), `tests/sends.test.js`

**Interfaces:**
- Consumes: `connectMix(ctx, out, destination)` z `mix.js`; `createDelay`/`createReverb`, `FX_DEFAULTS`, `clampFxParam` z Tasku 1.
- Produces:
  - `connectMix(...)` vrací `{ setVolume, setPan, send(dest: AudioNode): { setLevel(v): void, disconnect(): void }, disconnect }`. `send` vytvoří gain s počátkem 0 napojený za pan na `dest`; `setLevel` clampuje 0–1 a rampuje; `mix.disconnect()` odpojí i všechny sendy.
  - `clampLevel(v: unknown): number` v `mix.js` (jako `clampVolume`, ale neplatná hodnota → 0).
  - `createRouting(ctx, master)` v `sends.js` → `{ effects: Fx[], addEffect(type: 'delay'|'reverb'): Fx & {id: string}, setFxParam(fx, key, value): void, removeEffect(id): void, attach(m, mix): void, detach(m): void, setSend(m, slot: 0|1|2, { fx?: string|null, level?: number }): void }`. `attach` nastaví `m.sends = [{fx:null, level:0.3}, ×3]`. `addEffect` připojí `fx.output` na `master` a přiřadí id `fx<N>` z rostoucího čítače. `setFxParam` volá `fx.setParam` (hodnoty v `fx.params` jsou ty přijaté).
  - `engine`: `effects`, `addEffect(type)`, `setFxParam(fx, k, v)`, `removeEffect(id)`, `setSend(m, slot, patch)` delegují na routing; `addModule` volá `routing.attach(m, mix)`, `removeModule` volá `routing.detach(m)` před `mix.disconnect()` (stejný odložený čas jako dnes).

- [ ] **Step 1: Write the failing tests.**
  - `tests/mix.test.js`: `send taps after pan` (`pan.connections` obsahuje send gain, ten míří na `dest`, počáteční gain bez skoku, `setLevel(5)` → cíl 1, `setLevel(NaN)` → 0), `mix.disconnect disconnects sends`.
  - `tests/sends.test.js` (stub kontext jako výše, `master` stub):
    - `attach gives three empty slots with level 0.3`.
    - `setSend selects an effect and ramps the level`: send gain míří na `fx.input`, cíl 0,3 (default) nebo zadaná úroveň; `level` mimo rozsah se ořízne.
    - `setSend level-only change keeps target` (žádný nový uzel).
    - `setSend to another effect fades the old send to 0 and disconnects it later` (timer) a vytvoří nový z 0.
    - `two slots of one module can target the same effect`.
    - `slot index outside 0..2 and unknown fx id are ignored/treated as none`.
    - `removeEffect resets slots in all modules and ramps their sends to 0`, pak po `tailMs()+100` (mock timers) `fx.disconnect()` zavolán a před tím ne; `dispose()` zavolán okamžitě.
    - `ids are never reused` (přidat fx1, odebrat, přidat → fx2).
    - `detach disconnects the module's sends`.
  - Žádný test nesmí vidět `.value =` na gainech po vytvoření.
- [ ] **Step 2: Run** `node --test tests/mix.test.js tests/sends.test.js` – Expected: FAIL.
- [ ] **Step 3: Implement** `mix.js` (`send`, `clampLevel`, rozšířený `disconnect`) a `sends.js` podle Interfaces; odpojení staré/odebrané větve vždy až po rampě (~150 ms časovač). Pak napojit `engine.js` (deleguje, nic jiného neměnit; `hasModules`/clock zůstávají jen o modulech).
- [ ] **Step 4: Run** `npm test` – Expected: vše zelené (včetně dosavadních 86).
- [ ] **Step 5: Commit** `feat: send routing for effects`.

---

### Task 3: UI – efekty v `[+]`, panely efektů a řádky `send`

**Files:**
- Modify: `js/ui.js`, `css/style.css` (jen drobnosti ve stávajícím terminálním stylu)
- Test: manuální ověření v Chrome (UI nemá Node testy, jako dosud)

**Interfaces:**
- Consumes: `engine.effects`, `engine.addEffect(type)`, `engine.setFxParam(fx, key, value)`, `engine.removeEffect(id)`, `engine.setSend(m, slot, patch)`, `m.sends`, `fx.params`, `fx.id`, `fx.type`.
- Produces: žádné nové API.

- [ ] **Step 1: Menu `[+]`** rozšířit o `[reverb]` a `[delay]` (volá `await engine.resume()`, `engine.addEffect(type)`, `addFxPanel(fx)`).
- [ ] **Step 2: Panel efektu** (`section.panel`, hlavička `#fx1 delay` + `[x]`, bez `[stop]`): řádky `time`/`feedback`/`tone`/`return` (delay), `decay`/`damping`/`return` (reverb); čísla přes `synced` vzor (po zadání se input přepíše na `fx.params[key]`). `[x]` volá `engine.removeEffect` a odstraní panel.
- [ ] **Step 3: Řádky `send 1–3` v každém panelu modulu** (po `mixRows`): `select` (`—` + `#fx1 delay`, …) a posuvník 0–100 % (`m.sends[i].level`). Změna selectu volá `engine.setSend(m, i, { fx: id|null })`, posuvník `{ level }`.
- [ ] **Step 4: Obnova výběrů.** V rAF smyčce porovnat podpis seznamu efektů (`effects.map(e => e.id).join()`) s minulým; při změně přestavět `option`y všech send selectů a nastavit hodnotu podle `m.sends[i].fx` (po odebrání efektu je to už `null`).
- [ ] **Step 5: Ověření v Chrome** (vyčistit SW/cache; skutečné kliky): přidat melodic + drone + delay + reverb; nastavit send 1→delay, send 2→reverb na obou modulech; odebrat delay → oba selecty se vrátí na `—`, v konzoli žádná chyba; zadat feedback `5` → input ukáže `0.9`; přidat druhý delay → objeví se ve všech selectech; `[stop all]`/`[play all]` efekty nesmaže. Zvuk (dozvuk, ozvěna, absence lupnutí) neslyším – uvést uživateli.
- [ ] **Step 6: Commit** `feat: effect panels and per-module sends in the UI`.

---

### Task 4: Cache, závěr

**Files:**
- Modify: `sw.js` (`CACHE='pulsar-v7'`, přidat `js/fx.js`, `js/sends.js` do `FILES`)

- [ ] **Step 1:** Zvednout cache a doplnit `FILES`; ověřit v Chrome po vyčištění SW, že app naběhne offline-cache bez 404.
- [ ] **Step 2:** `npm test` – Expected: vše zelené; zapsat počet testů.
- [ ] **Step 3: Commit** `chore: bump service worker cache for effects`.
