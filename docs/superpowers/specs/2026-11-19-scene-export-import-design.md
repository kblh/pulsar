# Export a import scén do JSON – krátký návrh

Datum: 2026-11-19. Navazuje na `2026-11-19-scenes-and-rename-design.md`.

## Záměr
Dostat scény z prohlížeče do souboru JSON a zpět: záloha a přenos mezi prohlížeči nebo počítači.

## Cíle
- Export jedné uložené scény, všech uložených scén a aktuální (neuložené) scény do souboru.
- Import jednoho nebo více souborů; importované scény se přidají do seznamu a nenačtou se samy.
- Cizí, rozbitá nebo příliš velká data nikdy nerozbijí aplikaci ani nepřepíšou uložené scény.

## Non-cíle / anti-cíle
- Jen JSON; žádný drag & drop, žádné jiné formáty, žádné automatické načtení po importu.
- Selhání: import přepíše existující scénu; neplatný nebo obří soubor shodí aplikaci; název souboru z exportu obsahuje lomítka nebo řídicí znaky; částečný import ohlásí špatné počty.

## Formát souboru
- Jedna scéna: `{ "pulsar": "scene", "name": "<jméno>", "scene": { version: 1, … } }`, soubor `<jméno>.pulsar.json`.
- Více scén: `{ "pulsar": "scenes", "scenes": [{ "name", "scene" }, …] }`, soubor `pulsar-scenes.json`.
- Import přijme také holou scénu (`{ version: 1, … }`); jméno se vezme z názvu souboru bez přípony `.json`/`.pulsar.json`.

## Import
Limity: soubor max 1 MB, max 100 scén na soubor. Každá scéna prochází `validateScene` (ořezání jako při načtení). Kolize jmen: nová scéna dostane `jméno (2)`, `(3)`, … (celé jméno max 24 znaků), nikdy se nepřepisuje. Hláška: kolik se importovalo a co se přeskočilo a proč (nejvýš první tři důvody).

## UI
- Seznam `[load]`: u každé scény `[export]`, pod seznamem `[export all]` a `[import]` (skrytý `input type=file`, `.json`, `multiple`); `[import]` je vidět i při prázdném seznamu.
- Řádek `[save]`: navíc `[export file]` exportuje aktuální scénu pod napsaným jménem bez uložení do prohlížeče.
- Stažení: `Blob` + `<a download>`.

## Přístup
Čistá logika v `js/scene-file.js` (`sceneToFile`, `scenesToFile`, `parseSceneFile`, `uniqueName`) testovaná v Node; DOM (stahování, výběr souboru) jen v `scenes-ui.js`. Export používá `store.get`, tedy už validovanou scénu.

## Rozhodnutí autora (ke kontrole)
- `[export file]` v řádku save je rozšíření nad rámec zadání (záloha bez ukládání).
- Kolize jmen se řeší příponou `(n)`, ne přepisem.
- Bezpečný název souboru: znaky mimo písmena, číslice, `.`, `_`, `-` a mezeru se nahradí `_`.
- Service worker cache `pulsar-v10`, nový soubor do `FILES`.
