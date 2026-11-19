# Export a import scén – implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exportovat scény do JSON souboru a importovat je zpět.

**Architecture:** Nový čistý `js/scene-file.js` (serializace souboru, parsování a validace importu, unikátní jména), tenká DOM vrstva v `js/scenes-ui.js`.

**Tech Stack:** Vanilla JS, `Blob`/`<a download>`, `<input type=file>`, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-19-scene-export-import-design.md`

## Global Constraints

- Soubory: `{ "pulsar": "scene", "name", "scene" }` (`<jméno>.pulsar.json`), `{ "pulsar": "scenes", "scenes": [{name, scene}] }` (`pulsar-scenes.json`); import přijme i holou scénu `{version: 1, …}`.
- Import limity: soubor max 1 000 000 bajtů, max 100 scén na soubor; scény vždy přes `validateScene`; kolize jmen → `jméno (2)`, `(3)`…, celé jméno max 24 znaků (`NAME_MAX`); nikdy přepis.
- Bezpečný název souboru: znaky mimo písmena, číslice, `.`, `_`, `-` a mezeru → `_`; prázdné → `scene`.
- Žádná operace nevyhazuje výjimku (neplatný JSON, odmítnuté čtení souboru, plné úložiště → hláška).
- Hlášky: kolik se importovalo, kolik přeskočilo a nejvýš první tři důvody; jména se vykreslují přes `textContent`.
- Cache SW `pulsar-v10`, `js/scene-file.js` do `FILES`. Testy: `npm test`.

## Review Focus

- Hostilní soubor: neplatný JSON, soubor nad 1 MB, JSON jako pole/`null`/číslo, `{pulsar:'scenes', scenes:'x'}`, 10 000 scén (ořízne se na 100), klíče `__proto__`/`constructor`: přeskočeno s důvodem, žádná výjimka.
- Round trip export → import dává stejné jméno i obsah (jedna scéna i více najednou).
- Stejný soubor importovaný dvakrát vytvoří `jméno (2)` a nikdy nepřepíše; jméno o 24 znacích s příponou zůstane ≤ 24 znaků.
- Import do plného/blokovaného úložiště: hláška s chybou, správné počty u částečného úspěchu, žádná výjimka.
- Název souboru z jména s lomítky, `..`, řídicími znaky, markupem a emoji je bezpečný; obsah souboru zůstane nedotčený.

---

### Task 1: `js/scene-file.js`

**Files:**
- Create: `js/scene-file.js`
- Test: `tests/scene-file.test.js`

**Interfaces:**
- Consumes: `cleanName`, `validateScene`, `NAME_MAX` ze `scene.js`.
- Produces:
  - `MAX_FILE_BYTES = 1_000_000`, `MAX_SCENES_PER_FILE = 100`
  - `sceneToFile(name: string, scene: Scene): { filename: string, text: string }`
  - `scenesToFile(entries: {name, scene}[]): { filename: 'pulsar-scenes.json', text: string }`
  - `parseSceneFile(text: string, fallbackName: string): { entries: {name: string, scene: Scene}[], problems: string[] }` – jméno z `cleanName`, scény z `validateScene`; `text` delší než `MAX_FILE_BYTES` (v UTF-8 bajtech) → žádné položky a problém; neplatné/nepodporované tvary → problém; scény nad `MAX_SCENES_PER_FILE` se zahodí s problémem
  - `uniqueName(name: string, taken: string[]): string`
  - `exportFilename(name: string, suffix = '.pulsar.json'): string` (bezpečný název)

- [ ] **Step 1: Write the failing tests** v `tests/scene-file.test.js` (scény ze `serializeScene` nad reálnými továrnami):
  - `sceneToFile produces parseable JSON with the wrapper and a safe filename`: `name: 'bass'` → `bass.pulsar.json`, `JSON.parse(text)` má `pulsar:'scene'`, `name:'bass'`, `scene` rovno vstupu.
  - `exportFilename sanitizes`: `'../../etc/passwd'`, `'a/b\\c'`, `'x\u0000y'`, `'<img onerror=1>'`, `'   '`, emoji → žádné `/`, `\\`, řídicí znaky ani `<`; vždy končí `.pulsar.json`; prázdné → `scene.pulsar.json`.
  - `round trip single and multiple`: `parseSceneFile(sceneToFile(n, s).text, 'x')` vrátí 1 položku se stejným jménem a deep-equal scénou (po `validateScene`); `scenesToFile` s třemi scénami se vrátí ve stejném pořadí.
  - `bare scene takes its name from the file name`: holá scéna + fallback `'my song.pulsar.json'` → jméno `my song`; fallback `'x.json'` → `x`.
  - `rejects hostile input with problems and no entries`: `'{'`, `'[]'`, `'null'`, `'5'`, `'"x"'`, `{pulsar:'scenes',scenes:'x'}`, `{pulsar:'scene'}` bez scény, `{pulsar:'scene',scene:{version:1,modules:[{type:'banjo'}]}}` → `entries: []`, `problems.length ≥ 1`, nic nevyhodí.
  - `rejects files over the byte limit` (řetězec s `'x'.repeat(1_000_001)` a také vícebajtové znaky přes limit) → `entries: []`.
  - `caps scenes per file at 100`: 250 scén → 100 položek a problém.
  - `__proto__ and constructor keys are harmless`: soubor s `"__proto__": {"polluted": true}` na různých místech → `({}).polluted === undefined`, scéna normálně zvalidovaná.
  - `uniqueName`: volné jméno beze změny; `('a',['a'])` → `'a (2)'`; `('a',['a','a (2)'])` → `'a (3)'`; 24znakové jméno se zkrátí tak, aby celek měl ≤ 24 znaků a stále se lišil.
- [ ] **Step 2: Run** `node --test tests/scene-file.test.js` – Expected: FAIL (modul neexistuje).
- [ ] **Step 3: Implement** podle Interfaces (bajtovou délku měřit přes `new TextEncoder().encode(text).length`; `JSON.parse` v `try/catch`).
- [ ] **Step 4: Run** `npm test` – Expected: vše zelené.
- [ ] **Step 5: Commit** `feat: scene file format for export and import`.

---

### Task 2: UI – `[export]`, `[export all]`, `[import]`, `[export file]`, cache, ověření

**Files:**
- Modify: `js/scenes-ui.js`, `sw.js` (`pulsar-v10`, `js/scene-file.js` do `FILES`)
- Test: manuální ověření v Chrome

**Interfaces:**
- Consumes: `sceneToFile`, `scenesToFile`, `parseSceneFile`, `uniqueName` ze `scene-file.js`; `store.list/get/save`; `serializeScene`.
- Produces: žádné nové API; `mountScenes` přijme volitelné `download(filename, text)` (výchozí `Blob` + `<a download>` + `URL.revokeObjectURL` po chvíli).

- [ ] **Step 1: Export.** `[export]` u scény: `store.get(id)` → `sceneToFile(entry.name, scene)` → `download`; `null` → hláška. `[export all]` (jen při neprázdném seznamu): všechny scény ze `store.list()` přes `store.get` (neplatné vynechat) → `scenesToFile`. `[export file]` v řádku save: aktuální scéna přes `serializeScene` pod jménem z pole (prázdná scéna → hláška `nothing to export`).
- [ ] **Step 2: Import.** `[import]` v panelu `[load]` (vidět i při prázdném seznamu) otevře skrytý `input type=file` (`accept=".json,application/json"`, `multiple`); u každého souboru `await file.text()` v `try/catch`, `parseSceneFile(text, file.name)`, každá položka `store.save(uniqueName(name, store.list().map(s => s.name)), scene)`; při `ok:false` zbytek přeskočit s chybou úložiště. Po dokončení vynulovat `input.value` (stejný soubor jde vybrat znovu), překreslit seznam a ukázat hlášku `imported N, skipped M: …` (nejvýš tři důvody).
- [ ] **Step 3: Cache:** `sw.js` → `pulsar-v10`, přidat `js/scene-file.js` do `FILES`.
- [ ] **Step 4: Ověření v Chrome** (vyčistit SW/cache; bez skutečného stahování): před klikem přepsat `URL.createObjectURL` a `HTMLAnchorElement.prototype.click`, aby zachytily `Blob` a `download` název a nic nestáhly; seedovat dvě scény do `localStorage`; `[export]` → zachycený název `<jméno>.pulsar.json` a obsah se po `parseSceneFile`-ekvivalentu (`JSON.parse`) shoduje; `[export all]` → `pulsar-scenes.json` se 2 scénami; `[export file]` bez modulů → hláška. Import: vložit `File` do skrytého inputu přes `DataTransfer` a vyvolat `change`: platná scéna (přibude), stejný soubor podruhé (`jméno (2)`), neplatný JSON a soubor nad 1 MB (hláška, nic se nepřidá), soubor se dvěma scénami; v konzoli žádné chyby; jméno `<img src=x onerror=alert(1)>` zůstane textem.
- [ ] **Step 5:** `npm test` – Expected: vše zelené; **Commit** `feat: export and import scenes as JSON files`.
