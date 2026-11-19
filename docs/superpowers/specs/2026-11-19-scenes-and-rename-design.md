# Scény (save / load) a přejmenování – krátký návrh

Datum: 2026-11-19. Navazuje na předchozí návrhy Pulsaru (moduly, drone, efekty a sendy).

## Záměr
Uložit celé nastavení (moduly, efekty, sendy, mix) jako pojmenovanou **scénu** v prohlížeči, přepínat mezi scénami a zálohovat rozdělané nápady. Moduly a efekty jdou přejmenovat. Export/import souboru přijde později, formát na to počítá od začátku.

## Cíle
- `[save]` uloží aktuální scénu pod jménem; `[load]` ukáže seznam uložených scén; klik na scénu ji načte.
- Scény lze přejmenovat a smazat.
- Moduly a efekty mají jméno upravitelné klikem v hlavičce panelu.
- Uložený záznam je čitelný JSON s číslem verze, nezávislý na id modulů a efektů.
- Poškozená nebo cizí data v úložišti nikdy nerozbijí aplikaci.

## Non-cíle / anti-cíle
- Neukládá se vyvinutý stav (aktuální vzorce, znějící tóny dronu): ukládá se zadání, evolution po načtení začíná znovu (vybral uživatel: A).
- Žádný export/import souboru, autosave, undo, přechod mezi scénami s crossfade (načtení odebere staré moduly jako ruční `[x]`).
- Selhání: výjimka při prázdném, plném nebo zakázaném `localStorage`; načtení scény se zbloudilým typem modulu nebo efektu shodí aplikaci nebo nechá napůl postavenou scénu; scéna načtená dvakrát nechá staré moduly hrát.

## Formát scény (verze 1)
```
{ version: 1,
  effects: [{ type: 'delay'|'reverb', name, params }],
  modules: [{ type: 'melodic'|'rhythmic'|'drone', name, params, volume, pan, running,
              sends: [{ fx: <index do effects> | null, level }, ×3] }] }
```
`params` jsou přijaté hodnoty modulu/efektu (stejné, jaké továrny přijímají jako přepsání výchozích). Sendy odkazují na efekt indexem v poli, ne id, takže scéna je přenosná.

## Úložiště
`localStorage` klíč `pulsar.scenes`: `{ version: 1, scenes: [{ id, name, savedAt, data }] }`. Čistá vrstva `createSceneStore(storage)` s vloženým úložištěm (testovatelná v Node): `list()`, `save(name, data)`, `rename(id, name)`, `remove(id)`, `get(id)`; každá operace vrací výsledek místo vyhození výjimky.

## Načtení
Validace (`validateScene`): neznámá verze, neznámé typy a nesmyslná pole se ignorují nebo ořežou přes existující továrny/clampy; scéna bez jediného platného modulu nebo efektu se odmítne s hláškou. Postup: odebrat všechny moduly a efekty (stejné cesty jako `[x]`), vytvořit efekty, pak moduly, pak nastavit sendy, volume, pan a `running` (ručně zastavené zůstanou zastavené).

## UI
Hlavička: `[save] [load]` vedle `[stop all]`. `[save]` otevře řádek s jménem (předvyplněné jménem naposledy načtené/uložené scény) a Enter uloží; **stejné jméno přepíše** existující scénu. `[load]` otevře seznam: jméno (klik = načíst), `[rename]`, `[x]` (smazání vyžaduje druhý klik `[sure?]`). Přejmenování modulu/efektu: klik na jméno → vstupní pole, Enter/blur uloží, Esc zruší, prázdné vrací výchozí jméno (typ), max 24 znaků.

## Přístup (vybral uživatel: A)
Ukládá se zadání. Zamítnuto: B (přesný snímek vyvinutých vzorců – těsná vazba na vnitřek modulů, staré scény by se rozbíjely), C (zadání + vzorce jen u melodic/rhythmic – střed, drží vazbu na strukturu vzorců).

## Rozhodnutí autora (ke kontrole)
- Jméno modulu/efektu se ukládá do `m.name`/`fx.name`, výchozí je typ; hlavička zůstává `#id jméno`.
- Načtení scény nahradí aktuální bez potvrzení (nic se neukládá samo).
- Stejné jméno scény = přepsání; smazání scény potvrzuje druhý klik.
- `running` se ukládá, aby ručně zastavený modul zůstal zastavený.
- Service worker cache zvednout (`pulsar-v8`), nové soubory přidat.

## Ponecháno tvůrci
Přesné rozložení seznamu scén v terminálním stylu, texty hlášek, ověření, které přesně pole `params` jednotlivé továrny přijímají jako přepsání.
