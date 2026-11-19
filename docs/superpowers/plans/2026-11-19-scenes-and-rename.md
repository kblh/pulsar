# Scény (save / load) a přejmenování – implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ukládat a načítat celé nastavení jako pojmenované scény v `localStorage` a přejmenovávat moduly, efekty a scény.

**Architecture:** Nové čisté soubory `js/options.js` (sdílené seznamy voleb), `js/scene.js` (serializace, validace, aplikace scény na engine přes hooky do UI) a `js/scene-store.js` (úložiště s vloženým `storage`). `ui.js` dostane panel scén v hlavičce a editor jména v hlavičkách panelů. Moduly a efekty dostanou pole `name`.

**Tech Stack:** Vanilla JS (ES moduly), `localStorage`, `node --test` s nahrávajícími stuby a falešným enginem.

**Spec:** `docs/superpowers/specs/2026-11-19-scenes-and-rename-design.md`

## Global Constraints

- Formát scény `{ version: 1, effects: [{type, name, params}], modules: [{type, name, params, volume, pan, running, sends: [{fx: index|null, level}×3]}] }`; sendy odkazují na efekt indexem v poli `effects`, ne id.
- Úložiště `localStorage` klíč `pulsar.scenes`: `{ version: 1, scenes: [{ id, name, savedAt, data }] }`.
- Jméno: oříznuté (trim), max 24 znaků, prázdné → výchozí (typ modulu/efektu; pro scénu `scene`). Jména se vykreslují přes `textContent`, nikdy `innerHTML`.
- Ukládá se zadání (`params`), ne vyvinutý stav; melodie melodic modulu je po načtení nová náhodná (vývoj začíná znovu).
- Stejné jméno scény přepíše existující; smazání scény potvrzuje druhý klik (`[sure?]`); načtení nahradí aktuální scénu bez ptaní.
- Žádná operace úložiště nevyhazuje výjimku (neplatný JSON, plné/zakázané úložiště → výsledek s chybou).
- Při změně souborů zvednout cache SW na `pulsar-v8` a přidat `js/options.js`, `js/scene.js`, `js/scene-store.js` do `FILES`.
- Vanilla JS/CSS/HTML, žádné závislosti. Testy: `npm test` (`node --test "tests/**/*.test.js"`).

## Review Focus

- Poškozené úložiště (neplatný JSON, pole místo objektu, `scenes` nepole, neznámá verze, `getItem`/`setItem` házející výjimku, plná kvóta): seznam je prázdný, aplikace běží, `save` vrátí chybu; úložiště s novější verzí se nepřepíše.
- Scéna s neznámým typem modulu/efektu, `bpm: 'abc'`, `swing: 99`, nestringovým `rhythm`, `octaves: 1e9`, nesmyslným `pitchConfig`: položka se přeskočí nebo ořízne, nikdy nezůstane napůl postavená scéna a app nespadne ani nezamrzne.
- Send odkazující na efekt mimo rozsah nebo na přeskočený efekt se načte jako `—`.
- Načtení scény dvakrát za sebou nebo po `[stop all]`: v engine jsou přesně moduly a efekty ze scény, zbylé nehrají, tlačítko ukazuje `[stop all]` a moduly hrají.
- Jména: 10 000 znaků, jen mezery, `<img onerror=…>`: oříznuto, výchozí jméno, zobrazeno jako text.

---

### Task 1: Model scény – jména, parametry efektu, `options.js`, `scene.js`

**Files:**
- Create: `js/options.js` (`WAVES`, `ROOTS` přesunuté z `ui.js`; `ui.js` je importuje)
- Create: `js/scene.js` (`cleanName`, `serializeScene`, `validateScene`)
- Modify: `js/module.js` (`name` u všech tří druhů modulů), `js/sends.js` (`addEffect(type, params?)` předá `params` továrně a nastaví `fx.name = type`), `js/ui.js` (import voleb)
- Test: `tests/scene.test.js`, rozšířit `tests/module.test.js` / `tests/drone-module.test.js` a `tests/sends.test.js`

**Interfaces:**
- Consumes: `clampFxParam` (`fx.js`), `clampVolume`/`clampPan`/`clampLevel` (`mix.js`), `SCALES` (`scales.js`), engine objekty (`modules`, `effects` s `type`, `name`, `params`, `volume`, `pan`, `running`, `sends`, `id`).
- Produces:
  - `m.name` (výchozí `'melodic'|'rhythmic'|'drone'`), `fx.name` (výchozí typ); `engine.addEffect(type, params?)`
  - `cleanName(value: unknown, fallback: string): string`
  - `serializeScene({ modules, effects }): Scene` – hluboká kopie `params` (JSON), send `fx` převedené z id na index v `effects` (neznámé → `null`)
  - `validateScene(data: unknown): { scene: Scene | null, problems: string[] }` – normalizace: `version` musí být 1; neznámé typy a položky vypadnou (problém se zapíše); efektové `params` jen přes `clampFxParam`; modulové `params` jen známé klíče daného typu: `wave` ∈ `WAVES`, `evolution` ∈ drift/walk, `env` (a,d,r 0–5, s 0–1), `rhythm`/`voices` jen řetězce, `pitchConfig` (`mode` scale/notes, `root` ∈ `ROOTS`, `scale` ∈ klíče `SCALES`, `octaves` celé 1–4, `notes` řetězec ≤ 200 znaků), `rootNote` řetězec ≤ 8 znaků, ostatní čísla (`bpm`, `swing`, `randomize`, `rhythmMod`, `rate`, `maxExtra`, `fade`) zůstávají čísly (`Number.isFinite`, jinak vypadnou; ořezání dělá `setParam`); `volume` přes `clampVolume`, `pan` přes `clampPan`, `running` boolean (výchozí true), `sends` max 3 položky s `level` přes `clampLevel` a `fx` jen platný index přemapovaný po vypadlých efektech (jinak `null`); scéna bez jediného platného modulu a efektu → `scene: null`.

- [ ] **Step 1: Write the failing tests.**
  - `tests/module.test.js`/`drone-module.test.js`: `createMelodicModule().name === 'melodic'` (analogicky rhythmic, drone).
  - `tests/sends.test.js`: `addEffect('delay', { time: 900 })` má `params.time === 900` a `name === 'delay'`; `addEffect('delay', { feedback: 7 })` má 0,9.
  - `tests/scene.test.js`:
    - `cleanName`: trim, ořez na 24, mezery/prázdné/`null`/číslo → fallback, markup zůstane řetězcem (`'<img onerror=x>'` se vrátí jako text, jen oříznutý).
    - `serializeScene` s reálnými `createMelodicModule/createRhythmicModule/createDroneModule` a falešnými efekty: výsledek je `JSON.parse(JSON.stringify(x))`-stabilní, send `fx` je index (efekt `fx7` na druhém místě → `1`, send na neexistující id → `null`), změna výsledku nemění `m.params` (hluboká kopie `env`, `pitchConfig`, `voices`).
    - `validateScene` round-trip: `validateScene(serializeScene(...)).scene` deep-equals původní serializaci.
    - `validateScene` odmítá: `null`, řetězec, pole, `version: 2`, `{version:1}` bez položek → `scene: null`.
    - `validateScene` ořezává: neznámý typ modulu/efektu vypadne a v `problems` je zmínka; `bpm: 'abc'` vypadne, `octaves: 1e9` → 4, `wave: 'evil'` vypadne, `rhythm: 5` vypadne, `volume: 9` → 1, `pan: NaN` → 0, 5 sendů → 3, send na index 99 → `null`, send na vypadlý efekt → `null` a ostatní indexy se přemapují správně.
- [ ] **Step 2: Run** `node --test tests/scene.test.js tests/sends.test.js tests/module.test.js tests/drone-module.test.js` – Expected: FAIL.
- [ ] **Step 3: Implement** podle Interfaces (`options.js` hodnoty zkopírovat z `ui.js`; `addEffect` předá `params` továrně, která je už ořezává).
- [ ] **Step 4: Run** `npm test` – Expected: vše zelené.
- [ ] **Step 5: Commit** `feat: scene model with names, serialization and validation`.

---

### Task 2: Aplikace scény `applyScene` v `js/scene.js`

**Files:**
- Modify: `js/scene.js` (`applyScene`)
- Test: `tests/scene-apply.test.js`

**Interfaces:**
- Consumes: `validateScene` výstup (`Scene`), `createMelodicModule`/`createRhythmicModule`/`createDroneModule`, engine: `modules`, `effects`, `removeModule(id)`, `removeEffect(id)`, `addEffect(type, params)`, `addModule(m)`, `setVolume(m, v)`, `setPan(m, v)`, `setSend(m, slot, patch)`, `toggle(m)`, `isStopped()`, `playAll()`.
- Produces: `applyScene(engine, scene, ui): { skipped: string[] }`, kde `ui = { clear(): void, addFxPanel(fx): void, addModulePanel(m): void }`. `ui.clear()` má odebrat všechny moduly a efekty z engine i panely.

- [ ] **Step 1: Write the failing tests** s nahrávajícím falešným enginem (zapisuje pořadí volání, ukládá `modules`/`effects`, `isStopped` konfigurovatelné) a reálnými továrnami:
  - `applies in order: clear, playAll when stopped, effects, modules, then sends/volume/pan/running`.
  - `sends map by index: module send to effects[1] gets that effect's id`.
  - `names are applied`: `m.name`/`fx.name` ze scény (přes `cleanName`).
  - `params go through setParam`: scéna s `bpm: 9999` ve validované podobě → modul má `bpm` 300 (clamp); rhythmic `voices.kick` se projeví ve `state.voices.kick.current`; melodic `rhythm` ve `state.rhythm.current`; drone `rootNote: 'D2'` v `params.rootNote`.
  - `running false stays stopped`: modul se `running:false` je po načtení zastavený (`engine.toggle` volán právě pro něj).
  - `a module whose creation throws is skipped`: továrna/`setParam` házející výjimku (např. falešný modul s `setParam`, který hodí) → `skipped` obsahuje položku, ostatní moduly se postaví, žádná výjimka ven.
  - `loading twice leaves only the second scene` (po druhém `applyScene` jsou v enginu jen moduly druhé scény a efekty druhé scény).
- [ ] **Step 2: Run** `node --test tests/scene-apply.test.js` – Expected: FAIL.
- [ ] **Step 3: Implement `applyScene`.** Efekty: `engine.addEffect(type, params)`, `fx.name`, `ui.addFxPanel(fx)`. Moduly: továrna podle typu, pak `m.setParam(k, v)` pro každý uložený klíč (rhythmic `voices` rozbalit na `voice:kick|snare|hat`), `m.name`, `engine.addModule(m)`, `setVolume`/`setPan`, sendy `engine.setSend(m, slot, { fx: id|null, level })`, `if (!running) engine.toggle(m)`, `ui.addModulePanel(m)`; každý modul v `try/catch` – při chybě se modul (pokud už je v enginu, tak odebráním) neponechá a zapíše se do `skipped`.
- [ ] **Step 4: Run** `npm test` – Expected: vše zelené.
- [ ] **Step 5: Commit** `feat: apply a scene to the engine`.

---

### Task 3: Úložiště scén `js/scene-store.js`

**Files:**
- Create: `js/scene-store.js`
- Test: `tests/scene-store.test.js`

**Interfaces:**
- Consumes: `cleanName`, `validateScene` ze `scene.js` (data se při `get` znovu validují).
- Produces: `createSceneStore(storage: {getItem, setItem} | null, now?: () => number)` →
  - `list(): { id: string, name: string, savedAt: number }[]` (nejnovější první)
  - `get(id): Scene | null` (validovaná scéna, jinak `null`)
  - `save(name, scene): { ok: true, id } | { ok: false, error: string }` – stejné `cleanName`-jméno přepíše záznam a zachová `id`
  - `rename(id, name): { ok: boolean, error?: string }`, `remove(id): { ok: boolean, error?: string }`
  - Žádná metoda nevyhazuje; `storage === null` → `list()` je `[]`, zápisy vrací `{ ok:false, error:'storage unavailable' }`.

- [ ] **Step 1: Write the failing tests** s paměťovým `storage` a variantami, které selhávají:
  - `save then list/get round-trip` (`get` vrátí scénu rovnou původní).
  - `same name overwrites and keeps the id`; `different names make two entries`; `list is newest first`.
  - `rename` mění jméno přes `cleanName`, `remove` záznam odstraní, neznámé id → `ok:false`.
  - `corrupt storage reads as empty and the app survives`: neplatný JSON, `'[]'`, `{"version":1,"scenes":"x"}`, `{"version":1,"scenes":[{"id":1}]}` (neplatné záznamy se vyfiltrují, platné zůstanou).
  - `newer version is not overwritten`: úložiště `{version:2,…}` → `list()` je `[]`, `save` vrátí `{ok:false}` a `setItem` nebyl volán.
  - `throwing getItem/setItem` (včetně `QuotaExceededError`) → výsledek s chybou, žádná výjimka.
  - `get` vrací `null` pro záznam, jehož `data` neprojde `validateScene`.
- [ ] **Step 2: Run** `node --test tests/scene-store.test.js` – Expected: FAIL.
- [ ] **Step 3: Implement** podle Interfaces (id z `now()` a čítače tak, aby se nikdy nesrazily).
- [ ] **Step 4: Run** `npm test` – Expected: vše zelené.
- [ ] **Step 5: Commit** `feat: scene store on localStorage`.

---

### Task 4: UI – scény v hlavičce, přejmenování, cache, ověření v prohlížeči

**Files:**
- Modify: `index.html` (`<span id="scenes">` v hlavičce), `js/main.js` (vytvoří `createSceneStore` nad `localStorage` v `try/catch`, předá `scenesEl` a `store`), `js/ui.js`, `css/style.css` (jen drobnosti), `sw.js` (`pulsar-v8` + nové soubory)
- Test: manuální ověření v Chrome

**Interfaces:**
- Consumes: `serializeScene`, `validateScene`, `applyScene`, `cleanName` ze `scene.js`; store z Tasku 3; engine API.
- Produces: žádné nové API.

- [ ] **Step 1: Refaktor `ui.js`:** odebrání panelu modulu/efektu vytáhnout do funkcí (`removeModulePanel(id)`, `removeFxPanel(id)`) a z nich postavit `ui.clear()` pro `applyScene` (odebere z engine všechny moduly a efekty a jejich panely, včetně `sendFills`).
- [ ] **Step 2: Editor jména** v hlavičkách modulů i efektů: `#id jméno` – klik na jméno → `input`, Enter/blur uloží přes `cleanName(value, type)` do `m.name`/`fx.name` a překreslí (`textContent`), Esc zruší. Send selecty zobrazují `jméno` efektu (`fx.name`) a obnoví se i po přejmenování (podpis efektů v rAF obsahuje jména).
- [ ] **Step 3: Panel scén v hlavičce** (`[save] [load]`): `[save]` ukáže řádek s textovým polem předvyplněným jménem naposledy uložené/načtené scény, Enter volá `store.save(name, serializeScene(engine))` a při `ok:false` ukáže chybu; `[load]` ukáže seznam (`store.list()`): jméno (klik → `await engine.resume()` → `store.get(id)` → `applyScene(...)`, při `null` nebo `skipped` hláška), `[rename]` (inline pole), `[x]` → `[sure?]` při druhém kliku smaže. Hlášky se zobrazí jako text v hlavičce a po pár sekundách zmizí.
- [ ] **Step 4: Cache:** `sw.js` → `pulsar-v8`, přidat nové soubory do `FILES`.
- [ ] **Step 5: Ověření v Chrome** (vyčistit SW/cache, skutečné kliky pro audio): postavit scénu (melodic + drone + delay, send 1 → delay, přejmenovat modul na `bass`, zastavit drone), `[save]` jako `a`, odebrat vše, `[load]` → `a`: jména, sendy, stopnutý drone i hodnoty sedí; uložit druhou scénu `b`, přepnout `a` ↔ `b` několikrát (žádné zbylé moduly, žádné chyby v konzoli); `[stop all]` a pak load → moduly hrají a tlačítko ukazuje `[stop all]`; v konzoli ručně `localStorage.setItem('pulsar.scenes','{')` a reload → seznam prázdný, app běží, `[save]` funguje; jméno `<img src=x onerror=alert(1)>` se zobrazí jako text. Zvuk neslyším – uvést uživateli.
- [ ] **Step 6:** `npm test` – Expected: vše zelené; **Commit** `feat: save/load scenes and rename in the UI`.
