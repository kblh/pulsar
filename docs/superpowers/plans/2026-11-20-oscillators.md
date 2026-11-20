# Dva oscilátory v modulu – implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Melodický modul a drone dostanou druhý oscilátor (`wave2`) s poměrem `mix` a rozladěním `detune`; u dronu se `mix` a `detune` mění živě.

**Architecture:** `js/synth.js` umí hlas s jedním nebo dvěma oscilátory (`playNote` pro melodic, `createDroneVoice` s `setMix` pro drone). `js/module.js` drží parametry, omezuje je a u dronu je posílá živým hlasům. `js/scene.js` je validuje. `js/ui.js` přidá tři ovladače.

**Tech Stack:** Vanilla JS, Web Audio (`OscillatorNode.detune`), `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-20-oscillators-design.md`

## Global Constraints

- Nové parametry modulů **melodic** a **drone**: `wave2` (jedna z `WAVES`, výchozí `sawtooth`), `mix` 0–1 (výchozí 0, krok 0,05), `detune` −50–50 ct (výchozí 0, krok 1). Rytmický modul je nemá.
- Poměr je lineární: osc A má hlasitost `1 − mix`, osc B `mix` (součet 1). Při `mix` 0 hraje jen A přesně jako dnes, při 1 jen B.
- Hlas nebo nota vzniklá při `mix` 0 má zapojení jako dnes (jeden oscilátor přímo do obálky/hlasu). Drone hlas, který druhý oscilátor nemá, ho dostane při prvním `mix` > 0 (vložení stupně hlasitosti pro A nesmí prasknout) a po návratu na 0 se B jen ztlumí.
- Drone: `setParam('mix')` a `setParam('detune')` plynule (`setTargetAtTime`) změní všechny živé hlasy včetně doznívajících; `wave2` při `mix` > 0 vymění hlasy jako dnes `wave` (staré doznějí), při `mix` 0 se jen uloží. Melodic čte parametry při každé nové notě.
- Validace: `wave2` jen ze `WAVES`; `mix` omezený na 0–1; `detune` na −50–50 a celé číslo; nečíselné, neznámé a nepoužitelné hodnoty se ignorují (modul zůstane na přijaté hodnotě); stejná pravidla ve `validateScene`. `version` scény zůstává 1, chybějící klíče znamenají výchozí hodnoty.
- Žádný ovladač nevolá `setParam` při prvním vykreslení; slider ukazuje hodnotu, kterou modul přijal.
- Po doznění noty, po `release`, `kill` a odebrání modulu se zastaví a odpojí oba oscilátory a oba gainy; žádné uzly nezůstanou.
- Změny parametrů jen plynule (`setTargetAtTime`), `.value` jen na čerstvě vytvořených uzlech.
- Cache SW `pulsar-v15`; nové soubory se nepředpokládají (porovnat `FILES` s `ls js`).
- Testy: `npm test`; UI v Chrome (po změně souborů smazat service worker, cache a vynutit znovunačtení). Zvuk z reproduktoru ověřit nelze.

## Review Focus

- Staré scény a moduly bez nových klíčů (a `mix` 0): stejné parametry a stejný graf, nota při `mix` 0 vytvoří právě jeden oscilátor.
- Drone živě: `mix` 0 → 1 → 0 a pohyb `detune` při znějících i doznívajících hlasech, hlasy vzniklé při `mix` 0 dostanou B později; jen plynulé změny, žádné prasknutí.
- `wave2`: při `mix` > 0 se hlasy vymění a staré doznějí (žádné dvojí uvolnění), při `mix` 0 se jen uloží; načtení scény s `wave2` a `mix`.
- Nepoužitelné hodnoty: `wave2` `'evil'`, `mix` 9/`NaN`/`'abc'`/`null`, `detune` ±1e9 přes `setParam`, scénu i soubor; modul zůstane platný a `AudioParam` dostane jen omezená konečná čísla.
- Únik uzlů: po `release`/`kill`/odebrání modulu jsou oba oscilátory zastavené a odpojené; UI na 320 px bez přetékání, ovladače ≥ 44 px.

---

### Task 1: Hlas se dvěma oscilátory (`js/synth.js`)

**Files:**
- Modify: `js/synth.js`, `tests/helpers/stub-ctx.js`
- Test: `tests/synth.test.js`

**Interfaces:**
- Produces:
  - `oscMix(mix) → { a, b }`: `mix` omezený na 0–1 (nečíselné → 0), `a = 1 − mix`, `b = mix`.
  - `playNote(ctx, dest, { freq, time, duration, wave, env, wave2, mix = 0, detune = 0 })`: při `mix` ≤ 0 přesně dnešní zapojení (jeden oscilátor do obálky); při `mix` > 0 osc A a osc B (`wave2`, `detune` v centech přes jeho `detune` AudioParam), každý přes vlastní gain (`a`, `b`) do společné obálky; oba se spustí a zastaví spolu s notou a po doznění se odpojí.
  - `createDroneVoice(ctx, dest, { freq, wave, peak, fade, wave2, mix = 0, detune = 0 })` vrací navíc `setMix({ mix, detune, wave2 })`: plynule nastaví hlasitosti A a B a `detune` B; při `mix` > 0 a chybějícím B ho vytvoří (`wave2`, na startu s hlasitostí 0, `detune`) a A vloží přes gain (od hodnoty 1) bez prasknutí; při `mix` 0 ztlumí B na 0. `release`, `kill` a odpojení po doznění řeší oba oscilátory; na uvolněném hlase `setMix` nedělá nic.
- Stub `tests/helpers/stub-ctx.js`: `createOscillator()` vrací uzel `kind: 'osc'` s `frequency` a `detune` (parametry s `calls`), vlastností `type`, metodami `start(t)`, `stop(t)` (záznam volání) a `onended`.

- [ ] **Step 1: Write the failing tests**

`tests/synth.test.js` (nahrávací stub): 
- `oscMix`: `oscMix(0)` = `{a:1,b:0}`, `oscMix(1)` = `{a:0,b:1}`, `oscMix(0.25)` = `{a:0.75,b:0.25}`; `9`, `-3`, `NaN`, `'abc'`, `null`, `undefined` → v mezích a součet 1.
- `playNote` bez nových voleb a s `mix` 0 vytvoří právě jeden oscilátor, který se připojí přímo na gain obálky, a žádný další gain (zapojení jako dnes); s `mix` 0.5 vytvoří dva oscilátory s typy `wave` a `wave2`, `detune` druhého má hodnotu `detune` (po vytvoření), gainy mají hodnoty 0.5 a 0.5, oba se spustí v `time` a zastaví se po doznění; po `onended` jsou oba odpojené; `detune` mimo ±50 a nečíselný se v hlasu nezneužije (jen konečná čísla).
- `createDroneVoice` s `mix` 0: jeden oscilátor, zapojení jako dnes; `setMix({mix:0.5, detune:20, wave2:'square'})` na takovém hlase vytvoří druhý oscilátor typu `square`, A prochází gainem a jeho hlasitost se plynule mění `setTargetAtTime` na 0.5 (žádná nová volání `.value` na existujících parametrech), `detune` B se nastaví `setTargetAtTime`; `setMix({mix:0})` zruší B ramp na 0; `setMix` na hlase s B jen mění hodnoty (nevytváří třetí oscilátor).
- `release` a `kill` zastaví oba oscilátory; po `onended` obou jsou oba i gainy odpojené; `setMix` po `release`/`kill` nic nevytvoří.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/synth.test.js 2>&1 | grep -E "^# (pass|fail)|not ok|oscMix" | head`
Expected: FAIL (chybějící `oscMix`, `setMix`).

- [ ] **Step 3: Implement**

`oscMix`, rozšíření `playNote` a `createDroneVoice`, stub oscilátoru. Dnešní chování bez nových voleb se nemění.

- [ ] **Step 4: Run the suite**

Run: `npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: všechno PASS (původní testy beze změny).

- [ ] **Step 5: Commit**

```bash
git add js tests
git commit -m "feat: notes and drone voices with a second oscillator

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Parametry v modulech (`js/module.js`)

**Files:**
- Modify: `js/module.js`
- Test: `tests/module.test.js`, `tests/drone-module.test.js`

**Interfaces:**
- Consumes: Task 1 – `playNote(…, { wave2, mix, detune })`, `createDroneVoice(…, { wave2, mix, detune })`, `voice.setMix({ mix, detune, wave2 })`.
- Produces: melodic a drone moduly mají v `params` `wave2` (`'sawtooth'`), `mix` (0), `detune` (0); `setParam('wave2' | 'mix' | 'detune', value)` s validací z Global Constraints; melodic předává parametry do `playNote` při každé notě; drone předává parametry do nových hlasů, `mix` a `detune` posílá živým hlasům (modul si drží množinu živých hlasů: přidává při vzniku, odebírá po doznění nebo `kill`) a `wave2` při `mix` > 0 vymění hlasy jako dnes `wave`.

- [ ] **Step 1: Write the failing tests**

- Melodic (`createMelodicModule`): výchozí `params` mají `wave2 'sawtooth'`, `mix 0`, `detune 0`; `setParam('mix', 9)` → 1, `-2` → 0, `'0.4'` → 0.4, `NaN`/`'abc'`/`null`/`true` ignorováno; `setParam('detune', 1e9)` → 50, `-1e9` → −50, `12.6` → 13, nečíselné ignorováno; `setParam('wave2', 'square')` přijme, `'evil'`, `5`, `null` ignoruje; nota zahraná po `setParam('mix', 0.5)` (použij stub kontextu z existujících testů) vytvoří dva oscilátory a po `setParam('mix', 0)` jeden; rytmický modul tyto klíče nemá v `params`.
- Drone (`createDroneModule`, stub z `drone-module.test.js`): totéž pro validaci; hlas vzniklý při `mix` 0 a pak `setParam('mix', 0.5)` → jeho `setMix` zavolán s `mix` 0.5 a aktuálním `detune` i `wave2`; `setParam('detune', 20)` zavolá `setMix` na všech živých hlasech (kořenovém i extra); hlas, který právě doznívá (uvolněný, ještě znějící), `setMix` také dostane, a po úplném doznění už ne; `setParam('wave2', 'square')` při `mix` 0.5 vymění všechny hlasy (nový počet spawnů = počet hlasů, každý starý uvolněn právě jednou), při `mix` 0 nevymění nic a nový hlas pak vzniká s uloženým `wave2`; `kill`/vypnutí modulu hlasy z množiny odstraní a `setParam('mix')` pak nic nevolá.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test 2>&1 | grep -E "^# (pass|fail)|^not ok"`
Expected: nové testy FAIL.

- [ ] **Step 3: Implement**

Parametry a výchozí hodnoty v obou továrnách; omezení v `applyParam` (melodic) a v drone `setParam`; `wave2`/`mix`/`detune` v `playNote` a v `spawn`; množina živých hlasů a `setMix` v drone.

- [ ] **Step 4: Run the suite**

Run: `npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: všechno PASS.

- [ ] **Step 5: Commit**

```bash
git add js tests
git commit -m "feat: oscillator mix, wave 2 and detune on melodic and drone modules

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Scény a zobrazení detune

**Files:**
- Modify: `js/scene.js`, `js/hud.js`
- Test: `tests/scene.test.js`, `tests/hud.test.js`

**Interfaces:**
- Consumes: Task 2 – parametry modulů.
- Produces: `validateScene` přijme u modulů melodic a drone `wave2` (jen `WAVES`), `mix` (0–1) a `detune` (−50–50, celé číslo), ostatní typy je zahodí; `serializeScene` je zapisuje s ostatními `params`; z `js/hud.js` čistá `formatCents(v) → string`: `0` → `'0 ct'`, `12` → `'+12 ct'`, `-7` → `'−7 ct'`.

- [ ] **Step 1: Write the failing tests**

- `validateScene`: modul melodic s `{ wave2: 'square', mix: 0.4, detune: -12 }` zachová hodnoty; `{ mix: 9, detune: 1e9, wave2: 'evil' }` → `mix` 1, `detune` 50, `wave2` vynechán (výchozí z modulu při sestavení); `{ mix: 'abc', detune: NaN }` vynechány; drone totéž; rytmický modul s těmito klíči je neponese; scéna bez těchto klíčů projde beze změny (staré scény).
- Round trip: `serializeScene` → JSON → `validateScene` zachová `wave2`, `mix`, `detune` melodic i drone modulu; `applyScene` s fake enginem a skutečnými továrnami modulu (podle existujícího vzoru ve `scene-apply.test.js`) nastaví `params.mix` a `params.wave2`.
- `formatCents`: `0`, `1`, `-1`, `50`, `-50`, `12.4` (zaokrouhlí na celé).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test 2>&1 | grep -E "^# (pass|fail)|^not ok"`
Expected: nové testy FAIL.

- [ ] **Step 3: Implement**

Rozšíř `cleanModuleParams` v `scene.js` (stejný vzor jako ostatní číselné klíče a `WAVES`) a přidej `formatCents` do `hud.js`.

- [ ] **Step 4: Run the suite**

Run: `npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: všechno PASS.

- [ ] **Step 5: Commit**

```bash
git add js tests
git commit -m "feat: scenes keep oscillator mix, wave 2 and detune

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Ovladače, service worker a ověření

**Files:**
- Modify: `js/ui.js`, `sw.js`

**Interfaces:**
- Consumes: Task 2 – `setParam('wave2' | 'mix' | 'detune')`; Task 3 – `formatCents`.
- Produces: v detailu melodic a drone za řádek `osc` přibudou `osc 2` (přepínač stejných vln jako `osc`), `mix` (slider 0–1, krok 0,05, procenta, −/+ 0,05) a `detune` (slider −50–50, krok 1, `formatCents`, −/+ 1); hodnoty ukazují, co modul přijal; `CACHE = 'pulsar-v15'`.

- [ ] **Step 1: Add the controls and bump the service worker**

`js/ui.js`: v `melodicControls` a `droneControls` za `row('osc', …)` přidej tři řádky (přepínač přes existující `seg` s `waveOptions`, slidery přes `paramSlider`). `sw.js`: `pulsar-v15`; porovnej `FILES` s `ls js`.

- [ ] **Step 2: Run the Node suite**

Run: `npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: všechno PASS.

- [ ] **Step 3: Verify in Chrome**

Smaž service worker a cache a vynuť znovunačtení souborů; přidej melodic a drone.
- **Skutečný render** přes `OfflineAudioContext` a `playNote`/`createDroneVoice`: sinus + sinus s `mix` 0 dává čistou základní složku; `wave` sinus, `wave2` square, `mix` 1 dává liché harmonické (výrazná složka na 3× frekvence); `wave2` sinus, `mix` 0.5 a `detune` 30 ct dává rázy (kolísání obálky amplitudy); `mix` 0 dává stejný výstup jako volání bez nových voleb (bit po bitu).
- **UI:** v detailu melodic a drone je `osc 2`, `mix`, `detune` (hodnoty „0%“, „0 ct“ při výchozím stavu); tažení, klávesy a tlačítka −/+ fungují, `mix` 1 a `detune` −50 a +50 na koncích; uložení a načtení scény obnoví hodnoty (přes `localStorage` zkontroluj `params`); stará scéna bez nových klíčů se načte s „0%“; `setParam` se při prvním vykreslení nevolá (hodnoty ve scéně se po otevření detailu nezmění).
- **Drone živě:** v běžícím dronu změna `mix` a `detune` projde bez chyb v konzoli; modul po odebrání nezanechá chyby.
- **320 px** (iframe): detail melodic i drone bez vodorovného přetékání, nové ovladače ≥ 44 px.
- Konzole bez chyb; skutečný zvuk z reproduktoru a telefon ověřit nelze, napiš to do závěrečné zprávy.

- [ ] **Step 4: Commit**

```bash
git add js sw.js
git commit -m "feat: osc 2, mix and detune controls and service worker v15

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
