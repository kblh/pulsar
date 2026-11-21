# Opravy 21/11 (slidery, hlasitost vln, envelope) – implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Slidery se na dotykovém displeji dají přesně trefit a tahat, −/+ neoznačují text, volume je v detailu přes celou šířku, vlny mají podobnou hlasitost a tažení uzlů obálky je jemné.

**Architecture:** Čistá logika (zlomek z pozice ukazatele, klávesové kroky, gesto tap/tah, tlumené tažení) přibývá do `js/hud.js` a je testovatelná v Node. `js/controls.js` staví `createSlider` na Pointer Events se stejným veřejným API. Korekce hlasitosti vln je v `js/synth.js` (`waveGain`), obálka používá `dampedPoint`.

**Tech Stack:** Vanilla JS/CSS, `node --test`; ověření v Chrome.

**Spec:** `docs/superpowers/specs/2026-11-21-mobile-fixes-design.md`

## Global Constraints

- Veřejné API `createSlider({ min, max, step, value, scale, format, onInput, ariaLabel, nudge })` → `{ node, set(v) }` se nemění; `set` nevolá `onInput`; `onInput` se volá jen při změně hodnoty.
- Dráha slideru: `role="slider"`, `tabindex="0"`, `aria-valuemin`, `aria-valuemax`, `aria-valuenow`, `aria-valuetext`, `aria-label`; dotyková výška 44 px, pruh 20 px.
- **Gesto:** myš a pero nastaví hodnotu hned při stisku a sledují tah; dotyk nastaví hodnotu při zvednutí, pokud se prst posunul o nejvýše `SLIDER_SLOP = 8` px (tap), nebo jakmile vodorovný posun přesáhne 8 px (tah). `touch-action: pan-y`; `pointercancel` ukončí gesto bez změny hodnoty.
- Klávesy slideru: šipky (krok `step`, u log 5 % hodnoty, nejméně `step`), PageUp/PageDown ×10, Home/End.
- Textová pole (`input[type=text]`, `textarea`) zůstávají označitelná; `user-select: none` a `-webkit-touch-callout: none` na sliderech, tlačítkách, segmentech a kartách.
- `WAVE_GAIN`: sine 1, ostatní ≤ 1; nic nesmí překročit dnešní špičku. Jeden oscilátor (mix 0) zůstává postaven jako dnes (jeden oscilátor přímo do obálky, žádné nové uzly).
- `ENV_DRAG_GAIN = 0.4`; mapování času (sqrt, 0–5 s), klávesy uzlů a zaokrouhlení na 0,01 s se nemění.
- `sw.js` `CACHE` = `pulsar-v18`; `FILES` musí zůstat shodné s `ls js` (žádný nový soubor v `js/`).
- Commity končí `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Push jen na pokyn „push to origin main“.

## Review Focus

Vstupy a podmínky, které spec naznačuje a testy úkolů je nepokryjí zcela; každý má test v úkolu, který kód vlastní, nebo krok ověření v Chrome:

1. **Svislý swipe po slideru nesmí změnit hodnotu** (prohlížeč pošle `pointercancel`). Test: `cancel()` po `down()` neaplikuje nic (Task 1), Chrome (Task 2).
2. **Tap na slider ve sbalené kartě nesmí otevřít detail.** Dráha už není `input`, takže `closest(...)` v `js/card.js` ji musí znát (Task 2, Chrome).
3. **Druhý prst při probíhajícím tahu se ignoruje**; tah mimo dráhu se drží (capture) a zlomek se omezí na 0–1 (Task 1 test, Task 2 Chrome).
4. **Skrytá nebo nulově široká dráha** (`width` 0) nesmí dát `NaN` (Task 1 test).
5. **Změna vlny/`wave2` na živém dronu s druhým oscilátorem** drží správnou hladinu bez cvaknutí (Task 3 test).

---

### Task 1: Čistá logika slideru a tlumeného tažení v `js/hud.js`

**Files:**
- Modify: `js/hud.js`
- Test: `tests/hud.test.js`

**Interfaces:**
- Consumes: `snap`, `toFraction`, `fromFraction`, `clamp`, `num` (už v `hud.js`).
- Produces (export z `js/hud.js`):
  - `SLIDER_SLOP = 8`, `ENV_DRAG_GAIN = 0.4`
  - `fractionFromX(x: number, rect: { left: number, width: number }): number`: `(x − left) / width` omezeno na 0..1; `width` ≤ 0, nečíselné `x` nebo `rect` → `0`.
  - `keyValue(key: string, cur: number, opts: { min, max, step, scale? }): number | null`: nová snapnutá hodnota pro `ArrowRight/ArrowUp` (+1), `ArrowLeft/ArrowDown` (−1), `PageUp` (+10), `PageDown` (−10), `Home` (min), `End` (max); jiná klávesa → `null`. Lineární krok = `step`; log krok = `max(step, 5 % hodnoty)`; násobek 10 u Page; výsledek přes `snap`.
  - `createGesture({ pointerType: string, slop?: number }): { down(x): boolean, move(x): boolean, up(x): boolean, cancel(): void, readonly active: boolean }`: návratové `true` znamená „nastav hodnotu z této pozice teď“. Myš/pero (`pointerType` různý od `'touch'`): `down` → `true`, `move` → `true` dokud je aktivní, `up` → `false`. Dotyk: `down` → `false`; `move` → `true`, jakmile `|x − x0| > slop` (a dál vždy); `up` → `true` jen když nikdy nebyl tah a `|x − x0| ≤ slop`; `cancel` ukončí gesto. Po `up`/`cancel` (nebo před `down`) vrací všechny metody `false`. Nečíselné `x` vrací `false`.
  - `dampedPoint(grab: {x, y}, pos: {x, y}, point: {x, y}, gain?: number): {x, y}`: `pos + gain × (point − grab)` po osách (výchozí `ENV_DRAG_GAIN`); nečíselná souřadnice `point` → odpovídající souřadnice `pos`.

- [ ] **Step 1: Napsat padající testy** v `tests/hud.test.js` (import nových exportů). Názvy a tvrzení:
  - `fractionFromX maps a pointer to 0..1 and clamps outside the track`: `{left: 100, width: 200}`: `x=100→0`, `200→0.5`, `300→1`, `50→0`, `999→1`.
  - `fractionFromX survives a hidden or unusable track`: `width: 0`, `width: -5`, `x: NaN`, `rect: undefined` → `0`.
  - `keyValue moves a linear slider by one step, ten with the page keys, and to the ends`: `{min:0,max:1,step:0.05}`, `cur 0.5`: `ArrowRight→0.55`, `ArrowDown→0.45`, `PageUp→1`, `PageDown→0`, `Home→0`, `End→1`; `'a'→null`.
  - `keyValue moves a log slider by 5 % of the value but never less than a step`: `{min:20,max:300,step:1,scale:'log'}`: `cur 200 ArrowRight→210`; `cur 20 ArrowRight→21` (5 % je 1, ne menší než krok); `cur 300 ArrowRight→300`.
  - `touch gesture: a short press and release is a tap that applies once on release`: `g.down(100)===false`, `g.move(104)===false`, `g.up(104)===true`, potom `g.up(104)===false`.
  - `touch gesture: moving past the slop starts a drag that follows the finger`: `down(100)` false, `move(109)` true, `move(150)` true, `up(150)` false.
  - `touch gesture: cancel after down applies nothing`: `down(100)`, `cancel()`, pak `move(200)===false`, `up(200)===false`, `active===false`.
  - `mouse gesture applies on press, follows the move, and does nothing on release`: `down(10)` true, `move(40)` true, `up(40)` false.
  - `a gesture ignores events before down and unusable x`: `new` gesture: `move(5)`, `up(5)` false; po `down(10)` s dotykem `move(NaN)` false.
  - `dampedPoint scales the pointer movement and leaves the axis alone for unusable input`: `grab {x:100,y:50}`, `pos {x:200,y:80}`, `point {x:150,y:50}`, gain 0.4 → `{x:220,y:80}`; `point {x:NaN,y:70}` → `{x:200,y:88}`; `point == grab` → `pos`.

- [ ] **Step 2: Spustit a vidět selhání.** Run: `node --test tests/hud.test.js`. Expected: FAIL (importy neexistují).
- [ ] **Step 3: Implementovat** funkce podle signatur v `js/hud.js` (využít `clamp`, `num`, `snap`, `toFraction`; log krok z `fromFraction`/`toFraction` nepoužívat, počítá se z hodnoty).
- [ ] **Step 4: Spustit.** Run: `node --test tests/hud.test.js` Expected: PASS. Pak celá sada: `node --test` Expected: 0 fail.
- [ ] **Step 5: Commit**

```bash
git add js/hud.js tests/hud.test.js
git commit -m "feat: pure slider gesture, key and damped-drag logic"
```

---

### Task 2: Slider na Pointer Events, layout volume, výběr textu

**Files:**
- Modify: `js/controls.js`, `js/card.js:50`, `css/style.css`

**Interfaces:**
- Consumes: z Task 1 `fractionFromX`, `keyValue`, `createGesture`, `SLIDER_SLOP`; z `hud.js` `snap`, `toFraction`, `fromFraction`, `valueChars`.
- Produces: stejné `createSlider(...)` → `{ node, set }`; `node` je `.hud-slider` s dráhou `.hud-track[role=slider]`. Žádný `input.hud-input` ani `LOG_POSITIONS`.

- [ ] **Step 1: Přepsat `createSlider` v `js/controls.js`.**
  - Dráha `.hud-track`: `div`, `role="slider"`, `tabindex="0"`, aria atributy (`aria-valuemin/max` = `min/max`, `aria-valuenow` = aktuální hodnota, `aria-valuetext` = `format(cur)` když `format` existuje).
  - `pointerdown` (u myši jen `button === 0`; ignorovat, pokud gesto už běží): `setPointerCapture` v `try/catch`, `gesture = createGesture({ pointerType: e.pointerType })`, `if (gesture.down(e.clientX)) apply(e.clientX)`; pro myš a pero `e.preventDefault()` a `track.focus()`.
  - `pointermove`/`pointerup`: stejný `pointerId`; `if (g.move(x)) apply(x)`, `if (g.up(x)) apply(x)`. `pointercancel` a `lostpointercapture` → `g.cancel()`. Druhý `pointerId` se ignoruje.
  - `apply(x)`: `change(fromFraction(fractionFromX(x, track.getBoundingClientRect()), opts))`.
  - `keydown`: `const v = keyValue(e.key, cur, opts); if (v !== null) { e.preventDefault(); change(v); }`.
  - `nudge`, `set`, `render`, `valueEl` s pevnou šířkou beze změny. `render` nastavuje `--p` a aria atributy.
- [ ] **Step 2: Upravit `js/card.js:50`:** do `e.target.closest(...)` přidat `[role=slider]`, aby tap na slider otevřenou kartu neotevíral.
- [ ] **Step 3: CSS v `css/style.css`:**
  - smazat pravidla `.hud-input*` a `.hud-slider:has(.hud-input:focus-visible)`;
  - `.hud-track { cursor: pointer; touch-action: pan-y; }`, `.hud-track:focus-visible .hud-bar { outline: 1px solid var(--accent); outline-offset: 2px; }`, `.hud-bar` výška 20 px;
  - `.card-head .card-volume { flex: 1 1 110px; max-width: 45%; }`; `.card.open .card-head .card-volume { flex: 1 1 100%; max-width: none; order: 10; }` (vlastní řádek hlavičky přes celou šířku);
  - `.hud-slider, .nudge, .hud-seg, .card, button, .check { user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }` a `input[type=text], textarea { user-select: text; -webkit-user-select: text; }`.
- [ ] **Step 4: Ověřit sadu.** Run: `node --test` Expected: 0 fail (UI nemá DOM testy).
- [ ] **Step 5: Ověřit v Chrome** (cache vyčistit: odregistrovat SW a smazat `caches`, načíst `http://127.0.0.1:8000/` z `python3 -m http.server 8000`; viewport 320 px přes iframe). Výsledky zapsat do ledgeru:
  1. Skutečná myš: klik na 50 % dráhy volume nastaví ≈ 0,50; tah přes celou dráhu dosáhne 0 i 1; tah mimo dráhu drží hodnotu na kraji.
  2. `PointerEvent` s `pointerType: 'touch'`: `pointerdown` → `pointerup` na 25 % nastaví ≈ 0,25; `pointerdown`, `pointermove` o 40 px vodorovně nastaví hodnotu podle prstu; `pointerdown`, `pointercancel` hodnotu nezmění; druhý `pointerId` během tahu se ignoruje.
  3. Tap na slider ve sbalené kartě detail neotevře; tap na prázdné místo karty ano.
  4. Klávesy na fokusované dráze (šipky, Home/End, u log slideru sekvence délka částí) mění hodnotu a `aria-valuenow`.
  5. Volume v detailu při 320 px má šířku hlavičky (≥ 90 % šířky obsahu); ve sbalené kartě je širší než 90 px.
  6. Dvojitý rychlý tap (`dblclick` simulace) na `−`/`+` nenechá žádný výběr (`getSelection().toString() === ''`).
- [ ] **Step 6: Commit**

```bash
git add js/controls.js js/card.js css/style.css
git commit -m "feat: pointer-event slider, wide volume, no text selection on controls"
```

---

### Task 3: Hlasitost vln (`waveGain`)

**Files:**
- Modify: `js/synth.js`
- Test: `tests/synth.test.js` (a případně úprava očekávání v `tests/drone-module.test.js`, `tests/module.test.js`, pokud zadávají hladiny jiné vlny než sine)

**Interfaces:**
- Consumes: `playNote`, `createDroneVoice`, `oscMix` (existují).
- Produces: `WAVE_GAIN` (objekt `{ sine, triangle, sawtooth, square }`) a `waveGain(wave): number` (neznámá vlna → 1), oba exportované ze `js/synth.js`.

- [ ] **Step 1: Napsat padající testy** do `tests/synth.test.js`:
  - `waveGain: sine is the loudest and keeps today's level, all gains are in (0, 1]`: `waveGain('sine') === 1`; pro všechny 4 vlny `0 < g ≤ 1`; `waveGain('square') < waveGain('sine')`; neznámá vlna (`'x'`, `undefined`) → `1`.
  - `a single note's envelope peak is scaled by the wave`: `playNote` s `wave: 'square'`, mix 0: poslední `linearRamp` obálky na čas `time + a` má hodnotu `0.6 × waveGain('square')`; pro `sine` zůstává `0.6`; počet uzlů beze změny (1 oscilátor, 1 gain).
  - `with two oscillators each level carries its own wave's gain`: `wave: 'sine'`, `wave2: 'square'`, `mix: 0.5`: úroveň B = `0.5 × waveGain('square')`; úroveň A = `0.5 × waveGain('sine')`.
  - `a drone voice scales its peak by its wave and a late second oscillator by the ratio of the waves`: `createDroneVoice` s `wave: 'square'`: cíl `setTargetAtTime` na `gain.gain` je `peak × waveGain('square')`; `setPeak(p)` také škáluje; hlas se `wave: 'sine'`, po `setMix({ mix: 0.5, wave2: 'square', detune: 0 })` je cíl hladiny B `0.5 × waveGain('square') / waveGain('sine')`; hlas se `wave: 'square'` dostane cíl B `b × waveGain(w2) / waveGain('square')`.
  - `a drone whose second wave changes while it is muted keeps the right level afterwards`: voice `wave: 'sine'`, `setMix({mix: 0, wave2: 'square'})` nic nepostaví; následné `setMix({mix: 0.4, wave2: 'sawtooth'})` zacílí B na `0.4 × waveGain('sawtooth')`.
- [ ] **Step 2: Spustit.** Run: `node --test tests/synth.test.js` Expected: FAIL (`waveGain` neexistuje).
- [ ] **Step 3: Implementovat v `js/synth.js`:**
  - `WAVE_GAIN`, výchozí odhad `{ sine: 1, triangle: 0.85, sawtooth: 0.6, square: 0.45 }`, a `waveGain`.
  - `playNote`: špička obálky `0.6 × waveGain(wave)` (sustain odvozen od téže špičky); při dvou oscilátorech `levelA = a × waveGain(wave)` a `levelB = b × waveGain(wave2 ?? wave)`, přičemž špička obálky zůstává `0.6` (zisk je v úrovních, ne dvakrát).
  - `createDroneVoice`: cíl hlavního `gain` a `setPeak` násobí `waveGain(wave)`; úroveň A zůstává `a`; úroveň B (při stavbě i v `setMix`) je `b × waveGain(w2) / waveGain(wave)`, kde `w2` je vlna, kterou B skutečně má po případné tiché změně typu.
- [ ] **Step 4: Spustit celou sadu.** Run: `node --test` Expected: případné selhání starších testů znamená jen, že očekávaná hladina jiné vlny než sine je teď škálovaná; opravit očekávání (ne kód) a v ledgeru zapsat `Ruling`. Konečný stav: 0 fail.
- [ ] **Step 5: Naměřit a doladit hodnoty `WAVE_GAIN`.** V Chrome `OfflineAudioContext` (1 s, C4 = 261,63 Hz, `playNote` do `destination` s výchozí obálkou, mix 0) změřit RMS pro každou vlnu v rozsahu mezi koncem náběhu a začátkem doznívání; upravit hodnoty tak, aby RMS všech vln byla v toleranci ±1,5 dB vůči sine při žádné špičce nad sine. Výsledné RMS tabulku zapsat do ledgeru (součást `Ruling`, pokud se hodnoty liší od odhadu). Zvuk z reproduktoru neověřitelný, stav říct uživateli.
- [ ] **Step 6: Commit**

```bash
git add js/synth.js tests
git commit -m "feat: per-wave gain so sine, triangle, saw and square sound equally loud"
```

---

### Task 4: Tlumené tažení obálky, service worker v18, závěrečná kontrola

**Files:**
- Modify: `js/envelope.js`, `sw.js`
- Test: `tests/hud.test.js` (Task 1 už pokryl `dampedPoint`), kontrola `FILES` testem v `tests/` pokud existuje, jinak ručně

**Interfaces:**
- Consumes: `dampedPoint`, `ENV_DRAG_GAIN`, `envFromDrag`, `nodePositions`, `nearestNode` z `js/hud.js`.
- Produces: `createEnvelopeEditor` se stejným API.

- [ ] **Step 1: Napsat padající test** do `tests/hud.test.js`: `damped drag reaches both ends of a segment and stays inside it`: pro `L = envLayout({w:320,h:120,pad:16})`, uzel `attack` s `env {a:0, ...}`: vezmi `pos = nodePositions(env, L).attack`, `grab = pos`; `dampedPoint(grab, pos, {x: pos.x + L.seg / 0.4 + 50, y: pos.y}, 0.4)` předaný do `envFromDrag('attack', …, env, L)` dá `{ a: 5 }`; a posun doleva o `L.seg` vrátí `{ a: 0 }`. Malý posun o 5 jednotek při `a=2` změní `a` méně než `envFromDrag` bez tlumení při stejném posunu.
- [ ] **Step 2: Spustit.** Run: `node --test tests/hud.test.js` Expected: FAIL jen pokud test používá něco, co ještě neexistuje; jinak PASS (test pinuje vzorec s komponentou z Task 1).
- [ ] **Step 3: Upravit `js/envelope.js`:** při `pointerdown` uložit `grab = pt` a `pos = nodePositions(cur, L)[id]` (místo `dx`, `dy`); při `pointermove` volat `envFromDrag(drag.id, dampedPoint(drag.grab, drag.pos, toGraph(e)), cur, L)`. Zbytek (capture, `touchstart` záloha, klávesy, `HIT_R`) beze změny.
- [ ] **Step 4: `sw.js`:** `CACHE = 'pulsar-v18'`; ověřit, že `FILES` odpovídá `ls js` (beze změny).
- [ ] **Step 5: Celá sada.** Run: `node --test` Expected: 0 fail.
- [ ] **Step 6: Ověřit v Chrome** (čistý původ, 320 px):
  1. Skutečná myš: tažení uzlu attack o 20 px doprava změní `a` zhruba 2,5× méně než dřív (porovnej s hodnotou před změnou ze `git stash`/předchozím commitem nebo s výpočtem `dampedPoint`); tah o celou délku segmentu a více dosáhne `a = 5` i `a = 0`.
  2. Dotyková simulace: `pointerdown` na uzlu → `pointermove` → `pointerup` mění obálku jemně; `touchstart` na uzlu nescrolluje (`defaultPrevented`).
  3. Uzel v grafu sedí na skutečné hodnotě (`readout` souhlasí s polohou), klávesy uzlů fungují.
  4. SW: nový `pulsar-v18` obsahuje všech 42 souborů a starý cache se po `activate` smaže.
  5. Rychlý průchod celé aplikace při 320 px: žádná chyba v konzoli, žádný vodorovný scroll.
- [ ] **Step 7: Commit**

```bash
git add js/envelope.js sw.js tests
git commit -m "feat: damped envelope drag, service worker v18"
```
