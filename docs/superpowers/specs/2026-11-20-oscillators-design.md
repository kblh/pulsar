# Dva oscilátory v modulu: vlna, poměr a detune – návrh (krok 4 z 5)

Datum: 2026-11-20. Navazuje na `instructions.md` („kombinace oscilátorů v jednom modulu + jejich kombinace, můžu si měnit poměr“) a na kroky 1–3.

## Pořadí kroků
1. Skořápka, 2. Ovládací prvky, 3. Efekty – hotovo.
4. **Dva oscilátory v modulu** (tento dokument).
5. Modul sekvence a import/export jednotlivých modulů.

## Záměr
Melodický modul a drone dnes hrají jedním oscilátorem (`wave`). Každý z nich dostane druhý oscilátor s vlastní vlnou, plynulým poměrem mezi oběma a drobným rozladěním (detune), aby šly skládat plnější a živější zvuky než z jedné vlny.

## Cíle
- Nové parametry modulů **melodic** a **drone**: `wave2` (druhá vlna), `mix` (poměr 0–1) a `detune` (rozladění druhého oscilátoru v centech, −50 až +50).
- `mix` 0 = hraje jen osc A, přesně jako dnes; `mix` 1 = hraje jen osc B; mezi tím plynulý přechod (součet hlasitostí je konstantní, takže posuvník nemění celkovou hlasitost zásadně).
- **Staré scény znějí stejně:** scéna bez nových parametrů se načte s `mix` 0 (a `wave2` i `detune` výchozími).
- Ovládání v detailu modulu stejnými HUD ovladači jako ostatní parametry: přepínač `osc 2`, slider `mix`, slider `detune`; funguje od 320 px a na dotyk.
- Nové parametry se ukládají do scén a čtou ze souborů s validací jako ostatní.

## Non-cíle
- Třetí a další oscilátory, vlastní obálka, oktávový posun nebo FM u druhého oscilátoru, šum.
- Rytmický modul (bicí mají pevný zvuk).
- Vizuální ztlumení ovladačů druhého oscilátoru při `mix` 0.

## Anti-cíle
- Stará scéna nebo modul s `mix` 0 zní nebo se zapojuje jinak než dnes (včetně počtu oscilátorů).
- Prasknutí nebo skok hlasitosti u noty či hlasu při jakékoli hodnotě `mix` a `detune`.
- Posun `mix` nebo `detune` na dronu, který se nedá slyšet, dokud se nezmění kořenový tón.
- Zbylé oscilátory po doznění noty nebo po uvolnění či odebrání drone hlasu (únik uzlů a CPU).
- Nepoužitelná hodnota (text, `NaN`, neznámá vlna, číslo mimo rozsah) ze scény, souboru nebo `setParam`, která shodí modul nebo zní nesmyslně.

## Rozhodnutí
Uživatelova: dva oscilátory (varianta 1) s poměrem `mix` a s detune druhého oscilátoru.

Autorova (ke kontrole):
- **Výchozí hodnoty:** `wave2` `sawtooth`, `mix` 0, `detune` 0. Dnešní `wave` zůstává osc A (melodic `triangle`, drone `sine`).
- **Rozsahy a kroky:** `mix` 0–1, krok 0,05, zobrazení v procentech; `detune` −50–50 ct, krok 1, zobrazení se znaménkem („+12 ct“, „−7 ct“, „0 ct“).
- **Hlas se staví podle `mix` v okamžiku vzniku:** pro `mix` 0 se vytvoří jen osc A přímo do obálky (stejné zapojení jako dnes); pro `mix` > 0 se vytvoří osc A a osc B, každý přes vlastní gain (`1 − mix` a `mix`; zvolit lineární přechod nebo stejnou výkonovou křivku, tak aby celková hlasitost zůstala přibližně stejná) do společné obálky/hlasu. Druhý oscilátor má `detune` v centech přes jeho `AudioParam`.
- **Melodic:** `playNote` dostane volitelné `wave2`, `mix`, `detune` (bez nich chování jako dnes). **Drone:** `createDroneVoice` dostane stejné volitelné parametry; `release`, `kill` a odpojení po dozvuku řeší oba oscilátory.
- **Drone je živý (opraveno po kontrole návrhu):** kořenový hlas drone žije dlouho, takže pohyb `mix` a `detune` musí být slyšet hned. Hlas proto nabízí `setMix(mix, detune)`, které plynule (`setTargetAtTime`) změní hlasitosti obou oscilátorů a `detune` druhého; když hlas vznikl při `mix` 0 a oscilátor B ještě nemá, vytvoří se při prvním `mix` > 0 a po návratu na 0 se jen ztlumí (zastaví se spolu s hlasem). `setParam('mix')` a `setParam('detune')` volají `setMix` na všech znějících hlasech včetně těch, které právě doznívají. `wave2` se u dronu při `mix` > 0 chová jako dnes `wave` (hlasy se vymění a staré doznějí); při `mix` 0 se jen uloží. U melodic se parametry čtou při každé nové notě.
- **Stav „mix 0 = jeden oscilátor“** platí pro hlasy a noty, které vznikly při `mix` 0 a na `mix` se už nesáhlo (zapojení jako dnes).
- **Validace:** `setParam('wave2', v)` přijme jen vlny z `WAVES`; `mix` se omezí na 0–1, `detune` na −50–50; nečíselné hodnoty a neznámé vlny se ignorují (modul zůstane na přijaté hodnotě). Platí i pro `validateScene` (stejná omezení, `wave2` jen ze `WAVES`).
- **Scény:** nové klíče v `params` melodic a drone modulů; `version` zůstává 1; chybějící klíče znamenají výchozí hodnoty modulu.
- **UI:** za řádek `osc` přibudou `osc 2` (přepínač stejných vln), `mix` a `detune` (slidery, tlačítka −/+ s krokem 0,05 u `mix` a 1 u `detune`); obojí v melodic i drone.
- Service worker: nová verze cache (`pulsar-v15`); nové soubory se nepředpokládají.

## Omezení a ověření
- Vanilla JS/CSS, žádné závislosti; cesty relativní.
- Node testy: `playNote` a `createDroneVoice` s nahrávacím stubem kontextu (počet oscilátorů při `mix` 0 a > 0, hodnoty `detune`, hodnoty gainů, odpojení a zastavení obou po doznění/`kill`/`release`, zapojení při `mix` 0 shodné s dnešním), `setParam` obou modulů (omezení, neznámá vlna, nečíselné hodnoty), `validateScene` (nové klíče, omezení, staré scény bez nich, hostilní hodnoty), round trip scény.
- Chrome: skutečný render přes `OfflineAudioContext` (jedna vlna vs. dvě: harmonické složky u `mix` 0 a 1, rozladění vytvoří rázy), UI (přepínač a slidery u melodic i drone, uložení a načtení scény, stará scéna beze změny), 320 px bez přetékání, dotykové plochy ≥ 44 px, konzole bez chyb. **Skutečný zvuk z reproduktoru ověřit nelze.**

## Ponecháno tvůrci
Přesná křivka přechodu (lineární nebo výkonová), tvar stubu pro oscilátory, rozdělení do funkcí, texty popisků.
