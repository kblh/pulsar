# Drone modul a globální play/stop – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Přidat do Pulsaru globální `[stop all]/[play all]` a třetí druh modulu, **drone** (bordun + plynule přibývající/ubývající přídavné tóny).

**Architecture:** Logika rozhodování (`pickChange`, časování změn, `transport`) jsou čisté moduly testované přes `node --test`. Drone modul používá stávající `engine`/`tick` rozhraní, ale bez `Track`: vlastní časovač změn v `tick` a oscilátory, jejichž hlasitost se mění výhradně rampami (`setTargetAtTime`). Globální transport je malý čistý objekt, který engine používá.

**Tech Stack:** Vanilla JS (ES moduly), Web Audio API, `node --test`. Beze změny oproti hlavnímu plánu.

**Spec:** `docs/superpowers/specs/2026-11-19-drone-and-global-transport-design.md` (navazuje na `2026-11-19-pulsar-design.md`)

## Global Constraints

- Žádný globální BPM, žádná sdílená časová mřížka; drone nemá `Track` ani kroky.
- Každá změna hlasitosti tónu je rampa (`setTargetAtTime`), nikdy skok: start, stop, přidání, odebrání, odebrání modulu. Počáteční `gain.value` je 0.
- Báze dronu se nikdy neodebere (jen při stopu/odebrání modulu celá utlumí).
- Globální play spouští jen moduly, které globální stop sám zastavil; ručně zastavené zůstanou zastavené.
- `rate` je celé číslo 1–10; `fade` se omezí na 0.5–30 s (neplatné → 4 s).
- Bez build kroku, bez runtime závislostí; testy `npm test` (`node --test "tests/**/*.test.js"`).
- Mutační/rozhodovací funkce jsou čisté, RNG se vstřikuje (`() => number` v [0,1)).

## Review Focus

1. Žádný skok hlasitosti: start, stop, přidání/odebrání tónu a `dispose` používají jen rampy; počáteční gain 0 (Task 3, test se zaznamenávajícím stubem AudioParam).
2. Rychlé přepínání: tón, který právě doznívá (release), se nesmí znovu přidat a pro jeden tón nikdy nevzniknou dva oscilátory (Task 1 + Task 3).
3. Globální play po ručním stopu jednoho modulu ho nerozjede; modul přidaný při globálním stopu nezačne hrát sám (Task 2).
4. Pool obsahující kořenový tón, prázdný/neplatný pool, `maxExtra` 0, pool menší než `maxExtra`: žádná výjimka a báze zůstává (Task 1, Task 3).
5. Extrémní `fade` (0, NaN, 1000) a `dispose` uprostřed fade: hodnota se omezí, oscilátory se nakonec zastaví a odpojí, nic nevisí (Task 3).

---

### Task 1: Logika dronu (čisté funkce)

**Files:**
- Create: `js/drone.js`, `tests/drone.test.js`

**Interfaces:**
- Consumes: `buildPitchPool` z `js/scales.js` (jen pro vytvoření poolu v testu).
- Produces:
  - `DEFAULT_FADE = 4`; `clampFade(v: unknown): number` – číslo v [0.5, 30]; `NaN`/ne-číslo → 4.
  - `nextChangeDelay(rate: number, rng: () => number): number` – sekundy; `rate` (omezený na 1–10) 10 ≈ 3 s, 1 ≈ 40 s (lineárně v `rate`), násobeno `0.7 + 0.6 * rng()`.
  - `pickChange(state: {active: number[], releasing: number[]}, opts: {pool: number[], root: number, maxExtra: number}, rng): {add: number} | {remove: number} | null` – MIDI čísla přídavných tónů. Kandidáti na přidání = tóny poolu různé od `root`, nejsou v `active` ani `releasing`. Pravidla: `active.length > maxExtra` nebo (`active.length === maxExtra` a `maxExtra > 0`) → `remove` náhodného z `active`; `active` prázdné → `add` (pokud je kandidát, jinak `null`); jinak s `rng() < 0.5` `add`, jinak `remove`, a když zvolená akce není možná, zkusit opačnou, jinak `null`. Báze (`root`) se nikdy nevrací jako `remove`.

- [ ] **Step 1: Write failing tests**: `clampFade(0)===0.5`, `clampFade(1000)===30`, `clampFade(NaN)===4`, `clampFade('x')===4`, `clampFade(5)===5`; `nextChangeDelay(10, ()=>0.5)===3` (±1e-9), `nextChangeDelay(1, ()=>0.5)===40`, rate 99 se chová jako 10, jitter je v [0.7,1.3]× základu; `pickChange` s prázdným `active` a pool `[48,52,55]`, root 48 vrací `{add}` z `[52,55]` (nikdy 48); s `active` už na `maxExtra` vrací `remove` prvku z `active`; `releasing` tón se nikdy nepřidá (pool `[52]`, `releasing [52]`, `active []` → `null`); `maxExtra 0` s prázdným `active` → `null`; `maxExtra 0` s `active [52]` → `remove 52`; prázdný pool → `null`; `1000` volání s `mulberry32` nikdy nevrátí `root` ani `add` tónu z `active`/`releasing` a nikdy `remove` tónu mimo `active`.
- [ ] **Step 2: Run** `npm test` – Expected: FAIL (`js/drone.js` neexistuje).
- [ ] **Step 3: Implement** podle signatur.
- [ ] **Step 4: Run** `npm test` – Expected: PASS (celá sada).
- [ ] **Step 5: Commit** `git add js/drone.js tests/drone.test.js && git commit -m "feat: drone change logic"`

### Task 2: Globální transport

**Files:**
- Create: `js/transport.js`, `tests/transport.test.js`
- Modify: `js/engine.js` (použití transportu, nové metody)

**Interfaces:**
- Produces (transport.js): `createTransport(): Transport` s metodami
  - `register(m: {id, running: boolean, start(): void, stop(): void}): void` – pokud je transport právě `isStopped()`, modul se okamžitě zastaví (`m.stop()`) a zapamatuje jako zastavený globálně;
  - `unregister(id): void`;
  - `stopAll(): void` – každý běžící modul `stop()` a zapamatuje se jeho `id`; nastaví `isStopped()` na `true`;
  - `playAll(): void` – `start()` jen modulů zapamatovaných (a stále registrovaných); `isStopped()` → `false`;
  - `isStopped(): boolean`.
- Produces (engine.js): `engine.stopAll()`, `engine.playAll()`, `engine.isStopped()` – delegace na transport; `addModule` volá `transport.register(m)` **po** nastavení `m.out`, `removeModule` volá `transport.unregister(id)`. `engine.addModule` nastaví výstupní gain na `m.outLevel ?? 0.4`.
- Consumes: modulové objekty z `js/module.js` (`id`, `running`, `start`, `stop`).

- [ ] **Step 1: Write failing tests** (s jednoduchými falešnými moduly `{id, running, start, stop}`): `stopAll` zastaví oba běžící a `isStopped()` je `true`; `playAll` je znovu spustí a `isStopped()` je `false`; modul zastavený ručně před `stopAll` zůstane po `playAll` zastavený; modul přidaný (`register`) při `isStopped()` je zastaven a po `playAll` se spustí; `unregister` zapomene modul (po `playAll` se nezavolá jeho `start`); `playAll` bez předchozího `stopAll` nic nespouští ani nevyhodí.
- [ ] **Step 2: Run** `npm test` – Expected: FAIL.
- [ ] **Step 3: Implement** transport a zapojit do `engine.js` podle signatur.
- [ ] **Step 4: Run** `npm test` – Expected: PASS.
- [ ] **Step 5: Commit** `git add js/transport.js js/engine.js tests/transport.test.js && git commit -m "feat: global transport"`

### Task 3: Drone modul a hlas se ztlumením

**Files:**
- Modify: `js/synth.js`, `js/module.js`
- Create: `tests/drone-module.test.js`

**Interfaces:**
- Consumes: `pickChange`, `nextChangeDelay`, `clampFade`, `DEFAULT_FADE` (Task 1); `buildPitchPool`, `parseNote`, `midiToFreq` (`js/scales.js`); transportní rozhraní modulu (`id, running, start, stop`) z Tasku 2.
- Produces (synth.js): `createDroneVoice(ctx, dest, v: {freq: number, wave: OscillatorType, peak: number, fade: number}): {setWave(w), release(fade: number, onDone?: () => void): void}` – gain začíná na 0 a nabíhá přes `gain.gain.setTargetAtTime(peak, ctx.currentTime, fade / 4)`; `release` volá `setTargetAtTime(0, ctx.currentTime, fade / 4)`, oscilátor zastaví za `ctx.currentTime + fade * 2` a po `onended` uzly odpojí a zavolá `onDone`. Jiné automace než `setTargetAtTime` (a počáteční `value = 0`) se na hlasu nepoužívají.
- Produces (module.js): `createDroneModule(overrides?: Partial<DroneParams>): Module`; `DroneParams = {wave: OscillatorType, rootNote: string, pitchConfig: (tvar jako buildPitchPool), maxExtra: number, rate: 1..10, fade: number}`; výchozí `wave 'sine'`, `rootNote 'C2'`, `pitchConfig {mode:'scale', root:'C', scale:'pentatonicMinor', octaves:2}`, `maxExtra 2`, `rate 3`, `fade 4`. Modul má stejné rozhraní jako ostatní (`id, type: 'drone', params, state, running, playhead: -1, out, outLevel: 0.25, setParam, start, stop, dispose, tick(ctx, dest, now)`) plus `state.sounding(): number[]` (MIDI: báze + přídavné, bez doznívajících). Chování:
  - první `tick` (běží, ještě bez hlasu) vytvoří hlas báze (fade-in) a nastaví `nextChangeAt = now + nextChangeDelay(rate, Math.random)`;
  - při `now >= nextChangeAt` zavolá `pickChange({active, releasing}, {pool, root, maxExtra}, Math.random)`: `add` vytvoří hlas přídavného tónu (peak 0.3, báze 0.5) a přidá ho do `active`; `remove` přesune tón z `active` do `releasing`, zavolá `release(fade, () => odstranit z releasing)`; pak přeplánuje `nextChangeAt`;
  - `stop()`: `running=false` a rampa `out.gain` na 0 (`setTargetAtTime(0, out.context.currentTime, fade / 4)`); `start()`: `running=true` a rampa `out.gain` zpět na `outLevel`; při stopu se hlasy nemění;
  - `dispose()`: `disposed=true`, rampa `out.gain` na 0 a `release(fade)` všech hlasů; `out.disconnect()` až po `fade * 2` (`setTimeout`); další `tick` je no-op;
  - `setParam`: `wave` (nastaví všem hlasům `setWave`), `rate` (celé 1–10, neplatné ignorovat), `maxExtra` (celé ≥ 0, neplatné ignorovat), `fade` (`clampFade`), `rootNote` (platné `parseNote` → nová báze: starý hlas báze se `release`, nový se vytvoří; neplatné ignorovat), `pitchConfig` (přestaví pool; přídavné tóny, které už nejsou v poolu, se `release`).

- [ ] **Step 1: Write failing tests** s nahrávajícím stubem kontextu, kde každý `GainNode.gain` zaznamenává volání (`setTargetAtTime`, `setValueAtTime`, `linearRampToValueAtTime`, přiřazení `value`) a oscilátory zaznamenávají `start`/`stop`/`onended`:
  1. První `tick` vytvoří právě jeden oscilátor (báze) s počátečním gainem 0 a jediným voláním `setTargetAtTime(0.5, t, fade/4)`; žádné `setValueAtTime` ani nenulové `value`.
  2. Při `rate 10` a běhu 60 s simulovaných ticků (25 ms) se objeví přídavné tóny (`state.sounding().length > 1`), nikdy víc než `1 + maxExtra`, a všechny gain automace na všech hlasech jsou jen `setTargetAtTime` (invariant „žádné skoky").
  3. Odebrání tónu: po `remove` se pro stejné MIDI číslo nevytvoří druhý oscilátor dřív, než doběhne jeho `onended` (simulovat vyvoláním `onended`).
  4. `stop()` zavolá `setTargetAtTime(0, …)` na `out.gain` a nezmění počet hlasů; `start()` ho vrátí na `outLevel` (0.25) také přes `setTargetAtTime`; během `stop` tick nic nevytváří.
  5. `dispose()` během fade: všem hlasům `release`, `out.disconnect` se zavolá až po `fade * 2` (testovat s `setTimeout` zachyceným/mockovaným přes `node:test` `mock.timers`), další `tick` nevytvoří nic.
  6. `setParam('fade', 0)`→0.5, `('fade', 1000)`→30, `('fade', NaN)`→4; `setParam('rate', 99)`→10; `setParam('rootNote', 'xx')` beze změny a bez výjimky.
  7. Pool obsahující kořenový tón, `maxExtra 0` a pool menší než `maxExtra` nevyhodí výjimku a báze zůstává ve `state.sounding()`.
- [ ] **Step 2: Run** `npm test` – Expected: FAIL (`createDroneModule` / `createDroneVoice` chybí).
- [ ] **Step 3: Implement** `createDroneVoice` v `js/synth.js` a `createDroneModule` v `js/module.js` podle signatur.
- [ ] **Step 4: Run** `npm test` – Expected: PASS (celá sada).
- [ ] **Step 5: Commit** `git add js tests && git commit -m "feat: drone module with fading voices"`

### Task 4: UI – globální tlačítko a panel dronu

**Files:**
- Modify: `index.html`, `css/style.css`, `js/ui.js`, `js/main.js`, `sw.js`

**Interfaces:**
- Consumes: `engine.stopAll/playAll/isStopped` (Task 2), `createDroneModule` (Task 3).
- Produces:
  - Hlavička obsahuje globální tlačítko `[stop all]` / `[play all]`; text se v `requestAnimationFrame` smyčce synchronizuje s `engine.isStopped()`. Klik volá `engine.resume()` (uživatelské gesto) a pak `playAll()` nebo `stopAll()`.
  - Menu `[+]` nabízí navíc `[drone]`.
  - Panel dronu (`#N drone`): řádky `osc`, `root` (text, např. `C2`), pitch pool (stejné řádky jako u melodie – výběr `scale/notes`, tónika, stupnice, oktávy, výčet tónů; sdílet funkcí extrahovanou z `melodicControls`), `max extra` (číslo 0–6), `rate` (slider 1–10), `fade s` (číslo), a textový řádek `now: C2 + G3 + Eb4` aktualizovaný v animační smyčce z `state.sounding()` (MIDI → název noty). Tlačítka `[stop]/[start]` a `[x]` jako u ostatních panelů.
  - Popisek tlačítka `[stop]/[start]` v každém panelu se synchronizuje s `m.running` v animační smyčce (globální stop/play ho mění zvenku).
  - `sw.js`: `CACHE = 'pulsar-v3'`, do `FILES` přidat `js/drone.js` a `js/transport.js`.

- [ ] **Step 1: Implement** hlavičku, menu, panel dronu, sdílené řádky poolu a synchronizaci popisků; bump `sw.js`.
- [ ] **Step 2: Run** `npm test` – Expected: PASS (UI se testuje ručně).
- [ ] **Step 3: Ověření v prohlížeči** (uživatel spustí `python3 -m http.server 8000`; z Claude kliknutí skutečnými myšovými akcemi, ne JS `.click()`, kvůli `AudioContext`): přidání dronu a melodického modulu; `now:` řádek dronu se postupně mění a obsahuje vždy `C2`; globální `[stop all]` zastaví všechny panely (popisky `[start]`) a `[play all]` je znovu spustí; modul zastavený ručně před `stop all` zůstane po `play all` zastavený; přidání modulu při globálním stopu ho nespustí; odebrání dronu `[x]` nezpůsobí lupnutí (poslech uživatelem); konzole bez chyb; po reloadu se načte čerstvá cache `pulsar-v3` (service worker nejdřív unregister + smazání cache).
- [ ] **Step 4: Commit** `git add index.html css js sw.js && git commit -m "feat: drone panel and global play/stop UI"`
